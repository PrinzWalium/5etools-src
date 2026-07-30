import {CHAR_SHEET_ABILITIES, CHAR_SHEET_CONDITIONS, CHAR_SHEET_SKILLS, EXHAUSTION_MAX_LEVEL, PROF_STATE_PROFICIENT} from "./charactersheet-consts.js";
import {CharacterModel} from "./charactersheet-model.js";
import {getCharacterLabel, getMigratedStore, getNewStore} from "./charactersheet-charstore.js";
import {getLevelUpHp} from "./charactersheet-levelengine.js";
import {deriveCharacterSheet, formatBreakdown, getConcentrationSaveDc} from "./charactersheet-derive.js";
import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {CharacterWizard} from "./charactersheet-wizard.js";
import {CHOICE_TYPE_ABILITY, CHOICE_TYPE_LANGUAGE, CHOICE_TYPE_SKILL, CHOICE_TYPE_TOOL, getAbilityChoices, getAbilityPackageDisplay, getFixedAbilityBonuses, getGrantedFeats, getPendingChoices, getResistChoices} from "./charactersheet-choices.js";
import {pPickAbilities, pPickList, pResolveEntitySpellGrants, pResolveFeat} from "./charactersheet-featgrant.js";
import {PROF_KIND_LANGUAGE, PROF_KIND_TOOL, PROF_KINDS, groupProficienciesByKind} from "./charactersheet-proficiencies.js";
import {DEFENSE_KINDS, DEFENSE_KIND_RESIST, DEFENSE_KIND_SENSE, getAllDefenses, groupDefensesByKind} from "./charactersheet-defenses.js";
import {getTraitChoiceResist, getTraitChoices} from "./charactersheet-traitchoices.js";
import {SOURCE_MODES, SOURCE_MODE_CUSTOM, getSourceFilterLabel, getSourceFilterPredicate, getOutOfFilterSources, isSourceAllowed, isSourceFilterInactive} from "./charactersheet-sources.js";

/**
 * Shared foundation for the two character pages (the play-focused sheet and the build-focused
 * builder). Owns the character model, the multi-character store + switcher, autosave/persistence,
 * file save/load, and the (null-safe) input-binding helpers. Page-specific DOM assembly and
 * rendering are provided by subclasses via the `_buildDom`/`_bindDom`/`_doRenderAll` hooks.
 *
 * Element wiring is null-safe: each page includes only the fields it needs, and the base skips
 * anything absent — so the two pages can have entirely independent layouts.
 */
export class CharacterPageBase {
	// Page-agnostic so both pages share one set of characters; migrated from the old per-page key.
	static _SHARED_STORAGE_KEY = "charactersheet-characters";
	static _LEGACY_STORAGE_KEY = "charactersheet-state";
	static _FILE_TYPE = "charactersheet";

	// Bindings shared by both pages; null-safe binding skips any element a given page omits.
	static _IPT_STR_BINDINGS = [
		["cs-name", "name"],
		["cs-ac-mode", "acMode"],
		["cs-hp-policy", "hpPolicy"],
		["cs-concentration", "concentration"],
		["cs-classlevel", "classText"],
		["cs-background", "backgroundText"],
		["cs-playername", "playerName"],
		["cs-species", "speciesText"],
		["cs-alignment", "alignment"],
		["cs-speed", "speed"],
		["cs-hd-total", "hdTotal"],
		["cs-hd-cur", "hdCur"],
		["cs-spell-ability", "spellAbility"],
		["cs-spells", "spellsText"],
		["cs-features", "featuresText"],
		["cs-equipment", "equipmentText"],
		["cs-proficiencies", "proficienciesText"],
		["cs-personality", "personalityText"],
	];

	static _IPT_NUM_BINDINGS = [
		["cs-xp", "xp"],
		["cs-level", "level"],
		["cs-ac", "ac"],
		["cs-init-misc", "initMisc"],
		["cs-hp-max", "hpMax"],
		["cs-hp-cur", "hpCur"],
		["cs-hp-temp", "hpTemp"],
		["cs-exhaustion", "exhaustion"],
		["cs-cp", "cp"],
		["cs-sp", "sp"],
		["cs-ep", "ep"],
		["cs-gp", "gp"],
		["cs-pp", "pp"],
	];

	constructor () {
		this._comp = new CharacterModel();
		this._isLoading = false;
		this._saveTimer = null;
		this._store = null; // {storeVersion, currentId, characters: {id: envelope}}
		this._fnsSyncInput = []; // unconditional input-sync functions, for bulk state loads
		this._lastLevel = 1;
		this._suppressLevelPrompt = 0;
		this._traitChoiceDefs = []; // the picked species' "choose one" traits
		this._traitChoiceSource = null;
	}

	static fmtBonus (n) { return `${n >= 0 ? "+" : "−"}${Math.abs(n)}`; }

	/* -------------------------------------------- Lifecycle -------------------------------------------- */

	init () {
		this._buildDom();
		this._bindInputs();
		this._bindStoreControls();
		this._bindDom();

		this._comp._addHookBase("level", () => this._pMaybePromptLevelUp());
		this._comp._addHookBase("proficiencies", () => this._renderProficiencies());
		this._comp._addHookBase("defenses", () => this._renderDefenses());
		// Trait picks imply resistances, and equipped gear grants them for as long as it is worn
		this._comp._addHookBase("inventory", () => this._renderDefenses());
		this._comp._addHookBase("refSpecies", () => this._pRefreshTraitChoices());
		this._comp._addHookBase("traitChoices", () => { this._renderTraitChoices(); this._renderDefenses(); });
		// Level gates the later picks (an Aasimar's Celestial Revelation, ...)
		this._comp._addHookBase("level", () => this._renderTraitChoices());
		this._comp._addHookAllBase(() => this._onStateChange());

		this._bindBreakdownPopovers();
		this._bindPrintPrep();
		this._bindConcentrationWatch();
		this._initStore();

		this._doRenderAll();

		window.dispatchEvent(new Event("toolsLoaded"));
	}

	// region Subclass hooks
	/** Build page-specific DOM scaffolding (ability boxes, lists, panels, ...). */
	_buildDom () {}
	/** Bind page-specific controls, pickers, and panels; register render hooks. */
	_bindDom () {}
	/** Re-render everything from current state (called after bulk loads). */
	_doRenderAll () { this._lastLevel = this._comp.getLevelNumber(); }
	/** Re-render derived values (called on any state change). */
	_renderDerived () {}
	// endregion

	_onStateChange () {
		if (this._isLoading) return;
		this._renderDerived();
		this._saveStateDebounced();
	}

	/* -------------------------------------------- Null-safe input binding -------------------------------------------- */

	_bindInputs () {
		CharacterPageBase._IPT_STR_BINDINGS.forEach(([id, prop]) => this._bindIptStr(id, prop));
		CharacterPageBase._IPT_NUM_BINDINGS.forEach(([id, prop]) => this._bindIptNum(id, prop));
		this._bindCb("cs-inspiration", "inspiration");
	}

	_bindIptStr (id, prop) {
		const ele = document.getElementById(id);
		if (!ele) return;
		const setState = () => this._comp._state[prop] = ele.value;
		ele.addEventListener("input", setState);
		ele.addEventListener("change", setState);

		const hook = () => {
			const val = this._comp._state[prop] ?? "";
			if (ele.value !== `${val}`) ele.value = val;
		};
		this._comp._addHookBase(prop, hook);
		this._fnsSyncInput.push(hook);
		hook();
	}

	_bindIptNum (id, prop) {
		const ele = document.getElementById(id);
		if (!ele) return;
		const setState = () => {
			const raw = ele.value.trim();
			const num = Number(raw);
			this._comp._state[prop] = raw === "" || isNaN(num) ? null : num;
		};
		ele.addEventListener("input", setState);
		ele.addEventListener("change", setState);

		const doSync = () => {
			const val = this._comp._state[prop];
			const asStr = val == null ? "" : `${val}`;
			if (ele.value !== asStr) ele.value = asStr;
		};
		const hook = () => {
			if (document.activeElement === ele) return; // don't clobber while typing
			doSync();
		};
		this._comp._addHookBase(prop, hook);
		this._fnsSyncInput.push(doSync);
		doSync();
	}

	_bindCb (id, prop) {
		const ele = document.getElementById(id);
		if (!ele) return;
		ele.addEventListener("change", () => this._comp._state[prop] = ele.checked);
		const hook = () => ele.checked = !!this._comp._state[prop];
		this._comp._addHookBase(prop, hook);
		this._fnsSyncInput.push(hook);
		hook();
	}

	/** Sync every bound input from state, bypassing focus guards (for bulk loads). */
	_syncAllInputs () { this._fnsSyncInput.forEach(fn => fn()); }

	/* -------------------------------------------- Shared build helpers (data pickers, wizard) -------------------------------------------- */

	/** Build the six ability-score boxes (score input + derived modifier), shared by both pages. */
	_buildAbilities () {
		const wrp = document.getElementById("cs-abilities");
		if (!wrp) return;
		// The modifier leads: it is the number that gets rolled, while the score is reference data
		// you set once. Stacking them (rather than overlapping) keeps both readable.
		wrp.innerHTML = CHAR_SHEET_ABILITIES
			.map(([abv, name]) => `
				<div class="cs__ability" data-cs-ability="${abv}">
					<span class="cs__lbl cs__ability-name">${name}</span>
					<span class="cs__ability-mod cs__roll" id="cs-mod-${abv}">+0</span>
					<label class="cs__ability-scorewrp" title="${name} score">
						<span class="cs__lbl cs__ability-scorelbl">Score</span>
						<input type="number" id="cs-abil-${abv}" min="1" max="30" class="ve-form-control ve-input-xs cs__ability-score">
					</label>
				</div>
			`)
			.join("");

		CHAR_SHEET_ABILITIES.forEach(([abv]) => this._bindIptNum(`cs-abil-${abv}`, `abil_${abv}`));
	}

	/**
	 * Render the ability modifiers, saving throws, skills and passive Perception, each with the
	 * breakdown that explains where its number came from. Identical on every page that shows them.
	 */
	_renderAbilitiesSavesSkills (derived) {
		CHAR_SHEET_ABILITIES.forEach(([abv, name]) => {
			const abil = derived.abilities[abv];
			// The modifier comes from the score; the score itself is explained on its input. The
			// number shown is what an ability *check* rolls, so it carries any exhaustion penalty.
			this._renderRoll(`cs-mod-${abv}`, abil.checkMod, `${name} check`,
				[
					{label: `Score ${abil.score}`, isText: true},
					...abil.scoreParts.slice(1),
					...(derived.exhaustion?.penalty ? [{label: `Exhaustion ${derived.exhaustion.level}`, value: derived.exhaustion.penalty}] : []),
				], {isTapTarget: false});
			CharacterPageBase.setBreakdownTitle(document.getElementById(`cs-abil-${abv}`), name, abil.scoreParts);
			this._renderRoll(`cs-saveroll-${abv}`, derived.saves[abv].mod, `${name} save`, derived.saves[abv].parts, {isTapTarget: false});
			CharacterPageBase.setBreakdownTitle(document.getElementById(`cs-savename-${abv}`), `${name} save`, derived.saves[abv].parts, derived.saves[abv].mod);
		});

		CHAR_SHEET_SKILLS.forEach(skill => {
			const {mod, profState} = derived.skills[skill.key];
			this._renderRoll(`cs-skillroll-${skill.key}`, mod, skill.name, derived.skills[skill.key].parts, {isTapTarget: false});
			CharacterPageBase.setBreakdownTitle(document.getElementById(`cs-skillname-${skill.key}`), skill.name, derived.skills[skill.key].parts, mod);

			const btn = document.getElementById(`cs-skillprof-${skill.key}`);
			btn.classList.toggle("cs__prof--1", profState === 1);
			btn.classList.toggle("cs__prof--2", profState === 2);
		});

		const elePassive = document.getElementById("cs-passive-perception");
		elePassive.textContent = `${derived.passivePerception}`;
		CharacterPageBase.setBreakdownTitle(elePassive, "Passive Perception", derived.passivePerceptionParts, derived.passivePerception, {isTotalValue: true});
	}

	/* -------------------------------------------- Shared DOM scaffolding -------------------------------------------- */

	// Saves, skills, death saves and conditions are built identically wherever they appear, so the
	// sheet and the sidekick page share one copy.
	_buildSaves () {
		const wrp = document.getElementById("cs-saves");
		wrp.innerHTML = CHAR_SHEET_ABILITIES
			.map(([abv, name]) => `
				<label class="cs__list-row" title="Toggle proficiency in ${name} saving throws">
					<input type="checkbox" id="cs-save-${abv}" class="cs__list-cb">
					<span class="cs__roll cs__list-mod" id="cs-saveroll-${abv}">+0</span>
					<span class="cs__list-name" id="cs-savename-${abv}">${name}</span>
				</label>
			`)
			.join("");

		CHAR_SHEET_ABILITIES.forEach(([abv]) => this._bindCb(`cs-save-${abv}`, `save_${abv}`));
	}

	_buildSkills () {
		const wrp = document.getElementById("cs-skills");
		wrp.innerHTML = CHAR_SHEET_SKILLS
			.map(skill => `
				<div class="cs__list-row" data-cs-skill="${skill.key}">
					<button type="button" class="cs__prof" id="cs-skillprof-${skill.key}" title="Click to cycle: not proficient → proficient → expertise"></button>
					<span class="cs__roll cs__list-mod" id="cs-skillroll-${skill.key}">+0</span>
					<span class="cs__list-name" id="cs-skillname-${skill.key}">${skill.name}</span>
					<span class="cs__list-abil ve-muted">${Parser.attAbvToFull(skill.ability).slice(0, 3)}</span>
				</div>
			`)
			.join("");

		CHAR_SHEET_SKILLS.forEach(skill => {
			document.getElementById(`cs-skillprof-${skill.key}`).addEventListener("click", () => {
				const prop = `skill_${skill.key}`;
				this._comp._state[prop] = ((Number(this._comp._state[prop]) || 0) + 1) % 3;
			});
		});
	}

	_buildDeathSaves () {
		[["cs-death-success", "deathSuccess"], ["cs-death-fail", "deathFail"]]
			.forEach(([id, prop]) => {
				const wrp = document.getElementById(id);
				const max = Number(wrp.getAttribute("data-cs-max"));
				for (let i = 0; i < max; ++i) {
					const dot = document.createElement("button");
					dot.type = "button";
					dot.className = "cs__death-dot";
					dot.addEventListener("click", () => {
						const cur = this._comp._state[prop];
						this._comp._state[prop] = (i + 1 === cur) ? i : i + 1;
					});
					wrp.appendChild(dot);
				}
			});
	}

	_renderDeathSaves () {
		[["cs-death-success", this._comp._state.deathSuccess], ["cs-death-fail", this._comp._state.deathFail]]
			.forEach(([id, cnt]) => {
				const dots = document.getElementById(id).querySelectorAll(".cs__death-dot");
				dots.forEach((dot, ix) => dot.classList.toggle("cs__death-dot--active", ix < cnt));
			});
	}

	_buildConditions () {
		const wrp = document.getElementById("cs-conditions");
		if (!wrp) return;
		wrp.innerHTML = CHAR_SHEET_CONDITIONS
			.map(name => `<button type="button" class="ve-btn ve-btn-xxs ve-btn-default cs__cond no-print" data-cs-cond="${name.qq()}">${name.qq()}</button>`)
			.join("");
		wrp.querySelectorAll(".cs__cond").forEach(btn => {
			btn.addEventListener("click", () => this._comp.toggleCondition(btn.getAttribute("data-cs-cond")));
		});
	}

	_renderConditions () {
		const active = new Set(this._comp._state.conditions || []);
		document.querySelectorAll("#cs-conditions .cs__cond").forEach(btn => {
			const on = active.has(btn.getAttribute("data-cs-cond"));
			btn.classList.toggle("ve-btn-danger", on);
			btn.classList.toggle("ve-btn-default", !on);
		});
	}

	_adjustHp (sign) {
		// The delta input is transient UI, not character state, so it is not model-bound
		const eleDelta = document.getElementById("cs-hp-delta");
		const delta = Math.abs(Number(eleDelta.value) || 0);
		if (!delta) return;
		this._comp._state.hpCur = (Number(this._comp._state.hpCur) || 0) + (sign * delta);
		eleDelta.value = "0";
	}

	/* -------------------------------------------- Concentration -------------------------------------------- */

	/**
	 * Losing hit points while concentrating calls for a Constitution save, and forgetting it is the
	 * single easiest thing to miss at the table. Watching `hpCur` rather than the Damage button means
	 * typing a lower number into the field counts too.
	 */
	_bindConcentrationWatch () {
		this._lastHpCur = Number(this._comp._state.hpCur) || 0;

		this._comp._addHookBase("hpCur", () => {
			const prev = this._lastHpCur;
			const next = Number(this._comp._state.hpCur) || 0;
			this._lastHpCur = next;

			// Loading a character or switching to another is not damage
			if (this._isLoading) return;
			const damage = prev - next;
			if (damage <= 0) return;
			if (!(this._comp._state.concentration || "").trim()) return;

			this._renderConcentrationPrompt(damage);
		});

		// Dropping the spell by hand also dismisses the prompt
		this._comp._addHookBase("concentration", () => {
			if (!(this._comp._state.concentration || "").trim()) this._hideConcentrationPrompt();
		});
	}

	_hideConcentrationPrompt () {
		document.getElementById("cs-conc-prompt")?.classList.add("ve-hidden");
	}

	_renderConcentrationPrompt (damage) {
		const wrp = document.getElementById("cs-conc-prompt");
		if (!wrp) return;

		const dc = getConcentrationSaveDc(damage);
		const save = deriveCharacterSheet(this._comp._getState()).saves.con;
		const spell = this._comp._state.concentration;

		wrp.innerHTML = `
			<div class="cs__conc-prompt-line">
				<span class="ve-bold">DC ${dc}</span> Constitution save to keep
				<span class="ve-bold">${spell.qq()}</span>
				<span class="ve-muted">(${damage} damage)</span>
			</div>
			<div class="cs__conc-prompt-actions ve-flex-v-center">
				<span class="cs__roll cs__conc-roll"></span>
				<button type="button" class="ve-btn ve-btn-xxs ve-btn-default" data-cs-conc="keep">Kept it</button>
				<button type="button" class="ve-btn ve-btn-xxs ve-btn-danger" data-cs-conc="lose">Lost it</button>
			</div>`;

		wrp.querySelector(".cs__conc-roll").innerHTML = Renderer.get()
			.render(`{@d20 ${save.mod}|${CharacterPageBase.fmtBonus(save.mod)}|Concentration (Constitution save)}`);
		wrp.querySelector("[data-cs-conc=keep]").addEventListener("click", () => this._hideConcentrationPrompt());
		wrp.querySelector("[data-cs-conc=lose]").addEventListener("click", () => {
			this._comp._state.concentration = "";
			this._hideConcentrationPrompt();
		});

		wrp.classList.remove("ve-hidden");
	}

	/** What exhaustion is costing this character, stated next to the counter. */
	_renderExhaustionNote (derived) {
		const ele = document.getElementById("cs-exhaustion-note");
		if (!ele) return;

		const {level, penalty, speedPenaltyFt} = derived.exhaustion;
		if (!level) { ele.textContent = ""; return; }

		ele.textContent = level >= EXHAUSTION_MAX_LEVEL
			? "dead"
			: `${penalty} to d20 tests, −${speedPenaltyFt} ft. speed`;
		ele.title = level >= EXHAUSTION_MAX_LEVEL
			? "The sixth level of exhaustion is death"
			: `Every ability check, saving throw and attack roll is reduced by ${Math.abs(penalty)}`;
	}

	/** Bind the species/background/class search buttons shared by both pages. */
	_bindBuildPickers () {
		this._bindClick("cs-pick-species", () => this._onPickSpecies());
		this._bindClick("cs-pick-background", () => this._onPickBackground());
		this._bindClick("cs-pick-class", () => this._onPickClass());
	}

	_renderPickLink (which) {
		const ele = document.getElementById(`cs-link-${which}`);
		if (!ele) return;
		const tag = this._comp._state.pickTags[which];
		ele.innerHTML = tag ? Renderer.get().render(tag) : "";
	}

	_renderPickLinks () {
		["species", "background", "class"].forEach(w => this._renderPickLink(w));
	}

	/* -------------------------------------------- Proficiencies -------------------------------------------- */

	/**
	 * Render the structured armor/weapon/tool/language proficiencies, grouped by kind. Each entry
	 * carries the source(s) that granted it, so a player can see *why* they have it; the free-text
	 * box below stays for anything the data cannot express.
	 */
	_renderProficiencies () {
		const wrp = document.getElementById("cs-prof-list");
		if (!wrp) return;
		wrp.innerHTML = "";

		const groups = groupProficienciesByKind(this._comp._state.proficiencies || []);
		if (!groups.length) {
			wrp.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small no-print">None yet &mdash; picking content fills these in, or add one by hand.</div>`);
		}

		groups.forEach(grp => {
			const row = document.createElement("div");
			row.className = "cs__prof-group";

			const lbl = document.createElement("span");
			lbl.className = "cs__lbl cs__prof-group-lbl";
			lbl.textContent = grp.label;
			row.appendChild(lbl);

			grp.items.forEach(it => {
				const chip = document.createElement("span");
				chip.className = "cs__prof-chip";
				if (it.isOptional) chip.classList.add("cs__prof-chip--optional");

				const from = it.sources.length ? `From: ${it.sources.join(", ")}` : "Added by hand";
				const explanation = it.isOptional ? `${from} (optional in the rules)` : from;
				chip.title = explanation;
				chip.classList.add("cs__has-breakdown");
				chip.dataset.csBreakdown = `${it.name} — ${explanation}`;

				const name = document.createElement("span");
				name.textContent = it.name;
				chip.appendChild(name);

				const btnRm = document.createElement("button");
				btnRm.type = "button";
				btnRm.className = "cs__prof-chip-rm no-print";
				btnRm.title = "Remove";
				btnRm.innerHTML = "&times;";
				btnRm.addEventListener("click", () => it.ids.forEach(id => this._comp.removeProficiency(id)));
				chip.appendChild(btnRm);

				row.appendChild(chip);
			});

			wrp.appendChild(row);
		});

		const btnAdd = document.createElement("button");
		btnAdd.type = "button";
		btnAdd.className = "ve-btn ve-btn-xxs ve-btn-default no-print ve-mt-1";
		btnAdd.id = "cs-prof-add";
		btnAdd.title = "Add a proficiency earned through training or the story";
		btnAdd.innerHTML = `<span class="glyphicon glyphicon-plus"></span> Add Proficiency`;
		btnAdd.addEventListener("click", () => this._pOnAddProficiency());
		wrp.appendChild(btnAdd);
	}

	async _pOnAddProficiency () {
		const kind = await InputUiUtil.pGetUserEnum({
			values: PROF_KINDS,
			isResolveItem: true,
			fnDisplay: it => it.label,
			title: "Add a proficiency",
			placeholder: "Which kind?",
		});
		if (kind == null) return;

		const name = await InputUiUtil.pGetUserString({title: `Add ${kind.label} proficiency`});
		if (!name?.trim()) return;

		this._comp.addProficiency({kind: kind.kind, name: name.trim(), source: null});
	}

	/* -------------------------------------------- Defenses & senses -------------------------------------------- */

	/**
	 * Resistances, immunities, vulnerabilities, condition immunities and senses, grouped and
	 * attributed. What equipped gear grants is folded in here rather than stored, so taking the ring
	 * off takes the resistance with it — the chip says as much.
	 */
	_renderDefenses () {
		const wrp = document.getElementById("cs-defense-list");
		if (!wrp) return;
		wrp.innerHTML = "";

		const groups = groupDefensesByKind(getAllDefenses(this._comp._getState()));
		if (!groups.length) {
			wrp.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small no-print">None yet &mdash; a species, feat or magic item fills these in, or add one by hand.</div>`);
		}

		groups.forEach(grp => {
			const row = document.createElement("div");
			row.className = "cs__prof-group";

			const lbl = document.createElement("span");
			lbl.className = "cs__lbl cs__prof-group-lbl";
			lbl.textContent = grp.label;
			row.appendChild(lbl);

			grp.items.forEach(it => {
				const chip = document.createElement("span");
				chip.className = "cs__prof-chip";
				if (it.isFromItem) chip.classList.add("cs__prof-chip--optional");

				const from = it.sources.length ? `From: ${it.sources.join(", ")}` : "Added by hand";
				const explanation = [
					from,
					it.note ? `(${it.note})` : null,
					it.isFromItem ? "— while that gear is equipped" : null,
				].filter(Boolean).join(" ");
				chip.title = explanation;
				chip.classList.add("cs__has-breakdown");
				chip.dataset.csBreakdown = `${it.name} — ${explanation}`;

				const name = document.createElement("span");
				name.textContent = it.note ? `${it.name}*` : it.name;
				chip.appendChild(name);

				// Only a stored entry can be removed; gear is removed by unequipping it
				if (it.ids.length) {
					const btnRm = document.createElement("button");
					btnRm.type = "button";
					btnRm.className = "cs__prof-chip-rm no-print";
					btnRm.title = "Remove";
					btnRm.innerHTML = "&times;";
					btnRm.addEventListener("click", () => it.ids.forEach(id => this._comp.removeDefense(id)));
					chip.appendChild(btnRm);
				}

				row.appendChild(chip);
			});

			wrp.appendChild(row);
		});

		const btnAdd = document.createElement("button");
		btnAdd.type = "button";
		btnAdd.className = "ve-btn ve-btn-xxs ve-btn-default no-print ve-mt-1";
		btnAdd.id = "cs-defense-add";
		btnAdd.title = "Add a resistance, immunity or sense granted by the story or a ruling";
		btnAdd.innerHTML = `<span class="glyphicon glyphicon-plus"></span> Add Defense`;
		btnAdd.addEventListener("click", () => this._pOnAddDefense());
		wrp.appendChild(btnAdd);
	}

	async _pOnAddDefense () {
		const kind = await InputUiUtil.pGetUserEnum({
			values: DEFENSE_KINDS,
			isResolveItem: true,
			fnDisplay: it => it.label,
			title: "Add a defense or sense",
			placeholder: "Which kind?",
		});
		if (kind == null) return;

		const name = await InputUiUtil.pGetUserString({
			title: kind.kind === DEFENSE_KIND_SENSE ? "Add a sense (e.g. Darkvision 60 ft.)" : `Add ${kind.label.replace(/s$/, "")}`,
		});
		if (!name?.trim()) return;

		this._comp.addDefense({kind: kind.kind, name: name.trim(), source: null});
	}

	/**
	 * The upstream `pGetUserRaceSearch`/`pGetUserBackgroundSearch` helpers take no options, so there is
	 * no way to pass a source filter into them. Rather than edit an upstream file (which would add an
	 * upstream-merge conflict point), load the same index and drive the lower-level entity search — it
	 * does accept `fnFilterResults`. Search docs carry their source as `.s`.
	 */
	async _pSearchEntity ({fnLoad, indexName, title, fnTransform = null}) {
		await fnLoad();
		const opts = {};
		if (fnTransform) opts.fnTransform = fnTransform;
		if (!isSourceFilterInactive(this._comp._state.sourceFilter)) {
			opts.fnFilterResults = doc => this._isSourceAllowed(doc.s);
		}
		return SearchWidget.pGetUserEntitySearch(title, indexName, opts);
	}

	async _onPickSpecies () {
		const doc = await this._pSearchEntity({
			fnLoad: () => SearchWidget.pLoadCustomIndex({
				contentIndexName: "entity_Races",
				errorName: "species",
				customIndexSubSpecs: [new SearchWidget.CustomIndexSubSpec({
					dataSource: () => DataUtil.race.loadJSON(),
					prop: "race",
					catId: Parser.CAT_ID_RACE,
					page: UrlUtil.PG_RACES,
				})],
			}),
			indexName: "entity_Races",
			title: "Select Species",
			fnTransform: doc => {
				const cpy = MiscUtil.copyFast(doc);
				Object.assign(cpy, SearchWidget.docToPageSourceHash(cpy));
				cpy.tag = `{@race ${doc.n}${doc.s !== Parser.SRC_PHB ? `|${doc.s}` : ""}}`;
				return cpy;
			},
		});
		if (!doc) return;
		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
		this._comp.applyPickedRace({doc, ent});
		if (ent) {
			await this._pOfferAbilityBonuses(ent, doc.n);
			await this._pResolveProficiencyChoices({ent, kind: "race"});
			const isResistChosen = await this._pResolveTraitChoices(ent);
			// A Draconic Ancestry pick already fixes the damage resistance; don't ask twice
			if (!isResistChosen) await this._pResolveResistChoices(ent);
			// A species' lineage spells (Elf, Tiefling, ...) use the same `additionalSpells` shape as feats
			await pResolveEntitySpellGrants(this._comp, ent, {grantKeyPrefix: `race:${ent.name}|${ent.source}`});
		}
	}

	/**
	 * Resolve a species' damage-resistance choice — a Dragonborn's draconic ancestry and the few
	 * species built the same way — into structured entries alongside its fixed ones.
	 */
	async _pResolveResistChoices (ent) {
		for (const choice of getResistChoices({groups: ent.resist, sourceName: ent.name})) {
			const picked = await pPickList({count: choice.count, from: choice.from, title: `${ent.name}: ${choice.label}`});
			(picked || []).forEach(name => this._comp.addDefense({kind: DEFENSE_KIND_RESIST, name, source: ent.name}));
		}
	}

	/* -------------------------------------------- "Choose one" trait picks -------------------------------------------- */

	/**
	 * Ask for each "choose one of the following" species trait the character already qualifies for
	 * (Elven Lineage, Giant Ancestry, Draconic Ancestry, ...). Traits gained at a later level are
	 * left for the panel, which offers them once that level is reached.
	 * @return {boolean} Whether a pick also settled the species' damage resistance.
	 */
	async _pResolveTraitChoices (ent) {
		let isResistChosen = false;
		const level = this._comp.getLevelNumber();

		for (const choice of getTraitChoices(ent)) {
			if (choice.level > level) continue;
			const option = await InputUiUtil.pGetUserEnum({
				values: choice.options,
				isResolveItem: true,
				fnDisplay: opt => opt.name,
				title: `${ent.name}: ${choice.trait}`,
				placeholder: "Select an option...",
			});
			if (option == null) continue;
			this._applyTraitChoice({source: ent.name, choice, optionName: option.name});
			if (getTraitChoiceResist(choice, option.name)) isResistChosen = true;
		}

		return isResistChosen;
	}

	_applyTraitChoice ({source, choice, optionName}) {
		this._comp.setTraitChoice({
			source,
			trait: choice.trait,
			level: choice.level,
			option: optionName,
			resist: optionName ? getTraitChoiceResist(choice, optionName) : null,
		});
	}

	/**
	 * Load the picked species so its "choose one" traits can be offered. Held on the page rather
	 * than in the character, since it is data rather than a decision.
	 */
	async _pRefreshTraitChoices () {
		const ref = this._comp._state.refSpecies;
		this._traitChoiceDefs = [];
		this._traitChoiceSource = ref?.name || null;

		if (ref?.name && ref?.source) {
			const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_RACES]({name: ref.name, source: ref.source});
			const ent = await DataLoader.pCacheAndGet(UrlUtil.PG_RACES, ref.source, hash, {isCopy: true}).catch(() => null);
			if (ent) this._traitChoiceDefs = getTraitChoices(ent);
		}

		this._renderTraitChoices();
	}

	/** Render the species' "choose one" traits, so a pick can be made or changed at any time. */
	_renderTraitChoices () {
		const wrp = document.getElementById("cs-trait-list");
		if (!wrp) return;
		wrp.innerHTML = "";

		const defs = this._traitChoiceDefs || [];
		if (!defs.length) return;

		const source = this._traitChoiceSource;
		const level = this._comp.getLevelNumber();

		defs.forEach(choice => {
			const cur = this._comp.getTraitChoice(source, choice.trait);
			const isLocked = choice.level > level;

			const row = document.createElement("div");
			row.className = "cs__trait-choice";

			const head = document.createElement("div");
			head.className = "ve-flex-v-center";
			const lbl = document.createElement("span");
			lbl.className = "cs__lbl ve-mr-2";
			lbl.textContent = choice.trait;
			lbl.title = choice.prompt;
			head.appendChild(lbl);

			const sel = document.createElement("select");
			sel.className = "ve-form-control ve-input-xs";
			sel.disabled = isLocked;
			sel.innerHTML = `<option value="">&mdash;</option>${choice.options.map(opt => `<option>${opt.name.qq()}</option>`).join("")}`;
			sel.value = cur?.option || "";
			sel.addEventListener("change", () => this._applyTraitChoice({source, choice, optionName: sel.value || null}));
			head.appendChild(sel);
			row.appendChild(head);

			const note = document.createElement("div");
			note.className = "ve-muted ve-small";
			const picked = choice.options.find(opt => opt.name === cur?.option);
			if (isLocked) note.textContent = `Chosen at level ${choice.level}.`;
			else if (picked) note.textContent = [picked.desc, cur.resist ? `Resistance: ${cur.resist}` : null].filter(Boolean).join(" ");
			else note.textContent = choice.prompt;
			row.appendChild(note);

			wrp.appendChild(row);
		});
	}

	async _onPickBackground () {
		const doc = await this._pSearchEntity({
			fnLoad: () => SearchWidget.pLoadCustomIndex({
				contentIndexName: "entity_Backgrounds",
				errorName: "backgrounds",
				customIndexSubSpecs: [new SearchWidget.CustomIndexSubSpec({
					dataSource: `${Renderer.get().baseUrl}data/backgrounds.json`,
					prop: "background",
					catId: Parser.CAT_ID_BACKGROUND,
					page: UrlUtil.PG_BACKGROUNDS,
				})],
			}),
			indexName: "entity_Backgrounds",
			title: "Select Background",
			fnTransform: doc => {
				const cpy = MiscUtil.copyFast(doc);
				Object.assign(cpy, SearchWidget.docToPageSourceHash(cpy));
				cpy.tag = `{@background ${doc.n}${doc.s !== Parser.SRC_PHB ? `|${doc.s}` : ""}}`;
				return cpy;
			},
		});
		if (!doc) return;
		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
		// Fixed proficiencies apply directly; the "N of your choice" ones are resolved interactively below.
		this._comp.applyPickedBackground({doc, ent, isFixedOnly: true});
		if (ent) {
			await this._pOfferAbilityBonuses(ent, doc.n);
			await this._pResolveProficiencyChoices({ent, kind: "background"});
			await this._pGrantBackgroundFeats(ent);
		}
	}

	/**
	 * Resolve the choice-based skill/language/tool proficiencies a species or background grants
	 * (e.g. "choose 2 skills", "one tool of your choice") — the same choices the wizard's Choices
	 * step surfaces. Skills apply to the sheet; tools/languages have no structured store, so they
	 * become proficiency notes. Ability-score choices are handled separately by `_pOfferAbilityBonuses`.
	 */
	async _pResolveProficiencyChoices ({ent, kind}) {
		const choices = getPendingChoices({[kind]: ent}).filter(c => c.type !== CHOICE_TYPE_ABILITY);
		if (!choices.length) return;

		for (const choice of choices) {
			const picked = await pPickList({count: choice.count, from: choice.from, title: `${ent.name}: ${choice.label}`});
			(picked || []).forEach(name => {
				if (choice.type === CHOICE_TYPE_SKILL) this._comp.setSkillProfByName(name, PROF_STATE_PROFICIENT);
				else if (choice.type === CHOICE_TYPE_LANGUAGE) this._comp.addProficiency({kind: PROF_KIND_LANGUAGE, name, source: ent.name});
				else if (choice.type === CHOICE_TYPE_TOOL) this._comp.addProficiency({kind: PROF_KIND_TOOL, name, source: ent.name});
			});
		}
	}

	/**
	 * 2024 backgrounds grant a fixed Origin feat (`feats: [{"magic initiate; cleric|xphb": true}]`).
	 * Resolve each interactively (ability increase, fixed grants, skill/Expertise choices) and record it.
	 */
	async _pGrantBackgroundFeats (bgEnt) {
		for (const {name, source, displayName} of getGrantedFeats(bgEnt.feats)) {
			const feat = await CharacterSheetClassData.pGetFeat({name, source}).catch(() => null);
			if (!feat) continue;
			const isApply = await InputUiUtil.pGetUserBoolean({
				title: "Grant Origin Feat?",
				htmlDescription: `<div>This background grants the origin feat <b>${(displayName || feat.name).qq()}</b>.<br>Add it now?</div>`,
				textYes: "Add",
				textNo: "Skip",
			});
			if (!isApply) continue;
			const bonuses = await pResolveFeat(this._comp, feat);
			if (bonuses == null) continue;
			this._comp.addOriginFeat({name: feat.name, source: feat.source, displayName: displayName || feat.name, bonuses});
		}
	}

	/**
	 * After a standalone pick: offer to apply the entity's ability score increases (opt-in, since the
	 * sheet's scores are final values). Unambiguous fixed bonuses are a single confirm; choice-based
	 * ones (a 2024 background's "+2/+1 among ..." or "choose 2 of ...") are resolved interactively.
	 */
	async _pOfferAbilityBonuses (ent, name) {
		const fixed = getFixedAbilityBonuses(ent.ability);
		if (Object.keys(fixed).length) {
			const ptBonuses = Object.entries(fixed).map(([abv, n]) => `${n >= 0 ? "+" : ""}${n} ${Parser.attAbvToFull(abv)}`).join(", ");
			const isApply = await InputUiUtil.pGetUserBoolean({
				title: "Apply Ability Score Increases?",
				htmlDescription: `<div>${name.qq()} grants: <b>${ptBonuses.qq()}</b>.<br>Add this to the current ability scores?</div>`,
				textYes: "Apply",
				textNo: "Skip",
			});
			if (isApply) this._comp.applyAbilityBonuses(fixed, {source: name});
		}

		for (const choice of getAbilityChoices({ability: ent.ability, sourceName: name})) {
			await this._pResolveAbilityChoice(choice, name);
		}
	}

	/**
	 * Walk one ability-score choice: pick the package (when a source offers alternatives, e.g. a 2024
	 * background's "+2/+1" vs "+1/+1/+1"), then assign each increase to an ability. Declining leaves a
	 * note so the grant isn't silently lost.
	 */
	async _pResolveAbilityChoice (choice, name) {
		const ptOffer = choice.packages.map(pkg => getAbilityPackageDisplay(pkg)).join(" — or — ");
		const isApply = await InputUiUtil.pGetUserBoolean({
			title: "Apply Ability Score Increases?",
			htmlDescription: `<div>${name.qq()} grants: <b>${ptOffer.qq()}</b>.<br>Assign this now?</div>`,
			textYes: "Assign",
			textNo: "Skip",
		});
		if (!isApply) {
			this._comp.appendToTextProp("proficienciesText", `Ability Scores (${name}): ${ptOffer} — assign manually`);
			return;
		}

		let pkg = choice.packages[0];
		if (choice.packages.length > 1) {
			pkg = await InputUiUtil.pGetUserEnum({
				values: choice.packages,
				isResolveItem: true,
				fnDisplay: p => getAbilityPackageDisplay(p),
				title: `${name}: which increases?`,
				placeholder: "Select...",
			});
			if (pkg == null) return;
		}

		const allAbvs = CHAR_SHEET_ABILITIES.map(([abv]) => abv);
		const bonuses = {...pkg.fixed};
		const taken = new Set(Object.keys(bonuses));

		// "+2/+1 among Dex, Int, Wis": assign each weight to a distinct ability, largest first
		for (const weight of (pkg.weighted?.weights || [])) {
			const from = (pkg.weighted.from.length ? pkg.weighted.from : allAbvs).filter(abv => !taken.has(abv));
			if (!from.length) break;
			const [abv] = await pPickAbilities({count: 1, from, title: `${name}: which ability gets ${weight >= 0 ? "+" : ""}${weight}?`}) || [];
			if (abv == null) return this._noteUnassignedAbilities(name, ptOffer);
			bonuses[abv] = (bonuses[abv] || 0) + weight;
			taken.add(abv);
		}

		// "+1 to 2 of Str, Dex": pick `count` distinct abilities, each gaining `amount`
		if (pkg.choose) {
			const from = (pkg.choose.from.length ? pkg.choose.from : allAbvs).filter(abv => !taken.has(abv));
			const picked = await pPickAbilities({count: pkg.choose.count, from, title: `${name}: increase which ability?`});
			if (!picked) return this._noteUnassignedAbilities(name, ptOffer);
			picked.forEach(abv => bonuses[abv] = (bonuses[abv] || 0) + pkg.choose.amount);
		}

		if (Object.keys(bonuses).length) this._comp.applyAbilityBonuses(bonuses, {source: name});
	}

	_noteUnassignedAbilities (name, ptOffer) {
		this._comp.appendToTextProp("proficienciesText", `Ability Scores (${name}): ${ptOffer} — assign manually`);
	}

	async _onPickClass () {
		const classes = await CharacterSheetClassData.pGetAllClasses();
		if (!classes.length) return;
		const cls = await InputUiUtil.pGetUserEnum({
			values: classes,
			isResolveItem: true,
			fnDisplay: c => `${c.name} (${Parser.sourceJsonToAbv(c.source)})`,
			title: "Select Class",
			placeholder: "Select a class...",
		});
		if (cls == null) return;

		this._comp.applyPickedClass(cls, this._comp.getLevelNumber());
	}

	/** The wizard applies its own suggested HP, so suppress the per-level prompt while it runs. */
	async _pOnWizard () {
		this._suppressLevelPrompt += 1;
		try {
			await CharacterWizard.pShow({comp: this._comp});
		} finally {
			this._suppressLevelPrompt -= 1;
			this._lastLevel = this._comp.getLevelNumber();
		}
	}

	/**
	 * Render a rollable modifier. When `parts` is supplied, the element also carries a breakdown
	 * tooltip explaining where the number came from ("Dexterity +3, Proficiency +2 = +5").
	 */
	_renderRoll (id, mod, name, parts = null, {isTapTarget = true} = {}) {
		const ele = document.getElementById(id);
		if (!ele) return;
		ele.innerHTML = Renderer.get().render(`{@d20 ${mod}|${CharacterPageBase.fmtBonus(mod)}|${name}}`);
		// A rollable value swallows clicks (that is the roll), so its explanation is hover-only and
		// the tap target lives on the neighbouring label instead.
		CharacterPageBase.setBreakdownTitle(ele, name, parts, mod, {isTapTarget});
	}

	/**
	 * The spell save DC and attack bonus only mean anything once a spellcasting ability is set, so
	 * hide the pair for a character who has none rather than showing two em-dashes.
	 */
	static setSpellBadgesVisible (isVisible) {
		["cs-spell-dc", "cs-spell-atk"].forEach(id => {
			const badge = document.getElementById(id)?.closest(".cs__stat-badge");
			if (badge) badge.classList.toggle("ve-hidden", !isVisible);
		});
	}

	/**
	 * Attach a "where this comes from" explanation to an element: a `title` for desktop hover, and a
	 * tap/click popover for touch devices, where `title` never appears. Cleared when there is nothing
	 * to say.
	 */
	static setBreakdownTitle (ele, name, parts, total = null, {isTotalValue = false, isTapTarget = true} = {}) {
		if (!ele) return;
		if (!parts?.length) {
			ele.removeAttribute("title");
			ele.classList.remove("cs__has-breakdown");
			delete ele.dataset.csBreakdown;
			return;
		}

		const text = `${name}: ${formatBreakdown(parts, total, {isTotalValue})}`;
		ele.setAttribute("title", text);
		// The roll link is rendered inside, and would otherwise show its own tooltip instead
		ele.querySelectorAll("[title]").forEach(child => child.removeAttribute("title"));

		if (!isTapTarget) return;
		ele.classList.add("cs__has-breakdown");
		ele.dataset.csBreakdown = text;
	}

	/* -------------------------------------------- Print / PDF -------------------------------------------- */

	/**
	 * Printing (and so "Save as PDF") needs two things CSS cannot do:
	 *
	 *  - a `textarea` prints only the lines its box shows, so its text is mirrored into a plain
	 *    element that flows and wraps;
	 *  - a closed `<details>` prints as its summary alone, so every feature card is opened.
	 *
	 * Both are undone afterwards, leaving the page as the player left it.
	 */
	_bindPrintPrep () {
		const onBefore = () => {
			document.querySelectorAll("#charsheet details").forEach(ele => {
				if (ele.open) return;
				ele.dataset.csReclose = "1";
				ele.open = true;
			});

			// A saves/skills panel with nothing marked is a heading with nothing under it
			document.querySelectorAll("#charsheet .cs__panel").forEach(panel => {
				const lists = panel.querySelectorAll(".cs__list");
				const isEmptyLists = lists.length && ![...lists].some(list => list.querySelector(".cs__prof--1, .cs__prof--2, .cs__list-cb:checked"));
				panel.classList.toggle("cs__panel--print-empty", !!isEmptyLists);
			});

			document.querySelectorAll("#charsheet textarea").forEach(ta => {
				let mirror = ta.nextElementSibling;
				if (!mirror?.classList?.contains("cs__print-text")) {
					mirror = document.createElement("div");
					mirror.className = "cs__print-text";
					ta.after(mirror);
				}
				mirror.textContent = ta.value;
				mirror.classList.toggle("cs__print-text--empty", !ta.value.trim());
			});
		};

		const onAfter = () => {
			document.querySelectorAll("#charsheet details[data-cs-reclose]").forEach(ele => {
				ele.open = false;
				delete ele.dataset.csReclose;
			});
		};

		window.addEventListener("beforeprint", onBefore);
		window.addEventListener("afterprint", onAfter);
		// Headless printing and "print to PDF" from our own button do not always fire `beforeprint`
		this._doPrintPrep = onBefore;
	}

	/** Print, having prepared the page for paper first. */
	_doPrint () {
		this._doPrintPrep?.();
		window.print();
	}

	/**
	 * One delegated listener for the whole page: tapping anything carrying a breakdown shows it in a
	 * dismissible popover. Delegation means it keeps working across the many re-renders, and costs
	 * nothing on elements that have no breakdown.
	 */
	_bindBreakdownPopovers () {
		document.addEventListener("click", evt => {
			const ele = evt.target.closest?.("[data-cs-breakdown]");
			if (!ele) return CharacterPageBase._closeBreakdownPopover();
			// Let rollable links roll; the popover is for the surrounding value
			if (evt.target.closest("a, button, input, select, textarea")) return;
			evt.preventDefault();
			CharacterPageBase._showBreakdownPopover(ele);
		});
		window.addEventListener("scroll", () => CharacterPageBase._closeBreakdownPopover(), {passive: true});
	}

	static _closeBreakdownPopover () {
		document.getElementById("cs-breakdown-popover")?.remove();
	}

	static _showBreakdownPopover (ele) {
		CharacterPageBase._closeBreakdownPopover();

		const pop = document.createElement("div");
		pop.id = "cs-breakdown-popover";
		pop.className = "cs__breakdown-pop";
		pop.textContent = ele.dataset.csBreakdown;
		document.body.appendChild(pop);

		const rect = ele.getBoundingClientRect();
		const popRect = pop.getBoundingClientRect();
		// Keep it on-screen: prefer below, flip above when there is no room
		const top = rect.bottom + popRect.height + 8 > window.innerHeight && rect.top > popRect.height + 8
			? rect.top - popRect.height - 6
			: rect.bottom + 6;
		const left = Math.max(6, Math.min(rect.left, window.innerWidth - popRect.width - 6));
		pop.style.top = `${top + window.scrollY}px`;
		pop.style.left = `${left + window.scrollX}px`;
	}

	/* -------------------------------------------- Store controls (toolbar) -------------------------------------------- */

	_bindStoreControls () {
		this._bindClick("cs-btn-save", () => this._onSaveToFile());
		this._bindClick("cs-btn-load", () => this._onLoadFromFile());
		this._bindClick("cs-btn-print", () => this._doPrint());
		this._bindClick("cs-btn-reset", () => this._onReset());

		const sel = document.getElementById("cs-char-select");
		if (sel) sel.addEventListener("change", () => this._switchCharacter(sel.value));
		this._bindClick("cs-char-new", () => {
			this._persistNow();
			const id = CryptUtil.uid();
			this._store.characters[id] = null;
			this._switchCharacter(id);
			// The sidekick page creates sidekicks, the character pages create characters
			Object.entries(this._getNewCharacterState()).forEach(([prop, val]) => this._comp._state[prop] = val);
		});
		this._bindClick("cs-char-delete", () => this._onDeleteCharacter());
	}

	_bindClick (id, fn) {
		const ele = document.getElementById(id);
		if (ele) ele.addEventListener("click", fn);
	}

	/* -------------------------------------------- Store / persistence -------------------------------------------- */

	_initStore () {
		const rawStore = StorageUtil.syncGet(CharacterPageBase._SHARED_STORAGE_KEY) ??
			StorageUtil.syncGet(`${CharacterPageBase._LEGACY_STORAGE_KEY}_charactersheet.html`);
		this._store = getMigratedStore(rawStore) || getNewStore();

		// The stored "current" character may belong to another page; prefer one of ours
		const ownIds = Object.entries(this._store.characters)
			.filter(([, envelope]) => this._isCharacterListed(envelope?.state ?? envelope))
			.map(([id]) => id);
		const cur = this._store.characters[this._store.currentId];
		if (!this._isCharacterListed(cur?.state ?? cur) && ownIds.length) this._store.currentId = ownIds[0];

		const envelope = this._store.characters[this._store.currentId];
		if (envelope) this._doLoadState(envelope);
		else Object.entries(this._getNewCharacterState()).forEach(([prop, val]) => this._comp._state[prop] = val);
		this._onStoreLoaded();
		this._renderCharacterSelect();
	}

	/** Subclass hook after the initial character is loaded (e.g. ensure a default attack row). */
	_onStoreLoaded () {}

	_doLoadState (saved) {
		this._isLoading = true;
		try {
			const isApplied = this._comp.setStateFrom(saved);
			if (!isApplied) JqueryUtil.doToast({type: "danger", content: "Could not load character&mdash;unknown save format."});
		} finally {
			this._isLoading = false;
		}
		this._applySourceFilter();
		this._doRenderAll();
	}

	/**
	 * Push this character's source filter into the data layer, so the pickers only offer content from
	 * the books it allows. Lookups of content the character already has stay unfiltered.
	 */
	_applySourceFilter () {
		const filter = this._comp._state.sourceFilter;
		CharacterSheetClassData.setSourceFilter(
			getSourceFilterPredicate(filter, {isClassic: src => SourceUtil.isClassicSource(src)}),
		);
	}

	/** Whether a source may be picked under this character's filter. */
	_isSourceAllowed (source) {
		return isSourceAllowed(source, this._comp._state.sourceFilter, {isClassic: src => SourceUtil.isClassicSource(src)});
	}

	/* -------------------------------------------- Source filter UI -------------------------------------------- */

	_bindSourceFilter () {
		this._bindClick("cs-btn-sources", () => this._pOnEditSources());
		this._comp._addHookBase("sourceFilter", () => {
			this._applySourceFilter();
			this._renderSourceFilterLabel();
		});
		this._renderSourceFilterLabel();
	}

	_renderSourceFilterLabel () {
		const ele = document.getElementById("cs-sources-label");
		if (ele) ele.textContent = getSourceFilterLabel(this._comp._state.sourceFilter);
	}

	/** Every source that actually has character-relevant content, grouped for the picker. */
	async _pGetSelectableSources () {
		const [classes, subclasses, feats, spells, optFeatures] = await Promise.all([
			CharacterSheetClassData.pGetAllClassesUnfiltered(),
			CharacterSheetClassData.pGetAllSubclassesUnfiltered(),
			CharacterSheetClassData.pGetAllFeatsUnfiltered(),
			CharacterSheetClassData.pGetAllSpellsUnfiltered(),
			CharacterSheetClassData.pGetAllOptionalFeaturesUnfiltered(),
		]);
		const counts = new Map();
		[classes, subclasses, feats, spells, optFeatures]
			.flat()
			.forEach(it => { if (it?.source) counts.set(it.source, (counts.get(it.source) || 0) + 1); });

		return [...counts.entries()]
			.map(([source, count]) => ({
				source,
				count,
				name: Parser.sourceJsonToFull(source),
				abv: Parser.sourceJsonToAbv(source),
				group: SourceUtil.getFilterGroup(source),
				isClassic: SourceUtil.isClassicSource(source),
			}))
			.sort((a, b) => (a.group - b.group) || SortUtil.ascSortLower(a.name, b.name));
	}

	async _pOnEditSources () {
		const sources = await this._pGetSelectableSources();
		const cur = this._comp._state.sourceFilter || {mode: "all", sources: {}};
		// Working copy; only committed on Save
		const draft = {mode: cur.mode || "all", sources: {...(cur.sources || {})}};

		const {eleModalInner, doClose} = UiUtil.getShowModal({
			title: "Sources",
			isMinHeight0: true,
		});
		const wrp = document.createElement("div");
		wrp.className = "ve-flex-col";
		eleModalInner.appendChild(wrp);

		wrp.insertAdjacentHTML("beforeend", `<p class="ve-muted ve-small">Choose which books this character may pick content from. Anything already on the character keeps working, whatever you pick here.</p>`);

		// --- Presets ---
		const wrpModes = document.createElement("div");
		wrpModes.className = "ve-flex ve-flex-wrap ve-mb-2";
		wrp.appendChild(wrpModes);

		// --- Per-source checkboxes, grouped ---
		const wrpSources = document.createElement("div");
		wrpSources.className = "ve-flex-col";
		wrpSources.style.maxHeight = "45vh";
		wrpSources.style.overflowY = "auto";
		wrp.appendChild(wrpSources);

		const renderSources = () => {
			const isCustom = draft.mode === SOURCE_MODE_CUSTOM;
			wrpSources.innerHTML = "";
			if (!isCustom) {
				const allowed = sources.filter(it => isSourceAllowed(it.source, draft, {isClassic: s => SourceUtil.isClassicSource(s)}));
				wrpSources.innerHTML = `<div class="ve-muted ve-small">This preset allows <b>${allowed.length}</b> of ${sources.length} books. Switch to <b>Custom</b> to pick individual books.</div>`;
				return;
			}

			let lastGroup = null;
			sources.forEach(it => {
				if (it.group !== lastGroup) {
					lastGroup = it.group;
					const groupName = SourceUtil.getFilterGroupName(it.group) || "Standard";
					const hdr = document.createElement("div");
					hdr.className = "ve-flex-v-center ve-mt-1 ve-mb-1";
					hdr.innerHTML = `<span class="bold ve-small">${groupName.qq()}</span>`;
					const btnAll = document.createElement("button");
					btnAll.type = "button";
					btnAll.className = "ve-btn ve-btn-xxs ve-btn-default ve-ml-2";
					btnAll.textContent = "All";
					btnAll.addEventListener("click", () => {
						sources.filter(s => s.group === it.group).forEach(s => draft.sources[s.source] = true);
						renderSources();
					});
					const btnNone = document.createElement("button");
					btnNone.type = "button";
					btnNone.className = "ve-btn ve-btn-xxs ve-btn-default ve-ml-1";
					btnNone.textContent = "None";
					btnNone.addEventListener("click", () => {
						sources.filter(s => s.group === it.group).forEach(s => delete draft.sources[s.source]);
						renderSources();
					});
					hdr.append(btnAll, btnNone);
					wrpSources.appendChild(hdr);
				}

				const lbl = document.createElement("label");
				lbl.className = "ve-flex-v-center ve-small ve-mb-1";
				const cb = document.createElement("input");
				cb.type = "checkbox";
				cb.className = "ve-mr-2";
				cb.checked = !!draft.sources[it.source];
				cb.addEventListener("change", () => {
					if (cb.checked) draft.sources[it.source] = true;
					else delete draft.sources[it.source];
				});
				const spn = document.createElement("span");
				spn.innerHTML = `${it.name.qq()} <span class="ve-muted">(${it.abv.qq()}${it.isClassic ? ", 2014" : ""}; ${it.count} entries)</span>`;
				lbl.append(cb, spn);
				wrpSources.appendChild(lbl);
			});
		};

		SOURCE_MODES.forEach(({mode, name, desc}) => {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = `ve-btn ve-btn-xs ve-mr-1 ve-mb-1 ${draft.mode === mode ? "ve-btn-primary" : "ve-btn-default"}`;
			btn.textContent = name;
			btn.title = desc;
			btn.addEventListener("click", () => {
				// Switching to Custom seeds the boxes from whatever the current preset allows
				if (mode === SOURCE_MODE_CUSTOM && draft.mode !== SOURCE_MODE_CUSTOM) {
					draft.sources = {};
					sources
						.filter(it => isSourceAllowed(it.source, draft, {isClassic: s => SourceUtil.isClassicSource(s)}))
						.forEach(it => draft.sources[it.source] = true);
				}
				draft.mode = mode;
				[...wrpModes.children].forEach((el, ix) => {
					el.className = `ve-btn ve-btn-xs ve-mr-1 ve-mb-1 ${SOURCE_MODES[ix].mode === mode ? "ve-btn-primary" : "ve-btn-default"}`;
				});
				renderSources();
			});
			wrpModes.appendChild(btn);
		});

		renderSources();

		const wrpBtns = document.createElement("div");
		wrpBtns.className = "ve-flex-v-center ve-flex-h-right ve-mt-2";
		const btnSave = document.createElement("button");
		btnSave.type = "button";
		btnSave.className = "ve-btn ve-btn-sm ve-btn-primary";
		btnSave.textContent = "Save";
		btnSave.addEventListener("click", () => {
			this._comp.setSourceFilter(draft);
			doClose(true);
		});
		const btnCancel = document.createElement("button");
		btnCancel.type = "button";
		btnCancel.className = "ve-btn ve-btn-sm ve-btn-default ve-mr-2";
		btnCancel.textContent = "Cancel";
		btnCancel.addEventListener("click", () => doClose(false));
		wrpBtns.append(btnCancel, btnSave);
		wrp.appendChild(wrpBtns);
	}

	/** Picks the character already has that fall outside its current filter (never hidden, just flagged). */
	_getOutOfFilterPicks () {
		return getOutOfFilterSources(this._comp._getState(), this._comp._state.sourceFilter, {
			isClassic: src => SourceUtil.isClassicSource(src),
		});
	}

	_saveStateDebounced () {
		if (this._saveTimer) clearTimeout(this._saveTimer);
		this._saveTimer = setTimeout(() => this._persistNow(), 150);
	}

	_persistNow () {
		if (this._saveTimer) {
			clearTimeout(this._saveTimer);
			this._saveTimer = null;
		}
		this._store.characters[this._store.currentId] = this._comp.getSaveableState();
		StorageUtil.syncSet(CharacterPageBase._SHARED_STORAGE_KEY, this._store);
		this._renderCharacterSelect();
	}

	/**
	 * Characters and sidekicks live in one store but are edited on different pages, so each page's
	 * switcher lists only its own kind. The current character is always listed, whatever it is —
	 * hiding what is on screen would be worse than showing something unexpected.
	 */
	_isCharacterListed () { return true; }

	/** State to seed onto a character created on this page. */
	_getNewCharacterState () { return {}; }

	_getListedCharacterIds () {
		return Object.entries(this._store.characters)
			.filter(([id, envelope]) => id === this._store.currentId || this._isCharacterListed(envelope?.state ?? envelope))
			.map(([id]) => id);
	}

	_renderCharacterSelect () {
		const sel = document.getElementById("cs-char-select");
		if (!sel) return;
		sel.innerHTML = this._getListedCharacterIds()
			.map(id => `<option value="${id.qq()}">${getCharacterLabel(id === this._store.currentId ? this._comp.getSaveableState() : this._store.characters[id]).qq()}</option>`)
			.join("");
		sel.value = this._store.currentId;
	}

	_switchCharacter (id, {isSkipPersist = false} = {}) {
		if (!(id in this._store.characters)) return;
		if (!isSkipPersist && id !== this._store.currentId) this._persistNow();
		this._store.currentId = id;

		const envelope = this._store.characters[id];
		this._isLoading = true;
		try {
			this._comp._setState(this._comp._getDefaultState());
		} finally {
			this._isLoading = false;
		}
		if (envelope) this._doLoadState(envelope);
		else this._doRenderAll();
		this._onStoreLoaded();
		this._persistNow();
	}

	async _onDeleteCharacter () {
		if (!await InputUiUtil.pGetUserBoolean({
			title: "Delete Character",
			htmlDescription: `<div>Delete <b>${getCharacterLabel(this._comp.getSaveableState()).qq()}</b>?<br>This cannot be undone.</div>`,
			textYes: "Delete",
			textNo: "Cancel",
		})) return;

		delete this._store.characters[this._store.currentId];
		const remaining = Object.entries(this._store.characters)
			.filter(([, envelope]) => this._isCharacterListed(envelope?.state ?? envelope))
			.map(([id]) => id);
		if (!remaining.length) {
			const id = CryptUtil.uid();
			this._store.characters[id] = null;
			remaining.push(id);
		}
		this._switchCharacter(remaining[0], {isSkipPersist: true});
	}

	/* -------------------------------------------- File / reset -------------------------------------------- */

	_onSaveToFile () {
		const name = (this._comp._state.name || "character").trim() || "character";
		DataUtil.userDownload(Parser.stringToSlug(name) || "character", this._comp.getSaveableState(), {fileType: CharacterPageBase._FILE_TYPE});
	}

	async _onLoadFromFile () {
		const {jsons, errors} = await InputUiUtil.pGetUserUploadJson({expectedFileTypes: [CharacterPageBase._FILE_TYPE]});
		DataUtil.doHandleFileLoadErrorsGeneric(errors);
		if (!jsons?.length) return;
		this._doLoadState(jsons[0]);
		this._onStoreLoaded();
		this._persistNow();
	}

	async _onReset () {
		if (!await InputUiUtil.pGetUserBoolean({
			title: "Reset Character",
			htmlDescription: `<div>This will clear the current character's sheet (other characters are kept).<br>Are you sure?</div>`,
			textYes: "Reset",
			textNo: "Cancel",
		})) return;

		this._isLoading = true;
		try {
			this._comp._setState(this._comp._getDefaultState());
		} finally {
			this._isLoading = false;
		}
		this._onStoreLoaded();
		this._doRenderAll();
		this._persistNow();
	}

	/* -------------------------------------------- Level-up prompt -------------------------------------------- */

	async _pMaybePromptLevelUp () {
		const newLevel = this._comp.getLevelNumber();
		const prevLevel = this._lastLevel;
		this._lastLevel = newLevel;

		if (this._isLoading || this._suppressLevelPrompt > 0 || newLevel <= prevLevel) return;

		const primary = this._comp._state.classes.find(c => c.hdFaces);
		if (!primary) return;
		const faces = primary.hdFaces;
		const numLevels = newLevel - prevLevel;
		const conMod = Parser.getAbilityModNumber(Number(this._comp._state.abil_con) || 10);

		const avgTotal = getLevelUpHp({faces, conMod, numLevels}).total;
		const maxTotal = numLevels * Math.max(1, faces + conMod);
		const rollTotal = () => getLevelUpHp({faces, conMod, numLevels, fnRoll: f => Math.floor(Math.random() * f) + 1}).total;

		const applyGain = gained => {
			this._comp._state.hpMax = (Number(this._comp._state.hpMax) || 0) + gained;
			this._comp._state.hpCur = (Number(this._comp._state.hpCur) || 0) + gained;
			JqueryUtil.doToast({type: "success", content: `Gained ${gained} HP (now level ${newLevel}).`});
		};

		// A saved HP policy applies automatically; "ask" (the default) prompts each level-up.
		const policy = this._comp._state.hpPolicy || "ask";
		if (policy === "average") return applyGain(avgTotal);
		if (policy === "max") return applyGain(maxTotal);
		if (policy === "roll") return applyGain(rollTotal());

		const optAvg = `Add average (+${avgTotal} HP)`;
		const optMax = `Add max (+${maxTotal} HP)`;
		const ptConMod = conMod ? ` ${conMod > 0 ? "+" : "−"} ${Math.abs(conMod)} per level` : "";
		const optRoll = `Roll ${numLevels}d${faces}${ptConMod}`;
		const optSkip = "Enter manually / skip";

		const choice = await InputUiUtil.pGetUserEnum({
			values: [optAvg, optMax, optRoll, optSkip],
			isResolveItem: true,
			title: `Level up to ${newLevel}${numLevels > 1 ? ` (+${numLevels} levels)` : ""}`,
			placeholder: "How do you want to gain HP?",
		});
		if (choice == null || choice === optSkip) return;

		applyGain(choice === optRoll ? rollTotal() : choice === optMax ? maxTotal : avgTotal);
	}
}

globalThis.CharacterPageBase = CharacterPageBase;

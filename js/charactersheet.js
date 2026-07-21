import {CHAR_SHEET_ABILITIES, CHAR_SHEET_SKILLS} from "./charactersheet/charactersheet-consts.js";
import {CharacterModel} from "./charactersheet/charactersheet-model.js";
import {deriveCharacterSheet, getAbilityModifier, getProfBonus} from "./charactersheet/charactersheet-derive.js";
import {CharacterSheetClassData} from "./charactersheet/charactersheet-classdata.js";
import {CharacterWizard} from "./charactersheet/charactersheet-wizard.js";
import {CharacterClassPanel} from "./charactersheet/charactersheet-classpanel.js";
import {getAbilityChoices, getAbilityPackageDisplay, getFixedAbilityBonuses} from "./charactersheet/charactersheet-choices.js";
import {CharacterInventoryPanel} from "./charactersheet/charactersheet-inventorypanel.js";
import {CharacterSpellsPanel} from "./charactersheet/charactersheet-spellspanel.js";
import {getCharacterLabel, getMigratedStore, getNewStore} from "./charactersheet/charactersheet-charstore.js";
import {getLevelUpHp} from "./charactersheet/charactersheet-levelengine.js";

/** Renders the attacks table from the model's `attacks` collection. */
class _AttacksRenderableCollection extends RenderableCollectionBase {
	constructor (comp, wrpRows) {
		super(comp, "attacks");
		this._wrpRows = wrpRows;
	}

	getNewRender (entity) {
		const tr = document.createElement("tr");
		tr.className = "cs__atk-row";
		tr.innerHTML = `
			<td><input type="text" class="ve-form-control ve-input-xs cs__atk-name" placeholder="e.g. Longsword"></td>
			<td class="ve-text-center">
				<div class="cs__atk-cell">
					<input type="number" class="ve-form-control ve-input-xs cs__ipt-num cs__ipt-num--xs cs__atk-bonus">
					<span class="cs__roll cs__atk-hit"></span>
				</div>
			</td>
			<td class="ve-text-center">
				<div class="cs__atk-cell">
					<input type="text" class="ve-form-control ve-input-xs cs__atk-dmg" placeholder="e.g. 1d8+3 slashing">
					<span class="cs__roll cs__atk-dmgroll"></span>
				</div>
			</td>
			<td class="ve-text-center no-print">
				<button type="button" class="ve-btn ve-btn-xs ve-btn-danger cs__atk-rm" title="Remove"><span class="glyphicon glyphicon-trash"></span></button>
			</td>
		`;

		const meta = {
			wrpRow: tr,
			iptName: tr.querySelector(".cs__atk-name"),
			iptBonus: tr.querySelector(".cs__atk-bonus"),
			iptDmg: tr.querySelector(".cs__atk-dmg"),
			dispHit: tr.querySelector(".cs__atk-hit"),
			dispDmg: tr.querySelector(".cs__atk-dmgroll"),
		};

		meta.iptName.addEventListener("input", () => this._comp.updateAttack(entity.id, {name: meta.iptName.value}));
		meta.iptBonus.addEventListener("input", () => this._comp.updateAttack(entity.id, {atkBonus: Number(meta.iptBonus.value) || 0}));
		meta.iptDmg.addEventListener("input", () => this._comp.updateAttack(entity.id, {damage: meta.iptDmg.value}));
		tr.querySelector(".cs__atk-rm").addEventListener("click", () => this._comp.removeAttack(entity.id));

		this._wrpRows.appendChild(tr);
		this.doUpdateExistingRender(meta, entity);

		return meta;
	}

	doUpdateExistingRender (meta, entity) {
		this.constructor._setIptValue(meta.iptName, entity.name);
		this.constructor._setIptValue(meta.iptBonus, `${entity.atkBonus ?? 0}`);
		this.constructor._setIptValue(meta.iptDmg, entity.damage);
		this.constructor._renderRolls(meta, entity);
	}

	doDeleteExistingRender (meta) {
		meta.wrpRow.remove();
	}

	/** Avoid clobbering the input the user is currently typing in. */
	static _setIptValue (ipt, val) {
		if (document.activeElement === ipt) return;
		if (ipt.value !== val) ipt.value = val;
	}

	static _renderRolls (meta, entity) {
		const name = (entity.name || "").trim();
		const bonus = Number(entity.atkBonus) || 0;
		const dmg = (entity.damage || "").trim();

		meta.dispHit.innerHTML = Renderer.get().render(`{@hit ${bonus}|${CharacterSheetPage.fmtBonus(bonus)}|${name || "Attack"}}`);

		if (dmg && /\d\s*d\s*\d/i.test(dmg)) {
			meta.dispDmg.innerHTML = Renderer.get().render(`{@dice ${dmg}|${dmg}|${name || "Damage"}}`);
			meta.dispDmg.classList.remove("ve-hidden");
		} else {
			meta.dispDmg.innerHTML = "";
			meta.dispDmg.classList.add("ve-hidden");
		}
	}
}

class CharacterSheetPage {
	static _STORAGE_KEY = "charactersheet-state";
	static _MODE_KEY = "charactersheet-mode";
	static _MODE_BUILD = "build";
	static _MODE_PLAY = "play";
	static _FILE_TYPE = "charactersheet";

	// Inputs that represent build-time character choices; made read-only in Play mode.
	static _BUILD_LOCK_INPUT_IDS = [
		"cs-level", "cs-classlevel", "cs-background", "cs-species",
		"cs-abil-str", "cs-abil-dex", "cs-abil-con", "cs-abil-int", "cs-abil-wis", "cs-abil-cha",
	];

	// Simple string-valued inputs/selects/textareas, bound verbatim to model props
	static _IPT_STR_BINDINGS = [
		["cs-name", "name"],
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

	// Numeric inputs, bound as `number | null` (null = blank)
	static _IPT_NUM_BINDINGS = [
		["cs-xp", "xp"],
		["cs-level", "level"],
		["cs-ac", "ac"],
		["cs-init-misc", "initMisc"],
		["cs-hp-max", "hpMax"],
		["cs-hp-cur", "hpCur"],
		["cs-hp-temp", "hpTemp"],
		["cs-cp", "cp"],
		["cs-sp", "sp"],
		["cs-ep", "ep"],
		["cs-gp", "gp"],
		["cs-pp", "pp"],
	];

	constructor () {
		this._comp = new CharacterModel();
		this._attacksCollection = null;
		this._isLoading = false;
		this._saveTimer = null;
		this._store = null; // {storeVersion, currentId, characters: {id: envelope}}
		this._fnsSyncInput = []; // unconditional input-sync functions, for bulk state loads
		this._lastLevel = 1; // for detecting interactive level-ups
		this._suppressLevelPrompt = 0; // >0 while a bulk apply (e.g. the wizard) is in progress
		this._mode = CharacterSheetPage._MODE_BUILD;
	}

	init () {
		this._buildAbilities();
		this._buildSaves();
		this._buildSkills();
		this._buildDeathSaves();

		this._bindInputs();
		this._bindStaticControls();
		this._bindDataPickers();

		this._attacksCollection = new _AttacksRenderableCollection(this._comp, document.getElementById("cs-attacks-body"));
		this._comp._addHookBase("attacks", () => this._attacksCollection.render());
		this._classPanel = new CharacterClassPanel({comp: this._comp, wrp: document.getElementById("cs-class-panel")});
		this._classPanel.init();
		this._inventoryPanel = new CharacterInventoryPanel({comp: this._comp, wrp: document.getElementById("cs-inventory")});
		this._inventoryPanel.init();
		this._spellsPanel = new CharacterSpellsPanel({
			comp: this._comp,
			wrpSlots: document.getElementById("cs-spell-slots"),
			wrpKnown: document.getElementById("cs-spells-known"),
		});
		this._spellsPanel.init();
		this._comp._addHookBase("pickTags", () => this._renderPickLinks());
		this._comp._addHookBase("deathSuccess", () => this._renderDeathSaves());
		this._comp._addHookBase("deathFail", () => this._renderDeathSaves());
		this._comp._addHookBase("level", () => this._pMaybePromptLevelUp());
		this._comp._addHookAllBase(() => this._onStateChange());

		this._store = getMigratedStore(StorageUtil.syncGetForPage(CharacterSheetPage._STORAGE_KEY)) || getNewStore();
		this._bindCharacterSwitcher();

		const envelope = this._store.characters[this._store.currentId];
		if (envelope) this._doLoadState(envelope);
		if (!this._comp._state.attacks.length) this._comp.addAttack();
		this._renderCharacterSelect();

		this._doRenderAll();

		this._bindModeToggle();
		const storedMode = StorageUtil.syncGetForPage(CharacterSheetPage._MODE_KEY);
		this._setMode(storedMode === CharacterSheetPage._MODE_PLAY ? CharacterSheetPage._MODE_PLAY : CharacterSheetPage._MODE_BUILD);

		window.dispatchEvent(new Event("toolsLoaded"));
	}

	/* -------------------------------------------- Build / Play mode -------------------------------------------- */

	_bindModeToggle () {
		document.getElementById("cs-mode-build").addEventListener("click", () => this._setMode(CharacterSheetPage._MODE_BUILD));
		document.getElementById("cs-mode-play").addEventListener("click", () => this._setMode(CharacterSheetPage._MODE_PLAY));
	}

	_setMode (mode) {
		this._mode = mode;
		const isPlay = mode === CharacterSheetPage._MODE_PLAY;

		// Container class drives CSS that hides build-only buttons and dims locked controls
		const wrp = document.querySelector("main.container");
		if (wrp) {
			wrp.classList.toggle("cs-mode--play", isPlay);
			wrp.classList.toggle("cs-mode--build", !isPlay);
		}

		// Active state on the toggle buttons
		document.getElementById("cs-mode-build").classList.toggle("ve-btn-primary", !isPlay);
		document.getElementById("cs-mode-play").classList.toggle("ve-btn-primary", isPlay);

		// Build-time inputs become read-only in Play mode (switch to Build to edit — the escape hatch)
		CharacterSheetPage._BUILD_LOCK_INPUT_IDS.forEach(id => {
			const ele = document.getElementById(id);
			if (!ele) return;
			ele.readOnly = isPlay;
			ele.title = isPlay ? "Locked in Play mode — switch to Build to change this" : "";
		});

		StorageUtil.syncSetForPage(CharacterSheetPage._MODE_KEY, mode);
	}

	_onStateChange () {
		if (this._isLoading) return;
		this._renderDerived();
		this._saveStateDebounced();
	}

	_doLoadState (saved) {
		this._isLoading = true;
		try {
			const isApplied = this._comp.setStateFrom(saved);
			if (!isApplied) JqueryUtil.doToast({type: "danger", content: "Could not load character&mdash;unknown save format."});
		} finally {
			this._isLoading = false;
		}
		this._doRenderAll();
	}

	_doRenderAll () {
		// Bypass the inputs' focus guards: a bulk load must win over whatever was focused
		this._fnsSyncInput.forEach(fn => fn());
		this._attacksCollection.render();
		this._renderPickLinks();
		this._renderDeathSaves();
		this._renderDerived();
		this._lastLevel = this._comp.getLevelNumber();
	}

	/** On an interactive level increase, offer to add average or rolled HP for the new level(s). */
	async _pMaybePromptLevelUp () {
		const newLevel = this._comp.getLevelNumber();
		const prevLevel = this._lastLevel;
		this._lastLevel = newLevel;

		if (this._isLoading || this._suppressLevelPrompt > 0 || newLevel <= prevLevel) return;

		const primary = this._comp._state.classes.find(c => c.hdFaces);
		if (!primary) return; // no hit die to base a suggestion on
		const faces = primary.hdFaces;
		const numLevels = newLevel - prevLevel;
		const conMod = Parser.getAbilityModNumber(Number(this._comp._state.abil_con) || 10);

		const avgTotal = getLevelUpHp({faces, conMod, numLevels}).total;
		const optAvg = `Add average (+${avgTotal} HP)`;
		const ptConMod = conMod ? ` ${conMod > 0 ? "+" : "−"} ${Math.abs(conMod)} per level` : "";
		const optRoll = `Roll ${numLevels}d${faces}${ptConMod}`;
		const optSkip = "Enter manually / skip";

		const choice = await InputUiUtil.pGetUserEnum({
			values: [optAvg, optRoll, optSkip],
			isResolveItem: true,
			title: `Level up to ${newLevel}${numLevels > 1 ? ` (+${numLevels} levels)` : ""}`,
			placeholder: "How do you want to gain HP?",
		});
		if (choice == null || choice === optSkip) return;

		const gained = choice === optRoll
			? getLevelUpHp({faces, conMod, numLevels, fnRoll: f => Math.floor(Math.random() * f) + 1}).total
			: avgTotal;

		this._comp._state.hpMax = (Number(this._comp._state.hpMax) || 0) + gained;
		this._comp._state.hpCur = (Number(this._comp._state.hpCur) || 0) + gained;
		JqueryUtil.doToast({type: "success", content: `Gained ${gained} HP (now level ${newLevel}).`});
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

	/* -------------------------------------------- DOM scaffolding -------------------------------------------- */

	_buildAbilities () {
		const wrp = document.getElementById("cs-abilities");
		wrp.innerHTML = CHAR_SHEET_ABILITIES
			.map(([abv, name]) => `
				<div class="cs__ability" data-cs-ability="${abv}">
					<span class="cs__lbl cs__ability-name">${name}</span>
					<input type="number" id="cs-abil-${abv}" min="1" max="30" class="ve-form-control ve-input-xs cs__ability-score">
					<span class="cs__ability-mod cs__roll" id="cs-mod-${abv}">+0</span>
				</div>
			`)
			.join("");

		CHAR_SHEET_ABILITIES.forEach(([abv]) => this._bindIptNum(`cs-abil-${abv}`, `abil_${abv}`));
	}

	_buildSaves () {
		const wrp = document.getElementById("cs-saves");
		wrp.innerHTML = CHAR_SHEET_ABILITIES
			.map(([abv, name]) => `
				<label class="cs__list-row" title="Toggle proficiency in ${name} saving throws">
					<input type="checkbox" id="cs-save-${abv}" class="cs__list-cb">
					<span class="cs__roll cs__list-mod" id="cs-saveroll-${abv}">+0</span>
					<span class="cs__list-name">${name}</span>
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
					<span class="cs__list-name">${skill.name} <span class="cs__list-abil ve-muted">(${Parser.attAbvToFull(skill.ability).slice(0, 3)})</span></span>
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

	/* -------------------------------------------- Input binding -------------------------------------------- */

	_bindInputs () {
		CharacterSheetPage._IPT_STR_BINDINGS.forEach(([id, prop]) => this._bindIptStr(id, prop));
		CharacterSheetPage._IPT_NUM_BINDINGS.forEach(([id, prop]) => this._bindIptNum(id, prop));
		this._bindCb("cs-inspiration", "inspiration");
	}

	_bindIptStr (id, prop) {
		const ele = document.getElementById(id);
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
		ele.addEventListener("change", () => this._comp._state[prop] = ele.checked);

		const hook = () => ele.checked = !!this._comp._state[prop];
		this._comp._addHookBase(prop, hook);
		this._fnsSyncInput.push(hook);
		hook();
	}

	/* -------------------------------------------- Controls -------------------------------------------- */

	_bindStaticControls () {
		document.getElementById("cs-btn-wizard").addEventListener("click", () => this._pOnWizard());

		document.getElementById("cs-attack-add").addEventListener("click", () => this._comp.addAttack());

		document.getElementById("cs-hp-damage").addEventListener("click", () => this._adjustHp(-1));
		document.getElementById("cs-hp-heal").addEventListener("click", () => this._adjustHp(1));

		document.getElementById("cs-btn-save").addEventListener("click", () => this._onSaveToFile());
		document.getElementById("cs-btn-load").addEventListener("click", () => this._onLoadFromFile());
		document.getElementById("cs-btn-print").addEventListener("click", () => window.print());
		document.getElementById("cs-btn-reset").addEventListener("click", () => this._onReset());
	}

	_adjustHp (sign) {
		// The delta input is transient UI, not character state, so it is not model-bound
		const eleDelta = document.getElementById("cs-hp-delta");
		const delta = Math.abs(Number(eleDelta.value) || 0);
		if (!delta) return;
		this._comp._state.hpCur = (Number(this._comp._state.hpCur) || 0) + (sign * delta);
		eleDelta.value = "0";
	}

	/* -------------------------------------------- Data pickers -------------------------------------------- */

	_bindDataPickers () {
		document.getElementById("cs-pick-species").addEventListener("click", () => this._onPickSpecies());
		document.getElementById("cs-pick-background").addEventListener("click", () => this._onPickBackground());
		document.getElementById("cs-pick-class").addEventListener("click", () => this._onPickClass());
		document.getElementById("cs-attack-add-weapon").addEventListener("click", () => this._onPickWeapon());
		// The spell picker is bound by the spells panel
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

	async _onPickSpecies () {
		const doc = await SearchWidget.pGetUserRaceSearch();
		if (!doc) return;
		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
		this._comp.applyPickedRace({doc, ent});
		if (ent) await this._pOfferAbilityBonuses(ent, doc.n);
	}

	async _onPickBackground () {
		const doc = await SearchWidget.pGetUserBackgroundSearch();
		if (!doc) return;
		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
		this._comp.applyPickedBackground({doc, ent});
		if (ent) await this._pOfferAbilityBonuses(ent, doc.n);
	}

	/**
	 * After a standalone pick: offer to apply fixed ability bonuses (opt-in, since the sheet's
	 * scores are final values), and note choose-based increases for manual resolution.
	 * The wizard flow applies both automatically instead.
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
			if (isApply) this._comp.applyAbilityBonuses(fixed);
		}

		getAbilityChoices({ability: ent.ability, sourceName: name}).forEach(choice => {
			// Single package: describe only the unresolved choose part (fixed was offered above);
			// alternative packages: describe the whole choice
			const ptChoose = choice.packages.length === 1
				? getAbilityPackageDisplay({...choice.packages[0], fixed: {}})
				: choice.label.replace(/^Ability scores: choose /, "");
			if (!ptChoose) return;
			this._comp.appendToTextProp("proficienciesText", `Ability Scores (${name}): ${ptChoose} — assign manually`);
		});
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

	async _onPickWeapon () {
		const doc = await SearchWidget.pGetUserItemSearch();
		if (!doc) return;
		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
		this._comp.addAttack(this._weaponToAttack(ent || {}, doc.n));
	}

	_weaponToAttack (item, name) {
		const state = this._comp._getState();
		const pb = getProfBonus(state);
		const typeAbv = String(item.type || "").split("|")[0];
		const props = (item.property || []).map(p => String(p).split("|")[0]);
		const isFinesse = props.includes("F");
		const isRanged = typeAbv === "R";

		let abv = "str";
		if (isRanged) abv = "dex";
		else if (isFinesse) abv = getAbilityModifier(state, "dex") > getAbilityModifier(state, "str") ? "dex" : "str";
		const abilMod = getAbilityModifier(state, abv);

		let damage = "";
		if (item.dmg1) {
			const dmgType = item.dmgType ? ` ${Parser.dmgTypeToFull(item.dmgType)}` : "";
			const modStr = abilMod === 0 ? "" : (abilMod > 0 ? `+${abilMod}` : `${abilMod}`);
			damage = `${item.dmg1}${modStr}${dmgType}`;
		}

		return {name: name || item.name || "", atkBonus: abilMod + pb, damage};
	}

	/* -------------------------------------------- Derived rendering -------------------------------------------- */

	static fmtBonus (n) { return `${n >= 0 ? "+" : "−"}${Math.abs(n)}`; }

	_renderRoll (id, mod, name) {
		const ele = document.getElementById(id);
		if (!ele) return;
		ele.innerHTML = Renderer.get().render(`{@d20 ${mod}|${CharacterSheetPage.fmtBonus(mod)}|${name}}`);
	}

	_renderDerived () {
		const derived = deriveCharacterSheet(this._comp._getState());

		document.getElementById("cs-pb").textContent = CharacterSheetPage.fmtBonus(derived.pb);

		CHAR_SHEET_ABILITIES.forEach(([abv, name]) => {
			this._renderRoll(`cs-mod-${abv}`, derived.abilities[abv].mod, `${name} check`);
			this._renderRoll(`cs-saveroll-${abv}`, derived.saves[abv].mod, `${name} save`);
		});

		CHAR_SHEET_SKILLS.forEach(skill => {
			const {mod, profState} = derived.skills[skill.key];
			this._renderRoll(`cs-skillroll-${skill.key}`, mod, skill.name);

			const btn = document.getElementById(`cs-skillprof-${skill.key}`);
			btn.classList.toggle("cs__prof--1", profState === 1);
			btn.classList.toggle("cs__prof--2", profState === 2);
		});

		document.getElementById("cs-passive-perception").textContent = `${derived.passivePerception}`;

		document.getElementById("cs-initiative-roll").innerHTML = Renderer.get().render(`{@initiative ${derived.initiative}|${CharacterSheetPage.fmtBonus(derived.initiative)}}`);

		const eleDc = document.getElementById("cs-spell-dc");
		const eleAtk = document.getElementById("cs-spell-atk");
		if (derived.spell) {
			eleDc.textContent = `${derived.spell.dc}`;
			eleAtk.innerHTML = Renderer.get().render(`{@d20 ${derived.spell.atkMod}|${CharacterSheetPage.fmtBonus(derived.spell.atkMod)}|Spell attack}`);
		} else {
			eleDc.textContent = "—";
			eleAtk.textContent = "—";
		}
	}

	/* -------------------------------------------- Persistence & characters -------------------------------------------- */

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
		StorageUtil.syncSetForPage(CharacterSheetPage._STORAGE_KEY, this._store);
		this._renderCharacterSelect();
	}

	_renderCharacterSelect () {
		const sel = document.getElementById("cs-char-select");
		sel.innerHTML = Object.entries(this._store.characters)
			.map(([id, envelope]) => `<option value="${id.qq()}">${getCharacterLabel(id === this._store.currentId ? this._comp.getSaveableState() : envelope).qq()}</option>`)
			.join("");
		sel.value = this._store.currentId;
	}

	_bindCharacterSwitcher () {
		const sel = document.getElementById("cs-char-select");
		sel.addEventListener("change", () => this._switchCharacter(sel.value));

		document.getElementById("cs-char-new").addEventListener("click", () => {
			this._persistNow();
			const id = CryptUtil.uid();
			this._store.characters[id] = null;
			this._switchCharacter(id);
		});

		document.getElementById("cs-char-delete").addEventListener("click", () => this._onDeleteCharacter());
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
		if (!this._comp._state.attacks.length) this._comp.addAttack();
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
		if (!Object.keys(this._store.characters).length) this._store.characters[CryptUtil.uid()] = null;
		this._switchCharacter(Object.keys(this._store.characters)[0], {isSkipPersist: true});
	}

	/* -------------------------------------------- Toolbar actions -------------------------------------------- */

	_onSaveToFile () {
		const name = (this._comp._state.name || "character").trim() || "character";
		DataUtil.userDownload(Parser.stringToSlug(name) || "character", this._comp.getSaveableState(), {fileType: CharacterSheetPage._FILE_TYPE});
	}

	async _onLoadFromFile () {
		const {jsons, errors} = await InputUiUtil.pGetUserUploadJson({expectedFileTypes: [CharacterSheetPage._FILE_TYPE]});
		DataUtil.doHandleFileLoadErrorsGeneric(errors);
		if (!jsons?.length) return;
		this._doLoadState(jsons[0]);
		this._saveStateDebounced();
	}

	async _onReset () {
		if (!await InputUiUtil.pGetUserBoolean({
			title: "Reset Character Sheet",
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
		if (!this._comp._state.attacks.length) this._comp.addAttack();
		this._doRenderAll();
		this._persistNow();
	}
}

window.addEventListener("load", () => {
	const page = new CharacterSheetPage();
	page.init();
});

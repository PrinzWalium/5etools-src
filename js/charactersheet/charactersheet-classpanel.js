import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {
	checkFeatPrerequisites,
	getAsiCount,
	getCantripsKnown,
	getExpertiseSkillCount,
	getMulticlassRequirementsDisplay,
	getOptionalFeatureCounts,
	getPreparedSpellsDisplay,
	getSpellcastingMeta,
	getSpellsKnown,
	isMulticlassRequirementMet,
} from "./charactersheet-levelengine.js";
import {CHAR_SHEET_ABILITIES, CHAR_SHEET_SKILLS, PROF_STATE_EXPERTISE, PROF_STATE_PROFICIENT} from "./charactersheet-consts.js";
import {getAbilityPackages, getFixedAbilityBonuses, getProfListDisplay} from "./charactersheet-choices.js";

/**
 * The "Class & Leveling" sheet panel: renders the derived feature timeline, subclass and
 * optional-feature choices, and spell slots for the model's structured classes.
 * Re-renders whenever the `classes` collection changes.
 */
export class CharacterClassPanel {
	constructor ({comp, wrp}) {
		this._comp = comp;
		this._wrp = wrp;
		this._renderToken = 0;
	}

	init () {
		this._comp._addHookBase("classes", () => this._pRender());
		// Expertise options depend on which skills are proficient, so refresh that section when skills change.
		CHAR_SHEET_SKILLS.forEach(({key}) => this._comp._addHookBase(`skill_${key}`, () => this._refreshExpertise()));
		this._pRender();
	}

	/* -------------------------------------------- Tag helpers -------------------------------------------- */

	static _getClassFeatureTag (feature) {
		const {className, classSource, level} = feature;
		const {name, source} = CharacterSheetClassData.getFeatureNameMeta(feature);
		if (!name) return null;
		const ptSource = source && source !== classSource ? `|${source}` : "";
		return `{@classFeature ${name}|${className}${classSource !== Parser.SRC_PHB ? `|${classSource}` : "|"}|${level}${ptSource}}`;
	}

	static _getSubclassFeatureTag (feature) {
		const {className, classSource, subclassShortName, subclassSource, level} = feature;
		const {name, source} = CharacterSheetClassData.getFeatureNameMeta(feature);
		if (!name) return null;
		const ptSource = source && source !== subclassSource ? `|${source}` : "";
		return `{@subclassFeature ${name}|${className}${classSource !== Parser.SRC_PHB ? `|${classSource}` : "|"}|${subclassShortName}${subclassSource !== Parser.SRC_PHB ? `|${subclassSource}` : "|"}|${level}${ptSource}}`;
	}

	static _getOptionalFeatureTag ({name, source}) {
		return `{@optfeature ${name}${source !== Parser.SRC_PHB ? `|${source}` : ""}}`;
	}

	/* -------------------------------------------- Render -------------------------------------------- */

	async _pRender () {
		const token = ++this._renderToken;
		const entries = this._comp._state.classes;

		if (!entries.length) {
			this._wrp.innerHTML = `<div class="ve-muted ve-small">Pick a class (or use Guided Setup) to see features, choices, and spell slots by level.</div>`;
			return;
		}

		// Load entities up front; bail if a newer render superseded this one
		const loaded = [];
		for (const entry of entries) {
			const cls = await CharacterSheetClassData.pGetClass({name: entry.name, source: entry.source}).catch(() => null);
			const sc = entry.subclass
				? await CharacterSheetClassData.pGetSubclass({className: entry.name, classSource: entry.source, shortName: entry.subclass.shortName, source: entry.subclass.source})
				: null;
			loaded.push({entry, cls, sc});
		}
		if (token !== this._renderToken) return;

		this._loaded = loaded;
		this._wrp.innerHTML = "";
		loaded.forEach(meta => this._renderClassSection(meta));
		this._renderExpertise(loaded);
		this._renderSpellcasting(loaded);
		this._renderAddClass();
	}

	_renderClassSection ({entry, cls, sc}) {
		const wrp = document.createElement("div");
		wrp.className = "ve-mb-2";

		if (!cls) {
			wrp.innerHTML = `<div class="bold">${entry.name.qq()} ${entry.level}</div><div class="ve-muted ve-small">Class data not available (${entry.source.qq()}).</div>`;
			this._wrp.appendChild(wrp);
			return;
		}

		// Header: name, level input, remove button
		const wrpHead = document.createElement("div");
		wrpHead.className = "ve-flex-v-center ve-mb-1";
		wrpHead.innerHTML = `
			<span class="bold">${cls.name.qq()} <span class="ve-muted ve-small">(${Parser.sourceJsonToAbv(cls.source).qq()})</span></span>
			<label class="ve-flex-v-center ve-ml-auto"><span class="ve-small ve-muted ve-mr-1">Level</span><input type="number" min="1" max="20" value="${entry.level}" class="ve-form-control ve-input-xs cs__ipt-num cs__ipt-num--xs"></label>
		`;
		const iptLevel = wrpHead.querySelector("input");
		iptLevel.addEventListener("change", () => {
			this._comp.setClassEntryLevel(entry.id, Number(iptLevel.value));
		});
		if (this._comp._state.classes.length > 1) {
			const btnRm = document.createElement("button");
			btnRm.type = "button";
			btnRm.className = "ve-btn ve-btn-xxs ve-btn-danger ve-ml-1 no-print";
			btnRm.title = "Remove class";
			btnRm.innerHTML = `<span class="glyphicon glyphicon-trash"></span>`;
			btnRm.addEventListener("click", () => this._comp.removeClassEntry(entry.id));
			wrpHead.appendChild(btnRm);
		}
		wrp.appendChild(wrpHead);

		this._renderSubclassRow({wrp, entry, cls});
		this._renderOptionalFeatureRows({wrp, entry, cls, sc});
		this._renderAsiFeatRow({wrp, entry, cls});
		this._renderFeatureTimeline({wrp, entry, cls, sc});

		this._wrp.appendChild(wrp);
	}

	/* -------------------------------------------- Expertise -------------------------------------------- */

	_getExpertiseTotal (loaded) {
		return (loaded || []).reduce((acc, {entry, cls}) => acc + (cls ? getExpertiseSkillCount(cls, entry.level) : 0), 0);
	}

	/** Render the Expertise chooser when the character's classes grant it (Rogue, Bard, ...). */
	_renderExpertise (loaded) {
		const total = this._getExpertiseTotal(loaded);
		this._wrpExpertise = null;
		if (!total) return;

		const wrp = document.createElement("div");
		wrp.className = "cs__panel ve-mb-2";
		this._wrpExpertise = wrp;
		this._wrp.appendChild(wrp);
		this._fillExpertise();
	}

	/** Re-fill just the Expertise section (called on skill-proficiency changes). */
	_refreshExpertise () {
		if (this._wrpExpertise?.isConnected) this._fillExpertise();
	}

	_fillExpertise () {
		const wrp = this._wrpExpertise;
		if (!wrp) return;
		const total = this._getExpertiseTotal(this._loaded);
		const proficient = CHAR_SHEET_SKILLS.filter(({key}) => (Number(this._comp._state[`skill_${key}`]) || 0) >= PROF_STATE_PROFICIENT);

		wrp.innerHTML = `<div class="ve-flex-v-center ve-mb-1"><span class="bold">Expertise</span> <span class="ve-muted ve-small ve-ml-1 cs__exp-count"></span></div>`;
		const dispCount = wrp.querySelector(".cs__exp-count");

		const renderCount = () => {
			const nChosen = CHAR_SHEET_SKILLS.filter(({key}) => Number(this._comp._state[`skill_${key}`]) === PROF_STATE_EXPERTISE).length;
			let cls = "ve-muted";
			let txt = `${nChosen}/${total} chosen`;
			if (nChosen > total) {
				cls = "ve-text-danger";
				txt = `${nChosen}/${total} chosen — more than your features grant`;
			} else if (nChosen < total) txt = `${nChosen}/${total} chosen — pick ${total - nChosen} more`;
			dispCount.className = `ve-small ve-ml-1 cs__exp-count ${cls}`;
			dispCount.textContent = txt;
		};

		if (!proficient.length) {
			wrp.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small">Gain skill proficiencies first, then mark up to ${total} as Expertise (double proficiency bonus).</div>`);
			renderCount();
			return;
		}

		const wrpOpts = document.createElement("div");
		wrpOpts.className = "ve-flex ve-flex-wrap";
		proficient.forEach(({key, name}) => {
			const lbl = document.createElement("label");
			lbl.className = "ve-flex-v-center ve-mr-3 ve-mb-1 ve-small";
			const cb = document.createElement("input");
			cb.type = "checkbox";
			cb.className = "ve-mr-1";
			cb.checked = Number(this._comp._state[`skill_${key}`]) === PROF_STATE_EXPERTISE;
			cb.addEventListener("change", () => {
				this._comp._state[`skill_${key}`] = cb.checked ? PROF_STATE_EXPERTISE : PROF_STATE_PROFICIENT;
			});
			const spn = document.createElement("span");
			spn.textContent = name;
			lbl.append(cb, spn);
			wrpOpts.appendChild(lbl);
		});
		wrp.appendChild(wrpOpts);
		wrp.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small ve-mt-1">Rogues may instead apply Expertise to thieves' tools &mdash; note that under Proficiencies.</div>`);
		renderCount();
	}

	/* -------------------------------------------- Subclass -------------------------------------------- */

	static _getSubclassGainLevel (cls) {
		const ix = (cls.classFeatures || []).findIndex(lvlFeatures => (lvlFeatures || []).some(f => f.gainSubclassFeature));
		return ix < 0 ? null : ix + 1;
	}

	_renderSubclassRow ({wrp, entry, cls}) {
		const gainLevel = CharacterClassPanel._getSubclassGainLevel(cls);
		if (gainLevel == null) return;

		const title = cls.subclassTitle || "Subclass";
		const row = document.createElement("div");
		row.className = "ve-small ve-mb-1";

		if (entry.subclass) {
			row.innerHTML = `<span class="ve-muted">${title.qq()}:</span> <span class="bold">${entry.subclass.name.qq()}</span> <span class="ve-muted">(${Parser.sourceJsonToAbv(entry.subclass.source).qq()})</span> `;
			const btnChange = document.createElement("button");
			btnChange.type = "button";
			btnChange.className = "ve-btn ve-btn-xxs ve-btn-default no-print";
			btnChange.textContent = "Change";
			btnChange.addEventListener("click", () => this._pOnChooseSubclass({entry, cls}));
			row.appendChild(btnChange);
		} else if (entry.level >= gainLevel) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "ve-btn ve-btn-xs ve-btn-primary no-print";
			btn.textContent = `Choose ${title}...`;
			btn.addEventListener("click", () => this._pOnChooseSubclass({entry, cls}));
			row.appendChild(btn);
		} else {
			row.innerHTML = `<span class="ve-muted">${title.qq()} unlocks at level ${gainLevel}</span>`;
		}

		wrp.appendChild(row);
	}

	async _pOnChooseSubclass ({entry, cls}) {
		const subclasses = await CharacterSheetClassData.pGetSubclassesForClass({className: cls.name, classSource: cls.source});
		if (!subclasses.length) return;
		const sc = await InputUiUtil.pGetUserEnum({
			values: subclasses,
			isResolveItem: true,
			fnDisplay: it => `${it.name} (${Parser.sourceJsonToAbv(it.source)})`,
			title: `Select ${cls.subclassTitle || "Subclass"}`,
			placeholder: "Select...",
		});
		if (sc == null) return;
		this._comp.setSubclassForClass(entry.id, sc);
	}

	/* -------------------------------------------- Optional features -------------------------------------------- */

	_renderOptionalFeatureRows ({wrp, entry, cls, sc}) {
		const progressions = [
			...getOptionalFeatureCounts(cls, entry.level),
			...(sc ? getOptionalFeatureCounts(sc, entry.level) : []),
		];
		if (!progressions.length) return;

		const chosen = entry.optionalFeatures || [];

		progressions.forEach(prog => {
			const chosenForProg = chosen.filter(it => it.progressionName === prog.name);
			const row = document.createElement("div");
			row.className = "ve-small ve-mb-1";

			const wrpLabel = document.createElement("span");
			wrpLabel.className = "ve-muted";
			wrpLabel.textContent = `${prog.name} (${chosenForProg.length}/${prog.count}): `;
			row.appendChild(wrpLabel);

			chosenForProg.forEach(feat => {
				const spn = document.createElement("span");
				spn.className = "ve-mr-1";
				spn.innerHTML = Renderer.get().render(CharacterClassPanel._getOptionalFeatureTag(feat));
				const btnRm = document.createElement("button");
				btnRm.type = "button";
				btnRm.className = "ve-btn ve-btn-xxs ve-btn-default no-print";
				btnRm.title = `Remove ${feat.name}`;
				btnRm.textContent = "×";
				btnRm.addEventListener("click", () => this._comp.removeOptionalFeatureForClass(entry.id, feat));
				spn.appendChild(btnRm);
				row.appendChild(spn);
			});

			if (chosenForProg.length < prog.count) {
				const btn = document.createElement("button");
				btn.type = "button";
				btn.className = "ve-btn ve-btn-xxs ve-btn-primary no-print";
				btn.textContent = `Choose...`;
				btn.addEventListener("click", () => this._pOnChooseOptionalFeature({entry, prog}));
				row.appendChild(btn);
			}

			wrp.appendChild(row);
		});
	}

	async _pOnChooseOptionalFeature ({entry, prog}) {
		const pool = (await CharacterSheetClassData.pGetOptionalFeaturesByTypes(prog.featureTypes))
			.filter(it => !(entry.optionalFeatures || []).some(ch => ch.name === it.name && ch.source === it.source));
		if (!pool.length) return;
		const feat = await InputUiUtil.pGetUserEnum({
			values: pool,
			isResolveItem: true,
			fnDisplay: it => `${it.name} (${Parser.sourceJsonToAbv(it.source)})`,
			title: `Select ${prog.name}`,
			placeholder: "Select...",
		});
		if (feat == null) return;
		this._comp.addOptionalFeatureForClass(entry.id, {name: feat.name, source: feat.source, progressionName: prog.name});
	}

	/* -------------------------------------------- ASI / feats -------------------------------------------- */

	_renderAsiFeatRow ({wrp, entry, cls}) {
		const total = getAsiCount(cls, entry.level);
		if (!total) return;
		const chosen = entry.asiFeatChoices || [];

		const row = document.createElement("div");
		row.className = "ve-small ve-mb-1";

		const lbl = document.createElement("span");
		lbl.className = "ve-muted";
		lbl.textContent = `ASI / Feats (${Math.min(chosen.length, total)}/${total}): `;
		row.appendChild(lbl);

		chosen.forEach(choice => {
			const spn = document.createElement("span");
			spn.className = "ve-mr-1";
			if (choice.type === "feat") {
				spn.innerHTML = Renderer.get().render(`{@feat ${choice.name}${choice.source !== Parser.SRC_PHB ? `|${choice.source}` : ""}}`);
			} else {
				spn.textContent = Object.entries(choice.bonuses || {}).map(([abv, n]) => `+${n} ${abv.toUpperCase()}`).join(" ");
			}
			const btnRm = document.createElement("button");
			btnRm.type = "button";
			btnRm.className = "ve-btn ve-btn-xxs ve-btn-default no-print ve-ml-1";
			btnRm.title = "Remove; ability score bonuses are reverted (other applied effects are kept)";
			btnRm.textContent = "×";
			btnRm.addEventListener("click", () => this._comp.removeAsiFeatChoice(entry.id, choice.id));
			spn.appendChild(btnRm);
			row.appendChild(spn);
		});

		if (chosen.length < total) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "ve-btn ve-btn-xxs ve-btn-primary no-print";
			btn.textContent = "Choose...";
			btn.addEventListener("click", () => this._pOnChooseAsiFeat({entry}));
			row.appendChild(btn);
		}

		wrp.appendChild(row);
	}

	/** Sequentially pick `count` distinct abilities from `from`; null on cancel. */
	async _pPickAbilities ({count, from, title}) {
		const out = [];
		for (let i = 0; i < count; ++i) {
			const remaining = from.filter(abv => !out.includes(abv));
			const abv = await InputUiUtil.pGetUserEnum({
				values: remaining,
				isResolveItem: true,
				fnDisplay: it => Parser.attAbvToFull(it),
				title: count > 1 ? `${title} (${i + 1} of ${count})` : title,
				placeholder: "Select an ability...",
			});
			if (abv == null) return null;
			out.push(abv);
		}
		return out;
	}

	async _pOnChooseAsiFeat ({entry}) {
		const mode = await InputUiUtil.pGetUserEnum({
			values: ["Ability Score Improvement", "Feat"],
			isResolveItem: true,
			title: "Ability Score Improvement or Feat?",
			placeholder: "Select...",
		});
		if (mode == null) return;

		if (mode === "Ability Score Improvement") return this._pOnChooseAsi({entry});
		return this._pOnChooseFeat({entry});
	}

	async _pOnChooseAsi ({entry}) {
		const allAbvs = CHAR_SHEET_ABILITIES.map(([abv]) => abv);
		const spread = await InputUiUtil.pGetUserEnum({
			values: ["+2 to one ability", "+1 to two abilities"],
			isResolveItem: true,
			title: "Ability Score Improvement",
			placeholder: "Select...",
		});
		if (spread == null) return;

		const isSingle = spread === "+2 to one ability";
		const picked = await this._pPickAbilities({count: isSingle ? 1 : 2, from: allAbvs, title: "Increase which ability?"});
		if (!picked) return;

		const bonuses = {};
		picked.forEach(abv => bonuses[abv] = (bonuses[abv] || 0) + (isSingle ? 2 : 1));
		this._comp.addAsiFeatChoice(entry.id, {type: "asi", bonuses});
	}

	/** Character context for checking feat (and multiclass) prerequisites. */
	_getFeatPrereqContext () {
		const state = this._comp._state;
		const abilityScores = Object.fromEntries(CHAR_SHEET_ABILITIES.map(([abv]) => [abv, Number(state[`abil_${abv}`]) || 10]));

		// Expand species name into matchable words so a base-race prereq ("elf") matches "Wood Elf"
		const raceNames = [];
		const speciesName = state.refSpecies?.name || state.speciesText;
		if (speciesName) {
			raceNames.push(speciesName);
			String(speciesName).replace(/\(.*?\)/g, " ").split(/[\s-]+/).forEach(w => { if (w) raceNames.push(w); });
		}

		const featNames = [];
		(state.classes || []).forEach(cls => (cls.asiFeatChoices || []).forEach(ch => { if (ch.type === "feat") featNames.push(ch.name); }));

		return {
			abilityScores,
			totalLevel: this._comp.getLevelNumber(),
			classes: (state.classes || []).map(c => ({name: c.name, level: c.level})),
			raceNames,
			backgroundName: state.refBackground?.name || state.backgroundText,
			featNames,
			isSpellcaster: !!state.spellAbility || (state.spellsKnown || []).length > 0,
		};
	}

	async _pOnChooseFeat ({entry}) {
		const feats = await CharacterSheetClassData.pGetAllFeats();
		const feat = await InputUiUtil.pGetUserEnum({
			values: feats,
			isResolveItem: true,
			fnDisplay: it => `${it.name} (${Parser.sourceJsonToAbv(it.source)})`,
			title: "Select Feat",
			placeholder: "Select a feat...",
		});
		if (feat == null) return;

		// Warn (do not block) when the character definitely does not meet the feat's prerequisites
		if (feat.prerequisite?.length) {
			const {status} = checkFeatPrerequisites(feat.prerequisite, this._getFeatPrereqContext());
			if (status === "unmet") {
				const ptPrereq = Renderer.utils.prerequisite.getHtml(feat.prerequisite, {isTextOnly: true, isSkipPrefix: true});
				const isContinue = await InputUiUtil.pGetUserBoolean({
					title: "Feat Prerequisites Not Met",
					htmlDescription: `<div>${feat.name.qq()} requires: ${(ptPrereq || "(see feat)").qq()}.<br>Take it anyway?</div>`,
					textYes: "Take Anyway",
					textNo: "Cancel",
				});
				if (!isContinue) return;
			}
		}

		// Resolve the feat's ability increases: fixed parts apply directly; choose-based parts prompt
		const bonuses = {...getFixedAbilityBonuses(feat.ability)};
		const packages = getAbilityPackages(feat.ability);
		if (packages.length === 1 && packages[0].choose) {
			const {from, count, amount} = packages[0].choose;
			const picked = await this._pPickAbilities({count, from, title: `${feat.name}: increase which ability?`});
			if (!picked) return;
			picked.forEach(abv => bonuses[abv] = (bonuses[abv] || 0) + amount);
		}

		this._applyFeatSecondaryGrants(feat);
		this._comp.addAsiFeatChoice(entry.id, {type: "feat", name: feat.name, source: feat.source, bonuses});
	}

	/** Apply a feat's non-ability structured grants: fixed skills, languages/tools/senses as notes. */
	_applyFeatSecondaryGrants (feat) {
		(feat.skillProficiencies || []).forEach(grp => {
			Object.entries(grp).forEach(([k, v]) => { if (v === true) this._comp.setSkillProfByName(k, 1); });
		});
		(feat.expertise || []).forEach(grp => {
			Object.entries(grp).forEach(([k, v]) => { if (v === true) this._comp.setSkillProfByName(k, 2); });
		});

		const pts = [];
		// Fixed skill/expertise grants were applied above; anything choice-shaped becomes a note
		const skillsNote = getProfListDisplay(feat.skillProficiencies).split(", ").filter(pt => /choice/i.test(pt)).join(", ");
		if (skillsNote) pts.push(`Skills: ${skillsNote}`);
		const expertiseNote = getProfListDisplay(feat.expertise).split(", ").filter(pt => /choice/i.test(pt)).join(", ");
		if (expertiseNote) pts.push(`Expertise: ${expertiseNote}`);
		const langs = getProfListDisplay(feat.languageProficiencies);
		if (langs) pts.push(`Languages: ${langs}`);
		const tools = getProfListDisplay(feat.toolProficiencies);
		if (tools) pts.push(`Tools: ${tools}`);
		if (pts.length) this._comp.appendToTextProp("proficienciesText", `${feat.name}: ${pts.join("; ")}`);
	}

	/* -------------------------------------------- Feature timeline -------------------------------------------- */

	_renderFeatureTimeline ({wrp, entry, cls, sc}) {
		const timeline = CharacterSheetClassData.getFeatureTimeline(cls, {subclass: sc, level: entry.level});
		if (!timeline.length) return;

		const byLevel = {};
		timeline.forEach(({level, feature, isSubclassFeature}) => {
			(byLevel[level] = byLevel[level] || []).push({feature, isSubclassFeature});
		});

		const details = document.createElement("details");
		details.open = true;
		details.innerHTML = `<summary class="ve-small ve-muted clickable">Features by level</summary>`;

		Object.entries(byLevel).forEach(([level, features]) => {
			const div = document.createElement("div");
			div.className = "ve-small";
			const tags = features
				.map(({feature, isSubclassFeature}) => isSubclassFeature
					? CharacterClassPanel._getSubclassFeatureTag(feature)
					: CharacterClassPanel._getClassFeatureTag(feature))
				.filter(Boolean)
				.join(", ");
			if (!tags) return;
			div.innerHTML = `<span class="ve-muted">L${level}:</span> ${Renderer.get().render(tags)}`;
			details.appendChild(div);
		});

		wrp.appendChild(details);
	}

	/* -------------------------------------------- Spellcasting -------------------------------------------- */

	_renderSpellcasting (loaded) {
		const meta = getSpellcastingMeta(loaded.map(({entry, cls, sc}) => ({cls, sc, level: entry.level})));
		if (!meta.slots && !meta.pact) return;

		const wrp = document.createElement("div");
		wrp.className = "ve-small ve-mt-2 ve-mb-1";

		const parts = [];
		if (meta.slots?.some(Boolean)) {
			const slotParts = meta.slots
				.map((cnt, i) => cnt ? `${Parser.spLevelToFull(i + 1)}: ${cnt}` : null)
				.filter(Boolean);
			parts.push(`<div><span class="bold">Spell Slots</span> <span class="ve-muted">(caster level ${meta.casterLevel})</span>: ${slotParts.join(" · ")}</div>`);
		}
		if (meta.pact) {
			parts.push(`<div><span class="bold">Pact Magic</span>: ${meta.pact.count} × ${Parser.spLevelToFull(meta.pact.level)}-level</div>`);
		}

		loaded.forEach(({entry, cls, sc}) => {
			const casterEnt = cls?.casterProgression ? cls : (sc?.casterProgression ? sc : (cls?.spellsKnownProgression || cls?.cantripProgression ? cls : null));
			if (!casterEnt) return;
			const bits = [];
			const cantrips = getCantripsKnown(casterEnt, entry.level);
			const known = getSpellsKnown(casterEnt, entry.level);
			const prepared = getPreparedSpellsDisplay(cls) || (sc ? getPreparedSpellsDisplay(sc) : null);
			if (cantrips != null) bits.push(`${cantrips} cantrips`);
			if (known != null) bits.push(`${known} spells known`);
			else if (prepared) bits.push(`prepares ${prepared}`);
			if (bits.length) parts.push(`<div class="ve-muted">${cls.name.qq()}: ${bits.join(", ")}</div>`);
		});

		wrp.innerHTML = parts.join("");
		this._wrp.appendChild(wrp);
	}

	/* -------------------------------------------- Multiclass -------------------------------------------- */

	_renderAddClass () {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "ve-btn ve-btn-xs ve-btn-default no-print";
		btn.innerHTML = `<span class="glyphicon glyphicon-plus"></span> Add Class (Multiclass)`;
		btn.addEventListener("click", () => this._pOnAddClass());
		this._wrp.appendChild(btn);
	}

	async _pOnAddClass () {
		const existing = this._comp._state.classes;
		const classes = (await CharacterSheetClassData.pGetAllClasses())
			.filter(cls => !existing.some(it => it.name === cls.name && it.source === cls.source));
		if (!classes.length) return;

		const cls = await InputUiUtil.pGetUserEnum({
			values: classes,
			isResolveItem: true,
			fnDisplay: it => `${it.name} (${Parser.sourceJsonToAbv(it.source)})`,
			title: "Add Class",
			placeholder: "Select a class...",
		});
		if (cls == null) return;

		// PHB multiclassing prerequisites; warn rather than block (tables allow house rules)
		const abilityScores = Object.fromEntries(CHAR_SHEET_ABILITIES.map(([abv]) => [abv, Number(this._comp._state[`abil_${abv}`]) || 10]));
		const reqs = cls.multiclassing?.requirements;
		if (reqs && !isMulticlassRequirementMet(reqs, abilityScores)) {
			const isContinue = await InputUiUtil.pGetUserBoolean({
				title: "Multiclass Prerequisites Not Met",
				htmlDescription: `<div>${cls.name.qq()} requires: ${getMulticlassRequirementsDisplay(reqs).qq()}.<br>Add it anyway?</div>`,
				textYes: "Add Anyway",
				textNo: "Cancel",
			});
			if (!isContinue) return;
		}

		this._comp.addClassEntry(cls, 1);
	}
}

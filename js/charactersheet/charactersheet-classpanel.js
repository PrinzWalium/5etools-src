import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {
	getCantripsKnown,
	getMulticlassRequirementsDisplay,
	getOptionalFeatureCounts,
	getPreparedSpellsDisplay,
	getSpellcastingMeta,
	getSpellsKnown,
	isMulticlassRequirementMet,
} from "./charactersheet-levelengine.js";
import {CHAR_SHEET_ABILITIES} from "./charactersheet-consts.js";

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

		this._wrp.innerHTML = "";
		loaded.forEach(meta => this._renderClassSection(meta));
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
		this._renderFeatureTimeline({wrp, entry, cls, sc});

		this._wrp.appendChild(wrp);
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

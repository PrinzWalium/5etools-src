import {CHAR_SHEET_ABILITIES, CHAR_SHEET_SCHEMA_VERSION, CHAR_SHEET_SKILLS, EXPENDABLE_RESOURCES, getSkillKeyByName} from "./charactersheet-consts.js";
import {getGrantedFeats, getProfListDisplay} from "./charactersheet-choices.js";
import {getClassProficiencies, getEntityProficiencies, getMulticlassProficiencies} from "./charactersheet-proficiencies.js";

/**
 * The character data model: single source of truth for the sheet.
 *
 * Rendering is one-directional (`state → DOM`); user input mutates this model, and `BaseComponent`
 * hooks drive re-renders. The DOM is never read back to determine character state.
 *
 * Numeric input-backed props are `number | null` (null = blank input). Free-text fields
 * (`featuresText`, `proficienciesText`, ...) are deliberately retained alongside the structured
 * fields as an overrides/notes escape hatch for homebrew and edge cases.
 */
export class CharacterModel extends BaseComponent {
	static _LEGACY_FIELD_TO_PROP_STR = {
		"cs-name": "name",
		"cs-playername": "playerName",
		"cs-classlevel": "classText",
		"cs-background": "backgroundText",
		"cs-species": "speciesText",
		"cs-alignment": "alignment",
		"cs-speed": "speed",
		"cs-hd-total": "hdTotal",
		"cs-hd-cur": "hdCur",
		"cs-spell-ability": "spellAbility",
		"cs-spells": "spellsText",
		"cs-features": "featuresText",
		"cs-equipment": "equipmentText",
		"cs-proficiencies": "proficienciesText",
		"cs-personality": "personalityText",
	};

	static _LEGACY_FIELD_TO_PROP_NUM = {
		"cs-xp": "xp",
		"cs-ac": "ac",
		"cs-hp-max": "hpMax",
		"cs-hp-cur": "hpCur",
		"cs-hp-temp": "hpTemp",
		"cs-cp": "cp",
		"cs-sp": "sp",
		"cs-ep": "ep",
		"cs-gp": "gp",
		"cs-pp": "pp",
	};

	constructor () {
		super();
		// Keep the single-class level in sync with the manual level field until true multiclass UI exists (Phase 2)
		this._addHookBase("level", () => this._syncSingleClassLevel());
	}

	_getDefaultState () {
		const out = {
			name: "",
			playerName: "",
			alignment: "",
			xp: null,

			classText: "",
			backgroundText: "",
			speciesText: "",

			// Structured entity references, populated by the pickers; the `*Text` fields above remain
			// free-text overrides
			refSpecies: null, // {name, source, tag}
			refBackground: null, // {name, source, tag}
			classes: [], // [{id, name, source, level, hdFaces, subclass: null | {name, shortName, source}}]
			pickTags: {}, // {species, background, class} → renderable `{@...}` tags for the header links

			level: 1,
			ac: 10, // manual AC (used when acMode === "manual")
			acMode: "auto", // "auto" | "barbarian" | "monk" | "manual"
			acMisc: 0, // flat misc bonus added to computed AC
			initMisc: 0,
			speed: "30 ft.",

			hpMax: 0,
			hpCur: 0,
			hpTemp: 0,
			hdTotal: "",
			hdCur: "",

			deathSuccess: 0,
			deathFail: 0,
			inspiration: false,

			conditions: [], // active condition names
			exhaustion: 0, // 0–6
			concentration: "", // what the character is concentrating on
			hpPolicy: "ask", // "ask" | "average" | "max" | "roll" — how the level-up prompt gains HP

			attacks: [], // [{id, name, atkBonus, damage}]
			inventory: [], // [{id, name, source, quantity, weightLb}]
			weaponMasteries: [], // inventory weapon names whose mastery property is active
			originFeats: [], // [{id, name, source, bonuses}] — feats granted by a 2024 background
			featureFeats: [], // [{id, entryId, featureKey, category, name, source, bonuses}] — feats a class feature grants (Fighting Style, Epic Boon, ...)
			manualFeats: [], // [{id, name, source, note, bonuses}] — feats granted outside the rules (training, story rewards)

			spellAbility: "",
			spellsText: "",
			spellsKnown: [], // [{id, name, source, level}]
			grantedSpellChoices: [], // [{id, grantKey, name, source, level}] — picks for `additionalSpells` {choose} grants
			slotsUsed: {}, // {"1": n, ..., "9": n, pact: n}
			resourcesUsed: {}, // {resourceLabel: n} — expended class resources (Rages, Ki, Wild Shape, ...)
			sourceFilter: {mode: "all", sources: {}}, // which books this character may pick content from
			abilityBonusLog: [], // [{id, source, bonuses}] — provenance for ability-score increases
			proficiencies: [], // [{id, kind, name, source}] — armor/weapon/tool/language, with what granted each

			featuresText: "",
			equipmentText: "",
			proficienciesText: "",
			personalityText: "",

			cp: 0,
			sp: 0,
			ep: 0,
			gp: 0,
			pp: 0,
		};

		CHAR_SHEET_ABILITIES.forEach(([abv]) => {
			out[`abil_${abv}`] = 10;
			out[`save_${abv}`] = false;
		});
		CHAR_SHEET_SKILLS.forEach(({key}) => out[`skill_${key}`] = 0);

		return out;
	}

	getLevelNumber () {
		return Math.min(20, Math.max(1, Number(this._state.level) || 1));
	}

	/* -------------------------------------------- Mutators -------------------------------------------- */

	addAttack (data = {}) {
		this._state.attacks = [
			...this._state.attacks,
			{
				id: CryptUtil.uid(),
				name: data.name || "",
				atkBonus: data.atkBonus != null ? Number(data.atkBonus) : 0,
				damage: data.damage || "",
				// Kept so a row derived from a weapon can explain where its numbers came from
				atkParts: data.atkParts || null,
				damageParts: data.damageParts || null,
			},
		];
	}

	updateAttack (id, data) {
		const atk = this._state.attacks.find(it => it.id === id);
		if (!atk) return;
		Object.assign(atk, data);
		this._triggerCollectionUpdate("attacks");
	}

	removeAttack (id) {
		this._state.attacks = this._state.attacks.filter(it => it.id !== id);
	}

	setPickTag (which, tag) {
		this._state.pickTags = {...this._state.pickTags, [which]: tag};
	}

	/* -------------------------------------------- Inventory -------------------------------------------- */

	/** Add an item; stacking onto an existing row when name/source match. Extra fields (armor/weapon
	 *  metadata from `getInventoryItemMeta`) are stored on the row for AC/attack derivation. */
	addInventoryItem ({name, source, quantity = 1, weightLb = null, ...meta}) {
		const existing = this._state.inventory.find(it => it.name === name && it.source === source);
		if (existing) {
			existing.quantity = (Number(existing.quantity) || 0) + quantity;
			this._triggerCollectionUpdate("inventory");
			return;
		}
		this._state.inventory = [
			...this._state.inventory,
			{id: CryptUtil.uid(), name, source, quantity, weightLb, equipped: false, attuned: false, ...meta},
		];
	}

	updateInventoryItem (id, data) {
		const item = this._state.inventory.find(it => it.id === id);
		if (!item) return;
		Object.assign(item, data);
		this._triggerCollectionUpdate("inventory");
	}

	removeInventoryItem (id) {
		this._state.inventory = this._state.inventory.filter(it => it.id !== id);
	}

	/* -------------------------------------------- Spells -------------------------------------------- */

	/** @return `false` if the spell was already known (for that class) */
	addKnownSpell ({name, source, level, className = null, ritual = false, castTime = null}) {
		if (this._state.spellsKnown.some(it => it.name === name && it.source === source && (it.className || null) === (className || null))) return false;
		this._state.spellsKnown = [
			...this._state.spellsKnown,
			{id: CryptUtil.uid(), name, source, level: Number(level) || 0, className, ritual: !!ritual, castTime},
		];
		return true;
	}

	removeKnownSpell (id) {
		this._state.spellsKnown = this._state.spellsKnown.filter(it => it.id !== id);
	}

	/** Record a pick for a dynamic `additionalSpells` {choose} grant, scoped to that grant. */
	addGrantedSpellChoice ({grantKey, name, source, level, className = null}) {
		const cur = this._state.grantedSpellChoices || [];
		if (cur.some(it => it.grantKey === grantKey && it.name === name && it.source === source)) return false;
		this._state.grantedSpellChoices = [...cur, {id: CryptUtil.uid(), grantKey, name, source, level: Number(level) || 0, className}];
		return true;
	}

	removeGrantedSpellChoice (id) {
		this._state.grantedSpellChoices = (this._state.grantedSpellChoices || []).filter(it => it.id !== id);
	}

	/**
	 * Replace the known/prepared spells attributed to `className` with `spells`
	 * (each `{name, source, level, ritual}`), preserving spells of other classes and
	 * the ids of any that are retained. Used by the class-filtered spell manager.
	 */
	setKnownSpellsForClass (className, spells) {
		const key = className || null;
		const others = this._state.spellsKnown.filter(it => (it.className || null) !== key);
		const existingById = new Map(this._state.spellsKnown
			.filter(it => (it.className || null) === key)
			.map(it => [`${it.name}|${it.source}`, it.id]));
		const forClass = spells.map(sp => ({
			id: existingById.get(`${sp.name}|${sp.source}`) || CryptUtil.uid(),
			name: sp.name,
			source: sp.source,
			level: Number(sp.level) || 0,
			className: key,
			ritual: !!sp.ritual,
			castTime: sp.castTime ?? null,
		}));
		this._state.spellsKnown = [...others, ...forClass];
	}

	/** Set the number of expended slots for a spell level (1-9) or "pact". */
	/** Record a background-granted origin feat and apply its ability bonuses (no duplicates by name/source). */
	addOriginFeat ({name, source, displayName = null, bonuses = null}) {
		if (this._state.originFeats.some(it => it.name === name && it.source === source)) return false;
		const id = CryptUtil.uid();
		this._state.originFeats = [...this._state.originFeats, {id, name, source, displayName: displayName || name, bonuses}];
		if (bonuses) this.applyAbilityBonuses(bonuses, {source: `${displayName || name} (feat)`, logId: id});
		return true;
	}

	removeOriginFeat (id) {
		const feat = this._state.originFeats.find(it => it.id === id);
		if (!feat) return;
		if (feat.bonuses) this.applyAbilityBonuses(feat.bonuses, {isRevert: true, logId: id});
		this._state.originFeats = this._state.originFeats.filter(it => it.id !== id);
	}

	/** Record a feat granted by a class feature (Fighting Style, Epic Boon, ...), scoped to that feature occurrence. */
	addFeatureFeat ({entryId, featureKey, category, name, source, bonuses = null}) {
		if (this._state.featureFeats.some(it => it.entryId === entryId && it.featureKey === featureKey && it.name === name && it.source === source)) return false;
		const id = CryptUtil.uid();
		this._state.featureFeats = [...this._state.featureFeats, {id, entryId, featureKey, category, name, source, bonuses}];
		if (bonuses) this.applyAbilityBonuses(bonuses, {source: `${name} (feat)`, logId: id});
		return true;
	}

	removeFeatureFeat (id) {
		const feat = this._state.featureFeats.find(it => it.id === id);
		if (!feat) return;
		if (feat.bonuses) this.applyAbilityBonuses(feat.bonuses, {isRevert: true, logId: id});
		this._state.featureFeats = this._state.featureFeats.filter(it => it.id !== id);
	}

	/**
	 * Record a feat granted outside the normal progression — a DM award for training or a story
	 * beat. Kept separate from ASI-slot feats so it never consumes a slot the character has earned.
	 */
	addManualFeat ({name, source, note = "", bonuses = null}) {
		const cur = this._state.manualFeats || [];
		if (cur.some(it => it.name === name && it.source === source)) return false;
		const id = CryptUtil.uid();
		this._state.manualFeats = [...cur, {id, name, source, note, bonuses}];
		if (bonuses) this.applyAbilityBonuses(bonuses, {source: `${name} (feat)`, logId: id});
		return true;
	}

	removeManualFeat (id) {
		const feat = (this._state.manualFeats || []).find(it => it.id === id);
		if (!feat) return;
		if (feat.bonuses) this.applyAbilityBonuses(feat.bonuses, {isRevert: true, logId: id});
		this._state.manualFeats = this._state.manualFeats.filter(it => it.id !== id);
	}

	setManualFeatNote (id, note) {
		const feat = (this._state.manualFeats || []).find(it => it.id === id);
		if (!feat) return;
		feat.note = note;
		this._triggerCollectionUpdate("manualFeats");
	}

	/* -------------------------------------------- Proficiencies -------------------------------------------- */

	/**
	 * Record armor/weapon/tool/language proficiencies granted by a source. Re-applying the same
	 * source replaces its previous grants, so re-picking a class or background does not duplicate
	 * them and dropping one removes exactly what it gave.
	 */
	setProficienciesFromSource (source, entries) {
		const kept = (this._state.proficiencies || []).filter(it => it.source !== source);
		const added = (entries || [])
			.filter(it => it?.name)
			.map(it => ({id: CryptUtil.uid(), kind: it.kind, name: it.name, source, isOptional: !!it.isOptional}));
		this._state.proficiencies = [...kept, ...added];
	}

	/** Add a single proficiency (a resolved choice, or one added by hand). */
	addProficiency ({kind, name, source}) {
		if (!name) return false;
		const cur = this._state.proficiencies || [];
		if (cur.some(it => it.kind === kind && it.name.toLowerCase() === name.toLowerCase() && it.source === source)) return false;
		this._state.proficiencies = [...cur, {id: CryptUtil.uid(), kind, name, source, isOptional: false}];
		return true;
	}

	removeProficiency (id) {
		this._state.proficiencies = (this._state.proficiencies || []).filter(it => it.id !== id);
	}

	/** Toggle an owned weapon's mastery as active. */
	toggleWeaponMastery (name) {
		const set = new Set(this._state.weaponMasteries || []);
		if (set.has(name)) set.delete(name);
		else set.add(name);
		this._state.weaponMasteries = [...set];
	}

	/* -------------------------------------------- Rests & conditions -------------------------------------------- */

	/** Toggle a named condition on/off. */
	toggleCondition (name) {
		const set = new Set(this._state.conditions || []);
		if (set.has(name)) set.delete(name);
		else set.add(name);
		this._state.conditions = [...set];
	}

	/**
	 * A long rest: restore HP to max, clear temporary HP and all spell slots, restore Hit Dice and
	 * death saves, drop concentration, and reduce Exhaustion by one.
	 */
	longRest () {
		this._state.hpCur = Number(this._state.hpMax) || 0;
		this._state.hpTemp = 0;
		this._state.slotsUsed = {};
		this._state.resourcesUsed = {}; // a long rest restores every class resource
		if (this._state.hdTotal) this._state.hdCur = this._state.hdTotal;
		this._state.deathSuccess = 0;
		this._state.deathFail = 0;
		this._state.concentration = "";
		this._state.exhaustion = Math.max(0, (Number(this._state.exhaustion) || 0) - 1);
	}

	/** A short rest: restore Pact Magic slots (Warlock) and short-rest class resources (Ki, Wild Shape, ...). */
	shortRest () {
		this._state.slotsUsed = {...this._state.slotsUsed, pact: 0};
		const used = {...this._state.resourcesUsed};
		Object.keys(used).forEach(label => { if (EXPENDABLE_RESOURCES[label] === "short") used[label] = 0; });
		this._state.resourcesUsed = used;
	}

	/** Replace this character's source filter (which books its pickers offer). */
	setSourceFilter (filter) {
		this._state.sourceFilter = {mode: filter?.mode || "all", sources: {...(filter?.sources || {})}};
	}

	/** Set expended uses of a named class resource (Rages, Ki Points, Wild Shape, ...). */
	setResourceUsed (label, n) {
		this._state.resourcesUsed = {...this._state.resourcesUsed, [label]: Math.max(0, Number(n) || 0)};
	}

	setSlotsUsed (level, count) {
		this._state.slotsUsed = {...this._state.slotsUsed, [level]: Math.max(0, Number(count) || 0)};
	}

	appendToTextProp (prop, text) {
		if (!text) return;
		const cur = (this._state[prop] || "").trim();
		if (cur.includes(text)) return;
		this._state[prop] = cur ? `${cur}\n${text}` : text;
	}

	/** Set a skill's proficiency state by data name (e.g. "animal handling"), never downgrading. */
	setSkillProfByName (name, val) {
		const key = getSkillKeyByName(name);
		if (!key) return;
		const prop = `skill_${key}`;
		this._state[prop] = Math.max(Number(this._state[prop]) || 0, val);
	}

	/* -------------------------------------------- Entity application -------------------------------------------- */

	/** Apply a picked species/race: search doc bookkeeping + mechanical fields from the entity. */
	applyPickedRace ({doc, ent}) {
		this._state.speciesText = doc.n;
		this._state.refSpecies = {name: doc.n, source: doc.source, tag: doc.tag};
		this.setPickTag("species", doc.tag);
		if (ent) this.applyRaceData(ent);
	}

	// Trait entries that are boilerplate rather than named features worth surfacing
	static _RACE_TRAIT_NAMES_IGNORED = new Set(["Age", "Size", "Speed", "Languages", "Alignment", "Ability Score Increase", "Creature Type", "Darkvision"]);

	applyRaceData (race) {
		const speed = race.speed;
		let spd = null;
		if (typeof speed === "number") spd = speed;
		else if (speed && typeof speed === "object" && typeof speed.walk === "number") spd = speed.walk;
		if (spd != null) this._state.speed = `${spd} ft.`;

		(race.skillProficiencies || []).forEach(grp => {
			Object.entries(grp).forEach(([k, v]) => { if (v === true) this.setSkillProfByName(k, 1); });
		});

		this.setProficienciesFromSource(race.name, getEntityProficiencies(race));

		if (race.darkvision) this.appendToTextProp("proficienciesText", `Senses: Darkvision ${race.darkvision} ft.`);

		[["resist", "Resistances"], ["immune", "Immunities"], ["vulnerable", "Vulnerabilities"], ["conditionImmune", "Condition Immunities"]]
			.forEach(([prop, label]) => {
				const vals = (race[prop] || []).filter(it => typeof it === "string");
				if (vals.length) this.appendToTextProp("proficienciesText", `${label}: ${vals.join(", ")}`);
			});

		const traitNames = (race.entries || [])
			.filter(it => it && typeof it === "object" && it.name && !CharacterModel._RACE_TRAIT_NAMES_IGNORED.has(it.name))
			.map(it => it.name);
		if (traitNames.length) this.appendToTextProp("featuresText", `${race.name} Traits: ${traitNames.join(", ")}`);
	}

	/**
	 * Add (or, with `isRevert`, subtract) a `{abv: n}` bonus map to the ability scores.
	 *
	 * Scores are stored as final values, so pass a `source` to record where an increase came from —
	 * that log is what lets the sheet explain a score ("15 base, +2 Species, +1 Feat"). Reverting with
	 * the same `logId` removes the entry again.
	 */
	applyAbilityBonuses (bonuses, {isRevert = false, source = null, logId = null} = {}) {
		Object.entries(bonuses || {}).forEach(([abv, n]) => {
			const prop = `abil_${abv}`;
			if (!(prop in this.__state)) return;
			const cur = Number(this._state[prop]) || 10;
			this._state[prop] = cur + (isRevert ? -n : n);
		});

		const log = this._state.abilityBonusLog || [];
		if (isRevert) {
			if (logId) this._state.abilityBonusLog = log.filter(it => it.id !== logId);
			return;
		}
		if (!source || !Object.keys(bonuses || {}).length) return;
		this._state.abilityBonusLog = [...log, {id: logId || CryptUtil.uid(), source, bonuses: {...bonuses}}];
	}

	/** Apply a picked background: search doc bookkeeping + mechanical fields from the entity. */
	applyPickedBackground ({doc, ent, isFixedOnly = false}) {
		this._state.backgroundText = doc.n;
		this._state.refBackground = {name: doc.n, source: doc.source, tag: doc.tag};
		this.setPickTag("background", doc.tag);
		if (ent) this.applyBackgroundData(ent, {isFixedOnly});
	}

	/** @param [opts.isFixedOnly] Skip "N of your choice" display entries (when a choice queue resolves them separately). */
	applyBackgroundData (bg, {isFixedOnly = false} = {}) {
		(bg.skillProficiencies || []).forEach(grp => {
			Object.entries(grp).forEach(([k, v]) => { if (v === true) this.setSkillProfByName(k, 1); });
		});
		this.setProficienciesFromSource(bg.name, getEntityProficiencies(bg));

		// Outright grants are stored structurally above; only the unresolved "N of your choice" ones
		// need a note, and even those are skipped when the caller resolves them interactively.
		const tools = isFixedOnly ? "" : getProfListDisplay(bg.toolProficiencies, {isChoiceOnly: true});
		const langs = isFixedOnly ? "" : getProfListDisplay(bg.languageProficiencies, {isChoiceOnly: true});
		const parts = [];
		if (tools) parts.push(`Tools: ${tools}`);
		if (langs) parts.push(`Languages: ${langs}`);
		if (parts.length) this.appendToTextProp("proficienciesText", parts.join("\n"));

		// 2024-style backgrounds grant a feat directly
		getGrantedFeats(bg.feats)
			.forEach(feat => this.appendToTextProp("featuresText", `Feat: ${feat.displayName} (${Parser.sourceJsonToAbv(feat.source)})`));
	}

	/** Apply a picked class at a given level: display text, tag, structured entry, and mechanical fields. */
	applyPickedClass (cls, level) {
		this._state.classText = `${cls.name} ${level}`;
		this.setPickTag("class", `{@class ${cls.name}${cls.source !== Parser.SRC_PHB ? `|${cls.source}` : ""}}`);
		this.setSingleClass(cls);

		if (cls.hd && cls.hd.faces) this._state.hdTotal = `${level}d${cls.hd.faces}`;
		(cls.proficiency || []).forEach(abv => this._state[`save_${abv}`] = true);
		if (cls.spellcastingAbility) this._state.spellAbility = cls.spellcastingAbility;
	}

	/** Set the (single) primary class from picked class data, replacing any existing classes. */
	setSingleClass (cls) {
		// Dropping the other classes drops the proficiencies they granted with them
		this._state.classes
			.filter(it => it.name !== cls.name)
			.forEach(it => this.setProficienciesFromSource(it.name, []));
		this.setProficienciesFromSource(cls.name, getClassProficiencies(cls));

		const existing = this._state.classes.length === 1 ? this._state.classes[0] : null;
		const isSameClass = existing && existing.name === cls.name && existing.source === cls.source;
		this._state.classes = [{
			id: CryptUtil.uid(),
			name: cls.name,
			source: cls.source,
			level: this.getLevelNumber(),
			hdFaces: cls.hd?.faces ?? null,
			// Re-picking the same class (e.g. to refresh level) keeps its subclass/feature choices
			subclass: isSameClass ? existing.subclass : null,
			optionalFeatures: isSameClass ? (existing.optionalFeatures || []) : [],
			asiFeatChoices: isSameClass ? (existing.asiFeatChoices || []) : [],
		}];
	}

	/** Add an additional (multiclass) class entry. */
	addClassEntry (cls, level) {
		// Multiclassing grants only a subset of the class's starting proficiencies
		this.setProficienciesFromSource(cls.name, getMulticlassProficiencies(cls));

		this._state.classes = [
			...this._state.classes,
			{
				id: CryptUtil.uid(),
				name: cls.name,
				source: cls.source,
				level: Math.min(20, Math.max(1, Number(level) || 1)),
				hdFaces: cls.hd?.faces ?? null,
				subclass: null,
				optionalFeatures: [],
				asiFeatChoices: [],
			},
		];
		this._syncDisplayFromClasses();
	}

	removeClassEntry (id) {
		const entry = this._state.classes.find(it => it.id === id);
		if (entry) this.setProficienciesFromSource(entry.name, []);
		this._state.classes = this._state.classes.filter(it => it.id !== id);
		this._syncDisplayFromClasses();
	}

	setClassEntryLevel (id, level) {
		const entry = this._state.classes.find(it => it.id === id);
		if (!entry) return;
		entry.level = Math.min(20, Math.max(1, Number(level) || 1));
		this._triggerCollectionUpdate("classes");
		this._syncDisplayFromClasses();
	}

	setSubclassForClass (id, subclass) {
		const entry = this._state.classes.find(it => it.id === id);
		if (!entry) return;
		entry.subclass = subclass ? {name: subclass.name, shortName: subclass.shortName, source: subclass.source} : null;
		this._triggerCollectionUpdate("classes");
	}

	addOptionalFeatureForClass (id, {name, source, progressionName}) {
		const entry = this._state.classes.find(it => it.id === id);
		if (!entry) return;
		entry.optionalFeatures = entry.optionalFeatures || [];
		if (entry.optionalFeatures.some(it => it.name === name && it.source === source)) return;
		entry.optionalFeatures.push({name, source, progressionName});
		this._triggerCollectionUpdate("classes");
	}

	removeOptionalFeatureForClass (id, {name, source}) {
		const entry = this._state.classes.find(it => it.id === id);
		if (!entry?.optionalFeatures) return;
		entry.optionalFeatures = entry.optionalFeatures.filter(it => !(it.name === name && it.source === source));
		this._triggerCollectionUpdate("classes");
	}

	/**
	 * Record an Ability Score Improvement-slot choice for a class: either an ASI
	 * (`{type: "asi", bonuses}`) or a feat (`{type: "feat", name, source, bonuses}`).
	 * Ability bonuses are applied now and reverted if the choice is removed.
	 */
	addAsiFeatChoice (classId, choice) {
		const entry = this._state.classes.find(it => it.id === classId);
		if (!entry) return;
		entry.asiFeatChoices = entry.asiFeatChoices || [];
		const id = CryptUtil.uid();
		entry.asiFeatChoices.push({id, ...choice});
		if (choice.bonuses) {
			const label = choice.type === "feat" ? `${choice.name} (feat)` : "Ability Score Improvement";
			this.applyAbilityBonuses(choice.bonuses, {source: label, logId: id});
		}
		this._triggerCollectionUpdate("classes");
	}

	removeAsiFeatChoice (classId, choiceId) {
		const entry = this._state.classes.find(it => it.id === classId);
		if (!entry?.asiFeatChoices) return;
		const choice = entry.asiFeatChoices.find(it => it.id === choiceId);
		if (!choice) return;
		if (choice.bonuses) this.applyAbilityBonuses(choice.bonuses, {isRevert: true, logId: choiceId});
		entry.asiFeatChoices = entry.asiFeatChoices.filter(it => it.id !== choiceId);
		this._triggerCollectionUpdate("classes");
	}

	/** Update the display fields (class text, total level, hit dice) after structural class changes. */
	_syncDisplayFromClasses () {
		const classes = this._state.classes;
		if (!classes.length) return;

		this._state.classText = classes.map(it => `${it.name} ${it.level}`).join(" / ");
		this._state.level = Math.min(20, classes.reduce((acc, it) => acc + (Number(it.level) || 0), 0));

		const byFaces = {};
		classes.forEach(it => {
			if (!it.hdFaces) return;
			byFaces[it.hdFaces] = (byFaces[it.hdFaces] || 0) + (Number(it.level) || 0);
		});
		const hd = Object.entries(byFaces).map(([faces, cnt]) => `${cnt}d${faces}`).join(" + ");
		if (hd) this._state.hdTotal = hd;
	}

	_syncSingleClassLevel () {
		const classes = this._state.classes;
		if (!classes.length) return;

		if (classes.length === 1 && classes[0].level !== this.getLevelNumber()) {
			classes[0].level = this.getLevelNumber();
			this._triggerCollectionUpdate("classes");
		}

		// With multiple classes the total is derived from per-class levels; this also refreshes
		// the class text and hit dice displays (equal-value assignments are no-ops, so no loops)
		this._syncDisplayFromClasses();
	}

	/* -------------------------------------------- Persistence -------------------------------------------- */

	getSaveableState () {
		return {
			version: CHAR_SHEET_SCHEMA_VERSION,
			...this.getBaseSaveableState(),
		};
	}

	/** @return `true` if the state was recognised and applied */
	setStateFrom (saved) {
		if (!saved || typeof saved !== "object") return false;
		const migrated = this.constructor.getMigratedState(saved);
		if (!migrated) return false;
		this._setState({...this._getDefaultState(), ...migrated.state});
		return true;
	}

	/**
	 * Migrate a saved state envelope to the current schema version.
	 * Version 1 (implicit; no `version` key) stored raw DOM values keyed by element ID.
	 */
	static getMigratedState (saved) {
		if (saved.version == null && saved.fields) return {version: CHAR_SHEET_SCHEMA_VERSION, state: this._getStateFromLegacy(saved)};
		if (saved.version === CHAR_SHEET_SCHEMA_VERSION && saved.state) return saved;
		return null;
	}

	static _getNumOrNull (val) {
		if (val == null || `${val}`.trim() === "") return null;
		const num = Number(val);
		return isNaN(num) ? null : num;
	}

	static _getStateFromLegacy (legacy) {
		const state = {};

		Object.entries(this._LEGACY_FIELD_TO_PROP_STR).forEach(([fieldId, prop]) => {
			const val = legacy.fields?.[fieldId];
			if (val != null) state[prop] = `${val}`;
		});

		Object.entries(this._LEGACY_FIELD_TO_PROP_NUM).forEach(([fieldId, prop]) => {
			const val = legacy.fields?.[fieldId];
			if (val != null) state[prop] = this._getNumOrNull(val);
		});

		state.level = Math.min(20, Math.max(1, Number(legacy.fields?.["cs-level"]) || 1));
		state.initMisc = Number(legacy.fields?.["cs-init-misc"]) || 0;

		CHAR_SHEET_ABILITIES.forEach(([abv]) => {
			const score = Number(legacy.fields?.[`cs-abil-${abv}`]);
			if (!isNaN(score) && score) state[`abil_${abv}`] = score;
			state[`save_${abv}`] = !!legacy.saves?.[abv];
		});

		CHAR_SHEET_SKILLS.forEach(({key}) => {
			state[`skill_${key}`] = Math.min(2, Math.max(0, Number(legacy.skills?.[key]) || 0));
		});

		state.inspiration = !!legacy.inspiration;
		state.deathSuccess = Math.min(3, Math.max(0, Number(legacy.deathSuccess) || 0));
		state.deathFail = Math.min(3, Math.max(0, Number(legacy.deathFail) || 0));

		if (legacy.pickTags && typeof legacy.pickTags === "object") state.pickTags = {...legacy.pickTags};

		state.attacks = (Array.isArray(legacy.attacks) ? legacy.attacks : [])
			.map(atk => ({
				id: CryptUtil.uid(),
				name: atk.name || "",
				atkBonus: Number(atk.atkBonus) || 0,
				damage: atk.damage || "",
			}));

		return state;
	}
}

import {CHAR_SHEET_ABILITIES, CHAR_SHEET_SCHEMA_VERSION, CHAR_SHEET_SKILLS} from "./charactersheet-consts.js";

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
			ac: 10,
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

			attacks: [], // [{id, name, atkBonus, damage}]

			spellAbility: "",
			spellsText: "",

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

	appendToTextProp (prop, text) {
		if (!text) return;
		const cur = (this._state[prop] || "").trim();
		if (cur.includes(text)) return;
		this._state[prop] = cur ? `${cur}\n${text}` : text;
	}

	/** Set the (single) class from picked class data. Multiclass support arrives with the leveling engine. */
	setSingleClass (cls) {
		this._state.classes = [{
			id: CryptUtil.uid(),
			name: cls.name,
			source: cls.source,
			level: this.getLevelNumber(),
			hdFaces: cls.hd?.faces ?? null,
			subclass: null,
		}];
	}

	_syncSingleClassLevel () {
		if (this._state.classes.length !== 1) return;
		const cls = this._state.classes[0];
		if (cls.level === this.getLevelNumber()) return;
		cls.level = this.getLevelNumber();
		this._triggerCollectionUpdate("classes");
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

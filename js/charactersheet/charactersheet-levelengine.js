/**
 * The leveling engine: pure rules derivation from class/subclass entities.
 *
 * Everything here reads the class data (`classTableGroups`/`rowsSpellProgression`,
 * `cantripProgression`, `spellsKnownProgression`, `casterProgression`,
 * `optionalfeatureProgression`, `multiclassing`) rather than hardcoding per-class rules.
 * The one deliberate exception is the PHB multiclass spellcaster slot table, which is a
 * fixed core rule, not per-class data.
 *
 * All functions are deterministic and side-effect-free; class/subclass entities are inputs.
 */

/** PHB multiclass spellcaster table: combined caster level → slots per spell level (1st–9th). */
export const MULTICLASS_SLOT_TABLE = [
	[2, 0, 0, 0, 0, 0, 0, 0, 0],
	[3, 0, 0, 0, 0, 0, 0, 0, 0],
	[4, 2, 0, 0, 0, 0, 0, 0, 0],
	[4, 3, 0, 0, 0, 0, 0, 0, 0],
	[4, 3, 2, 0, 0, 0, 0, 0, 0],
	[4, 3, 3, 0, 0, 0, 0, 0, 0],
	[4, 3, 3, 1, 0, 0, 0, 0, 0],
	[4, 3, 3, 2, 0, 0, 0, 0, 0],
	[4, 3, 3, 3, 1, 0, 0, 0, 0],
	[4, 3, 3, 3, 2, 0, 0, 0, 0],
	[4, 3, 3, 3, 2, 1, 0, 0, 0],
	[4, 3, 3, 3, 2, 1, 0, 0, 0],
	[4, 3, 3, 3, 2, 1, 1, 0, 0],
	[4, 3, 3, 3, 2, 1, 1, 0, 0],
	[4, 3, 3, 3, 2, 1, 1, 1, 0],
	[4, 3, 3, 3, 2, 1, 1, 1, 0],
	[4, 3, 3, 3, 2, 1, 1, 1, 1],
	[4, 3, 3, 3, 3, 1, 1, 1, 1],
	[4, 3, 3, 3, 3, 2, 1, 1, 1],
	[4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const _clampLevel = level => Math.min(20, Math.max(1, Number(level) || 1));

/**
 * A class's contribution to combined multiclass caster level (PHB p.164; artificer rounds up).
 * Pact magic does not contribute; its slots stack separately.
 */
export function getCasterLevelContribution (casterProgression, level) {
	level = _clampLevel(level);
	switch (casterProgression) {
		case "full": return level;
		case "1/2": return Math.floor(level / 2);
		case "1/3": return Math.floor(level / 3);
		case "artificer": return Math.ceil(level / 2);
		default: return 0;
	}
}

const _getTableGroups = clsOrSc => clsOrSc?.classTableGroups || clsOrSc?.subclassTableGroups || [];

/**
 * Spell slots at `level` from an entity's own class/subclass table (`rowsSpellProgression`).
 * @return {?Array<number>} Slots per spell level (1st–9th, zero-padded), or null if the entity has no slot table.
 */
export function getSingleClassSlots (clsOrSc, level) {
	level = _clampLevel(level);
	const group = _getTableGroups(clsOrSc).find(g => g.rowsSpellProgression);
	if (!group) return null;
	const row = group.rowsSpellProgression[level - 1];
	if (!row) return null;
	return [...new Array(9)].map((_, i) => Number(row[i]) || 0);
}

// Matches e.g. "{@filter 3rd|spells|...}" → "3rd"; the engine avoids a renderer dependency
const _stripTags = str => String(str).replace(/\{@\w+ ([^|}]+)[^}]*\}/g, "$1");

/**
 * Pact Magic slots at `level`, parsed from the "Spell Slots"/"Slot Level" table columns.
 * @return {?{count: number, level: number}}
 */
export function getPactSlots (cls, level) {
	if (cls?.casterProgression !== "pact") return null;
	level = _clampLevel(level);
	for (const group of _getTableGroups(cls)) {
		if (!group.colLabels || !group.rows) continue;
		const labels = group.colLabels.map(l => _stripTags(l).trim().toLowerCase());
		const ixCount = labels.indexOf("spell slots");
		const ixSlotLevel = labels.indexOf("slot level");
		if (ixCount < 0 || ixSlotLevel < 0) continue;
		const row = group.rows[level - 1];
		if (!row) return null;
		const slotLevel = Number(_stripTags(row[ixSlotLevel]).replace(/\D/g, ""));
		return {count: Number(row[ixCount]) || 0, level: slotLevel || 0};
	}
	return null;
}

/** Read a per-level progression array (e.g. `cantripProgression`) off a class or its subclass. */
const _getProgressionValue = (clsOrSc, prop, level) => {
	const arr = clsOrSc?.[prop];
	if (!arr) return null;
	return arr[_clampLevel(level) - 1] ?? null;
};

export function getCantripsKnown (clsOrSc, level) { return _getProgressionValue(clsOrSc, "cantripProgression", level); }
export function getSpellsKnown (clsOrSc, level) { return _getProgressionValue(clsOrSc, "spellsKnownProgression", level); }

/** Human-readable form of a `preparedSpells` formula, e.g. "<$level$> + <$wis_mod$>" → "class level + WIS modifier". */
export function getPreparedSpellsDisplay (cls) {
	if (!cls?.preparedSpells) return null;
	return cls.preparedSpells
		.replace(/<\$level\$>/g, "class level")
		.replace(/<\$(\w{3})_mod\$>/g, (_, abv) => `${abv.toUpperCase()} modifier`);
}

/**
 * Combined spellcasting for a set of leveled classes.
 * @param classEntries [{cls, sc, level}] — class entity, optional subclass entity, class level
 * @return {{slots: ?Array<number>, casterLevel: number, pact: ?{count: number, level: number}, casters: Array}}
 */
export function getSpellcastingMeta (classEntries) {
	const casters = [];
	let pact = null;

	classEntries.forEach(({cls, sc, level}) => {
		const pactSlots = getPactSlots(cls, level);
		if (pactSlots) {
			// Multiple pact classes stack their levels (rare, homebrew); recompute off the summed level
			pact = pact
				? getPactSlots(cls, _clampLevel(level + pact._srcLevel))
				: pactSlots;
			if (pact) pact._srcLevel = level;
			return;
		}

		const casterEnt = cls?.casterProgression ? cls : (sc?.casterProgression ? sc : null);
		if (!casterEnt) return;
		casters.push({
			ent: casterEnt,
			cls,
			level,
			contribution: getCasterLevelContribution(casterEnt.casterProgression, level),
		});
	});

	if (pact) delete pact._srcLevel;

	const casterLevel = casters.reduce((acc, c) => acc + c.contribution, 0);

	let slots = null;
	if (casters.length === 1) {
		// Single (non-pact) caster: use its own class/subclass table, which handles
		// e.g. paladin's "no slots at level 1" and artificer's rounding natively
		slots = getSingleClassSlots(casters[0].ent, casters[0].level);
	} else if (casters.length > 1 && casterLevel > 0) {
		slots = [...MULTICLASS_SLOT_TABLE[_clampLevel(casterLevel) - 1]];
	}

	return {slots, casterLevel, pact, casters};
}

/**
 * Cumulative optional-feature picks (Fighting Styles, Invocations, Maneuvers, ...) available at `level`.
 * Reads `optionalfeatureProgression`, whose `progression` is either a 20-entry array of cumulative
 * counts or a `{level: cumulativeCount}` object.
 * @return {Array<{name: string, featureTypes: Array<string>, count: number}>}
 */
export function getOptionalFeatureCounts (clsOrSc, level) {
	level = _clampLevel(level);
	return (clsOrSc?.optionalfeatureProgression || [])
		.map(({name, featureType, progression}) => {
			let count = 0;
			if (Array.isArray(progression)) count = Number(progression[level - 1]) || 0;
			else {
				Object.entries(progression || {}).forEach(([lvl, cnt]) => {
					if (Number(lvl) <= level) count = Math.max(count, Number(cnt) || 0);
				});
			}
			return {name, featureTypes: featureType || [], count};
		})
		.filter(it => it.count > 0);
}

/**
 * Check multiclassing ability requirements. Top-level ability keys are all required; keys within
 * an object inside `or` are alternatives (e.g. Fighter's `{or: [{str: 13, dex: 13}]}` means
 * "Strength 13 or Dexterity 13"), matching how the site renders these (see `render-class.js`).
 * @param requirements The class's `multiclassing.requirements`
 * @param abilityScores `{str: n, dex: n, ...}`
 */
export function isMulticlassRequirementMet (requirements, abilityScores) {
	if (!requirements) return true;
	const getScore = abv => Number(abilityScores?.[abv]) || 0;
	return Object.entries(requirements).every(([k, v]) => {
		if (k === "or") return v.every(grp => Object.entries(grp).some(([abv, min]) => getScore(abv) >= min));
		if (typeof v !== "number") return true; // ignore non-ability keys (e.g. "entries")
		return getScore(k) >= v;
	});
}

/** Display form of multiclass requirements, e.g. "Strength 13 or Dexterity 13". */
export function getMulticlassRequirementsDisplay (requirements) {
	if (!requirements) return "";
	const renderGrp = (obj, joiner) => Object.entries(obj)
		.filter(([, v]) => typeof v === "number")
		.map(([abv, min]) => `${Parser.attAbvToFull(abv)} ${min}`)
		.join(joiner);
	const orPart = (requirements.or || []).map(grp => renderGrp(grp, " or ")).join("; ");
	const basePart = renderGrp(requirements, ", ");
	return [orPart, basePart].filter(Boolean).join("; ");
}

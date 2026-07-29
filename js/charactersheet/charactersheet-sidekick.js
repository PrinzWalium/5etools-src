/**
 * Sidekick rules (Tasha's, "Sidekicks").
 *
 * A sidekick is a *creature* with a low challenge rating that gains levels in one of three simple
 * classes — Expert, Spellcaster or Warrior. So a sidekick is modelled as an ordinary character
 * whose "class" is a sidekick class and whose starting point is a stat block rather than a species
 * and background: the stat block seeds the ability scores, AC, hit points, speed, senses and skills,
 * and everything after that is the normal leveling machinery.
 *
 * Everything here is intentionally permissive — this is a DM's tool, so the seeded values are a
 * starting point to be edited, not a rule to be enforced.
 *
 * Kept DOM-free and dependency-free so it can be unit-tested.
 */

export const SIDEKICK_CLASS_SOURCE = "TCE";
export const SIDEKICK_CLASS_NAMES = ["Expert Sidekick", "Spellcaster Sidekick", "Warrior Sidekick"];

/** The rules text to show alongside the builder, as a `{@variantrule}` the renderer can resolve. */
export const SIDEKICK_RULE_UID = "Sidekicks|TCE";

/** Sizes to the hit die a creature of that size uses, when its stat block does not say. */
const _SIZE_TO_HIT_DIE = {T: 4, S: 6, M: 8, L: 10, H: 12, G: 20};

/**
 * The hit die a sidekick gains per level. The stat block states it in its hit-point formula
 * ("2d8 + 2" → d8); size is the fallback for a stat block that gives a flat number.
 * @return {number|null} The die's number of faces.
 */
export function getSidekickHitDie (creature) {
	const formula = creature?.hp?.formula;
	const mFormula = formula ? /\d*d(\d+)/i.exec(formula) : null;
	if (mFormula) return Number(mFormula[1]);

	const size = Array.isArray(creature?.size) ? creature.size[0] : creature?.size;
	return _SIZE_TO_HIT_DIE[size] || null;
}

/** Armor Class from a stat block's `ac` array, which mixes plain numbers and `{ac, from}` objects. */
export function getCreatureAc (creature) {
	const first = (creature?.ac || [])[0];
	if (first == null) return null;
	return typeof first === "object" ? (Number(first.ac) || null) : (Number(first) || null);
}

/** Walking speed in feet, as a display string ("30 ft."). */
export function getCreatureSpeed (creature) {
	const speed = creature?.speed;
	if (speed == null) return "";
	if (typeof speed === "number") return `${speed} ft.`;
	const parts = [];
	Object.entries(speed).forEach(([mode, val]) => {
		const n = typeof val === "object" ? val.number : val;
		if (typeof n !== "number") return;
		parts.push(mode === "walk" ? `${n} ft.` : `${mode} ${n} ft.`);
	});
	return parts.join(", ");
}

const _ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

/**
 * Which skills the stat block is proficient in. A stat block lists final bonuses ("+4"), so a
 * listed bonus above the bare ability modifier means proficiency — and roughly double proficiency
 * means expertise. A guess, but a good one, and the sheet lets it be corrected.
 * @return {Object} `{skillName: 1 | 2}`
 */
export function getCreatureSkillProficiencies (creature, {proficiencyBonus = 2} = {}) {
	const out = {};
	const skills = creature?.skill || {};

	Object.entries(skills).forEach(([name, val]) => {
		if (name === "other") return;
		const bonus = Number(String(val).replace(/[^-\d]/g, ""));
		if (isNaN(bonus)) return;
		out[name.toLowerCase()] = bonus >= proficiencyBonus * 2 ? 2 : 1;
	});

	return out;
}

/** Saving throws the stat block is proficient in, as ability abbreviations. */
export function getCreatureSaveProficiencies (creature) {
	return Object.keys(creature?.save || {})
		.map(it => it.toLowerCase())
		.filter(it => _ABILITIES.includes(it));
}

/** A stat block's senses and languages, as the sheet's free text. */
export function getCreatureSensesText (creature) {
	const parts = [...(creature?.senses || [])];
	if (creature?.passive != null) parts.push(`passive Perception ${creature.passive}`);
	return parts.join(", ");
}

export function getCreatureLanguagesText (creature) {
	return (creature?.languages || []).join(", ");
}

/**
 * Everything a stat block contributes to a new sidekick. The caller applies it to the model; what
 * is not covered here (traits, actions, the prose) is rendered from the creature itself.
 *
 * @return {{abilities: Object, ac: number|null, hpMax: number|null, speed: string, hitDie: number|null,
 *   skills: Object, saves: string[], sensesText: string, languagesText: string, sizeType: string}}
 */
export function getSidekickSeed (creature, {proficiencyBonus = 2} = {}) {
	const abilities = {};
	_ABILITIES.forEach(abv => {
		const score = creature?.[abv];
		if (typeof score === "number") abilities[abv] = score;
	});

	return {
		abilities,
		ac: getCreatureAc(creature),
		hpMax: creature?.hp?.average ?? null,
		speed: getCreatureSpeed(creature),
		hitDie: getSidekickHitDie(creature),
		skills: getCreatureSkillProficiencies(creature, {proficiencyBonus}),
		saves: getCreatureSaveProficiencies(creature),
		sensesText: getCreatureSensesText(creature),
		languagesText: getCreatureLanguagesText(creature),
		sizeType: getCreatureSizeTypeText(creature),
	};
}

/** "Medium humanoid (any race)" — the line under a stat block's name. */
export function getCreatureSizeTypeText (creature) {
	const sizes = {T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan"};
	const size = Array.isArray(creature?.size) ? creature.size[0] : creature?.size;
	const type = creature?.type;
	const typeStr = typeof type === "object" ? [type.type, type.tags?.length ? `(${type.tags.map(t => typeof t === "object" ? t.tag : t).join(", ")})` : null].filter(Boolean).join(" ") : type;
	return [sizes[size] || size, typeStr].filter(Boolean).join(" ");
}

/**
 * A sidekick's expected hit points at a level: the stat block's own hit points, then the average of
 * its hit die plus its Constitution modifier for every level after the first. A suggestion for the
 * DM, who is free to type something else.
 */
export function getSidekickExpectedHp ({baseHp, hitDie, conMod = 0, level = 1}) {
	if (!hitDie || baseHp == null) return null;
	const perLevel = Math.max(1, Math.floor(hitDie / 2) + 1 + conMod);
	return Number(baseHp) + perLevel * Math.max(0, (Number(level) || 1) - 1);
}

/** The proficiency bonus at a sidekick level — the same progression a character uses. */
export function getSidekickProficiencyBonus (level) {
	return 2 + Math.floor((Math.max(1, Math.min(20, Number(level) || 1)) - 1) / 4);
}

/**
 * A sidekick class's features by level, for the "what happens as this sidekick levels" table.
 * Reads the class's `classFeatures` refs ("Name|Class|Source|Level"), so it stays correct when the
 * data changes.
 * @return {Array<{level: number, features: string[], pb: number}>} One row per level, 1–20.
 */
export function getSidekickLevelTable (cls) {
	const byLevel = new Map();
	const add = (level, name) => {
		// The "Sidekick Class" note is editorial boilerplate, not a feature the sidekick gains
		if (!name || !level || name === "Sidekick Class") return;
		if (!byLevel.has(level)) byLevel.set(level, []);
		if (!byLevel.get(level).includes(name)) byLevel.get(level).push(name);
	};

	(cls?.classFeatures || []).forEach((entry, ix) => {
		// A class straight from the JSON holds refs ("Name|Class|Source|Level"); one loaded through
		// the DataLoader has them dereferenced into a by-level array of feature objects. Both appear
		// depending on the caller, so read either.
		if (Array.isArray(entry)) {
			entry.forEach(feature => add(feature?.level ?? ix + 1, feature?.name));
			return;
		}
		if (entry && typeof entry === "object" && !entry.classFeature) {
			add(entry.level, entry.name);
			return;
		}
		const str = typeof entry === "string" ? entry : entry?.classFeature;
		if (!str) return;
		const parts = str.split("|");
		add(Number(parts[3]), parts[0]);
	});

	return Array.from({length: 20}, (_, i) => {
		const level = i + 1;
		return {level, pb: getSidekickProficiencyBonus(level), features: byLevel.get(level) || []};
	});
}

const _ATTACK_KINDS = {mw: "Melee Weapon Attack", rw: "Ranged Weapon Attack", ms: "Melee Spell Attack", rs: "Ranged Spell Attack"};

/** Flatten an entry tree to plain text, keeping a tag's display text. */
function _entryToText (entry) {
	if (typeof entry === "string") {
		return entry
			// Argument-less tags that stand for a word
			.replace(/\{@h}/g, "Hit: ")
			.replace(/\{@atk\s+([^{}]*)}/g, (_, kinds) => `${kinds.split(",").map(k => _ATTACK_KINDS[k.trim()] || k.trim()).join(" or ")}:`)
			.replace(/\{@(\w+)\s+([^{}]*)}/g, (_, tag, inner) => {
				const parts = inner.split("|");
				if (tag.toLowerCase() === "filter") return parts[0];
				if (parts.length >= 3) return parts[2];
				return parts[0];
			});
	}
	if (Array.isArray(entry)) return entry.map(_entryToText).filter(Boolean).join(" ");
	if (entry && typeof entry === "object") {
		const body = _entryToText(entry.entries || entry.entry || []);
		return entry.name ? `${entry.name}. ${body}` : body;
	}
	return "";
}

/**
 * A stat block's traits and actions as readable notes, so the DM has the creature's own abilities
 * on the sheet next to whatever its sidekick class adds. Deliberately text: these are for reading
 * and editing, not for deriving numbers from.
 */
export function getCreatureFeatureText (creature) {
	const sections = [
		["Traits", creature?.trait],
		["Actions", creature?.action],
		["Bonus Actions", creature?.bonus],
		["Reactions", creature?.reaction],
	];

	return sections
		.filter(([, entries]) => entries?.length)
		.map(([label, entries]) => `${label}:\n${entries.map(it => `  ${_entryToText(it)}`).join("\n")}`)
		.join("\n\n");
}

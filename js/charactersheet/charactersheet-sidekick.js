/**
 * Sidekick rules — both published rulesets, because they answer different questions.
 *
 * **Essentials Kit** (the default here): a sidekick is one of three ready-made stat blocks — Expert,
 * Spellcaster or Warrior — and levels 2–6 are a fixed table giving an exact hit-point maximum and one
 * or two named features per level. The Spellcaster and Warrior each pick a *role* (healer/mage,
 * attacker/defender) that decides which of their stat block's entries apply. All of that is
 * structured data (`bestiary-esk.json` + the `Sidekicks|ESK` rule), so the builder reads it rather
 * than restating it.
 *
 * **Tasha's**: a sidekick is any low-CR creature that takes levels 1–20 in a sidekick *class*. That
 * path is the ordinary leveling machinery, so it stays available for a sidekick beyond 6th level.
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
export const SIDEKICK_ESK_RULE_UID = "Sidekicks|ESK";

/**
 * The three Essentials Kit sidekicks, and the stat block each one starts from. The blurbs are the
 * book's own one-line descriptions.
 */
export const ESK_SIDEKICK_TYPES = [
	{key: "expert", name: "Expert", source: "ESK", blurb: "an agile and exceedingly helpful jack of all trades"},
	{key: "spellcaster", name: "Spellcaster", source: "ESK", blurb: "a magic-user who can harm your foes or heal you and your friends"},
	{key: "warrior", name: "Warrior", source: "ESK", blurb: "a martial companion who specializes in striking your foes or defending your allies"},
];

/** The highest level the Essentials Kit's tables cover. Beyond that, a sidekick class takes over. */
export const ESK_MAX_LEVEL = 6;

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

/* -------------------------------------------- Traits & actions, one by one -------------------------------------------- */

export const SIDEKICK_TRAIT_SECTIONS = ["Trait", "Action", "Bonus Action", "Reaction", "Feature"];

/**
 * A stat block's traits and actions as *separate* entries, so the sheet can list them one per row
 * and let the DM add, edit and delete them individually.
 *
 * @param creature The stat block.
 * @param opts.role A chosen role key ("healer", "defender", …). Entries belonging to another role are
 *   left out — a Defender warrior has the Protection reaction, an Attacker does not.
 * @return {Array<{section: string, name: string, text: string}>}
 */
export function getCreatureTraitEntries (creature, {role = null} = {}) {
	const roleKeys = getSidekickRoles(creature).roles.map(it => it.key);

	const sections = [
		["Trait", creature?.trait],
		["Action", creature?.action],
		["Bonus Action", creature?.bonus],
		["Reaction", creature?.reaction],
	];

	const out = [];
	sections.forEach(([section, entries]) => {
		(entries || []).forEach(entry => {
			const name = entry?.name || "";
			if (!isEntryForRole(name, {role, roleKeys})) return;
			out.push({section, name: stripRoleQualifier(name), text: _entryToText(entry.entries || entry.entry || [])});
		});
	});

	// A spellcasting block is a trait too, and for a Spellcaster it is the whole point of the role
	(creature?.spellcasting || []).forEach(sc => {
		if (!isEntryForRole(sc?.name || "", {role, roleKeys})) return;
		out.push({section: "Trait", name: stripRoleQualifier(sc.name || "Spellcasting"), text: getSpellcastingText(sc)});
	});

	return out;
}

/** A spellcasting block as readable text: how it casts, then what it has, level by level. */
export function getSpellcastingText (sc) {
	const parts = [_entryToText(sc?.headerEntries || [])];

	Object.entries(sc?.spells || {}).forEach(([level, meta]) => {
		const lbl = level === "0" ? "Cantrips" : `Level ${level}${meta.slots ? ` (${meta.slots} slots)` : ""}`;
		parts.push(`${lbl}: ${(meta.spells || []).map(_entryToText).join(", ")}`);
	});

	return parts.filter(Boolean).join(" ").trim();
}

/* -------------------------------------------- Roles (healer/mage, attacker/defender) -------------------------------------------- */

/**
 * The roles a sidekick stat block asks you to choose between. The Warrior spells them out as a list
 * inside its "Martial Role" trait; the Spellcaster names them in prose and then gives one
 * `spellcasting` block per role. Both shapes are read here, so the choice comes from the data.
 *
 * @return {{traitName: string|null, roles: Array<{key: string, name: string, text: string}>}}
 */
export function getSidekickRoles (creature) {
	const traitRole = (creature?.trait || []).find(it => /\brole\b/i.test(it?.name || ""));

	const roles = [];
	const addRole = (name, text) => {
		if (!name) return;
		const key = name.toLowerCase();
		const existing = roles.find(it => it.key === key);
		if (existing) { if (!existing.text && text) existing.text = text; return; }
		roles.push({key, name: name.replace(/\b\w/, c => c.toUpperCase()), text: text || ""});
	};

	// The Warrior: a list of named options inside the trait
	const walkItems = entries => (entries || []).forEach(entry => {
		if (typeof entry !== "object" || entry == null) return;
		if (entry.type === "item" || entry.name) addRole(entry.name, _entryToText(entry.entry ?? entry.entries ?? []));
		walkItems(entry.items || entry.entries);
	});
	walkItems(traitRole?.entries);

	// The Spellcaster: named in the trait's prose ("...: healer or mage"), detailed by its spellcasting
	if (!roles.length && traitRole) {
		const m = /:\s*([a-z]+)\s+or\s+([a-z]+)/i.exec(_entryToText(traitRole.entries || []));
		if (m) { addRole(m[1]); addRole(m[2]); }
	}
	(creature?.spellcasting || []).forEach(sc => {
		const qualifier = /\(([^)]+)\)/.exec(sc?.name || "");
		if (qualifier) addRole(qualifier[1], getSpellcastingText(sc));
	});

	return {traitName: traitRole?.name || null, roles};
}

/** The role a stat block entry belongs to, from its name — "Protection (Defender Only)" → "defender". */
export function getEntryRole (name, {roleKeys = []} = {}) {
	const qualifier = /\(([^)]+)\)\s*$/.exec(name || "");
	if (!qualifier) return null;
	const words = qualifier[1].toLowerCase().replace(/\bonly\b/g, "").trim();
	return roleKeys.includes(words) ? words : null;
}

/** Whether an entry applies, given the chosen role. Entries with no role apply to every role. */
export function isEntryForRole (name, {role = null, roleKeys = []} = {}) {
	const entryRole = getEntryRole(name, {roleKeys});
	if (!entryRole) return true;
	// With no role chosen yet, show everything rather than hiding half the stat block
	return !role || entryRole === String(role).toLowerCase();
}

/** "Spellcasting (Healer)" → "Spellcasting" — the role is shown by the sheet, not repeated per row. */
export function stripRoleQualifier (name) {
	return String(name || "").replace(/\s*\([^)]*\)\s*$/, "").trim() || String(name || "");
}

/* -------------------------------------------- The Essentials Kit level tables -------------------------------------------- */

const _ESK_TABLE_CAPTION_TO_TYPE = {experts: "expert", spellcasters: "spellcaster", warriors: "warrior"};

/** Flatten one "New Features" cell into the features it grants; a cell may hold more than one. */
function _cellToFeatures (cell) {
	if (typeof cell === "string") return cell.trim() ? [{name: "", text: _entryToText(cell)}] : [];
	if (Array.isArray(cell)) return cell.flatMap(_cellToFeatures);
	if (!cell || typeof cell !== "object") return [];
	if (cell.name) return [{name: cell.name, text: _entryToText(cell.entries ?? cell.entry ?? [])}];
	return _cellToFeatures(cell.entries ?? cell.entry ?? []);
}

/**
 * The three "Beyond 1st Level" tables from the Essentials Kit's sidekick rules, keyed by sidekick
 * type. Each row is a level with the exact hit-point maximum the book gives it and the features it
 * gains, so the builder can level a sidekick without any of this being restated in code.
 *
 * @return {Object<string, Array<{level: number, hpMax: number|null, hpFormula: string,
 *   features: Array<{name: string, text: string}>}>>}
 */
export function getEskLevelTables (rule) {
	const out = {};

	const walk = entry => {
		if (Array.isArray(entry)) return entry.forEach(walk);
		if (!entry || typeof entry !== "object") return;

		if (entry.type === "table") {
			const mCaption = /^(\w+)\s+Beyond/i.exec(entry.caption || "");
			const type = mCaption ? _ESK_TABLE_CAPTION_TO_TYPE[mCaption[1].toLowerCase()] : null;
			if (type) {
				out[type] = (entry.rows || []).map(row => {
					const mHp = /^\s*(\d+)\s*(?:\(([^)]*)\))?/.exec(_entryToText(row[1]) || "");
					return {
						level: parseInt(_entryToText(row[0])) || null,
						hpMax: mHp ? Number(mHp[1]) : null,
						hpFormula: mHp?.[2]?.trim() || "",
						features: _cellToFeatures(row[2]),
					};
				}).filter(it => it.level);
			}
		}

		[entry.entries, entry.items].forEach(walk);
	};
	walk(rule?.entries);

	return out;
}

/** The row for one level of one sidekick type, or `null` when the tables do not reach that level. */
export function getEskLevelRow (tables, type, level) {
	return (tables?.[type] || []).find(it => it.level === Number(level)) || null;
}

/** Everything an Essentials Kit sidekick has gained by a level: its features from level 2 up. */
export function getEskFeaturesUpToLevel (tables, type, level) {
	return (tables?.[type] || [])
		.filter(it => it.level <= Number(level))
		.flatMap(row => row.features.map(feature => ({...feature, level: row.level})));
}

/** The hit-point maximum the book gives this type at this level. */
export function getEskHpForLevel (tables, type, level, {baseCreature = null} = {}) {
	if (Number(level) <= 1) return baseCreature?.hp?.average ?? null;
	return getEskLevelRow(tables, type, level)?.hpMax ?? null;
}

/**
 * The best published stat block for a sidekick at a level. The Essentials Kit stats all three at
 * 1st level, and the adventures that use them restate each one at 7th, 9th and 11th — so a DM
 * levelling past the tables has a printed block to seed from rather than arithmetic.
 *
 * @param creatures Candidate stat blocks (anything with `type.sidekickType`).
 * @return The highest-level match at or below `level`, else the lowest-level match.
 */
export function findSidekickStatBlock (creatures, {type, role = null, level = 1} = {}) {
	const candidates = (creatures || [])
		.filter(it => getSidekickTypeOfCreature(it) === type)
		.filter(it => {
			const tags = (it?.type?.tags || []).map(tag => String(typeof tag === "object" ? tag.tag : tag).toLowerCase());
			// A block tagged for a role only fits that role; an untagged block fits any
			return !tags.length || !role || tags.includes(String(role).toLowerCase());
		})
		.sort((a, b) => (a.level || 1) - (b.level || 1));
	if (!candidates.length) return null;

	const atOrBelow = candidates.filter(it => (it.level || 1) <= Number(level));
	return atOrBelow.length ? atOrBelow[atOrBelow.length - 1] : candidates[0];
}

/** Which of the three sidekicks a stat block is, if any — the data flags this on `type`. */
export function getSidekickTypeOfCreature (creature) {
	const type = creature?.type;
	return (type && typeof type === "object" && type.sidekickType) || null;
}

/** The role a published stat block was statted for ("Spellcaster (Healer)" → "healer"). */
export function getSidekickRoleOfCreature (creature) {
	const tags = creature?.type?.tags || [];
	const first = tags[0];
	const tag = typeof first === "object" ? first?.tag : first;
	return tag ? String(tag).toLowerCase() : null;
}

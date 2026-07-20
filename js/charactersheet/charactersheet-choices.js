import {CHAR_SHEET_SKILLS, getSkillKeyByName, getSkillNameByKey} from "./charactersheet-consts.js";

/**
 * The "choice queue": pure extraction of unresolved choices (skill/language/tool picks) from
 * race/background/class data, as generic descriptors a UI can walk the user through.
 * Fixed (non-choice) proficiencies are not part of the queue; they are applied directly.
 */

// Fixed core lists (PHB); referenced by `anyGamingSet`/`anyMusicalInstrument` choice keys
export const GAMING_SETS = ["Dice set", "Dragonchess set", "Playing card set", "Three-Dragon Ante set"];
export const MUSICAL_INSTRUMENTS = ["Bagpipes", "Drum", "Dulcimer", "Flute", "Horn", "Lute", "Lyre", "Pan flute", "Shawm", "Viol"];

export const CHOICE_TYPE_SKILL = "skill";
export const CHOICE_TYPE_LANGUAGE = "language";
export const CHOICE_TYPE_TOOL = "tool";

let _ID = 0;
const _nextId = () => `csc-${_ID++}`;

const _titleCase = str => String(str).replace(/\w\S*/g, txt => txt[0].toUpperCase() + txt.slice(1));

/**
 * Human-readable summary of the *fixed* proficiencies in a proficiency group array
 * (used for the "apply the structured fields, render the rest as text" path).
 */
export function getProfListDisplay (arr, {isFixedOnly = false} = {}) {
	if (!arr || !arr.length) return "";
	const out = [];
	arr.forEach(grp => {
		Object.entries(grp).forEach(([k, v]) => {
			if (v === true) return out.push(_titleCase(k));
			if (isFixedOnly) return;
			if (k === "choose" && v && v.from) out.push(`${v.count || 1} of your choice`);
			else if (typeof v === "number") out.push(/^any/i.test(k) ? `${v} of your choice` : `${v}× ${_titleCase(k)}`);
			else if (/^any/i.test(k)) out.push("one of your choice");
		});
	});
	return out.join(", ");
}

const _ALL_SKILL_NAMES = () => CHAR_SHEET_SKILLS.map(({name}) => name);

/** Skill choices from a `skillProficiencies`-style group array. Option values are display names. */
export function getSkillChoices ({groups, sourceName}) {
	const out = [];
	(groups || []).forEach(grp => {
		Object.entries(grp).forEach(([k, v]) => {
			if (k === "choose" && v?.from) {
				out.push({
					id: _nextId(),
					type: CHOICE_TYPE_SKILL,
					sourceName,
					count: v.count || 1,
					from: v.from.map(name => getSkillNameByKey(getSkillKeyByName(name)) || _titleCase(name)),
					label: `Choose ${v.count || 1} skill${(v.count || 1) > 1 ? "s" : ""}`,
				});
			} else if (k === "any" && typeof v === "number") {
				out.push({
					id: _nextId(),
					type: CHOICE_TYPE_SKILL,
					sourceName,
					count: v,
					from: _ALL_SKILL_NAMES(),
					label: `Choose ${v} skill${v > 1 ? "s" : ""} (any)`,
				});
			}
		});
	});
	return out;
}

/** Language choices from a `languageProficiencies`-style group array. */
export function getLanguageChoices ({groups, sourceName}) {
	const out = [];
	(groups || []).forEach(grp => {
		Object.entries(grp).forEach(([k, v]) => {
			if (k === "choose" && v?.from) {
				out.push({
					id: _nextId(),
					type: CHOICE_TYPE_LANGUAGE,
					sourceName,
					count: v.count || 1,
					from: v.from.map(_titleCase),
					label: `Choose ${v.count || 1} language${(v.count || 1) > 1 ? "s" : ""}`,
				});
			} else if ((k === "anyStandard" || k === "any") && typeof v === "number") {
				out.push({
					id: _nextId(),
					type: CHOICE_TYPE_LANGUAGE,
					sourceName,
					count: v,
					from: (k === "anyStandard" ? Parser.LANGUAGES_STANDARD : Parser.LANGUAGES_ALL).map(_titleCase),
					label: `Choose ${v}${k === "anyStandard" ? " standard" : ""} language${v > 1 ? "s" : ""}`,
				});
			}
		});
	});
	return out;
}

/** Tool choices from a `toolProficiencies`-style group array; unsupported "any" keys are skipped (rendered as text elsewhere). */
export function getToolChoices ({groups, sourceName}) {
	const out = [];
	(groups || []).forEach(grp => {
		Object.entries(grp).forEach(([k, v]) => {
			let from = null;
			if (k === "choose" && v?.from) {
				out.push({
					id: _nextId(),
					type: CHOICE_TYPE_TOOL,
					sourceName,
					count: v.count || 1,
					from: v.from.map(_titleCase),
					label: `Choose ${v.count || 1} tool${(v.count || 1) > 1 ? "s" : ""}`,
				});
				return;
			}
			if (typeof v !== "number") return;
			if (k === "anyGamingSet") from = GAMING_SETS;
			else if (k === "anyMusicalInstrument") from = MUSICAL_INSTRUMENTS;
			if (!from) return;
			out.push({
				id: _nextId(),
				type: CHOICE_TYPE_TOOL,
				sourceName,
				count: v,
				from,
				label: `Choose ${v} ${k === "anyGamingSet" ? "gaming set" : "musical instrument"}${v > 1 ? "s" : ""}`,
			});
		});
	});
	return out;
}

/**
 * All pending choices for a set of picked entities, in creation-flow order.
 * `cls` skill choices come from `startingProficiencies`; class tools/languages are
 * rendered text in the data, not structured choices, so they are not queued.
 */
export function getPendingChoices ({race = null, background = null, cls = null} = {}) {
	const out = [];

	if (race) {
		const sourceName = `Species: ${race.name}`;
		out.push(...getSkillChoices({groups: race.skillProficiencies, sourceName}));
		out.push(...getLanguageChoices({groups: race.languageProficiencies, sourceName}));
		out.push(...getToolChoices({groups: race.toolProficiencies, sourceName}));
	}

	if (cls) {
		const sourceName = `Class: ${cls.name}`;
		out.push(...getSkillChoices({groups: cls.startingProficiencies?.skills, sourceName}));
	}

	if (background) {
		const sourceName = `Background: ${background.name}`;
		out.push(...getSkillChoices({groups: background.skillProficiencies, sourceName}));
		out.push(...getLanguageChoices({groups: background.languageProficiencies, sourceName}));
		out.push(...getToolChoices({groups: background.toolProficiencies, sourceName}));
	}

	return out;
}

import {getAbilityPackages, getExpertiseChoices, getFixedAbilityBonuses, getProfListDisplay, getSkillChoices} from "./charactersheet-choices.js";
import {CHAR_SHEET_ABILITIES, CHAR_SHEET_SKILLS, PROF_STATE_EXPERTISE, PROF_STATE_PROFICIENT} from "./charactersheet-consts.js";

/**
 * Shared, interactive resolution of a feat's grants — used by the class panel (ASI/feat slots) and
 * the background origin-feat grant. Applies fixed and choice-based skills/Expertise and returns the
 * feat's ability-score bonuses; tool/language grants have no structured store, so they become notes.
 */

/** Sequentially pick `count` distinct items from `from` (strings); returns picks, or null if none chosen. */
export async function pPickList ({count, from, title}) {
	if (!from?.length) return null;
	const out = [];
	for (let i = 0; i < count; ++i) {
		const remaining = from.filter(it => !out.includes(it));
		if (!remaining.length) break;
		const picked = await InputUiUtil.pGetUserEnum({
			values: remaining,
			isResolveItem: true,
			fnDisplay: it => it,
			title: count > 1 ? `${title} (${i + 1} of ${count})` : title,
			placeholder: "Select...",
		});
		if (picked == null) return out.length ? out : null;
		out.push(picked);
	}
	return out;
}

/** Sequentially pick `count` distinct abilities (by abv) from `from`; null on cancel. */
export async function pPickAbilities ({count, from, title}) {
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

/** Apply a feat's fixed skill/Expertise grants; note tools/languages (no structured store). */
export function applyFeatFixedGrants (comp, feat) {
	(feat.skillProficiencies || []).forEach(grp => {
		Object.entries(grp).forEach(([k, v]) => { if (v === true) comp.setSkillProfByName(k, PROF_STATE_PROFICIENT); });
	});
	(feat.expertise || []).forEach(grp => {
		Object.entries(grp).forEach(([k, v]) => { if (v === true) comp.setSkillProfByName(k, PROF_STATE_EXPERTISE); });
	});

	const pts = [];
	const langs = getProfListDisplay(feat.languageProficiencies);
	if (langs) pts.push(`Languages: ${langs}`);
	const tools = getProfListDisplay(feat.toolProficiencies);
	if (tools) pts.push(`Tools: ${tools}`);
	if (pts.length) comp.appendToTextProp("proficienciesText", `${feat.name}: ${pts.join("; ")}`);
}

/** Interactively resolve a feat's structured skill and Expertise choices (Prodigy, Skill Expert, ...). */
export async function pResolveFeatSkillChoices (comp, feat) {
	for (const choice of getSkillChoices({groups: feat.skillProficiencies, sourceName: feat.name})) {
		const picked = await pPickList({count: choice.count, from: choice.from, title: `${feat.name}: choose skill${choice.count > 1 ? "s" : ""}`});
		(picked || []).forEach(name => comp.setSkillProfByName(name, PROF_STATE_PROFICIENT));
	}

	const proficientNames = CHAR_SHEET_SKILLS
		.filter(({key}) => (Number(comp._state[`skill_${key}`]) || 0) >= PROF_STATE_PROFICIENT)
		.map(({name}) => name);
	for (const choice of getExpertiseChoices({groups: feat.expertise, sourceName: feat.name, proficientSkillNames: proficientNames})) {
		const picked = await pPickList({count: choice.count, from: choice.from, title: `${feat.name}: choose Expertise skill${choice.count > 1 ? "s" : ""}`});
		(picked || []).forEach(name => comp.setSkillProfByName(name, PROF_STATE_EXPERTISE));
	}
}

/** Resolve a feat's ability increases (fixed + a single choose group); returns bonuses, or null if cancelled. */
export async function pResolveFeatAbility (comp, feat) {
	const bonuses = {...getFixedAbilityBonuses(feat.ability)};
	const packages = getAbilityPackages(feat.ability);
	if (packages.length === 1 && packages[0].choose) {
		const {from, count, amount} = packages[0].choose;
		const picked = await pPickAbilities({count, from: from.length ? from : CHAR_SHEET_ABILITIES.map(([abv]) => abv), title: `${feat.name}: increase which ability?`});
		if (!picked) return null;
		picked.forEach(abv => bonuses[abv] = (bonuses[abv] || 0) + amount);
	}
	return bonuses;
}

/**
 * Fully resolve a feat: ability increases (interactive), fixed grants, and skill/Expertise choices.
 * @return the feat's ability bonuses `{abv: n}`, or null if the player cancelled.
 */
export async function pResolveFeat (comp, feat) {
	const bonuses = await pResolveFeatAbility(comp, feat);
	if (bonuses == null) return null;
	applyFeatFixedGrants(comp, feat);
	await pResolveFeatSkillChoices(comp, feat);
	return bonuses;
}

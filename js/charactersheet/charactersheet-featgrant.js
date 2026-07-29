import {getAbilityPackages, getExpertiseChoices, getFixedAbilityBonuses, getProfListDisplay, getSkillChoices} from "./charactersheet-choices.js";
import {CHAR_SHEET_ABILITIES, CHAR_SHEET_SKILLS, PROF_STATE_EXPERTISE, PROF_STATE_PROFICIENT} from "./charactersheet-consts.js";
import {getDynamicSpellGrants, getSpellGrantGroups, isSpellMatchingFilter} from "./charactersheet-levelengine.js";
import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {getEntityProficiencies} from "./charactersheet-proficiencies.js";

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

/** Apply a feat's fixed skill/Expertise/tool/language grants. */
export function applyFeatFixedGrants (comp, feat) {
	(feat.skillProficiencies || []).forEach(grp => {
		Object.entries(grp).forEach(([k, v]) => { if (v === true) comp.setSkillProfByName(k, PROF_STATE_PROFICIENT); });
	});
	(feat.expertise || []).forEach(grp => {
		Object.entries(grp).forEach(([k, v]) => { if (v === true) comp.setSkillProfByName(k, PROF_STATE_EXPERTISE); });
	});

	comp.setProficienciesFromSource(feat.name, getEntityProficiencies(feat));

	// The outright grants are stored structurally above; only the unresolved choices need a note
	const pts = [];
	const langs = getProfListDisplay(feat.languageProficiencies, {isChoiceOnly: true});
	if (langs) pts.push(`Languages: ${langs}`);
	const tools = getProfListDisplay(feat.toolProficiencies, {isChoiceOnly: true});
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
 * Resolve the spells an entity grants through `additionalSpells` — feats (Magic Initiate, Artificer
 * Initiate, ...) and species (an Elf's lineage cantrips, a Tiefling's legacy) share the shape, so
 * they share this resolver. An entity with several alternative groups offers them as a choice
 * ("Bard Spells" vs "Cleric Spells"; Drow vs High Elf vs Wood Elf): the player picks one group,
 * then picks the spells within it.
 */
export async function pResolveEntitySpellGrants (comp, feat, {grantKeyPrefix}) {
	if (!feat.additionalSpells?.length) return;

	// Pick which alternative group applies, when the entity offers a choice of spell lists
	let groupIndex = 0;
	const groups = getSpellGrantGroups(feat);
	if (groups.length) {
		const picked = await InputUiUtil.pGetUserEnum({
			values: groups,
			isResolveItem: true,
			fnDisplay: g => g.name,
			title: `${feat.name}: which spell list?`,
			placeholder: "Select...",
		});
		if (picked == null) return;
		groupIndex = picked.index;
	}

	const grants = getDynamicSpellGrants(feat, 20)
		.filter(g => g.type === "choose" && g.groupIndex === groupIndex);
	if (!grants.length) return;

	const allSpells = await CharacterSheetClassData.pGetAllSpells().catch(() => []);
	const byKey = new Map();
	const byName = new Map();
	allSpells.forEach(sp => {
		byKey.set(`${sp.name.toLowerCase()}|${sp.source.toLowerCase()}`, sp);
		if (!byName.has(sp.name.toLowerCase())) byName.set(sp.name.toLowerCase(), sp);
	});
	const withClasses = sp => {
		if (!sp._csClassNames) {
			sp._csClassNames = [
				...Renderer.spell.getCombinedClasses(sp, "fromClassList"),
				...Renderer.spell.getCombinedClasses(sp, "fromClassListVariant"),
			].map(c => c.name).filter(Boolean);
		}
		return sp;
	};

	for (const grant of grants) {
		const pool = grant.from?.length
			? grant.from.map(uid => {
				const [name, source] = uid.split("|");
				return byKey.get(`${name}|${(source || "phb").toLowerCase()}`) || byName.get(name);
			}).filter(Boolean)
			: allSpells.filter(sp => isSpellMatchingFilter(withClasses(sp), grant.filter));
		if (!pool.length) continue;

		const grantKey = `${grantKeyPrefix}:${grant.id}`;
		// Exclude by name, not name+source: the same spell reprinted in two books is still one spell.
		const taken = new Set();
		for (let i = 0; i < grant.count; ++i) {
			const remaining = pool.filter(sp => !taken.has(sp.name.toLowerCase()));
			if (!remaining.length) break;
			const picked = await InputUiUtil.pGetUserEnum({
				values: remaining.sort((a, b) => (a.level - b.level) || SortUtil.ascSortLower(a.name, b.name)),
				isResolveItem: true,
				fnDisplay: sp => `${sp.name} (${sp.level === 0 ? "cantrip" : Parser.spLevelToFull(sp.level)}, ${Parser.sourceJsonToAbv(sp.source)})`,
				title: grant.count > 1 ? `${feat.name}: choose a spell (${i + 1} of ${grant.count})` : `${feat.name}: choose a spell`,
				placeholder: "Select a spell...",
			});
			if (picked == null) break;
			taken.add(picked.name.toLowerCase());
			comp.addGrantedSpellChoice({grantKey, name: picked.name, source: picked.source, level: picked.level});
		}
	}
}

/**
 * Fully resolve a feat: ability increases (interactive), fixed grants, skill/Expertise choices, and
 * any spells the feat grants.
 * @return the feat's ability bonuses `{abv: n}`, or null if the player cancelled.
 */
export async function pResolveFeat (comp, feat, {grantKeyPrefix = null} = {}) {
	const bonuses = await pResolveFeatAbility(comp, feat);
	if (bonuses == null) return null;
	applyFeatFixedGrants(comp, feat);
	await pResolveFeatSkillChoices(comp, feat);
	await pResolveEntitySpellGrants(comp, feat, {grantKeyPrefix: grantKeyPrefix || `feat:${feat.name}|${feat.source}`});
	return bonuses;
}

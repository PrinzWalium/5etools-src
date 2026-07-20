import {CHAR_SHEET_ABILITIES, CHAR_SHEET_SKILLS, PROF_STATE_EXPERTISE, PROF_STATE_PROFICIENT} from "./charactersheet-consts.js";

/**
 * Pure derivation of renderable stats from character state.
 *
 * `deriveCharacterSheet(state)` is deterministic and side-effect-free: it never touches the DOM,
 * never mutates its input, and depends only on `Parser` for the ability score-to-modifier mapping.
 * This is the seam the leveling engine (roadmap Phase 2) plugs into, and what unit tests exercise.
 */

const _MAX_LEVEL = 20;

/** Total character level: the sum of class levels when structured class data exists, else the manual level field. */
export function getTotalLevel (state) {
	const classes = state.classes || [];
	const sum = classes.reduce((acc, cls) => acc + (Number(cls.level) || 0), 0);
	const raw = sum || Number(state.level) || 1;
	return Math.min(_MAX_LEVEL, Math.max(1, raw));
}

export function getProfBonus (state) {
	return 2 + Math.floor((getTotalLevel(state) - 1) / 4);
}

export function getAbilityModifier (state, abv) {
	return Parser.getAbilityModNumber(Number(state[`abil_${abv}`]) || 10);
}

export function deriveCharacterSheet (state) {
	const totalLevel = getTotalLevel(state);
	const pb = getProfBonus(state);

	const abilities = {};
	CHAR_SHEET_ABILITIES.forEach(([abv]) => {
		abilities[abv] = {
			score: Number(state[`abil_${abv}`]) || 10,
			mod: getAbilityModifier(state, abv),
		};
	});

	const saves = {};
	CHAR_SHEET_ABILITIES.forEach(([abv]) => {
		const isProf = !!state[`save_${abv}`];
		saves[abv] = {
			isProf,
			mod: abilities[abv].mod + (isProf ? pb : 0),
		};
	});

	const skills = {};
	CHAR_SHEET_SKILLS.forEach(({key, ability}) => {
		const profState = Number(state[`skill_${key}`]) || 0;
		const profMult = profState === PROF_STATE_EXPERTISE ? 2 : profState === PROF_STATE_PROFICIENT ? 1 : 0;
		skills[key] = {
			profState,
			ability,
			mod: abilities[ability].mod + (pb * profMult),
		};
	});

	const spellAbility = state.spellAbility || null;
	const spell = spellAbility
		? {
			ability: spellAbility,
			dc: 8 + pb + abilities[spellAbility].mod,
			atkMod: pb + abilities[spellAbility].mod,
		}
		: null;

	return {
		totalLevel,
		pb,
		abilities,
		saves,
		skills,
		passivePerception: 10 + skills.perception.mod,
		initiative: abilities.dex.mod + (Number(state.initMisc) || 0),
		spell,
	};
}

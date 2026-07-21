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
	const magic = getEquippedMagicBonuses(state);

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
			mod: abilities[abv].mod + (isProf ? pb : 0) + magic.savingThrow,
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
			dc: 8 + pb + abilities[spellAbility].mod + magic.spellSaveDc,
			atkMod: pb + abilities[spellAbility].mod + magic.spellAttack,
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
		armorClass: deriveArmorClass(state),
		unarmedStrike: getUnarmedStrike(state),
		encumbrance: getEncumbrance(state),
	};
}

/**
 * Armor Class from equipped gear and the chosen mode.
 *  - "manual": the character's typed AC value, unchanged.
 *  - otherwise: equipped body armor sets the base (Light +Dex, Medium +Dex capped, Heavy flat, plus
 *    the armor's own magic bonus); with no armor, an unarmored formula applies (10+Dex, or a
 *    Barbarian/Monk Unarmored Defense). Equipped shields and other worn magic AC bonuses stack,
 *    plus a flat misc bonus.
 * @return {{ac: number, mode: string, note: string}}
 */
export function deriveArmorClass (state) {
	const mode = state.acMode || "auto";
	if (mode === "manual") return {ac: Number(state.ac) || 10, mode, note: "manual"};

	const dexMod = getAbilityModifier(state, "dex");
	const equipped = (state.inventory || []).filter(it => it.equipped);
	const armor = equipped.find(it => it.isArmor && ["LA", "MA", "HA"].includes(it.type));

	let base;
	let note;
	if (armor) {
		const armorAc = Number(armor.baseAc) || 10;
		const magic = Number(armor.bonusAc) || 0;
		if (armor.type === "LA") base = armorAc + dexMod + magic;
		else if (armor.type === "MA") base = armorAc + Math.min(dexMod, armor.dexterityMax ?? 2) + magic;
		else base = armorAc + magic; // Heavy: no Dex
		note = armor.name;
	} else if (mode === "barbarian") {
		base = 10 + dexMod + getAbilityModifier(state, "con");
		note = "Unarmored Defense (Barbarian)";
	} else if (mode === "monk") {
		base = 10 + dexMod + getAbilityModifier(state, "wis");
		note = "Unarmored Defense (Monk)";
	} else {
		base = 10 + dexMod;
		note = "Unarmored";
	}

	const shield = equipped
		.filter(it => it.type === "S")
		.reduce((acc, it) => acc + (Number(it.baseAc) || 2) + (Number(it.bonusAc) || 0), 0);
	const otherMagic = equipped
		.filter(it => !it.isArmor && it.type !== "S" && it.bonusAc)
		.reduce((acc, it) => acc + (Number(it.bonusAc) || 0), 0);
	const misc = Number(state.acMisc) || 0;

	return {ac: base + shield + otherMagic + misc, mode, note};
}

/**
 * Sum the passive bonuses granted by *equipped* magic items: to saving throws (Cloak/Ring of
 * Protection), spell save DC, and spell attack (arcane foci, rods/wands). AC bonuses are handled
 * separately in `deriveArmorClass`.
 * @return {{savingThrow: number, spellSaveDc: number, spellAttack: number}}
 */
export function getEquippedMagicBonuses (state) {
	const out = {savingThrow: 0, spellSaveDc: 0, spellAttack: 0};
	(state.inventory || [])
		.filter(it => it.equipped)
		.forEach(it => {
			out.savingThrow += Number(it.bonusSavingThrow) || 0;
			out.spellSaveDc += Number(it.bonusSpellSaveDc) || 0;
			out.spellAttack += Number(it.bonusSpellAttack) || 0;
		});
	return out;
}

/**
 * Build an attack row from a weapon's stored metadata: picks the attack ability (Dex for ranged,
 * the better of Str/Dex for finesse, else Str), assumes proficiency, and folds in the weapon's magic
 * attack/damage bonuses. Returns `{name, atkBonus, damage}` matching the attacks collection shape.
 */
export function getWeaponAttack (state, item) {
	const pb = getProfBonus(state);
	const type = String(item.type || "").split("|")[0];
	const props = item.properties || [];
	const isRanged = type === "R";
	const isFinesse = props.includes("F");

	let abv = "str";
	if (isRanged) abv = "dex";
	else if (isFinesse) abv = getAbilityModifier(state, "dex") > getAbilityModifier(state, "str") ? "dex" : "str";
	const abilMod = getAbilityModifier(state, abv);

	const bonusAttack = Number(item.bonusAttack) || 0;
	const bonusDamage = Number(item.bonusDamage) || 0;

	let damage = "";
	if (item.dmg1) {
		const dmgTypeFull = item.dmgType ? ` ${Parser.dmgTypeToFull(item.dmgType, {styleHint: "classic"})}` : "";
		const dmgMod = abilMod + bonusDamage;
		const modStr = dmgMod === 0 ? "" : (dmgMod > 0 ? `+${dmgMod}` : `${dmgMod}`);
		damage = `${item.dmg1}${modStr}${dmgTypeFull}`;
	}

	return {name: item.name || "", atkBonus: abilMod + pb + bonusAttack, damage};
}

/** The always-available Unarmed Strike: 1 + Strength modifier bludgeoning, with proficiency. */
export function getUnarmedStrike (state) {
	const strMod = getAbilityModifier(state, "str");
	const dmg = 1 + strMod;
	return {name: "Unarmed Strike", atkBonus: strMod + getProfBonus(state), damage: `${Math.max(0, dmg)} bludgeoning`};
}

/** Carried weight from the inventory vs. the standard carrying capacity (Strength × 15). */
export function getEncumbrance (state) {
	const totalWeightLb = (state.inventory || [])
		.reduce((acc, it) => acc + ((Number(it.weightLb) || 0) * (Number(it.quantity) || 0)), 0);
	return {
		totalWeightLb: Math.round(totalWeightLb * 100) / 100,
		capacityLb: (Number(state.abil_str) || 10) * 15,
	};
}

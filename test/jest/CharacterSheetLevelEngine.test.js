import * as fs from "fs";
import "../../js/parser.js";
import {
	checkFeatPrerequisites,
	getAsiCount,
	getClassResources,
	getExpertiseSkillCount,
	getPreparedSpellCount,
	getCantripsKnown,
	getCasterLevelContribution,
	getHitDieAverage,
	getLevelUpHp,
	getMulticlassRequirementsDisplay,
	getOptionalFeatureCounts,
	getPactSlots,
	getPreparedSpellsDisplay,
	getSingleClassSlots,
	getSpellcastingMeta,
	getSpellsKnown,
	isMulticlassRequirementMet,
} from "../../js/charactersheet/charactersheet-levelengine.js";

const loadClassFile = name => JSON.parse(fs.readFileSync(`./data/class/class-${name}.json`, "utf8"));

const getClass = (file, source = "PHB") => loadClassFile(file).class.find(it => it.source === source);
const getSubclass = (file, shortName, source = "PHB") => loadClassFile(file).subclass.find(it => it.shortName === shortName && it.source === source);

describe("Leveling engine: spell slots (PHB values)", () => {
	it("Should read a level 5 wizard's slots from the class table", () => {
		const wizard = getClass("wizard");
		expect(getSingleClassSlots(wizard, 5)).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
		expect(getCantripsKnown(wizard, 5)).toBe(4);
	});

	it("Should read a level 11 cleric's slots and prepared formula", () => {
		const cleric = getClass("cleric");
		expect(getSingleClassSlots(cleric, 11)).toEqual([4, 3, 3, 3, 2, 1, 0, 0, 0]);
		expect(getPreparedSpellsDisplay(cleric)).toBe("class level + WIS modifier");
	});

	it("Should handle half casters natively via their own table (paladin level 1 has no slots)", () => {
		const paladin = getClass("paladin");
		expect(getSingleClassSlots(paladin, 1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
		expect(getSingleClassSlots(paladin, 5)).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
	});

	it("Should parse warlock pact slots from table columns", () => {
		const warlock = getClass("warlock");
		expect(getPactSlots(warlock, 5)).toEqual({count: 2, level: 3});
		expect(getPactSlots(warlock, 17)).toEqual({count: 4, level: 5});
		expect(getSpellsKnown(warlock, 5)).toBe(6);
	});

	it("Should read third-caster subclass tables (Eldritch Knight)", () => {
		const ek = getSubclass("fighter", "Eldritch Knight");
		expect(ek.casterProgression).toBe("1/3");
		expect(getSingleClassSlots(ek, 7)).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
	});
});

describe("Leveling engine: multiclass slot stacking (PHB multiclass table)", () => {
	it("Should contribute caster levels per progression type", () => {
		expect(getCasterLevelContribution("full", 5)).toBe(5);
		expect(getCasterLevelContribution("1/2", 5)).toBe(2);
		expect(getCasterLevelContribution("1/3", 5)).toBe(1);
		expect(getCasterLevelContribution("artificer", 5)).toBe(3);
		expect(getCasterLevelContribution("pact", 5)).toBe(0);
		expect(getCasterLevelContribution(null, 5)).toBe(0);
	});

	it("Should give a Fighter 5 / Wizard 5 the wizard's own multiclass row (caster level 5)", () => {
		const fighter = getClass("fighter");
		const wizard = getClass("wizard");
		const meta = getSpellcastingMeta([
			{cls: fighter, sc: null, level: 5},
			{cls: wizard, sc: null, level: 5},
		]);
		expect(meta.casterLevel).toBe(5);
		expect(meta.slots).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
		expect(meta.pact).toBeNull();
	});

	it("Should stack Cleric 5 / Wizard 5 to caster level 10", () => {
		const meta = getSpellcastingMeta([
			{cls: getClass("cleric"), sc: null, level: 5},
			{cls: getClass("wizard"), sc: null, level: 5},
		]);
		expect(meta.casterLevel).toBe(10);
		expect(meta.slots).toEqual([4, 3, 3, 3, 2, 0, 0, 0, 0]);
	});

	it("Should stack Paladin 5 / Wizard 5 to caster level 7 (half rounds down)", () => {
		const meta = getSpellcastingMeta([
			{cls: getClass("paladin"), sc: null, level: 5},
			{cls: getClass("wizard"), sc: null, level: 5},
		]);
		expect(meta.casterLevel).toBe(7);
		expect(meta.slots).toEqual([4, 3, 3, 1, 0, 0, 0, 0, 0]);
	});

	it("Should count an Eldritch Knight fighter as a third caster in a multiclass", () => {
		const meta = getSpellcastingMeta([
			{cls: getClass("fighter"), sc: getSubclass("fighter", "Eldritch Knight"), level: 6},
			{cls: getClass("wizard"), sc: null, level: 4},
		]);
		expect(meta.casterLevel).toBe(6); // floor(6/3) + 4
		expect(meta.slots).toEqual([4, 3, 3, 0, 0, 0, 0, 0, 0]);
	});

	it("Should keep pact slots separate from shared slots (Warlock 5 / Wizard 5)", () => {
		const meta = getSpellcastingMeta([
			{cls: getClass("warlock"), sc: null, level: 5},
			{cls: getClass("wizard"), sc: null, level: 5},
		]);
		expect(meta.casterLevel).toBe(5);
		expect(meta.slots).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]); // wizard's own table
		expect(meta.pact).toEqual({count: 2, level: 3});
	});

	it("Should report no slots for non-casters", () => {
		const meta = getSpellcastingMeta([{cls: getClass("fighter"), sc: null, level: 5}]);
		expect(meta.slots).toBeNull();
		expect(meta.casterLevel).toBe(0);
	});
});

describe("Leveling engine: optional feature progression", () => {
	it("Should surface the fighter's Fighting Style at level 1", () => {
		const counts = getOptionalFeatureCounts(getClass("fighter"), 1);
		expect(counts).toEqual([{name: "Fighting Style", featureTypes: ["FS:F"], count: 1}]);
	});

	it("Should read warlock invocations from an array progression", () => {
		const warlock = getClass("warlock");
		const at5 = getOptionalFeatureCounts(warlock, 5);
		expect(at5.find(it => it.name === "Eldritch Invocations").count).toBe(3);
		expect(at5.find(it => it.name === "Pact Boon").count).toBe(1);
		const at1 = getOptionalFeatureCounts(warlock, 1);
		expect(at1.find(it => it.name === "Eldritch Invocations")).toBeUndefined();
	});

	it("Should read Battle Master maneuvers from an object progression", () => {
		const bm = getSubclass("fighter", "Battle Master");
		expect(getOptionalFeatureCounts(bm, 3)[0].count).toBe(3);
		expect(getOptionalFeatureCounts(bm, 10)[0].count).toBe(7);
		expect(getOptionalFeatureCounts(bm, 2)).toEqual([]);
	});
});

describe("Leveling engine: ASI slots", () => {
	it("Should count Ability Score Improvement features by level (dereferenced shape)", () => {
		// Fighter-style: ASIs at 4 and 6
		const cls = {
			classFeatures: [
				[{name: "Second Wind"}],
				[{name: "Action Surge"}],
				[{name: "Martial Archetype"}],
				[{name: "Ability Score Improvement"}],
				[{name: "Extra Attack"}],
				[{name: "Ability Score Improvement"}],
			],
		};
		expect(getAsiCount(cls, 3)).toBe(0);
		expect(getAsiCount(cls, 4)).toBe(1);
		expect(getAsiCount(cls, 6)).toBe(2);
	});
});

describe("Leveling engine: expertise grants", () => {
	it("Should count Expertise features (two picks each) by level", () => {
		// Rogue-style: Expertise at 1 and 6
		const cls = {
			classFeatures: [
				[{name: "Expertise"}, {name: "Sneak Attack"}],
				[{name: "Cunning Action"}],
				[{name: "Roguish Archetype"}],
				[{name: "Ability Score Improvement"}],
				[{name: "Uncanny Dodge"}],
				[{name: "Expertise"}],
			],
		};
		expect(getExpertiseSkillCount(cls, 1)).toBe(2);
		expect(getExpertiseSkillCount(cls, 5)).toBe(2);
		expect(getExpertiseSkillCount(cls, 6)).toBe(4);
	});

	it("Should return 0 for classes without Expertise", () => {
		const cls = {classFeatures: [[{name: "Second Wind"}], [{name: "Action Surge"}]]};
		expect(getExpertiseSkillCount(cls, 20)).toBe(0);
		expect(getExpertiseSkillCount(null, 5)).toBe(0);
	});
});

describe("Leveling engine: class resources (table columns)", () => {
	it("Should read dice/number/bonus columns and skip spell columns", () => {
		const cls = {
			classTableGroups: [
				{colLabels: ["Rages", "Rage Damage", "Weapon Mastery"], rows: [
					["2", {type: "bonus", value: 2}, "2"],
					["3", {type: "bonus", value: 2}, "3"],
				]},
				{colLabels: ["Sneak Attack"], rows: [
					[{type: "dice", toRoll: [{number: 1, faces: 6}]}],
					[{type: "dice", toRoll: [{number: 2, faces: 6}]}],
				]},
				{colLabels: ["Cantrips Known", "1st"], rowsSpellProgression: [[3, 2], [3, 3]]}, // spell cols: ignored
			],
		};
		expect(getClassResources(cls, 2)).toEqual([
			{label: "Rages", value: "3"},
			{label: "Rage Damage", value: "+2"},
			{label: "Weapon Mastery", value: "3"},
			{label: "Sneak Attack", value: "2d6"},
		]);
	});

	it("Should drop empty cells (0 / blank / 0-speed)", () => {
		const cls = {classTableGroups: [{colLabels: ["Focus Points", "Unarmored Movement"], rows: [[0, {type: "bonusSpeed", value: 0}]]}]};
		expect(getClassResources(cls, 1)).toEqual([]);
	});

	it("Should return [] for a class without table groups", () => {
		expect(getClassResources({}, 5)).toEqual([]);
	});
});

describe("Leveling engine: prepared spell count", () => {
	it("Should evaluate a full caster's prepared formula (level + mod)", () => {
		const cls = {preparedSpells: "<$level$> + <$wis_mod$>"};
		expect(getPreparedSpellCount(cls, 5, 3)).toBe(8);
		expect(getPreparedSpellCount(cls, 1, 0)).toBe(1); // floor of 1
	});

	it("Should evaluate a half caster's prepared formula (half level round up + mod)", () => {
		const cls = {preparedSpells: "<$level_half_round_up$> + <$cha_mod$>"};
		expect(getPreparedSpellCount(cls, 5, 2)).toBe(5); // ceil(5/2)=3 +2
	});

	it("Should return null for non-preparing classes", () => {
		expect(getPreparedSpellCount({spellsKnownProgression: []}, 5, 3)).toBeNull();
		expect(getPreparedSpellCount(null, 5, 3)).toBeNull();
	});
});

describe("Leveling engine: multiclass requirements", () => {
	it("Should treat or-group keys as alternatives (Fighter: Str 13 or Dex 13)", () => {
		const req = getClass("fighter").multiclassing.requirements;
		expect(isMulticlassRequirementMet(req, {str: 13, dex: 8})).toBe(true);
		expect(isMulticlassRequirementMet(req, {str: 8, dex: 13})).toBe(true);
		expect(isMulticlassRequirementMet(req, {str: 8, dex: 8})).toBe(false);
		expect(getMulticlassRequirementsDisplay(req)).toBe("Strength 13 or Dexterity 13");
	});

	it("Should require all top-level keys (Paladin: Str 13 and Cha 13)", () => {
		const req = getClass("paladin").multiclassing.requirements;
		expect(isMulticlassRequirementMet(req, {str: 13, cha: 13})).toBe(true);
		expect(isMulticlassRequirementMet(req, {str: 13, cha: 8})).toBe(false);
	});
});

describe("Leveling engine: feat prerequisites", () => {
	const ctx = ({abilityScores = {}, totalLevel = 1, classes = [], raceNames = [], backgroundName = null, featNames = [], isSpellcaster = false} = {}) =>
		({abilityScores, totalLevel, classes, raceNames, backgroundName, featNames, isSpellcaster});

	it("Should pass when there are no prerequisites", () => {
		expect(checkFeatPrerequisites(undefined, ctx()).status).toBe("met");
		expect(checkFeatPrerequisites([], ctx()).status).toBe("met");
	});

	it("Should check ability prerequisites as alternatives across sets (Ritual Caster: Int 13 or Wis 13)", () => {
		const pre = [{ability: [{int: 13}, {wis: 13}]}];
		expect(checkFeatPrerequisites(pre, ctx({abilityScores: {int: 14, wis: 8}})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({abilityScores: {int: 8, wis: 15}})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({abilityScores: {int: 10, wis: 10}})).status).toBe("unmet");
	});

	it("Should check a fixed ability requirement (Actor: Cha 13)", () => {
		const pre = [{ability: [{cha: 13}]}];
		expect(checkFeatPrerequisites(pre, ctx({abilityScores: {cha: 13}})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({abilityScores: {cha: 12}})).status).toBe("unmet");
	});

	it("Should treat top-level prerequisite entries as alternatives", () => {
		const pre = [{ability: [{str: 13}]}, {ability: [{dex: 13}]}];
		expect(checkFeatPrerequisites(pre, ctx({abilityScores: {str: 8, dex: 15}})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({abilityScores: {str: 8, dex: 8}})).status).toBe("unmet");
	});

	it("Should require all keys within one entry (level and ability)", () => {
		const pre = [{level: 4, ability: [{con: 13}]}];
		expect(checkFeatPrerequisites(pre, ctx({totalLevel: 4, abilityScores: {con: 13}})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({totalLevel: 3, abilityScores: {con: 13}})).status).toBe("unmet");
		expect(checkFeatPrerequisites(pre, ctx({totalLevel: 4, abilityScores: {con: 10}})).status).toBe("unmet");
	});

	it("Should check class-level requirements against the matching class", () => {
		const pre = [{level: {level: 1, class: {name: "Wizard"}}}];
		expect(checkFeatPrerequisites(pre, ctx({classes: [{name: "Wizard", level: 1}]})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({classes: [{name: "Fighter", level: 5}]})).status).toBe("unmet");
	});

	it("Should check race prerequisites (Bountiful Luck: halfling)", () => {
		const pre = [{race: [{name: "halfling"}]}];
		expect(checkFeatPrerequisites(pre, ctx({raceNames: ["Lightfoot Halfling", "lightfoot", "halfling"]})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({raceNames: ["elf"]})).status).toBe("unmet");
	});

	it("Should check spellcasting prerequisites", () => {
		const pre = [{spellcasting: true}];
		expect(checkFeatPrerequisites(pre, ctx({isSpellcaster: true})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({isSpellcaster: false})).status).toBe("unmet");
	});

	it("Should check taken-feat prerequisites by name segment", () => {
		const pre = [{feat: ["initiate of high sorcery|dsotdq|initiate of high sorcery (nuitari)"]}];
		expect(checkFeatPrerequisites(pre, ctx({featNames: ["Initiate of High Sorcery"]})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({featNames: ["Alert"]})).status).toBe("unmet");
	});

	it("Should return unknown when only unverifiable clauses remain", () => {
		expect(checkFeatPrerequisites([{campaign: ["Ravenloft"]}], ctx()).status).toBe("unknown");
		expect(checkFeatPrerequisites([{other: "No other dragonmark"}], ctx()).status).toBe("unknown");
		// A satisfiable checkable clause plus an unknown one → unknown (don't falsely block)
		expect(checkFeatPrerequisites([{ability: [{str: 13}], proficiency: [{weapon: "martial"}]}], ctx({abilityScores: {str: 15}})).status).toBe("unknown");
	});
});

describe("Leveling engine: hit points", () => {
	it("Should give the 5e fixed average per hit die", () => {
		expect(getHitDieAverage(6)).toBe(4);
		expect(getHitDieAverage(8)).toBe(5);
		expect(getHitDieAverage(10)).toBe(6);
		expect(getHitDieAverage(12)).toBe(7);
	});

	it("Should sum average HP across levels with Constitution", () => {
		expect(getLevelUpHp({faces: 10, conMod: 2, numLevels: 1}).total).toBe(8); // 6 + 2
		expect(getLevelUpHp({faces: 10, conMod: 2, numLevels: 3}).total).toBe(24); // 3 × 8
		expect(getLevelUpHp({faces: 8, conMod: 0, numLevels: 2}).total).toBe(10); // 2 × 5
	});

	it("Should floor each level at 1 HP even with a big negative Con", () => {
		const {total, perLevel} = getLevelUpHp({faces: 6, conMod: -5, numLevels: 2});
		expect(perLevel).toEqual([1, 1]);
		expect(total).toBe(2);
	});

	it("Should roll per level when given a roll function", () => {
		const {total, perLevel} = getLevelUpHp({faces: 10, conMod: 1, numLevels: 2, fnRoll: () => 7});
		expect(perLevel).toEqual([8, 8]);
		expect(total).toBe(16);
	});
});

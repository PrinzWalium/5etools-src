import * as fs from "fs";
import "../../js/parser.js";
import {
	getCreatureAc,
	getCreatureSaveProficiencies,
	getCreatureSizeTypeText,
	getCreatureSkillProficiencies,
	getCreatureSpeed,
	getSidekickExpectedHp,
	getSidekickHitDie,
	getSidekickLevelTable,
	getSidekickProficiencyBonus,
	getSidekickSeed,
	SIDEKICK_CLASS_NAMES,
} from "../../js/charactersheet/charactersheet-sidekick.js";

const SIDEKICK_CLASSES = JSON.parse(fs.readFileSync("./data/class/class-sidekick.json", "utf8")).class;
const MM = JSON.parse(fs.readFileSync("./data/bestiary/bestiary-mm.json", "utf8")).monster;
const getMonster = name => MM.find(it => it.name === name);

describe("Sidekick: reading a stat block", () => {
	it("Takes the hit die from the hit-point formula", () => {
		expect(getSidekickHitDie(getMonster("Guard"))).toBe(8); // 2d8 + 2
		expect(getSidekickHitDie({hp: {average: 22, formula: "5d10 - 5"}})).toBe(10);
	});

	it("Falls back to size when the stat block gives a flat number", () => {
		expect(getSidekickHitDie({size: ["S"], hp: {average: 7}})).toBe(6);
		expect(getSidekickHitDie({size: ["L"], hp: {}})).toBe(10);
		expect(getSidekickHitDie({})).toBeNull();
	});

	it("Reads Armor Class through the `{ac, from}` shape", () => {
		expect(getCreatureAc(getMonster("Guard"))).toBe(16);
		expect(getCreatureAc({ac: [12]})).toBe(12);
		expect(getCreatureAc({})).toBeNull();
	});

	it("Renders speed, including the non-walking modes", () => {
		expect(getCreatureSpeed(getMonster("Guard"))).toBe("30 ft.");
		expect(getCreatureSpeed({speed: {walk: 20, fly: 60}})).toBe("20 ft., fly 60 ft.");
		expect(getCreatureSpeed({speed: 30})).toBe("30 ft.");
	});

	it("Describes size and type the way a stat block does", () => {
		expect(getCreatureSizeTypeText(getMonster("Guard"))).toBe("Medium humanoid (any race)");
	});
});

describe("Sidekick: proficiencies inferred from a stat block", () => {
	it("Treats a skill bonus above the ability modifier as proficiency", () => {
		// Guard: Perception +2 with Wisdom 11 (+0) — proficient, not expert
		expect(getCreatureSkillProficiencies(getMonster("Guard"))).toEqual({perception: 1});
	});

	it("Treats roughly double proficiency as expertise", () => {
		expect(getCreatureSkillProficiencies({skill: {stealth: "+6"}}, {proficiencyBonus: 2})).toEqual({stealth: 2});
		expect(getCreatureSkillProficiencies({skill: {stealth: "+3"}}, {proficiencyBonus: 2})).toEqual({stealth: 1});
	});

	it("Reads saving-throw proficiencies, and ignores anything else", () => {
		expect(getCreatureSaveProficiencies({save: {dex: "+4", con: "+3"}})).toEqual(["dex", "con"]);
		expect(getCreatureSaveProficiencies({save: {nonsense: "+1"}})).toEqual([]);
		expect(getCreatureSaveProficiencies({})).toEqual([]);
	});
});

describe("Sidekick: the seed a stat block gives a new sidekick", () => {
	it("Carries the numbers a sheet needs", () => {
		const seed = getSidekickSeed(getMonster("Guard"));
		expect(seed.abilities).toEqual({str: 13, dex: 12, con: 12, int: 10, wis: 11, cha: 10});
		expect(seed.ac).toBe(16);
		expect(seed.hpMax).toBe(11);
		expect(seed.hitDie).toBe(8);
		expect(seed.speed).toBe("30 ft.");
		expect(seed.sensesText).toBe("passive Perception 12");
		expect(seed.languagesText).toBe("any one language (usually Common)");
	});

	it("Tolerates a sparse stat block", () => {
		const seed = getSidekickSeed({name: "Blob"});
		expect(seed.abilities).toEqual({});
		expect(seed.ac).toBeNull();
		expect(seed.hpMax).toBeNull();
	});
});

describe("Sidekick: leveling", () => {
	it("Adds the hit die's average plus Constitution for each level after the first", () => {
		// 11 HP base, d8 (average 5) + 1 Con, three levels gained
		expect(getSidekickExpectedHp({baseHp: 11, hitDie: 8, conMod: 1, level: 4})).toBe(11 + 6 * 3);
		expect(getSidekickExpectedHp({baseHp: 11, hitDie: 8, conMod: 1, level: 1})).toBe(11);
	});

	it("Never gains less than one hit point per level", () => {
		expect(getSidekickExpectedHp({baseHp: 4, hitDie: 4, conMod: -5, level: 3})).toBe(4 + 1 * 2);
	});

	it("Uses the character proficiency bonus progression", () => {
		expect([1, 4, 5, 9, 13, 17, 20].map(getSidekickProficiencyBonus)).toEqual([2, 2, 3, 4, 5, 6, 6]);
	});
});

describe("Sidekick: the level table shown to the DM", () => {
	const getClass = name => SIDEKICK_CLASSES.find(it => it.name === name);

	it("Covers all three sidekick classes", () => {
		expect(SIDEKICK_CLASS_NAMES.every(name => !!getClass(name))).toBe(true);
	});

	it("Lists a Warrior's features at the levels they arrive", () => {
		const table = getSidekickLevelTable(getClass("Warrior Sidekick"));
		expect(table).toHaveLength(20);
		expect(table[0].features).toEqual(expect.arrayContaining(["Bonus Proficiencies", "Martial Role"]));
		expect(table[1].features).toContain("Second Wind");
		expect(table[5].features).toContain("Extra Attack");
		expect(table[3].features).toContain("Ability Score Improvement");
	});

	it("Drops the editorial 'Sidekick Class' note", () => {
		const table = getSidekickLevelTable(getClass("Expert Sidekick"));
		expect(table.flatMap(it => it.features)).not.toContain("Sidekick Class");
	});

	it("Carries the proficiency bonus for each level", () => {
		const table = getSidekickLevelTable(getClass("Spellcaster Sidekick"));
		expect(table[0].pb).toBe(2);
		expect(table[19].pb).toBe(6);
	});

	it("Also reads a class whose features the DataLoader already dereferenced", () => {
		// A loaded class holds a by-level array of resolved feature objects rather than refs
		const loaded = {classFeatures: [
			[{name: "Sidekick Class", level: 1}, {name: "Bonus Proficiencies", level: 1}, {name: "Martial Role", level: 1}],
			[{name: "Second Wind", level: 2}],
		]};
		const table = getSidekickLevelTable(loaded);
		expect(table[0].features).toEqual(["Bonus Proficiencies", "Martial Role"]);
		expect(table[1].features).toEqual(["Second Wind"]);
	});

	it("Tolerates missing data", () => {
		expect(getSidekickLevelTable(null)).toHaveLength(20);
		expect(getSidekickLevelTable({}).every(it => !it.features.length)).toBe(true);
	});
});

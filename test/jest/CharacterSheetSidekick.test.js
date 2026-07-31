import * as fs from "fs";
import "../../js/parser.js";
import {
	ESK_SIDEKICK_TYPES,
	findSidekickStatBlock,
	getCreatureAc,
	getCreatureSaveProficiencies,
	getCreatureSizeTypeText,
	getCreatureSkillProficiencies,
	getCreatureSpeed,
	getCreatureTraitEntries,
	getEskFeaturesUpToLevel,
	getEskHpForLevel,
	getEskLevelRow,
	getEskLevelTables,
	getSidekickExpectedHp,
	getSidekickHitDie,
	getSidekickLevelTable,
	getSidekickProficiencyBonus,
	getSidekickRoleOfCreature,
	getSidekickRoles,
	getSidekickSeed,
	getSidekickTypeOfCreature,
	isEntryForRole,
	SIDEKICK_CLASS_NAMES,
	stripRoleQualifier,
} from "../../js/charactersheet/charactersheet-sidekick.js";

const SIDEKICK_CLASSES = JSON.parse(fs.readFileSync("./data/class/class-sidekick.json", "utf8")).class;
const MM = JSON.parse(fs.readFileSync("./data/bestiary/bestiary-mm.json", "utf8")).monster;
const getMonster = name => MM.find(it => it.name === name);

const readBestiary = file => JSON.parse(fs.readFileSync(`./data/bestiary/bestiary-${file}.json`, "utf8")).monster;
const ESK = readBestiary("esk");
const getEsk = name => ESK.find(it => it.name === name);
const ESK_RULE = JSON.parse(fs.readFileSync("./data/variantrules.json", "utf8"))
	.variantrule.find(it => it.name === "Sidekicks" && it.source === "ESK");

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

describe("Sidekick: the three Essentials Kit sidekicks", () => {
	it("Each has a stat block in the data", () => {
		expect(ESK_SIDEKICK_TYPES.map(it => getSidekickTypeOfCreature(getEsk(it.name)))).toEqual(["expert", "spellcaster", "warrior"]);
	});

	it("An ordinary creature is not one of them", () => {
		expect(getSidekickTypeOfCreature(getMonster("Guard"))).toBeNull();
	});
});

describe("Sidekick: the role a Spellcaster or Warrior chooses", () => {
	it("Reads the Warrior's two martial roles from its trait", () => {
		const {traitName, roles} = getSidekickRoles(getEsk("Warrior"));
		expect(traitName).toBe("Martial Role");
		expect(roles.map(it => it.key)).toEqual(["attacker", "defender"]);
		expect(roles[0].text).toMatch(/\+2 bonus to attack rolls/);
	});

	it("Reads the Spellcaster's two magical roles, and what each one casts", () => {
		const {roles} = getSidekickRoles(getEsk("Spellcaster"));
		expect(roles.map(it => it.key)).toEqual(["healer", "mage"]);
		expect(roles.find(it => it.key === "healer").text).toMatch(/Wisdom/);
		expect(roles.find(it => it.key === "healer").text).toMatch(/cure wounds/);
		expect(roles.find(it => it.key === "mage").text).toMatch(/fire bolt/);
	});

	it("The Expert has no role to choose", () => {
		expect(getSidekickRoles(getEsk("Expert")).roles).toEqual([]);
	});

	it("Knows which entries belong to a role", () => {
		const roleKeys = ["attacker", "defender"];
		expect(isEntryForRole("Protection (Defender Only)", {role: "defender", roleKeys})).toBe(true);
		expect(isEntryForRole("Protection (Defender Only)", {role: "attacker", roleKeys})).toBe(false);
		expect(isEntryForRole("Longsword", {role: "attacker", roleKeys})).toBe(true);
		// A longbow's "(Defender Only)"-shaped name is not a role unless the creature has that role
		expect(isEntryForRole("Multiattack (Recharge 5-6)", {role: "attacker", roleKeys})).toBe(true);
	});

	it("Shows both roles' entries until a role is chosen", () => {
		expect(isEntryForRole("Protection (Defender Only)", {role: null, roleKeys: ["attacker", "defender"]})).toBe(true);
	});

	it("Does not repeat the role in each entry's name", () => {
		expect(stripRoleQualifier("Spellcasting (Healer)")).toBe("Spellcasting");
		expect(stripRoleQualifier("Longsword")).toBe("Longsword");
	});
});

describe("Sidekick: traits and actions as separate entries", () => {
	it("Splits a stat block into one entry per trait, action and reaction", () => {
		const entries = getCreatureTraitEntries(getEsk("Warrior"), {role: "defender"});
		expect(entries.map(it => `${it.section}: ${it.name}`)).toEqual([
			"Trait: Martial Role",
			"Action: Longsword",
			"Action: Longbow",
			"Reaction: Protection",
		]);
		expect(entries.find(it => it.name === "Longsword").text).toMatch(/Melee Weapon Attack.*slashing damage/);
	});

	it("Leaves out the other role's entries", () => {
		const attacker = getCreatureTraitEntries(getEsk("Warrior"), {role: "attacker"});
		expect(attacker.some(it => it.name === "Protection")).toBe(false);
	});

	it("Includes only the chosen role's spellcasting", () => {
		const healer = getCreatureTraitEntries(getEsk("Spellcaster"), {role: "healer"});
		const spellcasting = healer.filter(it => it.name === "Spellcasting");
		expect(spellcasting).toHaveLength(1);
		expect(spellcasting[0].text).toMatch(/Cantrips: guidance, sacred flame/);
		expect(spellcasting[0].text).toMatch(/Level 1 \(2 slots\): cure wounds/);
	});

	it("Reads an ordinary creature too", () => {
		const entries = getCreatureTraitEntries(getMonster("Guard"));
		expect(entries.map(it => it.name)).toContain("Spear");
	});
});

describe("Sidekick: the Essentials Kit level tables", () => {
	const tables = getEskLevelTables(ESK_RULE);

	it("Reads a table for each of the three sidekicks", () => {
		expect(Object.keys(tables).sort()).toEqual(["expert", "spellcaster", "warrior"]);
	});

	it("Covers levels 2 through 6", () => {
		expect(tables.warrior.map(it => it.level)).toEqual([2, 3, 4, 5, 6]);
	});

	it("Carries the book's exact hit-point maximum and its formula", () => {
		expect(getEskLevelRow(tables, "warrior", 4)).toMatchObject({hpMax: 32, hpFormula: "5d8 + 10"});
		expect(getEskLevelRow(tables, "expert", 6)).toMatchObject({hpMax: 38, hpFormula: "7d8 + 7"});
		expect(getEskLevelRow(tables, "spellcaster", 2)).toMatchObject({hpMax: 13, hpFormula: "3d8"});
	});

	it("Names the feature each level grants, with its text", () => {
		const row = getEskLevelRow(tables, "warrior", 2);
		expect(row.features.map(it => it.name)).toEqual(["Second Wind"]);
		expect(row.features[0].text).toMatch(/regain hit points equal to 1d10/);
	});

	it("Reads a level that grants two features", () => {
		// The spellcaster's 5th level raises its proficiency bonus *and* its spellcasting
		expect(getEskLevelRow(tables, "spellcaster", 5).features.map(it => it.name)).toEqual(["Proficiency Bonus", "Spellcasting"]);
	});

	it("Accumulates everything gained up to a level", () => {
		const gained = getEskFeaturesUpToLevel(tables, "expert", 4);
		expect(gained.map(it => it.name)).toEqual(["Cunning Action", "Expertise", "Ability Score Improvement"]);
		expect(gained.map(it => it.level)).toEqual([2, 3, 4]);
	});

	it("Takes level 1's hit points from the stat block, later levels from the table", () => {
		expect(getEskHpForLevel(tables, "warrior", 1, {baseCreature: getEsk("Warrior")})).toBe(13); // 2d8 + 4
		expect(getEskHpForLevel(tables, "warrior", 3)).toBe(26);
		expect(getEskHpForLevel(tables, "warrior", 12)).toBeNull();
	});

	it("Tolerates a rule it cannot read", () => {
		expect(getEskLevelTables(null)).toEqual({});
		expect(getEskFeaturesUpToLevel({}, "warrior", 6)).toEqual([]);
	});
});

describe("Sidekick: the published stat block for a higher level", () => {
	const CANDIDATES = [...ESK, ...readBestiary("slw"), ...readBestiary("sdw"), ...readBestiary("dc")]
		.filter(it => getSidekickTypeOfCreature(it));

	it("Knows which role a printed block was statted for", () => {
		expect(getSidekickRoleOfCreature(CANDIDATES.find(it => it.name === "Spellcaster (Healer)"))).toBe("healer");
		expect(getSidekickRoleOfCreature(getEsk("Warrior"))).toBeNull();
	});

	it("Picks the highest printed block at or below the sidekick's level", () => {
		expect(findSidekickStatBlock(CANDIDATES, {type: "warrior", level: 1}).level).toBe(1);
		expect(findSidekickStatBlock(CANDIDATES, {type: "warrior", level: 8}).level).toBe(7);
		expect(findSidekickStatBlock(CANDIDATES, {type: "warrior", level: 20}).level).toBe(11);
	});

	it("Respects the role when the printed blocks are split by one", () => {
		const block = findSidekickStatBlock(CANDIDATES, {type: "spellcaster", role: "mage", level: 9});
		expect(block.name).toBe("Spellcaster (Mage)");
		expect(block.level).toBe(9);
	});

	it("Returns nothing for a type it has no blocks for", () => {
		expect(findSidekickStatBlock(CANDIDATES, {type: "bard", level: 3})).toBeNull();
		expect(findSidekickStatBlock([], {type: "warrior"})).toBeNull();
	});
});

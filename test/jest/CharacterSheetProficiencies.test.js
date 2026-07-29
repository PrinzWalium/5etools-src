import * as fs from "fs";
import "../../js/parser.js";
import {
	PROF_KIND_ARMOR,
	PROF_KIND_LANGUAGE,
	PROF_KIND_TOOL,
	PROF_KIND_WEAPON,
	getClassProficiencies,
	getEntityProficiencies,
	getMulticlassProficiencies,
	getProficiencyDisplay,
	groupProficienciesByKind,
	mergeProficiencies,
} from "../../js/charactersheet/charactersheet-proficiencies.js";

const loadClass = (file, source = "PHB") =>
	JSON.parse(fs.readFileSync(`./data/class/class-${file}.json`, "utf8")).class.find(it => it.source === source);

describe("Proficiencies: display text", () => {
	it("Unwraps item tags, preferring the tag's display text", () => {
		expect(getProficiencyDisplay("{@item thieves' tools|PHB}")).toBe("Thieves' Tools");
		expect(getProficiencyDisplay("{@item Musical Instrument|XPHB|Musical Instruments}")).toBe("Musical Instruments");
	});

	it("Keeps only the name of a bare uid", () => {
		expect(getProficiencyDisplay("battleaxe|phb")).toBe("Battleaxe");
		expect(getProficiencyDisplay("light hammer|phb")).toBe("Light Hammer");
	});

	it("Keeps a filter tag's display text, not its filter expression", () => {
		expect(getProficiencyDisplay("Martial weapons that have the {@filter Finesse or Light|items|type=martial weapon|property=finesse;light} property"))
			.toBe("Martial weapons that have the Finesse or Light property");
	});

	it("Title-cases plain values and tolerates empties", () => {
		expect(getProficiencyDisplay("light")).toBe("Light");
		expect(getProficiencyDisplay("simple")).toBe("Simple");
		expect(getProficiencyDisplay("")).toBe("");
		expect(getProficiencyDisplay(null)).toBe("");
	});
});

describe("Proficiencies: from class starting proficiencies", () => {
	it("Reads a fighter's armor and weapon grants", () => {
		const out = getClassProficiencies(loadClass("fighter"));
		const armor = out.filter(it => it.kind === PROF_KIND_ARMOR).map(it => it.name);
		const weapons = out.filter(it => it.kind === PROF_KIND_WEAPON).map(it => it.name);
		expect(armor).toEqual(expect.arrayContaining(["Light", "Medium", "Heavy", "Shield"]));
		expect(weapons).toEqual(expect.arrayContaining(["Simple", "Martial"]));
	});

	it("Reads a rogue's tool grants through their item tags", () => {
		const tools = getClassProficiencies(loadClass("rogue")).filter(it => it.kind === PROF_KIND_TOOL);
		expect(tools.map(it => it.name)).toEqual(expect.arrayContaining(["Thieves' Tools"]));
	});

	it("Marks data-flagged optional grants", () => {
		// `{proficiency: "firearms", optional: true}` in the artificer/gunslinger-style data
		const cls = {startingProficiencies: {weapons: ["simple", {proficiency: "firearms", optional: true}]}};
		const out = getClassProficiencies(cls);
		expect(out.find(it => it.name === "Firearms").isOptional).toBe(true);
		expect(out.find(it => it.name === "Simple").isOptional).toBe(false);
	});

	it("Prefers the `full` text when the data supplies one, cased as a sentence", () => {
		const cls = {startingProficiencies: {armor: [{proficiency: "shield", full: "shields (druids will not wear metal)"}]}};
		expect(getClassProficiencies(cls)[0].name).toBe("Shields (druids will not wear metal)");
	});

	it("Skips choice entries, which the choice engine resolves", () => {
		const cls = {startingProficiencies: {tools: [{choose: {from: ["a", "b"]}}]}};
		expect(getClassProficiencies(cls)).toEqual([]);
		expect(getClassProficiencies({})).toEqual([]);
		expect(getClassProficiencies(null)).toEqual([]);
	});
});

describe("Proficiencies: from backgrounds and species", () => {
	it("Reads a background's fixed tool grant", () => {
		const bg = {toolProficiencies: [{"disguise kit": true}]};
		expect(getEntityProficiencies(bg)).toEqual([{kind: PROF_KIND_TOOL, name: "Disguise Kit", isOptional: false}]);
	});

	it("Reads a species' fixed weapon, armor and language grants", () => {
		const race = {
			weaponProficiencies: [{"battleaxe|phb": true, "handaxe|phb": true}],
			armorProficiencies: [{light: true}],
			languageProficiencies: [{common: true, dwarvish: true}],
		};
		const out = getEntityProficiencies(race);
		expect(out.filter(it => it.kind === PROF_KIND_WEAPON).map(it => it.name)).toEqual(["Battleaxe", "Handaxe"]);
		expect(out.filter(it => it.kind === PROF_KIND_ARMOR).map(it => it.name)).toEqual(["Light"]);
		expect(out.filter(it => it.kind === PROF_KIND_LANGUAGE).map(it => it.name)).toEqual(["Common", "Dwarvish"]);
	});

	it("Skips count- and choice-based entries (they are picks)", () => {
		expect(getEntityProficiencies({toolProficiencies: [{any: 2}, {anyArtisansTool: 2}]})).toEqual([]);
		expect(getEntityProficiencies({languageProficiencies: [{anyStandard: 2}]})).toEqual([]);
		expect(getEntityProficiencies({toolProficiencies: [{choose: {from: ["smith's tools"]}}]})).toEqual([]);
		expect(getEntityProficiencies({})).toEqual([]);
		expect(getEntityProficiencies(null)).toEqual([]);
	});
});

describe("Proficiencies: merging and grouping", () => {
	it("Folds duplicates together, keeping every granting source", () => {
		const merged = mergeProficiencies([
			{kind: PROF_KIND_TOOL, name: "Thieves' Tools", source: "Rogue"},
			{kind: PROF_KIND_TOOL, name: "Thieves' Tools", source: "Criminal"},
			{kind: PROF_KIND_ARMOR, name: "Light", source: "Rogue"},
		]);
		expect(merged).toHaveLength(2);
		expect(merged.find(it => it.name === "Thieves' Tools").sources).toEqual(["Rogue", "Criminal"]);
	});

	it("Treats a proficiency as non-optional once anything grants it outright", () => {
		const merged = mergeProficiencies([
			{kind: PROF_KIND_WEAPON, name: "Firearms", source: "Class", isOptional: true},
			{kind: PROF_KIND_WEAPON, name: "Firearms", source: "Background", isOptional: false},
		]);
		expect(merged[0].isOptional).toBe(false);
	});

	it("Groups by kind in display order, sorted, dropping empty kinds", () => {
		const groups = groupProficienciesByKind([
			{kind: PROF_KIND_WEAPON, name: "Simple", source: "Rogue"},
			{kind: PROF_KIND_ARMOR, name: "Light", source: "Rogue"},
			{kind: PROF_KIND_WEAPON, name: "Martial", source: "Fighter"},
		]);
		expect(groups.map(g => g.label)).toEqual(["Armor", "Weapons"]); // no tools/languages
		expect(groups[1].items.map(i => i.name)).toEqual(["Martial", "Simple"]); // sorted
	});

	it("Keeps the ids of every folded entry, so removal can drop them all", () => {
		const merged = mergeProficiencies([
			{id: "a", kind: PROF_KIND_TOOL, name: "Thieves' Tools", source: "Rogue"},
			{id: "b", kind: PROF_KIND_TOOL, name: "Thieves' tools", source: "Criminal"},
		]);
		expect(merged).toHaveLength(1);
		expect(merged[0].ids).toEqual(["a", "b"]);
	});

	it("Tolerates empty input", () => {
		expect(mergeProficiencies([])).toEqual([]);
		expect(mergeProficiencies(null)).toEqual([]);
		expect(groupProficienciesByKind([])).toEqual([]);
	});
});

describe("Proficiencies: multiclassing", () => {
	it("Grants only the multiclass subset, not the full starting list", () => {
		const cls = loadClass("fighter");
		const starting = getClassProficiencies(cls).filter(it => it.kind === PROF_KIND_ARMOR).map(it => it.name);
		const multi = getMulticlassProficiencies(cls).filter(it => it.kind === PROF_KIND_ARMOR).map(it => it.name);
		// A fighter starts with all armor, but multiclassing in grants light/medium/shields only
		expect(starting).toContain("Heavy");
		expect(multi).not.toContain("Heavy");
		expect(multi).toContain("Light");
	});

	it("Returns nothing for a class which grants none, and tolerates missing data", () => {
		expect(getMulticlassProficiencies({multiclassing: {}})).toEqual([]);
		expect(getMulticlassProficiencies(null)).toEqual([]);
	});
});

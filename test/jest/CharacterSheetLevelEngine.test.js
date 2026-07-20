import * as fs from "fs";
import "../../js/parser.js";
import {
	getAsiCount,
	getCantripsKnown,
	getCasterLevelContribution,
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

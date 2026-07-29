import * as fs from "fs";
import "../../js/parser.js";
import {getTraitChoiceResist, getTraitChoices, stripEntryTags} from "../../js/charactersheet/charactersheet-traitchoices.js";

const RACES = JSON.parse(fs.readFileSync("./data/races.json", "utf8")).race;
const loadRace = (name, source) => RACES.find(it => it.name === name && it.source === source);
const getChoice = (name, source, trait) => getTraitChoices(loadRace(name, source)).find(it => it.trait === trait);

describe("Trait choices: tag stripping", () => {
	it("Keeps a tag's display text", () => {
		expect(stripEntryTags("You have {@variantrule Resistance|XPHB} to Fire damage.")).toBe("You have Resistance to Fire damage.");
		expect(stripEntryTags("{@sense Darkvision|XPHB|darkvision} 120 feet")).toBe("darkvision 120 feet");
	});

	it("Unwraps nested tags and tolerates plain text", () => {
		expect(stripEntryTags("{@spell Fire Bolt|XPHB} and {@item Torch|XPHB}")).toBe("Fire Bolt and Torch");
		expect(stripEntryTags("plain")).toBe("plain");
		expect(stripEntryTags(null)).toBe("");
	});
});

describe("Trait choices: list-shaped traits", () => {
	it("Reads a Goliath's Giant Ancestry options", () => {
		const choice = getChoice("Goliath", "XPHB", "Giant Ancestry");
		expect(choice.level).toBe(1);
		expect(choice.options.map(it => it.name)).toEqual([
			"Cloud's Jaunt (Cloud Giant)", "Fire's Burn (Fire Giant)", "Frost's Chill (Frost Giant)",
			"Hill's Tumble (Hill Giant)", "Stone's Endurance (Stone Giant)", "Storm's Thunder (Storm Giant)",
		]);
		expect(choice.options[0].desc).toMatch(/Bonus Action/);
	});

	it("Reads the level a later trait is chosen at", () => {
		expect(getChoice("Aasimar", "XPHB", "Celestial Revelation").level).toBe(3);
	});
});

describe("Trait choices: table-shaped traits", () => {
	it("Reads an Elf's lineages, with each option's benefit as its description", () => {
		const choice = getChoice("Elf", "XPHB", "Elven Lineage");
		expect(choice.options.map(it => it.name)).toEqual(["Drow", "High Elf", "Wood Elf"]);
		expect(choice.options[0].desc).toMatch(/Darkvision/);
	});

	it("Maps a Dragonborn's ancestry to the damage resistance it grants", () => {
		const choice = getChoice("Dragonborn", "XPHB", "Draconic Ancestry");
		expect(choice.options).toHaveLength(10);
		expect(getTraitChoiceResist(choice, "Black")).toBe("acid");
		expect(getTraitChoiceResist(choice, "Silver")).toBe("cold");
		expect(getTraitChoiceResist(choice, "Nonesuch")).toBeNull();
	});

	it("Leaves traits without a resistance column unmapped", () => {
		expect(getChoice("Elf", "XPHB", "Elven Lineage").resistByOption).toBeNull();
		expect(getTraitChoiceResist(null, "Drow")).toBeNull();
	});
});

describe("Trait choices: what is and is not a choice", () => {
	it("Ignores traits that merely describe something", () => {
		const traits = getTraitChoices(loadRace("Dwarf", "XPHB")).map(it => it.trait);
		expect(traits).toEqual([]);
	});

	it("Finds every species written as a pick, and nothing else", () => {
		const found = RACES.flatMap(r => getTraitChoices(r).map(c => `${r.name} (${r.source}): ${c.trait}`));
		expect(found).toEqual(expect.arrayContaining([
			"Dragonborn (XPHB): Draconic Ancestry",
			"Elf (XPHB): Elven Lineage",
			"Tiefling (XPHB): Fiendish Legacy",
			"Gnome (XPHB): Gnomish Lineage",
			"Kobold (MPMM): Kobold Legacy",
		]));
		// A conservative extractor: a handful of species, not a long tail of false positives
		expect(found.length).toBeLessThan(25);
	});

	it("Tolerates missing input", () => {
		expect(getTraitChoices(null)).toEqual([]);
		expect(getTraitChoices({entries: ["just prose"]})).toEqual([]);
	});
});

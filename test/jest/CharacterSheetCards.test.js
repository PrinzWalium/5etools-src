import * as fs from "fs";
import "../../js/parser.js";
import "../../js/utils.js"; // the parser leans on its Array/String extensions
import {getAttackCard, getCardDeck, getSpellCard} from "../../js/charactersheet/charactersheet-cards.js";

const SPELLS = JSON.parse(fs.readFileSync("./data/spells/spells-phb.json", "utf8")).spell;
const getSpell = name => SPELLS.find(it => it.name === name);

const metaOf = (card, label) => card.meta.find(it => it.label === label)?.value;

describe("Cards: a spell", () => {
	it("Carries what a player needs mid-turn", () => {
		const card = getSpellCard(getSpell("Fireball"));
		expect(card.name).toBe("Fireball");
		expect(card.subtitle).toBe("3rd-level evocation"); // the books lower-case the school
		expect(metaOf(card, "Cast")).toMatch(/action/i);
		expect(metaOf(card, "Range")).toBe("150 feet");
		expect(metaOf(card, "Components")).toMatch(/V, S, M/);
		expect(metaOf(card, "Duration")).toMatch(/Instantaneous/i);
	});

	it("Has the spell's own text, as readable paragraphs", () => {
		const card = getSpellCard(getSpell("Fireball"));
		expect(card.paragraphs.length).toBeGreaterThan(0);
		expect(card.paragraphs.join(" ")).toMatch(/bright streak/i);
		// Tags are resolved to their display text rather than printed raw
		expect(card.paragraphs.join(" ")).not.toMatch(/\{@/);
	});

	it("Keeps the at-higher-levels clause separate", () => {
		const card = getSpellCard(getSpell("Fireball"));
		expect(card.higherLevel).toMatch(/increases by 1d6/i);
		expect(getSpellCard(getSpell("Light")).higherLevel).toBeNull();
	});

	it("Flags concentration and ritual", () => {
		expect(getSpellCard(getSpell("Fog Cloud")).isConcentration).toBe(true);
		expect(getSpellCard(getSpell("Fireball")).isConcentration).toBe(false);
		expect(getSpellCard(getSpell("Detect Magic")).isRitual).toBe(true);
		expect(getSpellCard(getSpell("Fireball")).isRitual).toBe(false);
	});

	it("Puts the character's own numbers on the card", () => {
		const save = getSpellCard(getSpell("Fireball"), {derivedSpell: {dc: 15, atkMod: 7}});
		expect(metaOf(save, "Save")).toBe("DEX DC 15");

		const attack = getSpellCard(getSpell("Fire Bolt"), {derivedSpell: {dc: 15, atkMod: 7}});
		expect(metaOf(attack, "Attack")).toBe("+7 to hit");
	});

	it("Leaves those off when the character has no spellcasting", () => {
		const card = getSpellCard(getSpell("Fireball"));
		expect(metaOf(card, "Save")).toBeUndefined();
		expect(metaOf(card, "Attack")).toBeUndefined();
	});

	it("Reads a spell whose text has named sub-entries", () => {
		// Control Weather and its like nest named blocks inside `entries`
		const card = getSpellCard(getSpell("Control Weather"));
		expect(card.paragraphs.some(it => /\w+\.\s/.test(it))).toBe(true);
		expect(card.paragraphs.join(" ")).not.toMatch(/\{@/);
	});

	it("Tolerates being handed nothing", () => {
		expect(getSpellCard(null)).toBeNull();
	});
});

describe("Cards: an attack", () => {
	it("Shows the two numbers that matter", () => {
		const card = getAttackCard({name: "Longsword", atkBonus: 6, damage: "1d8+4 slashing"});
		expect(card).toMatchObject({name: "Longsword", subtitle: "Weapon Attack"});
		expect(metaOf(card, "To hit")).toBe("+6");
		expect(metaOf(card, "Damage")).toBe("1d8+4 slashing");
	});

	it("Signs a negative bonus properly, and copes with no damage set", () => {
		const card = getAttackCard({name: "Improvised", atkBonus: -1});
		expect(metaOf(card, "To hit")).toBe("−1");
		expect(metaOf(card, "Damage")).toBe("—");
	});

	it("Skips a row with no name", () => {
		expect(getAttackCard({atkBonus: 3})).toBeNull();
		expect(getAttackCard(null)).toBeNull();
	});
});

describe("Cards: the deck", () => {
	const byKey = new Map(SPELLS.map(sp => [`${sp.name.toLowerCase()}|${sp.source.toLowerCase()}`, sp]));

	it("Sorts spells by level, then by name", () => {
		const deck = getCardDeck({
			spellsKnown: [
				{name: "Fireball", source: "PHB"},
				{name: "Fire Bolt", source: "PHB"},
				{name: "Bless", source: "PHB"},
				{name: "Aid", source: "PHB"},
			],
			byKey,
		});
		expect(deck.map(it => it.name)).toEqual(["Fire Bolt", "Bless", "Aid", "Fireball"]);
	});

	it("Puts the attacks after the spells", () => {
		const deck = getCardDeck({
			spellsKnown: [{name: "Bless", source: "PHB"}],
			attacks: [{name: "Mace", atkBonus: 4, damage: "1d6+2"}],
			byKey,
		});
		expect(deck.map(it => it.name)).toEqual(["Bless", "Mace"]);
	});

	it("Skips a spell whose data cannot be found rather than printing a blank card", () => {
		const deck = getCardDeck({spellsKnown: [{name: "Homebrew Zap", source: "XYZ"}, {name: "Bless", source: "PHB"}], byKey});
		expect(deck.map(it => it.name)).toEqual(["Bless"]);
	});

	it("Copes with a character who has neither", () => {
		expect(getCardDeck({})).toEqual([]);
	});
});

/**
 * Shared constants for the character sheet.
 * Kept dependency-free so both the (DOM-facing) page and the (pure) derivation logic can import them.
 */

export const CHAR_SHEET_SCHEMA_VERSION = 2;

export const CHAR_SHEET_ABILITIES = [
	["str", "Strength"],
	["dex", "Dexterity"],
	["con", "Constitution"],
	["int", "Intelligence"],
	["wis", "Wisdom"],
	["cha", "Charisma"],
];

export const CHAR_SHEET_SKILLS = [
	{key: "acrobatics", name: "Acrobatics", ability: "dex"},
	{key: "animalHandling", name: "Animal Handling", ability: "wis"},
	{key: "arcana", name: "Arcana", ability: "int"},
	{key: "athletics", name: "Athletics", ability: "str"},
	{key: "deception", name: "Deception", ability: "cha"},
	{key: "history", name: "History", ability: "int"},
	{key: "insight", name: "Insight", ability: "wis"},
	{key: "intimidation", name: "Intimidation", ability: "cha"},
	{key: "investigation", name: "Investigation", ability: "int"},
	{key: "medicine", name: "Medicine", ability: "wis"},
	{key: "nature", name: "Nature", ability: "int"},
	{key: "perception", name: "Perception", ability: "wis"},
	{key: "performance", name: "Performance", ability: "cha"},
	{key: "persuasion", name: "Persuasion", ability: "cha"},
	{key: "religion", name: "Religion", ability: "int"},
	{key: "sleightOfHand", name: "Sleight of Hand", ability: "dex"},
	{key: "stealth", name: "Stealth", ability: "dex"},
	{key: "survival", name: "Survival", ability: "wis"},
];

export const PROF_STATE_NONE = 0;
export const PROF_STATE_PROFICIENT = 1;
export const PROF_STATE_EXPERTISE = 2;

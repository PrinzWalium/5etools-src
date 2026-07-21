/**
 * Pure parsing of `startingEquipment` data into renderable/resolvable choice groups.
 *
 * `defaultData` groups map option keys ("a"/"b"/..., uppercase in 2024-style data, "_" for
 * always-granted) to item lists whose entries are `"uid"` strings, `{item, quantity, displayName}`,
 * `{special, quantity}`, `{equipmentType, quantity}`, or `{value}` (coins, in cp).
 */

export const EQUIPMENT_ALWAYS_KEY = "_";

/** Parse an item uid ("chain mail|phb") into `{name, source}`; source defaults to PHB. */
export function getItemUidParts (uid) {
	const [name, source] = String(uid).split("|");
	return {name: name.trim(), source: (source || "phb").trim()};
}

/** Parse a bonus string/number like "+1" or "2" into a signed integer (0 when absent/invalid). */
export function parseItemBonus (val) {
	if (val == null) return 0;
	const n = Number(String(val).replace(/[^-\d]/g, ""));
	return isNaN(n) ? 0 : n;
}

/**
 * Extract the mechanical fields a character sheet needs from an item entity — armor class,
 * armor category and Dex cap, weapon damage/properties, magic AC/attack bonuses, and attunement.
 * Kept flat so it can be stored directly on an inventory row and read by the pure derivations.
 */
export function getInventoryItemMeta (ent) {
	if (!ent) return {};
	const out = {};
	const type = String(ent.type || "").split("|")[0];
	if (type) out.type = type;
	if (ent.armor) out.isArmor = true;
	if (ent.ac != null) out.baseAc = Number(ent.ac) || 0;
	if (ent.dexterityMax != null) out.dexterityMax = Number(ent.dexterityMax);
	if (ent.stealth) out.stealth = true;
	if (ent.weapon) out.isWeapon = true;
	if (ent.dmg1) out.dmg1 = ent.dmg1;
	if (ent.dmgType) out.dmgType = ent.dmgType;
	if (ent.property?.length) out.properties = ent.property.map(p => String(p).split("|")[0]);
	if (ent.weaponCategory) out.weaponCategory = ent.weaponCategory;
	const bonusAc = parseItemBonus(ent.bonusAc);
	if (bonusAc) out.bonusAc = bonusAc;
	// `bonusWeapon` applies to both rolls; `bonusWeaponAttack`/`bonusWeaponDamage` are roll-specific.
	const bonusShared = parseItemBonus(ent.bonusWeapon);
	const bonusAttack = bonusShared + parseItemBonus(ent.bonusWeaponAttack);
	const bonusDamage = bonusShared + parseItemBonus(ent.bonusWeaponDamage);
	if (bonusAttack) out.bonusAttack = bonusAttack;
	if (bonusDamage) out.bonusDamage = bonusDamage;
	const bonusSpellAttack = parseItemBonus(ent.bonusSpellAttack);
	if (bonusSpellAttack) out.bonusSpellAttack = bonusSpellAttack;
	const bonusSpellSaveDc = parseItemBonus(ent.bonusSpellSaveDc);
	if (bonusSpellSaveDc) out.bonusSpellSaveDc = bonusSpellSaveDc;
	const bonusSavingThrow = parseItemBonus(ent.bonusSavingThrow);
	if (bonusSavingThrow) out.bonusSavingThrow = bonusSavingThrow;
	if (ent.reqAttune) out.requiresAttunement = true;
	return out;
}

/** Display a copper-piece value in the largest sensible coin, e.g. 400 → "4 gp". */
export function getCoinDisplay (valueCp) {
	if (valueCp % 100 === 0) return `${valueCp / 100} gp`;
	if (valueCp % 10 === 0) return `${valueCp / 10} sp`;
	return `${valueCp} cp`;
}

const _EQUIPMENT_TYPE_DISPLAY = {
	weaponSimple: "a simple weapon",
	weaponSimpleMelee: "a simple melee weapon",
	weaponMartial: "a martial weapon",
	weaponMartialMelee: "a martial melee weapon",
	instrumentMusical: "a musical instrument",
	armorLight: "light armor",
	armorMedium: "medium armor",
	armorHeavy: "heavy armor",
	weaponMelee: "a melee weapon",
	weaponRanged: "a ranged weapon",
	focusSpellcasting: "a spellcasting focus",
	setGaming: "a gaming set",
	toolArtisan: "artisan's tools",
};

/**
 * Normalise one item entry.
 * @return {{kind: "item"|"special"|"placeholder"|"coins", name?, source?, quantity, display}}
 */
export function getNormalisedEquipmentEntry (entry) {
	if (typeof entry === "string") {
		const {name, source} = getItemUidParts(entry);
		return {kind: "item", name, source, quantity: 1, display: name};
	}
	if (entry.item) {
		const {name, source} = getItemUidParts(entry.item);
		return {kind: "item", name, source, quantity: entry.quantity || 1, display: entry.displayName || name};
	}
	if (entry.special) {
		return {kind: "special", quantity: entry.quantity || 1, display: entry.special};
	}
	if (entry.equipmentType) {
		const display = _EQUIPMENT_TYPE_DISPLAY[entry.equipmentType] || entry.equipmentType;
		return {kind: "placeholder", quantity: entry.quantity || 1, display};
	}
	if (entry.value != null) {
		return {kind: "coins", quantity: 1, value: entry.value, display: getCoinDisplay(entry.value)};
	}
	return {kind: "special", quantity: 1, display: JSON.stringify(entry)};
}

/**
 * Parse `startingEquipment.defaultData` (or a background's `startingEquipment`) into choice groups.
 * @return {Array<{options: Array<{key: string, entries: Array}>, isChoice: boolean}>}
 */
export function getEquipmentChoiceGroups (defaultData) {
	return (defaultData || [])
		.map(grp => {
			const options = Object.entries(grp)
				.filter(([, entries]) => Array.isArray(entries))
				.map(([key, entries]) => ({
					key,
					entries: entries.map(getNormalisedEquipmentEntry),
				}));
			if (!options.length) return null;
			return {
				options,
				isChoice: !(options.length === 1 && options[0].key === EQUIPMENT_ALWAYS_KEY),
			};
		})
		.filter(Boolean);
}

/** Display text for one option's entries, e.g. "chain mail, 2× handaxe, 4 gp". */
export function getEquipmentOptionDisplay (option) {
	return option.entries
		.map(it => `${it.quantity > 1 ? `${it.quantity}× ` : ""}${it.display}`)
		.join(", ");
}

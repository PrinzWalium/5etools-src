/**
 * Curated passive effects of class/subclass features that are easy to apply mechanically but live
 * as prose in the data (so they can't be read structurally). Kept small and unambiguous; anything
 * not here stays a linked feature reference.
 */

/** Features that add to Initiative. `ability` = add that ability modifier; `halfProf` = add ⌊PB/2⌋. */
export const INITIATIVE_FEATURES = {
	"Rakish Audacity": {ability: "cha"}, // Rogue (Swashbuckler)
	"Jack of All Trades": {halfProf: true}, // Bard
};

/**
 * Total Initiative bonus from the character's features.
 * @param featureNames the character's feature names
 * @param ctx `{abilities: {abv: mod}, pb}`
 */
export function getFeatureInitiativeBonus (featureNames, {abilities = {}, pb = 0} = {}) {
	let bonus = 0;
	const seen = new Set();
	(featureNames || []).forEach(name => {
		if (seen.has(name)) return;
		seen.add(name);
		const eff = INITIATIVE_FEATURES[name];
		if (!eff) return;
		if (eff.ability) bonus += Number(abilities[eff.ability]) || 0;
		if (eff.halfProf) bonus += Math.floor(pb / 2);
	});
	return bonus;
}

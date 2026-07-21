/**
 * Ability score generation methods: pure rules logic for the guided creation flow.
 * Standard Array and Point Buy are fixed core rules (PHB), so their tables live here.
 */

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN_SCORE = 8;
export const POINT_BUY_MAX_SCORE = 15;

const _POINT_BUY_COSTS = {8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9};

export const ABILITY_METHOD_STANDARD_ARRAY = "standardArray";
export const ABILITY_METHOD_POINT_BUY = "pointBuy";
export const ABILITY_METHOD_MANUAL = "manual";

/** Point-buy cost of a single score, or null if the score is not purchasable. */
export function getPointBuyCost (score) {
	return _POINT_BUY_COSTS[score] ?? null;
}

/**
 * Total point-buy cost of a `{str: score, ...}` map.
 * @return {?number} Total cost, or null if any score is outside the purchasable range.
 */
export function getPointBuyTotalCost (scoreByAbv) {
	let total = 0;
	for (const score of Object.values(scoreByAbv)) {
		const cost = getPointBuyCost(score);
		if (cost == null) return null;
		total += cost;
	}
	return total;
}

/**
 * Validate a standard-array assignment `{str: score|null, ...}`.
 * Valid iff every ability has a value and the values are exactly the standard array.
 */
export function isValidStandardArrayAssignment (scoreByAbv) {
	const vals = Object.values(scoreByAbv);
	if (vals.some(v => v == null)) return false;
	const sorted = [...vals].sort((a, b) => b - a);
	const expected = [...STANDARD_ARRAY].sort((a, b) => b - a);
	return sorted.length === expected.length && sorted.every((v, i) => v === expected[i]);
}

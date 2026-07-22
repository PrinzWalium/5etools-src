/**
 * Pure derivation of the action economy (Actions / Bonus Actions / Reactions) shown in Play mode.
 *
 * Sources, in order of reliability:
 *  - weapon attacks and the Unarmed Strike (always the Attack action),
 *  - known/prepared spells, bucketed by their casting time,
 *  - a small curated map of common class/feat features whose action economy is unambiguous.
 * Anything not covered is left to the linked feature/spell references elsewhere on the sheet.
 */

/** Curated feature → action economy. Kept deliberately small and to unambiguous cases. */
export const FEATURE_ACTION_ECONOMY = {
	// Bonus actions
	"Second Wind": "bonus",
	"Rage": "bonus",
	"Cunning Action": "bonus",
	"Bardic Inspiration": "bonus",
	"Flurry of Blows": "bonus",
	"Patient Defense": "bonus",
	"Step of the Wind": "bonus",
	"Two-Weapon Fighting": "bonus",
	"Healing Hands": "bonus",
	// Reactions
	"Uncanny Dodge": "reaction",
	"Deflect Missiles": "reaction",
	"Slow Fall": "reaction",
	"Riposte": "reaction",
	"Cutting Words": "reaction",
	// Actions
	"Action Surge": "action",
	"Channel Divinity": "action",
	"Lay on Hands": "action",
	"Wild Shape": "action",
	"Second-Story Work": "action",
};

const _fmtBonus = n => `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;

/** Normalise a spell's `time` (array of `{number, unit}`, or a string) to an economy bucket. */
export function normaliseCastTime (time) {
	const unit = Array.isArray(time) ? time[0]?.unit : (typeof time === "string" ? time : null);
	if (unit === "action") return "action";
	if (unit === "bonus") return "bonus";
	if (unit === "reaction") return "reaction";
	return "other"; // minutes/hours (rituals, prep) — not a combat action
}

/**
 * Build the grouped action economy.
 * @param attacks weapon attack rows `[{name, atkBonus, damage}]`
 * @param unarmed the derived Unarmed Strike `{name, atkBonus, damage}` (optional)
 * @param spells known spells `[{name, source, level, castTime}]`
 * @param features character features, each a name string or `{name, tag}` (tag = a renderable `{@...}` link)
 * @return {{action: Array, bonus: Array, reaction: Array}}
 */
export function buildActionEconomy ({attacks = [], unarmed = null, spells = [], features = []} = {}) {
	const out = {action: [], bonus: [], reaction: []};

	const addWeapon = a => {
		if (!a?.name) return;
		out.action.push({label: a.name, sub: `${_fmtBonus(a.atkBonus)} to hit${a.damage ? `, ${a.damage}` : ""}`, kind: "weapon"});
	};
	attacks.forEach(addWeapon);
	if (unarmed) addWeapon(unarmed);

	spells.forEach(sp => {
		// Unknown casting time (e.g. legacy saves) defaults to Action, which fits the large majority of spells.
		const ct = sp.castTime === "bonus" || sp.castTime === "reaction" || sp.castTime === "action" ? sp.castTime : "action";
		if (sp.castTime === "other") return; // ritual/long-cast: skip the combat economy
		out[ct].push({label: sp.name, source: sp.source, sub: sp.level === 0 ? "Cantrip" : `Level ${sp.level}`, kind: "spell"});
	});

	const seen = new Set();
	features.forEach(f => {
		const name = typeof f === "string" ? f : f?.name;
		const tag = typeof f === "string" ? null : f?.tag;
		if (!name || seen.has(name)) return;
		seen.add(name);
		const econ = FEATURE_ACTION_ECONOMY[name];
		if (econ && out[econ]) out[econ].push({label: name, kind: "feature", tag});
	});

	return out;
}

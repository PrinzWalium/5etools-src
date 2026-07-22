import {buildActionEconomy, normaliseCastTime} from "../../js/charactersheet/charactersheet-actions.js";

describe("Action economy: casting-time normalisation", () => {
	it("Should map a spell's time to an economy bucket", () => {
		expect(normaliseCastTime([{number: 1, unit: "action"}])).toBe("action");
		expect(normaliseCastTime([{number: 1, unit: "bonus"}])).toBe("bonus");
		expect(normaliseCastTime([{number: 1, unit: "reaction"}])).toBe("reaction");
		expect(normaliseCastTime([{number: 1, unit: "minute"}])).toBe("other");
		expect(normaliseCastTime("bonus")).toBe("bonus");
		expect(normaliseCastTime(null)).toBe("other");
	});
});

describe("Action economy: grouping", () => {
	it("Should list weapons and the Unarmed Strike as Actions", () => {
		const out = buildActionEconomy({
			attacks: [{name: "Longsword", atkBonus: 6, damage: "1d8+3 slashing"}],
			unarmed: {name: "Unarmed Strike", atkBonus: 5, damage: "3 bludgeoning"},
		});
		expect(out.action.map(a => a.label)).toEqual(["Longsword", "Unarmed Strike"]);
		expect(out.action[0].sub).toBe("+6 to hit, 1d8+3 slashing");
		expect(out.bonus).toHaveLength(0);
	});

	it("Should bucket spells by casting time, defaulting unknowns to Action and skipping long casts", () => {
		const out = buildActionEconomy({
			spells: [
				{name: "Fire Bolt", level: 0, castTime: "action"},
				{name: "Healing Word", level: 1, castTime: "bonus"},
				{name: "Shield", level: 1, castTime: "reaction"},
				{name: "Mystery", level: 2, castTime: null}, // default → action
				{name: "Detect Magic", level: 1, castTime: "other"}, // ritual/long — skipped
			],
		});
		expect(out.action.map(a => a.label).sort()).toEqual(["Fire Bolt", "Mystery"]);
		expect(out.bonus.map(a => a.label)).toEqual(["Healing Word"]);
		expect(out.reaction.map(a => a.label)).toEqual(["Shield"]);
	});

	it("Should place curated features in their economy and ignore unknown features", () => {
		const out = buildActionEconomy({
			features: ["Second Wind", "Uncanny Dodge", "Channel Divinity", "Sneak Attack", "Second Wind"],
		});
		expect(out.bonus.map(a => a.label)).toEqual(["Second Wind"]); // de-duplicated
		expect(out.reaction.map(a => a.label)).toEqual(["Uncanny Dodge"]);
		expect(out.action.map(a => a.label)).toEqual(["Channel Divinity"]);
		// "Sneak Attack" is not in the curated map → not listed as its own action
		expect([...out.action, ...out.bonus, ...out.reaction].some(a => a.label === "Sneak Attack")).toBe(false);
	});

	it("Should carry a renderable tag on features for hover links", () => {
		const out = buildActionEconomy({features: [{name: "Cunning Action", tag: "{@classFeature Cunning Action|Rogue||2}"}]});
		expect(out.bonus[0]).toMatchObject({label: "Cunning Action", kind: "feature", tag: "{@classFeature Cunning Action|Rogue||2}"});
	});
});

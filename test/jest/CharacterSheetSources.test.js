import {
	SOURCE_MODE_ALL,
	SOURCE_MODE_CLASSIC,
	SOURCE_MODE_CUSTOM,
	SOURCE_MODE_MODERN,
	getDefaultSourceFilter,
	getOutOfFilterSources,
	getSourceFilterLabel,
	getSourceFilterPredicate,
	getUsedSources,
	isSourceAllowed,
	isSourceFilterInactive,
} from "../../js/charactersheet/charactersheet-sources.js";

// Stand-in for SourceUtil.isClassicSource: 2014-era books are "classic"
const CLASSIC = new Set(["PHB", "XGE", "TCE", "SCAG", "EGW"]);
const opts = {isClassic: src => CLASSIC.has(src)};

describe("Source filter: predicate", () => {
	it("Allows everything by default", () => {
		const filter = getDefaultSourceFilter();
		expect(isSourceFilterInactive(filter)).toBe(true);
		expect(isSourceAllowed("PHB", filter, opts)).toBe(true);
		expect(isSourceAllowed("XPHB", filter, opts)).toBe(true);
		expect(getSourceFilterPredicate(filter, opts)).toBeNull();
	});

	it("Restricts to the 2024 ruleset", () => {
		const filter = {mode: SOURCE_MODE_MODERN, sources: {}};
		expect(isSourceAllowed("XPHB", filter, opts)).toBe(true);
		expect(isSourceAllowed("XDMG", filter, opts)).toBe(true);
		expect(isSourceAllowed("PHB", filter, opts)).toBe(false);
		expect(isSourceAllowed("TCE", filter, opts)).toBe(false);
	});

	it("Restricts to the 2014 ruleset", () => {
		const filter = {mode: SOURCE_MODE_CLASSIC, sources: {}};
		expect(isSourceAllowed("PHB", filter, opts)).toBe(true);
		expect(isSourceAllowed("XGE", filter, opts)).toBe(true);
		expect(isSourceAllowed("XPHB", filter, opts)).toBe(false);
	});

	it("Honours an explicit custom book list", () => {
		const filter = {mode: SOURCE_MODE_CUSTOM, sources: {PHB: true, XGE: true, TCE: false}};
		expect(isSourceAllowed("PHB", filter, opts)).toBe(true);
		expect(isSourceAllowed("XGE", filter, opts)).toBe(true);
		expect(isSourceAllowed("TCE", filter, opts)).toBe(false);
		expect(isSourceAllowed("XPHB", filter, opts)).toBe(false); // absent => not allowed
	});

	it("Never hides unsourced content", () => {
		expect(isSourceAllowed(null, {mode: SOURCE_MODE_MODERN}, opts)).toBe(true);
		expect(isSourceAllowed(undefined, {mode: SOURCE_MODE_CUSTOM, sources: {}}, opts)).toBe(true);
	});

	it("Falls back to allowing everything when no classifier is supplied", () => {
		// The era modes need the 2014/2024 classification; without it, don't hide anything
		expect(isSourceAllowed("PHB", {mode: SOURCE_MODE_MODERN})).toBe(true);
		expect(isSourceAllowed("XPHB", {mode: SOURCE_MODE_CLASSIC})).toBe(true);
	});

	it("Builds a reusable predicate", () => {
		const fn = getSourceFilterPredicate({mode: SOURCE_MODE_MODERN, sources: {}}, opts);
		expect(["XPHB", "PHB"].filter(fn)).toEqual(["XPHB"]);
	});
});

describe("Source filter: labels", () => {
	it("Names the presets", () => {
		expect(getSourceFilterLabel(getDefaultSourceFilter())).toBe("All sources");
		expect(getSourceFilterLabel({mode: SOURCE_MODE_MODERN})).toBe("2024 rules only");
		expect(getSourceFilterLabel({mode: SOURCE_MODE_CLASSIC})).toBe("2014 rules only");
		expect(getSourceFilterLabel(null)).toBe("All sources");
	});

	it("Counts the books in a custom filter", () => {
		expect(getSourceFilterLabel({mode: SOURCE_MODE_CUSTOM, sources: {PHB: true}})).toBe("1 book");
		expect(getSourceFilterLabel({mode: SOURCE_MODE_CUSTOM, sources: {PHB: true, XGE: true, TCE: false}})).toBe("2 books");
		expect(getSourceFilterLabel({mode: SOURCE_MODE_CUSTOM, sources: {}})).toBe("0 books");
	});
});

describe("Source filter: flagging existing picks", () => {
	const state = {
		classes: [{
			name: "Rogue",
			source: "PHB",
			subclass: {name: "Swashbuckler", source: "XGE"},
			optionalFeatures: [{name: "Archery", source: "PHB"}],
			asiFeatChoices: [{type: "feat", name: "Prodigy", source: "XGE"}, {type: "asi", bonuses: {str: 2}}],
		}],
		featureFeats: [{name: "Defense", source: "XPHB"}],
		originFeats: [{name: "Savage Attacker", source: "XPHB"}],
		spellsKnown: [{name: "Fire Bolt", source: "XPHB"}],
		grantedSpellChoices: [{name: "Bless", source: "PHB"}],
		refSpecies: {name: "Elf", source: "XPHB"},
		refBackground: {name: "Sage", source: "PHB"},
	};

	it("Collects every source the character actually uses", () => {
		const used = getUsedSources(state).map(it => it.source).sort();
		expect(used).toEqual(["PHB", "XGE", "XPHB"]);
	});

	it("Labels each source with what uses it", () => {
		const xge = getUsedSources(state).find(it => it.source === "XGE");
		expect(xge.labels.sort()).toEqual(["Prodigy", "Swashbuckler"]);
	});

	it("Reports the picks that fall outside a 2024-only filter", () => {
		const out = getOutOfFilterSources(state, {mode: SOURCE_MODE_MODERN, sources: {}}, opts);
		expect(out.map(it => it.source).sort()).toEqual(["PHB", "XGE"]);
	});

	it("Reports nothing when the filter permits everything", () => {
		expect(getOutOfFilterSources(state, {mode: SOURCE_MODE_ALL}, opts)).toEqual([]);
		expect(getOutOfFilterSources(state, null, opts)).toEqual([]);
	});

	it("Ignores ASI (non-feat) entries and tolerates empty state", () => {
		expect(getUsedSources({})).toEqual([]);
		expect(getUsedSources(null)).toEqual([]);
	});
});

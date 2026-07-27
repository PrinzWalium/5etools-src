/**
 * Per-character source filtering: which books a character is allowed to *pick* content from.
 *
 * The filter is applied to the pickers only — never to rendering or derivation — so changing it can
 * never break a saved character. Content already chosen keeps working and is flagged instead.
 *
 * Kept dependency-free (the 2014/2024 classification is injected) so it can be unit-tested; the
 * browser side binds `SourceUtil.isClassicSource`, which compares a source's publication date to
 * the 2024 PHB's rather than relying on a hardcoded list.
 */

export const SOURCE_MODE_ALL = "all";
export const SOURCE_MODE_MODERN = "modern"; // 2024 ruleset (XPHB onwards)
export const SOURCE_MODE_CLASSIC = "classic"; // 2014 ruleset
export const SOURCE_MODE_CUSTOM = "custom";

export const SOURCE_MODES = [
	{mode: SOURCE_MODE_ALL, name: "All sources", desc: "Everything available, including homebrew"},
	{mode: SOURCE_MODE_MODERN, name: "2024 rules only", desc: "The 2024 Player's Handbook and later"},
	{mode: SOURCE_MODE_CLASSIC, name: "2014 rules only", desc: "The 2014 Player's Handbook and its era"},
	{mode: SOURCE_MODE_CUSTOM, name: "Custom", desc: "Pick individual books"},
];

/** The default (unrestricted) filter. */
export function getDefaultSourceFilter () {
	return {mode: SOURCE_MODE_ALL, sources: {}};
}

/** Whether a filter permits everything (so callers can skip work entirely). */
export function isSourceFilterInactive (filter) {
	return !filter || !filter.mode || filter.mode === SOURCE_MODE_ALL;
}

/**
 * Whether `source` may be picked under `filter`.
 * @param source a source code ("PHB", "XPHB", ...)
 * @param filter `{mode, sources}`
 * @param opts.isClassic classifier returning true for 2014-era sources; when absent, era modes allow all
 */
export function isSourceAllowed (source, filter, {isClassic = null} = {}) {
	if (isSourceFilterInactive(filter)) return true;
	if (source == null) return true; // unsourced content is never hidden

	switch (filter.mode) {
		case SOURCE_MODE_CUSTOM: return !!filter.sources?.[source];
		case SOURCE_MODE_MODERN: return isClassic ? !isClassic(source) : true;
		case SOURCE_MODE_CLASSIC: return isClassic ? !!isClassic(source) : true;
		default: return true;
	}
}

/** A `source => boolean` predicate for a filter, or null when the filter permits everything. */
export function getSourceFilterPredicate (filter, {isClassic = null} = {}) {
	if (isSourceFilterInactive(filter)) return null;
	return source => isSourceAllowed(source, filter, {isClassic});
}

/** Short label for the current filter, for the toolbar chip. */
export function getSourceFilterLabel (filter) {
	if (isSourceFilterInactive(filter)) return "All sources";
	if (filter.mode === SOURCE_MODE_CUSTOM) {
		const n = Object.values(filter.sources || {}).filter(Boolean).length;
		return `${n} book${n === 1 ? "" : "s"}`;
	}
	return SOURCE_MODES.find(it => it.mode === filter.mode)?.name || "All sources";
}

/**
 * The sources a character actually uses, as `{source, label}` — so picks made outside the current
 * filter can be flagged without hiding them.
 */
export function getUsedSources (state) {
	const out = new Map();
	const add = (source, label) => {
		if (!source) return;
		if (!out.has(source)) out.set(source, []);
		if (label && !out.get(source).includes(label)) out.get(source).push(label);
	};

	(state?.classes || []).forEach(cls => {
		add(cls.source, cls.name);
		if (cls.subclass) add(cls.subclass.source, cls.subclass.name);
		(cls.optionalFeatures || []).forEach(it => add(it.source, it.name));
		(cls.asiFeatChoices || []).forEach(it => { if (it.type === "feat") add(it.source, it.name); });
	});
	(state?.featureFeats || []).forEach(it => add(it.source, it.name));
	(state?.originFeats || []).forEach(it => add(it.source, it.name));
	(state?.spellsKnown || []).forEach(it => add(it.source, it.name));
	(state?.grantedSpellChoices || []).forEach(it => add(it.source, it.name));
	add(state?.refSpecies?.source, state?.refSpecies?.name);
	add(state?.refBackground?.source, state?.refBackground?.name);

	return [...out.entries()].map(([source, labels]) => ({source, labels}));
}

/** The character's used sources that fall outside `filter` (empty when nothing is out of filter). */
export function getOutOfFilterSources (state, filter, {isClassic = null} = {}) {
	if (isSourceFilterInactive(filter)) return [];
	return getUsedSources(state).filter(it => !isSourceAllowed(it.source, filter, {isClassic}));
}

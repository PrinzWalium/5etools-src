/**
 * Reference cards — the character's spells and attacks, sized for index cards.
 *
 * A player who has to look up "what does Fog Cloud actually do?" mid-turn is doing what the sheet
 * should have done for them. Printing the spells they *actually know* onto cards is a real table
 * artifact, and one this fork can build for nothing, because it has the spell data and already
 * knows how to print.
 *
 * This module turns an entity into the fields a card shows; the panel lays them out and the print
 * stylesheet cuts them to size. Kept DOM-free so it can be unit-tested.
 */

/** A tag's display text: `{@item bat guano|phb|bat guano}` → its last part, `{@dice 8d6}` → "8d6". */
const _stripTags = str => String(str ?? "").replace(/\{@(\w+)\s+([^{}]*)}/g, (_, tag, inner) => {
	const parts = inner.split("|");
	if (tag.toLowerCase() === "filter") return parts[0];
	return parts.length >= 3 ? parts[2] : parts[0];
});

/**
 * "V, S, M (a tiny ball of bat guano)".
 *
 * Formatted here rather than through `Parser.spComponentsToFull`, which needs the `Renderer` — and
 * so a browser — for the material text. The shape is simple enough that keeping this module pure is
 * worth the few lines.
 */
function _fmtComponents (comp, level) {
	if (!comp) return "";
	const out = [];
	if (comp.v) out.push("V");
	if (comp.s) out.push("S");
	if (comp.m != null) {
		const text = comp.m === true ? null : _stripTags(comp.m.text ?? comp.m);
		out.push(text ? `M (${text})` : "M");
	}
	if (comp.r) out.push(`R (${level} gp)`);
	return out.join(", ");
}

/** "Concentration, up to 10 minutes" — formatted here for the same reason as the components. */
function _fmtDuration (durations) {
	return (durations || []).map(d => {
		switch (d?.type) {
			case "instant": return "Instantaneous";
			case "permanent": return `Until ${(d.ends || ["dispelled"]).join(" or ")}`;
			case "special": return "Special";
			case "timed": {
				const amount = d.duration?.amount;
				const unit = d.duration?.type || "";
				const ptTime = [amount, `${unit}${amount === 1 ? "" : "s"}`].filter(it => it != null && it !== "").join(" ");
				return d.concentration ? `Concentration, up to ${ptTime}` : ptTime;
			}
			default: return "";
		}
	}).filter(Boolean).join(" or ");
}

/** Flatten a spell's entry tree to plain paragraphs, keeping each tag's display text. */
function _entriesToParagraphs (entries) {
	const out = [];

	const walk = entry => {
		if (entry == null) return;
		if (typeof entry === "string") return void out.push(_stripTags(entry));
		if (Array.isArray(entry)) return void entry.forEach(walk);
		if (typeof entry !== "object") return;

		// A list's items read as paragraphs; a named sub-entry keeps its name inline
		if (entry.type === "list") return void (entry.items || []).forEach(it => walk(typeof it === "string" ? `• ${it}` : it));
		if (entry.name) {
			const body = [];
			const outer = out.length;
			walk(entry.entries ?? entry.entry ?? []);
			body.push(...out.splice(outer));
			out.push(`${entry.name}. ${body.join(" ")}`.trim());
			return;
		}
		walk(entry.entries ?? entry.entry ?? entry.items ?? []);
	};

	walk(entries);
	return out.filter(it => String(it).trim());
}

/**
 * One spell, as a card.
 *
 * @param ent the spell entity.
 * @param derivedSpell the character's `{dc, atkMod}`, so the card carries *their* numbers rather
 *   than telling the player to work it out.
 * @return {{name, source, level, subtitle, meta: Array<{label: string, value: string}>,
 *   paragraphs: string[], higherLevel: string|null, isConcentration: boolean, isRitual: boolean}}
 */
export function getSpellCard (ent, {derivedSpell = null, styleHint = "classic"} = {}) {
	if (!ent) return null;

	const isConcentration = !!ent.duration?.some(d => d?.concentration);
	const isRitual = !!ent.meta?.ritual;

	// `styleHint` is passed rather than left to the global config, so this stays a pure function
	const meta = [
		{label: "Cast", value: Parser.spTimeListToFull(ent.time, ent.meta, {isStripTags: true, styleHint})},
		{label: "Range", value: Parser.spRangeToFull(ent.range, {styleHint})},
		{label: "Components", value: _fmtComponents(ent.components, ent.level)},
		{label: "Duration", value: _fmtDuration(ent.duration)},
	].filter(it => it.value);

	// The character's own attack bonus or save DC, when the spell calls for one
	if (derivedSpell) {
		if (ent.spellAttack?.length) meta.push({label: "Attack", value: `${derivedSpell.atkMod >= 0 ? "+" : "−"}${Math.abs(derivedSpell.atkMod)} to hit`});
		else if (ent.savingThrow?.length) meta.push({label: "Save", value: `${String(ent.savingThrow[0]).slice(0, 3).toUpperCase()} DC ${derivedSpell.dc}`});
	}

	return {
		name: ent.name,
		source: ent.source,
		level: ent.level,
		subtitle: Parser.spLevelSchoolMetaToFull(ent.level, ent.school, ent.meta, ent.subschools, {styleHint}),
		meta,
		paragraphs: _entriesToParagraphs(ent.entries),
		higherLevel: _entriesToParagraphs(ent.entriesHigherLevel).join(" ") || null,
		isConcentration,
		isRitual,
	};
}

/**
 * One attack, as a card. The sheet already holds these as rows the player edits, so a card is a
 * restatement rather than a lookup — but a card that is missing from the deck is worse than one
 * that repeats what is on the sheet.
 */
export function getAttackCard (attack) {
	if (!attack?.name) return null;
	const bonus = Number(attack.atkBonus) || 0;
	return {
		name: attack.name,
		subtitle: "Weapon Attack",
		meta: [
			{label: "To hit", value: `${bonus >= 0 ? "+" : "−"}${Math.abs(bonus)}`},
			{label: "Damage", value: attack.damage || "—"},
		].filter(it => it.value),
		paragraphs: [],
		isConcentration: false,
		isRitual: false,
	};
}

/**
 * The deck for a character: every spell they know that the data could be found for, in level then
 * name order, followed by their attacks.
 *
 * @param spellsKnown the character's `spellsKnown` rows.
 * @param byKey a map of `"name|source"` (lower-cased) to the spell entity.
 */
export function getCardDeck ({spellsKnown = [], attacks = [], byKey = new Map(), derivedSpell = null, styleHint = "classic"} = {}) {
	const spells = spellsKnown
		.map(sp => byKey.get(`${String(sp.name).toLowerCase()}|${String(sp.source).toLowerCase()}`))
		.filter(Boolean)
		.map(ent => getSpellCard(ent, {derivedSpell, styleHint}))
		.sort((a, b) => (a.level - b.level) || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));

	return [...spells, ...attacks.map(getAttackCard).filter(Boolean)];
}

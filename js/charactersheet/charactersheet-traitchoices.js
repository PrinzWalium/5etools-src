/**
 * "Choose one of the following" species traits — Elven Lineage, Fiendish Legacy, Giant Ancestry,
 * Gnomish Lineage, Draconic Ancestry, Celestial Revelation, ...
 *
 * These have no dedicated data field: the options live in the trait's prose, as either a hanging
 * **list** of named items or a **table** whose first column names the option. Both shapes are
 * recognisable, so they are read here rather than curated by hand — new species written the same
 * way are picked up for free.
 *
 * A trait counts as a choice when its prose says so ("choose one of the following", "choose a
 * lineage from the ... table") — informational tables are left alone.
 *
 * Kept DOM-free and dependency-free so it can be unit-tested.
 */

/** Prose which marks a trait as offering a pick. */
const _RE_IS_CHOICE = /\bchoose\b[^.]{0,60}\b(?:following|options?|table|lineage|legacy|kind of)\b|\boptions? below\b|\boptions are\b|\bfollowing benefits\b/i;
/** "When you reach character level 3, ..." — the level at which the pick is made. */
const _RE_LEVEL = /when you reach character level (\d+)/i;
/** A table column holding the damage type an option grants resistance to. */
const _RE_COL_DAMAGE = /damage(?: type| resistance)?/i;

/** Strip 5etools display tags, keeping the text a reader sees. */
export function stripEntryTags (str) {
	let out = String(str ?? "");
	// Innermost-first, so nested tags unwrap cleanly
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const next = out.replace(/\{@\w+ ([^{}]*)\}/g, (_, inner) => {
			const parts = inner.split("|");
			// {@tag name|source|display} and {@tag display|...}: the last part is what is shown
			if (parts.length >= 3) return parts[2];
			if (parts.length === 2 && /^\d/.test(parts[0])) return parts[1]; // {@dice 1d6|...}
			return parts[0];
		});
		if (next === out) return out.trim();
		out = next;
	}
}

const _flattenText = entries => (entries || [])
	.filter(it => typeof it === "string")
	.join(" ");

const _entryText = ent => {
	if (typeof ent === "string") return ent;
	if (Array.isArray(ent)) return ent.map(_entryText).join(" ");
	if (ent && typeof ent === "object") return _entryText(ent.entries || ent.entry || []);
	return "";
};

/** Options from a `{type: "list"}` of named items ("Cloud's Jaunt (Cloud Giant).", ...). */
function _getListOptions (list) {
	return (list.items || [])
		.filter(it => it && typeof it === "object" && it.name)
		// Names carry their trailing sentence period, and often a parenthetical source
		.map(it => ({
			name: stripEntryTags(it.name).replace(/\.$/, "").trim(),
			desc: stripEntryTags(_entryText(it)).trim(),
		}))
		.filter(it => it.name);
}

/** Options from a `{type: "table"}` whose first column names the option. */
function _getTableOptions (table) {
	const rows = (table.rows || []).filter(row => Array.isArray(row) && row.length);
	if (rows.length < 2) return {options: [], resistByOption: null};

	const ixDamage = (table.colLabels || []).findIndex(lbl => _RE_COL_DAMAGE.test(stripEntryTags(lbl)));
	const resistByOption = {};

	const options = rows
		.map(row => {
			const name = stripEntryTags(row[0]).trim();
			if (!name) return null;
			if (ixDamage > 0 && row[ixDamage] != null) resistByOption[name] = stripEntryTags(row[ixDamage]).trim().toLowerCase();
			return {name, desc: row.slice(1).map(cell => stripEntryTags(cell).trim()).filter(Boolean).join(" — ")};
		})
		.filter(Boolean);

	return {options, resistByOption: Object.keys(resistByOption).length ? resistByOption : null};
}

/**
 * The "choose one of the following" traits of a species (or any entity with `entries`).
 * @return {Array<{key: string, trait: string, level: number, count: number,
 *   options: Array<{name: string, desc: string}>, resistByOption: Object|null, prompt: string}>}
 */
export function getTraitChoices (ent) {
	const out = [];

	(ent?.entries || []).forEach(trait => {
		if (!trait || typeof trait !== "object" || !trait.name || !Array.isArray(trait.entries)) return;

		const prose = _flattenText(trait.entries);
		if (!_RE_IS_CHOICE.test(stripEntryTags(prose))) return;

		let options = [];
		let resistByOption = null;
		trait.entries.forEach(sub => {
			if (options.length || !sub || typeof sub !== "object") return;
			if (sub.type === "list") options = _getListOptions(sub);
			else if (sub.type === "table") ({options, resistByOption} = _getTableOptions(sub));
		});
		if (options.length < 2) return;

		const mLevel = _RE_LEVEL.exec(prose);
		out.push({
			key: `${ent.name}|${trait.name}`,
			trait: trait.name,
			level: mLevel ? Number(mLevel[1]) : 1,
			count: 1,
			options,
			resistByOption,
			prompt: stripEntryTags(prose).split(/(?<=\.)\s/)[0],
		});
	});

	return out;
}

/** The damage resistance a chosen option carries, if the trait's table lists one. */
export function getTraitChoiceResist (choice, optionName) {
	return choice?.resistByOption?.[optionName] ?? null;
}

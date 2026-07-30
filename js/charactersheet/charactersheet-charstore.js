/**
 * The multi-character page store: a keyed map of saved characters plus a current-character pointer.
 *
 * Store shape: `{storeVersion: 1, currentId, characters: {id: envelope}}`, where each envelope is a
 * single character's versioned save (`{version, state}`, as used for save files). Earlier versions
 * of the page stored a single character's envelope (or the legacy v1 field map) directly; those are
 * migrated into a one-character store.
 */

export const CHAR_STORE_VERSION = 1;

/** Migrate whatever was previously stored into the current store shape; null if unrecognisable. */
export function getMigratedStore (stored) {
	if (!stored || typeof stored !== "object") return null;

	if (stored.storeVersion === CHAR_STORE_VERSION && stored.characters) return stored;

	// A single character envelope (v2) or legacy v1 field map becomes a one-character store
	if (stored.version != null || stored.fields) {
		const id = CryptUtil.uid();
		return {
			storeVersion: CHAR_STORE_VERSION,
			currentId: id,
			characters: {[id]: stored},
		};
	}

	return null;
}

export function getNewStore () {
	const id = CryptUtil.uid();
	return {
		storeVersion: CHAR_STORE_VERSION,
		currentId: id,
		characters: {[id]: null}, // null = fresh, defaults-only character
	};
}

/** Display label for a character envelope. */
export function getCharacterLabel (envelope) {
	const name = envelope?.state?.name ?? envelope?.fields?.["cs-name"];
	return (name || "").trim() || "Unnamed Character";
}

/** Matches the note earlier versions left behind: `Ability Scores (Dwarf): +2 Con — assign manually`. */
const _RE_LEGACY_ABILITY_NOTE = /^Ability Scores \(([^)]+)\):\s*(.*?)\s*[—-]\s*assign manually\s*$/;

/**
 * Ability increases that were skipped used to leave a line in the proficiencies box that nothing
 * ever cleared. Those lines become real outstanding offers, which the sheet shows as something still
 * to do — and which can be dismissed once they are done.
 *
 * The offer's packages are long gone, so a migrated one can only be a reminder to assign it by hand.
 */
export function getStateWithMigratedAbilityNotes (state) {
	const text = state?.proficienciesText;
	if (!text || !text.split("\n").some(ln => _RE_LEGACY_ABILITY_NOTE.test(ln.trim()))) return state;

	const kept = [];
	const offers = [...(state.pendingAbilityOffers || [])];

	text.split("\n").forEach(line => {
		const m = _RE_LEGACY_ABILITY_NOTE.exec(line.trim());
		if (!m) return void kept.push(line);
		if (!offers.some(it => it.source === m[1] && it.offer === m[2])) {
			offers.push({id: CryptUtil.uid(), source: m[1], offer: m[2], packages: null});
		}
	});

	return {...state, proficienciesText: kept.join("\n").trim(), pendingAbilityOffers: offers};
}

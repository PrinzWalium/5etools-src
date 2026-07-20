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

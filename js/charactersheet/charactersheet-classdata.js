/**
 * Shared access layer for class data, for the character sheet/builder.
 *
 * Note that `DataLoader`'s class loader (`DataTypeLoaderCustomClassesSubclass`) already dereferences
 * `classFeatures`/`subclassFeatures` string refs against the top-level `classFeature`/`subclassFeature`
 * arrays, producing a by-level array of resolved feature entries (with `gainSubclassFeature` markers
 * preserved). Everything here builds on that, rather than re-implementing uid parsing.
 */
export class CharacterSheetClassData {
	static _pAllClasses = null;

	/**
	 * All base classes (site + prerelease + brew), dereferenced, blocklist-filtered, and sorted.
	 * Subclass entities (which lack `hd`) are excluded.
	 */
	static pGetAllClasses () {
		return this._pAllClasses ||= (async () => {
			const page = UrlUtil.PG_CLASSES;
			const all = [
				...(await DataLoader.pCacheAndGetAllSite(page)),
				...(await DataLoader.pCacheAndGetAllPrerelease(page)),
				...(await DataLoader.pCacheAndGetAllBrew(page)),
			].filter(it => {
				if (!it.hd || it.className) return false;
				const hash = UrlUtil.URL_TO_HASH_BUILDER[page](it);
				return !ExcludeUtil.isExcluded(hash, "class", it.source);
			});
			all.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source));
			return all;
		})();
	}

	/** A single class by name/source, with dereferenced by-level `classFeatures`. */
	static pGetClass ({name, source}) {
		const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES]({name, source});
		return DataLoader.pCacheAndGet(UrlUtil.PG_CLASSES, source, hash, {isCopy: true});
	}

	static _pAllSubclasses = null;

	/** All subclasses (site + prerelease + brew), dereferenced and blocklist-filtered. */
	static pGetAllSubclasses () {
		return this._pAllSubclasses ||= (async () => {
			const page = UrlUtil.PG_CLASSES;
			return [
				...(await DataLoader.pCacheAndGetAllSite(page)),
				...(await DataLoader.pCacheAndGetAllPrerelease(page)),
				...(await DataLoader.pCacheAndGetAllBrew(page)),
			].filter(it => it.className && it.shortName);
		})();
	}

	/** Subclasses available for a given class. */
	static async pGetSubclassesForClass ({className, classSource}) {
		return (await this.pGetAllSubclasses())
			.filter(it => it.className === className && it.classSource === classSource)
			.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source));
	}

	static async pGetSubclass ({className, classSource, shortName, source}) {
		return (await this.pGetAllSubclasses())
			.find(it => it.className === className && it.classSource === classSource && it.shortName === shortName && it.source === source);
	}

	static _pAllOptionalFeatures = null;

	/** All optional features (fighting styles, invocations, maneuvers, ...; site + prerelease + brew). */
	static pGetAllOptionalFeatures () {
		return this._pAllOptionalFeatures ||= (async () => {
			const page = UrlUtil.PG_OPT_FEATURES;
			return [
				...(await DataLoader.pCacheAndGetAllSite(page)),
				...(await DataLoader.pCacheAndGetAllPrerelease(page)),
				...(await DataLoader.pCacheAndGetAllBrew(page)),
			].filter(it => {
				const hash = UrlUtil.URL_TO_HASH_BUILDER[page](it);
				return !ExcludeUtil.isExcluded(hash, "optionalfeature", it.source);
			});
		})();
	}

	static _pAllFeats = null;

	/** All feats (site + prerelease + brew), blocklist-filtered and sorted. */
	static pGetAllFeats () {
		return this._pAllFeats ||= (async () => {
			const page = UrlUtil.PG_FEATS;
			const all = [
				...(await DataLoader.pCacheAndGetAllSite(page)),
				...(await DataLoader.pCacheAndGetAllPrerelease(page)),
				...(await DataLoader.pCacheAndGetAllBrew(page)),
			].filter(it => {
				const hash = UrlUtil.URL_TO_HASH_BUILDER[page](it);
				return !ExcludeUtil.isExcluded(hash, "feat", it.source);
			});
			all.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source));
			return all;
		})();
	}

	/** Optional features matching any of the given feature type tags (e.g. ["FS:F"], ["EI"]). */
	static async pGetOptionalFeaturesByTypes (featureTypes) {
		const all = await this.pGetAllOptionalFeatures();
		return all
			.filter(it => (it.featureType || []).some(ft => featureTypes.includes(ft)))
			.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source));
	}

	/**
	 * Display name/source for a dereferenced feature. The dereferencer's entry-nesting step strips
	 * `name`/`source` from wrapper features with a `header`, moving the named content into
	 * `entries[0]`, so resolve by drilling down.
	 */
	static getFeatureNameMeta (feature) {
		let cur = feature;
		while (cur && cur.name == null && Array.isArray(cur.entries)) cur = cur.entries[0];
		return {
			name: cur?.name ?? feature._displayName ?? null,
			source: cur?.source ?? feature.source ?? null,
		};
	}

	/**
	 * Resolved class feature entries gained at exactly `level`.
	 * Entries flagged `gainSubclassFeature: true` mark where subclass features slot into the timeline.
	 */
	static getClassFeaturesAtLevel (cls, level) {
		return (cls.classFeatures || [])[level - 1] || [];
	}

	/** Resolved subclass feature entries gained at exactly `level`. */
	static getSubclassFeaturesAtLevel (sc, level) {
		return (sc.subclassFeatures || [])
			.flat()
			.filter(it => it.level === level);
	}

	/**
	 * The feature timeline for levels 1..`level`, in gain order, with subclass features (when a
	 * subclass is provided) spliced in at their `gainSubclassFeature` markers.
	 * @return {Array<{level: number, feature: object, isSubclassFeature: boolean}>}
	 */
	static getFeatureTimeline (cls, {subclass = null, level}) {
		const out = [];

		for (let lvl = 1; lvl <= level; ++lvl) {
			this.getClassFeaturesAtLevel(cls, lvl).forEach(feature => {
				out.push({level: lvl, feature, isSubclassFeature: false});

				if (!feature.gainSubclassFeature || !subclass) return;

				this.getSubclassFeaturesAtLevel(subclass, lvl)
					.forEach(scFeature => out.push({level: lvl, feature: scFeature, isSubclassFeature: true}));
			});
		}

		return out;
	}
}

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

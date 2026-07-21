import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {getCantripsKnown, getPreparedSpellCount, getSpellcastingMeta, getSpellsKnown} from "./charactersheet-levelengine.js";
import {getAbilityModifier} from "./charactersheet-derive.js";

/**
 * Tracked spellcasting: the known/prepared spell list (validated against the character's class
 * spell lists) and checkbox-per-slot expenditure tracking fed by the leveling engine.
 */
export class CharacterSpellsPanel {
	constructor ({comp, wrpSlots, wrpKnown}) {
		this._comp = comp;
		this._wrpSlots = wrpSlots;
		this._wrpKnown = wrpKnown;
		this._renderToken = 0;
	}

	init () {
		this._comp._addHookBase("classes", () => this._pRenderSlots());
		this._comp._addHookBase("slotsUsed", () => this._pRenderSlots());
		this._comp._addHookBase("spellsKnown", () => {
			this._renderKnown();
			this._pRenderSlots(); // known counts live in the slots block
		});
		document.getElementById("cs-spell-add").addEventListener("click", () => this._pOnAddSpell());
		const btnBrowse = document.getElementById("cs-spell-browse");
		if (btnBrowse) btnBrowse.addEventListener("click", () => this._pOnBrowseClassSpells());

		this._renderKnown();
		this._pRenderSlots();
	}

	/* -------------------------------------------- Class-filtered spell manager -------------------------------------------- */

	/** Highest leveled-spell level the character can cast (from slot tables / pact magic). */
	static _getMaxSpellLevel (meta) {
		let maxLevel = meta.pact ? meta.pact.level : 0;
		if (meta.slots) maxLevel = Math.max(maxLevel, meta.slots.reduce((m, n, i) => (n > 0 ? i + 1 : m), 0));
		return maxLevel;
	}

	/**
	 * Manage a caster class's spells from a list restricted to that class and to the levels the
	 * character can actually learn (cantrips + leveled spells up to the highest slot level). This is
	 * the class-scoped alternative to the free-form search, so players never wade through off-list spells.
	 */
	async _pOnBrowseClassSpells () {
		const loaded = await this._pGetLoadedClasses();
		const casters = loaded.filter(({cls, sc}) => [cls, sc].some(it => it?.casterProgression || it?.spellcastingAbility || it?.cantripProgression || it?.spellsKnownProgression));
		if (!casters.length) return JqueryUtil.doToast({type: "warning", content: "This character has no spellcasting class yet."});

		let target = casters[0];
		if (casters.length > 1) {
			const name = await InputUiUtil.pGetUserEnum({
				values: casters.map(c => c.entry.name),
				isResolveItem: true,
				title: "Manage spells for which class?",
				placeholder: "Select a class...",
			});
			if (name == null) return;
			target = casters.find(c => c.entry.name === name) || target;
		}

		const {entry, cls, sc} = target;
		const className = cls?.name || entry.name;

		const meta = getSpellcastingMeta([{cls, sc, level: entry.level}]);
		const maxLevel = CharacterSpellsPanel._getMaxSpellLevel(meta);
		const cantripEnt = [cls, sc].find(it => it?.cantripProgression);
		const hasCantrips = !!(cantripEnt && getCantripsKnown(cantripEnt, entry.level));

		const spells = (await CharacterSheetClassData.pGetSpellsForClass(className))
			.filter(sp => (sp.level === 0 ? hasCantrips : sp.level <= Math.max(maxLevel, 1)));
		if (!spells.length) return JqueryUtil.doToast({type: "warning", content: `No learnable ${className} spells found at this level.`});

		const knownKeys = new Set(this._comp._state.spellsKnown
			.filter(it => (it.className || null) === (className || null))
			.map(it => `${it.name}|${it.source}`));
		const values = spells.map(sp => {
			const ptSrc = sp.source !== Parser.SRC_PHB ? ` (${Parser.sourceJsonToAbv(sp.source)})` : "";
			const ptLvl = sp.level === 0 ? "Cantrip" : Parser.spLevelToFull(sp.level);
			const ptRit = sp.meta?.ritual ? " [ritual]" : "";
			return `${sp.name}${ptSrc} — ${ptLvl}${ptRit}`;
		});
		const defaults = spells.map((sp, ix) => (knownKeys.has(`${sp.name}|${sp.source}`) ? ix : null)).filter(ix => ix != null);

		const ixs = await InputUiUtil.pGetUserMultipleChoice({
			title: `${className} Spells`,
			htmlDescription: `<div class="ve-muted ve-small ve-mb-1">Showing cantrips and spells up to ${maxLevel ? Parser.spLevelToFull(maxLevel) : "your castable"} level. Tick the spells this class knows or has prepared.</div>`,
			values,
			defaults,
			max: values.length, // no hard cap; over-selection is surfaced as a warning in the counts row
			isSearchable: true,
			fnGetSearchText: v => v,
		});
		if (ixs == null || typeof ixs === "symbol") return;

		const chosen = ixs.map(ix => {
			const sp = spells[ix];
			return {name: sp.name, source: sp.source, level: sp.level, ritual: !!sp.meta?.ritual};
		});
		this._comp.setKnownSpellsForClass(className, chosen);
	}

	/* -------------------------------------------- Slots -------------------------------------------- */

	async _pGetLoadedClasses () {
		const out = [];
		for (const entry of this._comp._state.classes) {
			const cls = await CharacterSheetClassData.pGetClass({name: entry.name, source: entry.source}).catch(() => null);
			const sc = entry.subclass
				? await CharacterSheetClassData.pGetSubclass({className: entry.name, classSource: entry.source, shortName: entry.subclass.shortName, source: entry.subclass.source})
				: null;
			out.push({entry, cls, sc});
		}
		return out;
	}

	async _pRenderSlots () {
		const token = ++this._renderToken;
		const loaded = await this._pGetLoadedClasses();
		if (token !== this._renderToken) return;

		const meta = getSpellcastingMeta(loaded.map(({entry, cls, sc}) => ({cls, sc, level: entry.level})));
		this._wrpSlots.innerHTML = "";
		if (!meta.slots?.some(Boolean) && !meta.pact) return;

		const slotsUsed = this._comp._state.slotsUsed || {};

		const renderSlotRow = ({label, count, used, onSet}) => {
			const row = document.createElement("div");
			row.className = "ve-flex-v-center ve-small ve-mb-1";
			const lbl = document.createElement("span");
			lbl.className = "ve-muted ve-mr-1";
			lbl.style.width = "42px";
			lbl.textContent = label;
			row.appendChild(lbl);
			for (let i = 0; i < count; ++i) {
				const cb = document.createElement("input");
				cb.type = "checkbox";
				cb.className = "ve-mr-1";
				cb.title = "Expend/restore this slot";
				cb.checked = i < used;
				cb.addEventListener("change", () => onSet((i + 1 === used) ? i : i + 1));
				row.appendChild(cb);
			}
			this._wrpSlots.appendChild(row);
		};

		(meta.slots || []).forEach((count, ix) => {
			if (!count) return;
			const level = ix + 1;
			renderSlotRow({
				label: Parser.spLevelToFull(level),
				count,
				used: Math.min(count, Number(slotsUsed[level]) || 0),
				onSet: used => this._comp.setSlotsUsed(level, used),
			});
		});

		if (meta.pact) {
			renderSlotRow({
				label: "Pact",
				count: meta.pact.count,
				used: Math.min(meta.pact.count, Number(slotsUsed.pact) || 0),
				onSet: used => this._comp.setSlotsUsed("pact", used),
			});
			const note = document.createElement("div");
			note.className = "ve-muted ve-small ve-mb-1";
			note.textContent = `Pact slots are ${Parser.spLevelToFull(meta.pact.level)}-level`;
			this._wrpSlots.appendChild(note);
		}

		// Cantrip / known-or-prepared counts vs the class progressions; over-limit is flagged, not blocked
		const known = this._comp._state.spellsKnown || [];
		const state = this._comp._getState();
		const countItems = [];
		loaded.forEach(({entry, cls, sc}) => {
			const clsName = cls?.name;
			const mine = known.filter(it => !it.className || it.className === clsName);
			const cntCantrips = mine.filter(it => it.level === 0).length;
			const cntLeveled = mine.filter(it => it.level > 0).length;

			const cantripEnt = [cls, sc].find(it => it?.cantripProgression);
			if (cantripEnt) {
				const maxCantrips = getCantripsKnown(cantripEnt, entry.level);
				if (maxCantrips != null) countItems.push({text: `Cantrips: ${cntCantrips}/${maxCantrips}`, isOver: cntCantrips > maxCantrips});
			}

			const knownEnt = [cls, sc].find(it => it?.spellsKnownProgression);
			const preparedEnt = [cls, sc].find(it => it?.preparedSpells);
			if (knownEnt) {
				const maxKnown = getSpellsKnown(knownEnt, entry.level);
				if (maxKnown != null) countItems.push({text: `Spells known: ${cntLeveled}/${maxKnown}`, isOver: cntLeveled > maxKnown});
			} else if (preparedEnt) {
				const abv = preparedEnt.spellcastingAbility;
				const mod = abv ? getAbilityModifier(state, abv) : 0;
				const maxPrep = getPreparedSpellCount(preparedEnt, entry.level, mod);
				if (maxPrep != null) countItems.push({text: `Spells prepared: ${cntLeveled}/${maxPrep}`, isOver: cntLeveled > maxPrep});
			}
		});
		if (countItems.length) {
			const disp = document.createElement("div");
			disp.className = "ve-small";
			disp.innerHTML = countItems
				.map(c => `<span class="${c.isOver ? "ve-text-danger" : "ve-muted"}">${c.text.qq()}</span>`)
				.join(`<span class="ve-muted"> · </span>`);
			this._wrpSlots.appendChild(disp);
		}

		const btnReset = document.createElement("button");
		btnReset.type = "button";
		btnReset.className = "ve-btn ve-btn-xxs ve-btn-default no-print";
		btnReset.textContent = "Restore all slots";
		btnReset.addEventListener("click", () => this._comp._state.slotsUsed = {});
		this._wrpSlots.appendChild(btnReset);
	}

	/* -------------------------------------------- Known spells -------------------------------------------- */

	_renderKnown () {
		const known = this._comp._state.spellsKnown || [];
		this._wrpKnown.innerHTML = "";
		if (!known.length) return;

		// Group by class only when the character actually spreads spells across multiple classes
		const distinctClasses = new Set(known.map(it => it.className).filter(Boolean));
		if (distinctClasses.size > 1) {
			[...distinctClasses].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1)
				.forEach(className => this._renderKnownGroup({className, spells: known.filter(it => it.className === className)}));
			const unattributed = known.filter(it => !it.className);
			if (unattributed.length) this._renderKnownGroup({className: null, spells: unattributed});
			return;
		}

		this._renderKnownGroup({className: null, spells: known});
	}

	_renderKnownGroup ({className, spells}) {
		if (className) {
			const hdr = document.createElement("div");
			hdr.className = "bold ve-small ve-mt-1";
			hdr.textContent = className;
			this._wrpKnown.appendChild(hdr);
		}

		const byLevel = {};
		spells.forEach(spell => (byLevel[spell.level] = byLevel[spell.level] || []).push(spell));

		Object.keys(byLevel)
			.map(Number)
			.sort((a, b) => a - b)
			.forEach(level => {
				const row = document.createElement("div");
				row.className = "ve-small ve-mb-1";
				const lbl = document.createElement("span");
				lbl.className = "ve-muted";
				lbl.textContent = `${level === 0 ? "Cantrips" : Parser.spLevelToFull(level)}: `;
				row.appendChild(lbl);

				byLevel[level]
					.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1)
					.forEach(spell => {
						const spn = document.createElement("span");
						spn.className = "ve-mr-2";
						const ptRitual = spell.ritual ? ` <span class="ve-muted" title="Ritual">(R)</span>` : "";
						spn.innerHTML = Renderer.get().render(`{@spell ${spell.name}${spell.source?.toLowerCase() !== "phb" ? `|${spell.source}` : ""}}`) + ptRitual;
						const btnRm = document.createElement("button");
						btnRm.type = "button";
						btnRm.className = "ve-btn ve-btn-xxs ve-btn-default no-print ve-ml-1";
						btnRm.title = `Remove ${spell.name}`;
						btnRm.textContent = "×";
						btnRm.addEventListener("click", () => this._comp.removeKnownSpell(spell.id));
						spn.appendChild(btnRm);
						row.appendChild(spn);
					});

				this._wrpKnown.appendChild(row);
			});
	}

	/** Names of the character's classes that can cast spells. */
	async _pGetCasterClassNames () {
		const loaded = await this._pGetLoadedClasses();
		return loaded
			.filter(({cls, sc}) => [cls, sc].some(it => it?.casterProgression || it?.spellcastingAbility || it?.cantripProgression || it?.spellsKnownProgression))
			.map(({entry}) => entry.name);
	}

	async _pOnAddSpell () {
		await SearchUiUtil.pDoGlobalInit();
		SearchWidget.pDoGlobalInit();
		const doc = await SearchWidget.pGetUserSpellSearch();
		if (!doc) return;
		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});

		// Attribute the spell to a class: automatic for a single caster, prompted for multiclass casters
		const casterNames = await this._pGetCasterClassNames();
		let className = null;
		if (casterNames.length === 1) className = casterNames[0];
		else if (casterNames.length > 1) {
			className = await InputUiUtil.pGetUserEnum({
				values: casterNames,
				isResolveItem: true,
				title: "Which class learns this spell?",
				placeholder: "Select a class...",
			});
			if (className == null) return; // cancelled
		}

		// Validate against the attributed class's spell list (or all classes when unattributed);
		// loose name match, since 2014/2024 lists reference each other's classes by name
		if (ent) {
			const spellClasses = [
				...Renderer.spell.getCombinedClasses(ent, "fromClassList"),
				...Renderer.spell.getCombinedClasses(ent, "fromClassListVariant"),
			].map(it => it.name?.toLowerCase()).filter(Boolean);
			const namesToCheck = className ? [className] : this._comp._state.classes.map(it => it.name);
			const isOnList = namesToCheck.some(name => spellClasses.includes(name.toLowerCase()));
			if (!isOnList && spellClasses.length && namesToCheck.length) {
				JqueryUtil.doToast({type: "warning", content: `${doc.n} is not on the ${namesToCheck.join("/")} spell list${namesToCheck.length > 1 ? "s" : ""}.`});
			}
		}

		const isAdded = this._comp.addKnownSpell({name: doc.n, source: doc.source, level: ent?.level ?? 0, className, ritual: !!ent?.meta?.ritual});
		if (!isAdded) JqueryUtil.doToast({type: "info", content: `${doc.n} is already in the list.`});
	}
}

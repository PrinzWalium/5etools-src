import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {getCantripsKnown, getSpellcastingMeta, getSpellsKnown} from "./charactersheet-levelengine.js";

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

		this._renderKnown();
		this._pRenderSlots();
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

		// Known/cantrip counts vs the class progressions, where the data defines them
		const known = this._comp._state.spellsKnown || [];
		const cntCantripsKnown = known.filter(it => it.level === 0).length;
		const cntSpellsKnown = known.filter(it => it.level > 0).length;
		const counts = [];
		loaded.forEach(({entry, cls, sc}) => {
			const casterEnt = [cls, sc].find(it => it?.cantripProgression || it?.spellsKnownProgression);
			if (!casterEnt) return;
			const maxCantrips = getCantripsKnown(casterEnt, entry.level);
			const maxKnown = getSpellsKnown(casterEnt, entry.level);
			if (maxCantrips != null) counts.push(`Cantrips: ${cntCantripsKnown}/${maxCantrips}`);
			if (maxKnown != null) counts.push(`Spells known: ${cntSpellsKnown}/${maxKnown}`);
		});
		if (counts.length) {
			const disp = document.createElement("div");
			disp.className = "ve-muted ve-small";
			disp.textContent = counts.join(" · ");
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

		const byLevel = {};
		known.forEach(spell => (byLevel[spell.level] = byLevel[spell.level] || []).push(spell));

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
						spn.innerHTML = Renderer.get().render(`{@spell ${spell.name}${spell.source?.toLowerCase() !== "phb" ? `|${spell.source}` : ""}}`);
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

	async _pOnAddSpell () {
		await SearchUiUtil.pDoGlobalInit();
		SearchWidget.pDoGlobalInit();
		const doc = await SearchWidget.pGetUserSpellSearch();
		if (!doc) return;
		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});

		// Validate against the character's class spell lists (loose name match: 2014/2024 lists
		// reference each other's classes by name)
		const classes = this._comp._state.classes;
		if (ent && classes.length) {
			const spellClasses = [
				...Renderer.spell.getCombinedClasses(ent, "fromClassList"),
				...Renderer.spell.getCombinedClasses(ent, "fromClassListVariant"),
			].map(it => it.name?.toLowerCase()).filter(Boolean);
			const isOnList = classes.some(entry => spellClasses.includes(entry.name.toLowerCase()));
			if (!isOnList && spellClasses.length) {
				JqueryUtil.doToast({type: "warning", content: `${doc.n} is not on your ${classes.map(it => it.name).join("/")} spell list${classes.length > 1 ? "s" : ""}.`});
			}
		}

		const isAdded = this._comp.addKnownSpell({name: doc.n, source: doc.source, level: ent?.level ?? 0});
		if (!isAdded) JqueryUtil.doToast({type: "info", content: `${doc.n} is already in the list.`});
	}
}

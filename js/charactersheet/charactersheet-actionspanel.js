import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {getUnarmedStrike} from "./charactersheet-derive.js";
import {buildActionEconomy} from "./charactersheet-actions.js";

/**
 * The Play-mode "Actions" panel: groups what the character can do each turn into Actions, Bonus
 * Actions, and Reactions — from wielded weapons + the Unarmed Strike, known spells bucketed by
 * casting time, and a curated map of common features. Re-renders when attacks, spells, or classes change.
 */
export class CharacterActionsPanel {
	constructor ({comp, wrp}) {
		this._comp = comp;
		this._wrp = wrp;
		this._renderToken = 0;
	}

	init () {
		this._comp._addHookBase("attacks", () => this._pRender());
		this._comp._addHookBase("spellsKnown", () => this._pRender());
		this._comp._addHookBase("classes", () => this._pRender());
		this._pRender();
	}

	/** Distinct feature names for the character's structured classes, up to each class's level. */
	async _pGetFeatureNames () {
		const names = new Set();
		for (const entry of this._comp._state.classes) {
			const cls = await CharacterSheetClassData.pGetClass({name: entry.name, source: entry.source}).catch(() => null);
			if (!cls) continue;
			const sc = entry.subclass
				? await CharacterSheetClassData.pGetSubclass({className: entry.name, classSource: entry.source, shortName: entry.subclass.shortName, source: entry.subclass.source}).catch(() => null)
				: null;
			CharacterSheetClassData.getFeatureTimeline(cls, {subclass: sc, level: entry.level})
				.forEach(({feature}) => {
					const {name} = CharacterSheetClassData.getFeatureNameMeta(feature);
					if (name) names.add(name);
				});
		}
		return [...names];
	}

	async _pRender () {
		const token = ++this._renderToken;
		const featureNames = await this._pGetFeatureNames();
		if (token !== this._renderToken) return;

		const state = this._comp._getState();
		const economy = buildActionEconomy({
			attacks: state.attacks || [],
			unarmed: getUnarmedStrike(state),
			spells: state.spellsKnown || [],
			featureNames,
		});

		this._wrp.innerHTML = "";
		this._renderGroup("Actions", economy.action);
		this._renderGroup("Bonus Actions", economy.bonus);
		this._renderGroup("Reactions", economy.reaction);
	}

	_renderGroup (title, items) {
		const wrp = document.createElement("div");
		wrp.className = "ve-mb-2";
		const hdr = document.createElement("div");
		hdr.className = "bold ve-small";
		hdr.textContent = title;
		wrp.appendChild(hdr);

		if (!items.length) {
			wrp.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small ve-italic">&mdash;</div>`);
			this._wrp.appendChild(wrp);
			return;
		}

		items.forEach(it => {
			const row = document.createElement("div");
			row.className = "ve-small ve-flex-v-baseline";
			const label = it.kind === "spell"
				? Renderer.get().render(`{@spell ${it.label}${it.source && it.source.toLowerCase() !== "phb" ? `|${it.source}` : ""}}`)
				: `<span>${it.label.qq()}</span>`;
			const ptSub = it.sub ? ` <span class="ve-muted">(${it.sub.qq()})</span>` : "";
			row.innerHTML = `${label}${ptSub}`;
			wrp.appendChild(row);
		});
		this._wrp.appendChild(wrp);
	}
}

import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {deriveCharacterSheet} from "./charactersheet-derive.js";
import {getCardDeck} from "./charactersheet-cards.js";

/**
 * Reference cards, built on demand and printed on their own.
 *
 * The deck is only assembled when it is asked for — it needs the whole spell list, which is a
 * heavier load than a sheet should pay for on the chance that someone prints. Printing swaps the
 * page: a body class hides the sheet and shows the cards, and is taken off again afterwards.
 */
export class CharacterCardsPanel {
	static _CLASS_PRINTING = "cs__printing-cards";

	constructor ({comp, wrp}) {
		this._comp = comp;
		this._wrp = wrp;
	}

	/** Build the deck and print it. Left as one action, since the cards have no use on screen. */
	async pPrint () {
		const deck = await this._pGetDeck();
		if (!deck.length) {
			JqueryUtil.doToast({type: "warning", content: "Nothing to put on cards yet &mdash; add a spell or an attack first."});
			return;
		}

		this._render(deck);
		document.body.classList.add(CharacterCardsPanel._CLASS_PRINTING);

		const onAfter = () => {
			document.body.classList.remove(CharacterCardsPanel._CLASS_PRINTING);
			window.removeEventListener("afterprint", onAfter);
		};
		window.addEventListener("afterprint", onAfter);

		window.print();
		// Headless printing does not always fire `afterprint`, so put the page back either way
		setTimeout(onAfter, 1000);
	}

	async _pGetDeck () {
		const state = this._comp._getState();
		const known = state.spellsKnown || [];

		let byKey = new Map();
		if (known.length) {
			const all = await CharacterSheetClassData.pGetAllSpells().catch(() => []);
			byKey = new Map(all.map(sp => [`${sp.name.toLowerCase()}|${sp.source.toLowerCase()}`, sp]));
		}

		return getCardDeck({
			spellsKnown: known,
			attacks: state.attacks || [],
			byKey,
			derivedSpell: deriveCharacterSheet(state).spell,
		});
	}

	_render (deck) {
		this._wrp.innerHTML = "";

		const name = (this._comp._state.name || "").trim();
		if (name) {
			const hdr = document.createElement("div");
			hdr.className = "cs__cards-owner";
			hdr.textContent = name;
			this._wrp.appendChild(hdr);
		}

		deck.forEach(card => this._wrp.appendChild(this._getCardEle(card)));
	}

	_getCardEle (card) {
		const ele = document.createElement("div");
		ele.className = "cs__card";

		const flags = [card.isConcentration ? "Concentration" : null, card.isRitual ? "Ritual" : null].filter(Boolean);

		ele.innerHTML = `
			<div class="cs__card-name">${card.name.qq()}</div>
			<div class="cs__card-sub">${(card.subtitle || "").qq()}${flags.length ? ` <span class="cs__card-flags">${flags.join(" · ").qq()}</span>` : ""}</div>
			<div class="cs__card-meta">
				${card.meta.map(it => `<div><span class="cs__card-meta-lbl">${it.label.qq()}</span> ${String(it.value).qq()}</div>`).join("")}
			</div>
			<div class="cs__card-body">
				${(card.paragraphs || []).map(it => `<p>${it.qq()}</p>`).join("")}
				${card.higherLevel ? `<p class="cs__card-higher"><span class="cs__card-meta-lbl">At higher levels.</span> ${card.higherLevel.qq()}</p>` : ""}
			</div>`;

		return ele;
	}
}

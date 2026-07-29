import {CHAR_SHEET_ABILITIES} from "./charactersheet/charactersheet-consts.js";
import {deriveCharacterSheet} from "./charactersheet/charactersheet-derive.js";
import {CharacterClassPanel} from "./charactersheet/charactersheet-classpanel.js";
import {CharacterInventoryPanel} from "./charactersheet/charactersheet-inventorypanel.js";
import {CharacterSpellsPanel} from "./charactersheet/charactersheet-spellspanel.js";
import {CharacterPageBase} from "./charactersheet/charactersheet-pagebase.js";

/**
 * The build-focused page. It surfaces the tools for *planning* a character — the guided wizard,
 * the class/leveling panel (subclass, feats/ASIs, optional features), species/background/class
 * pickers, ability scores, and inventory/spell management — while leaving the moment-to-moment
 * play widgets (attacks, death saves, HP tracking) to the sheet page. Both pages share one
 * character store, so a character planned here is immediately playable on the sheet.
 */
class CharacterBuilderPage extends CharacterPageBase {
	/* -------------------------------------------- DOM assembly -------------------------------------------- */

	_buildDom () {
		this._buildAbilities();
	}

	/**
	 * Flag picks that fall outside the character's source filter. They are never hidden — the filter
	 * governs the pickers only — so this just explains why they can no longer be re-picked.
	 */
	_renderOutOfFilterNote () {
		const ele = document.getElementById("cs-sources-note");
		if (!ele) return;
		const out = this._getOutOfFilterPicks();
		if (!out.length) return ele.innerHTML = "";
		const pts = out.map(it => `<b>${Parser.sourceJsonToAbv(it.source).qq()}</b>${it.labels.length ? ` <span class="ve-muted">(${it.labels.slice(0, 3).join(", ").qq()}${it.labels.length > 3 ? ", …" : ""})</span>` : ""}`);
		ele.innerHTML = `<span class="ve-text-danger">&#9888;</span> <span class="ve-muted">This character uses content outside its source filter: ${pts.join(", ")}. It still works — but those books are no longer offered when picking.</span>`;
	}

	_bindDom () {
		this._bindClick("cs-btn-wizard", () => this._pOnWizard());
		this._bindBuildPickers();
		this._bindSourceFilter();
		// A filter change can leave existing picks outside it; surface that without hiding anything
		this._comp._addHookBase("sourceFilter", () => this._renderOutOfFilterNote());

		this._classPanel = new CharacterClassPanel({comp: this._comp, wrp: document.getElementById("cs-class-panel")});
		this._classPanel.init();
		this._inventoryPanel = new CharacterInventoryPanel({comp: this._comp, wrp: document.getElementById("cs-inventory")});
		this._inventoryPanel.init();
		this._spellsPanel = new CharacterSpellsPanel({
			comp: this._comp,
			wrpSlots: document.getElementById("cs-spell-slots"),
			wrpKnown: document.getElementById("cs-spells-known"),
		});
		this._spellsPanel.init();

		this._comp._addHookBase("pickTags", () => this._renderPickLinks());
	}

	_doRenderAll () {
		this._syncAllInputs();
		this._renderPickLinks();
		this._renderDerived();
		this._renderSourceFilterLabel();
		this._renderOutOfFilterNote();
		this._renderProficiencies();
		this._pRefreshTraitChoices();
		this._lastLevel = this._comp.getLevelNumber();
	}

	/* -------------------------------------------- Derived rendering -------------------------------------------- */

	_renderDerived () {
		const derived = deriveCharacterSheet(this._comp._getState());

		const elePb = document.getElementById("cs-pb");
		if (elePb) elePb.textContent = CharacterPageBase.fmtBonus(derived.pb);

		CHAR_SHEET_ABILITIES.forEach(([abv, name]) => this._renderRoll(`cs-mod-${abv}`, derived.abilities[abv].mod, `${name} check`));

		const eleDc = document.getElementById("cs-spell-dc");
		const eleAtk = document.getElementById("cs-spell-atk");
		if (eleDc && eleAtk) {
			if (derived.spell) {
				eleDc.textContent = `${derived.spell.dc}`;
				eleAtk.innerHTML = Renderer.get().render(`{@d20 ${derived.spell.atkMod}|${CharacterPageBase.fmtBonus(derived.spell.atkMod)}|Spell attack}`);
			} else {
				eleDc.textContent = "—";
				eleAtk.textContent = "—";
			}
		}
	}
}

window.addEventListener("load", () => {
	const page = new CharacterBuilderPage();
	page.init();
});

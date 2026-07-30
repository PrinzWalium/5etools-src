import {CHAR_SHEET_ABILITIES} from "./charactersheet/charactersheet-consts.js";
import {deriveCharacterSheet} from "./charactersheet/charactersheet-derive.js";
import {CharacterSheetClassData} from "./charactersheet/charactersheet-classdata.js";
import {CharacterClassPanel} from "./charactersheet/charactersheet-classpanel.js";
import {CharacterInventoryPanel} from "./charactersheet/charactersheet-inventorypanel.js";
import {CharacterSpellsPanel} from "./charactersheet/charactersheet-spellspanel.js";
import {CharacterPageBase} from "./charactersheet/charactersheet-pagebase.js";
import {
	SIDEKICK_RULE_UID,
	getSidekickExpectedHp,
	getSidekickLevelTable,
	getSidekickSeed,
} from "./charactersheet/charactersheet-sidekick.js";

/**
 * The Sidekick Builder: a stat block plus levels in one of Tasha's three sidekick classes.
 *
 * A sidekick is stored as an ordinary character (same store, same model, same panels) with
 * `isSidekick` set, so everything the character sheet already does — derivation, the feature
 * timeline, spell slots, autosave, save/load — works here unchanged. This page is a DM's tool, so
 * every seeded value stays editable; nothing is locked once the creature is applied.
 */
class SidekickPage extends CharacterPageBase {
	constructor () {
		super();
		this._sidekickClasses = [];
	}

	/** The store is shared with the character pages; each page shows only its own kind. */
	_isCharacterListed (state) { return !!state?.isSidekick; }

	/** A newly created character on this page is a sidekick. */
	_getNewCharacterState () { return {isSidekick: true}; }

	_buildDom () {
		this._buildAbilities();
		this._buildSaves();
		this._buildSkills();
		this._buildDeathSaves();
		this._buildConditions();
	}

	_bindDom () {
		this._bindClick("cs-pick-creature", () => this._pOnPickCreature());
		this._bindClick("cs-hp-damage", () => this._adjustHp(-1));
		this._bindClick("cs-hp-heal", () => this._adjustHp(1));
		this._bindClick("cs-short-rest", () => this._comp.shortRest());
		this._bindClick("cs-long-rest", () => this._comp.longRest());
		// the base binds the print button, prep included
		this._bindClick("cs-attack-add", () => this._comp.addAttack());
		this._bindClick("cs-sk-rules-toggle", () => this._onToggleRules());

		this._pBuildClassSelect();
		document.getElementById("cs-sk-class").addEventListener("change", () => this._onChangeClass());

		this._attacksCollection = new _SidekickAttacks(this._comp, document.getElementById("cs-attacks-body"));
		this._comp._addHookBase("attacks", () => this._attacksCollection.render());

		this._classPanel = new CharacterClassPanel({comp: this._comp, wrp: document.getElementById("cs-class-panel")});
		this._classPanel.init();
		this._inventoryPanel = new CharacterInventoryPanel({comp: this._comp, wrp: document.getElementById("cs-inventory")});
		this._inventoryPanel.init();
		this._spellsPanel = new CharacterSpellsPanel({
			comp: this._comp,
			wrpSlots: document.getElementById("cs-spell-slots"),
			wrpKnown: document.getElementById("cs-spells-known"),
			wrpBody: document.getElementById("cs-spell-body"),
		});
		this._spellsPanel.init();

		this._comp._addHookBase("deathSuccess", () => this._renderDeathSaves());
		this._comp._addHookBase("deathFail", () => this._renderDeathSaves());
		this._comp._addHookBase("conditions", () => this._renderConditions());
		this._comp._addHookBase("classes", () => {
			this._renderClassSelect();
			this._renderLevelTable();
			this._renderSubtitle();
		});
		this._comp._addHookBase("refCreature", () => this._renderSubtitle());
		this._comp._addHookBase("level", () => this._renderLevelTable());
	}

	_doRenderAll () {
		this._syncAllInputs();
		this._attacksCollection.render();
		this._renderPickLinks();
		this._renderDeathSaves();
		this._renderConditions();
		this._renderProficiencies();
		this._renderSubtitle();
		this._renderClassSelect();
		this._renderLevelTable();
		this._renderDerived();
		this._lastLevel = this._comp.getLevelNumber();
	}

	/* -------------------------------------------- The base creature -------------------------------------------- */

	async _pOnPickCreature () {
		// The creature search reads the global content index, which only pages with the omnisearch
		// build on load — so this page has to ask for it before the first pick.
		await SearchWidget.pDoGlobalInit();

		const doc = await SearchWidget.pGetUserCreatureSearch();
		if (!doc) return;

		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
		if (!ent) return;

		const seed = getSidekickSeed(ent, {proficiencyBonus: deriveCharacterSheet(this._comp._getState()).pb});
		this._comp.applySidekickCreature({doc, ent, seed});

		// The stat block's hit die is what the sidekick gains per level from here on. The model keeps
		// it, so a class chosen later picks it up too.
		const entry = this._comp._state.classes[0];
		if (entry && seed.hitDie) {
			entry.hdFaces = seed.hitDie;
			this._comp._triggerCollectionUpdate("classes");
		}
		if (seed.hitDie) this._comp._state.hdTotal = `${this._comp.getLevelNumber()}d${seed.hitDie}`;

		this._renderSubtitle();
	}

	/** The stat-block line under the name: what it was, and what it has become. */
	_renderSubtitle () {
		const ele = document.getElementById("cs-sk-subtitle");
		if (!ele) return;

		const ref = this._comp._state.refCreature;
		const cls = this._comp._state.classes[0];
		if (!ref && !cls) {
			ele.innerHTML = `<span class="ve-muted">Pick a base creature, or just type the numbers in by hand.</span>`;
			return;
		}

		const ptCreature = ref ? Renderer.get().render(ref.tag || ref.name) : "";
		const ptClass = cls ? `${cls.name} ${cls.level}` : "sidekick";
		ele.innerHTML = [ptCreature, `<span class="ve-muted">${ptClass.qq()}</span>`].filter(Boolean).join(" <span class=\"ve-muted\">&mdash;</span> ");
	}

	/* -------------------------------------------- The sidekick class -------------------------------------------- */

	async _pBuildClassSelect () {
		this._sidekickClasses = await CharacterSheetClassData.pGetAllSidekickClasses().catch(() => []);
		const sel = document.getElementById("cs-sk-class");
		sel.innerHTML = `<option value="">&mdash;</option>${this._sidekickClasses
			.map((cls, ix) => `<option value="${ix}">${cls.name.qq()}</option>`)
			.join("")}`;
		this._renderClassSelect();
		this._renderLevelTable();
	}

	_renderClassSelect () {
		const sel = document.getElementById("cs-sk-class");
		if (!sel || !this._sidekickClasses.length) return;
		const cur = this._comp._state.classes[0];
		const ix = cur ? this._sidekickClasses.findIndex(it => it.name === cur.name && it.source === cur.source) : -1;
		sel.value = ix >= 0 ? `${ix}` : "";
	}

	_onChangeClass () {
		const sel = document.getElementById("cs-sk-class");
		const cls = this._sidekickClasses[Number(sel.value)];
		if (!cls) return;
		this._comp.setSidekickClass(cls, {level: this._comp.getLevelNumber()});
	}

	/* -------------------------------------------- "How sidekicks level" -------------------------------------------- */

	_getCurrentClass () {
		const cur = this._comp._state.classes[0];
		return cur ? this._sidekickClasses.find(it => it.name === cur.name && it.source === cur.source) : null;
	}

	/**
	 * What this sidekick gains at each level, with the current level marked — the thing a DM wants
	 * to see when the party levels up. Read from the class data, so it needs no upkeep.
	 */
	_renderLevelTable () {
		const wrp = document.getElementById("cs-sk-level-table");
		if (!wrp) return;

		const cls = this._getCurrentClass();
		if (!cls) {
			wrp.innerHTML = `<div class="ve-muted ve-small">Choose a sidekick class to see what it gains at each level.</div>`;
			return;
		}

		const level = this._comp.getLevelNumber();
		const rows = getSidekickLevelTable(cls);
		const hitDie = this._comp._state.sidekickHitDie || this._comp._state.classes[0]?.hdFaces;

		wrp.innerHTML = `
			<div class="ve-small ve-muted ve-mb-1">A sidekick levels up whenever the party's average level does. Each level it gains one Hit Die${hitDie ? ` (d${hitDie})` : ""} plus its Constitution modifier in hit points, and its proficiency bonus follows its level.</div>
			<table class="cs__sk-table w-100">
				<thead><tr><th>Lvl</th><th>PB</th><th>Gains</th></tr></thead>
				<tbody>
					${rows.map(row => `
						<tr class="${row.level === level ? "cs__sk-row--now" : ""}${row.level > level ? " cs__sk-row--future" : ""}">
							<td class="ve-text-center">${row.level}</td>
							<td class="ve-text-center">+${row.pb}</td>
							<td>${row.features.length ? row.features.map(it => it.qq()).join(", ") : "<span class=\"ve-muted\">&mdash;</span>"}</td>
						</tr>
					`).join("")}
				</tbody>
			</table>`;
	}

	async _onToggleRules () {
		const wrp = document.getElementById("cs-sk-rules");
		if (!wrp) return;

		if (!wrp.dataset.isLoaded) {
			const [name, source] = SIDEKICK_RULE_UID.split("|");
			const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_VARIANTRULES]({name, source});
			const ent = await DataLoader.pCacheAndGet(UrlUtil.PG_VARIANTRULES, source, hash).catch(() => null);
			wrp.innerHTML = ent
				? Renderer.get().setFirstSection(true).render({type: "entries", entries: ent.entries})
				: `<div class="ve-muted">Could not load the sidekick rules.</div>`;
			wrp.dataset.isLoaded = "1";
		}

		const isHidden = wrp.classList.toggle("ve-hidden");
		document.getElementById("cs-sk-rules-toggle").textContent = isHidden ? "Full rules" : "Hide rules";
	}

	/* -------------------------------------------- Derived rendering -------------------------------------------- */

	_renderDerived () {
		const derived = deriveCharacterSheet(this._comp._getState());

		const elePb = document.getElementById("cs-pb");
		if (elePb) elePb.textContent = CharacterPageBase.fmtBonus(derived.pb);

		this._renderAbilitiesSavesSkills(derived);
		this._renderRoll("cs-initiative-roll", derived.initiative, "Initiative", derived.initiativeParts);

		// Hit points the rules would give, as a hint rather than a correction
		const eleHint = document.getElementById("cs-sk-hp-hint");
		if (eleHint) {
			const hitDie = this._comp._state.sidekickHitDie || this._comp._state.classes[0]?.hdFaces;
			const expected = getSidekickExpectedHp({
				baseHp: this._comp._state.refCreature ? this._comp._state.hpMax : null,
				hitDie,
				conMod: derived.abilities.con.mod,
				level: this._comp.getLevelNumber(),
			});
			eleHint.textContent = hitDie ? `Gains ~${Math.max(1, Math.floor(hitDie / 2) + 1 + derived.abilities.con.mod)} HP per level` : "";
			eleHint.title = expected != null ? `A d${hitDie} sidekick at this level would have about ${expected} HP` : "";
		}

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
			CharacterPageBase.setSpellBadgesVisible(!!derived.spell);
		}
	}
}

/** The attacks table — the same three editable columns the character sheet uses. */
class _SidekickAttacks extends RenderableCollectionBase {
	constructor (comp, wrpRows) {
		super(comp, "attacks");
		this._wrpRows = wrpRows;
	}

	getNewRender (entity) {
		const row = document.createElement("tr");
		const mk = (type, prop, cls, placeholder) => {
			const ipt = document.createElement("input");
			ipt.type = type;
			ipt.className = `ve-form-control ve-input-xs ${cls}`;
			if (placeholder) ipt.placeholder = placeholder;
			ipt.value = entity.entity[prop] ?? "";
			ipt.addEventListener("change", () => {
				this._comp.updateAttack(entity.entity.id, {[prop]: type === "number" ? Number(ipt.value) || 0 : ipt.value});
			});
			const td = document.createElement("td");
			td.appendChild(ipt);
			return {td, ipt};
		};

		const name = mk("text", "name", "", "e.g. Spear");
		const atk = mk("number", "atkBonus", "cs__ipt-num cs__ipt-num--xs");
		const dmg = mk("text", "damage", "cs__atk-dmg", "e.g. 1d6+1 piercing");

		const tdRoll = document.createElement("td");
		tdRoll.className = "ve-text-center";
		const tdDel = document.createElement("td");
		tdDel.className = "ve-text-center no-print";
		const btnDel = document.createElement("button");
		btnDel.type = "button";
		btnDel.className = "ve-btn ve-btn-xxs ve-btn-danger";
		btnDel.innerHTML = `<span class="glyphicon glyphicon-trash"></span>`;
		btnDel.addEventListener("click", () => this._comp.removeAttack(entity.entity.id));
		tdDel.appendChild(btnDel);

		row.append(name.td, atk.td, dmg.td, tdDel);
		this._wrpRows.appendChild(row);
		return {wrp: row, fnUpdate: () => {}, iptName: name.ipt, iptAtk: atk.ipt, iptDmg: dmg.ipt};
	}

	doUpdateExistingRender (renderedMeta, entity) {
		const {entity: atk} = entity;
		if (document.activeElement !== renderedMeta.iptName) renderedMeta.iptName.value = atk.name ?? "";
		if (document.activeElement !== renderedMeta.iptAtk) renderedMeta.iptAtk.value = atk.atkBonus ?? 0;
		if (document.activeElement !== renderedMeta.iptDmg) renderedMeta.iptDmg.value = atk.damage ?? "";
	}
}

window.addEventListener("load", () => {
	const page = new SidekickPage();
	page.init();
});

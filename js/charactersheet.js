import {CHAR_SHEET_ABILITIES, CHAR_SHEET_SKILLS} from "./charactersheet/charactersheet-consts.js";
import {deriveCharacterSheet, getAbilityModifier, getProfBonus} from "./charactersheet/charactersheet-derive.js";
import {CharacterClassPanel} from "./charactersheet/charactersheet-classpanel.js";
import {CharacterInventoryPanel} from "./charactersheet/charactersheet-inventorypanel.js";
import {CharacterSpellsPanel} from "./charactersheet/charactersheet-spellspanel.js";
import {CharacterPageBase} from "./charactersheet/charactersheet-pagebase.js";

/** Renders the attacks table from the model's `attacks` collection. */
class _AttacksRenderableCollection extends RenderableCollectionBase {
	constructor (comp, wrpRows) {
		super(comp, "attacks");
		this._wrpRows = wrpRows;
	}

	getNewRender (entity) {
		const tr = document.createElement("tr");
		tr.className = "cs__atk-row";
		tr.innerHTML = `
			<td><input type="text" class="ve-form-control ve-input-xs cs__atk-name" placeholder="e.g. Longsword"></td>
			<td class="ve-text-center">
				<div class="cs__atk-cell">
					<input type="number" class="ve-form-control ve-input-xs cs__ipt-num cs__ipt-num--xs cs__atk-bonus">
					<span class="cs__roll cs__atk-hit"></span>
				</div>
			</td>
			<td class="ve-text-center">
				<div class="cs__atk-cell">
					<input type="text" class="ve-form-control ve-input-xs cs__atk-dmg" placeholder="e.g. 1d8+3 slashing">
					<span class="cs__roll cs__atk-dmgroll"></span>
				</div>
			</td>
			<td class="ve-text-center no-print">
				<button type="button" class="ve-btn ve-btn-xs ve-btn-danger cs__atk-rm" title="Remove"><span class="glyphicon glyphicon-trash"></span></button>
			</td>
		`;

		const meta = {
			wrpRow: tr,
			iptName: tr.querySelector(".cs__atk-name"),
			iptBonus: tr.querySelector(".cs__atk-bonus"),
			iptDmg: tr.querySelector(".cs__atk-dmg"),
			dispHit: tr.querySelector(".cs__atk-hit"),
			dispDmg: tr.querySelector(".cs__atk-dmgroll"),
		};

		meta.iptName.addEventListener("input", () => this._comp.updateAttack(entity.id, {name: meta.iptName.value}));
		meta.iptBonus.addEventListener("input", () => this._comp.updateAttack(entity.id, {atkBonus: Number(meta.iptBonus.value) || 0}));
		meta.iptDmg.addEventListener("input", () => this._comp.updateAttack(entity.id, {damage: meta.iptDmg.value}));
		tr.querySelector(".cs__atk-rm").addEventListener("click", () => this._comp.removeAttack(entity.id));

		this._wrpRows.appendChild(tr);
		this.doUpdateExistingRender(meta, entity);

		return meta;
	}

	doUpdateExistingRender (meta, entity) {
		this.constructor._setIptValue(meta.iptName, entity.name);
		this.constructor._setIptValue(meta.iptBonus, `${entity.atkBonus ?? 0}`);
		this.constructor._setIptValue(meta.iptDmg, entity.damage);
		this.constructor._renderRolls(meta, entity);
	}

	doDeleteExistingRender (meta) {
		meta.wrpRow.remove();
	}

	/** Avoid clobbering the input the user is currently typing in. */
	static _setIptValue (ipt, val) {
		if (document.activeElement === ipt) return;
		if (ipt.value !== val) ipt.value = val;
	}

	static _renderRolls (meta, entity) {
		const name = (entity.name || "").trim();
		const bonus = Number(entity.atkBonus) || 0;
		const dmg = (entity.damage || "").trim();

		meta.dispHit.innerHTML = Renderer.get().render(`{@hit ${bonus}|${CharacterPageBase.fmtBonus(bonus)}|${name || "Attack"}}`);

		if (dmg && /\d\s*d\s*\d/i.test(dmg)) {
			meta.dispDmg.innerHTML = Renderer.get().render(`{@dice ${dmg}|${dmg}|${name || "Damage"}}`);
			meta.dispDmg.classList.remove("ve-hidden");
		} else {
			meta.dispDmg.innerHTML = "";
			meta.dispDmg.classList.add("ve-hidden");
		}
	}
}

/** The play-and-build character sheet page (the current all-in-one sheet). */
class CharacterSheetPage extends CharacterPageBase {
	/* -------------------------------------------- DOM assembly -------------------------------------------- */

	_buildDom () {
		this._buildAbilities();
		this._buildSaves();
		this._buildSkills();
		this._buildDeathSaves();
	}

	_bindDom () {
		// Sheet-specific toolbar controls (the base binds save/load/print/reset + the switcher)
		this._bindClick("cs-btn-wizard", () => this._pOnWizard());
		this._bindClick("cs-attack-add", () => this._comp.addAttack());
		this._bindClick("cs-hp-damage", () => this._adjustHp(-1));
		this._bindClick("cs-hp-heal", () => this._adjustHp(1));

		this._bindDataPickers();

		this._attacksCollection = new _AttacksRenderableCollection(this._comp, document.getElementById("cs-attacks-body"));
		this._comp._addHookBase("attacks", () => this._attacksCollection.render());

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
		this._comp._addHookBase("deathSuccess", () => this._renderDeathSaves());
		this._comp._addHookBase("deathFail", () => this._renderDeathSaves());
	}

	_onStoreLoaded () {
		if (!this._comp._state.attacks.length) this._comp.addAttack();
	}

	_doRenderAll () {
		this._syncAllInputs();
		this._attacksCollection.render();
		this._renderPickLinks();
		this._renderDeathSaves();
		this._renderDerived();
		this._lastLevel = this._comp.getLevelNumber();
	}

	/* -------------------------------------------- DOM scaffolding -------------------------------------------- */

	_buildSaves () {
		const wrp = document.getElementById("cs-saves");
		wrp.innerHTML = CHAR_SHEET_ABILITIES
			.map(([abv, name]) => `
				<label class="cs__list-row" title="Toggle proficiency in ${name} saving throws">
					<input type="checkbox" id="cs-save-${abv}" class="cs__list-cb">
					<span class="cs__roll cs__list-mod" id="cs-saveroll-${abv}">+0</span>
					<span class="cs__list-name">${name}</span>
				</label>
			`)
			.join("");

		CHAR_SHEET_ABILITIES.forEach(([abv]) => this._bindCb(`cs-save-${abv}`, `save_${abv}`));
	}

	_buildSkills () {
		const wrp = document.getElementById("cs-skills");
		wrp.innerHTML = CHAR_SHEET_SKILLS
			.map(skill => `
				<div class="cs__list-row" data-cs-skill="${skill.key}">
					<button type="button" class="cs__prof" id="cs-skillprof-${skill.key}" title="Click to cycle: not proficient → proficient → expertise"></button>
					<span class="cs__roll cs__list-mod" id="cs-skillroll-${skill.key}">+0</span>
					<span class="cs__list-name">${skill.name} <span class="cs__list-abil ve-muted">(${Parser.attAbvToFull(skill.ability).slice(0, 3)})</span></span>
				</div>
			`)
			.join("");

		CHAR_SHEET_SKILLS.forEach(skill => {
			document.getElementById(`cs-skillprof-${skill.key}`).addEventListener("click", () => {
				const prop = `skill_${skill.key}`;
				this._comp._state[prop] = ((Number(this._comp._state[prop]) || 0) + 1) % 3;
			});
		});
	}

	_buildDeathSaves () {
		[["cs-death-success", "deathSuccess"], ["cs-death-fail", "deathFail"]]
			.forEach(([id, prop]) => {
				const wrp = document.getElementById(id);
				const max = Number(wrp.getAttribute("data-cs-max"));
				for (let i = 0; i < max; ++i) {
					const dot = document.createElement("button");
					dot.type = "button";
					dot.className = "cs__death-dot";
					dot.addEventListener("click", () => {
						const cur = this._comp._state[prop];
						this._comp._state[prop] = (i + 1 === cur) ? i : i + 1;
					});
					wrp.appendChild(dot);
				}
			});
	}

	_renderDeathSaves () {
		[["cs-death-success", this._comp._state.deathSuccess], ["cs-death-fail", this._comp._state.deathFail]]
			.forEach(([id, cnt]) => {
				const dots = document.getElementById(id).querySelectorAll(".cs__death-dot");
				dots.forEach((dot, ix) => dot.classList.toggle("cs__death-dot--active", ix < cnt));
			});
	}

	_adjustHp (sign) {
		// The delta input is transient UI, not character state, so it is not model-bound
		const eleDelta = document.getElementById("cs-hp-delta");
		const delta = Math.abs(Number(eleDelta.value) || 0);
		if (!delta) return;
		this._comp._state.hpCur = (Number(this._comp._state.hpCur) || 0) + (sign * delta);
		eleDelta.value = "0";
	}

	/* -------------------------------------------- Data pickers -------------------------------------------- */

	_bindDataPickers () {
		this._bindBuildPickers();
		this._bindClick("cs-attack-add-weapon", () => this._onPickWeapon());
		// The spell picker is bound by the spells panel
	}

	async _onPickWeapon () {
		const doc = await SearchWidget.pGetUserItemSearch();
		if (!doc) return;
		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
		this._comp.addAttack(this._weaponToAttack(ent || {}, doc.n));
	}

	_weaponToAttack (item, name) {
		const state = this._comp._getState();
		const pb = getProfBonus(state);
		const typeAbv = String(item.type || "").split("|")[0];
		const props = (item.property || []).map(p => String(p).split("|")[0]);
		const isFinesse = props.includes("F");
		const isRanged = typeAbv === "R";

		let abv = "str";
		if (isRanged) abv = "dex";
		else if (isFinesse) abv = getAbilityModifier(state, "dex") > getAbilityModifier(state, "str") ? "dex" : "str";
		const abilMod = getAbilityModifier(state, abv);

		let damage = "";
		if (item.dmg1) {
			const dmgType = item.dmgType ? ` ${Parser.dmgTypeToFull(item.dmgType)}` : "";
			const modStr = abilMod === 0 ? "" : (abilMod > 0 ? `+${abilMod}` : `${abilMod}`);
			damage = `${item.dmg1}${modStr}${dmgType}`;
		}

		return {name: name || item.name || "", atkBonus: abilMod + pb, damage};
	}

	/* -------------------------------------------- Derived rendering -------------------------------------------- */

	_renderDerived () {
		const derived = deriveCharacterSheet(this._comp._getState());

		document.getElementById("cs-pb").textContent = CharacterPageBase.fmtBonus(derived.pb);

		CHAR_SHEET_ABILITIES.forEach(([abv, name]) => {
			this._renderRoll(`cs-mod-${abv}`, derived.abilities[abv].mod, `${name} check`);
			this._renderRoll(`cs-saveroll-${abv}`, derived.saves[abv].mod, `${name} save`);
		});

		CHAR_SHEET_SKILLS.forEach(skill => {
			const {mod, profState} = derived.skills[skill.key];
			this._renderRoll(`cs-skillroll-${skill.key}`, mod, skill.name);

			const btn = document.getElementById(`cs-skillprof-${skill.key}`);
			btn.classList.toggle("cs__prof--1", profState === 1);
			btn.classList.toggle("cs__prof--2", profState === 2);
		});

		document.getElementById("cs-passive-perception").textContent = `${derived.passivePerception}`;

		document.getElementById("cs-initiative-roll").innerHTML = Renderer.get().render(`{@initiative ${derived.initiative}|${CharacterPageBase.fmtBonus(derived.initiative)}}`);

		const eleDc = document.getElementById("cs-spell-dc");
		const eleAtk = document.getElementById("cs-spell-atk");
		if (derived.spell) {
			eleDc.textContent = `${derived.spell.dc}`;
			eleAtk.innerHTML = Renderer.get().render(`{@d20 ${derived.spell.atkMod}|${CharacterPageBase.fmtBonus(derived.spell.atkMod)}|Spell attack}`);
		} else {
			eleDc.textContent = "—";
			eleAtk.textContent = "—";
		}
	}
}

window.addEventListener("load", () => {
	const page = new CharacterSheetPage();
	page.init();
});

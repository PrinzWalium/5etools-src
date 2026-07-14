class CharacterSheetPage {
	static _STORAGE_KEY = "charactersheet-state";
	static _FILE_TYPE = "charactersheet";
	static _SKILL_KEY_BY_NAME = null;

	static _ABILITIES = [
		["str", "Strength"],
		["dex", "Dexterity"],
		["con", "Constitution"],
		["int", "Intelligence"],
		["wis", "Wisdom"],
		["cha", "Charisma"],
	];

	static _SKILLS = [
		{key: "acrobatics", name: "Acrobatics", ability: "dex"},
		{key: "animalHandling", name: "Animal Handling", ability: "wis"},
		{key: "arcana", name: "Arcana", ability: "int"},
		{key: "athletics", name: "Athletics", ability: "str"},
		{key: "deception", name: "Deception", ability: "cha"},
		{key: "history", name: "History", ability: "int"},
		{key: "insight", name: "Insight", ability: "wis"},
		{key: "intimidation", name: "Intimidation", ability: "cha"},
		{key: "investigation", name: "Investigation", ability: "int"},
		{key: "medicine", name: "Medicine", ability: "wis"},
		{key: "nature", name: "Nature", ability: "int"},
		{key: "perception", name: "Perception", ability: "wis"},
		{key: "performance", name: "Performance", ability: "cha"},
		{key: "persuasion", name: "Persuasion", ability: "cha"},
		{key: "religion", name: "Religion", ability: "int"},
		{key: "sleightOfHand", name: "Sleight of Hand", ability: "dex"},
		{key: "stealth", name: "Stealth", ability: "dex"},
		{key: "survival", name: "Survival", ability: "wis"},
	];

	// Plain inputs whose value is persisted verbatim
	static _FIELD_IDS = [
		"cs-name", "cs-classlevel", "cs-background", "cs-playername", "cs-species", "cs-alignment", "cs-xp",
		"cs-level", "cs-ac", "cs-init-misc", "cs-speed",
		"cs-hp-max", "cs-hp-cur", "cs-hp-temp", "cs-hd-total", "cs-hd-cur",
		"cs-spell-ability", "cs-spells",
		"cs-features", "cs-equipment", "cs-proficiencies", "cs-personality",
		"cs-cp", "cs-sp", "cs-ep", "cs-gp", "cs-pp",
	];

	constructor () {
		this._deathSuccess = 0;
		this._deathFail = 0;
		this._isLoading = false;
		this._pickTags = {};
		this._classCache = null;
	}

	init () {
		this._buildAbilities();
		this._buildSaves();
		this._buildSkills();
		this._buildDeathSaves();

		this._bindStaticControls();
		this._bindDataPickers();

		const stored = StorageUtil.syncGetForPage(CharacterSheetPage._STORAGE_KEY);
		if (stored) this._setStateFrom(stored);
		else this._addAttackRow();

		this._renderPickLinks();
		this._recomputeAll();

		window.dispatchEvent(new Event("toolsLoaded"));
	}

	/* -------------------------------------------- Builders -------------------------------------------- */

	_buildAbilities () {
		const wrp = document.getElementById("cs-abilities");
		wrp.innerHTML = CharacterSheetPage._ABILITIES
			.map(([abv, name]) => `
				<div class="cs__ability" data-cs-ability="${abv}">
					<span class="cs__lbl cs__ability-name">${name}</span>
					<input type="number" id="cs-abil-${abv}" value="10" min="1" max="30" class="ve-form-control ve-input-xs cs__ability-score">
					<span class="cs__ability-mod cs__roll" id="cs-mod-${abv}">+0</span>
				</div>
			`)
			.join("");

		CharacterSheetPage._ABILITIES.forEach(([abv]) => {
			document.getElementById(`cs-abil-${abv}`).addEventListener("input", () => {
				this._recomputeAll();
				this._saveStateDebounced();
			});
		});
	}

	_buildSaves () {
		const wrp = document.getElementById("cs-saves");
		wrp.innerHTML = CharacterSheetPage._ABILITIES
			.map(([abv, name]) => `
				<label class="cs__list-row" title="Toggle proficiency in ${name} saving throws">
					<input type="checkbox" id="cs-save-${abv}" class="cs__list-cb">
					<span class="cs__roll cs__list-mod" id="cs-saveroll-${abv}">+0</span>
					<span class="cs__list-name">${name}</span>
				</label>
			`)
			.join("");

		CharacterSheetPage._ABILITIES.forEach(([abv]) => {
			document.getElementById(`cs-save-${abv}`).addEventListener("change", () => {
				this._recomputeAll();
				this._saveStateDebounced();
			});
		});
	}

	_buildSkills () {
		const wrp = document.getElementById("cs-skills");
		wrp.innerHTML = CharacterSheetPage._SKILLS
			.map(skill => `
				<div class="cs__list-row" data-cs-skill="${skill.key}">
					<button type="button" class="cs__prof" id="cs-skillprof-${skill.key}" data-cs-prof="0" title="Click to cycle: not proficient \u2192 proficient \u2192 expertise"></button>
					<span class="cs__roll cs__list-mod" id="cs-skillroll-${skill.key}">+0</span>
					<span class="cs__list-name">${skill.name} <span class="cs__list-abil ve-muted">(${Parser.attAbvToFull(skill.ability).slice(0, 3)})</span></span>
				</div>
			`)
			.join("");

		CharacterSheetPage._SKILLS.forEach(skill => {
			document.getElementById(`cs-skillprof-${skill.key}`).addEventListener("click", (evt) => {
				const btn = evt.currentTarget;
				const next = (Number(btn.getAttribute("data-cs-prof")) + 1) % 3;
				this._setProfState(btn, next);
				this._recomputeAll();
				this._saveStateDebounced();
			});
		});
	}

	_setProfState (btn, val) {
		btn.setAttribute("data-cs-prof", `${val}`);
		btn.classList.toggle("cs__prof--1", val === 1);
		btn.classList.toggle("cs__prof--2", val === 2);
	}

	_buildDeathSaves () {
		[["cs-death-success", "_deathSuccess"], ["cs-death-fail", "_deathFail"]]
			.forEach(([id, prop]) => {
				const wrp = document.getElementById(id);
				const max = Number(wrp.getAttribute("data-cs-max"));
				for (let i = 0; i < max; ++i) {
					const dot = document.createElement("button");
					dot.type = "button";
					dot.className = "cs__death-dot";
					dot.setAttribute("data-cs-ix", `${i}`);
					dot.addEventListener("click", () => {
						const cur = this[prop];
						this[prop] = (i + 1 === cur) ? i : i + 1;
						this._renderDeathSaves();
						this._saveStateDebounced();
					});
					wrp.appendChild(dot);
				}
			});
		this._renderDeathSaves();
	}

	_renderDeathSaves () {
		[["cs-death-success", this._deathSuccess], ["cs-death-fail", this._deathFail]]
			.forEach(([id, cnt]) => {
				const dots = document.getElementById(id).querySelectorAll(".cs__death-dot");
				dots.forEach((dot, ix) => dot.classList.toggle("cs__death-dot--active", ix < cnt));
			});
	}

	_addAttackRow (data = {}) {
		const tbody = document.getElementById("cs-attacks-body");
		const tr = document.createElement("tr");
		tr.className = "cs__atk-row";
		tr.innerHTML = `
			<td><input type="text" class="ve-form-control ve-input-xs cs__atk-name" placeholder="e.g. Longsword" value="${(data.name || "").qq()}"></td>
			<td class="ve-text-center">
				<div class="cs__atk-cell">
					<input type="number" class="ve-form-control ve-input-xs cs__ipt-num cs__ipt-num--xs cs__atk-bonus" value="${data.atkBonus != null ? Number(data.atkBonus) : 0}">
					<span class="cs__roll cs__atk-hit"></span>
				</div>
			</td>
			<td class="ve-text-center">
				<div class="cs__atk-cell">
					<input type="text" class="ve-form-control ve-input-xs cs__atk-dmg" placeholder="e.g. 1d8+3 slashing" value="${(data.damage || "").qq()}">
					<span class="cs__roll cs__atk-dmgroll"></span>
				</div>
			</td>
			<td class="ve-text-center no-print">
				<button type="button" class="ve-btn ve-btn-xs ve-btn-danger cs__atk-rm" title="Remove"><span class="glyphicon glyphicon-trash"></span></button>
			</td>
		`;

		tbody.appendChild(tr);

		const iptBonus = tr.querySelector(".cs__atk-bonus");
		const iptDmg = tr.querySelector(".cs__atk-dmg");
		const iptName = tr.querySelector(".cs__atk-name");

		iptBonus.addEventListener("input", () => { this._renderAttackRow(tr); this._saveStateDebounced(); });
		iptDmg.addEventListener("input", () => { this._renderAttackRow(tr); this._saveStateDebounced(); });
		iptName.addEventListener("input", () => this._saveStateDebounced());
		tr.querySelector(".cs__atk-rm").addEventListener("click", () => {
			tr.remove();
			this._saveStateDebounced();
		});

		this._renderAttackRow(tr);
	}

	_renderAttackRow (tr) {
		const name = tr.querySelector(".cs__atk-name").value.trim();
		const bonus = Number(tr.querySelector(".cs__atk-bonus").value) || 0;
		const dmg = tr.querySelector(".cs__atk-dmg").value.trim();

		tr.querySelector(".cs__atk-hit").innerHTML = Renderer.get().render(`{@hit ${bonus}|${CharacterSheetPage._fmtBonus(bonus)}|${name || "Attack"}}`);

		const eleDmg = tr.querySelector(".cs__atk-dmgroll");
		if (dmg && /\d\s*d\s*\d/i.test(dmg)) {
			eleDmg.innerHTML = Renderer.get().render(`{@dice ${dmg}|${dmg}|${name || "Damage"}}`);
			eleDmg.classList.remove("ve-hidden");
		} else {
			eleDmg.innerHTML = "";
			eleDmg.classList.add("ve-hidden");
		}
	}

	/* -------------------------------------------- Controls -------------------------------------------- */

	_bindStaticControls () {
		CharacterSheetPage._FIELD_IDS.forEach(id => {
			const ele = document.getElementById(id);
			if (!ele) return;
			ele.addEventListener("input", () => {
				this._recomputeAll();
				this._saveStateDebounced();
			});
			ele.addEventListener("change", () => {
				this._recomputeAll();
				this._saveStateDebounced();
			});
		});

		document.getElementById("cs-inspiration").addEventListener("change", () => this._saveStateDebounced());

		document.getElementById("cs-attack-add").addEventListener("click", () => {
			this._addAttackRow();
			this._saveStateDebounced();
		});

		document.getElementById("cs-hp-damage").addEventListener("click", () => this._adjustHp(-1));
		document.getElementById("cs-hp-heal").addEventListener("click", () => this._adjustHp(1));

		document.getElementById("cs-btn-save").addEventListener("click", () => this._onSaveToFile());
		document.getElementById("cs-btn-load").addEventListener("click", () => this._onLoadFromFile());
		document.getElementById("cs-btn-print").addEventListener("click", () => window.print());
		document.getElementById("cs-btn-reset").addEventListener("click", () => this._onReset());
	}

	_adjustHp (sign) {
		const eleDelta = document.getElementById("cs-hp-delta");
		const delta = Math.abs(Number(eleDelta.value) || 0);
		if (!delta) return;
		const eleCur = document.getElementById("cs-hp-cur");
		eleCur.value = `${(Number(eleCur.value) || 0) + sign * delta}`;
		eleDelta.value = "0";
		this._saveStateDebounced();
	}

	/* -------------------------------------------- Data pickers -------------------------------------------- */

	_bindDataPickers () {
		document.getElementById("cs-pick-species").addEventListener("click", () => this._onPickSpecies());
		document.getElementById("cs-pick-background").addEventListener("click", () => this._onPickBackground());
		document.getElementById("cs-pick-class").addEventListener("click", () => this._onPickClass());
		document.getElementById("cs-attack-add-weapon").addEventListener("click", () => this._onPickWeapon());
		document.getElementById("cs-spell-add").addEventListener("click", () => this._onPickSpell());
	}

	static _getSkillKeyByName (name) {
		if (!CharacterSheetPage._SKILL_KEY_BY_NAME) {
			CharacterSheetPage._SKILL_KEY_BY_NAME = {};
			CharacterSheetPage._SKILLS.forEach(s => { CharacterSheetPage._SKILL_KEY_BY_NAME[s.key.toLowerCase()] = s.key; });
		}
		const norm = String(name).replace(/[^a-z]/gi, "").toLowerCase();
		return CharacterSheetPage._SKILL_KEY_BY_NAME[norm] || null;
	}

	_setSkillProfByName (name, val) {
		const key = CharacterSheetPage._getSkillKeyByName(name);
		if (!key) return;
		this._setProfState(document.getElementById(`cs-skillprof-${key}`), val);
	}

	static _fmtProfList (arr) {
		if (!arr || !arr.length) return "";
		const out = [];
		arr.forEach(grp => {
			Object.entries(grp).forEach(([k, v]) => {
				if (v === true) out.push(k.toTitleCase());
				else if (k === "choose" && v && v.from) out.push(`${v.count || 1} of your choice`);
				else if (typeof v === "number") out.push(/^any/i.test(k) ? `${v} of your choice` : `${v}\u00d7 ${k.toTitleCase()}`);
				else if (/^any/i.test(k)) out.push("one of your choice");
			});
		});
		return out.join(", ");
	}

	_appendToTextarea (id, text) {
		if (!text) return;
		const ele = document.getElementById(id);
		const cur = (ele.value || "").trim();
		if (cur.includes(text)) return;
		ele.value = cur ? `${cur}\n${text}` : text;
	}

	_renderPickLink (which) {
		const ele = document.getElementById(`cs-link-${which}`);
		if (!ele) return;
		const tag = this._pickTags[which];
		ele.innerHTML = tag ? Renderer.get().render(tag) : "";
	}

	_renderPickLinks () {
		["species", "background", "class"].forEach(w => this._renderPickLink(w));
	}

	async _onPickSpecies () {
		const doc = await SearchWidget.pGetUserRaceSearch();
		if (!doc) return;
		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
		document.getElementById("cs-species").value = doc.n;
		this._pickTags.species = doc.tag;
		this._renderPickLink("species");
		if (ent) this._applyRace(ent);
		this._recomputeAll();
		this._saveStateDebounced();
	}

	_applyRace (race) {
		const speed = race.speed;
		let spd = null;
		if (typeof speed === "number") spd = speed;
		else if (speed && typeof speed === "object" && typeof speed.walk === "number") spd = speed.walk;
		if (spd != null) document.getElementById("cs-speed").value = `${spd} ft.`;

		(race.skillProficiencies || []).forEach(grp => {
			Object.entries(grp).forEach(([k, v]) => { if (v === true) this._setSkillProfByName(k, 1); });
		});
	}

	async _onPickBackground () {
		const doc = await SearchWidget.pGetUserBackgroundSearch();
		if (!doc) return;
		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
		document.getElementById("cs-background").value = doc.n;
		this._pickTags.background = doc.tag;
		this._renderPickLink("background");
		if (ent) this._applyBackground(ent);
		this._recomputeAll();
		this._saveStateDebounced();
	}

	_applyBackground (bg) {
		(bg.skillProficiencies || []).forEach(grp => {
			Object.entries(grp).forEach(([k, v]) => { if (v === true) this._setSkillProfByName(k, 1); });
		});
		const tools = CharacterSheetPage._fmtProfList(bg.toolProficiencies);
		const langs = CharacterSheetPage._fmtProfList(bg.languageProficiencies);
		const parts = [];
		if (tools) parts.push(`Tools: ${tools}`);
		if (langs) parts.push(`Languages: ${langs}`);
		if (parts.length) this._appendToTextarea("cs-proficiencies", parts.join("\n"));
	}

	async _pGetClasses () {
		if (this._classCache) return this._classCache;
		const page = UrlUtil.PG_CLASSES;
		const all = [
			...(await DataLoader.pCacheAndGetAllSite(page)),
			...(await DataLoader.pCacheAndGetAllPrerelease(page)),
			...(await DataLoader.pCacheAndGetAllBrew(page)),
		].filter(it => {
			if (!it.hd || it.className) return false; // base classes only (subclasses lack `hd`)
			const hash = UrlUtil.URL_TO_HASH_BUILDER[page](it);
			return !ExcludeUtil.isExcluded(hash, "class", it.source);
		});
		all.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source));
		return this._classCache = all;
	}

	async _onPickClass () {
		const classes = await this._pGetClasses();
		if (!classes.length) return;
		const cls = await InputUiUtil.pGetUserEnum({
			values: classes,
			isResolveItem: true,
			fnDisplay: c => `${c.name} (${Parser.sourceJsonToAbv(c.source)})`,
			title: "Select Class",
			placeholder: "Select a class...",
		});
		if (cls == null) return;

		const level = this._getLevel();
		document.getElementById("cs-classlevel").value = `${cls.name} ${level}`;
		this._pickTags.class = `{@class ${cls.name}${cls.source !== Parser.SRC_PHB ? `|${cls.source}` : ""}}`;
		this._renderPickLink("class");
		this._applyClass(cls, level);
		this._recomputeAll();
		this._saveStateDebounced();
	}

	_applyClass (cls, level) {
		if (cls.hd && cls.hd.faces) document.getElementById("cs-hd-total").value = `${level}d${cls.hd.faces}`;

		(cls.proficiency || []).forEach(abv => {
			const ele = document.getElementById(`cs-save-${abv}`);
			if (ele) ele.checked = true;
		});

		if (cls.spellcastingAbility) document.getElementById("cs-spell-ability").value = cls.spellcastingAbility;
	}

	async _onPickWeapon () {
		const doc = await SearchWidget.pGetUserItemSearch();
		if (!doc) return;
		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
		this._addAttackRow(this._weaponToAttack(ent || {}, doc.n));
		this._saveStateDebounced();
	}

	_weaponToAttack (item, name) {
		const pb = this._getProfBonus();
		const typeAbv = String(item.type || "").split("|")[0];
		const props = (item.property || []).map(p => String(p).split("|")[0]);
		const isFinesse = props.includes("F");
		const isRanged = typeAbv === "R";

		let abv = "str";
		if (isRanged) abv = "dex";
		else if (isFinesse) abv = this._getAbilMod("dex") > this._getAbilMod("str") ? "dex" : "str";
		const abilMod = this._getAbilMod(abv);

		let damage = "";
		if (item.dmg1) {
			const dmgType = item.dmgType ? ` ${Parser.dmgTypeToFull(item.dmgType)}` : "";
			const modStr = abilMod === 0 ? "" : (abilMod > 0 ? `+${abilMod}` : `${abilMod}`);
			damage = `${item.dmg1}${modStr}${dmgType}`;
		}

		return {name: name || item.name || "", atkBonus: abilMod + pb, damage};
	}

	async _onPickSpell () {
		const doc = await SearchWidget.pGetUserSpellSearch();
		if (!doc) return;
		this._appendToTextarea("cs-spells", doc.tag);
		this._saveStateDebounced();
	}

	/* -------------------------------------------- Calculations -------------------------------------------- */

	_getLevel () { return Math.min(20, Math.max(1, Number(document.getElementById("cs-level").value) || 1)); }
	_getProfBonus () { return 2 + Math.floor((this._getLevel() - 1) / 4); }
	_getAbilMod (abv) { return Parser.getAbilityModNumber(Number(document.getElementById(`cs-abil-${abv}`).value) || 10); }

	static _fmtBonus (n) { return `${n >= 0 ? "+" : "\u2212"}${Math.abs(n)}`; }

	_renderRoll (id, mod, name) {
		const ele = document.getElementById(id);
		if (!ele) return;
		ele.innerHTML = Renderer.get().render(`{@d20 ${mod}|${CharacterSheetPage._fmtBonus(mod)}|${name}}`);
	}

	_recomputeAll () {
		const pb = this._getProfBonus();
		document.getElementById("cs-pb").textContent = CharacterSheetPage._fmtBonus(pb);

		// Ability modifiers
		CharacterSheetPage._ABILITIES.forEach(([abv, name]) => {
			this._renderRoll(`cs-mod-${abv}`, this._getAbilMod(abv), `${name} check`);
		});

		// Saving throws
		CharacterSheetPage._ABILITIES.forEach(([abv, name]) => {
			const isProf = document.getElementById(`cs-save-${abv}`).checked;
			const mod = this._getAbilMod(abv) + (isProf ? pb : 0);
			this._renderRoll(`cs-saveroll-${abv}`, mod, `${name} save`);
		});

		// Skills
		CharacterSheetPage._SKILLS.forEach(skill => {
			const profState = Number(document.getElementById(`cs-skillprof-${skill.key}`).getAttribute("data-cs-prof")) || 0;
			const mod = this._getAbilMod(skill.ability) + (profState === 1 ? pb : profState === 2 ? pb * 2 : 0);
			this._renderRoll(`cs-skillroll-${skill.key}`, mod, skill.name);
			if (skill.key === "perception") {
				document.getElementById("cs-passive-perception").textContent = `${10 + mod}`;
			}
		});

		// Initiative
		const initMod = this._getAbilMod("dex") + (Number(document.getElementById("cs-init-misc").value) || 0);
		const eleInit = document.getElementById("cs-initiative-roll");
		eleInit.innerHTML = Renderer.get().render(`{@initiative ${initMod}|${CharacterSheetPage._fmtBonus(initMod)}}`);

		// Spellcasting
		const spellAbil = document.getElementById("cs-spell-ability").value;
		const eleDc = document.getElementById("cs-spell-dc");
		const eleAtk = document.getElementById("cs-spell-atk");
		if (spellAbil) {
			const abilMod = this._getAbilMod(spellAbil);
			eleDc.textContent = `${8 + pb + abilMod}`;
			eleAtk.innerHTML = Renderer.get().render(`{@d20 ${pb + abilMod}|${CharacterSheetPage._fmtBonus(pb + abilMod)}|Spell attack}`);
		} else {
			eleDc.textContent = "\u2014";
			eleAtk.textContent = "\u2014";
		}

		// Attacks (re-render clickable rolls)
		document.querySelectorAll("#cs-attacks-body .cs__atk-row").forEach(tr => this._renderAttackRow(tr));
	}

	/* -------------------------------------------- State -------------------------------------------- */

	_getSaveableState () {
		const state = {fields: {}, saves: {}, skills: {}, attacks: []};

		CharacterSheetPage._FIELD_IDS.forEach(id => {
			const ele = document.getElementById(id);
			if (ele) state.fields[id] = ele.value;
		});

		state.inspiration = document.getElementById("cs-inspiration").checked;

		CharacterSheetPage._ABILITIES.forEach(([abv]) => {
			state.fields[`cs-abil-${abv}`] = document.getElementById(`cs-abil-${abv}`).value;
			state.saves[abv] = document.getElementById(`cs-save-${abv}`).checked;
		});

		CharacterSheetPage._SKILLS.forEach(skill => {
			state.skills[skill.key] = Number(document.getElementById(`cs-skillprof-${skill.key}`).getAttribute("data-cs-prof")) || 0;
		});

		state.deathSuccess = this._deathSuccess;
		state.deathFail = this._deathFail;
		state.pickTags = {...this._pickTags};

		document.querySelectorAll("#cs-attacks-body .cs__atk-row").forEach(tr => {
			state.attacks.push({
				name: tr.querySelector(".cs__atk-name").value,
				atkBonus: Number(tr.querySelector(".cs__atk-bonus").value) || 0,
				damage: tr.querySelector(".cs__atk-dmg").value,
			});
		});

		return state;
	}

	_setStateFrom (state) {
		if (!state || typeof state !== "object") return;
		this._isLoading = true;

		const fields = state.fields || {};
		Object.entries(fields).forEach(([id, val]) => {
			const ele = document.getElementById(id);
			if (ele) ele.value = val;
		});

		document.getElementById("cs-inspiration").checked = !!state.inspiration;

		CharacterSheetPage._ABILITIES.forEach(([abv]) => {
			const eleSave = document.getElementById(`cs-save-${abv}`);
			if (eleSave) eleSave.checked = !!(state.saves && state.saves[abv]);
		});

		CharacterSheetPage._SKILLS.forEach(skill => {
			const btn = document.getElementById(`cs-skillprof-${skill.key}`);
			const val = (state.skills && state.skills[skill.key]) || 0;
			this._setProfState(btn, val);
		});

		this._deathSuccess = Math.min(3, Math.max(0, Number(state.deathSuccess) || 0));
		this._deathFail = Math.min(3, Math.max(0, Number(state.deathFail) || 0));
		this._renderDeathSaves();

		this._pickTags = state.pickTags && typeof state.pickTags === "object" ? {...state.pickTags} : {};
		this._renderPickLinks();

		document.getElementById("cs-attacks-body").innerHTML = "";
		const attacks = Array.isArray(state.attacks) && state.attacks.length ? state.attacks : [{}];
		attacks.forEach(atk => this._addAttackRow(atk));

		this._isLoading = false;
		this._recomputeAll();
	}

	_saveStateDebounced () {
		if (this._isLoading) return;
		if (this._saveTimer) clearTimeout(this._saveTimer);
		this._saveTimer = setTimeout(() => {
			StorageUtil.syncSetForPage(CharacterSheetPage._STORAGE_KEY, this._getSaveableState());
		}, 150);
	}

	/* -------------------------------------------- Toolbar actions -------------------------------------------- */

	_onSaveToFile () {
		const name = (document.getElementById("cs-name").value || "character").trim() || "character";
		DataUtil.userDownload(Parser.stringToSlug(name) || "character", this._getSaveableState(), {fileType: CharacterSheetPage._FILE_TYPE});
	}

	async _onLoadFromFile () {
		const {jsons, errors} = await InputUiUtil.pGetUserUploadJson({expectedFileTypes: [CharacterSheetPage._FILE_TYPE]});
		DataUtil.doHandleFileLoadErrorsGeneric(errors);
		if (!jsons?.length) return;
		this._setStateFrom(jsons[0]);
		this._saveStateDebounced();
	}

	async _onReset () {
		if (!await InputUiUtil.pGetUserBoolean({
			title: "Reset Character Sheet",
			htmlDescription: `<div>This will clear the entire sheet.<br>Are you sure?</div>`,
			textYes: "Reset",
			textNo: "Cancel",
		})) return;

		StorageUtil.syncSetForPage(CharacterSheetPage._STORAGE_KEY, null);
		window.location.reload();
	}
}

window.addEventListener("load", () => {
	const page = new CharacterSheetPage();
	page.init();
});

import {CharacterModel} from "./charactersheet-model.js";
import {getCharacterLabel, getMigratedStore, getNewStore} from "./charactersheet-charstore.js";
import {getLevelUpHp} from "./charactersheet-levelengine.js";

/**
 * Shared foundation for the two character pages (the play-focused sheet and the build-focused
 * builder). Owns the character model, the multi-character store + switcher, autosave/persistence,
 * file save/load, and the (null-safe) input-binding helpers. Page-specific DOM assembly and
 * rendering are provided by subclasses via the `_buildDom`/`_bindDom`/`_doRenderAll` hooks.
 *
 * Element wiring is null-safe: each page includes only the fields it needs, and the base skips
 * anything absent — so the two pages can have entirely independent layouts.
 */
export class CharacterPageBase {
	// Page-agnostic so both pages share one set of characters; migrated from the old per-page key.
	static _SHARED_STORAGE_KEY = "charactersheet-characters";
	static _LEGACY_STORAGE_KEY = "charactersheet-state";
	static _FILE_TYPE = "charactersheet";

	// Bindings shared by both pages; null-safe binding skips any element a given page omits.
	static _IPT_STR_BINDINGS = [
		["cs-name", "name"],
		["cs-classlevel", "classText"],
		["cs-background", "backgroundText"],
		["cs-playername", "playerName"],
		["cs-species", "speciesText"],
		["cs-alignment", "alignment"],
		["cs-speed", "speed"],
		["cs-hd-total", "hdTotal"],
		["cs-hd-cur", "hdCur"],
		["cs-spell-ability", "spellAbility"],
		["cs-spells", "spellsText"],
		["cs-features", "featuresText"],
		["cs-equipment", "equipmentText"],
		["cs-proficiencies", "proficienciesText"],
		["cs-personality", "personalityText"],
	];

	static _IPT_NUM_BINDINGS = [
		["cs-xp", "xp"],
		["cs-level", "level"],
		["cs-ac", "ac"],
		["cs-init-misc", "initMisc"],
		["cs-hp-max", "hpMax"],
		["cs-hp-cur", "hpCur"],
		["cs-hp-temp", "hpTemp"],
		["cs-cp", "cp"],
		["cs-sp", "sp"],
		["cs-ep", "ep"],
		["cs-gp", "gp"],
		["cs-pp", "pp"],
	];

	constructor () {
		this._comp = new CharacterModel();
		this._isLoading = false;
		this._saveTimer = null;
		this._store = null; // {storeVersion, currentId, characters: {id: envelope}}
		this._fnsSyncInput = []; // unconditional input-sync functions, for bulk state loads
		this._lastLevel = 1;
		this._suppressLevelPrompt = 0;
	}

	static fmtBonus (n) { return `${n >= 0 ? "+" : "−"}${Math.abs(n)}`; }

	/* -------------------------------------------- Lifecycle -------------------------------------------- */

	init () {
		this._buildDom();
		this._bindInputs();
		this._bindStoreControls();
		this._bindDom();

		this._comp._addHookBase("level", () => this._pMaybePromptLevelUp());
		this._comp._addHookAllBase(() => this._onStateChange());

		this._initStore();

		this._doRenderAll();

		window.dispatchEvent(new Event("toolsLoaded"));
	}

	// region Subclass hooks
	/** Build page-specific DOM scaffolding (ability boxes, lists, panels, ...). */
	_buildDom () {}
	/** Bind page-specific controls, pickers, and panels; register render hooks. */
	_bindDom () {}
	/** Re-render everything from current state (called after bulk loads). */
	_doRenderAll () { this._lastLevel = this._comp.getLevelNumber(); }
	/** Re-render derived values (called on any state change). */
	_renderDerived () {}
	// endregion

	_onStateChange () {
		if (this._isLoading) return;
		this._renderDerived();
		this._saveStateDebounced();
	}

	/* -------------------------------------------- Null-safe input binding -------------------------------------------- */

	_bindInputs () {
		CharacterPageBase._IPT_STR_BINDINGS.forEach(([id, prop]) => this._bindIptStr(id, prop));
		CharacterPageBase._IPT_NUM_BINDINGS.forEach(([id, prop]) => this._bindIptNum(id, prop));
		this._bindCb("cs-inspiration", "inspiration");
	}

	_bindIptStr (id, prop) {
		const ele = document.getElementById(id);
		if (!ele) return;
		const setState = () => this._comp._state[prop] = ele.value;
		ele.addEventListener("input", setState);
		ele.addEventListener("change", setState);

		const hook = () => {
			const val = this._comp._state[prop] ?? "";
			if (ele.value !== `${val}`) ele.value = val;
		};
		this._comp._addHookBase(prop, hook);
		this._fnsSyncInput.push(hook);
		hook();
	}

	_bindIptNum (id, prop) {
		const ele = document.getElementById(id);
		if (!ele) return;
		const setState = () => {
			const raw = ele.value.trim();
			const num = Number(raw);
			this._comp._state[prop] = raw === "" || isNaN(num) ? null : num;
		};
		ele.addEventListener("input", setState);
		ele.addEventListener("change", setState);

		const doSync = () => {
			const val = this._comp._state[prop];
			const asStr = val == null ? "" : `${val}`;
			if (ele.value !== asStr) ele.value = asStr;
		};
		const hook = () => {
			if (document.activeElement === ele) return; // don't clobber while typing
			doSync();
		};
		this._comp._addHookBase(prop, hook);
		this._fnsSyncInput.push(doSync);
		doSync();
	}

	_bindCb (id, prop) {
		const ele = document.getElementById(id);
		if (!ele) return;
		ele.addEventListener("change", () => this._comp._state[prop] = ele.checked);
		const hook = () => ele.checked = !!this._comp._state[prop];
		this._comp._addHookBase(prop, hook);
		this._fnsSyncInput.push(hook);
		hook();
	}

	/** Sync every bound input from state, bypassing focus guards (for bulk loads). */
	_syncAllInputs () { this._fnsSyncInput.forEach(fn => fn()); }

	/* -------------------------------------------- Store controls (toolbar) -------------------------------------------- */

	_bindStoreControls () {
		this._bindClick("cs-btn-save", () => this._onSaveToFile());
		this._bindClick("cs-btn-load", () => this._onLoadFromFile());
		this._bindClick("cs-btn-print", () => window.print());
		this._bindClick("cs-btn-reset", () => this._onReset());

		const sel = document.getElementById("cs-char-select");
		if (sel) sel.addEventListener("change", () => this._switchCharacter(sel.value));
		this._bindClick("cs-char-new", () => {
			this._persistNow();
			const id = CryptUtil.uid();
			this._store.characters[id] = null;
			this._switchCharacter(id);
		});
		this._bindClick("cs-char-delete", () => this._onDeleteCharacter());
	}

	_bindClick (id, fn) {
		const ele = document.getElementById(id);
		if (ele) ele.addEventListener("click", fn);
	}

	/* -------------------------------------------- Store / persistence -------------------------------------------- */

	_initStore () {
		const rawStore = StorageUtil.syncGet(CharacterPageBase._SHARED_STORAGE_KEY) ??
			StorageUtil.syncGet(`${CharacterPageBase._LEGACY_STORAGE_KEY}_charactersheet.html`);
		this._store = getMigratedStore(rawStore) || getNewStore();

		const envelope = this._store.characters[this._store.currentId];
		if (envelope) this._doLoadState(envelope);
		this._onStoreLoaded();
		this._renderCharacterSelect();
	}

	/** Subclass hook after the initial character is loaded (e.g. ensure a default attack row). */
	_onStoreLoaded () {}

	_doLoadState (saved) {
		this._isLoading = true;
		try {
			const isApplied = this._comp.setStateFrom(saved);
			if (!isApplied) JqueryUtil.doToast({type: "danger", content: "Could not load character&mdash;unknown save format."});
		} finally {
			this._isLoading = false;
		}
		this._doRenderAll();
	}

	_saveStateDebounced () {
		if (this._saveTimer) clearTimeout(this._saveTimer);
		this._saveTimer = setTimeout(() => this._persistNow(), 150);
	}

	_persistNow () {
		if (this._saveTimer) {
			clearTimeout(this._saveTimer);
			this._saveTimer = null;
		}
		this._store.characters[this._store.currentId] = this._comp.getSaveableState();
		StorageUtil.syncSet(CharacterPageBase._SHARED_STORAGE_KEY, this._store);
		this._renderCharacterSelect();
	}

	_renderCharacterSelect () {
		const sel = document.getElementById("cs-char-select");
		if (!sel) return;
		sel.innerHTML = Object.entries(this._store.characters)
			.map(([id, envelope]) => `<option value="${id.qq()}">${getCharacterLabel(id === this._store.currentId ? this._comp.getSaveableState() : envelope).qq()}</option>`)
			.join("");
		sel.value = this._store.currentId;
	}

	_switchCharacter (id, {isSkipPersist = false} = {}) {
		if (!(id in this._store.characters)) return;
		if (!isSkipPersist && id !== this._store.currentId) this._persistNow();
		this._store.currentId = id;

		const envelope = this._store.characters[id];
		this._isLoading = true;
		try {
			this._comp._setState(this._comp._getDefaultState());
		} finally {
			this._isLoading = false;
		}
		if (envelope) this._doLoadState(envelope);
		else this._doRenderAll();
		this._onStoreLoaded();
		this._persistNow();
	}

	async _onDeleteCharacter () {
		if (!await InputUiUtil.pGetUserBoolean({
			title: "Delete Character",
			htmlDescription: `<div>Delete <b>${getCharacterLabel(this._comp.getSaveableState()).qq()}</b>?<br>This cannot be undone.</div>`,
			textYes: "Delete",
			textNo: "Cancel",
		})) return;

		delete this._store.characters[this._store.currentId];
		if (!Object.keys(this._store.characters).length) this._store.characters[CryptUtil.uid()] = null;
		this._switchCharacter(Object.keys(this._store.characters)[0], {isSkipPersist: true});
	}

	/* -------------------------------------------- File / reset -------------------------------------------- */

	_onSaveToFile () {
		const name = (this._comp._state.name || "character").trim() || "character";
		DataUtil.userDownload(Parser.stringToSlug(name) || "character", this._comp.getSaveableState(), {fileType: CharacterPageBase._FILE_TYPE});
	}

	async _onLoadFromFile () {
		const {jsons, errors} = await InputUiUtil.pGetUserUploadJson({expectedFileTypes: [CharacterPageBase._FILE_TYPE]});
		DataUtil.doHandleFileLoadErrorsGeneric(errors);
		if (!jsons?.length) return;
		this._doLoadState(jsons[0]);
		this._onStoreLoaded();
		this._persistNow();
	}

	async _onReset () {
		if (!await InputUiUtil.pGetUserBoolean({
			title: "Reset Character",
			htmlDescription: `<div>This will clear the current character's sheet (other characters are kept).<br>Are you sure?</div>`,
			textYes: "Reset",
			textNo: "Cancel",
		})) return;

		this._isLoading = true;
		try {
			this._comp._setState(this._comp._getDefaultState());
		} finally {
			this._isLoading = false;
		}
		this._onStoreLoaded();
		this._doRenderAll();
		this._persistNow();
	}

	/* -------------------------------------------- Level-up prompt -------------------------------------------- */

	async _pMaybePromptLevelUp () {
		const newLevel = this._comp.getLevelNumber();
		const prevLevel = this._lastLevel;
		this._lastLevel = newLevel;

		if (this._isLoading || this._suppressLevelPrompt > 0 || newLevel <= prevLevel) return;

		const primary = this._comp._state.classes.find(c => c.hdFaces);
		if (!primary) return;
		const faces = primary.hdFaces;
		const numLevels = newLevel - prevLevel;
		const conMod = Parser.getAbilityModNumber(Number(this._comp._state.abil_con) || 10);

		const avgTotal = getLevelUpHp({faces, conMod, numLevels}).total;
		const optAvg = `Add average (+${avgTotal} HP)`;
		const ptConMod = conMod ? ` ${conMod > 0 ? "+" : "−"} ${Math.abs(conMod)} per level` : "";
		const optRoll = `Roll ${numLevels}d${faces}${ptConMod}`;
		const optSkip = "Enter manually / skip";

		const choice = await InputUiUtil.pGetUserEnum({
			values: [optAvg, optRoll, optSkip],
			isResolveItem: true,
			title: `Level up to ${newLevel}${numLevels > 1 ? ` (+${numLevels} levels)` : ""}`,
			placeholder: "How do you want to gain HP?",
		});
		if (choice == null || choice === optSkip) return;

		const gained = choice === optRoll
			? getLevelUpHp({faces, conMod, numLevels, fnRoll: f => Math.floor(Math.random() * f) + 1}).total
			: avgTotal;

		this._comp._state.hpMax = (Number(this._comp._state.hpMax) || 0) + gained;
		this._comp._state.hpCur = (Number(this._comp._state.hpCur) || 0) + gained;
		JqueryUtil.doToast({type: "success", content: `Gained ${gained} HP (now level ${newLevel}).`});
	}
}

globalThis.CharacterPageBase = CharacterPageBase;

/**
 * The spell panel appears only when the character has spells from *some* source — class, species,
 * feat, item or by hand — and collapses to its header (keeping "Add Spell") when they have none.
 */

import {BASE_URL, openPage, seedRogue, STORAGE_KEY} from "./util-e2e.mjs";

const readPanel = page => page.evaluate(() => ({
	hasPanel: !!document.getElementById("cs-spell-panel"),
	isBodyHidden: document.getElementById("cs-spell-body")?.classList.contains("ve-hidden"),
	isBrowseHidden: document.getElementById("cs-spell-browse")?.classList.contains("ve-hidden"),
	isAddVisible: !!document.getElementById("cs-spell-add")?.offsetParent,
	hasSlots: (document.getElementById("cs-spell-slots")?.textContent || "").trim().length > 0,
}));

/** Edit the stored character directly, then reload — quicker than driving the UI for each variant. */
const pReloadWith = async (page, url, fnMutate) => {
	await page.evaluate(([key, src]) => {
		const store = JSON.parse(localStorage.getItem(key));
		// eslint-disable-next-line no-new-func
		new Function("state", src)(store.characters[store.currentId].state);
		localStorage.setItem(key, JSON.stringify(store));
	}, [STORAGE_KEY, fnMutate]);
	await page.goto(url, {waitUntil: "load"});
	await page.waitForTimeout(2500);
	return readPanel(page);
};

export async function run ({browser, check}) {
	const builder = await openPage(browser);
	await seedRogue(builder);
	const state = await builder.evaluate(() => localStorage.getItem("charactersheet-characters"));

	const sheetUrl = `${BASE_URL}/charactersheet.html`;
	const page = await openPage(browser, {url: sheetUrl, state});

	// ---------- a Rogue, with no spellcasting at all ----------
	let panel = await readPanel(page);
	check("the panel collapses for a non-caster", panel.hasPanel && panel.isBodyHidden === true, JSON.stringify(panel));
	check("the class-spell browser goes with it", panel.isBrowseHidden === true);
	check("Add Spell stays reachable", panel.isAddVisible === true);

	// ---------- one spell from anywhere brings it back ----------
	panel = await pReloadWith(page, sheetUrl, `state.spellsKnown = [{id: "x", name: "Find Familiar", source: "XPHB", level: 1}];`);
	check("a spell added by hand reopens the panel", panel.isBodyHidden === false, JSON.stringify(panel));
	check("but a non-caster still gets no class-spell browser", panel.isBrowseHidden === true);

	panel = await pReloadWith(page, sheetUrl, `
		state.spellsKnown = [];
		state.inventory = [{id: "i1", name: "Wand of Magic Missiles", source: "XDMG", quantity: 1, grantsSpells: true}];
	`);
	check("a spell-carrying magic item reopens it too", panel.isBodyHidden === false, JSON.stringify(panel));

	panel = await pReloadWith(page, sheetUrl, `
		state.inventory = [];
		state.grantedSpellChoices = [{id: "g1", grantKey: "race:Elf|XPHB", name: "Prestidigitation", source: "XPHB", level: 0}];
	`);
	check("as does a species or feat grant", panel.isBodyHidden === false, JSON.stringify(panel));

	// ---------- a real caster gets the whole thing ----------
	panel = await pReloadWith(page, sheetUrl, `
		state.grantedSpellChoices = [];
		state.classes = [{id: "c1", name: "Wizard", source: "XPHB", level: 3, hdFaces: 6, subclass: null, optionalFeatures: [], asiFeatChoices: []}];
	`);
	check("a Wizard sees the full panel", panel.isBodyHidden === false && panel.isBrowseHidden === false, JSON.stringify(panel));
	check("with their spell slots", panel.hasSlots);

	// ---------- and the builder agrees ----------
	const builderPanel = await pReloadWith(page, `${BASE_URL}/charbuilder.html`, `
		state.classes = [{id: "c1", name: "Rogue", source: "XPHB", level: 4, hdFaces: 8, subclass: null, optionalFeatures: [], asiFeatChoices: []}];
		state.spellAbility = "";
	`);
	check("the builder collapses it for a non-caster too", builderPanel.isBodyHidden === true, JSON.stringify(builderPanel));

	check("no page errors", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
	await page.close();
	await builder.close();
}

/**
 * "Choose one of the following" species traits — Draconic Ancestry, Celestial Revelation and their
 * kin: offered on picking a species, locked until their level, and changeable from the panel.
 */

import {BASE_URL, getState, openPage, pickViaSearch, resolveModals, setField} from "./util-e2e.mjs";

const readTraits = page => page.evaluate(() => [...document.querySelectorAll("#cs-trait-list .cs__trait-choice")].map(r => ({
	trait: r.querySelector(".cs__lbl").textContent,
	value: r.querySelector("select").value,
	isDisabled: r.querySelector("select").disabled,
	options: [...r.querySelectorAll("select option")].map(o => o.textContent),
	note: r.querySelector(".ve-muted").textContent,
})));

export async function run ({browser, check}) {
	const page = await openPage(browser);

	// ---------- a table-shaped trait, which also settles the damage resistance ----------
	await pickViaSearch(page, {btn: "#cs-pick-species", query: "dragonborn", rowText: "Dragonborn", srcText: "PHB'24"});
	await resolveModals(page, {pick: "Silver"});

	let traits = await readTraits(page);
	const ancestry = traits.find(t => t.trait === "Draconic Ancestry");
	check("Draconic Ancestry is offered as a pick", !!ancestry, JSON.stringify(traits.map(t => t.trait)));
	check("the pick is recorded", ancestry?.value === "Silver", ancestry?.value);
	check("the chosen option's benefit is shown", /Cold/i.test(ancestry?.note || ""), ancestry?.note);
	check("every ancestry is offered", ancestry?.options.length === 11, `${ancestry?.options.length} entries (incl. the blank)`);

	let state = await getState(page);
	check("the choice carries its damage resistance", state.traitChoices?.[0]?.resist === "cold", JSON.stringify(state.traitChoices));
	check("so the separate resistance question is not asked", !/Resistances \(Dragonborn\)/.test(state.proficienciesText || ""), state.proficienciesText);

	// ---------- changing a pick without re-running the wizard ----------
	await page.selectOption("#cs-trait-list select", "Green");
	await page.waitForTimeout(600);
	state = await getState(page);
	check("a pick can be changed from the panel",
		state.traitChoices.length === 1 && state.traitChoices[0].option === "Green" && state.traitChoices[0].resist === "poison",
		JSON.stringify(state.traitChoices));

	// ---------- a later-level trait stays locked ----------
	await pickViaSearch(page, {btn: "#cs-pick-species", query: "aasimar", rowText: "Aasimar", srcText: "PHB'24"});
	await resolveModals(page);
	traits = await readTraits(page);
	const revelation = traits.find(t => t.trait === "Celestial Revelation");
	check("a later-level trait is listed but locked", revelation?.isDisabled === true && /level 3/i.test(revelation?.note || ""), JSON.stringify(revelation));

	state = await getState(page);
	check("swapping species drops the old species' picks", !state.traitChoices.some(it => it.source === "Dragonborn"), JSON.stringify(state.traitChoices));

	// ---------- ... and unlocks on reaching that level ----------
	await setField(page, "cs-level", 3);
	await resolveModals(page, {maxSteps: 4});
	traits = await readTraits(page);
	check("it unlocks at its level", traits.find(t => t.trait === "Celestial Revelation")?.isDisabled === false);

	await page.selectOption("#cs-trait-list select", {index: 1});
	await page.waitForTimeout(600);
	state = await getState(page);
	check("and can then be picked", state.traitChoices.some(it => it.trait === "Celestial Revelation" && it.option), JSON.stringify(state.traitChoices));

	// ---------- the play sheet shows the same picks ----------
	const sheet = await openPage(browser, {
		url: `${BASE_URL}/charactersheet.html`,
		state: await page.evaluate(() => localStorage.getItem("charactersheet-characters")),
	});
	const sheetTraits = await readTraits(sheet);
	check("the play sheet renders the picks", sheetTraits.some(t => t.trait === "Celestial Revelation" && t.value), JSON.stringify(sheetTraits.map(t => [t.trait, t.value])));

	check("no page errors", [...page.errors, ...sheet.errors].length === 0, [...page.errors, ...sheet.errors].slice(0, 2).join(" | "));
	await sheet.close();
	await page.close();
}

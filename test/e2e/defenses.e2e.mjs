/**
 * Resistances, immunities, vulnerabilities, condition immunities and senses: read from a species,
 * a feat and equipped gear, attributed to whatever granted them, and editable by hand.
 */

import {BASE_URL, closeModal, getState, openPage, pickViaSearch, resolveModals} from "./util-e2e.mjs";

const readGroups = page => page.evaluate(() => [...document.querySelectorAll("#cs-defense-list .cs__prof-group")].map(g => ({
	label: g.querySelector(".cs__prof-group-lbl").textContent,
	items: [...g.querySelectorAll(".cs__prof-chip")].map(c => ({
		name: c.firstChild.textContent,
		title: c.title,
		canRemove: !!c.querySelector(".cs__prof-chip-rm"),
	})),
})));

const byLabel = (groups, label) => groups.find(g => g.label === label);
const namesIn = (groups, label) => (byLabel(groups, label)?.items || []).map(it => it.name);

export async function run ({browser, check}) {
	const page = await openPage(browser);

	check("the empty state says where these come from", /species, feat or magic item/i.test(await page.textContent("#cs-defense-list")));

	// ---------- a species with a fixed resistance and a darkvision range ----------
	await pickViaSearch(page, {btn: "#cs-pick-species", query: "dwarf", rowText: "Dwarf", srcText: "PHB"});
	await resolveModals(page);

	let groups = await readGroups(page);
	check("a species' damage resistance is listed", namesIn(groups, "Resistances").includes("Poison"), JSON.stringify(namesIn(groups, "Resistances")));
	check("its darkvision is listed as a sense, with its range", namesIn(groups, "Senses").some(it => /^Darkvision \d+ ft\.$/.test(it)), JSON.stringify(namesIn(groups, "Senses")));
	check("each entry names what granted it", (byLabel(groups, "Resistances")?.items || []).every(it => /From: Dwarf/.test(it.title)), byLabel(groups, "Resistances")?.items?.[0]?.title);

	let state = await getState(page);
	check("they are stored structurally", (state.defenses || []).some(it => it.kind === "resist" && it.name === "Poison"), JSON.stringify(state.defenses));
	check("and no longer land in the notes box", !/darkvision|resistance/i.test(state.proficienciesText || ""), state.proficienciesText);

	// ---------- swapping species takes the old one's with it ----------
	await pickViaSearch(page, {btn: "#cs-pick-species", query: "tiefling", rowText: "Tiefling", srcText: "PHB"});
	await resolveModals(page);

	// The new species' own grants vary by which printing the search offers, so assert the rule rather
	// than a damage type: nothing may still be credited to the species that was replaced
	groups = await readGroups(page);
	const allChips = groups.flatMap(g => g.items);
	check("swapping species drops everything the old one granted", !allChips.some(it => /Dwarf/.test(it.title)), JSON.stringify(allChips.map(it => it.title)));
	check("and the new species grants in its place", allChips.some(it => /Tiefling/.test(it.title)), JSON.stringify(allChips.map(it => it.title)));

	// ---------- a "choose one" trait's resistance follows the pick ----------
	const dragonborn = await openPage(browser);
	await pickViaSearch(dragonborn, {btn: "#cs-pick-species", query: "dragonborn", rowText: "Dragonborn", srcText: "PHB'24"});
	await resolveModals(dragonborn);
	await dragonborn.waitForTimeout(800);

	const dbGroups = await readGroups(dragonborn);
	const dbState = await getState(dragonborn);
	const ancestry = (dbState.traitChoices || [])[0];
	check("a draconic ancestry implies its damage resistance", ancestry?.resist && namesIn(dbGroups, "Resistances").length === 1,
		`${JSON.stringify(ancestry)} → ${JSON.stringify(namesIn(dbGroups, "Resistances"))}`);
	check("credited to the ancestry that was picked", (byLabel(dbGroups, "Resistances")?.items || []).every(it => new RegExp(ancestry.option, "i").test(it.title)),
		byLabel(dbGroups, "Resistances")?.items?.[0]?.title);
	check("and it cannot be removed on its own, since the pick owns it", (byLabel(dbGroups, "Resistances")?.items || []).every(it => !it.canRemove));
	await dragonborn.close();

	// ---------- equipped gear grants while it is worn, and only then ----------
	await page.click("#cs-inv-add");
	await page.waitForTimeout(1200);
	{
		const ov = page.locator(".ve-ui-modal__overlay").last();
		const ipt = ov.locator(".ve-ui-search__ipt-search").first();
		await ipt.click();
		await ipt.pressSequentially("ring of cold resistance", {delay: 30});
		await page.waitForTimeout(1500);
		await ov.locator(".ve-ui-search__row").first().click();
		await page.waitForTimeout(1000);
		await closeModal(page);
	}

	groups = await readGroups(page);
	check("an unequipped item grants nothing", !namesIn(groups, "Resistances").includes("Cold"), JSON.stringify(namesIn(groups, "Resistances")));

	await page.evaluate(() => {
		const row = [...document.querySelectorAll("#cs-inventory tbody tr")].find(it => it.textContent.includes("Ring"));
		row.querySelector(".cs__inv-flags input[type=checkbox]").click();
	});
	await page.waitForTimeout(800);

	groups = await readGroups(page);
	const cold = (byLabel(groups, "Resistances")?.items || []).find(it => it.name === "Cold");
	check("equipping it grants its resistance", !!cold, JSON.stringify(namesIn(groups, "Resistances")));
	check("credited to the item, and flagged as depending on it", /Ring of Cold Resistance/.test(cold?.title || "") && /while that gear is equipped/.test(cold?.title || ""), cold?.title);
	check("with no remove button, since unequipping is how it goes", cold?.canRemove === false);
	check("it is not written into the character's own list", !((await getState(page)).defenses || []).some(it => it.name === "Cold"));

	await page.evaluate(() => {
		const row = [...document.querySelectorAll("#cs-inventory tbody tr")].find(it => it.textContent.includes("Ring"));
		row.querySelector(".cs__inv-flags input[type=checkbox]").click();
	});
	await page.waitForTimeout(800);
	check("taking it off takes the resistance away again", !namesIn(await readGroups(page), "Resistances").includes("Cold"));

	// ---------- by hand ----------
	await page.click("#cs-defense-add");
	await page.waitForTimeout(700);
	{
		const ov = page.locator(".ve-ui-modal__overlay").last();
		await ov.locator("select").selectOption({label: "Condition Immunities"});
		await ov.locator("button:has-text('OK')").last().click();
		await page.waitForTimeout(500);
		const ov2 = page.locator(".ve-ui-modal__overlay").last();
		await ov2.locator("input").first().fill("Frightened");
		await ov2.locator("button:has-text('OK')").last().click();
	}
	await page.waitForTimeout(700);

	groups = await readGroups(page);
	const manual = (byLabel(groups, "Condition Immunities")?.items || []).find(it => it.name === "Frightened");
	check("one can be added by hand", !!manual, JSON.stringify(groups.map(g => g.label)));
	check("and says it was", /Added by hand/.test(manual?.title || ""), manual?.title);

	await page.evaluate(() => {
		const chip = [...document.querySelectorAll("#cs-defense-list .cs__prof-chip")].find(c => c.textContent.includes("Frightened"));
		chip.querySelector(".cs__prof-chip-rm").click();
	});
	await page.waitForTimeout(700);
	check("and removed again", !namesIn(await readGroups(page), "Condition Immunities").includes("Frightened"));

	// ---------- the play sheet shows the same list ----------
	const sheet = await openPage(browser, {
		url: `${BASE_URL}/charactersheet.html`,
		state: await page.evaluate(() => localStorage.getItem("charactersheet-characters")),
	});
	const sheetGroups = await readGroups(sheet);
	check("the play sheet renders the same list", JSON.stringify(sheetGroups) === JSON.stringify(await readGroups(page)), JSON.stringify(sheetGroups));

	check("no page errors", [...page.errors, ...sheet.errors].length === 0, [...page.errors, ...sheet.errors].slice(0, 2).join(" | "));
	await sheet.close();
	await page.close();
}

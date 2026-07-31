/**
 * Reference cards: the character's own spells and attacks, built on demand and printed on their
 * own. The deck exists only on paper, so this drives the button and reads what it produced.
 */

import {BASE_URL, openPage, pickClass, resolveModals, setField} from "./util-e2e.mjs";

const SHEET_URL = `${BASE_URL}/charactersheet.html`;

const readCards = page => page.evaluate(() => ({
	owner: document.querySelector("#cs-cards .cs__cards-owner")?.textContent.trim() || null,
	isPrintingClass: document.body.classList.contains("cs__printing-cards"),
	cards: [...document.querySelectorAll("#cs-cards .cs__card")].map(card => ({
		name: card.querySelector(".cs__card-name")?.textContent.trim(),
		sub: card.querySelector(".cs__card-sub")?.textContent.replace(/\s+/g, " ").trim(),
		meta: [...card.querySelectorAll(".cs__card-meta div")].map(it => it.textContent.replace(/\s+/g, " ").trim()),
		body: card.querySelector(".cs__card-body")?.textContent.replace(/\s+/g, " ").trim() || "",
	})),
}));

const cardFor = (deck, name) => deck.cards.find(it => it.name === name);

/** A real print dialog would block the run, so count the calls instead of opening one. */
const stubPrint = page => page.evaluate(() => {
	window.__printed = 0;
	window.print = () => { window.__printed++; };
});

async function addSpell (page, query) {
	await page.click("#cs-spell-add");
	await page.waitForTimeout(1500);
	const ov = page.locator(".ve-ui-modal__overlay").last();
	const ipt = ov.locator(".ve-ui-search__ipt-search").first();
	await ipt.click();
	await ipt.pressSequentially(query, {delay: 30});
	await page.waitForTimeout(1500);
	await ov.locator(".ve-ui-search__row").first().click();
	await page.waitForTimeout(1200);
}

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: SHEET_URL});
	await stubPrint(page);

	// A Wizard with a save spell, an attack cantrip and a concentration spell
	await setField(page, "cs-name", "Card Test");
	await pickClass(page, "Wizard (PHB'24)");
	await resolveModals(page);
	await setField(page, "cs-level", 5);
	await resolveModals(page, {maxSteps: 6});
	await page.waitForTimeout(1500);

	// ---------- nothing to print yet ----------
	await page.click("#cs-btn-cards");
	await page.waitForTimeout(1200);
	check("with no spells or attacks, it says so rather than printing a blank page",
		(await readCards(page)).cards.length === 0 && await page.evaluate(() => !window.__printed));

	// ---------- a deck ----------
	for (const q of ["fireball", "fire bolt", "fog cloud"]) await addSpell(page, q);
	await page.click("#cs-attack-add");
	await page.waitForTimeout(600);
	await page.evaluate(() => {
		const row = document.querySelector("#cs-attacks-body tr");
		const [name, atk, dmg] = row.querySelectorAll("input");
		name.value = "Quarterstaff";
		name.dispatchEvent(new Event("input", {bubbles: true}));
		atk.value = "5";
		atk.dispatchEvent(new Event("input", {bubbles: true}));
		dmg.value = "1d6+2 bludgeoning";
		dmg.dispatchEvent(new Event("input", {bubbles: true}));
	});
	await page.waitForTimeout(800);

	await page.click("#cs-btn-cards");
	await page.waitForTimeout(3000);

	const deck = await readCards(page);
	check("pressing Cards builds a deck", deck.cards.length >= 4, JSON.stringify(deck.cards.map(it => it.name)));
	check("and prints it", await page.evaluate(() => window.__printed > 0));
	check("headed with whose deck it is", deck.owner === "Card Test", deck.owner);

	// ---------- what a card carries ----------
	const fireball = cardFor(deck, "Fireball");
	check("a spell card names the spell and its level and school", fireball?.sub?.startsWith("3rd-level evocation"), JSON.stringify(fireball?.sub));
	check("with the four things you look up mid-turn", ["Cast", "Range", "Components", "Duration"]
		.every(lbl => fireball.meta.some(it => it.startsWith(lbl))), JSON.stringify(fireball?.meta));
	check("and the character's own save DC, not a formula", fireball.meta.some(it => /^Save DEX DC \d+/.test(it)), JSON.stringify(fireball.meta));
	check("the spell's actual text is on the card", /bright streak/i.test(fireball.body), fireball.body.slice(0, 80));
	check("including what it does at higher levels", /At higher levels\./.test(fireball.body) && /increases by 1d6/i.test(fireball.body), fireball.body.slice(-120));
	check("with no unresolved data tags", !/\{@/.test(fireball.body), fireball.body.slice(0, 120));

	const firebolt = cardFor(deck, "Fire Bolt");
	check("an attack spell carries the attack bonus instead", firebolt.meta.some(it => /^Attack [+−]\d+ to hit/.test(it)), JSON.stringify(firebolt.meta));

	const fog = cardFor(deck, "Fog Cloud");
	check("a concentration spell is flagged as one", /Concentration/.test(fog?.sub || ""), fog?.sub);

	const staff = cardFor(deck, "Quarterstaff");
	check("an attack gets a card too", !!staff, JSON.stringify(deck.cards.map(it => it.name)));
	check("with its to-hit and damage", staff.meta.some(it => /To hit \+5/.test(it)) && staff.meta.some(it => /1d6\+2 bludgeoning/.test(it)), JSON.stringify(staff.meta));

	// ---------- order, and getting the page back ----------
	const spellNames = deck.cards.map(it => it.name);
	check("cantrips come before levelled spells, attacks last",
		spellNames.indexOf("Fire Bolt") < spellNames.indexOf("Fireball") && spellNames.indexOf("Quarterstaff") === spellNames.length - 1,
		JSON.stringify(spellNames));

	check("the sheet is not left in printing mode", (await readCards(page)).isPrintingClass === false);
	check("and the cards stay invisible on screen", await page.evaluate(() => {
		const wrp = document.getElementById("cs-cards");
		return wrp.getBoundingClientRect().height === 0;
	}));

	check("no page errors", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
	await page.close();
}

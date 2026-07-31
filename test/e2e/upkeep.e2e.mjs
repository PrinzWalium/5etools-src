/**
 * The two things a sheet has to remember between fights: what a wand and a quiver have left, and an
 * ability increase that was offered and never assigned.
 */

import {BASE_URL, closeModal, getState, openPage, resolveModals} from "./util-e2e.mjs";

/** Add an item through the real search, since that is what puts its data on the row. */
async function addItem (page, query) {
	await page.click("#cs-inv-add");
	await page.waitForTimeout(1200);
	const ov = page.locator(".ve-ui-modal__overlay").last();
	const ipt = ov.locator(".ve-ui-search__ipt-search").first();
	await ipt.click();
	await ipt.pressSequentially(query, {delay: 30});
	await page.waitForTimeout(1500);
	await ov.locator(".ve-ui-search__row").first().click();
	await page.waitForTimeout(1000);
	await closeModal(page);
}

const readRow = (page, name) => page.evaluate(nm => {
	const row = [...document.querySelectorAll("#cs-inventory tbody tr")].find(it => it.textContent.includes(nm));
	if (!row) return null;
	return {
		charges: row.querySelector(".cs__inv-charges-val")?.textContent || null,
		chargesTitle: row.querySelector(".cs__inv-charges")?.title || null,
		qty: row.querySelector(".cs__inv-qty")?.value,
		hasFire: !!row.querySelector(".cs__inv-fire"),
		recover: row.querySelector(".cs__inv-recover")?.textContent || null,
	};
}, name);

const clickIn = (page, name, sel) => page.evaluate(({nm, sel}) => {
	const row = [...document.querySelectorAll("#cs-inventory tbody tr")].find(it => it.textContent.includes(nm));
	row.querySelector(sel).click();
}, {nm: name, sel});

export async function run ({browser, check}) {
	// The rest buttons live on the play sheet, which is where charges are spent anyway
	const page = await openPage(browser, {url: `${BASE_URL}/charactersheet.html`});

	// ---------- a wand's charges ----------
	await addItem(page, "wand of magic missiles");
	let row = await readRow(page, "Wand of Magic Missiles");
	check("an item with charges shows how many it has", row?.charges === "7/7", JSON.stringify(row));
	check("and says how it gets them back", /long rest/.test(row?.chargesTitle || "") && /dawn/.test(row?.chargesTitle || ""), row?.chargesTitle);

	await clickIn(page, "Wand of Magic Missiles", ".cs__inv-charges button");
	await page.waitForTimeout(400);
	await clickIn(page, "Wand of Magic Missiles", ".cs__inv-charges button");
	await page.waitForTimeout(400);
	row = await readRow(page, "Wand of Magic Missiles");
	check("spending charges counts them down", row?.charges === "5/7", JSON.stringify(row));
	check("and is stored on the item", (await getState(page)).inventory.find(it => it.name === "Wand of Magic Missiles")?.chargesUsed === 2);

	// A short rest does nothing for an item that recharges at dawn
	await page.click("#cs-short-rest");
	await page.waitForTimeout(500);
	check("a short rest does not recharge a dawn item", (await readRow(page, "Wand of Magic Missiles"))?.charges === "5/7");

	await page.click("#cs-long-rest");
	await page.waitForTimeout(600);
	row = await readRow(page, "Wand of Magic Missiles");
	const [left, max] = (row?.charges || "").split("/").map(Number);
	// It regains 1d6 + 1, so between 2 and 7 of the 2 spent come back — capped at full
	check("a long rest gives back what the item says", left > 5 && left <= max, row?.charges);

	check("charges never go above full", await page.evaluate(() => {
		const st = JSON.parse(localStorage.getItem("charactersheet-characters"));
		const char = Object.values(st.characters)[0];
		return (char.state.inventory || []).every(it => !it.chargesMax || (it.chargesUsed ?? 0) >= 0);
	}));

	// ---------- ammunition ----------
	await addItem(page, "arrows");
	// Whether the search hands back a single arrow or a bundle, a quiver is what gets shot at
	await page.evaluate(() => {
		const row = [...document.querySelectorAll("#cs-inventory tbody tr")].find(it => it.textContent.includes("Arrow"));
		const ipt = row.querySelector(".cs__inv-qty");
		ipt.value = "20";
		ipt.dispatchEvent(new Event("change", {bubbles: true}));
	});
	await page.waitForTimeout(500);

	row = await readRow(page, "Arrow");
	check("ammunition offers a Fire button", row?.hasFire === true, JSON.stringify(row));
	const qtyBefore = Number(row.qty);

	for (let i = 0; i < 5; ++i) {
		await clickIn(page, "Arrow", ".cs__inv-fire");
		await page.waitForTimeout(250);
	}
	row = await readRow(page, "Arrow");
	check("firing takes them off the pile", Number(row.qty) === qtyBefore - 5, `${row.qty} vs ${qtyBefore}`);
	check("and offers to recover half of what was spent", /Recover 2/.test(row?.recover || ""), row?.recover);

	await clickIn(page, "Arrow", ".cs__inv-recover");
	await page.waitForTimeout(500);
	row = await readRow(page, "Arrow");
	check("searching the battlefield gets half back, rounded down", Number(row.qty) === qtyBefore - 3, `${row.qty} vs ${qtyBefore}`);
	check("and there is nothing left to recover", row?.recover === null, row?.recover);

	// ---------- an ability increase that was skipped ----------
	const skipped = await openPage(browser);
	await skipped.click("#cs-pick-background");
	await skipped.waitForTimeout(1500);
	{
		const ov = skipped.locator(".ve-ui-modal__overlay").last();
		const ipt = ov.locator(".ve-ui-search__ipt-search").first();
		await ipt.click();
		await ipt.pressSequentially("soldier", {delay: 30});
		await skipped.waitForTimeout(1500);
		await ov.locator(".ve-ui-search__row").first().click();
		await skipped.waitForTimeout(1200);
	}
	// `resolveModals` clicks Skip when a modal offers it — which is exactly the decline under test
	await resolveModals(skipped, {maxSteps: 12});
	await skipped.waitForTimeout(800);

	let offers = await skipped.evaluate(() => [...document.querySelectorAll("#cs-ability-offers .cs__offer")].map(it => it.textContent.replace(/\s+/g, " ").trim()));
	const state = await getState(skipped);
	check("skipping an ability increase leaves something to come back to", (state.pendingAbilityOffers || []).length === 1, JSON.stringify(state.pendingAbilityOffers));
	check("shown on the sheet, saying what is owed and by whom", /not yet assigned/.test(offers[0] || "") && /grants/.test(offers[0] || ""), offers[0]);
	check("and no longer written into the notes box", !/assign manually/.test(state.proficienciesText || ""), state.proficienciesText);

	check("with a button to assign it now", await skipped.locator("#cs-ability-offers button:has-text('Assign now')").count() === 1);

	// Dismissing is the other way to settle it
	await skipped.click("#cs-ability-offers button:has-text('Dismiss')");
	await skipped.waitForTimeout(600);
	offers = await skipped.evaluate(() => [...document.querySelectorAll("#cs-ability-offers .cs__offer")].length);
	check("dismissing it clears the reminder for good", offers === 0);
	check("and it stays gone in the character", ((await getState(skipped)).pendingAbilityOffers || []).length === 0);

	// ---------- an old character's note becomes the same reminder ----------
	const legacy = await openPage(browser, {
		state: JSON.stringify({
			storeVersion: 1,
			currentId: "legacy",
			characters: {
				legacy: {
					version: 2,
					state: {
						name: "Legacy",
						proficienciesText: "Languages: Dwarvish\nAbility Scores (Soldier): +2 Str, +1 Con — assign manually",
					},
				},
			},
		}),
	});
	await legacy.waitForTimeout(800);

	// Read the page rather than the saved copy: migration happens on load, and the store is only
	// rewritten on the next save
	const legacyNotes = await legacy.locator("#cs-proficiencies").inputValue();
	const legacyOffers = await legacy.evaluate(() => [...document.querySelectorAll("#cs-ability-offers .cs__offer")].map(it => it.textContent.replace(/\s+/g, " ").trim()));
	check("an old character's stale note becomes a live reminder", legacyOffers.length === 1 && /Soldier/.test(legacyOffers[0]), JSON.stringify(legacyOffers));
	check("the note itself is gone from the box", !/assign manually/.test(legacyNotes), legacyNotes);
	check("and the rest of the box is untouched", /Dwarvish/.test(legacyNotes), legacyNotes);
	check("with no Assign button, since the offer's details are lost", await legacy.locator("#cs-ability-offers button:has-text('Assign now')").count() === 0);

	check("no page errors", [...page.errors, ...skipped.errors, ...legacy.errors].length === 0, [...page.errors, ...skipped.errors, ...legacy.errors].slice(0, 2).join(" | "));
	await legacy.close();
	await skipped.close();
	await page.close();
}

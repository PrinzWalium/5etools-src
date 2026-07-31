/**
 * The Actions panel as a turn helper: it lists what the character can do *now*, greying out and
 * explaining whatever the live state has taken away — spent slots, an empty wand, an empty quiver,
 * a running concentration, a condition that stops you acting at all.
 */

import {BASE_URL, closeModal, getState, openPage, pickClass, resolveModals, setField} from "./util-e2e.mjs";

const SHEET_URL = `${BASE_URL}/charactersheet.html`;

const readActions = page => page.evaluate(() => ({
	notes: [...document.querySelectorAll("#cs-actions .cs__turn-notes div")].map(it => it.textContent.trim()),
	isStopped: !!document.querySelector("#cs-actions .cs__turn-notes--stop"),
	rows: [...document.querySelectorAll("#cs-actions .cs__act-row")].map(row => ({
		text: row.textContent.replace(/\s+/g, " ").trim(),
		blocked: row.classList.contains("cs__act-row--blocked"),
		warn: row.classList.contains("cs__act-row--warn"),
		reason: row.querySelector(".cs__act-reason")?.textContent || null,
	})),
}));

const rowFor = (actions, name) => actions.rows.find(it => it.text.startsWith(name));

/** Add an item through the real search, so its own data lands on the row. */
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

const equipByName = (page, name) => page.evaluate(nm => {
	const row = [...document.querySelectorAll("#cs-inventory tbody tr")].find(it => it.textContent.includes(nm));
	row.querySelector(".cs__inv-flags input[type=checkbox]").click();
}, name);

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: SHEET_URL});

	// A 3rd-level Wizard: cantrips, levelled spells, and slots to spend
	await pickClass(page, "Wizard (PHB'24)");
	await resolveModals(page);
	await setField(page, "cs-level", 3);
	await resolveModals(page, {maxSteps: 6});
	await page.waitForTimeout(1500);

	// ---------- an ordinary turn ----------
	let actions = await readActions(page);
	check("the unarmed strike is always something you can do", !!rowFor(actions, "Unarmed Strike"), JSON.stringify(actions.rows.map(it => it.text)));
	check("and nothing is flagged on a healthy turn", actions.rows.every(it => !it.blocked && !it.warn), JSON.stringify(actions.rows.filter(it => it.blocked)));
	check("with no notes about the turn as a whole", actions.notes.length === 0, JSON.stringify(actions.notes));

	// ---------- spells, and running out of slots ----------
	await page.click("#cs-spell-add");
	await page.waitForTimeout(1500);
	{
		const ov = page.locator(".ve-ui-modal__overlay").last();
		const ipt = ov.locator(".ve-ui-search__ipt-search").first();
		await ipt.click();
		await ipt.pressSequentially("magic missile", {delay: 30});
		await page.waitForTimeout(1500);
		await ov.locator(".ve-ui-search__row").first().click();
		await page.waitForTimeout(1200);
	}

	actions = await readActions(page);
	check("a known spell appears as an action", !!rowFor(actions, "Magic Missile"), JSON.stringify(actions.rows.map(it => it.text)));
	check("and is available while slots remain", rowFor(actions, "Magic Missile")?.blocked === false);

	// Spend every slot the character has
	await page.evaluate(() => {
		document.querySelectorAll("#cs-spell-slots input[type=checkbox]").forEach(cb => { if (!cb.checked) cb.click(); });
	});
	await page.waitForTimeout(1200);

	actions = await readActions(page);
	const mm = rowFor(actions, "Magic Missile");
	check("spending every slot blocks the spell", mm?.blocked === true, JSON.stringify(mm));
	check("and says which slots are missing", /No level 1\+ slots left/.test(mm?.reason || ""), mm?.reason);

	const slotsUsed = (await getState(page)).slotsUsed || {};
	check("the slots really were spent", Object.values(slotsUsed).some(it => it > 0), JSON.stringify(slotsUsed));

	// A cantrip needs no slot, so it stays available
	const cantrip = actions.rows.find(it => /Cantrip/.test(it.text));
	if (cantrip) check("a cantrip is unaffected", cantrip.blocked === false, JSON.stringify(cantrip));

	// ---------- concentration ----------
	await page.evaluate(() => {
		document.querySelectorAll("#cs-spell-slots input[type=checkbox]").forEach(cb => { if (cb.checked) cb.click(); });
	});
	await page.waitForTimeout(800);

	await page.click("#cs-spell-add");
	await page.waitForTimeout(1500);
	{
		const ov = page.locator(".ve-ui-modal__overlay").last();
		const ipt = ov.locator(".ve-ui-search__ipt-search").first();
		await ipt.click();
		await ipt.pressSequentially("fog cloud", {delay: 30});
		await page.waitForTimeout(1500);
		await ov.locator(".ve-ui-search__row").first().click();
		await page.waitForTimeout(1200);
	}

	await setField(page, "cs-concentration", "Hex");
	await page.waitForTimeout(1200);

	actions = await readActions(page);
	const conc = actions.rows.find(it => it.warn);
	check("a concentration spell warns that it would drop the current one", !!conc && /Would drop Hex/.test(conc.reason || ""), JSON.stringify(actions.rows.filter(it => it.warn)));
	check("but is not blocked — it is a choice, not an impossibility", conc?.blocked === false);

	await setField(page, "cs-concentration", "");
	await page.waitForTimeout(800);
	check("dropping the concentration clears the warning", (await readActions(page)).rows.every(it => !it.warn));

	// ---------- an item with charges ----------
	await addItem(page, "wand of magic missiles");
	await equipByName(page, "Wand of Magic Missiles");
	await page.waitForTimeout(1200);

	actions = await readActions(page);
	const wand = rowFor(actions, "Wand of Magic Missiles");
	check("an equipped wand is listed as something you can do", !!wand, JSON.stringify(actions.rows.map(it => it.text)));
	check("with its charges shown", /7\/7 charges/.test(wand?.text || ""), wand?.text);

	// Spend all seven
	for (let i = 0; i < 7; ++i) {
		await page.evaluate(() => {
			const row = [...document.querySelectorAll("#cs-inventory tbody tr")].find(it => it.textContent.includes("Wand of Magic Missiles"));
			row.querySelector(".cs__inv-charges button").click();
		});
		await page.waitForTimeout(200);
	}
	await page.waitForTimeout(1000);

	actions = await readActions(page);
	check("an empty wand is blocked, and says so", rowFor(actions, "Wand of Magic Missiles")?.blocked === true
		&& /No charges left/.test(rowFor(actions, "Wand of Magic Missiles")?.reason || ""), JSON.stringify(rowFor(actions, "Wand of Magic Missiles")));

	// ---------- an empty quiver ----------
	await addItem(page, "longbow");
	await page.waitForTimeout(600);
	await page.evaluate(() => {
		const row = [...document.querySelectorAll("#cs-inventory tbody tr")].find(it => it.textContent.includes("Longbow"));
		row.querySelector(".cs__inv-wield").click();
	});
	await page.waitForTimeout(1200);

	actions = await readActions(page);
	const bow = rowFor(actions, "Longbow");
	check("a bow with no arrows is blocked", bow?.blocked === true, JSON.stringify(bow));
	check("and says what is missing", /arrow/i.test(bow?.reason || ""), bow?.reason);

	await addItem(page, "arrows");
	await page.evaluate(() => {
		const row = [...document.querySelectorAll("#cs-inventory tbody tr")].find(it => it.textContent.includes("Arrow"));
		const ipt = row.querySelector(".cs__inv-qty");
		ipt.value = "20";
		ipt.dispatchEvent(new Event("change", {bubbles: true}));
	});
	await page.waitForTimeout(1200);
	check("buying arrows unblocks it", rowFor(await readActions(page), "Longbow")?.blocked === false);

	// ---------- the whole turn ----------
	await setField(page, "cs-exhaustion", 2);
	await page.waitForTimeout(900);
	actions = await readActions(page);
	check("exhaustion is stated once for the whole turn", actions.notes.some(it => /Exhaustion 2/.test(it) && /−4/.test(it)), JSON.stringify(actions.notes));
	check("without blocking anything", actions.rows.some(it => !it.blocked));

	await setField(page, "cs-exhaustion", 0);
	await page.evaluate(() => {
		const btn = [...document.querySelectorAll("#cs-conditions .cs__cond")].find(it => it.textContent === "Stunned");
		btn.click();
	});
	await page.waitForTimeout(1200);

	actions = await readActions(page);
	check("being stunned stops the turn outright", actions.isStopped === true && actions.notes.some(it => /Stunned/.test(it)), JSON.stringify(actions.notes));
	check("and every entry is blocked with that reason", actions.rows.length > 0 && actions.rows.every(it => it.blocked && it.reason === "Stunned"),
		JSON.stringify(actions.rows.filter(it => !it.blocked).slice(0, 3)));

	await page.evaluate(() => {
		const btn = [...document.querySelectorAll("#cs-conditions .cs__cond")].find(it => it.textContent === "Stunned");
		btn.click();
	});
	await page.waitForTimeout(1000);
	check("and it all comes back when the condition ends", (await readActions(page)).isStopped === false);

	check("no page errors", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
	await page.close();
}

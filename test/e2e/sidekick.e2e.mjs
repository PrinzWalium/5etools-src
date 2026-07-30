/**
 * The Sidekick Builder: a stat block seeds the sheet, a sidekick class drives the features and the
 * level table, and every seeded value stays editable — it is a DM's tool, not a locked character.
 */

import {BASE_URL, getState, openPage, resolveModals, setField} from "./util-e2e.mjs";

const SIDEKICK_URL = `${BASE_URL}/sidekick.html`;

/** The creature picker is the bestiary search modal. */
async function pickCreature (page, {query, rowText, srcText = null}) {
	await page.click("#cs-pick-creature");
	await page.waitForTimeout(1500);
	const ov = page.locator(".ve-ui-modal__overlay").last();
	const ipt = ov.locator(".ve-ui-search__ipt-search").first();
	await ipt.click();
	await ipt.pressSequentially(query, {delay: 40});
	await page.waitForTimeout(1500);

	const ix = await ov.evaluate((_e, {rowText, srcText}) => {
		const rows = [...document.querySelectorAll(".ve-ui-modal__overlay:last-of-type .ve-ui-search__row")];
		return rows.findIndex(r => {
			const spans = r.querySelectorAll("span");
			return (spans[0]?.textContent || "").trim() === rowText && (!srcText || (spans[1]?.textContent || "").includes(srcText));
		});
	}, {rowText, srcText});
	if (ix < 0) throw new Error(`No creature "${rowText}" for query "${query}"`);

	await ov.locator(".ve-ui-search__row").nth(ix).click();
	await page.waitForTimeout(1200);
}

const readLevelTable = page => page.evaluate(() => ({
	nRows: document.querySelectorAll("#cs-sk-level-table tbody tr").length,
	now: document.querySelector("#cs-sk-level-table .cs__sk-row--now")?.textContent.replace(/\s+/g, " ").trim(),
	nFuture: document.querySelectorAll("#cs-sk-level-table .cs__sk-row--future").length,
	intro: document.querySelector("#cs-sk-level-table .ve-muted")?.textContent || "",
}));

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: SIDEKICK_URL});

	check("the three sidekick classes are offered", (await page.evaluate(() => [...document.querySelectorAll("#cs-sk-class option")].map(o => o.textContent)))
		.join("|") === "—|Expert Sidekick|Spellcaster Sidekick|Warrior Sidekick");
	check("the level table waits for a class", /Choose a sidekick class/.test(await page.textContent("#cs-sk-level-table")));

	// ---------- a stat block seeds the sheet ----------
	await pickCreature(page, {query: "guard", rowText: "Guard", srcText: "MM"});
	await resolveModals(page, {maxSteps: 4});

	let state = await getState(page);
	check("the creature is recorded as the base", state.refCreature?.name === "Guard", JSON.stringify(state.refCreature));
	check("it is marked as a sidekick", state.isSidekick === true);
	check("its ability scores are seeded", state.abil_str === 13 && state.abil_dex === 12 && state.abil_con === 12, `str=${state.abil_str} dex=${state.abil_dex}`);
	check("its Armor Class is seeded", Number(await page.locator("#cs-ac").inputValue()) === 16);
	check("its hit points are seeded", Number(await page.locator("#cs-hp-max").inputValue()) === 11);
	check("its speed is seeded", (await page.locator("#cs-speed").inputValue()) === "30 ft.");
	check("its skill proficiency is seeded", Number(state.skill_perception) >= 1, `perception=${state.skill_perception}`);
	check("its senses land in the notes", /passive Perception 12/.test(state.proficienciesText || ""), state.proficienciesText);
	check("its actions land in Traits & Actions", /Spear/.test(state.featuresText || ""), (state.featuresText || "").slice(0, 80));
	check("the subtitle links the stat block", /Guard/.test(await page.textContent("#cs-sk-subtitle")));

	// ---------- a sidekick class drives the features and the table ----------
	await page.selectOption("#cs-sk-class", {label: "Warrior Sidekick"});
	// The panel loads the class data before it can render, so wait for the features rather than a clock
	await page.waitForFunction(() => /Martial Role/.test(document.getElementById("cs-class-panel")?.textContent || ""), {timeout: 20000}).catch(() => {});
	await page.waitForTimeout(600);

	state = await getState(page);
	check("the class is stored", state.classes?.[0]?.name === "Warrior Sidekick", JSON.stringify(state.classes?.[0]));
	check("the hit die comes from the stat block, not the class", state.classes?.[0]?.hdFaces === 8, `hdFaces=${state.classes?.[0]?.hdFaces}`);

	let table = await readLevelTable(page);
	check("the level table lists all twenty levels", table.nRows === 20, `${table.nRows} rows`);
	check("it marks the current level", /^1 \+2/.test(table.now || ""), table.now);
	check("it explains how a sidekick levels", /Hit Die/.test(table.intro) && /proficiency bonus/.test(table.intro), table.intro.slice(0, 90));
	check("and dims the levels not yet reached", table.nFuture === 19, `${table.nFuture} future rows`);

	// Only features up to the current level are shown, so at level 1 that is the level-1 set
	const panelTxt = await page.textContent("#cs-class-panel");
	check("the class's level-1 features render as cards", /Martial Role/.test(panelTxt) && /Bonus Proficiencies/.test(panelTxt), panelTxt.replace(/\s+/g, " ").slice(0, 140));
	check("and later features are not shown yet", !/Second Wind/.test(panelTxt));

	// ---------- levelling moves the marker and the features ----------
	await setField(page, "cs-level", 6);
	await resolveModals(page, {maxSteps: 4});
	await page.waitForTimeout(1200);

	table = await readLevelTable(page);
	check("raising the level moves the marker", /^6 \+3/.test(table.now || ""), table.now);
	const panelTxt6 = await page.textContent("#cs-class-panel");
	check("and the features catch up", /Extra Attack/.test(panelTxt6) && /Second Wind/.test(panelTxt6));

	// ---------- everything stays editable ----------
	await setField(page, "cs-ac", 18);
	await setField(page, "cs-hp-max", 44);
	await page.fill("#cs-features", "Rebuilt as an automaton: immune to poison.");
	await page.dispatchEvent("#cs-features", "change");
	await page.waitForTimeout(500);

	state = await getState(page);
	check("a seeded value can be overwritten", state.ac === 18 && state.hpMax === 44, `ac=${state.ac} hp=${state.hpMax}`);
	check("so can the traits text", /automaton/i.test(state.featuresText));

	const hint = await page.textContent("#cs-sk-hp-hint");
	check("the sheet hints at hit points per level", /HP per level/.test(hint), hint);

	// ---------- the full rules are one click away ----------
	await page.click("#cs-sk-rules-toggle");
	await page.waitForTimeout(1500);
	const rules = await page.textContent("#cs-sk-rules");
	check("the book's sidekick rules can be shown", /average level of the group/i.test(rules), rules.replace(/\s+/g, " ").slice(0, 90));

	// ---------- sidekicks and characters stay in their own lists ----------
	const charPage = await openPage(browser, {url: `${BASE_URL}/charactersheet.html`, state: await page.evaluate(() => localStorage.getItem("charactersheet-characters"))});
	const charOptions = await charPage.evaluate(() => [...document.querySelectorAll("#cs-char-select option")].map(o => o.textContent));
	check("the character sheet does not list the sidekick", !charOptions.some(it => /Guard|Warrior Sidekick/.test(it)), JSON.stringify(charOptions));
	await charPage.close();

	check("no page errors", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
	await page.close();
}

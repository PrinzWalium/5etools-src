/**
 * The Sidekick Builder. Two paths, both read from the data: the Essentials Kit's three sidekicks
 * (type + role, with a fixed table for levels 2–6), and any bestiary stat block plus a Tasha's
 * sidekick class. Every seeded value stays editable — it is a DM's tool, not a locked character.
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
	next: document.querySelector("#cs-sk-level-next")?.textContent.replace(/\s+/g, " ").trim() || "",
}));

const readTraits = page => page.evaluate(() => [...document.querySelectorAll("#cs-sk-traits .cs__sk-trait")].map(row => ({
	section: row.querySelector(".cs__sk-trait-section")?.value,
	name: row.querySelector(".cs__sk-trait-name")?.value,
	text: row.querySelector(".cs__sk-trait-text")?.value,
})));

/** Pick a type and wait for its stat block to land, rather than for a clock. */
async function pickType (page, label) {
	await page.selectOption("#cs-sk-type", {label});
	await page.waitForFunction(() => document.querySelectorAll("#cs-sk-traits .cs__sk-trait").length > 0, {timeout: 20000}).catch(() => {});
	await page.waitForTimeout(500);
}

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: SIDEKICK_URL});

	check("the three Essentials Kit sidekicks are offered", (await page.evaluate(() => [...document.querySelectorAll("#cs-sk-type option")].map(o => o.textContent)))
		.join("|") === "— none —|Expert|Spellcaster|Warrior", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("#cs-sk-type option")].map(o => o.textContent))));
	check("the level table waits for a choice", /Pick a sidekick type/.test(await page.textContent("#cs-sk-level-table")));
	check("no specialisation is offered before a type is picked", await page.locator("#cs-sk-role-field.ve-hidden").count() === 1);

	// ---------- a type seeds the whole sheet ----------
	await pickType(page, "Warrior");

	let state = await getState(page);
	check("the type is recorded", state.sidekickType === "warrior", JSON.stringify(state.sidekickType));
	check("it is marked as a sidekick", state.isSidekick === true);
	check("the stat block behind it is recorded", state.refCreature?.name === "Warrior", JSON.stringify(state.refCreature));
	check("its ability scores are seeded", state.abil_str === 15 && state.abil_con === 14, `str=${state.abil_str} con=${state.abil_con}`);
	check("its Armor Class is seeded", Number(await page.locator("#cs-ac").inputValue()) === 16, await page.locator("#cs-ac").inputValue());
	check("its hit points are seeded", Number(await page.locator("#cs-hp-max").inputValue()) === 13, await page.locator("#cs-hp-max").inputValue());
	check("its skill proficiency is seeded", Number(state.skill_athletics) >= 1, `athletics=${state.skill_athletics}`);
	check("the subtitle says what it is", /Warrior/.test(await page.textContent("#cs-sk-subtitle")));

	// ---------- the specialisation, read from the stat block ----------
	check("the Warrior's specialisation is offered", await page.locator("#cs-sk-role-field.ve-hidden").count() === 0);
	check("it is named as the book names it", /Martial Role/.test(await page.textContent("#cs-sk-role-lbl")), await page.textContent("#cs-sk-role-lbl"));
	const roleOptions = await page.evaluate(() => [...document.querySelectorAll("#cs-sk-role option")].map(o => o.textContent));
	check("both martial roles are listed", roleOptions.join("|") === "— choose —|Attacker|Defender", JSON.stringify(roleOptions));
	check("the hint explains what each does", /\+2 bonus to attack rolls/.test(await page.textContent("#cs-sk-role-hint")), (await page.textContent("#cs-sk-role-hint")).slice(0, 80));

	// ---------- the stat block's traits and actions, one row each ----------
	let traits = await readTraits(page);
	check("the stat block's entries land as separate rows", traits.length >= 3, JSON.stringify(traits.map(it => it.name)));
	check("each row knows what kind of entry it is", traits.some(it => it.section === "Action" && it.name === "Longsword"), JSON.stringify(traits.map(it => `${it.section}:${it.name}`)));
	check("and carries its text", /Melee Weapon Attack/.test(traits.find(it => it.name === "Longsword")?.text || ""), traits.find(it => it.name === "Longsword")?.text);

	// ---------- picking a role changes which entries apply ----------
	await page.selectOption("#cs-sk-role", {label: "Defender"});
	await page.waitForTimeout(800);
	traits = await readTraits(page);
	check("a Defender gains the Protection reaction", traits.some(it => it.section === "Reaction" && it.name === "Protection"), JSON.stringify(traits.map(it => `${it.section}:${it.name}`)));

	await page.selectOption("#cs-sk-role", {label: "Attacker"});
	await page.waitForTimeout(800);
	traits = await readTraits(page);
	check("an Attacker does not", !traits.some(it => it.name === "Protection"), JSON.stringify(traits.map(it => it.name)));
	check("the chosen role is stored", (await getState(page)).sidekickRole === "attacker");
	check("the subtitle names it", /attacker/i.test(await page.textContent("#cs-sk-subtitle")), await page.textContent("#cs-sk-subtitle"));

	// ---------- the Essentials Kit table, and levelling with it ----------
	let table = await readLevelTable(page);
	check("the table covers levels 1 to 6", table.nRows === 6, `${table.nRows} rows`);
	check("it marks the current level with the book's hit points", /^1 13/.test(table.now || ""), table.now);
	check("later levels are dimmed", table.nFuture === 5, `${table.nFuture} future rows`);
	check("the next level is spelled out, with its hit points and feature", /Level 2/.test(table.next) && /19 HP/.test(table.next) && /Second Wind/.test(table.next), table.next.slice(0, 120));

	await page.click("#cs-sk-level-next button");
	await page.waitForTimeout(1000);

	state = await getState(page);
	check("levelling up raises the level", state.level === 2, `level=${state.level}`);
	check("and takes the table's exact hit point maximum", state.hpMax === 19, `hpMax=${state.hpMax}`);
	traits = await readTraits(page);
	check("and adds the level's feature as an entry", traits.some(it => it.name === "Second Wind" && /1d10/.test(it.text)), JSON.stringify(traits.map(it => it.name)));

	// ---------- a sidekick started above 1st level can catch up in one click ----------
	await setField(page, "cs-level", 5);
	await resolveModals(page, {maxSteps: 4});
	await page.waitForTimeout(1000);
	check("starting higher offers to catch the sidekick up", /still owed/.test(await page.textContent("#cs-sk-level-next")), (await page.textContent("#cs-sk-level-next")).replace(/\s+/g, " ").slice(0, 120));

	await page.click(".cs__sk-catchup button");
	await page.waitForTimeout(1000);
	state = await getState(page);
	traits = await readTraits(page);
	check("catching up sets the hit points for that level", state.hpMax === 39, `hpMax=${state.hpMax}`);
	check("and grants every feature up to it", ["Second Wind", "Improved Critical", "Ability Score Improvement", "Proficiency Bonus"]
		.every(name => traits.some(it => it.name === name)), JSON.stringify(traits.map(it => it.name)));
	check("without granting a later level's", !traits.some(it => it.name === "Extra Attack"));

	// ---------- traits can be added and removed by hand ----------
	const nBefore = (await readTraits(page)).length;
	await page.click("#cs-sk-trait-add");
	await page.waitForTimeout(600);
	{
		const ov = page.locator(".ve-ui-modal__overlay").last();
		await ov.locator("select").selectOption({label: "Bonus Action"});
		await ov.locator("button:has-text('OK')").last().click();
		await page.waitForTimeout(500);
		const ov2 = page.locator(".ve-ui-modal__overlay").last();
		await ov2.locator("input").first().fill("Overclock");
		await ov2.locator("button:has-text('OK')").last().click();
	}
	await page.waitForTimeout(700);
	traits = await readTraits(page);
	check("a trait can be added by hand", traits.length === nBefore + 1 && traits.some(it => it.name === "Overclock" && it.section === "Bonus Action"), JSON.stringify(traits.map(it => `${it.section}:${it.name}`)));

	await page.evaluate(() => {
		const row = [...document.querySelectorAll("#cs-sk-traits .cs__sk-trait")].find(r => r.querySelector(".cs__sk-trait-name")?.value === "Overclock");
		row.querySelector(".ve-btn-danger").click();
	});
	await page.waitForTimeout(700);
	check("and removed again", !(await readTraits(page)).some(it => it.name === "Overclock"));

	// ---------- a seeded value is only ever a suggestion ----------
	await setField(page, "cs-ac", 18);
	await setField(page, "cs-hp-max", 44);
	await page.evaluate(() => {
		const ta = [...document.querySelectorAll("#cs-sk-traits .cs__sk-trait")]
			.find(r => r.querySelector(".cs__sk-trait-name")?.value === "Second Wind").querySelector(".cs__sk-trait-text");
		ta.value = "Rebuilt as an automaton: immune to poison.";
		ta.dispatchEvent(new Event("change", {bubbles: true}));
	});
	await page.waitForTimeout(700);

	state = await getState(page);
	check("a seeded number can be overwritten", state.ac === 18 && state.hpMax === 44, `ac=${state.ac} hp=${state.hpMax}`);
	check("so can a granted feature's text", state.sidekickTraits.some(it => /automaton/i.test(it.text || "")), JSON.stringify(state.sidekickTraits.map(it => it.name)));

	// ---------- the book's own rules are one click away ----------
	await page.click("#cs-sk-rules-toggle");
	await page.waitForTimeout(1500);
	const rules = await page.textContent("#cs-sk-rules");
	check("the Essentials Kit sidekick rules can be shown", /sidekick starts as a 1st-level character/i.test(rules), rules.replace(/\s+/g, " ").slice(0, 90));

	// ---------- the Tasha's path still works, for a sidekick past 6th level ----------
	const tce = await openPage(browser, {url: SIDEKICK_URL});
	await pickCreature(tce, {query: "guard", rowText: "Guard", srcText: "MM"});
	await resolveModals(tce, {maxSteps: 4});

	let tceState = await getState(tce);
	check("any stat block can seed a sidekick", tceState.refCreature?.name === "Guard", JSON.stringify(tceState.refCreature));
	check("its senses land in the notes", /passive Perception 12/.test(tceState.proficienciesText || ""), tceState.proficienciesText);
	check("its actions land as trait rows", (await readTraits(tce)).some(it => it.name === "Spear"), JSON.stringify((await readTraits(tce)).map(it => it.name)));

	await tce.selectOption("#cs-sk-class", {label: "Warrior Sidekick"});
	await tce.waitForFunction(() => /Martial Role/.test(document.getElementById("cs-class-panel")?.textContent || ""), {timeout: 20000}).catch(() => {});
	await tce.waitForTimeout(600);

	tceState = await getState(tce);
	check("a Tasha's sidekick class can be taken instead", tceState.classes?.[0]?.name === "Warrior Sidekick", JSON.stringify(tceState.classes?.[0]));
	check("the hit die comes from the stat block, not the class", tceState.classes?.[0]?.hdFaces === 8, `hdFaces=${tceState.classes?.[0]?.hdFaces}`);
	check("its features render as cards", /Bonus Proficiencies/.test(await tce.textContent("#cs-class-panel")));
	check("and its twenty-level table replaces the Essentials Kit one", (await readLevelTable(tce)).nRows === 20, `${(await readLevelTable(tce)).nRows} rows`);

	// ---------- sidekicks and characters stay in their own lists ----------
	const charPage = await openPage(browser, {url: `${BASE_URL}/charactersheet.html`, state: await tce.evaluate(() => localStorage.getItem("charactersheet-characters"))});
	const charOptions = await charPage.evaluate(() => [...document.querySelectorAll("#cs-char-select option")].map(o => o.textContent));
	check("the character sheet does not list the sidekick", !charOptions.some(it => /Guard|Warrior/.test(it)), JSON.stringify(charOptions));
	await charPage.close();

	check("no page errors", [...page.errors, ...tce.errors].length === 0, [...page.errors, ...tce.errors].slice(0, 2).join(" | "));
	await tce.close();
	await page.close();
}

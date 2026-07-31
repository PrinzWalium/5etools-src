/**
 * The two things the sheet has to notice for you in play: exhaustion dragging every d20 test down,
 * and the concentration save a hit calls for.
 */

import {BASE_URL, getState, openPage, resolveModals, setField} from "./util-e2e.mjs";

const SHEET_URL = `${BASE_URL}/charactersheet.html`;

/** The sheet shows rolls as rendered `{@d20}` links, so read the number off the element. */
const readMod = (page, id) => page.evaluate(sel => {
	const txt = document.querySelector(sel)?.textContent?.trim() || "";
	return Number(txt.replace(/−/g, "-").replace(/[^\d-]/g, ""));
}, `#${id}`);

const readPrompt = page => page.evaluate(() => {
	const wrp = document.getElementById("cs-conc-prompt");
	return {
		isShown: !!wrp && !wrp.classList.contains("ve-hidden"),
		text: (wrp?.textContent || "").replace(/\s+/g, " ").trim(),
	};
});

/** Set current HP through the field the player actually types in. */
async function setHp (page, value) {
	await setField(page, "cs-hp-cur", value);
	await page.waitForTimeout(400);
}

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: SHEET_URL});

	// A character with numbers worth watching move
	await setField(page, "cs-abil-dex", 16);
	await setField(page, "cs-abil-con", 14);
	await setField(page, "cs-abil-str", 16);
	await setField(page, "cs-level", 5);
	await resolveModals(page, {maxSteps: 4});
	await page.evaluate(() => {
		document.getElementById("cs-save-con").checked = true;
		document.getElementById("cs-save-con").dispatchEvent(new Event("change", {bubbles: true}));
	});
	await page.waitForTimeout(500);

	// ---------- exhaustion ----------
	const before = {
		dexMod: await readMod(page, "cs-mod-dex"),
		conSave: await readMod(page, "cs-saveroll-con"),
		acrobatics: await readMod(page, "cs-skillroll-acrobatics"),
		initiative: await readMod(page, "cs-initiative-roll"),
		passive: Number(await page.textContent("#cs-passive-perception")),
	};
	check("a rested character rolls its plain numbers", before.conSave === 5 && before.dexMod === 3, JSON.stringify(before));
	check("and is told nothing about exhaustion", (await page.textContent("#cs-exhaustion-note")).trim() === "");

	await setField(page, "cs-exhaustion", 2);
	await page.waitForTimeout(500);

	check("two levels of exhaustion cost 4 on a saving throw", await readMod(page, "cs-saveroll-con") === before.conSave - 4, `${await readMod(page, "cs-saveroll-con")} vs ${before.conSave}`);
	check("...on a skill check", await readMod(page, "cs-skillroll-acrobatics") === before.acrobatics - 4);
	check("...on a bare ability check", await readMod(page, "cs-mod-dex") === before.dexMod - 4);
	check("...on initiative", await readMod(page, "cs-initiative-roll") === before.initiative - 4);
	check("...and on passive Perception", Number(await page.textContent("#cs-passive-perception")) === before.passive - 4);

	const note = (await page.textContent("#cs-exhaustion-note")).trim();
	check("the sheet says what exhaustion is costing", /-4 to d20 tests/.test(note.replace(/−/g, "-")) && /10 ft/.test(note), note);

	// The unarmed strike is always on the sheet, so its attack bonus is the one to watch:
	// Strength +3, proficiency +3, exhaustion −4
	const atkTxt = (await page.textContent("#cs-unarmed")).replace(/\s+/g, " ");
	check("an attack roll is dragged down too", /\+2 to hit/.test(atkTxt), atkTxt.slice(0, 90));

	await setField(page, "cs-exhaustion", 6);
	await page.waitForTimeout(400);
	check("the sixth level is called what it is", /dead/i.test(await page.textContent("#cs-exhaustion-note")));

	await setField(page, "cs-exhaustion", 0);
	await page.waitForTimeout(400);
	check("clearing it puts every number back", await readMod(page, "cs-saveroll-con") === before.conSave && Number(await page.textContent("#cs-passive-perception")) === before.passive);

	// ---------- concentration ----------
	await setField(page, "cs-hp-max", 40);
	await setHp(page, 40);
	check("no prompt while nothing is being concentrated on", !(await readPrompt(page)).isShown);

	await setHp(page, 25);
	check("...even after taking damage", !(await readPrompt(page)).isShown);

	await setField(page, "cs-concentration", "Bless");
	await page.waitForTimeout(400);
	check("concentrating alone does not prompt either", !(await readPrompt(page)).isShown);

	await setHp(page, 14);
	let prompt = await readPrompt(page);
	check("losing hit points while concentrating asks for the save", prompt.isShown, prompt.text);
	check("at DC 10 for a modest hit", /DC 10/.test(prompt.text), prompt.text);
	check("and names the spell and the damage", /Bless/.test(prompt.text) && /11 damage/.test(prompt.text), prompt.text);

	// Healing is not damage
	await page.evaluate(() => document.querySelector("#cs-conc-prompt [data-cs-conc=keep]").click());
	await page.waitForTimeout(300);
	check("saying it was kept dismisses the prompt", !(await readPrompt(page)).isShown);
	check("and the spell is still being concentrated on", (await getState(page)).concentration === "Bless");

	await setHp(page, 30);
	check("healing does not ask for a save", !(await readPrompt(page)).isShown);

	// A big hit sets the DC from the damage instead
	await setHp(page, 0);
	prompt = await readPrompt(page);
	check("a big hit raises the DC to half the damage", /DC 15/.test(prompt.text), prompt.text);

	await page.evaluate(() => document.querySelector("#cs-conc-prompt [data-cs-conc=lose]").click());
	await page.waitForTimeout(400);
	check("saying it was lost clears the spell", (await getState(page)).concentration === "");
	check("and takes the prompt away", !(await readPrompt(page)).isShown);

	// Switching characters must not fire the prompt off the incoming HP
	await setField(page, "cs-hp-cur", 30);
	await setField(page, "cs-concentration", "Hex");
	await page.waitForTimeout(400);
	await page.click("#cs-char-new");
	await page.waitForTimeout(1200);
	check("starting another character does not read as damage", !(await readPrompt(page)).isShown);

	check("no page errors", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
	await page.close();
}

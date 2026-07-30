/**
 * Weapon Mastery: the chooser lives inside its feature card, offers base weapon *types* (a mastery
 * is a kind of weapon you have trained with, not one you happen to be carrying), and its card is
 * closed by default but marked as holding an unmade choice.
 */

import {getState, openPage, pickClass, resolveModals} from "./util-e2e.mjs";

export async function run ({browser, check}) {
	const page = await openPage(browser);

	// The 2024 Fighter has Weapon Mastery at level 1
	await pickClass(page, "Fighter (PHB'24)");
	await resolveModals(page);
	await page.waitForTimeout(700);

	const card = page.locator("#cs-class-panel .cs__feat-card", {hasText: "Weapon Mastery"}).first();
	check("the feature card is present", await card.count() >= 1);

	const choice = card.locator(".cs__feat-choice");
	check("the chooser lives inside that card", await choice.count() >= 1);
	check("it offers a picker without needing any inventory", await choice.locator("button:has-text('Choose weapon')").count() >= 1);
	check("the count starts unmet", /0\/3 chosen/.test(await choice.textContent()), await choice.textContent());
	check("the card is closed but marked as needing a choice",
		!(await card.evaluate(el => el.open)) && (await card.locator(".cs__feat-mark--unmet").count()) >= 1);

	// ---------- pick a weapon type ----------
	await card.locator("summary").click();
	await page.waitForTimeout(200);
	await choice.locator("button:has-text('Choose weapon')").first().click();
	await page.waitForFunction(() => {
		const sel = document.querySelector(".ve-ui-modal__overlay select");
		return sel && sel.options.length > 5;
	}, {timeout: 15000});

	const nOptions = await page.locator(".ve-ui-modal__overlay select option").count();
	check("the picker offers base weapon types, not every magic variant", nOptions > 20 && nOptions < 80, `options=${nOptions}`);

	const label = (await page.locator(".ve-ui-modal__overlay select option", {hasText: "Longsword"}).first().textContent()).trim();
	await page.selectOption(".ve-ui-modal__overlay select", {label});
	await page.click(".ve-ui-modal__overlay button:has-text('OK')");
	await page.waitForTimeout(800);

	let state = await getState(page);
	check("the mastery is stored without owning the weapon", (state?.weaponMasteries || []).length === 1, JSON.stringify(state?.weaponMasteries));
	check("and nothing was added to the inventory", (state?.inventory || []).length === 0);

	const choiceAfter = page.locator("#cs-class-panel .cs__feat-card", {hasText: "Weapon Mastery"}).first().locator(".cs__feat-choice");
	check("the count goes up", /1\/3 chosen/.test(await choiceAfter.textContent()), await choiceAfter.textContent());

	// ---------- and can be taken back ----------
	const cardAfter = page.locator("#cs-class-panel .cs__feat-card", {hasText: "Weapon Mastery"}).first();
	if (!(await cardAfter.evaluate(el => el.open))) {
		await cardAfter.locator("summary").click();
		await page.waitForTimeout(200);
	}
	await choiceAfter.locator("button:has-text('×')").first().click();
	await page.waitForTimeout(600);
	state = await getState(page);
	check("a mastery can be removed", (state?.weaponMasteries || []).length === 0);

	check("no page errors", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
	await page.close();
}

/**
 * Shared helpers for the Character Sheet browser tests.
 *
 * These drive the real pages in a real browser, because most of what the builder does — resolving
 * a queue of choice modals, rendering a feature timeline, persisting to localStorage — only exists
 * once the page is running. The pure rules modules are covered by the Jest suites instead.
 */

import * as fs from "fs";
import * as path from "path";
import {chromium} from "playwright-core";

export const BASE_URL = process.env.CS_E2E_URL || "http://127.0.0.1:5050";
export const STORAGE_KEY = "charactersheet-characters";

/**
 * Find a Chromium to drive, without assuming a downloaded browser: an explicit path, the
 * Playwright browser directory, or the Chrome that CI images ship with.
 */
function getLaunchOptions () {
	const explicit = process.env.CS_E2E_BROWSER;
	if (explicit && fs.existsSync(explicit)) return {executablePath: explicit};

	const candidates = [
		process.env.PLAYWRIGHT_BROWSERS_PATH ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium") : null,
		"/opt/pw-browsers/chromium",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
		"/usr/bin/google-chrome",
	].filter(Boolean);
	const found = candidates.find(it => fs.existsSync(it));
	if (found) return {executablePath: found};

	// Playwright's own build, or a channel install; whichever the environment has
	return {channel: "chrome"};
}

export async function launchBrowser () {
	return chromium.launch({headless: true, ...getLaunchOptions()});
}

/** Pages currently open, so a failing suite can be photographed before it is torn down. */
const _openPages = new Set();

/** Screenshot every open page — called by the runner when a suite fails, for the CI artifact. */
export async function pScreenshotOpenPages (dir, name) {
	fs.mkdirSync(dir, {recursive: true});
	let i = 0;
	for (const page of _openPages) {
		if (page.isClosed()) continue;
		await page.screenshot({path: path.join(dir, `${name}-${++i}.png`), fullPage: true}).catch(() => {});
	}
}

/** A page with a clean character store, plus a collector for uncaught page errors. */
export async function openPage (browser, {url = `${BASE_URL}/charbuilder.html`, viewport = null, state = null} = {}) {
	const page = await browser.newPage(viewport ? {viewport} : {});
	const errors = [];
	page.on("pageerror", e => errors.push(e.message));
	page.errors = errors;
	_openPages.add(page);
	page.once("close", () => _openPages.delete(page));

	await page.goto(url, {waitUntil: "load"});
	await page.evaluate(([key, state]) => {
		if (state) localStorage.setItem(key, state);
		else localStorage.removeItem(key);
	}, [STORAGE_KEY, state]);
	await page.reload({waitUntil: "load"});
	await page.waitForTimeout(1800);
	return page;
}

/** The current character's state, as persisted. */
export function getState (page) {
	return page.evaluate(key => {
		const store = JSON.parse(localStorage.getItem(key));
		return (store?.characters ? store.characters[store.currentId] : store)?.state;
	}, STORAGE_KEY);
}

/** Pick an entity through a search modal (species, background, item, ...). */
export async function pickViaSearch (page, {btn, query, rowText, srcText = null}) {
	await page.click(btn);
	await page.waitForTimeout(1200);
	const ov = page.locator(".ve-ui-modal__overlay").last();
	const ipt = ov.locator(".ve-ui-search__ipt-search").first();
	await ipt.click();
	await ipt.pressSequentially(query, {delay: 40});
	await page.waitForTimeout(1200);

	const ix = await ov.evaluate((_e, {rowText, srcText}) => {
		const rows = [...document.querySelectorAll(".ve-ui-modal__overlay:last-of-type .ve-ui-search__row")];
		return rows.findIndex(r => {
			const spans = r.querySelectorAll("span");
			return (spans[0]?.textContent || "").trim() === rowText && (!srcText || (spans[1]?.textContent || "").includes(srcText));
		});
	}, {rowText, srcText});
	if (ix < 0) throw new Error(`No search result "${rowText}"${srcText ? ` (${srcText})` : ""} for query "${query}"`);

	await ov.locator(".ve-ui-search__row").nth(ix).click();
	await page.waitForTimeout(800);
}

/** Pick a class through the class dropdown, e.g. "Rogue (PHB'24)". */
export async function pickClass (page, label) {
	await page.click("#cs-pick-class");
	await page.waitForFunction(() => {
		const sel = document.querySelector(".ve-ui-modal__overlay select");
		return sel && sel.options.length > 5;
	}, {timeout: 20000});
	await page.selectOption(".ve-ui-modal__overlay select", {label});
	await page.click(".ve-ui-modal__overlay button:has-text('OK')");
	await page.waitForTimeout(900);
}

/**
 * Answer whatever queue of modals a pick raised: skip the optional offers, take the first real
 * option otherwise. `pick` names a specific option to prefer when it is on offer.
 */
export async function resolveModals (page, {maxSteps = 16, pick = null} = {}) {
	for (let i = 0; i < maxSteps; ++i) {
		await page.waitForTimeout(400);
		const ov = page.locator(".ve-ui-modal__overlay").last();
		if (!(await ov.count())) break;

		if (await ov.locator("button:has-text('Skip')").count()) {
			await ov.locator("button:has-text('Skip')").last().click();
			continue;
		}
		if (await ov.locator("select").count()) {
			const sel = ov.locator("select").first();
			if (pick && await sel.locator(`option:text-is("${pick}")`).count()) await sel.selectOption({label: pick});
			else await sel.selectOption({index: 1}).catch(() => {});
			await ov.locator("button:has-text('OK')").last().click().catch(() => {});
			continue;
		}
		if (await ov.locator("button:has-text('OK')").count()) {
			await ov.locator("button:has-text('OK')").last().click();
			continue;
		}
		break;
	}
}

/** Dismiss whatever modal is open, however it prefers to be closed. */
export async function closeModal (page) {
	const ov = page.locator(".ve-ui-modal__overlay").last();
	if (!(await ov.count())) return;
	for (const label of ["Cancel", "Close", "OK"]) {
		const btn = ov.locator(`button:has-text('${label}')`);
		if (await btn.count()) { await btn.last().click().catch(() => {}); break; }
	}
	await page.waitForTimeout(300);
	if (await page.locator(".ve-ui-modal__overlay").count()) await page.keyboard.press("Escape").catch(() => {});
	await page.waitForFunction(() => !document.querySelector(".ve-ui-modal__overlay"), {timeout: 5000}).catch(() => {});
}

/** Set a bound input and let the model see it. */
export async function setField (page, id, value) {
	await page.fill(`#${id}`, `${value}`);
	await page.dispatchEvent(`#${id}`, "change");
	await page.waitForTimeout(400);
}

/** A character built far enough to exercise the sheet: Rogue 4 / Human / Sailor. */
export async function seedRogue (page) {
	await setField(page, "cs-name", "E2E Rogue");
	await setField(page, "cs-level", 4);
	await resolveModals(page);
	await pickClass(page, "Rogue (PHB'24)");
	await resolveModals(page);
	await pickViaSearch(page, {btn: "#cs-pick-species", query: "human", rowText: "Human", srcText: "PHB'24"});
	await resolveModals(page);
	return getState(page);
}

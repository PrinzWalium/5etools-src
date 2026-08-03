/**
 * The account-system seam, with no account system deployed — which is the state this repo ships in,
 * and a supported deployment rather than a degraded one (the Pages build is static, with no proxy).
 *
 * What matters is that looking for one is completely inert: no console errors, no failed load that
 * bothers the player, and storage still entirely local.
 */

import {BASE_URL, getState, openPage, setField} from "./util-e2e.mjs";

const SHEET_URL = `${BASE_URL}/charactersheet.html`;

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: SHEET_URL});

	// ---------- nothing deployed: the page must not care ----------
	check("with no account system, no adapter is picked up",
		await page.evaluate(() => typeof window.CharacterSyncAdapter === "undefined"));

	check("and the page reports sync as off", await page.evaluate(() => window.__csPage?.isSyncEnabled === false),
		JSON.stringify(await page.evaluate(() => ({hasPage: !!window.__csPage, sync: window.__csPage?.isSyncEnabled}))));

	// A 404 for the client script is the ordinary case, not an error worth showing anyone
	check("a missing account system is not reported as a page error",
		page.errors.length === 0, page.errors.slice(0, 3).join(" | "));

	// ---------- the character still works, and stays in this browser ----------
	await setField(page, "cs-name", "Local Only");
	await setField(page, "cs-hp-max", 21);
	await page.waitForTimeout(700);

	const st = await getState(page);
	check("a character is still edited normally", st.name === "Local Only" && st.hpMax === 21, JSON.stringify({name: st.name, hpMax: st.hpMax}));

	await page.reload({waitUntil: "domcontentloaded"});
	await page.waitForTimeout(3000);
	check("and still persists locally across a reload", (await getState(page)).name === "Local Only");

	// ---------- the path is configuration, not a constant ----------
	const paths = await page.evaluate(async () => {
		const mod = await import("/js/charactersheet/charactersheet-sync.js");
		return {
			fallback: mod.getSyncBasePath({win: {}, doc: {querySelector: () => null}}),
			viaMeta: mod.getSyncBasePath({win: {}, doc: {querySelector: () => ({getAttribute: () => "/accounts"})}}),
			viaWindow: mod.getSyncBasePath({win: {CHARACTER_SYNC_PATH: "/elsewhere"}, doc: {querySelector: () => null}}),
			off: mod.getSyncBasePath({win: {CHARACTER_SYNC_PATH: ""}, doc: {querySelector: () => null}}),
			client: mod.getSyncClientUrl("/online"),
		};
	});
	check("the default path is /online", paths.fallback === "/online", JSON.stringify(paths));
	check("a deployment can move it", paths.viaMeta === "/accounts" && paths.viaWindow === "/elsewhere", JSON.stringify(paths));
	check("or switch it off entirely", paths.off === null, JSON.stringify(paths));
	check("and the client script hangs off whatever path is set", paths.client === "/online/client.js", paths.client);

	check("no page errors", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
	await page.close();

	// ---------- with an account system answering ----------
	// The badge is the only thing that tells a player any of this is connected, so it is worth
	// driving against a real page rather than trusting the pure status function alone.

	const signedOut = await openWithStubAdapter(browser, {user: null});
	check("a connected account system shows a badge", await signedOut.locator("#cs-sync-badge").count() === 1);
	check("and says nobody is signed in", (await signedOut.locator("#cs-sync-badge").innerText()).includes("Signed out"),
		await signedOut.locator("#cs-sync-badge").innerText().catch(() => "(absent)"));

	await signedOut.click("#cs-sync-badge");
	await signedOut.waitForTimeout(400);
	const outText = await signedOut.locator(".ve-ui-modal__inner").last().innerText();
	check("clicking it says where it looked", outText.includes("/online"), outText.slice(0, 200));
	check("and offers a way to sign in", await signedOut.locator(".ve-ui-modal__inner a:has-text('Sign in')").count() === 1);
	check("no page errors (signed out)", signedOut.errors.length === 0, signedOut.errors.slice(0, 2).join(" | "));
	await signedOut.close();

	const signedIn = await openWithStubAdapter(browser, {user: {id: "u1", name: "Ada", role: "admin"}});
	const inLabel = await signedIn.locator("#cs-sync-badge").innerText();
	check("a signed-in badge names the person", inLabel.includes("Ada"), inLabel);

	await signedIn.click("#cs-sync-badge");
	await signedIn.waitForTimeout(400);
	const inText = await signedIn.locator(".ve-ui-modal__inner").last().innerText();
	check("the detail shows the role", inText.includes("admin"), inText.slice(0, 200));
	// Phase 0 of the account system signs you in but stores nothing; that must not read as "online"
	check("and says characters are not stored online yet", /only copy/.test(inText), inText.slice(0, 300));
	await signedIn.close();

	// A service that is there but broken is exactly what the badge exists to make visible
	const broken = await openWithStubAdapter(browser, {failWith: "502 Bad Gateway"});
	const badLabel = await broken.locator("#cs-sync-badge").innerText();
	check("an unreachable account system reads as offline", badLabel.includes("Offline"), badLabel);

	await broken.click("#cs-sync-badge");
	await broken.waitForTimeout(400);
	check("and clicking it shows the error itself",
		(await broken.locator(".ve-ui-modal__inner").last().innerText()).includes("502 Bad Gateway"));
	check("a failing account system is still not a page error", broken.errors.length === 0, broken.errors.slice(0, 2).join(" | "));
	await broken.close();
}

/**
 * A page with a stand-in account system on `/online/client.js`.
 *
 * Serving the script rather than injecting the adapter directly is the point: it exercises the same
 * path a real deployment takes, including the fork refusing to look anywhere else.
 */
async function openWithStubAdapter (browser, {user = null, failWith = null} = {}) {
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", e => errors.push(e.message));
	page.errors = errors;

	await page.route("**/online/client.js", route => route.fulfill({
		contentType: "text/javascript",
		body: `window.CharacterSyncAdapter = {
			getCapabilities: function () { return {characters: false}; },
			pWhoAmI: function () { return ${failWith ? `Promise.reject(new Error(${JSON.stringify(failWith)}))` : `Promise.resolve(${JSON.stringify(user)})`}; },
			pList: function () { return Promise.reject(new Error("no")); },
			pLoad: function () { return Promise.reject(new Error("no")); },
			pSave: function () { return Promise.reject(new Error("no")); },
			pDelete: function () { return Promise.reject(new Error("no")); },
			getLoginUrl: function () { return "/online/login"; },
			getLogoutUrl: function () { return "/online/logout"; },
		};`,
	}));

	await page.goto(SHEET_URL, {waitUntil: "load"});
	await page.waitForTimeout(2500);
	return page;
}

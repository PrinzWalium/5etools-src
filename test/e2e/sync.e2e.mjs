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
}

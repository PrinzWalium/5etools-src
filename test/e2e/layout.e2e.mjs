/**
 * Layout regressions the sheet has actually had: boxes drawn on top of each other, columns that
 * kept their desktop width when stacked on a phone, and content wider than the screen.
 */

import {BASE_URL, openPage, seedRogue} from "./util-e2e.mjs";

/** Sibling elements in normal flow whose boxes intersect — i.e. drawn on top of each other. */
const getOverlaps = page => page.evaluate(() => {
	const out = new Set();
	const isCandidate = e => {
		const r = e.getBoundingClientRect();
		return r.width > 4 && r.height > 4 && getComputedStyle(e).position === "static";
	};
	[...document.querySelectorAll("main *")].forEach(parent => {
		// Inline links share a text line legitimately, so only compare block-level siblings
		const kids = [...parent.children].filter(k => isCandidate(k) && getComputedStyle(k).display !== "inline");
		for (let i = 0; i < kids.length; ++i) {
			for (let j = i + 1; j < kids.length; ++j) {
				const a = kids[i].getBoundingClientRect(); const b = kids[j].getBoundingClientRect();
				const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
				const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
				if (ox > 2 && oy > 2) out.add(`${kids[i].className || kids[i].tagName} × ${kids[j].className || kids[j].tagName}`);
			}
		}
	});
	return [...out];
});

const getMetrics = page => page.evaluate(() => {
	const width = sel => Math.round(document.querySelector(sel)?.getBoundingClientRect().width ?? -1);
	return {
		clientWidth: document.documentElement.clientWidth,
		scrollWidth: document.documentElement.scrollWidth,
		col: width(".cs__col"),
		abilities: width("#cs-abilities"),
		classPanel: width("#cs-class-panel"),
	};
});

export async function run ({browser, check}) {
	// ---------- desktop ----------
	const builder = await openPage(browser, {viewport: {width: 1165, height: 1000}});
	const state = await seedRogue(builder);
	check("a character can be built for the layout checks", !!state?.classes?.length);

	const sheet = await openPage(browser, {
		url: `${BASE_URL}/charactersheet.html`,
		viewport: {width: 1165, height: 1000},
		state: await builder.evaluate(() => localStorage.getItem("charactersheet-characters")),
	});
	await sheet.waitForTimeout(1200);

	const overlaps = await getOverlaps(sheet);
	check("nothing is drawn on top of anything else", overlaps.length === 0, overlaps.slice(0, 5).join(" | "));

	const desktop = await getMetrics(sheet);
	check("the page does not scroll sideways", desktop.scrollWidth <= desktop.clientWidth + 1, JSON.stringify(desktop));

	// The ability score box and its modifier used to overlap by 10px
	const abilityBox = await sheet.evaluate(() => {
		const box = document.querySelector(".cs__ability");
		const mod = box?.querySelector(".cs__ability-mod");
		const score = box?.querySelector(".cs__ability-score");
		if (!mod || !score) return null;
		const a = mod.getBoundingClientRect(); const b = score.getBoundingClientRect();
		return {gap: Math.round(b.top - a.bottom), modSize: Math.round(parseFloat(getComputedStyle(mod).fontSize))};
	});
	check("the ability modifier sits clear of the score box", abilityBox && abilityBox.gap >= 0, JSON.stringify(abilityBox));
	check("and is the prominent number", abilityBox && abilityBox.modSize >= 18, JSON.stringify(abilityBox));

	await sheet.close();

	// ---------- phone ----------
	const phone = await openPage(browser, {
		url: `${BASE_URL}/charactersheet.html`,
		viewport: {width: 390, height: 844},
		state: await builder.evaluate(() => localStorage.getItem("charactersheet-characters")),
	});
	await phone.waitForTimeout(1200);

	const mobile = await getMetrics(phone);
	// The grid's `.ve-col-N { width: …% !important }` used to keep each stacked column at a quarter
	check("stacked columns take the full width", mobile.col >= mobile.clientWidth - 40, JSON.stringify(mobile));
	check("panels inside them do too", mobile.abilities >= 300 && mobile.classPanel >= 300, JSON.stringify(mobile));
	check("the phone page does not scroll sideways", mobile.scrollWidth <= mobile.clientWidth + 1, JSON.stringify(mobile));

	const phoneOverlaps = await getOverlaps(phone);
	check("nothing overlaps on a phone either", phoneOverlaps.length === 0, phoneOverlaps.slice(0, 5).join(" | "));

	check("no page errors", [...builder.errors, ...phone.errors].length === 0, [...builder.errors, ...phone.errors].slice(0, 2).join(" | "));

	await phone.close();
	await builder.close();
}

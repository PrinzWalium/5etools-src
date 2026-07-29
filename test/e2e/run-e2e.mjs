#!/usr/bin/env node
/**
 * Runner for the Character Sheet browser tests.
 *
 * Starts the dev server (unless one is already listening), runs every `*.e2e.mjs` beside this
 * file, and reports each suite's checks. Exits non-zero if any check failed, so CI can gate on it.
 *
 *   node test/e2e/run-e2e.mjs             # everything
 *   node test/e2e/run-e2e.mjs wizard      # only suites whose name contains "wizard"
 */

import * as fs from "fs";
import * as path from "path";
import {spawn} from "child_process";
import {fileURLToPath} from "url";
import {BASE_URL, launchBrowser, pScreenshotOpenPages} from "./util-e2e.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const filters = process.argv.slice(2);

const isServerUp = async () => {
	try {
		const res = await fetch(`${BASE_URL}/charbuilder.html`, {signal: AbortSignal.timeout(2000)});
		return res.ok;
	} catch (e) {
		return false;
	}
};

async function pStartServer () {
	if (await isServerUp()) {
		console.log(`Using the server already listening on ${BASE_URL}`);
		return null;
	}

	console.log(`Starting a dev server on ${BASE_URL} ...`);
	const proc = spawn("npx", ["http-server", "-c-1", "--cors", "--port", "5050", "--silent"], {
		cwd: path.join(DIR, "..", ".."),
		stdio: "ignore",
		detached: false,
	});

	for (let i = 0; i < 40; ++i) {
		await new Promise(resolve => setTimeout(resolve, 500));
		if (await isServerUp()) return proc;
	}
	proc.kill();
	throw new Error("The dev server did not come up within 20s");
}

/** Collects one suite's checks; a suite calls `check(name, condition, detail)`. */
class SuiteResult {
	constructor (name) {
		this.name = name;
		this.checks = [];
	}

	check (name, isOk, detail = "") {
		this.checks.push({name, isOk: !!isOk, detail});
		console.log(`  ${isOk ? "✓" : "✗"} ${name}${detail && !isOk ? ` — ${detail}` : ""}`);
	}

	get nFailed () { return this.checks.filter(it => !it.isOk).length; }
}

const main = async () => {
	const files = fs.readdirSync(DIR)
		.filter(it => it.endsWith(".e2e.mjs"))
		.filter(it => !filters.length || filters.some(f => it.includes(f)))
		.sort();

	if (!files.length) {
		console.error(`No matching suites in ${DIR}`);
		process.exit(1);
	}

	const server = await pStartServer();
	const browser = await launchBrowser();
	const results = [];

	try {
		for (const file of files) {
			const suiteName = file.replace(/\.e2e\.mjs$/, "");
			console.log(`\n${suiteName}`);
			const result = new SuiteResult(suiteName);
			results.push(result);
			const {run} = await import(path.join(DIR, file));
			try {
				await run({browser, check: (n, c, d) => result.check(n, c, d)});
			} catch (e) {
				result.check("suite ran to completion", false, e.message);
			}
			// A picture of whatever the page looked like beats guessing at a selector timeout
			if (result.nFailed) await pScreenshotOpenPages(path.join(DIR, "screenshots"), suiteName);
		}
	} finally {
		await browser.close();
		if (server) server.kill();
	}

	const nChecks = results.reduce((acc, it) => acc + it.checks.length, 0);
	const nFailed = results.reduce((acc, it) => acc + it.nFailed, 0);
	console.log(`\n${nChecks - nFailed}/${nChecks} checks passed across ${results.length} suites`);
	if (nFailed) {
		console.log("\nFailures:");
		results.forEach(suite => suite.checks.filter(it => !it.isOk)
			.forEach(it => console.log(`  ${suite.name}: ${it.name}${it.detail ? ` — ${it.detail}` : ""}`)));
	}
	process.exit(nFailed ? 1 : 0);
};

main().catch(e => {
	console.error(e);
	process.exit(1);
});

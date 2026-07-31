import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {CHAR_SHEET_SKILLS, PROF_STATE_EXPERTISE} from "./charactersheet-consts.js";
import {getEncumbrance} from "./charactersheet-derive.js";
import {getAsiCount, getExpertiseSkillCount, getWeaponMasteryCount} from "./charactersheet-levelengine.js";
import {AUDIT_BROKEN, auditCharacter, groupFindings} from "./charactersheet-audit.js";

/**
 * The build audit, on the builder: what breaks a rule, and what the character is owed but has not
 * taken. It reports and never blocks — a DM ruling beats it, and a character with findings is
 * still perfectly playable.
 *
 * The counts come from the same pure functions the class panel uses to *offer* those choices, so
 * the audit cannot drift from what the panel asks for.
 */
export class CharacterAuditPanel {
	constructor ({comp, wrp}) {
		this._comp = comp;
		this._wrp = wrp;
		this._renderToken = 0;
	}

	init () {
		[
			"classes", "level", "inventory", "weaponMasteries", "pendingAbilityOffers",
			"refSpecies", "refBackground", "speciesText", "backgroundText", "hpMax",
			...CHAR_SHEET_SKILLS.map(({key}) => `skill_${key}`),
			"abil_str", "abil_dex", "abil_con", "abil_int", "abil_wis", "abil_cha",
		].forEach(prop => this._comp._addHookBase(prop, () => this._pRender()));
		this._pRender();
	}

	/** What the character's classes grant, and how much of it has been taken. */
	async _pGetCounts (loaded) {
		const state = this._comp._getState();

		const asiTotal = loaded.reduce((acc, {entry, cls}) => acc + (cls ? getAsiCount(cls, entry.level) : 0), 0);
		const asiTaken = (state.classes || [])
			.reduce((acc, entry) => acc + (entry.asiFeatChoices || []).filter(Boolean).length, 0);

		const expertiseTotal = loaded.reduce((acc, {entry, cls}) => acc + (cls ? getExpertiseSkillCount(cls, entry.level) : 0), 0);
		const expertiseTaken = CHAR_SHEET_SKILLS.filter(({key}) => Number(state[`skill_${key}`]) === PROF_STATE_EXPERTISE).length;

		const masteryTotal = loaded.reduce((acc, {entry, cls}) => acc + (cls ? getWeaponMasteryCount(cls, entry.level) : 0), 0);
		const masteryTaken = (state.weaponMasteries || []).length;

		return {asiTotal, asiTaken, expertiseTotal, expertiseTaken, masteryTotal, masteryTaken};
	}

	async _pRender () {
		const token = ++this._renderToken;
		const loaded = await CharacterSheetClassData.pGetLoadedClasses(this._comp._state.classes).catch(() => []);
		if (token !== this._renderToken) return;

		const state = this._comp._getState();
		const findings = auditCharacter(state, {
			encumbrance: getEncumbrance(state),
			classInfos: loaded.map(({entry, cls}) => ({
				name: entry.name,
				level: entry.level,
				requirements: cls?.multiclassing?.requirements || null,
			})),
			counts: await this._pGetCounts(loaded),
		});

		this._wrp.innerHTML = "";
		if (!findings.length) {
			this._wrp.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small">Nothing to flag &mdash; no rule broken, nothing left to choose.</div>`);
			return;
		}

		groupFindings(findings).forEach(grp => {
			const wrpGrp = document.createElement("div");
			wrpGrp.className = "ve-mb-1";

			const hdr = document.createElement("div");
			hdr.className = "cs__lbl";
			hdr.textContent = grp.label;
			wrpGrp.appendChild(hdr);

			grp.items.forEach(finding => {
				const row = document.createElement("div");
				row.className = `cs__audit-row${grp.severity === AUDIT_BROKEN ? " cs__audit-row--broken" : ""}`;
				row.innerHTML = `<span>${finding.message.qq()}</span>`;
				if (finding.hint) row.title = finding.hint;
				wrpGrp.appendChild(row);
			});

			this._wrp.appendChild(wrpGrp);
		});
	}
}

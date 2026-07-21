import {getEncumbrance} from "./charactersheet-derive.js";

class _InventoryRenderableCollection extends RenderableCollectionBase {
	constructor (comp, wrpRows) {
		super(comp, "inventory");
		this._wrpRows = wrpRows;
	}

	getNewRender (entity) {
		const tr = document.createElement("tr");
		tr.innerHTML = `
			<td class="cs__inv-name"></td>
			<td class="ve-text-center" style="width: 60px;"><input type="number" min="0" class="ve-form-control ve-input-xs cs__ipt-num cs__ipt-num--xs cs__inv-qty"></td>
			<td class="ve-text-right ve-muted ve-small cs__inv-weight" style="width: 70px;"></td>
			<td class="ve-text-center no-print" style="width: 30px;">
				<button type="button" class="ve-btn ve-btn-xxs ve-btn-danger cs__inv-rm" title="Remove"><span class="glyphicon glyphicon-trash"></span></button>
			</td>
		`;

		const meta = {
			wrpRow: tr,
			dispName: tr.querySelector(".cs__inv-name"),
			iptQty: tr.querySelector(".cs__inv-qty"),
			dispWeight: tr.querySelector(".cs__inv-weight"),
		};

		meta.iptQty.addEventListener("change", () => this._comp.updateInventoryItem(entity.id, {quantity: Math.max(0, Number(meta.iptQty.value) || 0)}));
		tr.querySelector(".cs__inv-rm").addEventListener("click", () => this._comp.removeInventoryItem(entity.id));

		this._wrpRows.appendChild(tr);
		this.doUpdateExistingRender(meta, entity);
		return meta;
	}

	doUpdateExistingRender (meta, entity) {
		meta.dispName.innerHTML = Renderer.get().render(`{@item ${entity.name}${entity.source?.toLowerCase() !== "phb" ? `|${entity.source}` : ""}}`);
		if (document.activeElement !== meta.iptQty) meta.iptQty.value = `${entity.quantity ?? 1}`;
		const weight = (Number(entity.weightLb) || 0) * (Number(entity.quantity) || 0);
		meta.dispWeight.textContent = entity.weightLb != null ? `${Math.round(weight * 100) / 100} lb.` : "—";
	}

	doDeleteExistingRender (meta) {
		meta.wrpRow.remove();
	}
}

/** The tracked inventory: item rows with quantity and weight, plus encumbrance totals. */
export class CharacterInventoryPanel {
	constructor ({comp, wrp}) {
		this._comp = comp;
		this._wrp = wrp;
		this._collection = null;
		this._dispTotals = null;
	}

	init () {
		this._wrp.innerHTML = `
			<div class="ve-flex-v-center ve-mb-1">
				<button type="button" class="ve-btn ve-btn-xs ve-btn-default no-print" id="cs-inv-add"><span class="glyphicon glyphicon-search"></span> Add Item</button>
				<span class="ve-muted ve-small ve-ml-auto" id="cs-inv-totals"></span>
			</div>
			<table class="w-100 cs__inv-table"><tbody id="cs-inv-body"></tbody></table>
		`;
		this._dispTotals = this._wrp.querySelector("#cs-inv-totals");
		this._wrp.querySelector("#cs-inv-add").addEventListener("click", () => this._pOnAddItem());

		this._collection = new _InventoryRenderableCollection(this._comp, this._wrp.querySelector("#cs-inv-body"));
		this._comp._addHookBase("inventory", () => {
			this._collection.render();
			this._renderTotals();
		});
		this._comp._addHookBase("abil_str", () => this._renderTotals());

		this._collection.render();
		this._renderTotals();
	}

	_renderTotals () {
		const {totalWeightLb, capacityLb} = getEncumbrance(this._comp._getState());
		if (!this._comp._state.inventory.length) {
			this._dispTotals.textContent = "";
			return;
		}
		const isOver = totalWeightLb > capacityLb;
		this._dispTotals.innerHTML = `${totalWeightLb} / ${capacityLb} lb.${isOver ? ` <span class="ve-text-danger" title="Over standard carrying capacity (Strength × 15)">(encumbered)</span>` : ""}`;
	}

	async _pOnAddItem () {
		const doc = await SearchWidget.pGetUserItemSearch();
		if (!doc) return;
		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
		this._comp.addInventoryItem({
			name: doc.n,
			source: doc.source,
			quantity: 1,
			weightLb: ent?.weight ?? null,
		});
	}
}

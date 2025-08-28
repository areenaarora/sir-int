// ----- DOM -----
const q = document.getElementById("q");
const pageSizeSel = document.getElementById("pageSize");
const thead = document.getElementById("thead");
const tbody = document.getElementById("tbody");
const btnPrev = document.getElementById("prev");
const btnNext = document.getElementById("next");
const pageInfo = document.getElementById("pageInfo");

const colList = document.getElementById("colList");
const filterRowsEl = document.getElementById("filterRows");
const btnAddFilter = document.getElementById("btnAddFilter");

// ----- State -----
let rows = []; // all data
let headers = []; // column names in CSV order
let numericCols = new Set();
let selectedCols = []; // subset to display
let filtered = []; // rows after search+filters
let page = 1;
let pageSize = parseInt(pageSizeSel.value, 10);
let sortKey = null; // column name
let sortDir = "asc"; // 'asc' | 'desc'

// ===== Helpers =====
const numericLikeRE = /^\s*[-+]?(\d{1,3}(,\d{3})*|\d+)(\.\d+)?\s*%?\s*$/;
// parse numbers like 1,234  -56.7  12%  3.14  but NOT "18–29"
function toNumber(v) {
	if (v == null) return NaN;
	const s = String(v).trim();
	if (!numericLikeRE.test(s)) return NaN;
	// drop everything except digits, +-.eE and decimal point/commas/percent
	const cleaned = s.replace(/,/g, "").replace(/%$/, "");
	const n = parseFloat(cleaned);
	return Number.isFinite(n) ? n : NaN;
}

// ===== CSV =====
function parseCSV(text) {
	const out = [];
	const lines = text
		.replace(/\r/g, "")
		.split("\n")
		.filter(l => l.trim().length);

	// strip BOM on the very first header cell if present
	headers = splitCSVLine(lines[0]).map(h => h.replace(/^\uFEFF/, "").trim());

	for (let i = 1; i < lines.length; i++) {
		const cells = splitCSVLine(lines[i]).map(c => (c ?? "").trim());
		const o = {};
		headers.forEach((h, j) => {
			o[h] = cells[j] ?? "";
		});
		out.push(o);
	}
	return out;

	function splitCSVLine(line) {
		const res = [];
		let cur = "",
			inQ = false;
		for (let i = 0; i < line.length; i++) {
			const c = line[i];
			if (c === '"') {
				if (inQ && line[i + 1] === '"') {
					cur += '"';
					i++;
				} else inQ = !inQ;
			} else if (c === "," && !inQ) {
				res.push(cur);
				cur = "";
			} else {
				cur += c;
			}
		}
		res.push(cur);
		return res;
	}
}

// ===== Init =====
init();

async function init() {
	const csv = await fetch("assets/data/data.csv").then(r => r.text());
	rows = parseCSV(csv);
	if (!rows.length) return;

	selectedCols = headers.slice(); // default: show all
	inferNumericCols();

	buildColumnPicker();
	buildHeader();
	filtered = rows.slice();
	render();

	// events
	q.addEventListener("input", debounce(applySearchAndFilters, 200));
	pageSizeSel.addEventListener("change", () => {
		pageSize = parseInt(pageSizeSel.value, 10);
		page = 1;
		render();
	});
	btnPrev.addEventListener("click", () => {
		if (page > 1) {
			page--;
			render();
		}
	});
	btnNext.addEventListener("click", () => {
		const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize));
		if (page < maxPage) {
			page++;
			render();
		}
	});
	btnAddFilter.addEventListener("click", () => addFilterRow());
}

function inferNumericCols() {
	const sampleN = Math.min(rows.length, 50);
	headers.forEach(h => {
		let numericCount = 0;
		for (let i = 0; i < sampleN; i++) {
			if (numericLikeRE.test(String(rows[i][h]).trim())) numericCount++;
		}
		if (numericCount >= sampleN * 0.6) numericCols.add(h);
	});
}

// ===== Column picker =====
function buildColumnPicker() {
	colList.innerHTML = "";
	headers.forEach(h => {
		const id = "c_" + h.replace(/\W+/g, "_");
		const wrap = document.createElement("label");
		wrap.className = "chk";
		wrap.innerHTML = `<input type="checkbox" id="${id}" data-col="${h}" checked>
                      <span>${h}</span>`;
		colList.appendChild(wrap);
		wrap.querySelector("input").addEventListener("change", e => {
			const col = e.target.dataset.col;
			if (e.target.checked) {
				if (!selectedCols.includes(col)) selectedCols.push(col);
			} else {
				selectedCols = selectedCols.filter(c => c !== col);
			}
			// keep original CSV order
			selectedCols.sort((a, b) => headers.indexOf(a) - headers.indexOf(b));
			buildHeader();
			render();
		});
	});
}

// ===== Filters builder =====
function addFilterRow(init = {}) {
	const row = document.createElement("div");
	row.className = "frow";
	row.innerHTML = `
    <select class="f-col">
      ${headers.map(h => `<option value="${h}">${h}</option>`).join("")}
    </select>
    <select class="f-op"></select>
    <input class="f-val" type="text" placeholder="Value">
    <button class="rm" title="Remove">×</button>
  `;
	filterRowsEl.appendChild(row);

	const colSel = row.querySelector(".f-col");
	const opSel = row.querySelector(".f-op");
	const valInp = row.querySelector(".f-val");

	if (init.col) colSel.value = init.col;
	setOps(opSel, colSel.value);
	if (init.op) opSel.value = init.op;
	if (init.val != null) valInp.value = init.val;

	// auto-apply on any change
	colSel.addEventListener("change", () => {
		setOps(opSel, colSel.value);
		applySearchAndFilters();
	});
	opSel.addEventListener("change", applySearchAndFilters);
	valInp.addEventListener("input", debounce(applySearchAndFilters, 200));
	row.querySelector(".rm").addEventListener("click", () => {
		row.remove();
		applySearchAndFilters();
	});

	function setOps(selectEl, col) {
		const isNum = numericCols.has(col);
		const ops = isNum
			? [
					["=", "is"],
					["!=", "is not"],
					[">", ">"],
					[">=", "≥"],
					["<", "<"],
					["<=", "≤"],
			  ]
			: [
					["contains", "contains"],
					["starts", "starts with"],
					["ends", "ends with"],
					["=", "is"],
					["!=", "is not"],
			  ];
		selectEl.innerHTML = ops.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
	}
}

function collectFilters() {
	const rows = [...filterRowsEl.querySelectorAll(".frow")];
	return rows
		.map(r => ({
			col: r.querySelector(".f-col").value,
			op: r.querySelector(".f-op").value,
			val: r.querySelector(".f-val").value,
		}))
		.filter(f => f.val !== "");
}

// ===== Search + Filters + Sort =====
function applySearchAndFilters() {
	const term = q.value.trim().toLowerCase();
	const conditions = collectFilters();

	filtered = rows.filter(r => {
		// apply filter rows
		for (const f of conditions) {
			const vRaw = r[f.col];
			const isNum = numericCols.has(f.col);
			if (isNum) {
				const v = toNumber(vRaw);
				const t = toNumber(f.val);
				if (Number.isNaN(v) || Number.isNaN(t)) return false;
				if (f.op === "=" && !(v === t)) return false;
				if (f.op === "!=" && !(v !== t)) return false;
				if (f.op === ">" && !(v > t)) return false;
				if (f.op === ">=" && !(v >= t)) return false;
				if (f.op === "<" && !(v < t)) return false;
				if (f.op === "<=" && !(v <= t)) return false;
			} else {
				const v = String(vRaw ?? "").toLowerCase();
				const t = String(f.val).toLowerCase();
				if (f.op === "contains" && !v.includes(t)) return false;
				if (f.op === "starts" && !v.startsWith(t)) return false;
				if (f.op === "ends" && !v.endsWith(t)) return false;
				if (f.op === "=" && !(v === t)) return false;
				if (f.op === "!=" && !(v !== t)) return false;
			}
		}
		// global search
		if (!term) return true;
		return Object.values(r).some(v => String(v).toLowerCase().includes(term));
	});

	applySort();
	page = 1;
	render();
}

function applySort() {
	if (!sortKey) return;
	const dir = sortDir === "asc" ? 1 : -1;
	filtered.sort((a, b) => {
		const va = a[sortKey] ?? "";
		const vb = b[sortKey] ?? "";
		if (numericCols.has(sortKey)) {
			const na = toNumber(va),
				nb = toNumber(vb);
			if (!Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * dir;
		}
		return String(va).localeCompare(String(vb)) * dir;
	});
}

// ===== Table =====
function buildHeader() {
	const cols = selectedCols.length ? selectedCols : headers;
	const tr = document.createElement("tr");
	cols.forEach(col => {
		const th = document.createElement("th");
		th.textContent = col;
		const s = document.createElement("span");
		s.className = "sort";
		th.appendChild(s);
		th.dataset.key = col;
		th.addEventListener("click", () => {
			if (sortKey === col) sortDir = sortDir === "asc" ? "desc" : "asc";
			else {
				sortKey = col;
				sortDir = "asc";
			}
			applySort();
			page = 1;
			render();
			updateSortIndicators();
		});
		tr.appendChild(th);
	});
	thead.innerHTML = "";
	thead.appendChild(tr);
	updateSortIndicators();
}

function updateSortIndicators() {
	thead.querySelectorAll("th").forEach(th => {
		const span = th.querySelector(".sort");
		if (th.dataset.key === sortKey) span.textContent = sortDir === "asc" ? "▲" : "▼";
		else span.textContent = "";
	});
}

function render() {
	const cols = selectedCols.length ? selectedCols : headers;
	const total = filtered.length;
	const maxPage = Math.max(1, Math.ceil(total / pageSize));
	page = Math.min(page, maxPage);

	const start = (page - 1) * pageSize;
	const slice = filtered.slice(start, start + pageSize);

	tbody.innerHTML = "";
	for (const row of slice) {
		const tr = document.createElement("tr");
		for (const col of cols) {
			const td = document.createElement("td");
			td.textContent = row[col];
			tr.appendChild(td);
		}
		tbody.appendChild(tr);
	}

	pageInfo.textContent = `Page ${page} / ${maxPage} · ${total.toLocaleString()} rows`;
	btnPrev.disabled = page <= 1;
	btnNext.disabled = page >= maxPage;
}

// ===== Utils =====
function debounce(fn, ms) {
	let t;
	return (...a) => {
		clearTimeout(t);
		t = setTimeout(() => fn(...a), ms);
	};
}

// TOGGLING TABLE/MAP VIEW

const btnMapView = document.getElementById("btnMapView");
const btnTableView = document.getElementById("btnTableView");
const tableCard = document.querySelector(".table-card");
const mapCard = document.getElementById("mapCard");

// NEW: refs to the boxes you want to hide in map view
const filtersAside = document.getElementById("filters");
const queryBuilder = document.querySelector(".query-builder");

function setView(view) {
	const isTable = view === "table";

	// table vs map
	tableCard.classList.toggle("hidden", !isTable);
	mapCard.classList.toggle("hidden", isTable);

	// NEW: hide filters + query builder in map view
	filtersAside.classList.toggle("hidden", !isTable);
	queryBuilder.classList.toggle("hidden", !isTable);
	filtersAside.setAttribute("aria-hidden", String(!isTable));
	queryBuilder.setAttribute("aria-hidden", String(!isTable));

	// button states
	btnTableView.classList.toggle("is-active", isTable);
	btnMapView.classList.toggle("is-active", !isTable);
	btnTableView.setAttribute("aria-pressed", String(isTable));
	btnMapView.setAttribute("aria-pressed", String(!isTable));
	mapCard.setAttribute("aria-hidden", String(isTable));
}

// default
setView("table");

btnMapView.addEventListener("click", () => setView("map"));
btnTableView.addEventListener("click", () => setView("table"));

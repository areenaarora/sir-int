/* Bihar AC Deletions Choropleth (D3 v7)
   Works with GeoJSON or TopoJSON.

   Expected HTML IDs (already in your page):
   - #biharMap (svg), #mapLegend, #mapStatus, #mapReason, #mapAgeGroup (optional),
     inputs[name="metric"] (values: total | ratio), #mapReset, #mapTooltip

   Initialize once (in index.html, after loading this file):
     initDeletionMap({
       csvUrl: "assets/data/data.csv",
       geoUrl: "assets/data/bihar_acs.json",
       topoObject: "bihar_acs" // (optional if first object is the right one)
     });
*/
(function () {
	// Column headers expected in CSV (must match exactly)
	const COLS = {
		acName: "Assembly constituency name",
		acNo: "Assembly constituency number", // optional; only used for tooltip if present in topo
		total: "Total deletions",
		reason: "Reason for deletion",
		male: "Male deletions",
		female: "Female deletions",
		ratio: "Gender imbalance in pct",
	};

	const COLORS_TOTAL = [
		"#fff7ec",
		"#fee8c8",
		"#fdd49e",
		"#fdbb84",
		"#fc8d59",
		"#e34a33",
		"#b30000",
	];
	// Fixed, diverging bins for Female vs Male % (signed percentage points, + = more female)
	const COLORS_RATIO_DIVERGE = [
		"#b30000", // >10% more female
		"#fc8d59", // 5–10% more female
		"#fdd49e", // 0–5% more female
		"#c7e9c0", // 0–5% more male
		"#74c476", // 5–10% more male
		"#006d2c", // >10% more male
	];

	const fmt = x => (x == null || !isFinite(+x) ? "–" : d3.format(",")(x));
	const toNum = v => (v == null || v === "" ? 0 : +String(v).replace(/,/g, ""));

	const detectAgeColumn = rows => {
		const keys = Object.keys(rows[0] || {});
		return keys.find(k => /age\s*group/i.test(k)) || null;
	};

	// -------- Topo helpers --------
	function topoToFeatures(topo, objName) {
		const name = objName || Object.keys(topo.objects)[0];
		if (!topo.objects[name]) {
			console.warn("[map] Topo object", name, "not found. Available:", Object.keys(topo.objects));
		}
		return topojson.feature(topo, topo.objects[name]).features;
	}
	const findAcNoKey = features => {
		const probe = features[0]?.properties || {};
		return Object.keys(probe).find(k => /(^|_)ac[^a-z0-9]*no/i.test(k)) || null;
	};
	const findAcNameKey = features => {
		const probe = features[0]?.properties || {};
		return (
			Object.keys(probe).find(k => /^ac_?name$/i.test(k)) ||
			Object.keys(probe).find(k => /name/i.test(k)) ||
			null
		);
	};

	window.initDeletionMap = function initDeletionMap(config) {
		const t0 = performance.now();
		console.log("[map] initDeletionMap config:", config);

		const sel = {
			svg: d3.select("#biharMap"),
			legend: d3.select("#mapLegend"),
			status: d3.select("#mapStatus"),
			reason: d3.select("#mapReason"),
			ageWrap: d3.select("#ageGroupWrap"),
			age: d3.select("#mapAgeGroup"),
			metricRadios: d3.selectAll('input[name="metric"]'),
			reset: d3.select("#mapReset"),
			tooltip: d3.select("#mapTooltip"),
		};

		if (sel.svg.empty()) {
			console.error("[map] #biharMap <svg> not found in DOM.");
			return;
		}
		if (sel.legend.empty()) {
			console.warn("[map] #mapLegend not found; legend will not render.");
		}

		const state = {
			metric: "total",
			reason: "All reasons",
			ageGroup: "All age groups",
			data: [],
			hasAge: false,
			features: null,
			acKeyInGeo: null, // number key in topo (optional)
			acNameKeyInGeo: null, // name key in topo (USED FOR JOIN)
			size: { w: 1100, h: 680, margin: 8 },
		};

		// responsive viewBox
		sel.svg
			.attr("viewBox", `0 0 ${state.size.w} ${state.size.h}`)
			.attr("preserveAspectRatio", "xMidYMid meet");

		Promise.all([d3.csv(config.csvUrl, d3.autoType), d3.json(config.geoUrl)])
			.then(([rows, geo]) => {
				console.log("[map] CSV rows:", rows.length, "first row:", rows[0]);
				console.log(
					"[map] Geo type:",
					geo?.type,
					"topo objects:",
					geo?.objects ? Object.keys(geo.objects) : null,
				);

				// Validate CSV headers before proceeding
				const required = [COLS.acName, COLS.total, COLS.reason, COLS.male, COLS.female, COLS.ratio];
				const missing = required.filter(k => !(k in (rows[0] || {})));
				if (missing.length) {
					console.error("[map] Missing columns in CSV:", missing);
					sel.status.text("CSV does not contain expected headers. See console for details.");
					return;
				}

				// Coerce numeric fields; keep names as-is
				state.data = rows.map(r => ({
					...r,
					[COLS.total]: toNum(r[COLS.total]),
					[COLS.male]: toNum(r[COLS.male]),
					[COLS.female]: toNum(r[COLS.female]),
					[COLS.ratio]: +r[COLS.ratio],
				}));

				const ageCol = detectAgeColumn(state.data);
				if (ageCol) {
					COLS.age = ageCol;
					state.hasAge = true;
				}
				console.log("[map] Age column detected:", state.hasAge ? COLS.age : "(none)");

				// Features (Topo or GeoJSON)
				if (!geo) {
					console.error("[map] GeoJSON/TopoJSON not loaded.");
					sel.status.text("Map file not found.");
					return;
				}
				state.features =
					geo.type === "Topology" ? topoToFeatures(geo, config.topoObject) : geo.features;

				if (!state.features || !state.features.length) {
					console.error("[map] No features parsed from map file.");
					sel.status.text("No map features found.");
					return;
				}

				state.acKeyInGeo = findAcNoKey(state.features); // may be null
				state.acNameKeyInGeo = findAcNameKey(state.features); // REQUIRED for name join
				if (!state.acNameKeyInGeo) {
					console.error(
						"[map] Could not detect AC name property in TopoJSON feature properties:",
						state.features[0]?.properties,
					);
					sel.status.text("Could not detect AC name in map file.");
					return;
				}
				console.log(
					"[map] Joining by topo name key:",
					state.acNameKeyInGeo,
					"number key:",
					state.acKeyInGeo,
				);

				buildFilters();
				drawMap();
				wireEvents();
				update();

				console.log("[map] init complete in", Math.round(performance.now() - t0), "ms");
			})
			.catch(err => {
				console.error("Map load error:", err);
				sel.status.text("Map load error. Check data/geo paths (see console).");
			});

		function buildFilters() {
			const reasons = Array.from(
				new Set(state.data.map(d => d[COLS.reason]).filter(Boolean)),
			).sort();
			sel.reason
				.selectAll("option")
				.data(["All reasons", ...reasons])
				.join("option")
				.attr("value", d => d)
				.text(d => d);

			if (state.hasAge) {
				const ages = Array.from(new Set(state.data.map(d => d[COLS.age]).filter(Boolean))).sort();
				d3.select("#ageGroupWrap").style("display", null);
				sel.age
					.selectAll("option")
					.data(["All age groups", ...ages])
					.join("option")
					.attr("value", d => d)
					.text(d => d);
			}
		}

		let gAcs, path, projection;

		function drawMap() {
			projection = d3.geoMercator().fitExtent(
				[
					[state.size.margin, state.size.margin],
					[state.size.w - state.size.margin, state.size.h - 80],
				],
				{ type: "FeatureCollection", features: state.features },
			);
			path = d3.geoPath(projection);

			gAcs = sel.svg.append("g").attr("class", "map-acs");
			gAcs
				.selectAll("path")
				.data(state.features)
				.join("path")
				.attr("d", path)
				.attr("fill", "#f3f4f6")
				.on("mousemove", (event, f) => showTip(event, f))
				.on("mouseleave", hideTip);
		}

		function wireEvents() {
			sel.metricRadios.on("change", e => {
				state.metric = e.target.value;
				update();
			});
			sel.reason.on("change", e => {
				state.reason = e.target.value;
				update();
			});
			sel.age.on("change", e => {
				state.ageGroup = e.target.value;
				update();
			});
			sel.reset.on("click", () => {
				state.metric = "total";
				d3.select('input[name="metric"][value="total"]').property("checked", true);
				state.reason = "All reasons";
				sel.reason.property("value", state.reason);
				if (state.hasAge) {
					state.ageGroup = "All age groups";
					sel.age.property("value", state.ageGroup);
				}
				update();
			});
		}

		function update() {
			// Filter by dropdowns
			const rows = state.data.filter(d => {
				const okR = state.reason === "All reasons" || d[COLS.reason] === state.reason;
				const okA =
					!state.hasAge || state.ageGroup === "All age groups" || d[COLS.age] === state.ageGroup;
				return okR && okA;
			});

			// GROUP BY AC NAME (exact match with topo names)
			const byAc = d3.rollups(
				rows,
				v => ({
					total: d3.sum(v, d => d[COLS.total]),
					male: d3.sum(v, d => d[COLS.male]),
					female: d3.sum(v, d => d[COLS.female]),
					ratio: computeRatio(v),
					name: v[0]?.[COLS.acName],
				}),
				d => (d[COLS.acName] == null ? null : String(d[COLS.acName]).trim()),
			);
			const mapAc = new Map(byAc);

			const values = [];
			for (const f of state.features) {
				const acName = String(f.properties[state.acNameKeyInGeo] ?? "").trim();
				const rec = mapAc.get(acName);
				f.__meta = rec || null;
				f.__val = rec ? (state.metric === "total" ? rec.total : rec.ratio) : null;
				if (Number.isFinite(f.__val)) values.push(f.__val);
			}

			if (!values.length) {
				console.warn("[map] No numeric values for current filters; map will be empty.");
			}

			// Color scales
			let color;
			if (state.metric === "total") {
				// quantile ramp for totals
				color = d3.scaleQuantile().domain(values).range(COLORS_TOTAL);
			} else {
				// fixed thresholds for Female vs Male %
				// bins: (-∞,-10), [-10,-5), [-5,0), [0,5), [5,10), [10,∞)
				color = d3.scaleThreshold().domain([-10, -5, 0, 5, 10]).range(COLORS_RATIO_DIVERGE);
			}

			gAcs
				.selectAll("path")
				.attr("fill", f => (Number.isFinite(f.__val) ? color(f.__val) : "#f3f4f6"));

			if (state.metric === "total") {
				drawLegendContinuous(color, "Total deletions");
			} else {
				drawLegendDiverging(color, "Female vs Male %");
			}

			const parts = [];
			parts.push(state.metric === "total" ? "All deletions" : "Female vs Male %");
			if (state.reason !== "All reasons") parts.push(`• Reason: ${state.reason}`);
			if (state.hasAge && state.ageGroup !== "All age groups")
				parts.push(`• Age: ${state.ageGroup}`);
			sel.status.text(`Showing: ${parts.join(" ")}`);
		}

		function computeRatio(v) {
			const provided = v.every(d => Number.isFinite(d[COLS.ratio]));
			if (provided) {
				const w = d3.sum(v, d => (Number.isFinite(d[COLS.ratio]) ? d[COLS.male] : 0));
				return w > 0
					? d3.sum(v, d => (d[COLS.ratio] || 0) * (d[COLS.male] || 0)) / w
					: d3.mean(v, d => d[COLS.ratio]);
			}
			const m = d3.sum(v, d => d[COLS.male]);
			const f = d3.sum(v, d => d[COLS.female]);
			return m > 0 ? (f / m) * 100 : NaN;
		}

		// -------- Legends --------
		function drawLegendContinuous(color, title) {
			sel.legend.selectAll("*").remove();
			sel.legend.append("div").attr("class", "map-legend-title").text(title);

			const domain = [d3.min(color.domain()), d3.max(color.domain())];

			// grid: [min][swatches flex][max]
			const bar = sel.legend
				.append("div")
				.attr("class", "map-legend-bar")
				.style("display", "grid")
				.style("grid-template-columns", "auto 1fr auto")
				.style("align-items", "center")
				.style("gap", "8px");

			bar
				.append("span")
				.attr("class", "map-legend-min")
				.style("font-size", "14px")
				.text(fmt(domain[0]));

			const sw = bar
				.append("div")
				.attr("class", "map-legend-swatches")
				.style("display", "grid")
				.style("grid-auto-flow", "column")
				.style("grid-auto-columns", "minmax(16px,1fr)")
				.style("gap", "4px");

			color.range().forEach(c => {
				sw.append("div")
					.attr("class", "map-legend-swatch")
					.style("height", "12px")
					.style("background", c)
					.style("border", "1px solid rgba(0,0,0,0.1)");
			});

			bar
				.append("span")
				.attr("class", "map-legend-max")
				.style("font-size", "14px")
				.style("text-align", "right")
				.text(fmt(domain[1]));
		}

		function drawLegendDiverging(color, title) {
			sel.legend.selectAll("*").remove();
			sel.legend.append("div").attr("class", "map-legend-title").text(title);

			// grid: [left label][swatches flex][right label]
			const bar = sel.legend
				.append("div")
				.attr("class", "map-legend-bar")
				.style("display", "grid")
				.style("grid-template-columns", "auto 1fr auto")
				.style("align-items", "center")
				.style("gap", "8px");

			bar
				.append("span")
				.attr("class", "map-legend-min")
				.style("font-size", "14px")
				.text("More male deletions"); // left = reds

			const sw = bar
				.append("div")
				.attr("class", "map-legend-swatches")
				.style("display", "grid")
				.style("grid-auto-flow", "column")
				.style("grid-auto-columns", "minmax(16px,1fr)")
				.style("gap", "4px");

			color.range().forEach(c => {
				sw.append("div")
					.attr("class", "map-legend-swatch")
					.style("height", "12px")
					.style("background", c)
					.style("border", "1px solid rgba(0,0,0,0.1)");
			});

			bar
				.append("span")
				.attr("class", "map-legend-max")
				.style("font-size", "14px")
				.style("text-align", "right")
				.text("More female deletions"); // right = greens
		}

		// -------- Tooltip --------
		function showTip(event, f) {
			const acName = String(f.properties[state.acNameKeyInGeo] ?? "").trim();
			const maybeNo = state.acKeyInGeo ? f.properties[state.acKeyInGeo] : null;
			const nameLine = maybeNo != null ? `${acName} (AC ${maybeNo})` : acName;

			const val = f.__val;
			const male = f.__meta?.male ?? null;
			const female = f.__meta?.female ?? null;

			const line =
				state.metric === "total"
					? `<b>Total deletions:</b> ${fmt(val)}`
					: `<b>Female vs Male %:</b> ${
							isFinite(val) ? (val >= 0 ? "+" : "") + d3.format(".1f")(val) + "%" : "–"
					  }`;
			const mf =
				male != null || female != null
					? `<div>Male: ${fmt(male)} · Female: ${fmt(female)}</div>`
					: "";

			sel.tooltip
				.html(`<div style="font-weight:700;margin-bottom:4px">${nameLine}</div>${line}${mf}`)
				.style("left", event.offsetX + 14 + "px")
				.style("top", event.offsetY + 14 + "px")
				.attr("hidden", null);
		}
		function hideTip() {
			sel.tooltip.attr("hidden", true);
		}
	};
})();

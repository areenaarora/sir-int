/* Bihar AC Deletions Choropleth (D3 v7)
   Works with GeoJSON or TopoJSON.

   Expected HTML IDs:
   - #biharMap (svg), #mapLegend, #mapStatus, #mapReason, #mapAgeGroup (optional),
     inputs[name="metric"] (values: total | ratio), #mapReset, #mapTooltip

   Initialize once (in index.html, after loading this file):
     initDeletionMap({
       csvUrl: "assets/data/data.csv",
       geoUrl: "assets/data/bihar_acs.json",
       topoObject: "bihar_acs"
     });
*/
(function () {
	// Column headers expected in CSV (must match exactly)
	const COLS = {
		acName: "Assembly constituency name",
		acNo: "Assembly constituency number",
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
	const COLORS_RATIO_DIVERGE = ["#006d2c", "#fee5d9", "#fcbba1", "#fc9272", "#fb6a4a", "#cb181d"];
	const fmt = x => (x == null || !isFinite(+x) ? "–" : d3.format(",")(x));
	const toNum = v => (v == null || v === "" ? 0 : +String(v).replace(/,/g, ""));

	const detectAgeColumn = rows => {
		const keys = Object.keys(rows[0] || {});
		return keys.find(k => /age\s*group/i.test(k)) || null;
	};

	// -------- Topo helpers --------
	function topoToFeatures(topo, objName) {
		const name = objName || Object.keys(topo.objects)[0];
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
		if (sel.svg.empty()) return;

		// Defaults; real size set by measureAndResize()
		const state = {
			metric: "total",
			reason: "All reasons",
			ageGroup: "All age groups",
			data: [],
			hasAge: false,
			features: null,
			acKeyInGeo: null,
			acNameKeyInGeo: null,
			size: { w: 1100, h: 680, margin: 8 },
		};

		sel.svg
			.attr("viewBox", `0 0 ${state.size.w} ${state.size.h}`)
			.attr("preserveAspectRatio", "xMidYMid meet");

		const mq = window.matchMedia("(max-width: 768px)");
		let gAcs, path, projection;

		// ---- responsive sizing (also works when map starts hidden)
		function measureAndResize() {
			const parent = sel.svg.node().parentElement;
			let w = parent?.getBoundingClientRect().width || 0;
			const isMobile = mq.matches;

			// give more height + smaller margin on mobile
			const h = isMobile ? Math.round(window.innerHeight * 0.95) : 680;
			state.size.margin = isMobile ? 2 : 8;

			if (w <= 1) w = isMobile ? window.innerWidth : 1100;

			state.size.w = w;
			state.size.h = h;

			sel.svg
				.attr("viewBox", `0 0 ${state.size.w} ${state.size.h}`)
				.attr("preserveAspectRatio", "xMidYMid meet")
				.attr("height", isMobile ? h : null);

			// Refit paths if projection exists
			if (projection && path && state.features) {
				projection.fitExtent(
					[
						[state.size.margin, state.size.margin],
						[state.size.w - state.size.margin, state.size.h - state.size.margin],
					],
					{ type: "FeatureCollection", features: state.features },
				);
				gAcs?.selectAll("path").attr("d", path);
			}
		}
		measureAndResize();

		Promise.all([d3.csv(config.csvUrl, d3.autoType), d3.json(config.geoUrl)])
			.then(([rows, geo]) => {
				// Validate CSV headers
				const required = [COLS.acName, COLS.total, COLS.reason, COLS.male, COLS.female, COLS.ratio];
				const missing = required.filter(k => !(k in (rows[0] || {})));
				if (missing.length) {
					sel.status.text("CSV does not contain expected headers.");
					return;
				}

				// Coerce numerics
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

				// Map features
				state.features =
					geo.type === "Topology" ? topoToFeatures(geo, config.topoObject) : geo.features;
				if (!state.features?.length) {
					sel.status.text("No map features found.");
					return;
				}

				state.acKeyInGeo = findAcNoKey(state.features);
				state.acNameKeyInGeo = findAcNameKey(state.features);
				if (!state.acNameKeyInGeo) {
					sel.status.text("Could not detect AC name in map file.");
					return;
				}

				buildFilters();
				drawMap();
				measureAndResize(); // ensure correct first render
				wireEvents();
				update();
			})
			.catch(() => sel.status.text("Map load error."));

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

		function drawMap() {
			projection = d3.geoMercator().fitExtent(
				[
					[state.size.margin, state.size.margin],
					[state.size.w - state.size.margin, state.size.h - state.size.margin],
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

			window.addEventListener("resize", () => requestAnimationFrame(measureAndResize));
			document
				.getElementById("btnMapView")
				?.addEventListener("click", () => requestAnimationFrame(measureAndResize));
		}

		function update() {
			const rows = state.data.filter(d => {
				const okR = state.reason === "All reasons" || d[COLS.reason] === state.reason;
				const okA =
					!state.hasAge || state.ageGroup === "All age groups" || d[COLS.age] === state.ageGroup;
				return okR && okA;
			});

			// GROUP BY AC NAME
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

			let color;
			if (state.metric === "total") {
				color = d3.scaleQuantile().domain(values).range(COLORS_TOTAL);
			} else {
				const RATIO_BREAKS = [0, 37.3, 44.1, 52.0, 58.8];
				color = d3.scaleThreshold().domain(RATIO_BREAKS).range(COLORS_RATIO_DIVERGE);
			}

			gAcs
				.selectAll("path")
				.attr("fill", f => (Number.isFinite(f.__val) ? color(f.__val) : "#f3f4f6"));

			const parts = [];
			parts.push(state.metric === "total" ? "All deletions" : "Female vs Male %");
			if (state.reason !== "All reasons") parts.push(`• Reason: ${state.reason}`);
			if (state.hasAge && state.ageGroup !== "All age groups")
				parts.push(`• Age: ${state.ageGroup}`);
			sel.status.text(`Showing: ${parts.join(" ")}`);

			if (state.metric === "total") drawLegendContinuous(color, "Total deletions");
			else drawLegendDiverging(color, "Female vs Male %");
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
				.text("More male deletions");
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
				.text("More female deletions");
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

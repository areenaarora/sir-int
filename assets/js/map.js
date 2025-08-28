/* Bihar AC Deletions Choropleth (D3 v7)
   Works with GeoJSON or TopoJSON.
   HTML expected IDs:
   #biharMap (svg), #mapLegend, #mapStatus, #mapReason, #mapAgeGroup (optional),
   inputs[name="metric"] (values: total | ratio), #mapReset, #mapTooltip

   initDeletionMap({
     csvUrl: "data/out.csv",
     geoUrl: "data/bihar_acs.json",
     topoObject: "bihar_acs" // (only for TopoJSON; optional if the first object is correct)
   })
*/
(function () {
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
	const COLORS_RATIO = [
		"#f7fcf5",
		"#e5f5e0",
		"#c7e9c0",
		"#a1d99b",
		"#74c476",
		"#31a354",
		"#006d2c",
	];

	const fmt = x => (x == null || !isFinite(+x) ? "–" : d3.format(",")(x));
	const toNum = v => (v == null || v === "" ? 0 : +String(v).replace(/,/g, ""));

	const detectAgeColumn = rows => {
		const keys = Object.keys(rows[0] || {});
		return keys.find(k => /age\s*group/i.test(k)) || null;
	};

	// FIX #1: allow passing a specific TopoJSON object name
	function topoToFeatures(topo, objName) {
		const name = objName || Object.keys(topo.objects)[0];
		return topojson.feature(topo, topo.objects[name]).features;
	}

	const findAcNoKey = features => {
		const probe = features[0]?.properties || {};
		return Object.keys(probe).find(k => /(^|_)ac[^a-z0-9]*no/i.test(k)) || Object.keys(probe)[0];
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

		const state = {
			metric: "total",
			reason: "All reasons",
			ageGroup: "All age groups",
			data: [],
			hasAge: false,
			features: null,
			acKeyInGeo: null,
			size: { w: 1100, h: 680, margin: 8 },
		};

		// responsive viewBox
		sel.svg
			.attr("viewBox", `0 0 ${state.size.w} ${state.size.h}`)
			.attr("preserveAspectRatio", "xMidYMid meet");

		Promise.all([d3.csv(config.csvUrl, d3.autoType), d3.json(config.geoUrl)])
			.then(([rows, geo]) => {
				state.data = rows.map(r => ({
					...r,
					[COLS.acNo]: +r[COLS.acNo],
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

				// FIX #2: use the specified TopoJSON object if provided
				state.features =
					geo.type === "Topology" ? topoToFeatures(geo, config.topoObject) : geo.features;

				state.acKeyInGeo = findAcNoKey(state.features);

				buildFilters();
				drawMap();
				wireEvents();
				update();
			})
			.catch(err => {
				console.error("Map load error:", err);
				sel.status.text("Map load error. Check data/geo paths.");
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
			const rows = state.data.filter(d => {
				const okR = state.reason === "All reasons" || d[COLS.reason] === state.reason;
				const okA =
					!state.hasAge || state.ageGroup === "All age groups" || d[COLS.age] === state.ageGroup;
				return okR && okA;
			});

			const byAc = d3.rollups(
				rows,
				v => ({
					total: d3.sum(v, d => d[COLS.total]),
					male: d3.sum(v, d => d[COLS.male]),
					female: d3.sum(v, d => d[COLS.female]),
					ratio: computeRatio(v),
					name: v[0]?.[COLS.acName],
				}),
				d => d[COLS.acNo],
			);
			const mapAc = new Map(byAc);

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

			const values = [];
			for (const f of state.features) {
				const ac = +f.properties[state.acKeyInGeo];
				const rec = mapAc.get(ac);
				f.__meta = rec || null;
				f.__val = rec ? (state.metric === "total" ? rec.total : rec.ratio) : null;
				if (Number.isFinite(f.__val)) values.push(f.__val);
			}

			const color =
				state.metric === "total"
					? d3.scaleQuantile().domain(values).range(COLORS_TOTAL)
					: d3.scaleQuantile().domain(values).range(COLORS_RATIO);

			gAcs
				.selectAll("path")
				.attr("fill", f => (Number.isFinite(f.__val) ? color(f.__val) : "#f3f4f6"));

			drawLegend(color, state.metric === "total" ? "Total deletions" : "Female vs Male %");

			const parts = [];
			parts.push(state.metric === "total" ? "All deletions" : "Female vs Male %");
			if (state.reason !== "All reasons") parts.push(`• Reason: ${state.reason}`);
			if (state.hasAge && state.ageGroup !== "All age groups")
				parts.push(`• Age: ${state.ageGroup}`);
			sel.status.text(`Showing: ${parts.join(" ")}`);
		}

		function drawLegend(color, title) {
			sel.legend.selectAll("*").remove();
			sel.legend.append("div").attr("class", "map-legend-title").text(title);

			const steps = sel.legend.append("div").attr("class", "map-legend-steps");
			color
				.range()
				.forEach(c =>
					steps.append("div").attr("class", "map-legend-swatch").style("background", c),
				);

			const domain = [d3.min(color.domain()), d3.max(color.domain())];
			sel.legend
				.append("div")
				.attr("class", "map-legend-labels")
				.selectAll("span")
				.data([fmt(domain[0]), fmt(domain[1])])
				.join("span")
				.text(d => d);
		}

		function showTip(event, f) {
			const acNo = f.properties[state.acKeyInGeo];
			const name = f.__meta?.name ?? f.properties.AC_NAME ?? `AC ${acNo}`;
			const val = f.__val;
			const male = f.__meta?.male ?? null;
			const female = f.__meta?.female ?? null;

			const line =
				state.metric === "total"
					? `<b>Total deletions:</b> ${fmt(val)}`
					: `<b>Female vs Male %:</b> ${isFinite(val) ? d3.format(".1f")(val) + "%" : "–"}`;
			const mf =
				male != null || female != null
					? `<div>Male: ${fmt(male)} · Female: ${fmt(female)}</div>`
					: "";

			sel.tooltip
				.html(
					`<div style="font-weight:700;margin-bottom:4px">${name} (AC ${acNo})</div>${line}${mf}`,
				)
				.style("left", event.offsetX + 14 + "px")
				.style("top", event.offsetY + 14 + "px")
				.attr("hidden", null);
		}
		function hideTip() {
			sel.tooltip.attr("hidden", true);
		}
	};
})();

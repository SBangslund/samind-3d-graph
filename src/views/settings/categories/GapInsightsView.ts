import { ButtonComponent } from "obsidian";
import { AnalysisService } from "src/analysis/AnalysisService";
import { AnalysisCluster } from "src/analysis/AnalysisData";

// Surfaces the AI's "structural gap" findings: pairs of clusters that are
// thematically related but under-linked, with a grounded insight and
// (optionally) a bridging research question - the part of the analysis
// pipeline that had a schema and a generator but no UI to actually see it.
const GapInsightsView = (
	analysisService: AnalysisService,
	onFocusClusters: (clusterIds: string[]) => void,
	containerEl: HTMLElement
) => {
	containerEl.empty();

	if (!analysisService.hasAnalysis()) {
		containerEl.createEl("p", {
			cls: "gap-insights-empty",
			text: "No AI graph analysis found. Run the samind-graph-analysis skill to generate .samind-3d-graph/analysis.json.",
		});
		return;
	}

	const gaps = analysisService.getGaps();
	if (gaps.length === 0) {
		containerEl.createEl("p", {
			cls: "gap-insights-empty",
			text: "No gap insights in the current analysis - re-run the samind-graph-analysis skill to look for some.",
		});
		return;
	}

	const clusterById = new Map<string, AnalysisCluster>(
		analysisService.getClusters().map((c) => [c.id, c])
	);

	const listEl = containerEl.createDiv({ cls: "gap-insights-list" });
	gaps.forEach((gap) => {
		const [idA, idB] = gap.betweenClusters;
		const clusterA = clusterById.get(idA);
		const clusterB = clusterById.get(idB);
		if (!clusterA || !clusterB) return;

		const cardEl = listEl.createDiv({ cls: "gap-insight-card" });

		const headerEl = cardEl.createDiv({ cls: "gap-insight-header" });
		[clusterA, clusterB].forEach((cluster, index) => {
			const badge = headerEl.createSpan({ cls: "gap-insight-cluster-badge" });
			badge.createSpan({ cls: "gap-insight-swatch" }).setCssStyles({ backgroundColor: cluster.color });
			badge.createSpan({ text: cluster.label });
			if (index === 0) headerEl.createSpan({ cls: "gap-insight-arrow", text: "↔" });
		});

		cardEl.createEl("p", { cls: "gap-insight-text", text: gap.insight });

		if (gap.suggestedQuestion) {
			cardEl.createEl("p", {
				cls: "gap-insight-question",
				text: `❓ ${gap.suggestedQuestion}`,
			});
		}

		new ButtonComponent(cardEl)
			.setButtonText("Show in graph")
			.setClass("gap-insight-show-button")
			.onClick(() => onFocusClusters([idA, idB]));
	});
};

export default GapInsightsView;

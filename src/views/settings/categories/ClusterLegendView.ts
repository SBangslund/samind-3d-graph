import { AnalysisService } from "src/analysis/AnalysisService";

// Read-only "legend" panel: what each AI-assigned cluster color means,
// how many notes are in it, and when the analysis was generated.
const ClusterLegendView = (
	analysisService: AnalysisService,
	containerEl: HTMLElement
) => {
	containerEl.empty();

	if (!analysisService.hasAnalysis()) {
		containerEl.createEl("p", {
			cls: "cluster-legend-empty",
			text: "No AI graph analysis found. Run the samind-graph-analysis skill to generate .samind-3d-graph/analysis.json.",
		});
		return;
	}

	const counts = analysisService.getClusterNoteCounts();
	const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
	const clusters = [...analysisService.getClusters()].sort(
		(a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0)
	);

	const listEl = containerEl.createDiv({ cls: "cluster-legend-list" });
	clusters.forEach((cluster) => {
		const count = counts[cluster.id] ?? 0;
		const percent = Math.round((count / total) * 100);
		const itemEl = listEl.createDiv({ cls: "cluster-legend-item" });
		const swatch = itemEl.createSpan({ cls: "cluster-legend-swatch" });
		swatch.setCssStyles({ backgroundColor: cluster.color });
		itemEl.createSpan({ cls: "cluster-legend-label", text: cluster.label });
		itemEl.createSpan({
			cls: "cluster-legend-count",
			text: `${count} (${percent}%)`,
		});
	});

	const generatedAt = analysisService.getGeneratedAt();
	if (generatedAt) {
		containerEl.createEl("p", {
			cls: "cluster-legend-generated",
			text: `Generated ${new Date(generatedAt).toLocaleString()}`,
		});
	}
};

export default ClusterLegendView;

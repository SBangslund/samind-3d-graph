import Graph3dPlugin from "src/main";
import EventBus from "src/util/EventBus";
import { AnalysisSetupModal } from "../modals/AnalysisSetupModal";

// A new user with no .samind-3d-graph/analysis.json yet would otherwise see
// a plain, unclustered graph with zero indication that AI clustering is even
// a feature - the only "no analysis found" messages live inside two panels
// that are both collapsed behind the settings gear. This puts the same nudge
// somewhere it's actually seen, and gets out of the way (dismiss, or once
// analysis exists) once it's served its purpose.
export function AnalysisBanner(
	plugin: Graph3dPlugin,
	containerEl: HTMLElement
): () => void {
	let dismissed = false;
	let bannerEl: HTMLElement | null = null;

	const render = () => {
		const shouldShow = !dismissed && !plugin.analysisService.hasAnalysis();
		if (!shouldShow) {
			bannerEl?.remove();
			bannerEl = null;
			return;
		}
		if (bannerEl) return; // already showing

		bannerEl = containerEl.createDiv({ cls: "samind-analysis-banner" });
		bannerEl.createSpan({
			cls: "samind-analysis-banner-text",
			text: "No AI clustering yet for this vault.",
		});

		bannerEl
			.createEl("button", {
				cls: "samind-analysis-banner-button mod-cta",
				text: "Set up",
			})
			.addEventListener("click", () => {
				new AnalysisSetupModal(plugin.app, plugin).open();
			});

		bannerEl
			.createEl("button", { cls: "samind-analysis-banner-button", text: "Reload" })
			.addEventListener("click", () => {
				void plugin.reloadAnalysis();
			});

		bannerEl
			.createEl("button", {
				cls: "samind-analysis-banner-dismiss",
				text: "×",
				attr: { "aria-label": "Dismiss" },
			})
			.addEventListener("click", () => {
				dismissed = true;
				render();
			});
	};

	render();
	const unsubscribe = EventBus.on("graph-changed", render);

	return () => {
		EventBus.offref(unsubscribe);
		bannerEl?.remove();
	};
}

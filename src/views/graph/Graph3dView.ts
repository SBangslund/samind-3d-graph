import { ItemView, WorkspaceLeaf } from "obsidian";
import Node from "../../graph/Node";
import { ForceGraph } from "./ForceGraph";
import { GraphSettingsView } from "../settings/GraphSettingsView";
import { AnalysisBanner } from "./AnalysisBanner";
import Graph3dPlugin from "src/main";

export class Graph3dView extends ItemView {
	private forceGraph: ForceGraph;
	private readonly isLocalGraph: boolean;
	private readonly plugin: Graph3dPlugin;
	private unsubscribeAnalysisBanner: (() => void) | null = null;

	constructor(
		plugin: Graph3dPlugin,
		leaf: WorkspaceLeaf,
		isLocalGraph = false
	) {
		super(leaf);
		this.isLocalGraph = isLocalGraph;
		this.plugin = plugin;
	}

	onunload() {
		super.onunload();
		this.forceGraph?.destroy();
		this.forceGraph?.getInstance()._destructor();
		this.unsubscribeAnalysisBanner?.();
	}

	public getForceGraph(): ForceGraph {
		return this.forceGraph;
	}

	public showSnippets(entries: import('../graph/services/SnippetOverlayService').SnippetEntry[]): void {
		this.forceGraph?.mcpShowSnippets(entries);
	}

	showGraph() {
		const viewContent = this.containerEl.querySelector(
			".view-content"
		) as HTMLElement;

		if (viewContent) {
			viewContent.classList.add("graph-3d-view");
			this.appendGraph(viewContent);
			const settings = new GraphSettingsView(
				this.plugin.settingsState,
				this.plugin.theme,
				this.plugin.analysisService,
				(clusterIds) => this.forceGraph.focusOnClusters(clusterIds)
			);
			viewContent.appendChild(settings);
			this.unsubscribeAnalysisBanner = AnalysisBanner(this.plugin, viewContent);
			// the pane's layout isn't finalized yet at this point (it was just
			// shown/resized), so the initial width/height read by ForceGraph
			// can be stale/tiny; re-measure once the browser has laid it out.
			window.requestAnimationFrame(() => this.forceGraph.updateDimensions());
		} else {
			console.error("Could not find view content");
		}
	}

	getDisplayText(): string {
		return "3D-Graph";
	}

	getViewType(): string {
		return "3d_graph_view";
	}

	onResize() {
		super.onResize();
		this.forceGraph.updateDimensions();
	}

	private appendGraph(viewContent: HTMLElement) {
		this.forceGraph = new ForceGraph(
			this.plugin,
			viewContent,
			this.isLocalGraph
		);

		this.forceGraph
			.getInstance()
			.onNodeClick((node: Node, mouseEvent: MouseEvent) => {
				const clickedNodeFile = this.app.vault.getFileByPath(node.path);
				if (!clickedNodeFile) return;

				// Ctrl/Cmd + click → hover preview instead of opening the file
				if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
					this.app.workspace.trigger('hover-link', {
						event: mouseEvent,
						source: 'samind-graph-snippets',
						hoverParent: { hoverPopover: null },
						targetEl: mouseEvent.target as HTMLElement,
						linktext: node.path,
						sourcePath: node.path,
					});
					return;
				}

				if (this.isLocalGraph) {
					void this.app.workspace.getLeaf(false).openFile(clickedNodeFile);
				} else {
					void this.app.workspace.getLeaf().openFile(clickedNodeFile);
				}
			});
	}
}

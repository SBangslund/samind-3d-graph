import ForceGraph3D, { ForceGraph3DInstance } from "3d-force-graph";
import Graph3dPlugin from "../../main";
import Graph from "../../graph/Graph";
import { rgba } from "polished";
import EventBus from "../../util/EventBus";
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Renderer } from "three";

import { HighlightService } from "./services/HighlightService"
import { LinkService } from "./services/LinkService"
import { NodeService } from "./services/NodeService"
import { SettingsService } from "./services/SettingsService"
import { ClusterBoundaryService } from "./services/ClusterBoundaryService"

// Adapted from https://github.com/vasturiano/3d-force-graph/blob/master/example/highlight/index.html
// D3.js 3D Force Graph

export class ForceGraph {
	private instance: ForceGraph3DInstance;
	private readonly rootHtmlElement: HTMLElement;

	private readonly isLocalGraph: boolean;
	private readonly plugin: Graph3dPlugin;
	private graph: Graph;

	private highlightService: HighlightService;
	private linkService: LinkService;
	private nodeService: NodeService;
	private settingsService: SettingsService;
	private clusterBoundaryService: ClusterBoundaryService;

	constructor(
		plugin: Graph3dPlugin,
		rootHtmlElement: HTMLElement,
		isLocalGraph: boolean
	) {
		this.rootHtmlElement = rootHtmlElement;
		this.isLocalGraph = isLocalGraph;
		this.plugin = plugin;

		this.initGraph();
		this.initListeners();
	}

	private initGraph() {
		this.initInstance();
		this.initServices();
		this.nodeService.init();
		this.linkService.init();
		this.clusterBoundaryService.init();

		// TODO: Add check for change sin search bar. This should then be reflected onto the graph.
		/*setInterval(() => {
			let test = document.getElementsByClassName('search-info-container')[0];
			console.log(((test as HTMLElement).children[0] as HTMLElement)?.outerText);
		}, 1000)*/
	}

	private initListeners() {
		this.plugin.settingsState.onChange((data) => {
			// toggling orphan visibility changes the node set itself, so we
			// need a full graphData reload (removes/adds nodes from the
			// simulation) rather than a cheap .refresh() which only re-runs
			// visual callbacks on the existing node set
			if (data.currentPath === 'filters.doShowOrphans') {
				this.refreshGraphData();
			} else if (data.currentPath === 'display.clusterShape') {
				this.clusterBoundaryService.triggerRebuild();
			} else {
				this.settingsService.onSettingsStateChanged(data);
			}
		});
		if (this.isLocalGraph)
			this.plugin.openFileState.onChange(this.refreshGraphData);
		EventBus.on("graph-changed", this.refreshGraphData);
	}

	private initServices(): void {
		this.highlightService = new HighlightService(this.instance, this.plugin);
		this.linkService = new LinkService(this.instance, this.plugin, this.highlightService);
		this.clusterBoundaryService = new ClusterBoundaryService(this.instance, this.plugin, this.graph);
		this.nodeService = new NodeService(this.instance, this.plugin, this.highlightService, this.graph, this.clusterBoundaryService);
		this.settingsService = new SettingsService(this.instance, this.plugin);
	}

	private initInstance() {
		const [width, height] = [
			this.rootHtmlElement.innerWidth,
			this.rootHtmlElement.innerHeight,
		];
		// CSS2DRenderer's domElement is a <div>, not a <canvas>, so it can't satisfy
		// three's Renderer type exactly; this is a known gap in the type definitions.
		this.instance = ForceGraph3D({ extraRenderers: [new CSS2DRenderer as unknown as Renderer] })(this.rootHtmlElement)
			.graphData(this.getGraphData())
			.nodeRelSize(this.plugin.getSettings().display.nodeSize)
			.backgroundColor(rgba(0, 0, 0, 0.25))
			.width(width)
			.height(height);
	}

	private refreshGraphData = () => {
		this.instance.graphData(this.getGraphData());
		this.nodeService.updateGraph(this.graph);
		this.clusterBoundaryService.updateGraph(this.graph);
	};

	public updateDimensions() {
		const [width, height] = [
			this.rootHtmlElement.offsetWidth,
			this.rootHtmlElement.offsetHeight,
		];
		this.instance.width(width);
		this.instance.height(height);
	}


	private getGraphData(): Graph {
		if (this.isLocalGraph && this.plugin.openFileState.value) {
			this.graph = this.plugin.globalGraph
				.clone()
				.getLocalGraph(this.plugin.openFileState.value);
		} else {
			this.graph = this.plugin.globalGraph.clone();
		}

		if (!this.plugin.getSettings().filters.doShowOrphans) {
			this.graph = this.graph.withoutOrphans();
		}

		return this.graph;
	};

	getInstance(): ForceGraph3DInstance {
		return this.instance;
	}

	public focusOnClusters(clusterIds: string[]): void {
		this.clusterBoundaryService?.focusOnClusters(clusterIds);
		this.nodeService?.pinClusters(clusterIds);
	}

	public destroy(): void {
		this.nodeService?.destroy();
		this.clusterBoundaryService?.destroy();
	}
}

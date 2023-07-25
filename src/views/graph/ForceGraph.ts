import ForceGraph3D, { ForceGraph3DInstance } from "3d-force-graph";
import Graph3dPlugin from "../../main";
import Graph from "../../graph/Graph";
import { rgba } from "polished";
import EventBus from "../../util/EventBus";
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import { HighlightService } from "../graph/controllers/HighlightService"
import { LinkService } from "../graph/controllers/LinkService"
import { NodeService } from "../graph/controllers/NodeService"
import { SettingsService } from "../graph/controllers/SettingsService"

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

		// TODO: Add check for change sin search bar. This should then be reflected onto the graph.
		/*setInterval(() => {
			let test = document.getElementsByClassName('search-info-container')[0];
			console.log(((test as HTMLElement).children[0] as HTMLElement)?.outerText);
		}, 1000)*/
	}

	private initListeners() {
		this.plugin.settingsState.onChange((data) => this.settingsService.onSettingsStateChanged(data));
		if (this.isLocalGraph)
			this.plugin.openFileState.onChange(this.refreshGraphData);
		EventBus.on("graph-changed", this.refreshGraphData);
	}

	private initServices(): void {
		this.highlightService = new HighlightService(this.instance, this.plugin);
		this.linkService = new LinkService(this.instance, this.plugin, this.highlightService);
		this.nodeService = new NodeService(this.instance, this.plugin, this.highlightService, this.graph);
		this.settingsService = new SettingsService(this.instance, this.plugin);
	}

	private initInstance() {
		const [width, height] = [
			this.rootHtmlElement.innerWidth,
			this.rootHtmlElement.innerHeight,
		];
		this.instance = ForceGraph3D({ extraRenderers: [new CSS2DRenderer] })(this.rootHtmlElement)
			.graphData(this.getGraphData())
			.nodeRelSize(this.plugin.getSettings().display.nodeSize / 2)
			.backgroundColor(rgba(0, 0, 0, 0.25))
			.width(width)
			.height(height);
	}

	private refreshGraphData() {
		this.instance.graphData(this.getGraphData());
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

		return this.graph;
	};

	getInstance(): ForceGraph3DInstance {
		return this.instance;
	}
}

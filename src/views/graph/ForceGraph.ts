import ForceGraph3D, { ForceGraph3DInstance } from "3d-force-graph";
import Node from "../../graph/Node";
import Link from "../../graph/Link";
import { StateChange } from "../../util/State";
import Graph3dPlugin from "../../main";
import Graph from "../../graph/Graph";
import { NodeGroup } from "../../settings/categories/GroupSettings";
import { rgba } from "polished";
import EventBus from "../../util/EventBus";
import * as three from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

// Adapted from https://github.com/vasturiano/3d-force-graph/blob/master/example/highlight/index.html
// D3.js 3D Force Graph

export class ForceGraph {
	private instance: ForceGraph3DInstance;
	private readonly rootHtmlElement: HTMLElement;

	private readonly highlightedNodes: Set<string> = new Set();
	private readonly highlightedLinks: Set<Link> = new Set();
	hoveredNode: Node | null;

	private readonly isLocalGraph: boolean;
	private graph: Graph;
	private readonly plugin: Graph3dPlugin;

	constructor(
		plugin: Graph3dPlugin,
		rootHtmlElement: HTMLElement,
		isLocalGraph: boolean
	) {
		this.rootHtmlElement = rootHtmlElement;
		this.isLocalGraph = isLocalGraph;
		this.plugin = plugin;

		console.log("ForceGraph constructor", rootHtmlElement);

		this.createGraph();
		this.initListeners();
	}

	private initListeners() {
		this.plugin.settingsState.onChange(this.onSettingsStateChanged);
		if (this.isLocalGraph)
			this.plugin.openFileState.onChange(this.refreshGraphData);
		EventBus.on("graph-changed", this.refreshGraphData);
	}

	private createGraph() {
		this.createInstance();
		this.createNodes();
		this.createLinks();
	}

	private createInstance() {
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

	private createNodes = () => {
		this.instance
			.nodeColor((node: Node) => this.getNodeColor(node))
			.nodeVisibility((node: Node) => this.doShowNode(node))
			.nodeThreeObject((node: Node) => this.createNodeThreeObject(node))
			.nodeThreeObjectExtend(true)
			.onNodeHover(this.onNodeHover);
	};

	private createLinks = () => {
		this.instance
			.linkColor((link: Link) => this.getLinkColor(link))
			.linkDirectionalArrowLength(3.5)
			.linkDirectionalArrowRelPos(1)
			.linkWidth((link: Link) =>
				this.plugin.getSettings().display.linkThickness
			)
			.linkDirectionalParticles((link: Link) =>
				this.plugin.getSettings().display.particleCount
			)
			.linkDirectionalParticleWidth(
				this.plugin.getSettings().display.particleSize
			)
			.linkDirectionalParticleSpeed(0.006);
	};

	private createNodeThreeObject(node: Node): CSS2DObject {
		const nodeEl = document.createElement('div');
		const match = node.id.match(/\/([^\/]+)\.(md|png)$/);
		if (match) {
			nodeEl.textContent = match[1];
		} else {
			nodeEl.textContent = node.id;
		}
		nodeEl.style.color = this.hoveredNode === node ? this.plugin.theme.textAccent : 'white';
		nodeEl.style.fontWeight = this.hoveredNode === node ? '700' : '400';
		nodeEl.style.opacity = this.isHighlightedNode(node) ? '1' : '0.15';
		nodeEl.style.fontSize = this.isHighlightedNode(node) ? '.75rem' : '0.45rem';
		nodeEl.style.marginTop = '-.75rem';
		nodeEl.className = 'node-label';
		return new CSS2DObject(nodeEl);
	}

	private updateHighlight() {
		// trigger update of highlighted objects in scene
		this.instance
			.nodeColor(this.instance.nodeColor())
			.nodeThreeObject((node: Node) => this.createNodeThreeObject(node))
			.linkColor(this.instance.linkColor())
			.linkDirectionalParticles(this.instance.linkDirectionalParticles());
	}

	private clearHighlights = () => {
		this.highlightedNodes.clear();
		this.highlightedLinks.clear();
	};

	private refreshGraphData = () => {
		this.instance.graphData(this.getGraphData());
	};


	private doShowNode(node: Node): boolean {
		return this.plugin.getSettings().filters.doShowOrphans || node.links.length > 0;
	};

	private doHideNode(node: Node): number {
		return this.highlightedNodes.size > 0 && this.highlightedNodes.has(node.id) ? 1 : 0.25;
	}

	public updateDimensions() {
		const [width, height] = [
			this.rootHtmlElement.offsetWidth,
			this.rootHtmlElement.offsetHeight,
		];
		this.setDimensions(width, height);
	}

	public setDimensions(width: number, height: number) {
		this.instance.width(width);
		this.instance.height(height);
	}

	private onSettingsStateChanged = (data: StateChange) => {
		if (data.currentPath === "display.nodeSize") {
			this.instance.nodeRelSize(data.newValue);
		} else if (data.currentPath === "display.linkWidth") {
			this.instance.linkWidth(data.newValue);
		} else if (data.currentPath === "display.particleSize") {
			this.instance.linkDirectionalParticleWidth(
				this.plugin.getSettings().display.particleSize
			);
		}

		this.instance.refresh(); // other settings only need a refresh
	};

	private onNodeHover = (node: Node | null) => {
		if (
			(!node && !this.highlightedNodes.size) ||
			(node && this.hoveredNode === node)
		)
			return;
		(document.getElementsByClassName('scene-tooltip')[0] as HTMLElement).style.display = 'none';

		this.clearHighlights();

		if (node) {
			this.highlightedNodes.add(node.id);
			node.neighbors.forEach((neighbor) =>
				this.highlightedNodes.add(neighbor.id)
			);
			const nodeLinks = this.graph.getLinksWithNode(node.id);

			if (nodeLinks)
				nodeLinks.forEach((link) => this.highlightedLinks.add(link));
		}
		this.hoveredNode = node ?? null;
		this.updateHighlight();
	};

	private onLinkHover = (link: Link | null) => {
		this.clearHighlights();

		if (link) {
			this.highlightedLinks.add(link);
			this.highlightedNodes.add(link.source);
			this.highlightedNodes.add(link.target);
		}
		this.updateHighlight();
	};

	private isHighlightedLink = (link: Link): boolean => {
		return this.highlightedLinks.has(link);
	};

	private isHighlightedNode = (node: Node): boolean => {
		return this.highlightedNodes.has(node.id);
	};

	private getGraphData = (): Graph => {
		if (this.isLocalGraph && this.plugin.openFileState.value) {
			this.graph = this.plugin.globalGraph
				.clone()
				.getLocalGraph(this.plugin.openFileState.value);
			console.log(this.graph);
		} else {
			this.graph = this.plugin.globalGraph.clone();
		}

		return this.graph;
	};

	private getNodeColor(node: Node): string {
		let color = this.plugin.theme.textMuted;
		this.plugin.getSettings().groups.groups.forEach((group) => {
			// multiple groups -> last match wins
			if (NodeGroup.matches(group.query, node)) color = group.color;
		});
		if (this.highlightedNodes.size > 0 && !this.highlightedNodes.has(node.id)) {
			const matchRgb = color.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
			if (matchRgb) {
				return `rgba(${matchRgb[1]},${matchRgb[2]},${matchRgb[3]}, 0.25)`;
			}
			const matchHex = color.match(/#?([a-fA-F\d]{2})([a-fA-F\d]{2})([a-fA-F\d]{2})/);
			if (matchHex) {
				const red = parseInt(matchHex[1], 16);
				const green = parseInt(matchHex[2], 16);
				const blue = parseInt(matchHex[3], 16);
				return `rgba(${red},${green},${blue}, 0.25)`;
			}
		}
		return color;
	};

	private getLinkColor(link: Link): string {
		let color = this.plugin.theme.textAccent;
		return this.isHighlightedLink(link)
			? this.plugin.theme.textAccent
			: this.plugin.theme.textMuted
	}

	getInstance(): ForceGraph3DInstance {
		return this.instance;
	}
}

import { ForceGraph3DInstance } from "3d-force-graph";
import { AbstractGraphService } from "./AbstractGraphService";
import Graph3dPlugin from "src/main";
import { HighlightService } from "./HighlightService";
import { NodeGroup } from "src/settings/categories/GroupSettings";
import Node from "src/graph/Node";
import Link from "src/graph/Link";
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export class NodeService extends AbstractGraphService {

    private hoveredNode: Node | null = null;

    constructor(
        instance: ForceGraph3DInstance,
        plugin: Graph3dPlugin,
        private highlightService: HighlightService) {
        super(instance, plugin);
    }

    public init(): void {
        this.instance
            .nodeColor((node: Node) => this.getNodeColor(node))
            .nodeVisibility((node: Node) => this.isNodeVisible(node))
            .nodeThreeObject((node: Node) => this.createNodeThreeObject(node))
            .nodeThreeObjectExtend(true)
            .onNodeHover((node: Node) => this.onNodeHover(node));
    }

    private createNodeThreeObject(node: Node): CSS2DObject {
        const nodeEl = document.createElement('div');
        const match = node.id.match(/\/([^\/]+)\.(md|png)$/);
        if (match) {
            nodeEl.textContent = match[1];
        } else {
            nodeEl.textContent = node.id;
        }
        if (this.highlightService.getParentSize() > 0 && this.highlightService.isParent(node)) {
            let index = this.highlightService.parentIndex(node);
            let opacity = 0.75 - (index * 10) / 100;
            nodeEl.style.color = 'orange';
            nodeEl.style.fontWeight = '500';
            nodeEl.style.opacity = (opacity < 0.25 ? 0.25 : opacity) + '';
            nodeEl.style.fontSize = '0.65rem';
            if (node.id.contains('Samind.md')) {
                nodeEl.style.fontWeight = '800';
                nodeEl.style.color = 'orange';
                nodeEl.style.opacity = '1';
                nodeEl.style.fontSize = '.85rem';
            }
            nodeEl.style.zIndex = '100';
        } else {
            nodeEl.style.color = this.hoveredNode === node ? this.plugin.theme.textAccent : 'white';
            nodeEl.style.fontWeight = this.hoveredNode === node ? '700' : '400';
            nodeEl.style.opacity = this.highlightService.getNodeSize() > 0
                ? (this.highlightService.hasNode(node)
                    ? '1'
                    : '0.05')
                : '.15';
            nodeEl.style.fontSize = this.highlightService.hasNode(node) ? '.75rem' : '0.45rem';
        }

        nodeEl.style.marginTop = '-.75rem';
        nodeEl.className = 'node-label';
        return new CSS2DObject(nodeEl);
    }

    private update(): void {
        this.highlightService.update();
        this.instance.nodeThreeObject((node: Node) => this.createNodeThreeObject(node))
    }

    private onNodeHover(node: Node | null) {
        if (
            (!node && !this.highlightService.getNodeSize()) ||
            (node && this.hoveredNode === node)
        )
            return;
        (document.getElementsByClassName('scene-tooltip')[0] as HTMLElement).style.display = 'none';

        this.highlightService.clear();

        if (node) {
            this.highlightService.addNode(node);
            node.neighbors.forEach((neighbor) => this.highlightService.addNode(neighbor));

            this.checkRelations(node.id);
        }
        this.hoveredNode = node ?? null;
        this.update();
    };

    private checkRelations(id: string, recursive = false): void {
        const nodeLinks = this.plugin.globalGraph.clone().getLinksWithNode(id);

        if (nodeLinks) {
            nodeLinks.forEach((link: Link) => {
                if (!recursive) {
                    this.highlightService.addLink(link);
                }
                if (link.source !== id) {
                    if (recursive) {
                        this.highlightService.addLink(link);
                    }
                    this.highlightService.addParent(link.source);
                    this.checkRelations(link.source, true);
                }
            });
        }
    }

    private isNodeVisible(node: Node): boolean {
        return this.plugin.getSettings().filters.doShowOrphans || node.links.length > 0;
    };

    private getNodeColor(node: Node): string {
        let color = this.plugin.theme.textMuted;
        this.plugin.getSettings().groups.groups.forEach((group) => {
            // multiple groups -> last match wins
            if (NodeGroup.matches(group.query, node)) color = group.color;
        });
        if (this.highlightService.getParentSize() > 0 && this.highlightService.isParent(node)) {
            return color;
        }
        if (this.highlightService.getNodeSize() > 0 && !this.highlightService.hasNode(node)) {
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
}
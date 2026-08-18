import { ForceGraph3DInstance } from "3d-force-graph";
import { AbstractGraphService } from "./AbstractGraphService";
import Graph3dPlugin from "src/main";
import { HighlightService } from "./HighlightService";
import { NodeGroup } from "src/settings/categories/GroupSettings";
import Node from "src/graph/Node";
import Link from "src/graph/Link";
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EventRef, WorkspaceLeaf } from "obsidian";
import Graph from "src/graph/Graph";

// how close (screen px) the mouse needs to be to a label to boost its legibility
const MOUSE_PROXIMITY_RADIUS_PX = 220;

const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

export class NodeService extends AbstractGraphService {

    private hoveredNode: Node | null = null;
    private inspecting: boolean;

    // idle-state labels, kept in sync so the visibility loop can update them
    // in place instead of recreating DOM nodes every frame
    private readonly labelElements: Map<string, HTMLDivElement> = new Map();
    private mouseScreenPos: { x: number; y: number } | null = null;
    private baselineCameraDistance: number | null = null;
    private animationFrameId: number | null = null;
    private readonly onMouseMove = (event: MouseEvent) => {
        const rect = this.instance.renderer().domElement.getBoundingClientRect();
        this.mouseScreenPos = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    private readonly onMouseLeave = () => {
        this.mouseScreenPos = null;
    };
    private activeLeafChangeRef: EventRef;

    constructor(
        instance: ForceGraph3DInstance,
        plugin: Graph3dPlugin,
        private highlightService: HighlightService,
        private graph: Graph) {
        super(instance, plugin);
    }

    public init(): void {
        this.activeLeafChangeRef = this.plugin.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf) => {
            let id = this.plugin.app.workspace.getActiveFile()?.path;
            if (id) {
                let node = this.graph.getNodeById(id);
                this.inspectNode(node);
            }
        });
        this.instance
            .nodeColor((node: Node) => this.getNodeColor(node))
            .nodeVal((node: Node) => this.getNodeVal(node))
            .nodeOpacity(.85)
            .nodeVisibility((node: Node) => this.isNodeVisible(node))
            .nodeThreeObject((node: Node) => this.createNodeThreeObject(node))
            .nodeThreeObjectExtend(true)
            .onBackgroundRightClick(() => this.onRemove())
            .onNodeRightClick((node: Node) => this.onNodeRightClick(node))
            .onNodeHover((node: Node) => this.onNodeHover(node));

        // pull same-cluster notes toward each other so the AI clustering is
        // spatially visible, not just color - otherwise cluster members can
        // land anywhere in the layout since physics only follows real links.
        // Registering the force here (before three-forcegraph's own deferred
        // digest runs) is enough for it to pick it up naturally - do NOT
        // also call d3ReheatSimulation() here: it force-sets engineRunning
        // true synchronously, racing ahead of that digest, which is what
        // actually assigns state.layout - tickFrame can then run with
        // engineRunning true but state.layout still undefined and crash.
        this.instance.d3Force('cluster', this.createClusterForce() as never);

        const rendererEl = this.instance.renderer().domElement;
        rendererEl.addEventListener('mousemove', this.onMouseMove);
        rendererEl.addEventListener('mouseleave', this.onMouseLeave);
        this.animationFrameId = requestAnimationFrame(this.updateLabelVisibility);
    }

    // A custom d3-force: each tick, computes the current centroid of every
    // AI cluster's member nodes and nudges each member's velocity toward it.
    // Strength scales with alpha like every other d3 force, so it eases in
    // during warmup/reheat and fades out as the simulation settles, instead
    // of fighting the link/charge forces indefinitely.
    private createClusterForce() {
        const CLUSTER_FORCE_STRENGTH = 0.7;
        let nodesRef: Node[] = [];

        type RuntimeNode = Node & {
            x?: number; y?: number; z?: number;
            vx?: number; vy?: number; vz?: number;
        };

        const force = (alpha: number) => {
            const centroids = new Map<string, { x: number; y: number; z: number; count: number }>();

            nodesRef.forEach((n) => {
                const rn = n as RuntimeNode;
                if (rn.x === undefined || rn.y === undefined || rn.z === undefined) return;
                const clusterId = this.plugin.analysisService.getClusterId(n.id);
                if (!clusterId) return;
                let c = centroids.get(clusterId);
                if (!c) {
                    c = { x: 0, y: 0, z: 0, count: 0 };
                    centroids.set(clusterId, c);
                }
                c.x += rn.x; c.y += rn.y; c.z += rn.z; c.count++;
            });
            centroids.forEach((c) => {
                c.x /= c.count; c.y /= c.count; c.z /= c.count;
            });

            nodesRef.forEach((n) => {
                const rn = n as RuntimeNode;
                if (rn.x === undefined || rn.y === undefined || rn.z === undefined) return;
                const clusterId = this.plugin.analysisService.getClusterId(n.id);
                if (!clusterId) return;
                const centroid = centroids.get(clusterId);
                if (!centroid) return;
                rn.vx = (rn.vx ?? 0) + (centroid.x - rn.x) * CLUSTER_FORCE_STRENGTH * alpha;
                rn.vy = (rn.vy ?? 0) + (centroid.y - rn.y) * CLUSTER_FORCE_STRENGTH * alpha;
                rn.vz = (rn.vz ?? 0) + (centroid.z - rn.z) * CLUSTER_FORCE_STRENGTH * alpha;
            });
        };
        (force as unknown as { initialize: (nodes: Node[]) => void }).initialize = (nodes: Node[]) => {
            nodesRef = nodes;
        };
        return force;
    }

    public destroy(): void {
        if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
        const rendererEl = this.instance.renderer().domElement;
        rendererEl.removeEventListener('mousemove', this.onMouseMove);
        rendererEl.removeEventListener('mouseleave', this.onMouseLeave);
        if (this.activeLeafChangeRef) this.plugin.app.workspace.offref(this.activeLeafChangeRef);
        this.labelElements.clear();
    }

    // Continuously blends camera distance, on-screen proximity to the mouse,
    // and note importance into each idle label's opacity/size, so overlapping
    // labels declutter themselves: distant/unimportant notes fade and shrink,
    // while nearby-to-camera, nearby-to-mouse, or high-importance notes stay legible.
    private updateLabelVisibility = (): void => {
        const camera = this.instance.camera();
        const camPos = camera.position;

        if (this.baselineCameraDistance === null) {
            this.baselineCameraDistance = camPos.length() || 400;
        }
        const near = this.baselineCameraDistance * 0.4;
        const far = this.baselineCameraDistance * 1.8;

        // global cap that shrinks/fades ALL labels together as the camera zooms
        // out, regardless of importance - otherwise a handful of "important"
        // labels can stay large enough to bury the graph shape entirely once
        // zoomed out far. Importance/mouse proximity only compete for space
        // within this budget, they can't exceed it.
        const overallCamDist = camPos.length();
        const zoomOutStart = this.baselineCameraDistance * 1.1;
        const zoomOutEnd = this.baselineCameraDistance * 2.8;
        const zoomCap = clamp(1 - (overallCamDist - zoomOutStart) / (zoomOutEnd - zoomOutStart), 0.12, 1);

        this.labelElements.forEach((el, nodeId) => {
            const node = this.graph.getNodeById(nodeId);
            if (!node) {
                this.labelElements.delete(nodeId);
                return;
            }
            // don't fight the deliberate hover/inspect highlight styling
            if (this.highlightService.getParentSize() > 0 && this.highlightService.isParent(node)) return;
            if (this.highlightService.getNodeSize() > 0) return;

            const runtimeNode = node as unknown as { x?: number; y?: number; z?: number };
            const { x, y, z } = runtimeNode;
            if (x === undefined || y === undefined || z === undefined) return;

            const dx = camPos.x - x, dy = camPos.y - y, dz = camPos.z - z;
            const camDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const camFactor = clamp(1 - (camDist - near) / (far - near), 0, 1);

            let mouseFactor = 0;
            if (this.mouseScreenPos) {
                const screenPos = this.instance.graph2ScreenCoords(x, y, z);
                const sdx = screenPos.x - this.mouseScreenPos.x;
                const sdy = screenPos.y - this.mouseScreenPos.y;
                const screenDist = Math.sqrt(sdx * sdx + sdy * sdy);
                mouseFactor = clamp(1 - screenDist / MOUSE_PROXIMITY_RADIUS_PX, 0, 1);
            }

            const importance = this.plugin.analysisService.getImportance(node.id) ?? 0;
            // whichever signal is strongest wins: close to camera, close to
            // mouse, or simply an important note that should stay visible regardless
            const visibility = Math.max(camFactor, mouseFactor, importance);

            el.style.opacity = (clamp(0.1 + visibility * 0.8, 0.1, 0.95) * zoomCap).toFixed(2);
            el.style.fontSize = ((0.4 + visibility * 0.6) * zoomCap).toFixed(2) + 'rem';
        });

        this.animationFrameId = requestAnimationFrame(this.updateLabelVisibility);
    };

    // Applies the current highlight/hover/idle appearance to an already-mounted
    // label element. Kept separate from element creation so highlight changes
    // (which happen on every hover) restyle in place instead of forcing
    // three-forcegraph to tear down and recreate every label - that recreate
    // cycle is what caused the flicker.
    private styleLabel(node: Node, nodeEl: HTMLDivElement): void {
        if (this.highlightService.getParentSize() > 0 && this.highlightService.isParent(node)) {
            let index = this.highlightService.parentIndex(node);
            let opacity = 0.75 - (index * 5) / 100;
            nodeEl.style.color = 'orange';
            nodeEl.style.fontWeight = '500';
            nodeEl.style.opacity = (opacity < 0.15 ? 0.15 : opacity) + '';
            nodeEl.style.fontSize = '0.65rem';
            if (node.id.contains('Samind.md')) {
                nodeEl.style.fontWeight = '800';
                nodeEl.style.color = 'orange';
                nodeEl.style.opacity = '1';
                nodeEl.style.fontSize = '.85rem';
            }
            nodeEl.style.zIndex = '100';
        } else {
            const importance = this.plugin.analysisService.getImportance(node.id);
            nodeEl.style.color = this.hoveredNode === node ? this.plugin.theme.textAccent : this.getNodeColor(node);
            nodeEl.style.fontWeight = this.hoveredNode === node ? '700' : '400';
            nodeEl.style.zIndex = '';
            if (this.highlightService.getNodeSize() > 0) {
                nodeEl.style.opacity = this.highlightService.hasNode(node) ? '1' : '0.05';
                nodeEl.style.fontSize = this.highlightService.hasNode(node) ? '.75rem' : '0.45rem';
            } else {
                // idle state (nothing hovered): let importance drive legibility,
                // so hub notes stay readable while the long tail stays out of the way
                // (the per-frame visibility loop takes over from here)
                nodeEl.style.opacity = importance !== null
                    ? Math.min(0.15 + importance * 0.7, 0.9) + ''
                    : '.15';
                nodeEl.style.fontSize = importance !== null
                    ? (0.45 + importance * 0.55) + 'rem'
                    : '0.45rem';
            }
        }
    }

    private createNodeThreeObject(node: Node): CSS2DObject {
        const nodeEl = document.createElement('div');
        const match = node.id.match(/\/([^\/]+)\.(md|png)$/);
        nodeEl.textContent = match ? match[1] : node.id;

        this.styleLabel(node, nodeEl);

        nodeEl.style.marginTop = '-.75rem';
        nodeEl.className = 'node-label';
        this.labelElements.set(node.id, nodeEl);
        return new CSS2DObject(nodeEl);
    }

    private update(): void {
        this.highlightService.update();
        this.labelElements.forEach((el, nodeId) => {
            const node = this.graph.getNodeById(nodeId);
            if (node) this.styleLabel(node, el);
        });
    }

    private onRemove(): void {
        this.inspecting = false;
        this.highlightService.clear();
        this.update();
    }

    private onNodeRightClick(node: Node | null) {
        this.inspectNode(node);
    }

    private onNodeHover(node: Node | null) {
        if (this.inspecting ||
            (!node && !this.highlightService.getNodeSize()) ||
            (node && this.hoveredNode === node)) {
            return;
        }

        (document.getElementsByClassName('scene-tooltip')[0] as HTMLElement).style.display = 'none';

        this.highlightService.clear();

        if (node) {
            this.highlightService.addNode(node.id);
            node.neighbors.forEach((neighbor) => this.highlightService.addNode(neighbor.id));

            this.checkRelations(node.id, false);
        }

        this.hoveredNode = node ?? null;
        this.update();
    };

    private inspectNode(node: Node | null): void {
        this.inspecting = true;
        (document.getElementsByClassName('scene-tooltip')[0] as HTMLElement).style.display = 'none';

        this.highlightService.clear();
        if (node) {
            this.hoveredNode = node;
            this.highlightService.addNode(node.id);
            node.neighbors.forEach((neighbor) => this.highlightService.addNode(neighbor.id));

            this.checkRelations(node.id, true);
        }
        this.update();
    }

    private checkRelations(id: string, recursive = false): void {
        const nodeLinks = this.plugin.globalGraph.clone().getLinksWithNode(id);

        if (nodeLinks) {
            nodeLinks.reverse().forEach((link: Link) => {
                if (!recursive) {
                    this.highlightService.addLink(link);
                }
                if (link.source !== id) {
                    if (recursive) {
                        this.highlightService.addLink(link);
                        this.highlightService.addParent(link.source);
                        this.checkRelations(link.source, true);
                    }
                }
            });
        }
    }

    private getNodeVal(node: Node): number {
        const importance = this.plugin.analysisService.getImportance(node.id);
        // importance 0-1 maps onto 0.3x-4x the base node size, so hub notes
        // stand out clearly against the long tail
        return importance !== null ? node.val * (0.3 + importance * 3.7) : node.val;
    }

    private isNodeVisible(node: Node): boolean {
        return this.plugin.getSettings().filters.doShowOrphans || node.links.length > 0;
    };

    private getNodeColor(node: Node): string {
        let color = this.plugin.theme.textMuted;
        let matchedGroup = false;
        this.plugin.getSettings().groups.groups.forEach((group) => {
            // multiple groups -> last match wins
            if (NodeGroup.matches(group.query, node)) {
                color = group.color;
                matchedGroup = true;
            }
        });
        // fall back to AI-generated cluster color when no manual group matches
        if (!matchedGroup) {
            const clusterColor = this.plugin.analysisService.getClusterColor(node.id);
            if (clusterColor) color = clusterColor;
        }
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
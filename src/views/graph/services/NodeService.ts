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
import { lighten } from "polished";
import { ClusterBoundaryService } from "./ClusterBoundaryService";

// how close (screen px) the mouse needs to be to a label to boost its legibility
const MOUSE_PROXIMITY_RADIUS_PX = 220;
// hard cap on how many idle labels can be visible at once, regardless of how
// many nodes fall within the proximity radius (keeps zoomed-out/dense
// clusters readable instead of piling up overlapping text)
const MAX_VISIBLE_LABELS = 6;
// how close (screen px) the mouse needs to be to the *nearest* node before
// we consider its whole cluster "hovered"
const CLUSTER_HOVER_RADIUS_PX = 90;
// how much closer a different cluster's nearest node must be, versus the
// currently-hovered cluster's nearest node, before switching - prevents
// flapping back and forth right at a boundary between two clusters
const CLUSTER_HOVER_HYSTERESIS_PX = 40;
// alpha used to fade nodes outside whatever's currently focused - the
// hovered/inspected node's neighbor set, or (separately) the hovered
// cluster. Shared so both interactions dim by the same amount.
const DIM_ALPHA = 0.2;
// minimum time between cluster-hover re-evaluations. Recoloring the whole
// graph (nodeColor is only re-run when the accessor is reassigned) is
// expensive enough that flipping "nearest node" every frame near a cluster
// boundary caused visible lag; throttling caps how often that can happen
const CLUSTER_HOVER_CHECK_INTERVAL_MS = 150;

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
    private hoveredClusterId: string | null = null;
    private lastClusterHoverCheck = 0;

    constructor(
        instance: ForceGraph3DInstance,
        plugin: Graph3dPlugin,
        private highlightService: HighlightService,
        private graph: Graph,
        private clusterBoundaryService: ClusterBoundaryService) {
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
            .onBackgroundClick(() => this.onRemove())
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

    // Idle labels are hidden entirely unless the mouse is close to them on
    // screen - keeps a dense graph readable by only surfacing text where
    // you're actually looking, instead of a permanent wall of overlapping names.
    private updateLabelVisibility = (): void => {
        const camera = this.instance.camera();
        const camPos = camera.position;

        if (this.baselineCameraDistance === null) {
            this.baselineCameraDistance = camPos.length() || 400;
        }

        // still cap how large a revealed label can get while zoomed way out,
        // so hovering near a dense clump doesn't burst into oversized text
        const overallCamDist = camPos.length();
        const zoomOutStart = this.baselineCameraDistance * 1.1;
        const zoomOutEnd = this.baselineCameraDistance * 2.8;
        const zoomCap = clamp(1 - (overallCamDist - zoomOutStart) / (zoomOutEnd - zoomOutStart), 0.12, 1);

        // Gather every idle label within reveal range, then only actually
        // show the closest few. A fixed screen-space radius alone isn't
        // enough to keep this readable: zoomed out, a whole cluster can fit
        // inside that radius at once, burying the cursor in overlapping
        // text. Capping by count (not just distance) keeps it legible
        // regardless of zoom level or how dense the cluster under the
        // cursor is.
        const candidates: { el: HTMLDivElement; screenDist: number }[] = [];
        let closestNodeRef: Node | null = null;
        let closestNodeDist = Infinity;
        // closest distance among members of whichever cluster is CURRENTLY
        // hovered, tracked separately so we can require a clear margin
        // before switching away from it (plain distance-throttling alone
        // still let the choice flap every tick right at a boundary)
        let currentClusterMinDist = Infinity;

        // a plain for-of loop here (not .forEach) so the closestNodeRef/
        // closestNodeDist reassignments below stay in the same control-flow
        // scope as their later reads
        for (const [nodeId, el] of this.labelElements) {
            const node = this.graph.getNodeById(nodeId);
            if (!node) {
                this.labelElements.delete(nodeId);
                continue;
            }
            // don't fight the deliberate hover/inspect highlight styling
            // (but cluster-hover shares the same highlight set and should
            // NOT suppress the proximity-based label system - see styleLabel)
            if (this.highlightService.getParentSize() > 0 && this.highlightService.isParent(node)) continue;
            if (this.highlightService.getNodeSize() > 0 && this.hoveredClusterId === null) continue;

            const runtimeNode = node as unknown as { x?: number; y?: number; z?: number };
            const { x, y, z } = runtimeNode;
            if (x === undefined || y === undefined || z === undefined) continue;

            if (!this.mouseScreenPos) {
                el.style.opacity = '0';
                continue;
            }

            const screenPos = this.instance.graph2ScreenCoords(x, y, z);
            const sdx = screenPos.x - this.mouseScreenPos.x;
            const sdy = screenPos.y - this.mouseScreenPos.y;
            const screenDist = Math.sqrt(sdx * sdx + sdy * sdy);

            // tracked independent of the (tighter) label reveal radius, so
            // we can tell which cluster the cursor is generally near even
            // when it's not quite close enough to any single label
            if (screenDist < closestNodeDist) {
                closestNodeDist = screenDist;
                closestNodeRef = node;
            }
            if (this.hoveredClusterId !== null && screenDist < currentClusterMinDist) {
                const nodeClusterId = this.plugin.analysisService.getClusterId(node.id);
                if (nodeClusterId === this.hoveredClusterId) {
                    currentClusterMinDist = screenDist;
                }
            }

            if (screenDist > MOUSE_PROXIMITY_RADIUS_PX) {
                el.style.opacity = '0';
                continue;
            }
            candidates.push({ el, screenDist });
        }

        candidates.sort((a, b) => a.screenDist - b.screenDist);
        candidates.forEach(({ el, screenDist }, rank) => {
            if (rank >= MAX_VISIBLE_LABELS) {
                el.style.opacity = '0';
                return;
            }
            const visibility = clamp(1 - screenDist / MOUSE_PROXIMITY_RADIUS_PX, 0, 1);
            el.style.opacity = (visibility * 0.9 * zoomCap).toFixed(2);
            el.style.fontSize = ((0.4 + visibility * 0.6) * zoomCap).toFixed(2) + 'rem';
        });

        // while a specific node is genuinely focused (hover or inspect),
        // its cluster highlight is driven directly by onNodeHover/
        // inspectNode instead - don't let this proximity-based check fight
        // over hoveredClusterId with that
        const now = performance.now();
        if (!this.inspecting && this.hoveredNode === null
            && now - this.lastClusterHoverCheck >= CLUSTER_HOVER_CHECK_INTERVAL_MS) {
            this.lastClusterHoverCheck = now;

            let newHoveredClusterId: string | null;
            if (closestNodeRef === null) {
                newHoveredClusterId = null;
            } else {
                const globalClosestClusterId = this.plugin.analysisService.getClusterId(closestNodeRef.id);
                const stayOnCurrent = this.hoveredClusterId !== null
                    && globalClosestClusterId !== this.hoveredClusterId
                    && currentClusterMinDist <= CLUSTER_HOVER_RADIUS_PX
                    && closestNodeDist + CLUSTER_HOVER_HYSTERESIS_PX >= currentClusterMinDist;
                if (stayOnCurrent) {
                    // right at a boundary the "nearest node" can alternate
                    // between two clusters from one check to the next; stick
                    // with the current cluster unless the new one is clearly
                    // closer, instead of flapping back and forth
                    newHoveredClusterId = this.hoveredClusterId;
                } else {
                    newHoveredClusterId = closestNodeDist <= CLUSTER_HOVER_RADIUS_PX ? globalClosestClusterId : null;
                }
            }

            if (newHoveredClusterId !== this.hoveredClusterId) {
                this.setHoveredClusterId(newHoveredClusterId);
                // Populate the SAME highlight set node-hover uses, instead
                // of a separate dimming path, so both interactions dim
                // through the exact same mechanism (getNodeColor only knows
                // about "is this node in the highlighted set", not why).
                this.highlightService.clear();
                if (this.hoveredClusterId) {
                    const clusterId = this.hoveredClusterId;
                    this.graph.nodes.forEach((n) => {
                        if (this.plugin.analysisService.getClusterId(n.id) === clusterId) {
                            this.highlightService.addNode(n.id);
                        }
                    });
                    // also highlight edges within the cluster, same as
                    // node-hover highlights its neighbor links - otherwise
                    // edges never dim/brighten for cluster-hover at all
                    this.plugin.globalGraph.clone().links.forEach((link) => {
                        const sourceCluster = this.plugin.analysisService.getClusterId(link.source);
                        const targetCluster = this.plugin.analysisService.getClusterId(link.target);
                        if (sourceCluster === clusterId && targetCluster === clusterId) {
                            this.highlightService.addLink(link);
                        }
                    });
                }
                this.highlightService.update();
            }
        }

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
            nodeEl.style.color = this.hoveredNode === node ? this.plugin.theme.textAccent : this.getLabelColor(node);
            nodeEl.style.fontWeight = this.hoveredNode === node ? '700' : '400';
            nodeEl.style.zIndex = '';
            // when the highlight set is cluster-hover-driven (rather than a
            // specific node's hover/inspect), labels keep using the
            // proximity-declutter system below instead of all lighting up
            // at once - a whole cluster can be dozens of notes
            if (this.highlightService.getNodeSize() > 0 && this.hoveredClusterId === null) {
                nodeEl.style.opacity = this.highlightService.hasNode(node) ? '1' : '0.05';
                nodeEl.style.fontSize = this.highlightService.hasNode(node) ? '.75rem' : '0.45rem';
            } else {
                // idle state (nothing hovered): hidden by default, the
                // per-frame visibility loop reveals it only when the mouse
                // gets close
                nodeEl.style.opacity = '0';
                nodeEl.style.fontSize = '0.4rem';
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

    // Updates the box layer's highlighted cluster, no-op if unchanged.
    // Shared by node-hover/inspect (highlights the focused node's own
    // cluster) and proximity-based cluster-hover (highlights whichever
    // cluster the cursor is near), so both dim the rest of the boxes the
    // same way.
    private setHoveredClusterId(clusterId: string | null): void {
        if (clusterId === this.hoveredClusterId) return;
        this.hoveredClusterId = clusterId;
        this.clusterBoundaryService.setHoveredCluster(clusterId);
    }

    private onRemove(): void {
        this.inspecting = false;
        this.highlightService.clear();
        this.setHoveredClusterId(null);
        this.update();
    }

    private onNodeRightClick(node: Node | null) {
        this.inspectNode(node);
    }

    private onNodeHover(node: Node | null) {
        // checks our own hoveredNode, not highlightService.getNodeSize():
        // that set can also be populated by cluster-hover, and the raycast
        // reporting "no node under cursor" (very common while idly moving
        // the mouse) must not clear a cluster highlight that has nothing to
        // do with node-hover
        if (this.inspecting ||
            (!node && this.hoveredNode === null) ||
            (node && this.hoveredNode === node)) {
            return;
        }

        (document.getElementsByClassName('scene-tooltip')[0] as HTMLElement).style.display = 'none';

        this.highlightService.clear();
        // the box layer highlights whichever cluster is relevant right now -
        // the hovered node's own cluster, same as cluster-hover would - so
        // it dims/brightens consistently no matter which interaction triggered it
        this.setHoveredClusterId(node ? this.plugin.analysisService.getClusterId(node.id) : null);

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
        this.setHoveredClusterId(node ? this.plugin.analysisService.getClusterId(node.id) : null);
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

    // Label text uses a lightened version of the node's own color - using
    // the exact same color made labels blend into their own node (and into
    // other same-colored nodes nearby), especially against a dark background.
    private getLabelColor(node: Node): string {
        const color = this.getNodeColor(node);
        try {
            return lighten(0.22, color);
        } catch {
            return color;
        }
    }

    // Converts a hex or rgb() color string to rgba() at the given alpha, for
    // fading a node's color without touching the (global, not per-node)
    // nodeOpacity setting. Falls back to the original color if unparseable.
    private toRgba(color: string, alpha: number): string {
        const matchRgb = color.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
        if (matchRgb) {
            return `rgba(${matchRgb[1]},${matchRgb[2]},${matchRgb[3]}, ${alpha})`;
        }
        const matchHex = color.match(/#?([a-fA-F\d]{2})([a-fA-F\d]{2})([a-fA-F\d]{2})/);
        if (matchHex) {
            const red = parseInt(matchHex[1], 16);
            const green = parseInt(matchHex[2], 16);
            const blue = parseInt(matchHex[3], 16);
            return `rgba(${red},${green},${blue}, ${alpha})`;
        }
        return color;
    }

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
        // covers both node-hover/inspect (highlight set = hovered node's
        // neighbors) and cluster-hover (highlight set = cluster members,
        // populated in updateLabelVisibility) - one dimming path for both
        if (this.highlightService.getNodeSize() > 0 && !this.highlightService.hasNode(node)) {
            return this.toRgba(color, DIM_ALPHA);
        }
        return color;
    };
}
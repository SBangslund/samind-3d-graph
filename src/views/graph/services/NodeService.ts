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
    // true only when the user deliberately right-clicked a node to pin it -
    // as opposed to inspectNode() also being called ambiently whenever
    // active-leaf-change fires (e.g. just from clicking a node to open its
    // file, or switching to any note elsewhere while the graph stays open).
    // That ambient case must NOT permanently block casual hover/cluster-hover
    // the way a deliberate pin should - it used to, since both went through
    // the same `inspecting` flag, making hover-highlighting quietly stop
    // working the moment any note was open (i.e. almost always) until an
    // explicit background click.
    private isPinnedByUser = false;

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
        // extra global damping (default is ~0.4) so force changes - especially
        // the sudden alpha=1 reheat on explode toggle - ease in rather than
        // snap; works alongside the per-tick force magnitude caps below
        this.instance.d3VelocityDecay(0.55);
        // d3AlphaMin defaults to 0, which disables the "alpha has decayed
        // enough, we're settled" stop condition entirely - the simulation
        // then only ever stops via the 15s cooldownTime hard cutoff, no
        // matter how quickly it visually settles. A small positive value
        // lets it recognize settling naturally (a few seconds, typically),
        // which onEngineStop-driven features (e.g. zoom-after-explode) need
        // to fire at a reasonable time instead of always waiting the full 15s.
        this.instance.d3AlphaMin(0.01);

        const rendererEl = this.instance.renderer().domElement;
        rendererEl.addEventListener('mousemove', this.onMouseMove);
        rendererEl.addEventListener('mouseleave', this.onMouseLeave);
        this.animationFrameId = window.requestAnimationFrame(this.updateLabelVisibility);
    }

    // A custom d3-force: each tick, computes the current centroid of every
    // AI cluster's member nodes and pulls members back in once they've
    // drifted beyond a target radius from it - a spring with a rest length,
    // not a pull straight to the centroid. A pure linear pull-to-centroid
    // has no equilibrium size of its own (it's just a tug-of-war against
    // uniform charge repulsion), so its visual effect flips from
    // "negligible" to "everything collapses to a point" over a very narrow
    // strength range with no usable middle ground. Capping the pull to only
    // the excess distance beyond CLUSTER_TARGET_RADIUS gives clusters an
    // actual resting size: nodes already within it are left to the normal
    // link/charge forces, only outliers get reeled back in.
    private createClusterForce() {
        // both the intra-cluster pull and inter-cluster push below are
        // otherwise unbounded (linear spring / inverse square), so a node
        // very far from centroid, two exploded members still close
        // together, or two cluster centroids right on top of each other
        // get a huge one-tick velocity kick instead of a gentle nudge -
        // capping the per-tick force magnitude turns that into a steady
        // terminal-velocity-style approach instead of a violent snap
        const MAX_CLUSTER_FORCE = 12;
        const MAX_EXPLODE_FORCE = 12;
        // higher than the other two caps on purpose: inter-cluster shortfall
        // can be up to interClusterSeparation (~250+), a much bigger range
        // than the ~65-180 radii the other forces operate over. At 12, the
        // strength slider saturated this cap for almost the entire distance
        // even at low settings, making it feel like it did nothing.
        const MAX_INTER_CLUSTER_FORCE = 30;
        let nodesRef: Node[] = [];

        type RuntimeNode = Node & {
            x?: number; y?: number; z?: number;
            vx?: number; vy?: number; vz?: number;
        };

        const force = (alpha: number) => {
            // read fresh each tick so the settings sliders apply live
            const physics = this.plugin.getSettings().clusterPhysics;

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

            const explodedClusterId = this.clusterBoundaryService.getExplodedClusterId();

            nodesRef.forEach((n) => {
                const rn = n as RuntimeNode;
                if (rn.x === undefined || rn.y === undefined || rn.z === undefined) return;
                const clusterId = this.plugin.analysisService.getClusterId(n.id);
                if (!clusterId) return;
                const centroid = centroids.get(clusterId);
                if (!centroid) return;

                const isExploded = clusterId === explodedClusterId;
                const targetRadius = isExploded ? physics.explodedTargetRadius : physics.clusterTargetRadius;

                const dx = rn.x - centroid.x, dy = rn.y - centroid.y, dz = rn.z - centroid.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
                const excess = dist - targetRadius;
                if (excess > 0) {
                    const forceMagnitude = Math.min(excess * physics.clusterForceStrength, MAX_CLUSTER_FORCE) * alpha;
                    const pull = forceMagnitude / dist;
                    rn.vx = (rn.vx ?? 0) - dx * pull;
                    rn.vy = (rn.vy ?? 0) - dy * pull;
                    rn.vz = (rn.vz ?? 0) - dz * pull;
                }

                // push away from every OTHER cluster's centroid, if closer
                // than the configured separation - keeps different clusters
                // from drifting into/through each other
                if (physics.interClusterRepulsionStrength > 0) {
                    centroids.forEach((otherCentroid, otherClusterId) => {
                        if (otherClusterId === clusterId) return;
                        const odx = rn.x! - otherCentroid.x, ody = rn.y! - otherCentroid.y, odz = rn.z! - otherCentroid.z;
                        const odist = Math.sqrt(odx * odx + ody * ody + odz * odz) || 1;
                        const shortfall = physics.interClusterSeparation - odist;
                        if (shortfall <= 0) return;
                        const forceMagnitude = Math.min(
                            shortfall * physics.interClusterRepulsionStrength,
                            MAX_INTER_CLUSTER_FORCE
                        ) * alpha;
                        const push = forceMagnitude / odist;
                        rn.vx = (rn.vx ?? 0) + odx * push;
                        rn.vy = (rn.vy ?? 0) + ody * push;
                        rn.vz = (rn.vz ?? 0) + odz * push;
                    });
                }
            });

            // push the exploded cluster's members apart from each other -
            // O(k^2) but k is a single cluster's member count (tens, not
            // hundreds), trivial per tick
            if (explodedClusterId) {
                const members = nodesRef.filter(
                    (n) => this.plugin.analysisService.getClusterId(n.id) === explodedClusterId
                ) as RuntimeNode[];
                for (let i = 0; i < members.length; i++) {
                    const a = members[i];
                    if (a.x === undefined || a.y === undefined || a.z === undefined) continue;
                    for (let j = i + 1; j < members.length; j++) {
                        const b = members[j];
                        if (b.x === undefined || b.y === undefined || b.z === undefined) continue;

                        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
                        const distSq = Math.max(dx * dx + dy * dy + dz * dz, 1);
                        const dist = Math.sqrt(distSq);
                        const repel = Math.min(
                            (physics.explodeRepulsionStrength * alpha) / distSq,
                            MAX_EXPLODE_FORCE
                        );
                        const ux = dx / dist, uy = dy / dist, uz = dz / dist;

                        a.vx = (a.vx ?? 0) - ux * repel;
                        a.vy = (a.vy ?? 0) - uy * repel;
                        a.vz = (a.vz ?? 0) - uz * repel;
                        b.vx = (b.vx ?? 0) + ux * repel;
                        b.vy = (b.vy ?? 0) + uy * repel;
                        b.vz = (b.vz ?? 0) + uz * repel;
                    }
                }
            }
        };
        (force as unknown as { initialize: (nodes: Node[]) => void }).initialize = (nodes: Node[]) => {
            nodesRef = nodes;
        };
        return force;
    }

    // Called when the underlying graph data changes (e.g. orphan toggle,
    // vault change) so that node lookups and the label loop stay in sync
    // with what three-forcegraph is actually rendering.
    public updateGraph(graph: Graph): void {
        this.graph = graph;
        // drop label elements for nodes that are no longer in the graph so
        // the per-frame loop doesn't waste time on stale DOM entries
        for (const nodeId of this.labelElements.keys()) {
            if (!graph.getNodeById(nodeId)) {
                this.labelElements.delete(nodeId);
            }
        }
    }

    public destroy(): void {
        if (this.animationFrameId !== null) window.cancelAnimationFrame(this.animationFrameId);
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
        // while a cluster is highlighted (hover, title-hover, or a pinned
        // gap-insight pair), label-hover-reveal is restricted to notes
        // actually within it - revealing OTHER, dimmed notes' labels while
        // exploring a highlighted cluster read as noisy/inconsistent
        const activeClusterIds = this.clusterBoundaryService.getActiveClusterIds();

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
            if (this.highlightService.getNodeSize() > 0 && this.isNodeFocusActive()) continue;

            if (activeClusterIds.length > 0) {
                const nodeClusterId = this.plugin.analysisService.getClusterId(node.id);
                if (!nodeClusterId || !activeClusterIds.includes(nodeClusterId)) {
                    el.setCssStyles({ opacity: '0' });
                    continue;
                }
            }

            const runtimeNode = node as unknown as { x?: number; y?: number; z?: number };
            const { x, y, z } = runtimeNode;
            if (x === undefined || y === undefined || z === undefined) continue;

            if (!this.mouseScreenPos) {
                el.setCssStyles({ opacity: '0' });
                continue;
            }

            const screenPos = this.instance.graph2ScreenCoords(x, y, z);
            const sdx = screenPos.x - this.mouseScreenPos.x;
            const sdy = screenPos.y - this.mouseScreenPos.y;
            const screenDist = Math.sqrt(sdx * sdx + sdy * sdy);

            if (screenDist > MOUSE_PROXIMITY_RADIUS_PX) {
                el.setCssStyles({ opacity: '0' });
                continue;
            }
            candidates.push({ el, screenDist });
        }

        candidates.sort((a, b) => a.screenDist - b.screenDist);
        candidates.forEach(({ el, screenDist }, rank) => {
            if (rank >= MAX_VISIBLE_LABELS) {
                el.setCssStyles({ opacity: '0' });
                return;
            }
            const visibility = clamp(1 - screenDist / MOUSE_PROXIMITY_RADIUS_PX, 0, 1);
            el.setCssStyles({
                opacity: (visibility * 0.9 * zoomCap).toFixed(2),
                fontSize: ((0.4 + visibility * 0.6) * zoomCap).toFixed(2) + 'rem',
            });
        });

        // only a deliberate right-click pin (or a pinned gap-insight
        // cluster pair) should block this - not the ambient active-leaf-
        // change tracking, which would otherwise silently disable
        // cluster-hover the moment any note is open
        const now = performance.now();
        if (!this.isPinnedByUser
            && this.clusterBoundaryService.getPinnedClusterIds().length === 0
            && now - this.lastClusterHoverCheck >= CLUSTER_HOVER_CHECK_INTERVAL_MS) {
            this.lastClusterHoverCheck = now;

            const titleHoveredClusterId = this.clusterBoundaryService.getTitleHoveredClusterId();
            // directly hovering a cluster's title takes priority over the
            // raycast - it's an explicit, unambiguous signal
            const newHoveredClusterId = titleHoveredClusterId !== null
                ? titleHoveredClusterId
                : this.mouseScreenPos
                    ? this.clusterBoundaryService.getClusterAtScreenPosition(this.mouseScreenPos.x, this.mouseScreenPos.y)
                    : null;

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

        this.animationFrameId = window.requestAnimationFrame(this.updateLabelVisibility);
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
            nodeEl.setCssStyles({
                color: 'orange',
                fontWeight: '500',
                opacity: (opacity < 0.15 ? 0.15 : opacity) + '',
                fontSize: '0.65rem',
                zIndex: '100',
            });
        } else {
            nodeEl.setCssStyles({
                color: this.hoveredNode === node ? this.plugin.theme.textAccent : this.getLabelColor(node),
                fontWeight: this.hoveredNode === node ? '700' : '400',
                zIndex: '',
            });
            // only light up the whole highlighted set (hovered node + its
            // neighbors) when a specific node is genuinely focused; when
            // the highlight set is cluster-hover-driven instead, labels
            // keep using the proximity-declutter system below - a whole
            // cluster can be dozens of notes
            if (this.highlightService.getNodeSize() > 0 && this.isNodeFocusActive()) {
                nodeEl.setCssStyles({
                    opacity: this.highlightService.hasNode(node) ? '1' : '0.05',
                    fontSize: this.highlightService.hasNode(node) ? '.75rem' : '0.45rem',
                });
            } else {
                // idle state (nothing hovered): hidden by default, the
                // per-frame visibility loop reveals it only when the mouse
                // gets close
                nodeEl.setCssStyles({ opacity: '0', fontSize: '0.4rem' });
            }
        }
    }

    private createNodeThreeObject(node: Node): CSS2DObject {
        const nodeEl = createDiv();
        const match = node.id.match(/\/([^/]+)\.(md|png)$/);
        nodeEl.textContent = match ? match[1] : node.id;

        this.styleLabel(node, nodeEl);

        nodeEl.setCssStyles({ marginTop: '-.75rem' });
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
        // stay frozen in sync with ClusterBoundaryService's own no-op while
        // pinned, otherwise our local copy could drift from what it
        // actually applied and skip a real update once the pin clears
        if (this.clusterBoundaryService.getPinnedClusterIds().length > 0) return;
        if (clusterId === this.hoveredClusterId) return;
        this.hoveredClusterId = clusterId;
        this.clusterBoundaryService.setHoveredCluster(clusterId);
    }

    // Pins one or more clusters as highlighted - e.g. both sides of a gap
    // insight's "Show in graph" - populating the SAME highlight set
    // node-hover/cluster-hover use, so nodes, edges, boxes, and titles all
    // dim/brighten together. Stays until a real node hover/inspect or a
    // background click clears it.
    public pinClusters(clusterIds: string[]): void {
        this.highlightService.clear();
        clusterIds.forEach((clusterId) => {
            this.graph.nodes.forEach((n) => {
                if (this.plugin.analysisService.getClusterId(n.id) === clusterId) {
                    this.highlightService.addNode(n.id);
                }
            });
        });
        this.plugin.globalGraph.clone().links.forEach((link) => {
            const sourceCluster = this.plugin.analysisService.getClusterId(link.source);
            const targetCluster = this.plugin.analysisService.getClusterId(link.target);
            if (sourceCluster && targetCluster
                && clusterIds.includes(sourceCluster) && clusterIds.includes(targetCluster)) {
                this.highlightService.addLink(link);
            }
        });
        this.highlightService.update();
        this.clusterBoundaryService.setPinnedClusters(clusterIds);
    }

    // True when a specific node is genuinely hovered or inspected (as
    // opposed to the highlight set being populated by proximity-based
    // cluster-hover instead) - hoveredClusterId alone can't tell these
    // apart any more, since node-hover/inspect now sets it too so the box
    // layer stays consistent.
    private isNodeFocusActive(): boolean {
        return this.inspecting || this.hoveredNode !== null;
    }

    private onRemove(): void {
        this.inspecting = false;
        this.isPinnedByUser = false;
        this.clusterBoundaryService.setPinnedClusters([]);
        this.highlightService.clear();
        this.setHoveredClusterId(null);
        this.update();
    }

    private onNodeRightClick(node: Node | null) {
        this.inspectNode(node, true);
    }

    private onNodeHover(node: Node | null) {
        // checks our own hoveredNode, not highlightService.getNodeSize():
        // that set can also be populated by cluster-hover, and the raycast
        // reporting "no node under cursor" (very common while idly moving
        // the mouse) must not clear a cluster highlight that has nothing to
        // do with node-hover. Gated on isPinnedByUser (not inspecting): a
        // deliberate right-click pin should block casual hover, but the
        // ambient active-leaf-change tracking should not.
        if (this.isPinnedByUser ||
            (!node && this.hoveredNode === null) ||
            (node && this.hoveredNode === node)) {
            return;
        }

        (document.getElementsByClassName('scene-tooltip')[0] as HTMLElement)?.setCssStyles({ display: 'none' });

        this.highlightService.clear();
        // a real node hover/inspect always wins over a pinned gap-insight
        // pair - clear the pin explicitly, since setHoveredClusterId() below
        // would otherwise be silently ignored by the pin's precedence guard
        this.clusterBoundaryService.setPinnedClusters([]);
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
        // three-forcegraph shows a pointer cursor not just while hovering a
        // clickable node, but also over empty background as long as
        // onBackgroundClick is registered (which we need for deselecting).
        // An inline style override loses this fight: the library resets
        // renderer.domElement.style.cursor to null on EVERY animation frame
        // (60/sec) and only reapplies its own .clickable class-based rule,
        // while we only reapply our inline override on hover-target changes
        // - so it silently wins back within a frame or two. A persistent
        // class + !important isn't touched by that per-frame inline reset
        // at all, so there's no race to lose.
        this.instance.renderer().domElement.classList.toggle('samind-node-hovered', !!node);
        this.update();
    };

    private inspectNode(node: Node | null, isPinnedByUser = false): void {
        this.inspecting = true;
        this.isPinnedByUser = isPinnedByUser;
        (document.getElementsByClassName('scene-tooltip')[0] as HTMLElement)?.setCssStyles({ display: 'none' });

        this.highlightService.clear();
        // only a deliberate right-click pin should clear a pinned gap pair -
        // the ambient active-leaf-change path (isPinnedByUser false) must
        // not silently disrupt it, same reasoning as everywhere else this
        // distinction is made
        if (isPinnedByUser) this.clusterBoundaryService.setPinnedClusters([]);
        this.setHoveredClusterId(node ? this.plugin.analysisService.getClusterId(node.id) : null);
        if (node) {
            this.hoveredNode = node;
            this.highlightService.addNode(node.id);
            node.neighbors.forEach((neighbor) => this.highlightService.addNode(neighbor.id));

            this.checkRelations(node.id, true);
        }
        this.update();
    }

    private checkRelations(id: string, recursive = false, visited = new Set<string>()): void {
        if (visited.has(id)) return;
        visited.add(id);
        // globalGraph is never passed to d3-force so its link source/target
        // remain plain strings - no need to clone the entire graph here
        const nodeLinks = this.plugin.globalGraph.getLinksWithNode(id);

        if (nodeLinks) {
            nodeLinks.reverse().forEach((link: Link) => {
                if (!recursive) {
                    this.highlightService.addLink(link);
                }
                if (link.source !== id) {
                    if (recursive) {
                        this.highlightService.addLink(link);
                        this.highlightService.addParent(link.source);
                        this.checkRelations(link.source, true, visited);
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
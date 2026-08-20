import * as THREE from "three";
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { ForceGraph3DInstance } from "3d-force-graph";
import { AbstractGraphService } from "./AbstractGraphService";
import Graph3dPlugin from "src/main";
import Graph from "src/graph/Graph";
import Node from "src/graph/Node";

const REBUILD_INTERVAL_MS = 600;
const BOX_PADDING = 24;
// below this many members, a box doesn't read as a meaningful region
const MIN_CLUSTER_SIZE = 2;
// nodes beyond this percentile of centroid-distance are treated as outliers
// and excluded from the bounding-box calculation so one stray note can't
// inflate the box to cover the whole scene
const CLUSTER_BOX_OUTLIER_PERCENTILE = 0.85;

const BASE_BOX_OPACITY = 0.35;
const HOVER_BOX_OPACITY = 0.65;
const DIM_BOX_OPACITY = 0.05;
const BASE_FILL_OPACITY = 0.07;
const HOVER_FILL_OPACITY = 0.18;
const DIM_FILL_OPACITY = 0.02;
const BASE_LABEL_OPACITY = 0.6;
const HOVER_LABEL_OPACITY = 0.95;
const DIM_LABEL_OPACITY = 0.08;
// how much of the remaining distance to the target opacity to close per
// frame - the box material isn't a DOM element, so CSS transitions can't
// smooth it; this ease-toward-target loop does the same job by hand
const OPACITY_LERP_FACTOR = 0.12;
// how close (screen px) the mouse needs to be before an idle cluster title
type RuntimeNode = Node & { x?: number; y?: number; z?: number };

interface BoundaryEntry {
    box: THREE.LineSegments;
    fill: THREE.Mesh;
    label: CSS2DObject;
    targetBoxOpacity: number;
    targetFillOpacity: number;
    bounds: THREE.Box3;
}

// Draws a dashed bounding box + floating title around each AI cluster's
// current spatial extent, so the clustering force's effect is legible even
// before you've spotted the color pattern. A box has far fewer edges than a
// wireframe sphere (12 vs. dozens of segments), so it reads as less busy
// even with many clusters overlapping. Rebuilt on an interval (not every
// frame) since node positions settle gradually and a full rebuild is cheap
// but still unnecessary work at 60fps.
export class ClusterBoundaryService extends AbstractGraphService {
    private readonly boundaries: Map<string, BoundaryEntry> = new Map();
    private intervalId: number | null = null;
    private hoveredClusterId: string | null = null;
    // an explicit, deliberate multi-cluster selection (e.g. "Show in graph"
    // on a gap insight) - unlike hoveredClusterId, can hold more than one
    // cluster, and takes precedence over the continuous hover tracking
    // until cleared
    private pinnedClusterIds: Set<string> = new Set();
    private opacityAnimationFrameId: number | null = null;
    // which cluster (if any) NodeService's clustering force should push
    // apart internally instead of pulling tight - read directly by
    // NodeService.createClusterForce() each tick
    private explodedClusterId: string | null = null;
    // which cluster's title is currently DOM-hovered, if any - read by
    // NodeService's proximity-based cluster-hover check each tick, taking
    // priority over its own nearest-node distance calculation, so hovering
    // a title drives the full node/edge/box highlight, not just the box
    private titleHoveredClusterId: string | null = null;
    private readonly raycaster = new THREE.Raycaster();
    private mouseScreenPos: { x: number; y: number } | null = null;

    constructor(
        instance: ForceGraph3DInstance,
        plugin: Graph3dPlugin,
        private graph: Graph
    ) {
        super(instance, plugin);
    }

    public init(): void {
        this.rebuild();
        this.intervalId = window.setInterval(() => this.rebuild(), REBUILD_INTERVAL_MS);
        this.opacityAnimationFrameId = window.requestAnimationFrame(this.tickOpacity);
        const rendererEl = this.instance.renderer().domElement;
        rendererEl.addEventListener('dblclick', this.onCanvasDoubleClick);
        rendererEl.addEventListener('mousemove', this.onMouseMove);
        rendererEl.addEventListener('mouseleave', this.onMouseLeave);
    }

    public updateGraph(graph: Graph): void {
        this.graph = graph;
    }

    public triggerRebuild(): void {
        this.rebuild();
    }

    public destroy(): void {
        if (this.intervalId !== null) window.clearInterval(this.intervalId);
        if (this.opacityAnimationFrameId !== null) window.cancelAnimationFrame(this.opacityAnimationFrameId);
        const rendererEl = this.instance.renderer().domElement;
        rendererEl.removeEventListener('dblclick', this.onCanvasDoubleClick);
        rendererEl.removeEventListener('mousemove', this.onMouseMove);
        rendererEl.removeEventListener('mouseleave', this.onMouseLeave);
        const scene = this.instance.scene();
        this.boundaries.forEach((entry) => this.disposeEntry(scene, entry));
        this.boundaries.clear();
    }

    private readonly onMouseMove = (event: MouseEvent): void => {
        const rect = this.instance.renderer().domElement.getBoundingClientRect();
        this.mouseScreenPos = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    private readonly onMouseLeave = (): void => {
        this.mouseScreenPos = null;
    };

    // Double-clicking anywhere inside a cluster's box explodes it, not just
    // its small title label - much more discoverable, and reuses the same
    // raycast getClusterAtScreenPosition() already does for hover.
    private readonly onCanvasDoubleClick = (event: MouseEvent): void => {
        const rect = this.instance.renderer().domElement.getBoundingClientRect();
        const clusterId = this.getClusterAtScreenPosition(
            event.clientX - rect.left,
            event.clientY - rect.top
        );
        if (clusterId) this.toggleExplode(clusterId);
    };

    // Eases each box's material opacity toward its current target every
    // frame, since transparent WebGL materials don't get CSS transitions.
    // Also drives idle-state box/title opacity by mouse proximity - both
    // used to be always-on regardless of distance, which read as too busy.
    private tickOpacity = (): void => {
        this.boundaries.forEach((entry) => {
            if (this.getActiveClusterIds().length === 0) {
                // idle: labels always visible so cluster names are readable
                // without having to hunt with the mouse
                entry.targetBoxOpacity = BASE_BOX_OPACITY;
                entry.targetFillOpacity = BASE_FILL_OPACITY;
                entry.label.element.setCssStyles({
                    opacity: String(BASE_LABEL_OPACITY),
                });
            }
            // when a cluster IS hover-highlighted, applyHoverStyles already
            // set the right box/fill/title opacity (hovered/dimmed) - leave
            // it alone here rather than fighting over it every frame

            const boxMat = entry.box.material as THREE.LineDashedMaterial;
            boxMat.opacity += (entry.targetBoxOpacity - boxMat.opacity) * OPACITY_LERP_FACTOR;

            const fillMat = entry.fill.material as THREE.MeshBasicMaterial;
            fillMat.opacity += (entry.targetFillOpacity - fillMat.opacity) * OPACITY_LERP_FACTOR;
        });
        this.opacityAnimationFrameId = window.requestAnimationFrame(this.tickOpacity);
    };

    public getTitleHoveredClusterId(): string | null {
        return this.titleHoveredClusterId;
    }

    // Which cluster's box the mouse ray actually passes through, nearest
    // hit wins - proper 3D containment/depth-ordering (a box in front
    // correctly wins over one behind it) instead of a 2D screen-distance
    // proxy, which had no real notion of "inside" and needed a hysteresis
    // hack to stop flapping between two close-but-different candidates.
    public getClusterAtScreenPosition(screenX: number, screenY: number): string | null {
        const width = this.instance.width();
        const height = this.instance.height();
        if (width === 0 || height === 0) return null;

        const ndc = new THREE.Vector2(
            (screenX / width) * 2 - 1,
            -(screenY / height) * 2 + 1
        );
        this.raycaster.setFromCamera(ndc, this.instance.camera());

        const hitPoint = new THREE.Vector3();
        const hits: { clusterId: string; bounds: THREE.Box3; dist: number }[] = [];
        this.boundaries.forEach((entry, clusterId) => {
            if (this.raycaster.ray.intersectBox(entry.bounds, hitPoint)) {
                hits.push({
                    clusterId,
                    bounds: entry.bounds,
                    dist: this.raycaster.ray.origin.distanceTo(hitPoint),
                });
            }
        });
        if (hits.length === 0) return null;

        // A box fully enclosed by another hit box would always lose on pure
        // nearest-hit - the ray has to enter the outer box's near face
        // before it can ever reach the inner one - making the inner cluster
        // permanently unreachable whenever one cluster's box fully envelops
        // another's. Drop any hit that itself contains another hit (there's
        // a more specific box nested inside it that should win instead);
        // nearest-hit among what's left still handles ordinary front/behind
        // overlap, where no containment exists at all.
        const innermost = hits.filter(
            (hit) =>
                !hits.some(
                    (other) => other !== hit && hit.bounds.containsBox(other.bounds)
                )
        );
        const candidates = innermost.length > 0 ? innermost : hits;
        return candidates.reduce((closest, hit) =>
            hit.dist < closest.dist ? hit : closest
        ).clusterId;
    }

    // Called (cheaply) every frame by NodeService with whichever cluster the
    // cursor is currently nearest to. Only actually restyles when the value
    // changes, so most calls are a no-op. Ignored while clusters are
    // pinned (e.g. via a gap insight's "Show in graph") - the pin takes
    // precedence over continuous hover tracking until explicitly cleared.
    public setHoveredCluster(clusterId: string | null): void {
        if (this.pinnedClusterIds.size > 0) return;
        if (clusterId === this.hoveredClusterId) return;
        this.hoveredClusterId = clusterId;
        this.applyHoverStyles();
    }

    // Pins a set of clusters as highlighted (e.g. both sides of a gap
    // insight), independent of - and taking priority over - the continuous
    // mouse-driven hover. Pass an empty array to clear.
    public setPinnedClusters(clusterIds: string[]): void {
        this.pinnedClusterIds = new Set(clusterIds);
        this.applyHoverStyles();
    }

    public getPinnedClusterIds(): string[] {
        return Array.from(this.pinnedClusterIds);
    }

    // Whichever cluster(s) are currently highlighted, whatever the reason -
    // an explicit pin if one is active, otherwise the continuous hover
    // target. Used by NodeService to restrict label-hover-reveal to nodes
    // actually within the highlighted region(s).
    public getActiveClusterIds(): string[] {
        if (this.pinnedClusterIds.size > 0) return Array.from(this.pinnedClusterIds);
        return this.hoveredClusterId ? [this.hoveredClusterId] : [];
    }

    private applyHoverStyles(): void {
        const activeIds = this.getActiveClusterIds();
        this.boundaries.forEach((entry, clusterId) => {
            const isActive = activeIds.includes(clusterId);
            if (activeIds.length === 0) {
                entry.targetBoxOpacity = BASE_BOX_OPACITY;
                entry.targetFillOpacity = BASE_FILL_OPACITY;
                // label opacity: left to tickOpacity's always-on idle path
            } else if (isActive) {
                entry.targetBoxOpacity = HOVER_BOX_OPACITY;
                entry.targetFillOpacity = HOVER_FILL_OPACITY;
                entry.label.element.setCssStyles({ opacity: String(HOVER_LABEL_OPACITY) });
            } else {
                entry.targetBoxOpacity = DIM_BOX_OPACITY;
                entry.targetFillOpacity = DIM_FILL_OPACITY;
                entry.label.element.setCssStyles({ opacity: String(DIM_LABEL_OPACITY) });
            }
        });
    }

    public getExplodedClusterId(): string | null {
        return this.explodedClusterId;
    }

    // Toggles whether this cluster's members should physically push apart
    // from each other (handled by NodeService's clustering force, which
    // reads getExplodedClusterId() every tick) instead of moving the
    // camera directly.
    private toggleExplode(clusterId: string): void {
        const isExploding = this.explodedClusterId !== clusterId;
        this.explodedClusterId = isExploding ? clusterId : null;
        // the simulation has almost certainly cooled down and stopped
        // ticking by the time someone clicks this, so the force change
        // wouldn't actually move anything without reheating it. Safe here
        // (unlike calling this synchronously right after graphData() during
        // initial load, which races the library's own deferred digest) -
        // the simulation has been running/settled for a while by now.
        this.instance.d3ReheatSimulation();

        // Fire immediately rather than waiting for onEngineStop (the
        // simulation to settle): that wait is several seconds, plenty of
        // time to have already started manually orbiting/panning - having
        // the zoom suddenly fire mid-navigation and yank the camera onto
        // the cluster felt like being locked on. Firing right away means
        // it's done before you've touched the camera, and it stays loose
        // afterward. The frame is based on current (pre-explode, still
        // tight) positions rather than the eventual exploded spread, which
        // is an acceptable trade for not fighting the user's own navigation.
        if (isExploding) {
            // the cluster is about to grow toward EXPLODED_TARGET_RADIUS -
            // inflate the target frame so it has headroom for that growth
            // instead of ending up too tight (frame is computed from
            // current, pre-explode positions)
            this.focusOnClusters([clusterId], 1.8);
        }
    }

    // Frames the camera around the current combined extent of one or more
    // clusters - used for explode (a single cluster, with growth headroom)
    // and for jumping to both clusters involved in a gap insight.
    // Not using the built-in zoomToFit here: its fitToBbox always measures
    // size relative to the world origin (0,0,0), not the bbox's own center
    // - fine for the whole graph, which sits centered near the origin via
    // the base forceCenter force, but wrong for an off-center subset like
    // one or two clusters. It was measuring "how far is this the farthest
    // point from world center" instead of "how big is this region", so
    // whichever cluster happened to sit farther from the origin got a more
    // zoomed-out camera regardless of its actual size - repeatedly exploding
    // different clusters made the zoom drift further out each time. This
    // reimplements the same framing math (mirrors fitToBbox in
    // three-render-objects), just centered on the region's own centroid.
    public focusOnClusters(clusterIds: string[], growthHeadroom = 1): void {
        const points: THREE.Vector3[] = [];
        this.graph.nodes.forEach((node) => {
            const rn = node as RuntimeNode;
            if (rn.x === undefined || rn.y === undefined || rn.z === undefined) return;
            const clusterId = this.plugin.analysisService.getClusterId(node.id);
            if (clusterId && clusterIds.includes(clusterId)) {
                points.push(new THREE.Vector3(rn.x, rn.y, rn.z));
            }
        });
        if (points.length === 0) return;

        const box = new THREE.Box3().setFromPoints(points);
        const center = new THREE.Vector3();
        box.getCenter(center);
        const maxBoxSide = Math.max(
            Math.abs(box.max.x - center.x), Math.abs(box.min.x - center.x),
            Math.abs(box.max.y - center.y), Math.abs(box.min.y - center.y),
            Math.abs(box.max.z - center.z), Math.abs(box.min.z - center.z)
        ) * 2 * growthHeadroom;

        const camera = this.instance.camera() as THREE.PerspectiveCamera;
        const padding = 90;
        const height = this.instance.height();
        const paddedFov = (1 - (padding * 2) / height) * camera.fov;
        const fitHeightDistance = maxBoxSide / Math.atan((paddedFov * Math.PI) / 180);
        const fitWidthDistance = fitHeightDistance / camera.aspect;
        const distance = Math.max(fitHeightDistance, fitWidthDistance);
        if (distance <= 0) return;

        const direction = camera.position.clone().sub(center);
        if (direction.lengthSq() === 0) direction.set(0, 0, 1);
        direction.normalize();
        const newPosition = center.clone().add(direction.multiplyScalar(distance));

        this.instance.cameraPosition(newPosition, center, 800);
    }

    private disposeEntry(scene: THREE.Scene, entry: BoundaryEntry): void {
        scene.remove(entry.box);
        scene.remove(entry.fill);
        scene.remove(entry.label);
        entry.box.geometry.dispose();
        (entry.box.material as THREE.Material).dispose();
        entry.fill.geometry.dispose();
        (entry.fill.material as THREE.Material).dispose();
    }

    private rebuild = (): void => {
        if (!this.plugin.analysisService.hasAnalysis()) return;

        const pointsByCluster = new Map<string, THREE.Vector3[]>();
        this.graph.nodes.forEach((node) => {
            const rn = node as RuntimeNode;
            if (rn.x === undefined || rn.y === undefined || rn.z === undefined) return;
            const clusterId = this.plugin.analysisService.getClusterId(node.id);
            if (!clusterId) return;
            let points = pointsByCluster.get(clusterId);
            if (!points) {
                points = [];
                pointsByCluster.set(clusterId, points);
            }
            points.push(new THREE.Vector3(rn.x, rn.y, rn.z));
        });

        const scene = this.instance.scene();
        const seenClusterIds = new Set<string>();

        pointsByCluster.forEach((points, clusterId) => {
            if (points.length < MIN_CLUSTER_SIZE) return;
            const cluster = this.plugin.analysisService
                .getClusters()
                .find((c) => c.id === clusterId);
            if (!cluster) return;
            seenClusterIds.add(clusterId);

            // Exclude outlier nodes from the box so a single stray note
            // doesn't inflate it to cover the whole scene. Compute the
            // centroid, sort nodes by their distance from it, then only
            // include nodes within the configured percentile radius.
            const centroid = new THREE.Vector3();
            points.forEach((p) => centroid.add(p));
            centroid.divideScalar(points.length);

            const distances = points.map((p) => p.distanceTo(centroid));
            const sortedDists = [...distances].sort((a, b) => a - b);
            const cutoffIndex = Math.floor(sortedDists.length * CLUSTER_BOX_OUTLIER_PERCENTILE);
            const maxRadius = sortedDists[cutoffIndex] ?? Infinity;
            const corePoints = points.filter((_, i) => distances[i] <= maxRadius);

            const box3 = new THREE.Box3().setFromPoints(
                corePoints.length >= MIN_CLUSTER_SIZE ? corePoints : points
            );
            box3.expandByScalar(BOX_PADDING);
            const size = new THREE.Vector3();
            box3.getSize(size);
            const center = new THREE.Vector3();
            box3.getCenter(center);

            const boxGeom = new THREE.BoxGeometry(size.x, size.y, size.z);
            let edgesGeometry: THREE.BufferGeometry;
            let fillGeometry: THREE.BufferGeometry;

            const shape = this.plugin.getSettings().display.clusterShape;
            if (shape === 'convex' && corePoints.length >= 4) {
                try {
                    const hullGeom = new ConvexGeometry(corePoints);
                    edgesGeometry = new THREE.EdgesGeometry(hullGeom);
                    fillGeometry = hullGeom;
                    boxGeom.dispose();
                } catch {
                    // coplanar points or degenerate hull — fall back to box
                    edgesGeometry = new THREE.EdgesGeometry(boxGeom);
                    boxGeom.dispose();
                    fillGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
                }
            } else {
                edgesGeometry = new THREE.EdgesGeometry(boxGeom);
                boxGeom.dispose();
                fillGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
            }

            let entry = this.boundaries.get(clusterId);
            if (!entry) {
                const material = new THREE.LineDashedMaterial({
                    color: new THREE.Color(cluster.color),
                    transparent: true,
                    // hidden by default; tickOpacity reveals it based on
                    // mouse proximity once idle
                    opacity: 0,
                    dashSize: 6,
                    gapSize: 4,
                });
                const line = new THREE.LineSegments(edgesGeometry, material);
                line.computeLineDistances();
                line.raycast = () => { /* never intercept pointer events */ };
                line.renderOrder = -1;
                // getGraphBbox() (used by zoomToFit) only excludes objects
                // it recognizes as an actual graph node/link via this tag;
                // without it, every cluster's decorative box gets folded
                // into ANY zoomToFit bbox regardless of nodeFilter, which
                // is why zooming to one cluster was framing the whole graph
                (line as unknown as { __graphObjType?: string }).__graphObjType = 'clusterBoundary';

                const labelEl = createDiv();
                labelEl.className = 'cluster-boundary-label';
                labelEl.textContent = cluster.label;
                labelEl.setCssStyles({
                    color: cluster.color,
                    opacity: String(BASE_LABEL_OPACITY),
                });
                // double-click, not single: these labels are small, faint,
                // and there are many of them scattered around the scene, so
                // a single click was too easy to trigger by accident while
                // just clicking around near open space
                labelEl.title = 'Double-click to explode this cluster apart';
                labelEl.addEventListener('dblclick', () => this.toggleExplode(clusterId));
                labelEl.addEventListener('mouseenter', () => {
                    this.titleHoveredClusterId = clusterId;
                });
                labelEl.addEventListener('mouseleave', () => {
                    if (this.titleHoveredClusterId === clusterId) this.titleHoveredClusterId = null;
                });
                const label = new CSS2DObject(labelEl);
                (label as unknown as { __graphObjType?: string }).__graphObjType = 'clusterBoundary';

                // Translucent filled volume so cluster territories read as
                // distinct regions, not just a dashed outline. depthWrite:false
                // prevents z-fighting with nodes that sit inside the volume.
                const fillMaterial = new THREE.MeshBasicMaterial({
                    color: new THREE.Color(cluster.color),
                    transparent: true,
                    opacity: 0,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                });
                const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
                fillMesh.renderOrder = -2;
                (fillMesh as unknown as { __graphObjType?: string }).__graphObjType = 'clusterBoundary';

                scene.add(line);
                scene.add(fillMesh);
                scene.add(label);
                entry = { box: line, fill: fillMesh, label, targetBoxOpacity: BASE_BOX_OPACITY, targetFillOpacity: BASE_FILL_OPACITY, bounds: box3 };
                this.boundaries.set(clusterId, entry);
            } else {
                entry.bounds = box3;
                entry.box.geometry.dispose();
                entry.box.geometry = edgesGeometry;
                entry.box.computeLineDistances();
                entry.fill.geometry.dispose();
                entry.fill.geometry = fillGeometry;
            }

            entry.box.position.copy(center);
            entry.fill.position.copy(center);
            entry.label.position.set(center.x, box3.max.y, center.z);
        });

        // drop boundaries for clusters no longer represented (e.g. switching
        // to a local graph that only shows a handful of notes)
        Array.from(this.boundaries.keys()).forEach((clusterId) => {
            if (seenClusterIds.has(clusterId)) return;
            const entry = this.boundaries.get(clusterId);
            if (entry) this.disposeEntry(scene, entry);
            this.boundaries.delete(clusterId);
        });

        // make sure any newly (re)created entries reflect the current hover
        // state, in case hover changed since the last rebuild
        this.applyHoverStyles();
    };
}

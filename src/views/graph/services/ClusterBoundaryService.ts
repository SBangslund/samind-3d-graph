import * as THREE from "three";
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ForceGraph3DInstance } from "3d-force-graph";
import { AbstractGraphService } from "./AbstractGraphService";
import Graph3dPlugin from "src/main";
import Graph from "src/graph/Graph";
import Node from "src/graph/Node";

const REBUILD_INTERVAL_MS = 600;
const BOX_PADDING = 24;
// below this many members, a box doesn't read as a meaningful region
const MIN_CLUSTER_SIZE = 2;

const BASE_BOX_OPACITY = 0.2;
const HOVER_BOX_OPACITY = 0.55;
const DIM_BOX_OPACITY = 0.04;
const BASE_LABEL_OPACITY = 0.35;
const HOVER_LABEL_OPACITY = 0.85;
const DIM_LABEL_OPACITY = 0.08;

type RuntimeNode = Node & { x?: number; y?: number; z?: number };

interface BoundaryEntry {
    box: THREE.LineSegments;
    label: CSS2DObject;
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
    }

    public destroy(): void {
        if (this.intervalId !== null) window.clearInterval(this.intervalId);
        const scene = this.instance.scene();
        this.boundaries.forEach((entry) => this.disposeEntry(scene, entry));
        this.boundaries.clear();
    }

    // Called (cheaply) every frame by NodeService with whichever cluster the
    // cursor is currently nearest to. Only actually restyles when the value
    // changes, so most calls are a no-op.
    public setHoveredCluster(clusterId: string | null): void {
        if (clusterId === this.hoveredClusterId) return;
        this.hoveredClusterId = clusterId;
        this.applyHoverStyles();
    }

    private applyHoverStyles(): void {
        this.boundaries.forEach((entry, clusterId) => {
            const material = entry.box.material as THREE.LineDashedMaterial;
            const isHovered = clusterId === this.hoveredClusterId;
            if (this.hoveredClusterId === null) {
                material.opacity = BASE_BOX_OPACITY;
                entry.label.element.style.opacity = String(BASE_LABEL_OPACITY);
            } else if (isHovered) {
                material.opacity = HOVER_BOX_OPACITY;
                entry.label.element.style.opacity = String(HOVER_LABEL_OPACITY);
            } else {
                material.opacity = DIM_BOX_OPACITY;
                entry.label.element.style.opacity = String(DIM_LABEL_OPACITY);
            }
        });
    }

    private disposeEntry(scene: THREE.Scene, entry: BoundaryEntry): void {
        scene.remove(entry.box);
        scene.remove(entry.label);
        entry.box.geometry.dispose();
        (entry.box.material as THREE.Material).dispose();
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

            const box3 = new THREE.Box3().setFromPoints(points);
            box3.expandByScalar(BOX_PADDING);
            const size = new THREE.Vector3();
            box3.getSize(size);
            const center = new THREE.Vector3();
            box3.getCenter(center);

            const boxGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
            const edgesGeometry = new THREE.EdgesGeometry(boxGeometry);
            boxGeometry.dispose();

            let entry = this.boundaries.get(clusterId);
            if (!entry) {
                const material = new THREE.LineDashedMaterial({
                    color: new THREE.Color(cluster.color),
                    transparent: true,
                    opacity: BASE_BOX_OPACITY,
                    dashSize: 6,
                    gapSize: 4,
                });
                const line = new THREE.LineSegments(edgesGeometry, material);
                line.computeLineDistances();
                line.raycast = () => { /* never intercept pointer events */ };
                line.renderOrder = -1;

                const labelEl = document.createElement('div');
                labelEl.className = 'cluster-boundary-label';
                labelEl.textContent = cluster.label;
                labelEl.style.color = cluster.color;
                labelEl.style.opacity = String(BASE_LABEL_OPACITY);
                const label = new CSS2DObject(labelEl);

                scene.add(line);
                scene.add(label);
                entry = { box: line, label };
                this.boundaries.set(clusterId, entry);
            } else {
                entry.box.geometry.dispose();
                entry.box.geometry = edgesGeometry;
                entry.box.computeLineDistances();
            }

            entry.box.position.copy(center);
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

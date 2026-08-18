import * as THREE from "three";
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ForceGraph3DInstance } from "3d-force-graph";
import { AbstractGraphService } from "./AbstractGraphService";
import Graph3dPlugin from "src/main";
import Graph from "src/graph/Graph";
import Node from "src/graph/Node";

const REBUILD_INTERVAL_MS = 600;
const SPHERE_PADDING = 20;
// low segment counts on purpose: a coarse geodesic wireframe reads as a
// soft "region" without turning into a dense, cluttered mesh of lines
const SPHERE_WIDTH_SEGMENTS = 10;
const SPHERE_HEIGHT_SEGMENTS = 6;
// below this many members, a sphere doesn't read as a meaningful region
const MIN_CLUSTER_SIZE = 2;

type RuntimeNode = Node & { x?: number; y?: number; z?: number };

interface BoundaryEntry {
    sphere: THREE.Mesh;
    label: CSS2DObject;
}

// Draws a wireframe sphere + floating title around each AI cluster's
// current spatial extent, so the clustering force's effect is legible even
// before you've spotted the color pattern. A sphere matches the roughly
// isotropic shape the clustering force actually produces (it pulls members
// toward a centroid in all directions), unlike a bounding box which wastes
// visual space on empty corners. Rebuilt on an interval (not every frame)
// since node positions settle gradually and a full rebuild is cheap but
// still unnecessary work at 60fps.
export class ClusterBoundaryService extends AbstractGraphService {
    private readonly boundaries: Map<string, BoundaryEntry> = new Map();
    private intervalId: number | null = null;

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

    private disposeEntry(scene: THREE.Scene, entry: BoundaryEntry): void {
        scene.remove(entry.sphere);
        scene.remove(entry.label);
        entry.sphere.geometry.dispose();
        (entry.sphere.material as THREE.Material).dispose();
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

            const boundingSphere = new THREE.Sphere().setFromPoints(points);
            const radius = boundingSphere.radius + SPHERE_PADDING;

            const geometry = new THREE.SphereGeometry(
                radius,
                SPHERE_WIDTH_SEGMENTS,
                SPHERE_HEIGHT_SEGMENTS
            );

            let entry = this.boundaries.get(clusterId);
            if (!entry) {
                const material = new THREE.MeshBasicMaterial({
                    color: new THREE.Color(cluster.color),
                    wireframe: true,
                    transparent: true,
                    opacity: 0.22,
                });
                const mesh = new THREE.Mesh(geometry, material);
                mesh.raycast = () => { /* never intercept pointer events */ };
                mesh.renderOrder = -1;

                const labelEl = document.createElement('div');
                labelEl.className = 'cluster-boundary-label';
                labelEl.textContent = cluster.label;
                labelEl.style.color = cluster.color;
                const label = new CSS2DObject(labelEl);

                scene.add(mesh);
                scene.add(label);
                entry = { sphere: mesh, label };
                this.boundaries.set(clusterId, entry);
            } else {
                entry.sphere.geometry.dispose();
                entry.sphere.geometry = geometry;
            }

            entry.sphere.position.copy(boundingSphere.center);
            entry.label.position.set(
                boundingSphere.center.x,
                boundingSphere.center.y + radius,
                boundingSphere.center.z
            );
        });

        // drop boundaries for clusters no longer represented (e.g. switching
        // to a local graph that only shows a handful of notes)
        Array.from(this.boundaries.keys()).forEach((clusterId) => {
            if (seenClusterIds.has(clusterId)) return;
            const entry = this.boundaries.get(clusterId);
            if (entry) this.disposeEntry(scene, entry);
            this.boundaries.delete(clusterId);
        });
    };
}

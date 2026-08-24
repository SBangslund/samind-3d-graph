import { App } from "obsidian";
import { AnalysisData, AnalysisCluster, isAnalysisData } from "./AnalysisData";

export const ANALYSIS_FILE_PATH = ".samind-3d-graph/analysis.json";

// Loads AI-generated clustering/importance/gap data from the vault
// and exposes lookups keyed by note path. Absent or malformed data
// just means the graph falls back to its normal, non-clustered rendering.
export class AnalysisService {
	private data: AnalysisData | null = null;

	constructor(private app: App) {}

	async load(): Promise<void> {
		try {
			const exists = await this.app.vault.adapter.exists(
				ANALYSIS_FILE_PATH
			);
			if (!exists) {
				this.data = null;
				return;
			}
			const raw = await this.app.vault.adapter.read(ANALYSIS_FILE_PATH);
			// Strip UTF-8 BOM if present (some editors write one, V8's JSON.parse rejects it)
			const stripped = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
			const parsed: unknown = JSON.parse(stripped);
			if (!isAnalysisData(parsed)) {
				console.warn(
					"Samind 3D Graph: analysis.json is malformed, ignoring."
				);
				this.data = null;
				return;
			}
			this.data = parsed;
		} catch (e) {
			console.warn("Samind 3D Graph: failed to load analysis.json", e);
			this.data = null;
		}
	}

	hasAnalysis(): boolean {
		return this.data !== null;
	}

	getGeneratedAt(): string | null {
		return this.data?.generatedAt ?? null;
	}

	getClusters(): AnalysisCluster[] {
		return this.data?.clusters ?? [];
	}

	getGaps() {
		return this.data?.gaps ?? [];
	}

	// number of notes assigned to each cluster id, for a legend/breakdown UI
	getClusterNoteCounts(): Record<string, number> {
		const counts: Record<string, number> = {};
		if (!this.data) return counts;
		Object.values(this.data.nodes).forEach((entry) => {
			if (entry.clusterId) {
				counts[entry.clusterId] = (counts[entry.clusterId] ?? 0) + 1;
			}
		});
		return counts;
	}

	getClusterId(path: string): string | null {
		return this.data?.nodes[path]?.clusterId ?? null;
	}

	private getCluster(clusterId: string): AnalysisCluster | undefined {
		return this.data?.clusters.find((c) => c.id === clusterId);
	}

	// Returns the cluster color for a node path, or null if no analysis /
	// no cluster assignment is available for it.
	getClusterColor(path: string): string | null {
		const entry = this.data?.nodes[path];
		if (!entry?.clusterId) return null;
		return this.getCluster(entry.clusterId)?.color ?? null;
	}

	getClusterLabel(path: string): string | null {
		const entry = this.data?.nodes[path];
		if (!entry?.clusterId) return null;
		return this.getCluster(entry.clusterId)?.label ?? null;
	}

	// Returns normalized importance (0-1), or null if unavailable.
	getImportance(path: string): number | null {
		const entry = this.data?.nodes[path];
		return entry?.importance ?? null;
	}

	// Returns the cluster's own importance score (0-1). If the analysis file
	// doesn't carry one (older files), falls back to normalizing note count
	// across all clusters so the most-populated cluster scores 1.0.
	getClusterImportance(clusterId: string): number {
		const cluster = this.getCluster(clusterId);
		if (!cluster) return 0;
		if (cluster.importance !== undefined) return cluster.importance;
		const counts = this.getClusterNoteCounts();
		const maxCount = Math.max(...Object.values(counts), 1);
		return (counts[clusterId] ?? 0) / maxCount;
	}
}

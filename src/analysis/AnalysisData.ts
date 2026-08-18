// Data format written by external AI tooling (e.g. the samind-graph-analysis skill)
// and consumed by the plugin to color/size nodes and surface gap insights.
// The file lives at the vault root: .samind-3d-graph/analysis.json

export interface AnalysisCluster {
	id: string;
	label: string;
	color: string;
}

export interface AnalysisNodeEntry {
	clusterId?: string;
	// normalized importance, 0-1 (e.g. betweenness centrality or a proxy for it)
	importance?: number;
}

export interface AnalysisGap {
	betweenClusters: [string, string];
	insight: string;
	suggestedQuestion?: string;
}

export interface AnalysisData {
	version: number;
	generatedAt: string;
	// keyed by vault-relative file path, matching Obsidian's TFile.path
	nodes: Record<string, AnalysisNodeEntry>;
	clusters: AnalysisCluster[];
	gaps?: AnalysisGap[];
}

export function isAnalysisData(value: unknown): value is AnalysisData {
	if (!value || typeof value !== "object") return false;
	const data = value as Record<string, unknown>;
	return (
		typeof data.version === "number" &&
		typeof data.nodes === "object" &&
		data.nodes !== null &&
		Array.isArray(data.clusters)
	);
}

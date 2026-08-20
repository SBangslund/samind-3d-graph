export type ClusterShape = 'box' | 'convex';

export class DisplaySettings {
	nodeSize = 4;
	linkThickness = 5;
	particleSize = 6;
	particleCount = 4;
	clusterShape: ClusterShape = 'convex';

	constructor(
		nodeSize?: number,
		linkThickness?: number,
		particleSize?: number,
		particleCount?: number,
		clusterShape?: ClusterShape
	) {
		this.nodeSize = nodeSize ?? this.nodeSize;
		this.linkThickness = linkThickness ?? this.linkThickness;
		this.particleSize = particleSize ?? this.particleSize;
		this.particleCount = particleCount ?? this.particleCount;
		this.clusterShape = clusterShape ?? this.clusterShape;
	}

	public static fromStore(store: Partial<DisplaySettings> | undefined) {
		return new DisplaySettings(
			store?.nodeSize,
			store?.linkThickness,
			store?.particleSize,
			store?.particleCount,
			store?.clusterShape
		);
	}

	public toObject() {
		return {
			nodeSize: this.nodeSize,
			linkThickness: this.linkThickness,
			particleSize: this.particleSize,
			particleCount: this.particleCount,
			clusterShape: this.clusterShape,
		};
	}
}

export class ClusterPhysicsSettings {
	// normal (non-exploded) cluster: how tightly members get pulled together
	clusterTargetRadius = 65;
	clusterForceStrength = 4.5;
	// exploded cluster: how far apart members are allowed to spread, and
	// how strongly they push away from each other to fill that space
	explodedTargetRadius = 180;
	explodeRepulsionStrength = 6000;
	// how far apart different clusters' centroids should stay, and how
	// strongly they push apart when closer than that
	interClusterSeparation = 260;
	interClusterRepulsionStrength = 6;

	constructor(
		clusterTargetRadius?: number,
		clusterForceStrength?: number,
		explodedTargetRadius?: number,
		explodeRepulsionStrength?: number,
		interClusterSeparation?: number,
		interClusterRepulsionStrength?: number
	) {
		this.clusterTargetRadius = clusterTargetRadius ?? this.clusterTargetRadius;
		this.clusterForceStrength = clusterForceStrength ?? this.clusterForceStrength;
		this.explodedTargetRadius = explodedTargetRadius ?? this.explodedTargetRadius;
		this.explodeRepulsionStrength = explodeRepulsionStrength ?? this.explodeRepulsionStrength;
		this.interClusterSeparation = interClusterSeparation ?? this.interClusterSeparation;
		this.interClusterRepulsionStrength = interClusterRepulsionStrength ?? this.interClusterRepulsionStrength;
	}

	public static fromStore(store: Partial<ClusterPhysicsSettings> | undefined) {
		return new ClusterPhysicsSettings(
			store?.clusterTargetRadius,
			store?.clusterForceStrength,
			store?.explodedTargetRadius,
			store?.explodeRepulsionStrength,
			store?.interClusterSeparation,
			store?.interClusterRepulsionStrength
		);
	}

	public toObject() {
		return {
			clusterTargetRadius: this.clusterTargetRadius,
			clusterForceStrength: this.clusterForceStrength,
			explodedTargetRadius: this.explodedTargetRadius,
			explodeRepulsionStrength: this.explodeRepulsionStrength,
			interClusterSeparation: this.interClusterSeparation,
			interClusterRepulsionStrength: this.interClusterRepulsionStrength,
		};
	}
}

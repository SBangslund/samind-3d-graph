import { DisplaySettings } from "./categories/DisplaySettings";
import { FilterSettings } from "./categories/FilterSettings";
import { GroupSettings } from "./categories/GroupSettings";
import { ClusterPhysicsSettings } from "./categories/ClusterPhysicsSettings";

export default class GraphSettings {
	filters: FilterSettings;
	groups: GroupSettings;
	display: DisplaySettings;
	clusterPhysics: ClusterPhysicsSettings;

	constructor(
		filterOptions: FilterSettings,
		groupOptions: GroupSettings,
		displayOptions: DisplaySettings,
		clusterPhysicsOptions: ClusterPhysicsSettings
	) {
		this.filters = filterOptions;
		this.groups = groupOptions;
		this.display = displayOptions;
		this.clusterPhysics = clusterPhysicsOptions;
	}

	public static fromStore(store: any) {
		return new GraphSettings(
			FilterSettings.fromStore(store?.filters),
			GroupSettings.fromStore(store?.groups),
			DisplaySettings.fromStore(store?.display),
			ClusterPhysicsSettings.fromStore(store?.clusterPhysics)
		);
	}

	public reset() {
		Object.assign(this.filters, new FilterSettings());
		Object.assign(this.groups, new GroupSettings());
		Object.assign(this.display, new DisplaySettings());
		Object.assign(this.clusterPhysics, new ClusterPhysicsSettings());
	}

	public toObject() {
		return {
			filters: this.filters.toObject(),
			groups: this.groups.toObject(),
			display: this.display.toObject(),
			clusterPhysics: this.clusterPhysics.toObject(),
		};
	}
}

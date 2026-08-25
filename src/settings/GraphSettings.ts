import { DisplaySettings } from "./categories/DisplaySettings";
import { FilterSettings } from "./categories/FilterSettings";
import { GroupSettings } from "./categories/GroupSettings";
import { ClusterPhysicsSettings } from "./categories/ClusterPhysicsSettings";
import { McpSettings } from "./categories/McpSettings";

export default class GraphSettings {
	filters: FilterSettings;
	groups: GroupSettings;
	display: DisplaySettings;
	clusterPhysics: ClusterPhysicsSettings;
	mcp: McpSettings;

	constructor(
		filterOptions: FilterSettings,
		groupOptions: GroupSettings,
		displayOptions: DisplaySettings,
		clusterPhysicsOptions: ClusterPhysicsSettings,
		mcpOptions: McpSettings
	) {
		this.filters = filterOptions;
		this.groups = groupOptions;
		this.display = displayOptions;
		this.clusterPhysics = clusterPhysicsOptions;
		this.mcp = mcpOptions;
	}

	public static fromStore(store: Partial<GraphSettings> | undefined) {
		return new GraphSettings(
			FilterSettings.fromStore(store?.filters),
			GroupSettings.fromStore(store?.groups),
			DisplaySettings.fromStore(store?.display),
			ClusterPhysicsSettings.fromStore(store?.clusterPhysics),
			McpSettings.fromStore(store?.mcp)
		);
	}

	public reset() {
		Object.assign(this.filters, new FilterSettings());
		Object.assign(this.groups, new GroupSettings());
		Object.assign(this.display, new DisplaySettings());
		Object.assign(this.clusterPhysics, new ClusterPhysicsSettings());
		Object.assign(this.mcp, new McpSettings());
	}

	public toObject() {
		return {
			filters: this.filters.toObject(),
			groups: this.groups.toObject(),
			display: this.display.toObject(),
			clusterPhysics: this.clusterPhysics.toObject(),
			mcp: this.mcp.toObject(),
		};
	}
}

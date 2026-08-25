export class McpSettings {
	// Off by default - most users installing this plugin have never heard of
	// MCP/OpenCode, and previously the server started unconditionally on
	// every plugin load with no way to turn it off.
	enabled = false;

	constructor(enabled?: boolean) {
		this.enabled = enabled ?? this.enabled;
	}

	public static fromStore(store: Partial<McpSettings> | undefined) {
		return new McpSettings(store?.enabled);
	}

	public toObject() {
		return {
			enabled: this.enabled,
		};
	}
}

import { Setting } from "obsidian";
import { McpSettings } from "src/settings/categories/McpSettings";
import State from "src/util/State";

const MCP_URL = "http://127.0.0.1:27184/mcp";

const McpSettingsView = (
	mcpSettings: State<McpSettings>,
	containerEl: HTMLElement
) => {
	new Setting(containerEl)
		.setName("Enable MCP server")
		.setDesc(
			`Runs a local server at ${MCP_URL} so an MCP-compatible AI tool (e.g. OpenCode) can query and highlight this graph. Off by default - only enable this if you're actually using it.`
		)
		.addToggle((toggle) => {
			toggle
				.setValue(mcpSettings.value.enabled || false)
				.onChange((value) => {
					mcpSettings.value.enabled = value;
				});
		});
};

export default McpSettingsView;

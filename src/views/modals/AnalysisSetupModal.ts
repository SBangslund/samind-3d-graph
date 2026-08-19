import { App, Modal } from "obsidian";
import Graph3dPlugin from "src/main";

const REPO_URL = "https://github.com/SBangslund/samind-3d-graph";
const SKILL_PATH = "skills/samind-graph-analysis/SKILL.md";

// Walks a new user through generating .samind-3d-graph/analysis.json, since
// the plugin deliberately has no built-in AI backend to do this itself.
export class AnalysisSetupModal extends Modal {
	private readonly plugin: Graph3dPlugin;

	constructor(app: App, plugin: Graph3dPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		this.setTitle("Set up AI clustering");

		this.contentEl.createEl("p", {
			text: "Cluster colors, sizing, and gap insights all come from a single local file - .samind-3d-graph/analysis.json in this vault. The plugin never calls an AI backend itself; any AI assistant can generate that file for you.",
		});

		this.contentEl.createEl("ol", {}, (ol) => {
			ol.createEl("li", {
				text: "Open this vault's folder with an AI assistant that can read/write files - Claude Code, Claude Desktop with filesystem access, or similar.",
			});
			ol.createEl("li", {}, (li) => {
				li.appendText("Point it at the plugin's ");
				li.createEl("code", { text: SKILL_PATH });
				li.appendText(
					" instructions (from the plugin's repository, linked below) and ask it to follow them against this vault - either by installing it as a proper Skill, or just pasting the file's contents and asking Claude to follow them."
				);
			});
			ol.createEl("li", {
				text: "Once it reports the file written, click \"Reload now\" below (or run the \"Reload AI Graph Analysis\" command).",
			});
		});

		const buttonRow = this.contentEl.createDiv({
			cls: "samind-setup-modal-buttons",
		});

		buttonRow
			.createEl("button", { text: "Open plugin repository" })
			.addEventListener("click", () => window.open(REPO_URL, "_blank"));

		const reloadButton = buttonRow.createEl("button", {
			text: "Reload now",
			cls: "mod-cta",
		});
		reloadButton.addEventListener("click", () => {
			void this.plugin.reloadAnalysis();
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

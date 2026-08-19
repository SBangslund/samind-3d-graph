import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { Graph3dView } from "./views/graph/Graph3dView";
import GraphSettings from "./settings/GraphSettings";
import State from "./util/State";
import Graph from "./graph/Graph";
import ObsidianTheme from "./util/ObsidianTheme";
import EventBus from "./util/EventBus";
import { ResolvedLinkCache } from "./graph/Link";
import shallowCompare from "./util/ShallowCompare";
import { AnalysisService } from "./analysis/AnalysisService";

export default class Graph3dPlugin extends Plugin {
	_resolvedCache: ResolvedLinkCache;

	// States
	public settingsState: State<GraphSettings>;
	public openFileState: State<string | undefined> = new State(undefined);
	private cacheIsReady: State<boolean> = new State(
		this.app.metadataCache.resolvedLinks !== undefined
	);

	// Other properties
	public globalGraph: Graph;
	public theme: ObsidianTheme;
	public analysisService: AnalysisService;
	// Graphs that are waiting for cache to be ready
	private queuedGraphs: Graph3dView[] = [];
	private callbackUnregisterHandles: (() => void)[] = [];
	// leaves we've opened, so we can force-close them on unload - otherwise
	// a graph left open across a plugin reload/toggle keeps running with a
	// stale module instance (its own copy of three.js, old closures, etc.),
	// which collides with the freshly loaded instance
	private openLeaves: WorkspaceLeaf[] = [];

	async onload() {
		await this.init();
		this.addRibbonIcon("share-2", "3D Graph", this.openGlobalGraph);
		this.addCommand({
			id: "open-3d-graph-global",
			name: "Open Global 3D Graph",
			callback: this.openGlobalGraph,
		});
		this.addCommand({
			id: "open-3d-graph-local",
			name: "Open Local 3D Graph",
			callback: this.openLocalGraph,
		});
		this.addCommand({
			id: "reload-graph-analysis",
			name: "Reload AI Graph Analysis",
			callback: this.reloadAnalysis,
		});
	}

	private reloadAnalysis = async () => {
		await this.analysisService.load();
		EventBus.trigger("graph-changed");
		new Notice(
			this.analysisService.hasAnalysis()
				? "Graph analysis reloaded"
				: "No analysis found at .samind-3d-graph/analysis.json"
		);
	};

	private async init() {
		await this.initStates();
		this.initListeners();
	}

	private async initStates() {
		const settings = await this.loadSettings();
		this.settingsState = new State<GraphSettings>(settings);
		this.theme = new ObsidianTheme(this.app.workspace.containerEl);
		this.analysisService = new AnalysisService(this.app);
		await this.analysisService.load();
		this.cacheIsReady.value =
			this.app.metadataCache.resolvedLinks !== undefined;
		this.onGraphCacheChanged();
	}

	private initListeners() {
		this.callbackUnregisterHandles.push(
			// save settings on change
			this.settingsState.onChange(() => void this.saveSettings())
		);

		// internal event to reset settings to default
		EventBus.on("do-reset-settings", this.onDoResetSettings);

		// show open local graph button in file menu
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!file) return;
				menu.addItem((item) => {
					item.setTitle("Open in local 3D Graph")
						.setIcon("share-2")
						.onClick(() => this.openLocalGraph());
				});
			})
		);

		// when a file gets opened, update the open file state
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file) this.openFileState.value = file.path;
			})
		);

		this.callbackUnregisterHandles.push(
			// when the cache is ready, open the queued graphs
			this.cacheIsReady.onChange((isReady) => {
				if (isReady) {
					this.openQueuedGraphs();
				}
			})
		);

		// all files are resolved, so the cache is ready:
		this.app.metadataCache.on(
			"resolved",
			this.onGraphCacheReady.bind(this)
		);
		// the cache changed:
		this.app.metadataCache.on(
			"resolve",
			this.onGraphCacheChanged.bind(this)
		);
	}

	// opens all queued graphs (graphs get queued if cache isnt ready yet)
	private openQueuedGraphs() {
		this.queuedGraphs.forEach((view) => view.showGraph());
		this.queuedGraphs = [];
	}

	private onGraphCacheReady = () => {
		this.cacheIsReady.value = true;
		this.onGraphCacheChanged();
	};

	private onGraphCacheChanged = () => {
		// check if the cache actually updated
		// Obsidian API sends a lot of (for this plugin) unnecessary stuff
		// with the resolve event
		if (
			this.cacheIsReady.value &&
			!shallowCompare(
				this._resolvedCache,
				this.app.metadataCache.resolvedLinks
			)
		) {
			this._resolvedCache = structuredClone(
				this.app.metadataCache.resolvedLinks
			);
			this.globalGraph = Graph.createFromApp(this.app);
		}
	};

	private onDoResetSettings = () => {
		this.settingsState.value.reset();
		EventBus.trigger("did-reset-settings");
	};

	// Opens a local graph view in a new leaf
	private openLocalGraph = () => {
		const newFilePath = this.app.workspace.getActiveFile()?.path;

		if (newFilePath) {
			this.openFileState.value = newFilePath;
			this.openGraph(true);
		} else {
			new Notice("No file is currently open");
		}
	};

	// Opens a global graph view in the current leaf
	private openGlobalGraph = () => {
		this.openGraph(false);
	};

	// Open a global or local graph
	private openGraph = (isLocalGraph: boolean) => {
		const leaf = this.app.workspace.getLeaf(isLocalGraph ? "split" : false);
		const graphView = new Graph3dView(this, leaf, isLocalGraph);
		void leaf.open(graphView);
		this.openLeaves.push(leaf);
		if (this.cacheIsReady.value) {
			graphView.showGraph();
		} else {
			this.queuedGraphs.push(graphView);
		}
	};

	private async loadSettings(): Promise<GraphSettings> {
		const loadedData: unknown = await this.loadData();
		return GraphSettings.fromStore(
			loadedData as Partial<GraphSettings> | undefined
		);
	}

	async saveSettings() {
		await this.saveData(this.settingsState.getRawValue().toObject());
	}

	onunload() {
		super.onunload();
		this.openLeaves.forEach((leaf) => leaf.detach());
		this.openLeaves = [];
		this.callbackUnregisterHandles.forEach((handle) => handle());
		EventBus.off("do-reset-settings", this.onDoResetSettings);
	}

	public getSettings(): GraphSettings {
		return this.settingsState.value;
	}
}

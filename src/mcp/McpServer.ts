// MCP (Model Context Protocol) HTTP server for the Samind 3D Graph plugin.
// Exposes the graph structure and highlight controls as MCP tools so an LLM
// (e.g. via OpenCode) can highlight nodes/clusters and read note content while
// talking to the user.
//
// Transport: MCP Streamable HTTP (2025-03-26 spec)
//   POST /mcp  — JSON-RPC 2.0 request → JSON response
//   GET  /mcp  — optional SSE channel (acknowledged but not actively used)
//
// Configure in opencode.json:
//   "mcp": { "samind-graph": { "type": "remote", "url": "http://localhost:27184/mcp" } }

import type { EventRef } from 'obsidian';
import type Graph3dPlugin from 'src/main';
// Marked external in esbuild.config.mjs, so this compiles to a plain
// require("http") in the bundled CJS output - resolved at runtime inside
// Electron rather than bundled.
import * as http from 'http';
import EventBus from 'src/util/EventBus';

const MCP_PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
	jsonrpc: '2.0';
	id?: string | number | null;
	method: string;
	params?: unknown;
}

interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: string | number | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

// Shape of a single MCP tool descriptor
interface McpTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

const TOOLS: McpTool[] = [
	{
		name: 'get_graph_structure',
		description:
			'Returns the full structure of the currently open 3D knowledge graph: ' +
			'all nodes (notes) with their cluster membership and importance score, ' +
			'all clusters, and basic link counts. Use this to understand the vault topology ' +
			'before deciding which nodes or clusters to highlight.',
		inputSchema: {
			type: 'object',
			properties: {},
			required: [],
		},
	},
	{
		name: 'highlight_nodes',
		description:
			'Highlights one or more nodes (notes) in the 3D graph by marking them and their ' +
			'neighbors. Use paths (vault-relative, e.g. "Folder/Note.md") or partial note ' +
			'names when discussing specific notes with the user.',
		inputSchema: {
			type: 'object',
			properties: {
				paths: {
					type: 'array',
					items: { type: 'string' },
					description: 'Vault-relative file paths, e.g. ["Projects/Alpha.md"]',
				},
				names: {
					type: 'array',
					items: { type: 'string' },
					description: 'Note names (without path or extension) for a fuzzy match',
				},
			},
		},
	},
	{
		name: 'highlight_cluster',
		description:
			'Highlights all nodes belonging to a cluster in the 3D graph, dimming everything else. ' +
			'Use the cluster label (e.g. "Machine Learning") or cluster id.',
		inputSchema: {
			type: 'object',
			properties: {
				label: { type: 'string', description: 'Cluster label, case-insensitive partial match' },
				id:    { type: 'string', description: 'Exact cluster id from get_graph_structure' },
			},
		},
	},
	{
		name: 'get_note_snippet',
		description:
			'Returns the first portion of a note\'s content so the LLM can surface a snippet ' +
			'to the user or reason about it without reading the full file.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Vault-relative file path' },
				maxLength: {
					type: 'number',
					description: 'Maximum characters to return (default 600, max 2000)',
				},
			},
			required: ['path'],
		},
	},
	{
		name: 'highlight_and_show',
		description:
			'Highlights nodes AND shows snippet cards in a single call — use this instead of ' +
			'calling highlight_nodes and show_snippets separately. Saves a round-trip.',
		inputSchema: {
			type: 'object',
			properties: {
				nodes: {
					type: 'array',
					description: 'Nodes to highlight and annotate',
					items: {
						type: 'object',
						properties: {
							path:    { type: 'string', description: 'Vault-relative file path' },
							snippet: { type: 'string', description: 'Text to show in card (auto-fetched if omitted)' },
						},
						required: ['path'],
					},
				},
				names: {
					type: 'array',
					items: { type: 'string' },
					description: 'Fuzzy name matches — resolved to paths automatically',
				},
			},
		},
	},
	{
		name: 'show_snippets',
		description:
			'Displays 2D overlay cards on the graph, each anchored to a node with a connector line. ' +
			'Use after highlight_nodes to surface relevant excerpts from the notes being discussed. ' +
			'Automatically fetches note content if snippets are not provided.',
		inputSchema: {
			type: 'object',
			properties: {
				nodes: {
					type: 'array',
					description: 'One entry per note to annotate',
					items: {
						type: 'object',
						properties: {
							path:    { type: 'string', description: 'Vault-relative file path' },
							snippet: { type: 'string', description: 'Text to show in the card (auto-fetched if omitted)' },
						},
						required: ['path'],
					},
				},
			},
			required: ['nodes'],
		},
	},
	{
		name: 'clear_highlights',
		description: 'Clears any MCP-driven highlights from the graph, returning it to its idle state.',
		inputSchema: { type: 'object', properties: {}, required: [] },
	},
];

export class McpServer {
	private server: http.Server | null = null;
	private port: number;
	// Cached graph structure — rebuilt on graph-changed, served instantly after
	private structureCache: string | null = null;
	private graphChangedRef: EventRef | null = null;

	constructor(private readonly plugin: Graph3dPlugin, port = 27184) {
		this.port = port;
	}

	isRunning(): boolean {
		return this.server !== null;
	}

	start(): void {
		if (this.server) return; // already running - avoid orphaning the old listener

		this.server = http.createServer((req, res) => {
			this.handleRequest(req, res).catch((err) => {
				console.error('Samind MCP: unhandled error', err);
				if (!res.headersSent) {
					res.writeHead(500);
					res.end('Internal server error');
				}
			});
		});

		this.server.listen(this.port, '127.0.0.1');

		this.server.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				console.warn(`Samind MCP: port ${this.port} already in use — MCP server not started`);
			} else {
				console.error('Samind MCP server error:', err);
			}
		});

		this.graphChangedRef = EventBus.on('graph-changed', () => { this.structureCache = null; });
	}

	stop(): void {
		this.server?.close();
		this.server = null;
		if (this.graphChangedRef) EventBus.offref(this.graphChangedRef);
	}

	private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		// Deliberately no Access-Control-Allow-* headers: real MCP clients
		// (OpenCode, etc.) are native/CLI tools that don't send an Origin
		// header and aren't subject to CORS at all. Adding a wildcard CORS
		// header here would do nothing for them but let any webpage open in
		// a browser on this machine read vault content from this server via
		// fetch() - a classic localhost-plus-wildcard-CORS drive-by hole.
		// Without it, the browser's own same-origin policy blocks that.

		const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);

		if (url.pathname !== '/mcp') {
			res.writeHead(404);
			res.end('Not found');
			return;
		}

		// SSE channel (GET /mcp) — acknowledged but we rely on request/response only
		if (req.method === 'GET') {
			res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
			res.write(': samind-graph mcp sse channel\n\n');
			// Keep alive; the connection will close when the client disconnects
			req.on('close', () => res.end());
			return;
		}

		if (req.method !== 'POST') {
			res.writeHead(405);
			res.end('Method not allowed');
			return;
		}

		let body = '';
		for await (const chunk of req) {
			body += chunk;
		}

		let rpcReq: JsonRpcRequest;
		try {
			rpcReq = JSON.parse(body) as JsonRpcRequest;
		} catch {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
			return;
		}

		const response = await this.dispatch(rpcReq);

		// Notifications (no id) get no response
		if (response === null) {
			res.writeHead(204);
			res.end();
			return;
		}

		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(response));
	}

	private async dispatch(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
		const id = req.id ?? null;

		// Notifications have no id and need no response
		if (req.id === undefined) {
			return null;
		}

		try {
			switch (req.method) {
				case 'initialize':
					return {
						jsonrpc: '2.0', id,
						result: {
							protocolVersion: MCP_PROTOCOL_VERSION,
							capabilities: { tools: {} },
							serverInfo: { name: 'samind-3d-graph', version: '1.0.0' },
						},
					};

				case 'tools/list':
					return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

				case 'tools/call':
					return { jsonrpc: '2.0', id, result: await this.callTool(req.params as Record<string, unknown>) };

				case 'ping':
					return { jsonrpc: '2.0', id, result: {} };

				default:
					return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${req.method}` } };
			}
		} catch (err) {
			return {
				jsonrpc: '2.0', id,
				error: { code: -32603, message: 'Internal error', data: String(err) },
			};
		}
	}

	private async callTool(params: Record<string, unknown>): Promise<unknown> {
		const name = params?.name as string;
		const args = (params?.arguments ?? {}) as Record<string, unknown>;

		let result: unknown;
		switch (name) {
			case 'get_graph_structure':
				result = this.toolGetGraphStructure(); break;
			case 'highlight_nodes':
				result = this.toolHighlightNodes(args); break;
			case 'highlight_cluster':
				result = this.toolHighlightCluster(args); break;
			case 'get_note_snippet':
				result = await this.toolGetNoteSnippet(args); break;
			case 'highlight_and_show':
				result = await this.toolHighlightAndShow(args); break;
			case 'show_snippets':
				result = await this.toolShowSnippets(args); break;
			case 'clear_highlights':
				result = this.toolClearHighlights(); break;
			default:
				throw new Error(`Unknown tool: ${name}`);
		}

		// MCP spec: tools/call result must be { content: [{ type, text }] }
		return {
			content: [{ type: 'text', text: JSON.stringify(result) }],
			isError: false,
		};
	}

	// ── Tool implementations ───────────────────────────────────────────────

	private toolGetGraphStructure(): unknown {
		// Serve from cache when available — rebuilding 150+ nodes on every call
		// adds latency and token cost for no benefit; invalidated on graph-changed
		if (this.structureCache) return JSON.parse(this.structureCache);

		const graph = this.plugin.globalGraph;
		const analysis = this.plugin.analysisService;

		if (!graph) {
			return { error: 'Graph not yet initialised — open the vault first.' };
		}

		const clusterNodeCounts = analysis.getClusterNoteCounts();

		// Only include nodes that have analysis data or links — pure isolated
		// orphans with no cluster/importance add tokens without useful signal
		const nodes = graph.nodes
			.filter((n) => n.links.length > 0 || analysis.getClusterId(n.path) !== null)
			.map((node) => {
				const clusterId  = analysis.getClusterId(node.path);
				const importance = analysis.getImportance(node.path);
				// Keep keys short to minimize token cost; omit nulls
				const entry: Record<string, unknown> = {
					p: node.path,
					n: node.name.replace(/\.md$/, ''),
					l: node.links.length,
				};
				if (clusterId)  entry.c = clusterId;
				if (importance !== null) entry.i = Math.round(importance * 100) / 100;
				return entry;
			});

		const clusters = analysis.getClusters().map((c) => ({
			id:    c.id,
			label: c.label,
			color: c.color,
			imp:   Math.round(analysis.getClusterImportance(c.id) * 100) / 100,
			count: clusterNodeCounts[c.id] ?? 0,
		}));

		const result = {
			nodes,
			clusters,
			// legend so the LLM knows the short key names
			_keys: 'nodes: p=path, n=name, l=linkCount, c=clusterId, i=importance(0-1)',
			totalNodes: graph.nodes.length,
			totalLinks: graph.links.length,
		};

		this.structureCache = JSON.stringify(result);
		return result;
	}

	private toolHighlightNodes(args: Record<string, unknown>): unknown {
		const graph = this.plugin.globalGraph;
		if (!graph) return { error: 'Graph not initialised' };

		const paths  = (args.paths  as string[] | undefined) ?? [];
		const names  = (args.names  as string[] | undefined) ?? [];

		// Resolve names → paths via fuzzy match (case-insensitive contains)
		const resolvedPaths = new Set(paths);
		if (names.length > 0) {
			graph.nodes.forEach((node) => {
				const nameLower = node.name.toLowerCase().replace(/\.md$/, '');
				if (names.some((n) => nameLower.includes(n.toLowerCase()))) {
					resolvedPaths.add(node.path);
				}
			});
		}

		if (resolvedPaths.size === 0) {
			return { error: 'No matching nodes found', paths, names };
		}

		const graphView = this.plugin.getActiveGraphView();
		if (!graphView) {
			return { warning: 'Graph view not open — nodes matched but cannot highlight', matched: [...resolvedPaths] };
		}

		graphView.getForceGraph().mcpHighlightNodes([...resolvedPaths]);
		return { highlighted: [...resolvedPaths] };
	}

	private toolHighlightCluster(args: Record<string, unknown>): unknown {
		const label = args.label as string | undefined;
		const id    = args.id    as string | undefined;

		const clusters = this.plugin.analysisService.getClusters();
		let cluster = clusters.find((c) =>
			id ? c.id === id
			   : label ? c.label.toLowerCase().includes(label.toLowerCase())
			   : false
		);

		if (!cluster) {
			return { error: 'Cluster not found', label, id };
		}

		const graphView = this.plugin.getActiveGraphView();
		if (!graphView) {
			return { warning: 'Graph view not open — cluster found but cannot highlight', cluster: cluster.label };
		}

		graphView.getForceGraph().mcpHighlightCluster(cluster.id);
		return { highlighted: { id: cluster.id, label: cluster.label } };
	}

	private async toolGetNoteSnippet(args: Record<string, unknown>): Promise<unknown> {
		const path      = args.path as string | undefined;
		const maxLength = Math.min(Number(args.maxLength ?? 600), 2000);

		if (!path) return { error: 'path is required' };

		const file = this.plugin.app.vault.getFileByPath(path);
		if (!file) return { error: `File not found: ${path}` };

		try {
			const content = await this.plugin.app.vault.cachedRead(file);
			return {
				path,
				snippet: content.slice(0, maxLength),
				totalLength: content.length,
				truncated: content.length > maxLength,
			};
		} catch (err) {
			return { error: `Could not read file: ${String(err)}` };
		}
	}

	private async toolHighlightAndShow(args: Record<string, unknown>): Promise<unknown> {
		const graph = this.plugin.globalGraph;
		if (!graph) return { error: 'Graph not initialised' };

		const inputNodes = (args.nodes as Array<{ path: string; snippet?: string }> | undefined) ?? [];
		const names = (args.names as string[] | undefined) ?? [];

		// Resolve fuzzy names → paths
		const resolvedPaths = new Set(inputNodes.map((n) => n.path).filter(Boolean));
		if (names.length > 0) {
			graph.nodes.forEach((node) => {
				const nameLower = node.name.toLowerCase().replace(/\.md$/, '');
				if (names.some((n) => nameLower.includes(n.toLowerCase()))) {
					resolvedPaths.add(node.path);
				}
			});
		}

		if (resolvedPaths.size === 0) return { error: 'No matching nodes found' };

		// Build snippet entries (fetch content in parallel)
		const snippetMap = new Map(inputNodes.map((n) => [n.path, n.snippet]));
		const entries = await Promise.all([...resolvedPaths].map(async (path) => {
			const file = this.plugin.app.vault.getFileByPath(path);
			let snippetText = snippetMap.get(path) ?? '';
			if (!snippetText && file) {
				try {
					const content = await this.plugin.app.vault.cachedRead(file);
					snippetText = content.slice(0, 300).trimEnd();
					if (content.length > 300) snippetText += '…';
				} catch { snippetText = ''; }
			}
			const nodeInGraph = graph.getNodeById(path);
			const title = nodeInGraph?.name.replace(/\.md$/, '') ?? (file?.basename ?? path);
			return { path, title, snippet: snippetText, color: this.plugin.analysisService.getClusterColor(path) ?? undefined };
		}));

		const graphView = this.plugin.getActiveGraphView();
		if (!graphView) return { warning: 'Graph view not open', matched: [...resolvedPaths] };

		const forceGraph = graphView.getForceGraph();
		forceGraph.mcpHighlightNodes([...resolvedPaths]);
		forceGraph.mcpShowSnippets(entries);
		return { highlighted: [...resolvedPaths] };
	}

	private async toolShowSnippets(args: Record<string, unknown>): Promise<unknown> {
		const nodes = (args.nodes as Array<{ path: string; snippet?: string }> | undefined) ?? [];
		if (nodes.length === 0) return { error: 'nodes array is required' };

		const graph = this.plugin.globalGraph;
		const analysis = this.plugin.analysisService;
		const graphView = this.plugin.getActiveGraphView();

		const entries: Array<{ path: string; title: string; snippet: string; color?: string }> = [];

		for (const item of nodes) {
			const file = this.plugin.app.vault.getFileByPath(item.path);
			if (!file) continue;

			// Auto-fetch snippet if not provided
			let snippetText = item.snippet ?? '';
			if (!snippetText) {
				try {
					const content = await this.plugin.app.vault.cachedRead(file);
					snippetText = content.slice(0, 300).trimEnd();
					if (content.length > 300) snippetText += '…';
				} catch { snippetText = ''; }
			}

			const nodeInGraph = graph?.getNodeById(item.path);
			const title = nodeInGraph?.name.replace(/\.md$/, '') ?? file.basename;
			const color = analysis.getClusterColor(item.path) ?? undefined;

			entries.push({ path: item.path, title, snippet: snippetText, color });
		}

		if (!graphView) {
			return { warning: 'Graph view not open — cannot show snippets', entries: entries.length };
		}

		graphView.getForceGraph().mcpShowSnippets(entries);
		return { shown: entries.map((e) => e.path) };
	}

	private toolClearHighlights(): unknown {
		const graphView = this.plugin.getActiveGraphView();
		if (!graphView) return { warning: 'Graph view not open' };
		graphView.getForceGraph().mcpClearHighlights();
		return { cleared: true };
	}
}

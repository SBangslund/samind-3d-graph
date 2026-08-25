# Changelog

All notable changes to this plugin are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [2.3.2] - 2026-08-25

### Fixed

- `McpServer.ts` mixed a type-only `import type {...} from 'http'` with a separate runtime `require('http')` cast via `as typeof import('http')` - under the review's type-checking this resolved `Server` to TypeScript's internal `error` placeholder rather than a real type, cascading into "unsafe any" warnings across nearly the entire file. Replaced with a single `import * as http from 'http'` (still compiles to the same externalized `require("http")` in the bundle, since `http` is already marked external in esbuild.config.mjs) - no `require()` call or eslint-disable needed at all
- `SnippetOverlayService.ts`: SVG elements were created via `document.createElementNS(...) as SVGSVGElement`/`as SVGLineElement`; switched to Obsidian's typed `createSvg()` helper, which needs no assertion
- Remaining direct `.style.*`/`.style.setProperty()` mutations in `SnippetOverlayService.ts` replaced with `setCssStyles`/`setCssProps`

## [2.3.1] - 2026-08-25

2.3.0 never actually published - its own release build failed the same
`tsc` error below, so no release/assets exist for it. This supersedes it.

### Fixed

- Build was broken: `registerHoverLinkSource` was called on `app.workspace`, but it's a method on `Plugin` itself (`this.registerHoverLinkSource(...)`) - the release workflow's own build step failed the same way, so 2.3.0 never got far enough to reach the community review
- MCP server sent `Access-Control-Allow-Origin: *` with no authentication, while exposing tools that read arbitrary vault file content - real MCP clients (OpenCode, etc.) are native/CLI tools that don't send an `Origin` header and aren't subject to CORS at all, so this only ever served to let any webpage open in a browser on the same machine read vault content via `fetch()`. Removed entirely - the browser's own same-origin policy now blocks that

### Changed

- MCP server is now **off by default**, behind a new toggle in the graph's Settings panel (gear icon → MCP Server) - it previously started unconditionally on every plugin load
- README's privacy section updated to describe the optional MCP server truthfully instead of claiming no network activity at all

## [2.3.0] - 2026-08-24

### Added

- **MCP server** — the plugin starts a local MCP server on `http://localhost:27184/mcp` when loaded, exposing the graph to any MCP-compatible AI (e.g. OpenCode). Configure with `"mcp": { "samind-graph": { "type": "remote", "url": "http://localhost:27184/mcp" } }` in `opencode.json`
- **MCP tools**: `get_graph_structure`, `highlight_nodes`, `highlight_cluster`, `highlight_and_show`, `show_snippets`, `get_note_snippet`, `clear_highlights`
- **Snippet overlay cards** — the AI can attach floating 2D cards to nodes showing note excerpts, connected by a dashed line that tracks the node as you rotate/zoom. Cards expand to fit content and scroll at max-height
- **Snippet backdrop** — a dimming overlay fades in behind cards to reduce graph clutter when snippets are visible
- **Obsidian MarkdownRenderer in snippet cards** — `[[wikilinks]]` and markdown formatting render properly; Mod+hover triggers Obsidian's page-preview popup
- **Ctrl/Cmd+click node** — shows a hover preview popup instead of opening the file, for quick browsing without leaving the graph
- **Locked highlights** — MCP highlights and "Show in graph" gap-insight highlights now persist through mouse movement; only a background click/right-click dismisses them (including any open snippet cards)
- **`highlight_and_show` combined tool** — highlights nodes and shows snippet cards in a single MCP round-trip instead of two separate calls
- **SKILL.md MCP section** — documents all MCP tools, recommended flow, and OpenCode setup so the AI uses them proactively

### Changed

- `get_graph_structure` response is cached and invalidated on graph changes — subsequent calls are instant
- MCP responses use compact JSON (no pretty-printing) to reduce token cost
- Nodes without cluster assignments or links are omitted from `get_graph_structure` to reduce payload size

### Fixed

- `analysis.json` with a UTF-8 BOM (written by some Windows editors) was silently rejected by `JSON.parse`, causing clustering and AI analysis to appear absent — BOM is now stripped before parsing
- MCP `tools/call` responses were missing the required `content` array wrapper, causing the LLM to receive results it couldn't interpret
- MCP node highlights no longer accidentally activate the cluster boundary highlight for the highlighted nodes' cluster

## [2.2.1] - 2026-08-21

### Fixed

- `minAppVersion` was still declared as `1.2.3`, but 2.2.0's `getFileByPath()` node-click lookup requires `1.5.7` - bumped to match

## [2.2.0] - 2026-08-20

### Added

- **Convex hull cluster boundaries** — clusters now wrap their actual node positions instead of an axis-aligned box; switchable back to box via a new *Cluster Shape* dropdown in Display settings
- **Translucent cluster fill** — a coloured semi-transparent volume inside each boundary makes cluster territories immediately readable at a glance
- **Freeze Layout toggle** — stops the physics simulation so nodes stay put; re-enabling it reheats the simulation. Double-clicking a cluster to explode it is also blocked while frozen
- **Landmark node labels** — the top 8 most important nodes always show their label regardless of mouse position, sized and weighted by their importance score (falls back to link count when no AI analysis is loaded)
- **Cluster importance score** (`importance` field on clusters in `analysis.json`) — drives label font size and weight so the most prevalent topics stand out; the AI skill has been updated to generate this field
- **Always-visible cluster labels** — cluster labels are now permanently visible at base opacity instead of only appearing on mouse hover

### Changed

- Cluster boundary opacity raised significantly (box 0.35→0.55, fill 0.07→0.13, label 0.6→0.75) for better readability
- Convex hull expands beyond its nodes by `BOX_PADDING` so the boundary is easier to hover and click
- Minimum node count for convex hull lowered from 4 to 2 (degenerate cases fall back to box automatically)
- Physics simulation default `cooldownTime` reduced from 15 s to 8 s for faster settling

### Fixed

- Release workflow now includes `SKILL.md` as a release asset
- Clicking a node in a highlighted cluster caused severe lag — `checkRelations` was cloning the entire graph on every recursive ancestor step; it now reads the source graph directly and a `visited` guard prevents infinite loops on bidirectional links
- Node click file lookup was O(n) (`vault.getFiles().find()`); now O(1) via `vault.getFileByPath()`
- Convex hull was offset because vertices were in world space but then repositioned by the cluster centroid; vertices are now centroid-relative before hull construction
- Orphan nodes were kept in the physics simulation even when hidden (only `nodeVisibility` hid them visually); they are now excluded from `graphData` entirely, removing their simulation and render cost
- Exploding a cluster no longer reheats the simulation when *Freeze Layout* is on

## [2.1.0] - 2026-08-19

### Added

- First-run onboarding: a dismissible banner in the graph view when no AI analysis exists yet, with a step-by-step setup modal explaining how to generate one

### Fixed

- Cluster boxes fully enclosed by another cluster's box were permanently unreachable by hover/click - hit-testing now prefers the innermost contained box instead of always picking the nearest outer one

## [2.0.4] - 2026-08-19

### Fixed

- `minAppVersion` was declared as `0.15.0` despite using APIs (`setDisabled`, `setCssStyles`, `setCssProps`) that require `1.2.3`
- `JSON.parse()` and `loadData()` results were implicitly typed `any`; now explicit
- An unhandled `leaf.open()` promise

## [2.0.3] - 2026-08-19

### Fixed

- Full pass on the Obsidian community plugin review: removed `any`-suppressing lint directives in favor of real typing, replaced direct `.style.*` mutations with `setCssStyles`, replaced `document.createElement` with Obsidian's `createEl`/`createDiv` helpers, prefixed `requestAnimationFrame`/`cancelAnimationFrame` with `window.`, removed leftover debug logging, fixed floating/unhandled promises

### Changed

- Bumped the `obsidian` type-declarations package from a stale `0.16.3` to `1.13.1`
- Replaced the `builtin-modules` dependency with Node's own `node:module` builtins

### Security

- Patched `@babel/runtime` and `ajv` transitive dependency advisories

## [2.0.2] - 2026-08-19

### Fixed

- Manifest `description` contained "Obsidian", which the community directory disallows

## [2.0.1] - 2026-08-19

### Fixed

- Plugin `id` contained a digit (`samind-3d-graph`), which the community directory disallows - changed to `samind-graph`

## [2.0.0] - 2026-08-19

First public release. Bundles all prior development.

### Added

- 3D force-directed graph view for Obsidian, with node/link hover highlighting and parent/neighbor highlighting
- AI-generated cluster and importance analysis, read from a local `.samind-3d-graph/analysis.json` file (never generated by the plugin itself - a companion Claude Skill is included)
- Dashed boundary boxes and titles drawn around each AI cluster
- Spatial clustering physics force, with live-tunable settings (target radius, force strength, exploded radius/repulsion, inter-cluster separation/repulsion)
- Explode interaction - double-click a cluster's box or title to spread it apart and frame the camera
- Gap Insights panel surfacing AI-found structural gaps between clusters, with "Show in graph" highlighting
- Cluster legend panel (color, note count, share of vault)
- "Reload AI Graph Analysis" command

### Changed

- Node/cluster labels now declutter by camera distance, mouse proximity, and importance instead of always rendering
- Highlighted link color changed to orange for better visibility across themes

### Fixed

- CSS2DRenderer type mismatch with three's `Renderer` type
- Graph rendering at a stale size when a view is first opened
- "Illegal constructor" on custom-element classes after hot-reload
- Plugin instances left running after hot-reload, colliding with freshly-loaded ones
- A `d3ReheatSimulation()` race that could crash on init
- Label flicker on hover
- Cursor stuck as a pointer over empty background
- Cluster hover/highlighting getting permanently stuck after opening any note
- Neighbor labels not showing when hovering a node

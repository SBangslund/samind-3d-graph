---
name: samind-graph-analysis
description: Analyzes an Obsidian vault's notes and links to produce topical clusters, per-note importance, and knowledge-gap insights for the Samind 3D Graph plugin. Use when the user asks to (re)generate, refresh, or update the 3D graph's clustering/analysis data for an Obsidian vault.
---

# Samind Graph Analysis

Reads the notes in an Obsidian vault and writes a single JSON file that the
Samind 3D Graph plugin uses to color nodes by topic cluster, size nodes by
importance, and surface "gap" insights between clusters — similar in spirit
to InfraNodus, but computed by you (the AI) rather than a paid backend.

## Output

Write to `<vault root>/.samind-3d-graph/analysis.json` (create the folder if
it doesn't exist). This path is vault-relative and separate from the plugin's
own code — it is vault data, not plugin data.

### Schema

```json
{
  "version": 1,
  "generatedAt": "2026-08-18T12:34:56Z",
  "generatedBy": "claude (semantic analysis)",
  "clusters": [
    { "id": "c1", "label": "Machine Learning", "color": "#4f8fd1", "importance": 0.85 },
    { "id": "c2", "label": "Personal Journaling", "color": "#d1774f", "importance": 0.42 }
  ],
  "nodes": {
    "Ideas/VR Learning Platform.md": { "clusterId": "c1", "importance": 0.82 },
    "Kategorier/Filosofi/Filosofi.md": { "clusterId": "c2", "importance": 0.41 }
  },
  "gaps": [
    {
      "betweenClusters": ["c1", "c2"],
      "insight": "Notes on machine learning rarely connect to notes on personal habits, despite both discussing reinforcement and feedback loops.",
      "suggestedQuestion": "How could reinforcement learning concepts apply to personal habit formation?"
    }
  ]
}
```

Field notes:
- `nodes` keys are vault-relative file paths **exactly** as Obsidian would
  report them (forward slashes, no leading `./`, case-sensitive, including
  the `.md` extension). This must match `TFile.path`.
- `importance` on a **cluster** is a float normalized to 0-1 across all clusters
  (1 = most prominent/central topic in the vault). Used to scale label size in
  the graph — the most important clusters get larger, bolder labels.
- `importance` on a **node** is a float normalized to the 0-1 range across the whole vault
  (1 = most important/central note). The graph always shows the labels of the top 8
  most important nodes as permanent landmarks — score generously but realistically;
  the top few nodes will always be labelled regardless of the exact values.
- `clusterId` must reference an entry in `clusters`.
- `color` should be a hex string; keep clusters visually distinct.
- `gaps` is optional — omit it or leave it `[]` if you don't have enough
  signal to make a grounded claim. Never fabricate an insight you can't tie
  to actual note content.

## Process

1. **Enumerate notes.** List all `.md` files in the vault, excluding
   `.obsidian/`, `.trash/`, `.git/`, and `.samind-3d-graph/` itself.
2. **Read content.** For each note, read its text. For large vaults, reading
   every note in full may be impractical — prioritize note titles,
   headings, and the first few hundred words, plus full text for notes that
   look central (many links, short/hub-like names).
3. **Extract the link graph.** Find `[[wikilinks]]` (strip `#heading` and
   `|alias` suffixes) to know which notes reference which.
4. **Cluster by topic.** Group notes into topical clusters using both your
   semantic understanding of the content *and* the link structure (notes
   that link to each other a lot are likely in the same or adjacent
   clusters). Aim for clusters that are meaningful at a glance — few enough
   to be legible (roughly 5-20 for a few hundred notes), each with a short,
   human-readable label. This is the part a pure graph algorithm can't do
   well: use your judgment about what the notes are actually *about*, not
   just folder structure or link density.
5. **Score importance.** Compute two separate importance scores:
   - **Per-node** (`nodes[path].importance`): combine link centrality (in-links +
     out-links, normalized) with your own judgment of how conceptually central a
     note is to its cluster or to the vault as a whole. Normalize to 0-1 across
     all notes.
   - **Per-cluster** (`clusters[n].importance`): reflect the cluster's overall
     prominence in the vault — consider note count, total link weight into/out of
     the cluster, and how central its topic is to the vault's main themes.
     Normalize to 0-1 across all clusters (the most prevalent topic scores 1.0).
     This is used to make the most important cluster labels larger and bolder in
     the graph.
6. **Find gaps.** Look for pairs of clusters that are thematically related
   but structurally under-connected (few or no links between their notes).
   For each real gap you find, write one concrete insight and one concrete
   research question grounded in the actual note content — not generic
   advice. Skip this step entirely rather than inventing a gap that isn't
   real.
7. **Write the file.** Emit valid JSON matching the schema above. Overwrite
   any existing `.samind-3d-graph/analysis.json`.

## After writing

Tell the user the file has been (re)generated and that they can either:
- run the **"Reload AI Graph Analysis"** command in Obsidian, or
- reopen the 3D Graph view

to see the updated clusters/sizing.

---

# Samind Graph MCP — Live Graph Interaction

The Samind 3D Graph plugin also exposes a **local MCP server** on
`http://localhost:27184/mcp` while the plugin is loaded. This gives you live,
two-way control of the graph while talking to the user — highlight relevant
nodes, surface note snippets, and query the vault topology **without the user
having to navigate manually**.

## When to use

Use the graph MCP tools proactively whenever:
- You are discussing specific notes or topics — highlight the relevant nodes
  so the user can see where they sit in the knowledge graph.
- You are explaining a cluster or theme — call `highlight_cluster` to dim
  everything else.
- You want to surface a quote or excerpt — call `show_snippets` to attach
  floating cards to the nodes in question.
- The user asks about the structure of their vault — call
  `get_graph_structure` first to ground your answer in real topology data.

Always call `clear_highlights` when moving to a new topic or at the end of
a conversation about the graph, so the user's graph returns to its idle state.

## Tools

### `get_graph_structure`
Returns all nodes with cluster memberships, importance scores, and link counts,
plus all cluster metadata. Call this before reasoning about the vault structure
so your answers are grounded in the actual graph, not guesses.

**No input required.**

Returns:
```json
{
  "nodes": [{ "path": "...", "name": "...", "clusterId": "c1", "clusterLabel": "Machine Learning", "importance": 0.82, "linkCount": 14 }],
  "clusters": [{ "id": "c1", "label": "Machine Learning", "color": "#4f8fd1", "importance": 0.9, "nodeCount": 23 }],
  "totalNodes": 154,
  "totalLinks": 412
}
```

---

### `highlight_nodes`
Highlights one or more nodes in the graph. Primary nodes render **white and
enlarged**; their direct neighbors show at normal color; everything else dims.
The highlight persists until `clear_highlights` is called or the user
right-clicks the background.

```json
{ "paths": ["Projects/Alpha.md", "Ideas/Beta.md"] }
```
Or by partial name (case-insensitive fuzzy match):
```json
{ "names": ["Alpha", "reinforcement learning"] }
```

---

### `highlight_cluster`
Highlights all nodes in a cluster, dimming the rest. Use when discussing a
topic area rather than specific notes.

```json
{ "label": "Machine Learning" }
```
Or by exact id:
```json
{ "id": "c1" }
```

---

### `show_snippets`
Attaches floating 2D cards to highlighted nodes — each card shows a note
title and an excerpt, connected to its node by a dashed line. Positions
update live as the user rotates/zooms the graph.

Call this after `highlight_nodes` to give the user immediate context.
If `snippet` is omitted, the first ~300 characters are fetched automatically.

```json
{
  "nodes": [
    { "path": "Projects/Alpha.md" },
    { "path": "Ideas/Beta.md", "snippet": "A specific excerpt you want to surface" }
  ]
}
```

---

### `get_note_snippet`
Returns the first portion of a single note's content (up to 2000 characters).
Use when you need to read a note before deciding what to surface, without
committing it to the graph UI.

```json
{ "path": "Projects/Alpha.md", "maxLength": 600 }
```

---

### `clear_highlights`
Clears all MCP-driven highlights and snippet cards, returning the graph to
its idle state.

**No input required.**

---

## Recommended flow

```
1. get_graph_structure          ← understand the vault topology
2. highlight_nodes / highlight_cluster  ← draw the user's attention
3. show_snippets                ← surface the relevant content
4. ... conversation continues ...
5. clear_highlights             ← clean up when done
```

## Setup (one-time, for the user)

Add to `opencode.json`:
```json
"mcp": {
  "samind-graph": {
    "type": "remote",
    "url": "http://localhost:27184/mcp"
  }
}
```

The server starts automatically when the plugin loads and stops when it
unloads. It only accepts connections from `127.0.0.1`.

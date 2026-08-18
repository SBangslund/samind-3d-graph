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
    { "id": "c1", "label": "Machine Learning", "color": "#4f8fd1" },
    { "id": "c2", "label": "Personal Journaling", "color": "#d1774f" }
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
- `importance` is a float normalized to the 0-1 range across the whole vault
  (1 = most important/central note).
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
5. **Score importance.** Combine link centrality (in-links + out-links,
   normalized) with your own judgment of how conceptually central a note is
   to its cluster or to the vault as a whole. Normalize to 0-1.
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

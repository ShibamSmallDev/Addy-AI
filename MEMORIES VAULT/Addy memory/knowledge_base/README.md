# Personal Knowledge Base — built from a ChatGPT export

Generated from `chat.html` (393 conversations, Jan 2023 – Jul 2026, ~1.04M words).

## What's in here

```
constitution.md                 ← Start here. The master "who this person is" briefing.
memory/
  people/                       ← One file per person (self + 8 others), Obsidian-style
  projects/                     ← One file per project/persona (AirCursor, Addy-AI, Addy
                                   persona, Chesta, numerology practice)
  places/                       ← West Bengal, Bardhaman, Malda
  events/
    timeline.md                 ← Chronological narrative, 2023 → 2026
    self_context_exports.md     ← The user's own repeated attempts to do this exact task
    flagged_items.md            ← Two sensitive items, logged for completeness only
data/
  facts.json                    ← The Phase-1 structured-facts extraction, machine-readable
  conversations_index.json      ← Metadata catalog of all 393 conversations (title, date,
                                   word count, and a "deep_dive" vs "light_pass" tier flag)
  graph_nodes.json / .csv        ← Knowledge-graph nodes (26)
  graph_edges.json / .csv        ← Knowledge-graph edges (29), relationship-typed
```

## How to use it

- **As a system prompt / project instructions for an AI assistant:** paste
  `constitution.md` in directly. It's written to be dropped into Claude Projects
  custom instructions, a custom GPT's instructions, or any assistant's system
  prompt, so it can pick up context immediately.
- **As an Obsidian vault:** point Obsidian at the `memory/` folder. All the
  `[[wikilinks]]` between people/projects/places/events will resolve and render as
  a linked graph inside Obsidian.
- **As a generic knowledge graph:** `data/graph_nodes.csv` and
  `data/graph_edges.csv` use Neo4j's `LOAD CSV`-friendly headers
  (`id:ID`, `type:LABEL`, `:START_ID`, `:END_ID`, `relation:TYPE`) and also import
  cleanly into Gephi or any other graph tool that reads CSV edge lists.
- **As raw data for anything else:** `data/facts.json` has the full structured
  extraction (person, people, projects, places, goals, timeline, evidence quotes)
  in one file if you'd rather parse it yourself.

## Methodology (so you can judge how much to trust it)

- All 393 conversations were parsed and indexed (see `conversations_index.json`).
- Every conversation was scored for "personal signal" (mentions of relationships,
  goals, emotions, names, etc. vs. one-line homework/trivia answers).
- The top ~80 conversations by that score — plus the two dominant long-running
  project threads ("Air Cursor Main chat" and "Addy-AI main chat," which together
  are nearly 70,000 words of the user's own messages) — were read directly to
  extract the facts in this package.
- The full chronological run of the *user's own messages* across all 393
  conversations (about 123,000 words once assistant replies are excluded) was also
  read in full, in date order, to catch anything the scorer might have missed.
- Routine one-off Q&A (math drills, single-line homework answers, near-duplicate
  image-generation prompts) was catalogued by title/date/word-count but not
  narrated fact-by-fact — there were hundreds of these and they don't carry
  much identity-level signal beyond "does a lot of AI image generation" and
  "gets a lot of homework help," both of which are captured qualitatively.
- Every fact in `facts.json` and the memory files carries an evidence quote and a
  date/conversation title so you can trace it back to the source if needed.

## A couple of things worth flagging up front

- This person (Shib Shankar Das, "Shibam") was **born in 2009** — he is a minor
  throughout the entire period this export covers. See
  `memory/events/flagged_items.md` for a direct note on this, particularly
  relevant to the "Addy" AI-companion persona documented in
  `memory/projects/project_adj_persona.md`.
- Two sensitive, isolated items (a one-off harmful image request, and a reference
  to a painful relationship) are logged in `flagged_items.md` for completeness,
  not treated as personality traits.

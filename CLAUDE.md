# CLAUDE.md

Project guidance for Claude Code. This file is loaded automatically each session.

## What this repo is

`devops-events` is two things in one repository:

1. **A Next.js web app** (App Router, React 19, Tailwind v4, shadcn/ui, pnpm) that serves a
   dashboard and a `GET /api/events` endpoint over the curated dataset in `data/`.
2. **An agentic data-curation pipeline** that discovers DevOps/SRE/infrastructure events from
   many sources, validates relevance, and reconciles them into `data/events.json`.

Most of your work here is the **pipeline**. The web app is conventional — develop it like any
Next.js project (`pnpm dev`, `pnpm build`, `pnpm test` via vitest).

## Source of truth for the pipeline

**`AGENTS.md` is the master orchestration guide. Read it before running any pipeline work.**
It defines the 7 phases, their order, and the non-waivable agentic gates (Phases 2 and 5).
This file does not duplicate it — it points you at the right primitives.

| Reference | Purpose |
|-----------|---------|
| [AGENTS.md](AGENTS.md) | The 7-phase workflow, phase gates, file structure |
| [docs/data-model.md](docs/data-model.md) | The `EventRecord` schema — all records must conform |
| [docs/prompt-templates/](docs/prompt-templates/) | The detailed phase instructions (referenced by slash commands) |
| [config/excluded-geographies.json](config/excluded-geographies.json) | Geographic exclusion filter |

## How to run the pipeline with Claude Code

**You can drive this entirely in natural language — slash commands are optional shortcuts.**
When the user asks to "pull down / refresh / discover the latest event candidates" (or similar),
that means: run the full discovery pipeline below (equivalent to `/discover-events` with today's
date). Read AGENTS.md, then execute Phases 1–7 in order, fanning enrichment (Phase 3) and
validation (Phase 5) out across the subagents. Do not wait to be told to use a command.

Mapping of common conversational requests:

| The user says… | Run |
|----------------|-----|
| "pull down / refresh / discover latest events", "do a discovery run" | full pipeline = `/discover-events <today>` |
| "merge / apply the approved candidates" | `/apply-candidates` |
| "apply the reviewed updates" | `/apply-updates` |
| "review the overlaps / duplicates" | `/review-overlap <date>` |

The slash commands below are the same workflows with a fixed name, if you prefer typing them:

| Command | Replaces | What it does |
|---------|----------|--------------|
| `/discover-events <YYYY-MM-DD>` | `events-source-analysis-agent-prompt.md` | Runs the full 7-phase discovery + reconciliation. Fans out enrichment/validation across subagents. |
| `/apply-candidates` | `apply-events-candidates-to-events-agent-prompt.md` | Merges approved `events-candidates.json` into `events.json`. |
| `/apply-updates` | `apply-events-updates-to-events-agent-prompt.md` | Applies field-level patches from `events-updates.json`. |
| `/review-overlap <YYYY-MM-DD>` | `review-events-overlap-agent-prompt.md` | Classifies probable-duplicate candidates. |

Two subagents do the slow, repetitive per-event web work in parallel:

- **event-enricher** — Phase 3: canonicalize one event's URL, extract CFP/cost/delivery.
- **content-validator** — Phase 5: visit one event's URL and confirm DevOps/SRE relevance.

The orchestration commands dispatch many of these concurrently — one per event — rather than
processing events one at a time.

## Conventions that matter

- **This is Windows + PowerShell.** Scripts and commands in the docs use PowerShell syntax
  (`curl.exe`, not `curl`). Honor that.
- **Never skip Phases 2 and 5.** The `reconcile-events.py` topic regex is a backstop, not the
  primary relevance gate. Skipping the agentic gates lets off-topic events (Gartner summits,
  crypto cons, language conferences) leak into candidates.
- **dev.events detail URLs are never canonical.** Always resolve to the official event page.
- **Prefer documented exclusion over risky inclusion.** When relevance is low-confidence, write
  the event to `data/events-ignored-<YYYY-MM-DD>.json` with a reason rather than including it.
- **Errors vs. exclusions are different files.** Fetch/enrichment failures → `data/events-issues.json`.
  Out-of-scope determinations → `data/events-ignored-<YYYY-MM-DD>.json`.
- **All records conform to `EventRecord`** in `docs/data-model.md`. Absolute `https://` URLs,
  `YYYY-MM-DD` dates, `end_date >= start_date`.
- **Today's date is provided in session context** — use it as the run date when the user omits one.

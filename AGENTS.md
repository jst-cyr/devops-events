# Agent Orchestration Guide

This document defines the complete workflow for `devops-events` discovery, validation, and curation. It is the master reference for all agentic operations across different model sessions.

## Workflow Overview

The events analysis pipeline has **7 phases**. Not all phases run in every session, but when they do run, they **must follow this order** and **must not skip agentic gates**.

```
Phase 1: Scripted Extraction     [Automated — Terminal/Scripts]
    ↓
Phase 2: Agent Relevance Filter  [Agentic — REQUIRED]
    ↓
Phase 3: Agent Enrichment        [Agentic — REQUIRED]
    ↓
Phase 4: Supplemental Discovery  [Agentic — REQUIRED]
    ↓
Phase 5: Content Validation      [Agentic — REQUIRED, MANDATORY]
    ↓
Phase 6: Scripted Reconciliation [Automated — Terminal/Scripts]
    ↓
Phase 7: Cost Refresh            [Agentic — REQUIRED]
```

---

## Phase 1: Scripted Extraction (Automated)

**Run in terminal. Do not skip.**

Extract raw event data from all sources using deterministic scripts:

```powershell
# Dev.events extraction (1000+ events expected)
node scripts/fetch-dev-events.mjs <YYYY-MM-DD>

# CFP tracker extraction
curl.exe -L "https://adatosystems.com/cfp-tracker/" -o "data/adatosystems-cfp-tracker-<YYYY-MM-DD>.html"
node scripts/parse-cfp-tracker.mjs <YYYY-MM-DD>

# USNUA (US networking user group events)
node scripts/fetch-usnua-events.mjs <YYYY-MM-DD>

# BSides (security community conferences)
# Use iCal feed: https://bsides.org/events/list/?ical=1
# Script: scripts/enrich-bsides-with-mapping.mjs
```

**Outputs:**
- `data/dev-events-<YYYY-MM-DD>.json` (~1000+ records)
- `data/adatosystems-cfp-validation-<YYYY-MM-DD>.json`
- `data/usnua-events-<YYYY-MM-DD>.json`
- `data/bsides-enriched-<YYYY-MM-DD>.json`

**See:** None (scripts are deterministic; no prompt template needed)

---

## Phase 2: Agent Relevance Filter (Agentic — REQUIRED)

**⚠️ DO NOT SKIP. This is the primary human-in-the-loop relevance gate.**

Read `data/dev-events-<YYYY-MM-DD>.json` and filter to a shortlist using **agent judgment** on:

1. **Topic relevance** — Does the event name, topic, or agenda indicate DevOps/SRE/infrastructure focus?
2. **Geographic eligibility** — Is the location in an excluded geography per `config/excluded-geographies.json`?
3. **Already tracked** — Does it already exist in `data/events.json`?

**Inclusion criteria:**
- Infrastructure operations, DevOps practices, SRE, cloud-native
- Kubernetes, containers, configuration management, IaC
- Network automation, sysadmin, Puppet, Ansible, Terraform
- Observability, monitoring, security operations
- **BSides community security conferences** (practitioner-focused infosec)
- Related practitioner topics

**Exclusion criteria:**
- General business/management, HR, finance, procurement, supply-chain
- Testing/QA without infrastructure ops tie-in
- General AI/ML without infrastructure context
- **Cryptocurrency/blockchain (ETHGlobal, ETHConf, etc.)**
- **Language-specific conferences (JetBrains PHPverse, PyData, etc.)**
- Robotics hardware, Gartner business summits, finance symposia
- **Generic hacker cons, pen-test events, and offensive security events** (DEFCON villages, Summercon, etc.) — unless explicitly whitelisted
- **Regional/vendor cybersecurity summits** without clear practitioner DevOps/SRE overlap

**Output:** `data/dev-events-shortlist-<YYYY-MM-DD>.json`

**Record filtering stats** in the shortlist file:
- `total_extracted`: count from dev-events JSON
- `excluded_geography`: count removed by geo filter
- `excluded_relevance`: count removed by topic filter
- `already_tracked`: count matched to existing events.json
- `shortlisted`: count remaining for enrichment

**See:** Reference the inclusion/exclusion criteria above. No separate prompt template; agent applies judgment directly.

---

## Phase 3: Agent Enrichment (Agentic — REQUIRED)

**For shortlisted events from Phase 2, plus USNUA and BSides events:**

1. **Canonicalize event URL** — dev.events URLs are never canonical. Resolve to official event page by:
   - Following HTTP redirects from dev.events detail page
   - Finding explicit "Visit website" / "Official site" links
   - Extracting embedded iframe `src` from raw HTML
   - If none succeed: write issue to `data/events-issues.json` with stage `missing_canonical_url`

2. **Extract CFP information** — Visit canonical event page and look for CFP/CFS links:
   - Follow to actual CFP destination
   - Extract `cfp_url`, `cfp_close_date`, `cfp_timezone`
   - Set `cfp_status` (`upcoming|open|closing_soon|closed|unknown`)

3. **Extract cost/pricing** — Visit registration/ticket page:
   - Capture explicit free wording (set `is_free: true`)
   - Capture explicit paid pricing (set `is_free: false`, `lowest_price`, `price_currency`)
   - Record evidence source in `cost.notes`

4. **Set delivery type** — Determine `in_person | online | hybrid` from event page

5. **Normalize to EventRecord** — Per `docs/data-model.md`

**Output:** Enriched events ready for Phase 4

**See:** `docs/data-model.md` for EventRecord schema

---

## Phase 4: Supplemental Discovery (Agentic — REQUIRED)

**Agent-crawl these sources directly for events not covered by Phase 1 scripts:**

- https://devopsdays.org/events
- https://www.usenix.org/conference/srecon
- https://sreday.com/
- https://www.iacconf.com/events
- https://www.redhat.com/en/events
- https://www.carahsoft.com/red-hat/events
- https://cfgmgmtcamp.org/
- https://www.developerweek.com/
- https://nanog.org/events/ (network engineering)
- https://techfieldday.com/events/ (network/tech field day events)

**Apply same relevance, geographic, and inclusion filters as Phase 2.**

**Deduplicate against:**
- `data/events.json` (existing events)
- Phase 2 shortlist (dev.events discoveries)

**Output:** Merged with enriched dev.events + USNUA + BSides candidates

---

## Phase 5: Content Validation (Agentic — REQUIRED, MANDATORY)

**⚠️ NON-WAIVABLE. This is the mandatory relevance gate before reconciliation.**

For **every enriched candidate** from Phases 2, 3, and 4:

1. **Visit the canonical `event_url`** — Fetch event landing page or official event description.

2. **Read event description, tagline, agenda, speaker profiles** — Do NOT rely on names or dev.events classifications alone.

3. **Evaluate against inclusion criteria:**
   - Does the actual event content indicate focus on infrastructure operations, DevOps, SRE, cloud-native, Kubernetes, containers, configuration management, IaC, network automation, sysadmin, Puppet, Ansible, Terraform, observability, security operations, or related practitioner topics?

4. **Exclude ambiguous or out-of-scope events:**
   - Event pages that are vague, mostly marketing, or lack technical depth
   - Events named after business domains (e.g., "Domain Days") without infrastructure content
   - Generic "networking" or "tech" events without DevOps/SRE specificity
   - Events with minimal agenda details (cannot confirm relevance)
   - **Gartner *-Symposium/Xpo/Summit events (HR, Finance, Supply Chain, Procurement, etc.)**
   - **ETHGlobal and other cryptocurrency/blockchain consumer events**
   - **JetBrains PHPverse and language-specific conferences (Python data science, etc.)**

5. **Record validation result** — For excluded events, write to `data/events-issues.json`:
   - `source`: event source (dev.events, usnua, etc.)
   - `discovered_name`: event name
   - `discovered_url`: canonical event URL
   - `stage`: `"content_validation"`
   - `reason`: deterministic exclusion reason (e.g., "out-of-scope: cryptocurrency", "out-of-scope: general business", "insufficient technical content")
   - `notes`: brief description of actual page content

6. **Pass validated events to Phase 6** — Only events with confirmed relevance proceed to reconciliation.

**Validation is mandatory and non-waivable.** If event page is inaccessible (404, blocked, etc.), write issue and mark as unresolved. Prefer **exclusion with documentation** over risky inclusion.

**See:** Reference inclusion/exclusion criteria in Phase 2 above. No separate prompt template; agent applies content judgment directly.

---

## Phase 6: Reconciliation (Automated)

**Run in terminal. Reconciles validated candidates against canonical events.json.**

```powershell
python scripts/reconcile-events.py --run-date <YYYY-MM-DD> --input-file <validated-candidates-file>
```

**Matching strategy (priority order):**
1. Exact `event_url` match
2. Exact `id` match
3. Fuzzy: normalized `name` + `start_date` + `location.country` match

**Filters applied:**
- Geographic exclusions per `config/excluded-geographies.json`
- Topic exclusions (keyword regex — database, embedded, testing, gaming, etc.)
- Intra-batch deduplication (fuzzy matching within discovered set)
- Cross-batch deduplication against `data/events.json`

**Outputs:**
- `data/events-candidates.json` — NEW events that passed all filters
- `data/events-updates.json` — Cost/detail updates for existing events
- `data/events-overlap-review.json` — Ambiguous matches for manual review

**See:** `scripts/reconcile-events.py` (source code for exact matching logic)

---

## Phase 7: Cost Refresh (Agentic — REQUIRED)

**For existing events in `data/events.json` with missing or free-marked cost:**

1. **Visit canonical event URL** and follow registration/ticket links.
2. **Capture event-level evidence** — source URL, wording, ticket provider, check timestamp.
3. **If explicit free wording exists** → set `is_free: true` with evidence-backed notes.
4. **If explicit paid pricing exists** → set `is_free: false`, `lowest_price`, `price_currency` with evidence.
5. **If ticketing exists but price not visible** → keep unresolved semantics in notes; do not fabricate.
6. **Write reviewed cost changes** to `data/events-updates.json` with `target.dataset = "events"`.

**See:** `scripts/apply-events-updates-to-events.mjs` (merge script for applying cost updates)

---

## Data Model Reference

All event records must conform to the schema in **`docs/data-model.md`**.

Key fields:
- `id`: unique identifier (deterministic from source)
- `name`: event name
- `event_url`: absolute HTTPS URL to canonical event page (never dev.events detail URL)
- `start_date`, `end_date`: YYYY-MM-DD format
- `delivery`: `in_person | online | hybrid`
- `location`: object with `city`, `region`, `country`, `country_code` (ISO alpha-2)
- `cost`: object with `is_free`, `lowest_price`, `price_currency`, `cost_level`, `notes`
- `cfp`: object with `has_cfp`, `cfp_url`, `cfp_close_date`, `cfp_status`
- `tags`: array of topic keywords
- `source`: source identifier (e.g., `dev.events`, `bsides.org`, `usnua.com`)

---

## Prompt Templates (Detailed Workflow References)

For in-depth guidance on each phase, refer to:

- **Phase 2 & Phase 5 (Agent Relevance + Content Validation):**  
  See `docs/prompt-templates/events-source-analysis-agent-prompt.md` — Phases 2 and 5 sections

- **Phase 3 (Enrichment):**  
  See `docs/prompt-templates/events-source-analysis-agent-prompt.md` — Phase 3 section

- **Phase 4 (Supplemental Discovery):**  
  See `docs/prompt-templates/events-source-analysis-agent-prompt.md` — Phase 4 section

- **Apply Candidates to events.json:**  
  See `docs/prompt-templates/apply-events-candidates-to-events-agent-prompt.md`

---

## Critical Reminders

### Do NOT Skip Phases 2 and 5

The reconciliation script (`scripts/reconcile-events.py`) topic regex is a **backstop only**, not the primary relevance filter. If Phases 2 and 5 are skipped:

- **Off-topic events will appear in `data/events-candidates.json`** including:
  - Gartner business/HR/finance summits (regex sees "symposium" → ambiguous)
  - ETHGlobal crypto conferences (regex sees "ETH" → could be anything)
  - JetBrains PHPverse (regex sees "platforms" → too broad)
  - PyData (regex sees "data" → not infra-specific)
  - General "Tech" or "AI" events (regex sees "tech" → passes)

- **Human review of candidates becomes painful and error-prone.**

**Solution:** Run Phases 2 and 5 with agent judgment. They are non-waivable gates.

### Model Capability Requirements

Phases 2, 3, 4, 5, and 7 require higher-end models that can:
- Read and interpret event landing pages and agendas reliably
- Make nuanced relevance judgments based on actual content (not just keywords)
- Process 100+ events with consistent exclusion logic
- Handle ambiguous cases and provide clear reasoning

**If model encounters low confidence on relevance judgment, prefer exclusion with detailed notes over risky inclusion.**

---

## Quick Reference: Which Phases to Run

| Scenario | Phases | Output |
|----------|--------|--------|
| Full discovery + validation | 1–7 | `events-candidates.json` ready to merge |
| Extract only | 1 | Raw discovery data |
| Validate existing candidates | 5 + 6 | `events-candidates.json` post-validation |
| Apply approved candidates | N/A (separate script) | `events.json` updated |
| Cost refresh only | 7 | `events-updates.json` |

---

## File Structure Reference

```
devops-events/
├── AGENTS.md                          ← You are here
├── docs/
│   ├── data-model.md                  ← EventRecord schema
│   └── prompt-templates/
│       ├── events-source-analysis-agent-prompt.md    ← Phases 1–7 detailed
│       └── apply-events-candidates-to-events-agent-prompt.md
├── scripts/
│   ├── fetch-dev-events.mjs           ← Phase 1
│   ├── parse-cfp-tracker.mjs          ← Phase 1
│   ├── fetch-usnua-events.mjs         ← Phase 1
│   ├── enrich-bsides-with-mapping.mjs ← Phase 1
│   ├── reconcile-events.py            ← Phase 6
│   ├── apply-events-candidates-to-events.mjs
│   └── apply-events-updates-to-events.mjs
├── config/
│   └── excluded-geographies.json      ← Geographic filters for Phase 2/6
└── data/
    ├── events.json                    ← Canonical database
    ├── events-candidates.json         ← Phase 6 output (NEW events)
    ├── events-updates.json            ← Phase 7 output
    └── events-issues.json             ← Validation issues
```

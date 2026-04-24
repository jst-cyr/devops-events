# Overlap Review Agent Prompt

You are validating likely duplicate event candidates produced by reconciliation.

## Inputs

- Candidate list: data/events-candidates.json
- Existing canonical events: data/events.json
- Probable overlap hints: data/events-overlap-review.json

## Objective

For each record in data/events-overlap-review.json, decide whether the candidate is:

1. duplicate_existing: same real-world event as likely_existing
2. distinct_event: legitimately different event
3. uncertain: not enough confidence

## Rules

- Prioritize official event page equivalence, event brand identity, and date/location consistency.
- Treat year suffix differences in name as non-material.
- Treat small URL differences (www vs non-www, /welcome vs root, regional mirrors) as potentially same event.
- If brand/name/date/country are effectively the same, classify as duplicate_existing.
- If uncertain, explain exactly what evidence is missing.

## Required output

Return JSON only in this shape:

{
  "generated_at": "<ISO-8601 UTC>",
  "source_run_date": "<YYYY-MM-DD>",
  "records": [
    {
      "candidate_id": "...",
      "candidate_name": "...",
      "likely_existing_id": "...",
      "decision": "duplicate_existing|distinct_event|uncertain",
      "confidence": "high|medium|low",
      "rationale": "short explanation",
      "recommended_action": "drop_candidate|keep_candidate|manual_check"
    }
  ]
}

## Gate

- If decision is duplicate_existing with confidence high or medium:
  - recommended_action must be drop_candidate.
- If decision is uncertain:
  - recommended_action must be manual_check.

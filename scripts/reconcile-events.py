#!/usr/bin/env python3
"""
Event & CFP Reconciliation Engine

Reconciles discovered events against existing database and generates output files.
Designed for recurring weekly/monthly runs with parameterized dates and input files.

Usage:
  # With discovered events file
  python scripts/reconcile-events.py --run-date 2026-04-17 --input-file discovered-events.json

  # Defaults (today, no new events)
  python scripts/reconcile-events.py

Examples:
  python scripts/reconcile-events.py --run-date 2026-04-17 --input-file data/raw-discoveries.json --data-dir data
  python scripts/reconcile-events.py --help
"""

import json
import argparse
import sys
import re
import unicodedata
import difflib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
from urllib.parse import urlparse, parse_qsl, urlencode


EXCLUDED_TOPIC_PATTERN = re.compile(r"power\s+platform|microsoft\s+power\s+platform", re.IGNORECASE)
EXCLUDED_FORMAT_PATTERN = re.compile(
    r"^\s*course\s*:|\bcourse\b|\bbootcamp\b|\btraining\b|\bcertification\b|/courses?/",
    re.IGNORECASE,
)

# Load centralized excluded geographies configuration
def _load_excluded_geographies():
    config_file = Path(__file__).parent.parent / "config" / "excluded-geographies.json"
    try:
        with open(config_file, 'r') as f:
            config = json.load(f)
            all_countries = set(config.get("excluded_countries", []))
            all_countries.update(config.get("excluded_africa_countries", []))
            return all_countries
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"[WARN] Failed to load excluded geographies config: {e}")
        return {"singapore", "malaysia"}

EXCLUDED_COUNTRIES = _load_excluded_geographies()
GENERIC_EVENT_HOSTS = {
    "dev.events",
    "www.dev.events",
    "community.cncf.io",
    "sessionize.com",
    "www.sessionize.com",
    "meetup.com",
    "www.meetup.com",
    "eventbrite.com",
    "www.eventbrite.com",
}


class EventReconciler:
    """Reconcile discovered events against existing database."""
    
    def __init__(self, run_date: datetime, data_dir: Path):
        """
        Initialize reconciler with run date and data directory.
        
        Args:
            run_date: Analysis run date (datetime object)
            data_dir: Path to data directory
        """
        self.run_date = run_date
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        
        # Windows: 180 days for events, 56 days for CFPs
        self.event_window_end = run_date + timedelta(days=180)
        self.cfp_window_end = run_date + timedelta(days=56)
        
        self.existing_events: List[Dict[str, Any]] = []
        self.timestamp = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        self.run_date_str = run_date.strftime("%Y-%m-%d")
    
    def load_existing_events(self) -> List[Dict[str, Any]]:
        """Load existing events from data/events.json"""
        events_file = self.data_dir / "events.json"
        if not events_file.exists():
            print(f"[WARN] {events_file} not found; assuming empty database")
            return []
        
        try:
            with open(events_file, 'r') as f:
                data = json.load(f)
                events = data.get("records", [])
                print(f"[LOAD] Loaded {len(events)} existing events from {events_file}")
                self.existing_events = events
                return events
        except (json.JSONDecodeError, IOError) as e:
            print(f"[ERROR] Failed to load {events_file}: {e}")
            return []
    
    def load_discovered_events(self, input_file: Optional[Path]) -> List[Dict[str, Any]]:
        """Load discovered events from input file"""
        if not input_file:
            print("[INFO] No discovered events file provided")
            return []
        
        input_path = Path(input_file)
        if not input_path.exists():
            print(f"[WARN] Discovered events file {input_path} not found")
            return []
        
        try:
            with open(input_path, 'r') as f:
                data = json.load(f)
                # Handle both bare array and wrapped {records: [...]} format
                events = data if isinstance(data, list) else data.get("records", [])
                print(f"[LOAD] Loaded {len(events)} discovered events from {input_path}")
                return events
        except (json.JSONDecodeError, IOError) as e:
            print(f"[ERROR] Failed to load {input_path}: {e}")
            return []
    
    @staticmethod
    def parse_date(date_str: str) -> Optional[datetime]:
        """Parse YYYY-MM-DD date string"""
        try:
            return datetime.strptime(date_str, "%Y-%m-%d")
        except (ValueError, TypeError):
            return None

    @staticmethod
    def normalize_url(url: str) -> str:
        """Normalize URLs for stable matching (scheme/host/path/tracking params)."""
        if not url:
            return ""
        try:
            parsed = urlparse(url.strip())
            scheme = (parsed.scheme or "https").lower()
            hostname = (parsed.hostname or "").lower()
            port = parsed.port
            host = hostname if port in (None, 80, 443) else f"{hostname}:{port}"

            path = re.sub(r"/+", "/", parsed.path or "/")
            path = path.rstrip("/") or "/"

            filtered_query = [
                (k, v)
                for (k, v) in parse_qsl(parsed.query, keep_blank_values=True)
                if not k.lower().startswith("utm_") and k.lower() not in {"fbclid", "gclid", "ref", "source"}
            ]
            query = ("?" + urlencode(filtered_query, doseq=True)) if filtered_query else ""
            return f"{scheme}://{host}{path}{query}"
        except Exception:
            return (url or "").strip().lower().rstrip("/")

    @staticmethod
    def normalize_name(name: str, drop_year_tokens: bool = False) -> str:
        """Normalize names for fuzzy equivalence across punctuation/diacritics."""
        if not name:
            return ""
        normalized = unicodedata.normalize("NFKD", name.lower())
        normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
        normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
        if drop_year_tokens:
            # Many sources append year in titles (e.g., "DevOpsDays Zurich 2026").
            # Strip standalone years so cross-source duplicates still match by name/date/country.
            normalized = re.sub(r"\b(?:19|20)\d{2}\b", " ", normalized)
        return re.sub(r"\s+", " ", normalized).strip()

    @staticmethod
    def _tokenize_name(name: str) -> set:
        """Tokenize normalized event names for subset comparisons."""
        if not name:
            return set()
        return {t for t in name.split(" ") if t}

    @classmethod
    def _is_name_variant_match(cls, left_name: str, right_name: str, left_city: str, right_city: str) -> bool:
        """
        Detect pragmatic name variants across sources, e.g.:
        - "KCD Toronto" vs "KCD Toronto Canada"
        Requires aligned city to avoid broad false positives.
        """
        if not left_name or not right_name:
            return False

        left_tokens = cls._tokenize_name(left_name)
        right_tokens = cls._tokenize_name(right_name)
        if len(left_tokens) < 2 or len(right_tokens) < 2:
            return False

        city_match = bool(left_city and right_city and left_city == right_city)
        if not city_match:
            return False

        return left_tokens.issubset(right_tokens) or right_tokens.issubset(left_tokens)

    @staticmethod
    def _get_hostname(url: str) -> str:
        if not url:
            return ""
        try:
            return (urlparse(url.strip()).hostname or "").lower()
        except Exception:
            return ""

    @staticmethod
    def _is_nonempty(value: Any) -> bool:
        return bool(isinstance(value, str) and value.strip())

    @classmethod
    def _is_better_name(cls, candidate_name: str, existing_name: str) -> bool:
        """Return True when candidate name is a safer, richer replacement."""
        if not cls._is_nonempty(candidate_name):
            return False
        if not cls._is_nonempty(existing_name):
            return True

        cand = candidate_name.strip()
        exist = existing_name.strip()
        if cand == exist:
            return False

        cand_norm = cls.normalize_name(cand, drop_year_tokens=True)
        exist_norm = cls.normalize_name(exist, drop_year_tokens=True)
        if not cand_norm or not exist_norm or cand_norm == exist_norm:
            return False

        # Guardrail: if existing has explicit 4-digit years, candidate must retain one of them.
        existing_years = set(re.findall(r"\b(?:19|20)\d{2}\b", exist))
        candidate_years = set(re.findall(r"\b(?:19|20)\d{2}\b", cand))
        if existing_years and not (existing_years & candidate_years):
            return False

        # Guardrail: avoid replacing canonical names with modality variants.
        modality_tokens = {"virtual", "online", "hybrid"}
        cand_tokens_raw = cls._tokenize_name(cls.normalize_name(cand))
        exist_tokens_raw = cls._tokenize_name(cls.normalize_name(exist))
        if (cand_tokens_raw & modality_tokens) and not (exist_tokens_raw & modality_tokens):
            return False

        cand_tokens = cls._tokenize_name(cand_norm)
        exist_tokens = cls._tokenize_name(exist_norm)
        # Prefer candidate only when it strictly adds context while keeping the same core tokens.
        return exist_tokens.issubset(cand_tokens) and len(cand_tokens) > len(exist_tokens)

    @classmethod
    def _is_better_event_url(cls, candidate_url: str, existing_url: str) -> bool:
        """Return True when candidate URL is a safer canonical upgrade."""
        cand_norm = cls.normalize_url(candidate_url)
        exist_norm = cls.normalize_url(existing_url)

        if not cand_norm:
            return False
        if not exist_norm:
            return True
        if cand_norm == exist_norm:
            return False

        cand_host = cls._get_hostname(cand_norm)
        exist_host = cls._get_hostname(exist_norm)
        if not cand_host:
            return False

        # Prefer dedicated domain over known generic aggregator/listing hosts.
        return exist_host in GENERIC_EVENT_HOSTS and cand_host not in GENERIC_EVENT_HOSTS

    def build_update_patch(self, candidate: Dict[str, Any], matched: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Build field-level update patch when a matched candidate has better data."""
        changes: Dict[str, Dict[str, Any]] = {}

        existing_name = matched.get("name", "")
        candidate_name = candidate.get("name", "")
        if self._is_better_name(candidate_name, existing_name):
            changes["name"] = {
                "old": existing_name,
                "new": candidate_name,
            }

        existing_url = matched.get("event_url", "")
        candidate_url = candidate.get("event_url", "")
        if self._is_better_event_url(candidate_url, existing_url):
            changes["event_url"] = {
                "old": existing_url,
                "new": candidate_url,
            }

        if not changes:
            return None

        match_key_type = "id" if matched.get("id") else "name+start_date+country"
        if match_key_type == "id":
            match_key_value: Any = matched.get("id")
        else:
            match_key_value = {
                "name": matched.get("name", ""),
                "start_date": matched.get("start_date", ""),
                "country": ((matched.get("location") or {}).get("country") or ""),
            }

        return {
            "target": {
                "dataset": "events",
                "file": "data/events.json",
            },
            "match": {
                "key_type": match_key_type,
                "key_value": match_key_value,
            },
            "name": matched.get("name", ""),
            "changes": changes,
        }
    
    def is_in_event_window(self, start_date: str, end_date: str) -> bool:
        """Check if event falls in the 180-day analysis window"""
        start = self.parse_date(start_date)
        end = self.parse_date(end_date)
        if not start or not end:
            return False
        return start <= self.event_window_end and end >= self.run_date
    
    def is_in_cfp_window(self, cfp_close_date: str) -> bool:
        """Check if CFP deadline falls in the 56-day window"""
        if not cfp_close_date:
            return False
        close = self.parse_date(cfp_close_date)
        if not close:
            return False
        return self.run_date <= close <= self.cfp_window_end

    @staticmethod
    def is_excluded_event(candidate: Dict[str, Any]) -> Tuple[bool, str]:
        """Return exclusion decision and reason for non-fit events."""
        country = ((candidate.get("location") or {}).get("country") or "").strip().lower()
        if country in EXCLUDED_COUNTRIES:
            return True, f"excluded geography: {country}"

        search_text = " ".join(
            [
                candidate.get("name", "") or "",
                candidate.get("event_url", "") or "",
                candidate.get("notes", "") or "",
            ]
        )
        if EXCLUDED_TOPIC_PATTERN.search(search_text):
            return True, "excluded topic: Power Platform"

        if EXCLUDED_FORMAT_PATTERN.search(search_text):
            return True, "excluded format: course/training"

        return False, ""
    
    def match_event(self, new_event: Dict[str, Any], existing_events: List[Dict[str, Any]]) -> Tuple[bool, Dict[str, Any]]:
        """
        Match new event against existing database using priority matching.
        
        Priority:
        1. Exact event_url match (primary key)
        2. Exact id match (secondary key)
        3. Fuzzy name + start_date + country match
        
        Returns: (is_match: bool, matched_record: Dict or empty dict)
        """
        # URL match (primary)
        new_url = self.normalize_url(new_event.get("event_url", ""))
        if new_url:
            for existing in existing_events:
                existing_url = self.normalize_url(existing.get("event_url", ""))
                if existing_url == new_url:
                    return (True, existing)
        
        # ID match (secondary)
        new_id = new_event.get("id")
        if new_id:
            for existing in existing_events:
                if existing.get("id") == new_id:
                    return (True, existing)
        
        # Fuzzy name + date + country (tertiary)
        new_name = self.normalize_name(new_event.get("name", ""))
        new_name_without_year = self.normalize_name(new_event.get("name", ""), drop_year_tokens=True)
        new_start = new_event.get("start_date", "")
        new_country = (new_event.get("location", {}).get("country") or "").lower()
        new_city = (new_event.get("location", {}).get("city") or "").strip().lower()
        
        if new_name and new_start and new_country:
            for existing in existing_events:
                existing_name = self.normalize_name(existing.get("name", ""))
                existing_name_without_year = self.normalize_name(existing.get("name", ""), drop_year_tokens=True)
                existing_start = existing.get("start_date", "")
                existing_country = (existing.get("location", {}).get("country") or "").lower()
                existing_city = (existing.get("location", {}).get("city") or "").strip().lower()
                
                names_match = (
                    new_name == existing_name
                    or (
                        new_name_without_year
                        and existing_name_without_year
                        and new_name_without_year == existing_name_without_year
                    )
                    or self._is_name_variant_match(
                        new_name_without_year,
                        existing_name_without_year,
                        new_city,
                        existing_city,
                    )
                )

                if (names_match and 
                    new_start == existing_start and 
                    new_country == existing_country):
                    return (True, existing)
        
        return (False, {})

    @staticmethod
    def _name_similarity(a: str, b: str) -> float:
        """Return fuzzy similarity score for names in [0, 1]."""
        if not a or not b:
            return 0.0
        return difflib.SequenceMatcher(None, a, b).ratio()

    def find_probable_overlap(self, candidate: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Find best near-duplicate in existing events for optional LLM review."""
        cand_country = ((candidate.get("location") or {}).get("country") or "").strip().lower()
        cand_start = self.parse_date(candidate.get("start_date", ""))
        if not cand_country or not cand_start:
            return None

        cand_name = self.normalize_name(candidate.get("name", ""), drop_year_tokens=True)
        best: Optional[Dict[str, Any]] = None
        best_score = 0.0

        for existing in self.existing_events:
            existing_country = ((existing.get("location") or {}).get("country") or "").strip().lower()
            if existing_country != cand_country:
                continue

            existing_start = self.parse_date(existing.get("start_date", ""))
            if not existing_start:
                continue

            date_delta_days = abs((cand_start - existing_start).days)
            if date_delta_days > 2:
                continue

            existing_name = self.normalize_name(existing.get("name", ""), drop_year_tokens=True)
            name_score = self._name_similarity(cand_name, existing_name)
            if name_score < 0.85:
                continue

            # Blend strong name similarity with date proximity.
            date_score = 1.0 if date_delta_days == 0 else (0.7 if date_delta_days == 1 else 0.4)
            combined_score = (0.8 * name_score) + (0.2 * date_score)

            if combined_score > best_score:
                best_score = combined_score
                best = {
                    "existing_id": existing.get("id"),
                    "existing_name": existing.get("name"),
                    "existing_event_url": existing.get("event_url"),
                    "existing_start_date": existing.get("start_date"),
                    "existing_country": (existing.get("location") or {}).get("country"),
                    "match_signals": {
                        "name_similarity": round(name_score, 4),
                        "date_delta_days": date_delta_days,
                        "country_exact": True,
                        "combined_score": round(combined_score, 4),
                    },
                }

        return best
    
    def reconcile_events(self, discovered_events: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Reconcile discovered events against existing database.
        
        Returns: (updates, new_candidates, overlap_review)
        """
        updates = []
        new_candidates = []
        overlap_review = []
        
        print("\n=== RECONCILING DISCOVERED EVENTS ===\n")
        
        for candidate in discovered_events:
            is_excluded, reason = self.is_excluded_event(candidate)
            if is_excluded:
                print(f"[SKIP] {candidate.get('name')} - {reason}")
                continue

            # Skip if outside the 180-day event window
            if not self.is_in_event_window(
                candidate.get("start_date", ""),
                candidate.get("end_date", "")
            ):
                print(f"[SKIP] {candidate.get('name')} - outside event window")
                continue
            
            is_match, matched = self.match_event(candidate, self.existing_events)
            
            if is_match:
                print(f"[MATCH] {candidate.get('name')} -> {matched.get('id')}")
                patch = self.build_update_patch(candidate, matched)
                if patch:
                    print(f"[UPDATE] {candidate.get('name')} -> field updates proposed")
                    updates.append(patch)
            else:
                probable = self.find_probable_overlap(candidate)
                if probable:
                    print(f"[REVIEW] {candidate.get('name')} - possible overlap with {probable.get('existing_id')}")
                    overlap_review.append({
                        "candidate": {
                            "id": candidate.get("id"),
                            "name": candidate.get("name"),
                            "event_url": candidate.get("event_url"),
                            "start_date": candidate.get("start_date"),
                            "country": (candidate.get("location") or {}).get("country"),
                        },
                        "likely_existing": probable,
                        "recommended_action": "llm_review_required",
                    })
                print(f"[NEW] {candidate.get('name')} (candidate)")
                new_candidates.append(candidate)
        
        # Note: cost determination is intentionally excluded from this script.
        # Cost updates must be generated through agentic pricing research and
        # reviewed in events-updates.json.
        print("\n=== COST DETERMINATION ===\n")
        print("[INFO] No automatic cost proposals generated in reconcile-events.py")
        
        return updates, new_candidates, overlap_review
    
    def write_updates_file(self, updates: List[Dict[str, Any]]) -> None:
        """Write events-updates.json"""
        output_file = self.data_dir / "events-updates.json"
        output = {
            "generated_at": self.timestamp,
            "window_days": 180,
            "source_run_date": self.run_date_str,
            "records": updates
        }
        with open(output_file, 'w') as f:
            json.dump(output, f, indent=2)
        print(f"[WRITE] {output_file} ({len(updates)} updates)")
    
    def write_candidates_file(self, candidates: List[Dict[str, Any]]) -> None:
        """Write events-candidates.json"""
        output_file = self.data_dir / "events-candidates.json"
        output = {
            "generated_at": self.timestamp,
            "window_days": 180,
            "source_run_date": self.run_date_str,
            "records": candidates
        }
        with open(output_file, 'w') as f:
            json.dump(output, f, indent=2)
        print(f"[WRITE] {output_file} ({len(candidates)} candidates)")

    def write_overlap_review_file(self, overlap_review: List[Dict[str, Any]]) -> None:
        """Write events-overlap-review.json"""
        output_file = self.data_dir / "events-overlap-review.json"
        output = {
            "generated_at": self.timestamp,
            "window_days": 180,
            "source_run_date": self.run_date_str,
            "records": overlap_review,
        }
        with open(output_file, 'w') as f:
            json.dump(output, f, indent=2)
        print(f"[WRITE] {output_file} ({len(overlap_review)} overlap review records)")
    
    def run(self, input_file: Optional[Path]) -> int:
        """Execute full reconciliation workflow"""
        print(f"[START] Event reconciliation for {self.run_date_str}")
        print(f"[CONFIG] Event window: {self.run_date.date()} to {self.event_window_end.date()} (180 days)")
        print(f"[CONFIG] CFP window: {self.run_date.date()} to {self.cfp_window_end.date()} (56 days)")
        print()
        
        # Load existing database
        self.load_existing_events()
        
        # Load discovered events
        discovered = self.load_discovered_events(input_file)
        
        print()
        
        # Reconcile
        updates, candidates, overlap_review = self.reconcile_events(discovered)
        
        # Write outputs
        print("\n=== WRITING OUTPUT FILES ===\n")
        self.write_updates_file(updates)
        if input_file:
            self.write_candidates_file(candidates)
            self.write_overlap_review_file(overlap_review)
        else:
            print("[SKIP] No input discoveries provided; preserving existing data/events-candidates.json")
        
        print()
        print(f"[COMPLETE] Reconciliation finished")
        print(f"[SUMMARY] {len(updates)} updates | {len(candidates)} new candidates | {len(overlap_review)} overlap-review records | outputs in {self.data_dir}/")
        return 0


def main():
    """CLI entry point"""
    parser = argparse.ArgumentParser(
        description="Reconcile discovered events and CFPs against existing database",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Reconcile discovered events
  python scripts/reconcile-events.py --run-date 2026-04-17 --input-file discoveries.json

  # Use default date (today)
  python scripts/reconcile-events.py --input-file data/raw-events.json
        """
    )
    
    parser.add_argument(
        "--run-date",
        type=str,
        default=None,
        help="Run date in YYYY-MM-DD format (default: today in UTC)"
    )
    
    parser.add_argument(
        "--input-file",
        type=str,
        default=None,
        help="Path to discovered events JSON file (optional)"
    )
    
    parser.add_argument(
        "--data-dir",
        type=str,
        default="data",
        help="Path to data directory (default: data/)"
    )

    args = parser.parse_args()
    
    # Parse and validate run date
    if args.run_date:
        try:
            run_date = datetime.strptime(args.run_date, "%Y-%m-%d")
        except ValueError:
            print(f"[ERROR] Invalid date format: {args.run_date}")
            print("[ERROR] Expected YYYY-MM-DD")
            return 1
    else:
        run_date = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Create reconciler and run
    reconciler = EventReconciler(run_date, args.data_dir)
    input_path = Path(args.input_file) if args.input_file else None
    
    try:
        return reconciler.run(input_path)
    except Exception as e:
        print(f"[ERROR] Reconciliation failed: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())

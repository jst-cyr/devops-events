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
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional


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
        new_url = new_event.get("event_url", "").lower().strip()
        if new_url:
            for existing in existing_events:
                if existing.get("event_url", "").lower().strip() == new_url:
                    return (True, existing)
        
        # ID match (secondary)
        new_id = new_event.get("id")
        if new_id:
            for existing in existing_events:
                if existing.get("id") == new_id:
                    return (True, existing)
        
        # Fuzzy name + date + country (tertiary)
        new_name = new_event.get("name", "").lower().strip()
        new_start = new_event.get("start_date", "")
        new_country = (new_event.get("location", {}).get("country") or "").lower()
        
        if new_name and new_start and new_country:
            for existing in existing_events:
                existing_name = existing.get("name", "").lower().strip()
                existing_start = existing.get("start_date", "")
                existing_country = (existing.get("location", {}).get("country") or "").lower()
                
                if (new_name == existing_name and 
                    new_start == existing_start and 
                    new_country == existing_country):
                    return (True, existing)
        
        return (False, {})
    
    def reconcile_events(self, discovered_events: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Reconcile discovered events against existing database.
        
        Returns: (updates, new_candidates)
        """
        updates = []
        new_candidates = []
        
        print("\n=== RECONCILING DISCOVERED EVENTS ===\n")
        
        for candidate in discovered_events:
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
                # TODO: Implement field-level diff detection for updates
            else:
                print(f"[NEW] {candidate.get('name')} (candidate)")
                new_candidates.append(candidate)
        
        # Note: cost determination is intentionally excluded from this script.
        # Cost updates must be generated through agentic pricing research and
        # reviewed in events-updates.json.
        print("\n=== COST DETERMINATION ===\n")
        print("[INFO] No automatic cost proposals generated in reconcile-events.py")
        
        return updates, new_candidates
    
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
        updates, candidates = self.reconcile_events(discovered)
        
        # Write outputs
        print("\n=== WRITING OUTPUT FILES ===\n")
        self.write_updates_file(updates)
        if input_file:
            self.write_candidates_file(candidates)
        else:
            print("[SKIP] No input discoveries provided; preserving existing data/events-candidates.json")
        
        print()
        print(f"[COMPLETE] Reconciliation finished")
        print(f"[SUMMARY] {len(updates)} updates | {len(candidates)} new candidates | outputs in {self.data_dir}/")
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

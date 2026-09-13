"""
Ripple — End-to-End Demo Scenario Script (Tier 3.1)
=====================================================
Demonstrates the full judge-facing loop:
  1. Load the synthetic Manipal network.
  2. Fail the most critical node (top betweenness centrality).
  3. Run the baseline cascade and show impact.
  4. Fetch mitigation recommendations (re-simulated, honest deltas).
  5. Apply the top recommendation and re-run the cascade.
  6. Print a before/after comparison table.

Usage:
  python data/scripts/demo_scenario.py

Environment:
  RIPPLE_BASE_URL  API base URL (default: http://localhost:8000)

Requirements:
  docker compose up --build  must be running before executing this script.
  No extra pip installs needed — stdlib only.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any

BASE_URL = os.environ.get("RIPPLE_BASE_URL", "http://localhost:8000").rstrip("/")
POLL_INTERVAL_S = 2
POLL_MAX_ATTEMPTS = 30  # 60 s max per simulation
ANSI_RESET = "\033[0m"
ANSI_BOLD = "\033[1m"
ANSI_GREEN = "\033[32m"
ANSI_CYAN = "\033[36m"
ANSI_RED = "\033[31m"
ANSI_YELLOW = "\033[33m"


# ---------------------------------------------------------------------------
# HTTP helpers (stdlib only)
# ---------------------------------------------------------------------------

def _request(method: str, path: str, body: dict | None = None) -> Any:
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            detail = json.loads(raw).get("detail", raw)
        except Exception:
            detail = raw
        raise RuntimeError(f"HTTP {exc.code} {method} {path}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Cannot reach {url} — is the stack running? ({exc.reason})"
        ) from exc


def get(path: str) -> Any:
    return _request("GET", path)


def post(path: str, body: dict) -> Any:
    return _request("POST", path, body)


# ---------------------------------------------------------------------------
# Polling helper
# ---------------------------------------------------------------------------

def poll_simulation(sim_id: str) -> dict:
    """Poll until simulation reaches a terminal state. Raises on failure/timeout."""
    for attempt in range(1, POLL_MAX_ATTEMPTS + 1):
        sim = get(f"/api/simulations/{sim_id}")
        status = sim.get("status")
        if status == "completed":
            return sim
        if status == "failed":
            raise RuntimeError(
                f"Simulation {sim_id} failed: {sim.get('error_message', 'no details')}"
            )
        print(f"    [{attempt}/{POLL_MAX_ATTEMPTS}] status={status} …", end="\r")
        time.sleep(POLL_INTERVAL_S)
    raise RuntimeError(
        f"Simulation {sim_id} did not complete within {POLL_MAX_ATTEMPTS * POLL_INTERVAL_S} s."
    )


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def header(text: str) -> None:
    print(f"\n{ANSI_BOLD}{ANSI_CYAN}{'=' * 60}{ANSI_RESET}")
    print(f"{ANSI_BOLD}{ANSI_CYAN}{text}{ANSI_RESET}")
    print(f"{ANSI_BOLD}{ANSI_CYAN}{'=' * 60}{ANSI_RESET}")


def ok(msg: str) -> None:
    print(f"  {ANSI_GREEN}✓{ANSI_RESET} {msg}")


def info(msg: str) -> None:
    print(f"  {ANSI_YELLOW}→{ANSI_RESET} {msg}")


def ascii_table(rows: list[tuple[str, str, str, str]], col_widths: tuple[int, int, int, int]) -> None:
    """Print a simple 4-column ASCII table."""
    w0, w1, w2, w3 = col_widths
    sep = f"+{'-'*(w0+2)}+{'-'*(w1+2)}+{'-'*(w2+2)}+{'-'*(w3+2)}+"
    print(sep)
    for i, (c0, c1, c2, c3) in enumerate(rows):
        line = f"| {c0:<{w0}} | {c1:>{w1}} | {c2:>{w2}} | {c3:>{w3}} |"
        if i == 0:
            print(f"{ANSI_BOLD}{line}{ANSI_RESET}")
        else:
            print(line)
        print(sep)


# ---------------------------------------------------------------------------
# Main demo
# ---------------------------------------------------------------------------

def main() -> None:
    print(f"\n{ANSI_BOLD}🌊  Ripple — End-to-End Demo{ANSI_RESET}")
    print(f"    API: {BASE_URL}\n")

    # ------------------------------------------------------------------
    # Step 1: Fetch network
    # ------------------------------------------------------------------
    header("Step 1: Fetching network")
    networks = get("/api/networks")
    if not networks:
        raise RuntimeError("No networks found. Run the seed script first.")
    network = networks[0]
    network_id = network["id"]
    ok(f"Network: {network.get('name', network_id)!r}  (id: {network_id[:8]}…)")

    nodes = get(f"/api/networks/{network_id}/nodes")
    ok(f"Nodes loaded: {len(nodes)}")

    # ------------------------------------------------------------------
    # Step 2: Find top betweenness node
    # ------------------------------------------------------------------
    header("Step 2: Finding most critical node (betweenness centrality)")
    centrality = get(f"/api/networks/{network_id}/centrality?metric=betweenness")
    if not centrality:
        raise RuntimeError("Centrality endpoint returned no results.")

    # Sort by rank ascending (rank 1 = most critical)
    centrality_sorted = sorted(centrality, key=lambda x: x.get("rank", 9999))
    top = centrality_sorted[0]
    top_node_id = top["node_id"]
    top_name = top.get("display_name") or top.get("name") or top_node_id[:8]
    top_type = top.get("node_type", "unknown")
    top_score = top.get("score", 0.0)

    ok(f"Top node: {top_name!r}")
    info(f"Type: {top_type} | Betweenness score: {top_score:.4f} | Rank: {top.get('rank', '?')}")
    info(f"Node ID: {top_node_id}")

    # ------------------------------------------------------------------
    # Step 3: Baseline cascade
    # ------------------------------------------------------------------
    header("Step 3: Running baseline cascade")
    info(f"Failing node: {top_name!r}")

    baseline_pending = post("/api/simulations", {
        "network_id": network_id,
        "initial_failures": [top_node_id],
    })
    baseline_sim_id = baseline_pending["id"]
    info(f"Simulation created: {baseline_sim_id[:8]}…  polling …")

    baseline = poll_simulation(baseline_sim_id)
    print()  # clear polling line

    b_failed = baseline.get("total_failed", 0)
    b_pop = baseline.get("population_affected_estimate", 0)
    b_pop_capped = baseline.get("is_population_capped", False)
    b_eff_before = baseline.get("global_efficiency_before") or 0.0
    b_eff_after = baseline.get("global_efficiency_after") or 0.0
    b_waves = len(baseline.get("waves", []))

    ok(f"Baseline complete: {b_waves} cascade wave(s)")
    info(f"Total failed nodes : {b_failed}")
    info(f"Population affected: {b_pop:,}{' (capped)' if b_pop_capped else ''}")
    info(f"Global efficiency  : {b_eff_before:.4f} → {b_eff_after:.4f}")

    # ------------------------------------------------------------------
    # Step 4: Fetch recommendations
    # ------------------------------------------------------------------
    header("Step 4: Fetching mitigation recommendations")
    recs = get(f"/api/simulations/{baseline_sim_id}/recommendations?limit=3")
    if not recs:
        print(f"  {ANSI_YELLOW}No recommendations available (cascade was fully contained).{ANSI_RESET}")
        print("\nDemo complete — no intervention needed.\n")
        sys.exit(0)

    ok(f"{len(recs)} recommendation(s) returned")
    for rec in recs:
        name = rec.get("display_name") or rec.get("node_name") or rec["node_id"][:8]
        print(
            f"    #{rec['rank']} {name:30s} "
            f"| prevented: {rec['failures_prevented']:>3}  "
            f"| pop saved: {rec['raw_population_saved']:>7,}  "
            f"| eff ↑ {rec['efficiency_gain']:+.4f}"
        )

    # ------------------------------------------------------------------
    # Step 5: Apply top recommendation
    # ------------------------------------------------------------------
    header("Step 5: Applying top recommendation & re-simulating")
    top_rec = recs[0]
    top_rec_name = top_rec.get("display_name") or top_rec.get("node_name") or top_rec["node_id"][:8]
    info(f"Intervention: upgrade {top_rec_name!r} (capacity → {top_rec['proposed_capacity']:.1f})")

    # Create scenario using the ready-to-post payload from the backend
    scenario_payload = top_rec["scenario_payload"]
    scenario = post("/api/scenarios", scenario_payload)
    scenario_id = scenario["id"]
    ok(f"Scenario created: {scenario.get('name', scenario_id)!r}  (id: {scenario_id[:8]}…)")

    intervention_pending = post("/api/simulations", {
        "network_id": network_id,
        "initial_failures": [top_node_id],
        "scenario_id": scenario_id,
    })
    intervention_sim_id = intervention_pending["id"]
    info(f"Simulation created: {intervention_sim_id[:8]}…  polling …")

    intervention = poll_simulation(intervention_sim_id)
    print()  # clear polling line

    i_failed = intervention.get("total_failed", 0)
    i_pop = intervention.get("population_affected_estimate", 0)
    i_pop_capped = intervention.get("is_population_capped", False)
    i_eff_after = intervention.get("global_efficiency_after") or 0.0
    i_waves = len(intervention.get("waves", []))

    ok(f"Intervention complete: {i_waves} cascade wave(s)")

    # ------------------------------------------------------------------
    # Step 6: Before / After comparison table
    # ------------------------------------------------------------------
    header("Step 6: Before / After Comparison")

    d_failed = i_failed - b_failed
    d_pop = i_pop - b_pop
    d_eff = i_eff_after - b_eff_after

    def delta_str(val: float, fmt: str = "+.0f") -> str:
        return f"{val:{fmt}}"

    col_widths = (28, 12, 14, 10)
    ascii_table(
        [
            ("Metric", "Baseline", "Intervention", "Delta"),
            ("Total failed nodes",
             str(b_failed),
             str(i_failed),
             delta_str(d_failed, "+d")),
            (f"Population affected{'  (capped)' if b_pop_capped or i_pop_capped else ''}",
             f"{b_pop:,}",
             f"{i_pop:,}",
             delta_str(d_pop, "+,.0f")),
            ("Global efficiency after",
             f"{b_eff_after:.4f}",
             f"{i_eff_after:.4f}",
             delta_str(d_eff, "+.4f")),
        ],
        col_widths,
    )

    improved = d_failed < 0 or d_pop < 0 or d_eff > 0
    if improved:
        print(f"\n  {ANSI_GREEN}{ANSI_BOLD}✓ Outcome improved by the intervention.{ANSI_RESET}")
    else:
        print(f"\n  {ANSI_YELLOW}→ Intervention did not improve outcome metrics in this run.{ANSI_RESET}")

    print(f"\n{ANSI_BOLD}Demo complete.{ANSI_RESET}\n")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as exc:
        print(f"\n  {ANSI_RED}✗ {exc}{ANSI_RESET}\n", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n  Interrupted.\n")
        sys.exit(1)

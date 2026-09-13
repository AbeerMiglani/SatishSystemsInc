"""
Population impact calculation service for the Ripple simulator.
Provides zone-capped population estimation and unresolved overlap detection.
"""

from __future__ import annotations

from typing import Any
import networkx as nx

STUDY_AREA_POPULATION_CAP = 65_000


def calculate_population_impact(
    failed_node_ids: set[str] | list[str],
    G_baseline: nx.DiGraph | None = None,
    study_area_cap: int = STUDY_AREA_POPULATION_CAP,
    **kwargs: Any,
) -> dict[str, Any]:
    """
    Computes population impact with municipal cap and unresolved overlap detection.

    Guarantees:
    1. population_affected_estimate never exceeds study_area_cap.
    2. is_population_capped is True iff raw_sum > study_area_cap.
    3. has_unresolved_overlap is True iff >= 2 nodes with population_served > 0 fail.
    """
    graph = G_baseline if G_baseline is not None else kwargs.get("G")
    if graph is None:
        raise ValueError("A baseline NetworkX DiGraph must be provided.")

    failed_set = set(failed_node_ids)
    raw_sum = sum(
        int(graph.nodes[nid].get("population_served", 0))
        for nid in failed_set
        if nid in graph.nodes
    )
    is_capped = raw_sum > study_area_cap
    capped_estimate = min(raw_sum, study_area_cap)

    populated_failed_count = sum(
        1
        for nid in failed_set
        if nid in graph.nodes and int(graph.nodes[nid].get("population_served", 0)) > 0
    )
    has_unresolved_overlap = populated_failed_count >= 2

    return {
        "raw_sum": raw_sum,
        "raw_population_affected": raw_sum,
        "population_affected_estimate": capped_estimate,
        "study_area_population_cap": study_area_cap,
        "is_population_capped": is_capped,
        "has_unresolved_overlap": has_unresolved_overlap,
    }

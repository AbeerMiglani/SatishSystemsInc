"""
Unit tests for population impact calculation, capping, and overlap detection.
"""

from __future__ import annotations

import networkx as nx
import pytest

from app.simulation.population import STUDY_AREA_POPULATION_CAP, calculate_population_impact


@pytest.fixture
def sample_graph() -> nx.DiGraph:
    G = nx.DiGraph()
    G.add_node("N1", population_served=25_000)
    G.add_node("N2", population_served=40_000)
    G.add_node("N3", population_served=10_000)
    G.add_node("RJ1", population_served=0)
    G.add_node("RJ2", population_served=0)
    G.add_node("MEGA", population_served=100_000)
    return G


def test_empty_failures(sample_graph):
    result = calculate_population_impact([], sample_graph)
    assert result["raw_sum"] == 0
    assert result["population_affected_estimate"] == 0
    assert result["is_population_capped"] is False
    assert result["has_unresolved_overlap"] is False


def test_single_node_under_cap(sample_graph):
    result = calculate_population_impact(["N1"], sample_graph)
    assert result["raw_sum"] == 25_000
    assert result["population_affected_estimate"] == 25_000
    assert result["is_population_capped"] is False
    assert result["has_unresolved_overlap"] is False


def test_single_node_over_cap(sample_graph):
    result = calculate_population_impact(["MEGA"], sample_graph)
    assert result["raw_sum"] == 100_000
    assert result["population_affected_estimate"] == STUDY_AREA_POPULATION_CAP
    assert result["is_population_capped"] is True
    assert result["has_unresolved_overlap"] is False


def test_exact_boundary_at_65000(sample_graph):
    # N1 (25,000) + N2 (40,000) = 65,000
    result = calculate_population_impact(["N1", "N2"], sample_graph)
    assert result["raw_sum"] == 65_000
    assert result["population_affected_estimate"] == 65_000
    assert result["is_population_capped"] is False
    assert result["has_unresolved_overlap"] is True


def test_just_below_boundary_at_64999():
    G = nx.DiGraph()
    G.add_node("A", population_served=30_000)
    G.add_node("B", population_served=34_999)
    result = calculate_population_impact(["A", "B"], G)
    assert result["raw_sum"] == 64_999
    assert result["population_affected_estimate"] == 64_999
    assert result["is_population_capped"] is False
    assert result["has_unresolved_overlap"] is True


def test_just_above_boundary_at_65001():
    G = nx.DiGraph()
    G.add_node("A", population_served=30_000)
    G.add_node("B", population_served=35_001)
    result = calculate_population_impact(["A", "B"], G)
    assert result["raw_sum"] == 65_001
    assert result["population_affected_estimate"] == 65_000
    assert result["is_population_capped"] is True
    assert result["has_unresolved_overlap"] is True


def test_two_nodes_with_zero_population_no_unresolved_overlap(sample_graph):
    result = calculate_population_impact(["RJ1", "RJ2"], sample_graph)
    assert result["raw_sum"] == 0
    assert result["population_affected_estimate"] == 0
    assert result["is_population_capped"] is False
    assert result["has_unresolved_overlap"] is False


def test_missing_nodes_handled_gracefully(sample_graph):
    result = calculate_population_impact(["NON_EXISTENT", "N1"], sample_graph)
    assert result["raw_sum"] == 25_000
    assert result["population_affected_estimate"] == 25_000
    assert result["is_population_capped"] is False
    assert result["has_unresolved_overlap"] is False

import networkx as nx

from app.simulation.population import calculate_population_impact_details
from app.services.analytics import calculate_networkx_centrality


def test_population_zones_are_counted_once_and_capped():
    graph = nx.DiGraph()
    graph.add_node("a", population_served=40_000, population_zone_id="zone-1")
    graph.add_node("b", population_served=40_000, population_zone_id="zone-1")
    graph.add_node("c", population_served=40_000, population_zone_id="zone-2")

    result = calculate_population_impact_details(["a", "b", "c"], graph)

    assert result["population_affected_estimate"] == 65_000
    assert result["population_estimate_is_capped"] is True
    assert result["population_affected_percentage"] == 100.0


def test_networkx_betweenness_finds_bridge_node():
    class Node:
        def __init__(self, node_id: str, name: str):
            self.id = node_id
            self.name = name

        @property
        def display_name(self):
            return self.name

    class Edge:
        def __init__(self, source_id: str, target_id: str):
            self.source_id = source_id
            self.target_id = target_id
            self.weight = 1.0

    nodes = [Node("a", "A"), Node("b", "B"), Node("c", "C"), Node("d", "D")]
    edges = [Edge("a", "b"), Edge("b", "c"), Edge("c", "d")]
    scores = calculate_networkx_centrality(nodes, edges)

    assert scores[0]["node_id"] == "b"

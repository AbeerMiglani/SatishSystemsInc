"""Optional OpenStreetMap road-network importer.

The importer is deliberately opt-in: importing ``app.services.osm_ingestion``
does not require OSMnx, and the synthetic dataset remains the default demo
source. OSM geometry is treated as observed geometry; capacities, loads, and
population exposure remain explicitly estimated.
"""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)
OSM_NAMESPACE = uuid.UUID("6b3c31b8-8bc3-4ec1-a4e0-bb7a0e7f9f6a")


def _require_osmnx() -> Any:
    try:
        import osmnx as ox
    except ImportError as exc:
        raise RuntimeError(
            "OSM ingestion requires the optional dependency; install with "
            "pip install 'ripple-backend[osm]'"
        ) from exc
    return ox


def _stable_id(kind: str, value: object) -> str:
    return str(uuid.uuid5(OSM_NAMESPACE, f"{kind}:{value}"))


def download_osm_road_data(
    place: str,
    output_dir: str | Path,
    network_type: str = "drive",
) -> tuple[Path, Path]:
    """Download an OSM road graph and write Ripple-compatible seed files.

    Only road junctions and road links are populated. The generated files can
    be reviewed before being loaded into the application; no real hospitals,
    utilities, capacities, or population figures are invented.
    """
    ox = _require_osmnx()
    graph = ox.graph_from_place(place, network_type=network_type, simplify=True)
    nodes, edges = _convert_graph(graph, place)

    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    nodes_path = destination / "nodes.geojson"
    edges_path = destination / "edges.json"
    nodes_path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [node["lng"], node["lat"]]},
                        "properties": {key: value for key, value in node.items() if key not in {"lat", "lng"}},
                    }
                    for node in nodes
                ],
            },
            indent=2,
        )
    )
    edges_path.write_text(json.dumps(edges, indent=2))
    (destination / "provenance.json").write_text(
        json.dumps(
            {
                "source": "OpenStreetMap",
                "license": "ODbL",
                "place": place,
                "network_type": network_type,
                "node_types": ["road_junction"],
                "estimated_fields": ["capacity", "current_load", "population_served"],
            },
            indent=2,
        )
    )
    logger.info("wrote %d OSM nodes and %d OSM edges to %s", len(nodes), len(edges), destination)
    return nodes_path, edges_path


def _convert_graph(graph: Any, place: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Convert an OSMnx/NetworkX graph into the existing seed contract."""
    nodes: list[dict[str, Any]] = []
    node_ids: dict[object, str] = {}
    for osmid, data in graph.nodes(data=True):
        node_ids[osmid] = _stable_id("node", f"{place}:{osmid}")
        nodes.append(
            {
                "id": node_ids[osmid],
                "name": f"OSM Road Junction {osmid}",
                "node_type": "road_junction",
                "lat": float(data["y"]),
                "lng": float(data["x"]),
                "capacity": 200.0,
                "current_load": 0.0,
                "failure_threshold": 1.0,
                "population_served": 0,
                "status": "operational",
                "name_source": "osm",
                "data_quality": "observed_geometry_estimated_operations",
            }
        )

    pairs: dict[tuple[object, object], dict[str, Any]] = {}
    for source, target, data in graph.edges(data=True):
        if source == target:
            continue
        pair = tuple(sorted((source, target), key=str))
        length = float(data.get("length", 1.0))
        existing = pairs.get(pair)
        if existing is None or length < existing["length"]:
            pairs[pair] = {
                "source": source,
                "target": target,
                "length": length,
                "is_bidirectional": bool(graph.has_edge(source, target) and graph.has_edge(target, source)),
            }

    edges = []
    for pair in sorted(pairs, key=lambda item: (str(item[0]), str(item[1]))):
        item = pairs[pair]
        edges.append(
            {
                "id": _stable_id("edge", f"{place}:{pair[0]}:{pair[1]}"),
                "source_id": node_ids[item["source"]],
                "target_id": node_ids[item["target"]],
                "edge_type": "road_link",
                "weight": item["length"],
                "capacity": 100.0,
                "is_bidirectional": item["is_bidirectional"],
            }
        )
    return nodes, edges


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Download an optional OSM road network for Ripple")
    parser.add_argument("--place", default="Manipal, Karnataka, India")
    parser.add_argument("--output", default="/data/osm")
    parser.add_argument("--network-type", default="drive")
    args = parser.parse_args()
    download_osm_road_data(args.place, args.output, args.network_type)

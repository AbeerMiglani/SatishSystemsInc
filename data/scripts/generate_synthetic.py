#!/usr/bin/env python3
"""
Generate a synthetic infrastructure network for Manipal, India.

Outputs two files (nodes.geojson, edges.json) in the data/seed/ directory.
Asserts that the graph is connected (specifically: no isolated components, and
every hospital is reachable from at least one power substation).

Topology structure:
Power Substations -> Water Stations -> Hospitals
Power Substations -> Telecom Towers
Hospitals -> Telecom Towers
Road Junctions connect to each other and nearby facilities
"""

import json
import math
import os
import random
import uuid
from pathlib import Path

import networkx as nx

# --- Config ---
OUTPUT_DIR = Path(__file__).parent.parent / "seed"
MANIPAL_CENTER = (13.35, 74.79)  # lat, lng
RADIUS_DEG = 0.02  # ~2.2km spread

COUNTS = {
    "power_substation": 8,
    "water_station": 6,
    "hospital": 4,
    "telecom_tower": 2,
    "road_junction": 100,
}

# Ensure reproducible generation
random.seed(2026)


def random_point_near(center, radius_deg):
    """Generate a random point within a radius of a center point."""
    r = radius_deg * math.sqrt(random.random())
    theta = random.random() * 2 * math.pi
    return (
        center[0] + r * math.cos(theta),
        center[1] + r * math.sin(theta) * 1.05,  # Slight longitude squeeze adjustment
    )


def distance(p1, p2):
    """Simple Euclidean distance for pairing proximity."""
    return math.sqrt((p1[0] - p2[0])**2 + (p1[1] - p2[1])**2)


def generate_nodes():
    nodes = []
    
    # Generate each type
    for ntype, count in COUNTS.items():
        for i in range(count):
            lat, lng = random_point_near(MANIPAL_CENTER, RADIUS_DEG)
            
            # Base stats depend on type with varying headroom (40-90% load)
            # Consistent, realistic synthetic naming scheme without fabricating real institutions
            if ntype == "power_substation":
                # High criticality, low headroom
                cap, load, pop = 100.0, random.uniform(80, 90), random.randint(10000, 30000)
                name = f"Grid Substation PS-{i+1:02d}"
            elif ntype == "water_station":
                # Moderate headroom
                cap, load, pop = 80.0, random.uniform(65, 76), random.randint(15000, 25000)
                name = f"Water Facility WS-{i+1:02d}"
            elif ntype == "hospital":
                # High headroom (critical backup generators)
                cap, load, pop = 60.0, random.uniform(40, 60), random.randint(1000, 5000)
                name = f"Hospital MC-{i+1:02d}"
            elif ntype == "telecom_tower":
                # Variable headroom
                cap, load, pop = 40.0, random.uniform(25, 35), random.randint(5000, 15000)
                name = f"Cell Tower TC-{i+1:02d}"
            else:
                # Road junction - huge capacity, very high headroom so failures don't instantly collapse the grid
                cap, load, pop = 200.0, random.uniform(50, 70), 0
                name = f"Road Junction RJ-{i+1:02d}"
                
            nodes.append({
                "id": str(uuid.uuid4()),
                "name": name,
                "node_type": ntype,
                "lat": lat,
                "lng": lng,
                "capacity": cap,
                "current_load": load,
                "failure_threshold": 1.0,
                "population_served": pop,
                "status": "operational",
                "is_synthetic": True,
                "data_source": "synthetic"
            })
            
    return nodes


def generate_edges(nodes):
    edges = []
    
    # Separate nodes by type
    by_type = {}
    for n in nodes:
        by_type.setdefault(n["node_type"], []).append(n)
        
    def get_closest(source, candidates, k=1):
        candidates.sort(key=lambda c: distance((source["lat"], source["lng"]), (c["lat"], c["lng"])))
        return candidates[:k]

    # 1. Power -> Water (each water station gets power from 2 closest substations)
    for ws in by_type["water_station"]:
        closest_ps = get_closest(ws, by_type["power_substation"], 2)
        for ps in closest_ps:
            edges.append({
                "id": str(uuid.uuid4()),
                "source_id": ps["id"],
                "target_id": ws["id"],
                "edge_type": "power_supply",
                "weight": 1.0,
                "capacity": 50.0,
                "is_bidirectional": False,
                "is_synthetic": True,
                "data_source": "synthetic"
            })

    # 2. Power -> Hospital (each hospital gets power from 2 closest substations)
    for hp in by_type["hospital"]:
        closest_ps = get_closest(hp, by_type["power_substation"], 2)
        for ps in closest_ps:
            edges.append({
                "id": str(uuid.uuid4()),
                "source_id": ps["id"],
                "target_id": hp["id"],
                "edge_type": "power_supply",
                "weight": 1.0,
                "capacity": 30.0,
                "is_bidirectional": False,
                "is_synthetic": True,
                "data_source": "synthetic"
            })

    # 3. Water -> Hospital (each hospital gets water from 1 closest water station)
    for hp in by_type["hospital"]:
        closest_ws = get_closest(hp, by_type["water_station"], 1)[0]
        edges.append({
            "id": str(uuid.uuid4()),
            "source_id": closest_ws["id"],
            "target_id": hp["id"],
            "edge_type": "water_supply",
            "weight": 1.0,
            "capacity": 40.0,
            "is_bidirectional": False,
            "is_synthetic": True,
            "data_source": "synthetic"
        })
        
    # 4. Power -> Telecom
    for tc in by_type["telecom_tower"]:
        closest_ps = get_closest(tc, by_type["power_substation"], 1)[0]
        edges.append({
            "id": str(uuid.uuid4()),
            "source_id": closest_ps["id"],
            "target_id": tc["id"],
            "edge_type": "power_supply",
            "weight": 1.0,
            "capacity": 20.0,
            "is_bidirectional": False,
            "is_synthetic": True,
            "data_source": "synthetic"
        })
        
    # 5. Hospital -> Telecom (Dependency)
    for hp in by_type["hospital"]:
        closest_tc = get_closest(hp, by_type["telecom_tower"], 1)[0]
        edges.append({
            "id": str(uuid.uuid4()),
            "source_id": hp["id"],
            "target_id": closest_tc["id"],
            "edge_type": "depends_on",
            "weight": 1.0,
            "capacity": 10.0,
            "is_bidirectional": False,
            "is_synthetic": True,
            "data_source": "synthetic"
        })

    # 6. Road network
    # To guarantee connectivity, first build a Minimum Spanning Tree of all road junctions
    road_junctions = by_type["road_junction"]
    G_complete = nx.Graph()
    for i, rj1 in enumerate(road_junctions):
        for j, rj2 in enumerate(road_junctions):
            if i < j:
                w = distance((rj1["lat"], rj1["lng"]), (rj2["lat"], rj2["lng"]))
                G_complete.add_edge(rj1["id"], rj2["id"], weight=w)
                
    mst = nx.minimum_spanning_tree(G_complete)
    
    # Add MST edges to our output
    added_edges = set()
    for u, v in mst.edges():
        edges.append({
            "id": str(uuid.uuid4()),
            "source_id": u,
            "target_id": v,
            "edge_type": "road_link",
            "weight": mst[u][v]["weight"],
            "capacity": 100.0,
            "is_bidirectional": True,
            "is_synthetic": True,
            "data_source": "synthetic"
        })
        added_edges.add(tuple(sorted([u, v])))
        
    # Add a few more local connections so it's not just a bare tree, but strictly distance-constrained
    MAX_ROAD_DIST = 0.02  # Approx 2km max for a local road
    for rj in road_junctions:
        closest = get_closest(rj, road_junctions, 4)
        for neighbor in closest[1:]:
            dist = distance((rj["lat"], rj["lng"]), (neighbor["lat"], neighbor["lng"]))
            # Only connect if within a realistic spatial distance constraint
            if dist < MAX_ROAD_DIST:
                edge_tuple = tuple(sorted([rj["id"], neighbor["id"]]))
                if edge_tuple not in added_edges:
                    edges.append({
                        "id": str(uuid.uuid4()),
                        "source_id": rj["id"],
                        "target_id": neighbor["id"],
                        "edge_type": "road_link",
                        "weight": dist,
                        "capacity": 100.0,
                        "is_bidirectional": True,
                        "is_synthetic": True,
                        "data_source": "synthetic"
                    })
                    added_edges.add(edge_tuple)
    # Connect non-road facilities to nearest road junction
    for n in nodes:
        if n["node_type"] != "road_junction":
            closest_rj = get_closest(n, by_type["road_junction"], 1)[0]
            edges.append({
                "id": str(uuid.uuid4()),
                "source_id": n["id"],
                "target_id": closest_rj["id"],
                "edge_type": "road_link",
                "weight": distance((n["lat"], n["lng"]), (closest_rj["lat"], closest_rj["lng"])),
                "capacity": 60.0,
                "is_bidirectional": True,
                "is_synthetic": True,
                "data_source": "synthetic"
            })

    return edges


def assert_connectivity(nodes, edges):
    """
    Builds a NetworkX graph and asserts:
    1. The road network is fully connected.
    2. Every hospital is reachable from at least one power substation.
    """
    G_road = nx.Graph()
    G_deps = nx.DiGraph()
    
    for n in nodes:
        G_road.add_node(n["id"], type=n["node_type"])
        G_deps.add_node(n["id"], type=n["node_type"])
        
    for e in edges:
        if e["is_bidirectional"]:
            G_road.add_edge(e["source_id"], e["target_id"])
            G_deps.add_edge(e["source_id"], e["target_id"])
            G_deps.add_edge(e["target_id"], e["source_id"])
        else:
            G_deps.add_edge(e["source_id"], e["target_id"])
            
    # Check road connectivity
    if not nx.is_connected(G_road):
        raise AssertionError("Network validation failed: The road network contains isolated components.")
        
    # Check hospital power reachability
    hospitals = [n["id"] for n in nodes if n["node_type"] == "hospital"]
    power_subs = [n["id"] for n in nodes if n["node_type"] == "power_substation"]
    
    for h_id in hospitals:
        reachable = False
        for p_id in power_subs:
            if nx.has_path(G_deps, p_id, h_id):
                reachable = True
                break
        if not reachable:
            raise AssertionError(f"Network validation failed: Hospital {h_id} is completely disconnected from the power grid.")
            
    print("✅ Network connectivity assertions passed.")


def main():
    print("Generating synthetic network...")
    nodes = generate_nodes()
    edges = generate_edges(nodes)
    
    print(f"Generated {len(nodes)} nodes and {len(edges)} edges.")
    
    # Run assertions
    assert_connectivity(nodes, edges)
    
    # Format as GeoJSON
    nodes_geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [n["lng"], n["lat"]]
                },
                "properties": {k: v for k, v in n.items() if k not in ["lat", "lng"]}
            }
            for n in nodes
        ]
    }
    
    # We store edges as generic JSON array since GeoJSON doesn't cleanly represent graph topologies
    # without duplicating coordinate geometry in every LineString
    
    # Write files
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    with open(OUTPUT_DIR / "nodes.geojson", "w") as f:
        json.dump(nodes_geojson, f, indent=2)
        
    with open(OUTPUT_DIR / "edges.json", "w") as f:
        json.dump(edges, f, indent=2)
        
    print(f"✅ Saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()

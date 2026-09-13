"""
Seed data ingestion service.
Reads the generated GeoJSON seed data, populates PostgreSQL/PostGIS,
and then syncs to Neo4j.
"""

import json
import logging
from pathlib import Path

from sqlalchemy.orm import Session

from app.db.redis import get_redis_client
from app.models.network import Edge, Network, Node
from app.services.graph_sync import clear_network_from_neo4j, sync_network_to_neo4j

# In Docker, the data directory is mounted at /data
SEED_DIR = Path("/data/seed")
if not SEED_DIR.exists():
    SEED_DIR = Path(__file__).resolve().parents[3] / "data" / "seed"
SEED_NETWORK_NAME = "Manipal Demo Network"
logger = logging.getLogger(__name__)


def ingest_seed_data(db: Session, force: bool = False) -> str:
    """
    Ingests seed data if no networks exist (or if force=True).
    Returns the network_id.
    """
    existing = db.query(Network).filter(Network.name == SEED_NETWORK_NAME).first()
    if existing and not force:
        logger.info("network %s already exists; skipping seed ingestion", existing.id)
        return str(existing.id)

    logger.info("reading seed data from %s", SEED_DIR)
    with open(SEED_DIR / "nodes.geojson", "r") as f:
        nodes_data = json.load(f)
        
    with open(SEED_DIR / "edges.json", "r") as f:
        edges_data = json.load(f)

    # Keep relational ingestion atomic. Neo4j is a read-optimized mirror, so
    # it is synchronized only after the canonical transaction commits.
    replaced_network_id = str(existing.id) if existing else None
    try:
        if existing:
            db.delete(existing)
            db.flush()

        network = Network(
            name=SEED_NETWORK_NAME,
            description="Synthetic seed dataset for the Ripple demonstration",
        )
        db.add(network)
        db.flush()
        net_id = network.id

        node_objects = []
        for feature in nodes_data["features"]:
            props = feature["properties"]
            coords = feature["geometry"]["coordinates"]
            node_objects.append(
                Node(
                    id=props["id"],
                    network_id=net_id,
                    name=props["name"],
                    display_name=props.get("display_name") or props["name"],
                    node_type=props["node_type"],
                    lat=coords[1],
                    lng=coords[0],
                    geom=f"SRID=4326;POINT({coords[0]} {coords[1]})",
                    capacity=props["capacity"],
                    current_load=props["current_load"],
                    failure_threshold=props["failure_threshold"],
                    population_served=props["population_served"],
                    status=props["status"],
                    is_synthetic=props.get("is_synthetic", True),
                    data_source=props.get("data_source", "synthetic"),
                    name_source=props.get("name_source", "synthetic"),
                    data_quality=props.get("data_quality", "verified"),
                )
            )
        db.add_all(node_objects)

        edge_objects = [
            Edge(
                id=edge["id"],
                network_id=net_id,
                source_id=edge["source_id"],
                target_id=edge["target_id"],
                edge_type=edge["edge_type"],
                weight=edge["weight"],
                capacity=edge["capacity"],
                is_bidirectional=edge["is_bidirectional"],
            )
            for edge in edges_data
        ]
        db.add_all(edge_objects)
        db.commit()
    except Exception:
        db.rollback()
        raise

    # Synchronize the read-optimized mirror only after canonical data commits.
    if replaced_network_id:
        clear_network_from_neo4j(replaced_network_id)
    sync_network_to_neo4j(db, str(net_id))
    try:
        get_redis_client().delete(
            f"centrality:betweenness:{net_id}",
            f"centrality:pagerank:{net_id}",
            f"centrality:{net_id}",
        )
        if replaced_network_id:
            get_redis_client().delete(
                f"centrality:betweenness:{replaced_network_id}",
                f"centrality:pagerank:{replaced_network_id}",
                f"centrality:{replaced_network_id}",
            )
    except Exception:
        logger.warning("could not invalidate centrality cache for %s", net_id, exc_info=True)

    logger.info("seed ingestion complete: network=%s", net_id)
    return str(net_id)


if __name__ == "__main__":
    import argparse

    from app.db.postgres import SessionLocal

    parser = argparse.ArgumentParser(description="Ingest the synthetic Ripple seed network")
    parser.add_argument("--force", action="store_true", help="replace the existing named demo network")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        ingest_seed_data(db, force=args.force)
    finally:
        db.close()

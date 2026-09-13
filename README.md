# Ripple

> An interactive simulator that shows how one infrastructure failure spreads through a city.

Built for **Manipal Hackathon 2026**
**Track:** Disaster Resilience
**Challenge:** *"Cascading Failure: When One Failure Becomes Many"*

---

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (with Docker Compose v2)
- [Node.js 20+](https://nodejs.org/) (for the frontend dev server)

### 1. Clone and configure

```bash
git clone <repo-url>
cd ripple
cp .env.example .env
```

### 2. Start the backend services

```bash
docker compose up --build
```

This starts:
- **PostgreSQL 16 + PostGIS 3.4** on port 5432
- **Neo4j 5.21.0 + GDS** on ports 7474 (browser) / 7687 (bolt)
- **Redis 7.4** on port 6379
- **FastAPI backend** on port 8000
- **Celery worker** for async simulation jobs

Wait for all health checks to pass (~30s for Neo4j's first startup).

### 3. Verify the backend

```bash
curl http://localhost:8000/health
# → {"status":"ok","services":{"postgres":"ok","neo4j":"ok","redis":"ok"}}
```

### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 5. Access service UIs

| Service | URL |
|---------|-----|
| Frontend | [localhost:5173](http://localhost:5173) |
| Backend API docs | [localhost:8000/docs](http://localhost:8000/docs) |
| Neo4j Browser | [localhost:7474](http://localhost:7474) |

---

## Architecture

```text
┌─────────────────────────────────────────────────────────┐
│                     React Frontend                       │
│  MapLibre GL + deck.gl  │  Cytoscape.js  │  Controls    │
└────────────┬────────────┴───────┬────────┴──────────────┘
             │ REST               │ WebSocket
             ▼                    ▼
┌─────────────────────────────────────────────────────────┐
│                  FastAPI Backend                         │
│  CRUD API  │  Simulation Trigger  │  WS Wave Stream     │
└──────┬─────┴──────────┬───────────┴──────────┬──────────┘
       │                │                      │
       ▼                ▼                      ▼
┌──────────┐   ┌────────────────┐      ┌────────────┐
│ Postgres │   │  Celery Worker │      │   Redis    │
│ + PostGIS│   │  (in-memory    │      │  (broker + │
│          │   │   NetworkX     │      │   pubsub)  │
└──────────┘   │   cascade)     │      └────────────┘
               └───────┬────────┘
                       │ read-only
                       ▼
               ┌────────────────┐
               │     Neo4j      │
               │  + GDS (graph  │
               │   centrality)  │
               └────────────────┘
```

> **Important:** Simulations never mutate Neo4j. The worker reads the graph into an in-memory NetworkX model, runs the cascade, and writes results to PostgreSQL only.

---

## Project Structure

```
ripple/
├── docker-compose.yml          # All backend services
├── .env.example                # Environment template
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI app
│   │   ├── config.py           # Settings
│   │   ├── celery_app.py       # Celery instance
│   │   ├── db/                 # Database connectors
│   │   ├── models/             # SQLAlchemy ORM
│   │   ├── schemas/            # Pydantic schemas
│   │   ├── api/                # REST + WebSocket routes
│   │   ├── services/           # Business logic
│   │   └── simulation/         # Cascade engine
│   └── tests/
├── frontend/
│   └── src/
│       ├── components/         # React components
│       ├── layers/             # deck.gl layer defs
│       ├── stores/             # Zustand state
│       ├── api/                # TanStack Query hooks
│       └── data/               # Stub data (Phase 0.5)
└── data/
    ├── seed/                   # GeoJSON seed dataset
    └── scripts/                # Data generation
```

---

## Recommendation Engine

Ripple features an automated, deterministic resilience recommendation engine (`backend/app/services/recommendations.py`) designed to help operators prevent or arrest cascading infrastructure collapses.

### In-Memory Motter-Lai Resimulation
Rather than relying on heuristic estimates or unverified approximations, every recommendation candidate is evaluated through an **in-memory Motter-Lai cascade resimulation**:
1. The baseline network topology graph is cloned in memory.
2. The prospective intervention (node capacity hardening or redundancy connection) is applied to the cloned graph.
3. The exact baseline initial failure condition is replayed through the Motter-Lai overload engine.
4. The resulting cascade waves, failed node count, population affected, and global topological efficiency are measured against baseline outcomes to compute genuine, verified deltas (`verified: True`).

### Candidate Intervention Types
The engine generates two distinct intervention types based on topological vulnerability:
- **`upgrade_node` (Hardening):** Multiplies or hardens the operational capacity and failure threshold of critical downstream transit bottlenecks (such as wave-1 casualties absorbing initial failure shock).
- **`add_edge` (Redundancy):** Generates structural bypass connections linking surviving operational assets to disconnected downstream service areas that lost upstream connectivity due to wave-1 casualties.

### Deterministic Multi-Factor Ranking
Candidates are evaluated and deterministically ranked according to a prioritized hierarchy:
1. **`protects_critical_services` (Hospital Preservation):** Top priority is given to interventions that save life-safety and acute healthcare facilities (hospitals) from failing during the cascade.
2. **`failures_prevented`:** Net reduction in total failed nodes compared to the baseline cascade outcome.
3. **`raw_population_saved`:** Number of citizens spared from power, water, or telecommunications outages.
4. **`efficiency_gain`:** Post-cascade global network transmission efficiency delta ($\Delta E$).
5. **Canonical ID tie-breaking:** Deterministic alphabetical tie-breaking on UUID ensures 100% reproducible ordering.

### 1-Click Execution & Seamless Comparison
Every candidate returned by `GET /api/simulations/{id}/recommendations` carries a pre-synthesized `scenario_payload`. When an operator applies a recommendation in the UI or via API:
- The scenario is created with one click without manual UUID copy-pasting.
- The mitigation scenario is rerun and registered directly in state.
- The `ScenarioCompare` dashboard allows side-by-side verification confirming strictly-better cascade outcomes.

---

## Key Metrics & Disclaimers

- **Betweenness Centrality by Default:** Structural bottleneck criticality is calculated using Betweenness Centrality over the directed dependency topology, identifying nodes that lie on the greatest fraction of shortest paths across municipal infrastructure sectors.
- **Population Impact & Municipal Cap:** Raw population impact sums the `population_served` across all affected assets. To prevent unrealistic double-counting across overlapping municipal service zones, estimates are formally capped at the total study-area municipal population (**65,000** citizens for the Manipal study area).
- **Unresolved Overlap Flag:** The system computes both `is_population_capped` and `has_unresolved_overlap` flags. When overlapping service areas cannot be geometrically resolved at the ward level, the API and UI explicitly flag estimates to maintain forensic transparency.

---

## Team

**SatishSystemsInc.**

---

## License (TBD)

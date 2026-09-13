import React, { useEffect } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import MapView from "./components/MapView";
import GraphView from "./components/GraphView";
import ControlPanel from "./components/ControlPanel";
import CriticalityPanel from "./components/CriticalityPanel";
import ScenarioCompare from "./components/ScenarioCompare";
import RecommendationPanel from "./components/RecommendationPanel";
import CascadeTimeline from "./components/CascadeTimeline";
import { useNetworks, useNetworkTopology } from "./api/hooks";
import { useUIStore } from "./stores/uiStore";

const App: React.FC = () => {
  const { data: networks, isLoading: isLoadingNetworks } = useNetworks();
  const networkId = useUIStore((s) => s.networkId);
  const setNetworkId = useUIStore((s) => s.setNetworkId);

  useEffect(() => {
    if (networks && networks.length > 0 && !networkId) {
      setNetworkId(networks[0].id);
    }
  }, [networks, networkId, setNetworkId]);

  const { data: topology, isLoading: isLoadingTopology } = useNetworkTopology(networkId);

  if (isLoadingNetworks || isLoadingTopology || !topology) {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: "#0f172a", color: "white" }}>
        <p style={{ fontSize: "1.25rem" }}>Loading Infrastructure Data...</p>
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#0f172a",
        color: "#e2e8f0",
        fontFamily: "sans-serif"
      }}
    >
      <header
        style={{
          padding: "12px 24px",
          borderBottom: "1px solid #1e293b",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#3b82f6", margin: 0 }}>
          🌊 Ripple: Cascading Failure Simulator
        </h1>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <span style={{ fontSize: 14, color: "#94a3b8" }}>Network:</span>
          <select 
            style={{ background: "#1e293b", color: "white", border: "1px solid #334155", borderRadius: "4px", padding: "4px 8px" }}
            value={networkId || ""}
            onChange={(e) => setNetworkId(e.target.value)}
          >
            {networks?.map(n => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
        </div>
      </header>

      <main
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
        }}
      >
        {/* Left: Topological Graph View */}
        <div style={{ flex: 1, borderRight: "1px solid #334155", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "8px 16px", background: "#1e293b", borderBottom: "1px solid #334155", fontWeight: "bold" }}>Topology</div>
          <div style={{ flex: 1, position: "relative" }}>
            <GraphView nodes={topology.nodes} edges={topology.edges} />
          </div>
        </div>

        {/* Center: Geographic Map View */}
        <div style={{ flex: 1.5, position: "relative", borderRight: "1px solid #334155", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "8px 16px", background: "#1e293b", borderBottom: "1px solid #334155", fontWeight: "bold", display: "flex", justifyContent: "space-between" }}>
            <span>Geographic Map</span>
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <MapView nodes={topology.nodes} edges={topology.edges} />
          </div>
          <CascadeTimeline />
        </div>

        {/* Right: Controls & Criticality */}
        <div style={{ width: "320px", display: "flex", flexDirection: "column", background: "#0f172a", overflowY: "auto" }}>
          <ControlPanel />
          <CriticalityPanel />
          <RecommendationPanel />
          <ScenarioCompare />
        </div>
      </main>
    </div>
  );
};

export default App;

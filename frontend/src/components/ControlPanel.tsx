import React, { useEffect, useMemo, useState } from "react";
import { useUIStore } from "../stores/uiStore";
import { useSimulationStore } from "../stores/simulationStore";
import { useRunSimulation, useSimulationResult, useCreateScenario, useNetworkTopology } from "../api/hooks";
import type { InfraNode } from "../types";

const ControlPanel: React.FC = () => {
  const mode = useUIStore((s) => s.mode);
  const setMode = useUIStore((s) => s.setMode);
  const networkId = useUIStore((s) => s.networkId);
  const selectedNodeIds = useUIStore((s) => s.selectedNodeIds);
  const toggleNodeSelection = useUIStore((s) => s.toggleNodeSelection);
  const redundancyNodes = useUIStore((s) => s.redundancyNodes);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const clearRedundancyNodes = useUIStore((s) => s.clearRedundancyNodes);

  const { data: topology } = useNetworkTopology(networkId);
  const nodeLookup = useMemo(() => {
    const map = new Map<string, InfraNode>();
    if (topology?.nodes) {
      for (const n of topology.nodes) map.set(n.id, n);
    }
    return map;
  }, [topology]);

  const { result, currentWave, isPlaying, play, pause, reset, setSimulationResult } = useSimulationStore();
  
  const simMutation = useRunSimulation();
  const createScenarioMutation = useCreateScenario();
  
  const { data: polledResult } = useSimulationResult(simMutation.data?.id || null);

  useEffect(() => {
    if (polledResult && polledResult.status === "completed") {
      if (!result || result.id !== polledResult.id) {
        setSimulationResult(polledResult);
      }
      try {
        const existing = JSON.parse(localStorage.getItem("ripple_simulations") || "[]");
        if (!existing.some((s: any) => s.id === polledResult.id)) {
          existing.unshift({
            id: polledResult.id,
            network_id: polledResult.network_id,
            initial_failures: polledResult.initial_failures,
            created_at: new Date().toISOString(),
          });
          localStorage.setItem("ripple_simulations", JSON.stringify(existing.slice(0, 20)));
          window.dispatchEvent(new Event("ripple_simulations_updated"));
        }
      } catch {}
    }
  }, [polledResult, result, setSimulationResult]);

  const handleRunBaseline = () => {
    if (!networkId || selectedNodeIds.size === 0) return;
    simMutation.mutate({
      network_id: networkId,
      initial_failures: Array.from(selectedNodeIds),
      scenario_id: undefined
    });
  };

  const handleSaveScenario = async () => {
    if (!networkId || redundancyNodes.length !== 2 || selectedNodeIds.size === 0) return;
    try {
      const scenario = await createScenarioMutation.mutateAsync({
        network_id: networkId,
        name: "Redundancy What-If",
        modifications: [
          {
            type: "add_edge",
            source: redundancyNodes[0],
            target: redundancyNodes[1],
            edge_type: "power_supply",
            is_bidirectional: true
          }
        ],
        initial_failures: Array.from(selectedNodeIds)
      });
      
      try {
        const existingScenarios = JSON.parse(localStorage.getItem("ripple_scenarios") || "[]");
        existingScenarios.unshift({
          id: scenario.id,
          name: scenario.name,
          network_id: scenario.network_id,
          initial_failures: scenario.initial_failures,
          created_at: new Date().toISOString(),
        });
        localStorage.setItem("ripple_scenarios", JSON.stringify(existingScenarios.slice(0, 20)));
        window.dispatchEvent(new Event("ripple_scenarios_updated"));
      } catch {}

      // Run the scenario simulation
      simMutation.mutate({
        network_id: networkId,
        initial_failures: Array.from(selectedNodeIds),
        scenario_id: scenario.id
      });
      
      setMode("default");
    } catch (e) {
      console.error(e);
      alert("Failed to create scenario: " + e);
    }
  };

  const isRunning = simMutation.isPending || (polledResult && polledResult.status !== "completed" && polledResult.status !== "failed");

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Simulation Controls</h2>
        <select 
          style={{ background: "#1e293b", color: "white", padding: "4px 8px", borderRadius: 4, border: "1px solid #334155" }}
          value={mode}
          onChange={(e) => setMode(e.target.value as any)}
        >
          <option value="default">Baseline Simulation</option>
          <option value="add_redundancy">What-If: Add Redundancy</option>
        </select>
      </div>
      
      {mode === "default" && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600 }}>
              Initial Failures ({selectedNodeIds.size}):
            </span>
            {selectedNodeIds.size > 0 && (
              <button
                onClick={clearSelection}
                disabled={isRunning}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#f87171",
                  fontSize: 11,
                  cursor: "pointer",
                  padding: 0,
                  textDecoration: "underline",
                }}
              >
                Clear all
              </button>
            )}
          </div>

          {selectedNodeIds.size === 0 ? (
            <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 10px 0", fontStyle: "italic" }}>
              Click nodes on the map or graph to select failure trigger points.
            </p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 110, overflowY: "auto", marginBottom: 10, padding: "2px 0" }}>
              {Array.from(selectedNodeIds).map((id) => {
                const node = nodeLookup.get(id);
                const name = node?.display_name || node?.name || id.slice(0, 8);
                const nameSource = node?.name_source || node?.data_source || "synthetic";
                const dataQuality = node?.data_quality || "verified";
                return (
                  <span
                    key={id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      background: "#1e293b",
                      border: "1px solid #ef4444",
                      borderRadius: 4,
                      padding: "2px 6px",
                      fontSize: 11,
                      color: "#fca5a5",
                    }}
                    title={`ID: ${id} | Source: ${nameSource} | Quality: ${dataQuality}`}
                  >
                    <span>{name}</span>
                    <span style={{ fontSize: 9, padding: "0 3px", borderRadius: 2, background: "#334155", color: "#94a3b8" }}>
                      {nameSource}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleNodeSelection(id);
                      }}
                      disabled={isRunning}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#94a3b8",
                        cursor: "pointer",
                        fontSize: 13,
                        lineHeight: 1,
                        padding: 0,
                        marginLeft: 2,
                      }}
                      title="Deselect node"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleRunBaseline}
              disabled={selectedNodeIds.size === 0 || isRunning}
              style={{
                flex: 1,
                padding: "8px 16px",
                background: isRunning ? "#64748b" : (selectedNodeIds.size > 0 ? "#ef4444" : "#334155"),
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor: (selectedNodeIds.size === 0 || isRunning) ? "not-allowed" : "pointer",
                fontWeight: "bold",
              }}
            >
              {isRunning ? "Running..." : "Simulate Baseline"}
            </button>
            <button
              onClick={clearSelection}
              disabled={selectedNodeIds.size === 0 || isRunning}
              style={{ padding: "8px 16px", background: "#334155", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {mode === "add_redundancy" && (
        <div style={{ marginBottom: 16, background: "#064e3b", padding: 12, borderRadius: 4, border: "1px solid #059669" }}>
          <p style={{ fontSize: 14, marginBottom: 8, color: "#a7f3d0" }}>
            1. Select exactly 2 nodes to add a redundant power line between.<br/>
            2. Make sure you also have initial failures selected (using Baseline mode).
          </p>
          <div style={{ fontSize: 13, marginBottom: 8, color: "#cbd5e1" }}>
            <span>Connect Pair ({redundancyNodes.length}/2):</span>
            {redundancyNodes.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                {redundancyNodes.map((id, idx) => (
                  <span
                    key={id}
                    style={{
                      background: "#065f46",
                      border: "1px solid #10b981",
                      borderRadius: 4,
                      padding: "2px 8px",
                      fontSize: 11,
                      color: "#a7f3d0",
                    }}
                  >
                    {idx === 0 ? "From: " : "To: "}
                    <strong>{nodeLookup.get(id)?.display_name || nodeLookup.get(id)?.name || id.slice(0, 8)}</strong>
                  </span>
                ))}
              </div>
            ) : (
              <span style={{ color: "#6ee7b7", fontStyle: "italic", marginLeft: 4 }}>Select 2 nodes on map</span>
            )}
          </div>
          <p style={{ fontSize: 13, marginBottom: 12 }}>Initial Failures ready: {selectedNodeIds.size}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleSaveScenario}
              disabled={redundancyNodes.length !== 2 || selectedNodeIds.size === 0 || isRunning}
              style={{
                flex: 1,
                padding: "8px 16px",
                background: (redundancyNodes.length === 2 && selectedNodeIds.size > 0 && !isRunning) ? "#10b981" : "#334155",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              {isRunning ? "Running..." : "Save & Simulate"}
            </button>
            <button
              onClick={clearRedundancyNodes}
              style={{ padding: "8px 16px", background: "#334155", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {result && result.status === "completed" && (
        <div style={{ padding: 12, background: "#1e293b", borderRadius: 4, marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 8px 0", fontSize: 14 }}>Simulation Results</h3>
          <p style={{ margin: "4px 0", fontSize: 13 }}>Waves: <span style={{ color: "#3b82f6" }}>{result.waves.length}</span></p>
          <p style={{ margin: "4px 0", fontSize: 13 }}>Failed Assets: <span style={{ color: "#ef4444" }}>{result.total_failed}</span></p>
          <div style={{ margin: "4px 0", fontSize: 13, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            <span>Pop Affected: <strong style={{ color: "#f59e0b" }}>{result.population_affected_estimate.toLocaleString()}</strong></span>
            {result.has_unresolved_overlap && (
              <span
                title="Multiple utility failure areas overlap without parcel-level polygon data. Total is capped at study-area limit."
                style={{
                  background: "#d97706",
                  color: "#ffffff",
                  padding: "1px 6px",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                ⚠️ Unresolved Overlap
              </span>
            )}
          </div>
          {result.is_population_capped && (
            <span style={{ color: "#94a3b8", fontSize: 11, display: "block", marginBottom: 4 }}>
              (Capped at {result.study_area_population_cap?.toLocaleString() || "65,000"} municipal limit)
            </span>
          )}
          {result.global_efficiency_before !== null && result.global_efficiency_after !== null && (
            <p style={{ margin: "4px 0", fontSize: 13 }}>Efficiency: <span style={{ color: "#22c55e" }}>{(result.global_efficiency_before * 100).toFixed(1)}%</span> → <span style={{ color: "#ef4444" }}>{(result.global_efficiency_after * 100).toFixed(1)}%</span></p>
          )}
        </div>
      )}

      {result && result.waves.length > 0 && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 14 }}>Wave: {currentWave} / {result.waves.length - 1}</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button
              onClick={isPlaying ? pause : play}
              style={{ flex: 1, padding: "6px", background: "#3b82f6", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
            >
              {isPlaying ? "Pause" : "Play Animation"}
            </button>
            <button
              onClick={reset}
              style={{ padding: "6px 12px", background: "#334155", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ControlPanel;

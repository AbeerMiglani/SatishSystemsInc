import React, { useEffect, useMemo, useRef, useState } from "react";
import { useUIStore } from "../stores/uiStore";
import { useSimulationStore } from "../stores/simulationStore";
import { useRunSimulation, useSimulationResult, useCreateScenario, useNetworkTopology } from "../api/hooks";
import type { InfraNode } from "../types";
import { comparablePopulation } from "../types";
import ProvenanceTag from "./shared/ProvenanceTag";

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

  const { result, reset, setSimulationResult, addSimulation, registerScenario, setRunning, setRunError } =
    useSimulationStore();
  const [dismissedSimulationIds, setDismissedSimulationIds] = useState<Set<string>>(new Set());

  const simMutation = useRunSimulation();
  const createScenarioMutation = useCreateScenario();

  const { data: polledResult } = useSimulationResult(simMutation.data?.id || null);

  // Ids this panel has already adopted/recorded once they settled. Deciding
  // by "have I handled this polled id before" — rather than by comparing
  // against the shared `result` — matters: `result` can legitimately move on
  // afterward (e.g. RecommendationPanel adopting a verified rerun), and the
  // old comparison (`result.id !== polledResult.id`) treated that as "my
  // baseline hasn't been adopted yet" and silently re-adopted it, reverting
  // the whole app back to the pre-intervention baseline behind the user's
  // back. A ref survives re-renders without re-triggering this effect.
  const handledPolledIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!polledResult || polledResult.status !== "completed") return;
    if (handledPolledIds.current.has(polledResult.id)) return;
    handledPolledIds.current.add(polledResult.id);

    // The store owns persistence of `ripple_simulations`; setSimulationResult
    // records the run as part of adopting it.
    if (!dismissedSimulationIds.has(polledResult.id)) {
      setSimulationResult(polledResult);
      return;
    }

    // Dismissed — setSimulationResult is skipped, so record the run directly
    // instead of losing it from history.
    addSimulation(
      {
        id: polledResult.id,
        network_id: polledResult.network_id,
        initial_failures: polledResult.initial_failures,
        total_failed: polledResult.total_failed,
        is_baseline: false,
        created_at: new Date().toISOString(),
      },
      false
    );
  }, [polledResult, dismissedSimulationIds, setSimulationResult, addSimulation]);

  // Broadcast running/failed status to the shared store so the map overlay
  // and impact summary agree with this panel about what's happening.
  useEffect(() => {
    if (simMutation.isPending) {
      setRunning(true);
      return;
    }
    if (simMutation.isError) {
      setRunError(simMutation.error instanceof Error ? simMutation.error.message : "Failed to start simulation.");
      return;
    }
    if (polledResult) {
      if (polledResult.status === "failed") {
        setRunError(polledResult.error_message || "The simulation engine reported a failure.");
      } else if (polledResult.status === "pending" || polledResult.status === "running") {
        setRunning(true);
      }
    }
  }, [simMutation.isPending, simMutation.isError, simMutation.error, polledResult, setRunning, setRunError]);

  const handleRunBaseline = () => {
    if (!networkId || selectedNodeIds.size === 0) return;
    setRunning(true);
    simMutation.mutate({
      network_id: networkId,
      initial_failures: Array.from(selectedNodeIds),
      scenario_id: undefined,
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
            is_bidirectional: true,
          },
        ],
        initial_failures: Array.from(selectedNodeIds),
      });

      // registerScenario persists to `ripple_scenarios` and updates the store's
      // `scenarios` / `lastAppliedScenarioId`, so ScenarioCompare picks the new
      // scenario up immediately rather than only after a reload.
      registerScenario({
        id: scenario.id,
        name: scenario.name,
        network_id: scenario.network_id,
        initial_failures: scenario.initial_failures,
        created_at: scenario.created_at ?? new Date().toISOString(),
      });

      setRunning(true);
      simMutation.mutate({
        network_id: networkId,
        initial_failures: Array.from(selectedNodeIds),
        scenario_id: scenario.id,
      });

      setMode("default");
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Failed to create scenario.");
    }
  };

  const handleResetTimeline = () => {
    if (result?.status === "completed") {
      setDismissedSimulationIds((prev) => {
        const next = new Set(prev);
        next.add(result.id);
        return next;
      });
    }
    reset();
  };

  const isRunning = simMutation.isPending || (polledResult && polledResult.status !== "completed" && polledResult.status !== "failed");

  return (
    <div style={{ padding: 16, borderBottom: "1px solid var(--rp-divider)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h4 style={{ fontSize: 13.5, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--rp-text)" }}>Simulation controls</h4>
        <select
          className="rp-btn rp-btn-secondary"
          style={{ fontSize: 11.5, padding: "4px 8px" }}
          value={mode}
          onChange={(e) => setMode(e.target.value as any)}
        >
          <option value="default">Baseline</option>
          <option value="add_redundancy">What-if: add redundancy</option>
        </select>
      </div>

      {mode === "default" && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11.5, color: "var(--rp-mute)", fontWeight: 600 }}>
              Initial failures ({selectedNodeIds.size})
            </span>
            {selectedNodeIds.size > 0 && (
              <button className="rp-btn rp-btn-ghost" style={{ fontSize: 11, padding: 0 }} onClick={clearSelection} disabled={!!isRunning}>
                Clear all
              </button>
            )}
          </div>

          {selectedNodeIds.size === 0 ? (
            <p style={{ fontSize: 12, color: "var(--rp-mute)", margin: "0 0 10px 0", fontStyle: "italic" }}>
              Click assets on the map or the topology graph to select failure trigger points.
            </p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 110, overflowY: "auto", marginBottom: 10, padding: "2px 0" }}>
              {Array.from(selectedNodeIds).map((id) => {
                const node = nodeLookup.get(id);
                const name = node?.display_name || node?.name || id.slice(0, 8);
                const nameSource = node?.name_source || node?.data_source || "synthetic";
                const dataQuality = node?.data_quality || "estimated";
                return (
                  <span
                    key={id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      background: "var(--rp-surface-2)",
                      border: "1px solid var(--rp-wave-0)",
                      padding: "2px 6px",
                      fontSize: 11,
                      color: "#fca5a5",
                    }}
                    title={`ID: ${id} | Source: ${nameSource} | Quality: ${dataQuality}`}
                  >
                    <span>{name}</span>
                    <span style={{ fontSize: 9, padding: "0 3px", background: "var(--rp-surface-3)", color: "var(--rp-mute)" }}>{nameSource}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleNodeSelection(id);
                      }}
                      disabled={!!isRunning}
                      style={{ background: "transparent", border: "none", color: "var(--rp-mute)", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0, marginLeft: 2 }}
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
              className={`rp-btn ${selectedNodeIds.size > 0 && !isRunning ? "rp-btn-danger" : "rp-btn-secondary"}`}
              style={{ flex: 1 }}
              onClick={handleRunBaseline}
              disabled={selectedNodeIds.size === 0 || !!isRunning}
            >
              {isRunning && (
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="rp-spin">
                  <path d="M12 3a9 9 0 019 9" strokeLinecap="round" />
                </svg>
              )}
              {isRunning ? "Running…" : "Simulate baseline"}
            </button>
            <button className="rp-btn rp-btn-secondary" onClick={clearSelection} disabled={selectedNodeIds.size === 0 || !!isRunning}>
              Clear
            </button>
          </div>
        </div>
      )}

      {mode === "add_redundancy" && (
        <div className="rp-blueprint" style={{ marginBottom: 12, padding: 12, background: "rgba(92,178,166,.06)", borderColor: "rgba(92,178,166,.4)" }}>
          <i className="rp-corner tl" />
          <i className="rp-corner br" />
          <p style={{ fontSize: 12.5, marginBottom: 8, color: "var(--rp-teal-bright)", lineHeight: 1.5 }}>
            1. Select exactly 2 nodes to add a redundant power line between.
            <br />
            2. Also select initial failures in Baseline mode.
          </p>
          <div style={{ fontSize: 12, marginBottom: 8, color: "var(--rp-text-dim)" }}>
            <span>Connect pair ({redundancyNodes.length}/2):</span>
            {redundancyNodes.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                {redundancyNodes.map((id, idx) => (
                  <span key={id} style={{ background: "rgba(92,178,166,.12)", border: "1px solid var(--rp-teal)", padding: "2px 8px", fontSize: 11, color: "var(--rp-teal-bright)" }}>
                    {idx === 0 ? "From: " : "To: "}
                    <strong>{nodeLookup.get(id)?.display_name || nodeLookup.get(id)?.name || id.slice(0, 8)}</strong>
                  </span>
                ))}
              </div>
            ) : (
              <span style={{ color: "var(--rp-teal)", fontStyle: "italic", marginLeft: 4 }}>Select 2 nodes on the map</span>
            )}
          </div>
          <p style={{ fontSize: 12, marginBottom: 10 }}>Initial failures ready: {selectedNodeIds.size}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="rp-btn rp-btn-primary"
              style={{ flex: 1, background: "var(--rp-teal)", borderColor: "var(--rp-teal)" }}
              onClick={handleSaveScenario}
              disabled={redundancyNodes.length !== 2 || selectedNodeIds.size === 0 || !!isRunning}
            >
              {isRunning ? "Running…" : "Save & simulate"}
            </button>
            <button className="rp-btn rp-btn-secondary" onClick={clearRedundancyNodes}>
              Clear
            </button>
          </div>
        </div>
      )}

      {simMutation.isError && (
        <div className="rp-blueprint" style={{ marginBottom: 12, padding: "8px 10px", background: "rgba(240,68,56,.08)", borderColor: "rgba(240,68,56,.4)" }}>
          <span style={{ fontSize: 12, color: "var(--rp-error-soft)" }}>
            {simMutation.error instanceof Error ? simMutation.error.message : "Failed to start simulation."}
          </span>
        </div>
      )}

      {result && result.status === "completed" && (
        <div style={{ padding: 10, background: "var(--rp-surface-3)", display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--rp-mute)" }}>Active result</span>
            <button className="rp-btn rp-btn-ghost" style={{ fontSize: 10.5, padding: 0 }} onClick={handleResetTimeline}>
              Clear
            </button>
          </div>
          <p style={{ margin: "2px 0", fontSize: 12.5 }}>
            Failed: <strong style={{ color: "var(--rp-wave-0)" }}>{result.total_failed}</strong> · Waves:{" "}
            <strong style={{ color: "var(--rp-accent)" }}>{result.waves.length}</strong>
          </p>
          <p style={{ margin: "2px 0", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            Pop affected: <strong style={{ color: "var(--rp-wave-2)" }}>{comparablePopulation(result).toLocaleString()}</strong>
            {result.has_unresolved_overlap && (
              <span title="Multiple utility failure areas overlap without parcel-level polygon data. Total is capped at the study-area limit.">
                <ProvenanceTag kind="estimated" label="⚠ overlap" />
              </span>
            )}
          </p>
          {result.cascade_stabilized === false && (
            <div style={{ marginTop: 2 }}>
              <ProvenanceTag kind="derived" label="⏱ truncated at wave guardrail" />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ControlPanel;

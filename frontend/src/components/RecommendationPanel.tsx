/**
 * RecommendationPanel — shows mitigation recommendations for a completed simulation
 * and allows users to apply them (creates scenario + re-simulates).
 *
 * Visibly distinguishes:
 * - ⚡ Upgrade Node (blue badge) vs 🔗 Redundancy / Add Edge (green badge)
 * - 🏥 Protects Hospital / Critical Service (gold/amber badge)
 * - State registration into useSimulationStore and localStorage
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSimulationStore, StoredScenario } from "../stores/simulationStore";
import type { MitigationRecommendation } from "../types";

export default function RecommendationPanel() {
  const result = useSimulationStore((s) => s.result);
  const setSimulationResult = useSimulationStore((s) => s.setSimulationResult);
  const baselineSimulationId = useSimulationStore((s) => s.baselineSimulationId);
  const setBaselineSimulationId = useSimulationStore((s) => s.setBaselineSimulationId);
  const registerScenario = useSimulationStore((s) => s.registerScenario);
  const setLastAppliedScenarioId = useSimulationStore((s) => s.setLastAppliedScenarioId);
  const addSimulation = useSimulationStore((s) => s.addSimulation);

  // Track which recommendations have been applied (by rank)
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState<Set<number>>(new Set());
  const [applyErrors, setApplyErrors] = useState<Map<number, string>>(new Map());

  const { data: recommendations, isLoading, isError } = useQuery({
    queryKey: ["recommendations", result?.id],
    queryFn: async () => {
      const res = await fetch(`/api/simulations/${result!.id}/recommendations?limit=5`);
      if (!res.ok) throw new Error("Failed to fetch recommendations");
      return res.json() as Promise<MitigationRecommendation[]>;
    },
    enabled: result?.status === "completed",
  });

  if (!result || result.status !== "completed") return null;

  const handleApply = async (rec: MitigationRecommendation) => {
    setApplying((prev) => new Set(prev).add(rec.rank));
    setApplyErrors((prev) => {
      const m = new Map(prev);
      m.delete(rec.rank);
      return m;
    });

    try {
      // Ensure baselineSimulationId is saved before running what-if scenario
      if (result && !baselineSimulationId) {
        setBaselineSimulationId(result.id);
      }

      // Step a: POST to /api/scenarios with scenario_payload
      const scenarioRes = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rec.scenario_payload),
      });
      if (!scenarioRes.ok) throw new Error("Failed to create scenario");
      const scenario = await scenarioRes.json();

      // Step b: Register scenario in Zustand store and persist to localStorage
      const entry: StoredScenario = {
        id: scenario.id,
        name: scenario.name,
        network_id: scenario.network_id,
        initial_failures: scenario.initial_failures,
        intervention_type: rec.intervention_type,
        created_at: scenario.created_at ?? new Date().toISOString(),
      };
      registerScenario(entry);
      setLastAppliedScenarioId(scenario.id);

      // Step c: POST to /api/simulations
      const simRes = await fetch("/api/simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network_id: rec.scenario_payload.network_id,
          initial_failures: rec.scenario_payload.initial_failures,
          scenario_id: scenario.id,
        }),
      });
      if (!simRes.ok) throw new Error("Failed to start simulation");
      const simData = await simRes.json();

      // Step d: Poll until completed/failed (max 30 attempts = ~60 s)
      const simId = simData.id;
      let settled = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetch(`/api/simulations/${simId}`);
        if (!pollRes.ok) throw new Error("Failed to poll simulation");
        const pollData = await pollRes.json();
        if (pollData.status === "completed" || pollData.status === "failed") {
          if (pollData.status === "failed") {
            throw new Error("Re-simulation failed — check server logs for details.");
          }
          addSimulation(
            {
              id: pollData.id,
              network_id: pollData.network_id,
              initial_failures: pollData.initial_failures,
              total_failed: pollData.total_failed,
              is_baseline: false,
              scenario_id: scenario.id,
              created_at: new Date().toISOString(),
            },
            false
          );
          setSimulationResult(pollData);
          settled = true;
          break;
        }
      }
      if (!settled) throw new Error("Re-simulation timed out after 60 s.");

      setApplied((prev) => new Set(prev).add(rec.rank));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error applying recommendation.";
      setApplyErrors((prev) => new Map(prev).set(rec.rank, msg));
    } finally {
      setApplying((prev) => {
        const next = new Set(prev);
        next.delete(rec.rank);
        return next;
      });
    }
  };

  return (
    <div
      style={{
        borderTop: "1px solid #334155",
        padding: "12px 16px",
        background: "#0f172a",
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: 13,
          color: "#94a3b8",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 10,
        }}
      >
        🛡️ Mitigation Recommendations
      </div>

      {isLoading && (
        <div style={{ color: "#64748b", fontSize: 13 }}>Loading recommendations…</div>
      )}

      {isError && (
        <div style={{ color: "#ef4444", fontSize: 13 }}>Failed to load recommendations.</div>
      )}

      {recommendations && recommendations.length === 0 && (
        <div style={{ color: "#64748b", fontSize: 13 }}>No recommendations available.</div>
      )}

      {recommendations &&
        recommendations.map((rec) => {
          const isAddEdge = rec.intervention_type === "add_edge";
          const srcName = rec.display_name || rec.node_name;
          const tgtName =
            rec.target_display_name ||
            rec.target_node_name ||
            (rec.target_node_id ? `Node ${rec.target_node_id.slice(0, 8)}` : "");
          const displayName = isAddEdge ? `${srcName} ➔ ${tgtName}` : srcName;

          const isApplied = applied.has(rec.rank);
          const isApplying = applying.has(rec.rank);
          const applyError = applyErrors.get(rec.rank);

          const buttonLabel = isApplied
            ? "✓ Applied"
            : isApplying
            ? "…"
            : isAddEdge
            ? "Apply Redundancy Scenario"
            : "Apply Upgrade Scenario";

          return (
            <div
              key={rec.rank}
              style={{
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: 6,
                padding: "10px 12px",
                marginBottom: 8,
              }}
            >
              {/* Badges container */}
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  flexWrap: "wrap",
                  marginBottom: 6,
                }}
              >
                {isAddEdge ? (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "#14532d",
                      border: "1px solid #22c55e",
                      color: "#86efac",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    🔗 Redundancy / Add Edge
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "#1e3a8a",
                      border: "1px solid #3b82f6",
                      color: "#93c5fd",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    ⚡ Upgrade Node
                  </span>
                )}

                {rec.protects_critical_services && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: "linear-gradient(135deg, #b45309, #d97706)",
                      border: "1px solid #f59e0b",
                      color: "#ffffff",
                      boxShadow: "0 0 6px rgba(245, 158, 11, 0.4)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    🏥 Protects Hospital / Critical Service
                  </span>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      color: "#e2e8f0",
                      marginBottom: 4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ color: "#3b82f6", marginRight: 6 }}>#{rec.rank}</span>
                    {displayName}
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>
                    <span style={{ color: "#f87171" }}>Failures prevented: </span>
                    <strong style={{ color: "#e2e8f0" }}>{rec.failures_prevented}</strong>
                    <span style={{ margin: "0 6px", color: "#475569" }}>·</span>
                    <span style={{ color: "#4ade80" }}>Pop. saved: </span>
                    <strong style={{ color: "#e2e8f0" }}>
                      {rec.raw_population_saved.toLocaleString()}
                    </strong>
                    <span style={{ margin: "0 6px", color: "#475569" }}>·</span>
                    <span style={{ color: "#facc15" }}>Efficiency ↑ </span>
                    <strong style={{ color: "#e2e8f0" }}>
                      {(rec.efficiency_gain * 100).toFixed(1)}%
                    </strong>
                  </div>
                </div>
                <button
                  onClick={() => handleApply(rec)}
                  disabled={isApplied || isApplying}
                  style={{
                    marginLeft: 10,
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 500,
                    borderRadius: 4,
                    border: "none",
                    cursor: isApplied || isApplying ? "not-allowed" : "pointer",
                    background: isApplied ? "#166534" : isApplying ? "#1e293b" : isAddEdge ? "#15803d" : "#2563eb",
                    color: isApplied ? "#4ade80" : "#e2e8f0",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {buttonLabel}
                </button>
              </div>
              {applyError && (
                <div style={{ marginTop: 6, fontSize: 11, color: "#f87171" }}>
                  ⚠️ {applyError}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

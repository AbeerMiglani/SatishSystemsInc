import React, { useState, useMemo } from "react";
import { useCompareScenarios, useNetworkTopology } from "../api/hooks";
import { useSimulationStore } from "../stores/simulationStore";
import { useUIStore } from "../stores/uiStore";
import type { InfraNode } from "../types";

const ScenarioCompare: React.FC = () => {
  const networkId = useUIStore((s) => s.networkId);
  const activeResult = useSimulationStore((s) => s.result);
  const simulations = useSimulationStore((s) => s.simulations);
  const scenarios = useSimulationStore((s) => s.scenarios);
  const baselineSimulationId = useSimulationStore((s) => s.baselineSimulationId);
  const lastAppliedScenarioId = useSimulationStore((s) => s.lastAppliedScenarioId);

  const { data: topology } = useNetworkTopology(networkId);
  const nodeLookup = useMemo(() => {
    const map = new Map<string, InfraNode>();
    if (topology?.nodes) {
      for (const n of topology.nodes) map.set(n.id, n);
    }
    return map;
  }, [topology]);

  const [selectedBaselineId, setSelectedBaselineId] = useState<string>("");
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("");
  const [filterText, setFilterText] = useState<string>("");

  // Helper to generate readable baseline label from initial failures
  const getReadableFailures = (failureIds: string[]) => {
    if (!failureIds || failureIds.length === 0) return "No initial failures";
    return failureIds
      .map((id) => {
        const n = nodeLookup.get(id);
        const name = n?.display_name || n?.name || id.slice(0, 8);
        const source = n?.name_source || n?.data_source;
        return source ? `${name} (${source})` : name;
      })
      .join(", ");
  };

  // Compile available baseline options from simulationStore
  const baselineOptions = useMemo(() => {
    const list: { id: string; label: string; isBaseline: boolean }[] = [];
    const filteredSims = simulations.filter((s) => !networkId || s.network_id === networkId);

    // If activeResult is completed and in current network
    if (
      activeResult &&
      activeResult.status === "completed" &&
      (!networkId || activeResult.network_id === networkId)
    ) {
      const isBase = activeResult.id === baselineSimulationId || !baselineSimulationId;
      list.push({
        id: activeResult.id,
        label: `${isBase ? "⭐ Baseline" : "Run"}: ${getReadableFailures(activeResult.initial_failures)} (${activeResult.id.slice(0, 8)})`,
        isBaseline: isBase,
      });
    }

    for (const sim of filteredSims) {
      if (!list.some((item) => item.id === sim.id)) {
        const isBase = sim.id === baselineSimulationId || sim.is_baseline;
        list.push({
          id: sim.id,
          label: `${isBase ? "⭐ Baseline" : "Run"}: ${getReadableFailures(sim.initial_failures)} (${sim.id.slice(0, 8)})`,
          isBaseline: !!isBase,
        });
      }
    }
    return list;
  }, [activeResult, simulations, baselineSimulationId, networkId, nodeLookup]);

  // Compile available scenario options from simulationStore
  const scenarioOptions = useMemo(() => {
    const filtered = scenarios.filter((s) => !networkId || s.network_id === networkId);
    return filtered.filter(
      (scen) => !filterText || scen.name.toLowerCase().includes(filterText.toLowerCase())
    );
  }, [scenarios, networkId, filterText]);

  // Reactive default resolution (zero manual UUIDs needed)
  const activeBaselineId =
    selectedBaselineId ||
    baselineSimulationId ||
    baselineOptions.find((o) => o.isBaseline)?.id ||
    baselineOptions[0]?.id ||
    "";

  const activeScenarioId =
    selectedScenarioId ||
    lastAppliedScenarioId ||
    scenarioOptions[0]?.id ||
    "";

  const { data, isLoading, error } = useCompareScenarios(
    activeBaselineId && activeBaselineId.length > 30 ? activeBaselineId : null,
    activeScenarioId && activeScenarioId.length > 30 ? activeScenarioId : null
  );

  return (
    <div style={{ padding: 16, background: "#1e293b", borderTop: "1px solid #334155" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Scenario Comparison</h3>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {/* Baseline Run Selector */}
        <div>
          <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4, fontWeight: 500 }}>
            Select Baseline Run:
          </label>
          <select
            value={activeBaselineId}
            onChange={(e) => setSelectedBaselineId(e.target.value)}
            style={{
              width: "100%",
              padding: "6px 8px",
              background: "#0f172a",
              border: "1px solid #475569",
              color: "white",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            <option value="">-- Choose Baseline Simulation --</option>
            {baselineOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Scenario Selector */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <label style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>
              Select What-If Scenario:
            </label>
            {scenarioOptions.length > 2 && (
              <input
                type="text"
                placeholder="Filter..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                style={{
                  padding: "2px 4px",
                  background: "#0f172a",
                  border: "1px solid #334155",
                  color: "white",
                  borderRadius: 3,
                  fontSize: 10,
                  width: 70,
                }}
              />
            )}
          </div>
          <select
            value={activeScenarioId}
            onChange={(e) => setSelectedScenarioId(e.target.value)}
            style={{
              width: "100%",
              padding: "6px 8px",
              background: "#0f172a",
              border: "1px solid #475569",
              color: "white",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            <option value="">-- Choose What-If Scenario --</option>
            {scenarioOptions.map((scen) => {
              const typeIcon = scen.intervention_type === "add_edge" ? "🔗 [Redundancy]" : "⚡ [Upgrade]";
              return (
                <option key={scen.id} value={scen.id}>
                  {typeIcon} {scen.name} ({getReadableFailures(scen.initial_failures)}) - {scen.id.slice(0, 8)}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {baselineOptions.length === 0 && scenarioOptions.length === 0 && (
        <p style={{ fontSize: 12, color: "#64748b", fontStyle: "italic", margin: "0 0 12px 0" }}>
          Run a baseline simulation and apply a recommended intervention to view comparison.
        </p>
      )}

      {isLoading && <p style={{ fontSize: 12, color: "#94a3b8" }}>Loading comparison...</p>}
      {error && <p style={{ color: "#ef4444", fontSize: 12 }}>{(error as Error).message}</p>}

      {data && (
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1, padding: 10, background: "#0f172a", borderRadius: 4, border: "1px solid #334155" }}>
            <h4 style={{ margin: "0 0 6px 0", color: "#94a3b8", fontSize: 12 }}>Baseline</h4>
            <p style={{ margin: "3px 0", fontSize: 12 }}>
              Failed: <strong style={{ color: "#ef4444" }}>{data.baseline_result.total_failed}</strong>
            </p>
            <div style={{ margin: "3px 0", fontSize: 12, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
              <span>
                Pop Affected: <strong>{data.baseline_result.population_affected_estimate.toLocaleString()}</strong>
              </span>
              {data.baseline_result.has_unresolved_overlap && (
                <span
                  title="Multiple utility failure areas overlap without parcel-level polygon data. Total is capped at study-area limit."
                  style={{ background: "#d97706", color: "#fff", padding: "0 4px", borderRadius: 3, fontSize: 9, fontWeight: 600 }}
                >
                  ⚠️ Overlap
                </span>
              )}
            </div>
            {data.baseline_result.is_population_capped && (
              <span style={{ color: "#94a3b8", fontSize: 10, display: "block" }}>(Capped at 65k)</span>
            )}
            <p style={{ margin: "3px 0", fontSize: 12 }}>Waves: {data.baseline_result.waves.length}</p>
            {data.baseline_result.global_efficiency_after !== null && (
              <p style={{ margin: "3px 0", fontSize: 12 }}>
                Final Eff: {(data.baseline_result.global_efficiency_after * 100).toFixed(1)}%
              </p>
            )}
          </div>
          <div style={{ flex: 1, padding: 10, background: "#064e3b", borderRadius: 4, border: "1px solid #059669" }}>
            <h4 style={{ margin: "0 0 6px 0", color: "#a7f3d0", fontSize: 12 }}>What-If Scenario</h4>
            <p style={{ margin: "3px 0", fontSize: 12 }}>
              Failed: <strong style={{ color: "#34d399" }}>{data.scenario_result.total_failed}</strong>
            </p>
            <div style={{ margin: "3px 0", fontSize: 12, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
              <span>
                Pop Affected: <strong>{data.scenario_result.population_affected_estimate.toLocaleString()}</strong>
              </span>
              {data.scenario_result.has_unresolved_overlap && (
                <span
                  title="Multiple utility failure areas overlap without parcel-level polygon data. Total is capped at study-area limit."
                  style={{ background: "#d97706", color: "#fff", padding: "0 4px", borderRadius: 3, fontSize: 9, fontWeight: 600 }}
                >
                  ⚠️ Overlap
                </span>
              )}
            </div>
            {data.scenario_result.is_population_capped && (
              <span style={{ color: "#a7f3d0", fontSize: 10, display: "block" }}>(Capped at 65k)</span>
            )}
            <p style={{ margin: "3px 0", fontSize: 12 }}>Waves: {data.scenario_result.waves.length}</p>
            {data.scenario_result.global_efficiency_after !== null && (
              <p style={{ margin: "3px 0", fontSize: 12 }}>
                Final Eff: {(data.scenario_result.global_efficiency_after * 100).toFixed(1)}%
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ScenarioCompare;

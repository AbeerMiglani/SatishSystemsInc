/**
 * ImpactSummary — the six headline metrics for the active simulation result.
 * Renders skeleton tiles while a run is in flight and em-dashes before any
 * result exists, matching the mockup's Impact Summary section.
 */
import React, { useMemo } from "react";
import { useSimulationStore } from "../stores/simulationStore";
import { useNetworkTopology } from "../api/hooks";
import { useUIStore } from "../stores/uiStore";
import { comparablePopulation } from "../types";
import { criticalServicesOffline, failedNodeIdsForResult } from "../utils/derive";
import StatTile from "./shared/StatTile";
import Section from "./shared/Section";

export default function ImpactSummary() {
  const result = useSimulationStore((s) => s.result);
  const isRunning = useSimulationStore((s) => s.isRunning);
  const networkId = useUIStore((s) => s.networkId);
  const { data: topology } = useNetworkTopology(networkId);

  const critical = useMemo(() => {
    if (!result || !topology?.nodes) return null;
    return criticalServicesOffline(topology.nodes, failedNodeIdsForResult(result));
  }, [result, topology]);

  const state = isRunning ? "Computing" : result ? (result.status === "completed" ? "Simulated" : result.status === "failed" ? "Stale" : "Computing") : "—";

  if (isRunning) {
    return (
      <Section title="Impact summary" state={state}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(142px, 1fr))", gap: 9 }}>
          {["Failed assets", "Population affected", "Critical services", "Cascade waves", "Cascade stabilized", "Network efficiency"].map((label) => (
            <StatTile key={label} label={label} value="" sub="Computing" provenance="muted" loading />
          ))}
        </div>
      </Section>
    );
  }

  if (!result || result.status !== "completed") {
    return (
      <Section title="Impact summary" state={state}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(142px, 1fr))", gap: 9 }}>
          <StatTile label="Failed assets" value="—" sub="Awaiting simulation" provenance="muted" />
          <StatTile label="Population affected" value="—" sub="Awaiting simulation" provenance="muted" />
          <StatTile label="Critical services" value="—" sub="Awaiting simulation" provenance="muted" />
          <StatTile label="Cascade waves" value="—" sub="Awaiting simulation" provenance="muted" />
          <StatTile label="Cascade stabilized" value="—" sub="Awaiting simulation" provenance="muted" />
          <StatTile label="Network efficiency" value="—" sub="Awaiting simulation" provenance="muted" />
        </div>
      </Section>
    );
  }

  const uncapped = comparablePopulation(result);
  const popSub = result.is_population_capped
    ? `capped · ${uncapped.toLocaleString()} uncapped`
    : `of the study area`;

  return (
    <Section title="Impact summary" state={state}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(142px, 1fr))", gap: 9 }}>
        <StatTile
          label="Failed assets"
          value={String(result.total_failed)}
          sub={topology?.nodes ? `of ${topology.nodes.length} assets` : undefined}
          provenance="simulated"
          color={result.total_failed > 0 ? "var(--rp-wave-0)" : undefined}
        />
        <StatTile
          label="Population affected"
          value={result.population_affected_estimate.toLocaleString()}
          sub={popSub}
          provenance="estimated"
        />
        <StatTile
          label="Critical services"
          value={critical != null ? String(critical) : "—"}
          sub={critical ? `${critical} hospital${critical === 1 ? "" : "s"} offline` : "all hospitals online"}
          provenance="derived"
          color={critical ? "var(--rp-wave-2)" : "var(--rp-ok)"}
        />
        <StatTile label="Cascade waves" value={String(result.waves.length)} sub="wave 0 → last" provenance="simulated" />
        <StatTile
          label="Cascade stabilized"
          value={result.cascade_stabilized === false ? "No" : result.cascade_stabilized === true ? "Yes" : "—"}
          sub={result.cascade_stabilized === false ? "guardrail reached" : "no further spread"}
          provenance="derived"
          color={result.cascade_stabilized === false ? "var(--rp-wave-2)" : "var(--rp-ok)"}
        />
        <StatTile
          label="Network efficiency"
          value={result.global_efficiency_after != null ? result.global_efficiency_after.toFixed(3) : "—"}
          sub={result.global_efficiency_before != null ? `from ${result.global_efficiency_before.toFixed(3)} baseline` : undefined}
          provenance="derived"
        />
      </div>
    </Section>
  );
}

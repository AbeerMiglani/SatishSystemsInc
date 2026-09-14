/**
 * ExplainPanel — "Explain this result": a short, deterministic narrative
 * assembled from the completed simulation's own fields.
 *
 * This is templating, not an LLM call — see utils/derive.ts. An
 * LLM-generated explanation is a possible later upgrade; this panel exists
 * so the UI has the slot and the fallback state ready for that decision
 * without depending on it.
 */
import React, { useMemo } from "react";
import { useSimulationStore } from "../stores/simulationStore";
import { useNetworkTopology, useCompareScenarios } from "../api/hooks";
import { useUIStore } from "../stores/uiStore";
import { buildExplanation, rawResultFields } from "../utils/derive";
import Section from "./shared/Section";

export default function ExplainPanel({
  topRecommendationRank,
  topRecommendationPrevented,
}: {
  topRecommendationRank?: number;
  topRecommendationPrevented?: number;
}) {
  const result = useSimulationStore((s) => s.result);
  const networkId = useUIStore((s) => s.networkId);
  const baselineSimulationId = useSimulationStore((s) => s.baselineSimulationId);
  const lastAppliedScenarioId = useSimulationStore((s) => s.lastAppliedScenarioId);
  const { data: topology } = useNetworkTopology(networkId);

  // If the current result *is* the scenario re-run of the last applied
  // scenario, pull the baseline/scenario pair so the explanation can speak
  // to the verified rerun in measured terms rather than "not yet run".
  const isLikelyVerifiedRun =
    !!result && !!lastAppliedScenarioId && !!baselineSimulationId && result.id !== baselineSimulationId;
  const { data: comparison } = useCompareScenarios(
    isLikelyVerifiedRun ? baselineSimulationId : null,
    isLikelyVerifiedRun ? lastAppliedScenarioId : null
  );

  const entries = useMemo(() => {
    if (!result || result.status !== "completed" || !topology?.nodes) return null;
    return buildExplanation({
      result,
      nodes: topology.nodes,
      topRecommendation:
        topRecommendationRank != null && topRecommendationPrevented != null
          ? { rank: topRecommendationRank, failures_prevented: topRecommendationPrevented }
          : null,
      verifiedComparison:
        comparison && comparison.scenario_result.id === result.id
          ? { baseline: comparison.baseline_result, scenario: comparison.scenario_result }
          : null,
    });
  }, [result, topology, comparison, topRecommendationRank, topRecommendationPrevented]);

  if (!result || result.status !== "completed") return null;

  const available = !!entries && entries.length > 0;

  return (
    <Section title="Explain this result" state={available ? "Assembled" : "Unavailable"} defaultOpen>
      {available ? (
        <div
          className="rp-blueprint"
          style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, background: "var(--rp-surface-3)" }}
        >
          <i className="rp-corner tl" />
          <i className="rp-corner br" />
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              paddingBottom: 9,
              borderBottom: "1px solid var(--rp-divider)",
            }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--rp-accent)" strokeWidth={1.5} style={{ marginTop: 2, flexShrink: 0 }}>
              <path d="M4 5h16M4 12h10M4 19h7" />
            </svg>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 11.5, color: "var(--rp-text-dim)", lineHeight: 1.4 }}>
                Generated explanation based on the selected simulation result
              </span>
              <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--rp-dim)" }}>
                Assembled from recorded result fields · not an autonomous decision
              </span>
            </span>
          </div>
          {entries!.map((x, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 8, height: 8, background: x.color, flexShrink: 0 }} />
                <span style={{ fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase", color: x.color }}>
                  {x.category}
                </span>
                <span style={{ fontSize: 10, color: "var(--rp-dim)", marginLeft: "auto" }}>{x.field}</span>
              </span>
              <p style={{ margin: 0, fontSize: 12, color: "var(--rp-text-dim)", lineHeight: 1.55 }}>{x.text}</p>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              paddingTop: 9,
              borderTop: "1px solid var(--rp-divider)",
            }}
          >
            <span style={{ fontSize: 10.5, color: "var(--rp-dim)", lineHeight: 1.45 }}>
              Every sentence maps to a field of the selected run. No claim is made that these synthetic
              assets correspond to real-world infrastructure.
            </span>
          </div>
        </div>
      ) : (
        <div style={{ padding: 13, border: "1px dashed var(--rp-divider-strong)", display: "flex", flexDirection: "column", gap: 9 }}>
          <span style={{ fontFamily: "var(--rp-font-heading)", fontWeight: 600, fontSize: 14 }}>
            Explanation unavailable
          </span>
          <span style={{ fontSize: 11.5, color: "var(--rp-text-dim)", lineHeight: 1.5 }}>
            No explanation could be assembled for this run. The result itself is unaffected — the
            recorded fields are shown below exactly as the engine wrote them.
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "rgba(148,188,227,.12)" }}>
            {rawResultFields(result).map((f) => (
              <div key={f.k} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "5px 8px", background: "var(--rp-surface-3)" }}>
                <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 10.5, color: "var(--rp-dim)" }}>{f.k}</span>
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--rp-text)", fontVariantNumeric: "tabular-nums" }}>{f.v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

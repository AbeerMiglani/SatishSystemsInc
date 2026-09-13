import React, { useEffect, useMemo, useState } from "react";
import { useCentrality, useNetworkTopology } from "../api/hooks";
import { useUIStore } from "../stores/uiStore";
import type { CentralityScore, InfraNode } from "../types";

const CriticalityPanel: React.FC = () => {
  const networkId = useUIStore((s) => s.networkId);
  const [metric, setMetric] = useState<"betweenness" | "pagerank">("betweenness");
  const { data: defaultScores, isLoading: isDefaultLoading } = useCentrality(networkId);
  const { data: topology } = useNetworkTopology(networkId);
  const toggleNodeSelection = useUIStore((s) => s.toggleNodeSelection);
  const selectedNodeIds = useUIStore((s) => s.selectedNodeIds);
  const hoverNode = useUIStore((s) => s.setHoveredNode);

  const [metricScores, setMetricScores] = useState<CentralityScore[] | null>(null);
  const [isLoadingMetric, setIsLoadingMetric] = useState<boolean>(false);

  useEffect(() => {
    if (!networkId) return;
    if (metric === "betweenness") {
      setMetricScores(null);
      return;
    }
    let cancelled = false;
    setIsLoadingMetric(true);
    fetch(`/api/networks/${networkId}/centrality?metric=${metric}`)
      .then((res) => {
        if (!res.ok) throw new Error("Centrality fetch failed");
        return res.json();
      })
      .then((data: CentralityScore[]) => {
        if (!cancelled) {
          setMetricScores(data);
          setIsLoadingMetric(false);
        }
      })
      .catch(() => {
        if (!cancelled) setIsLoadingMetric(false);
      });

    return () => {
      cancelled = true;
    };
  }, [networkId, metric]);

  const scores = metric === "betweenness" ? defaultScores : (metricScores || defaultScores);
  const isLoading = metric === "betweenness" ? isDefaultLoading : isLoadingMetric;

  // Fast lookup map for node names and provenance if not present on score objects
  const nodeLookup = useMemo(() => {
    const map = new Map<string, InfraNode>();
    if (topology?.nodes) {
      for (const n of topology.nodes) map.set(n.id, n);
    }
    return map;
  }, [topology]);

  if (isLoading) {
    return <div style={{ padding: 16 }}>Loading criticality...</div>;
  }

  if (!scores) return null;

  // Take top 10
  const top10 = scores.slice(0, 10);
  const maxScore = top10.length > 0 ? (top10[0].score > 0 ? top10[0].score : 1) : 1;

  return (
    <div style={{ padding: 16, borderTop: "1px solid #334155" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Top Critical Nodes</h3>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => setMetric("betweenness")}
            style={{
              padding: "2px 6px",
              fontSize: 10,
              fontWeight: 600,
              borderRadius: 3,
              border: "none",
              cursor: "pointer",
              background: metric === "betweenness" ? "#3b82f6" : "#334155",
              color: metric === "betweenness" ? "#ffffff" : "#94a3b8",
            }}
            title="Betweenness Centrality (Primary) - measures shortest path bottlenecks"
          >
            Betweenness
          </button>
          <button
            onClick={() => setMetric("pagerank")}
            style={{
              padding: "2px 6px",
              fontSize: 10,
              fontWeight: 600,
              borderRadius: 3,
              border: "none",
              cursor: "pointer",
              background: metric === "pagerank" ? "#3b82f6" : "#334155",
              color: metric === "pagerank" ? "#ffffff" : "#94a3b8",
            }}
            title="PageRank (Secondary) - recursive connectivity"
          >
            PageRank
          </button>
        </div>
      </div>
      <p style={{ margin: "0 0 10px 0", fontSize: 11, color: "#94a3b8" }}>
        {metric === "betweenness"
          ? "Primary metric: Shortest path bottleneck articulation points"
          : "Secondary metric: Degree connectivity ranking"}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {top10.map((s, i) => {
          const isSelected = selectedNodeIds.has(s.node_id);
          const percent = (s.score / maxScore) * 100;
          const nodeObj = nodeLookup.get(s.node_id);
          const resolvedName =
            s.display_name ||
            s.name ||
            nodeObj?.display_name ||
            nodeObj?.name ||
            s.node_id.slice(0, 8);
          const nameSource = s.name_source || nodeObj?.name_source || s.data_source || "synthetic";
          const dataQuality = s.data_quality || nodeObj?.data_quality || "estimated";

          return (
            <div
              key={s.node_id}
              onClick={() => toggleNodeSelection(s.node_id)}
              onMouseEnter={() => hoverNode(s.node_id)}
              onMouseLeave={() => hoverNode(null)}
              title={`${resolvedName} (${s.node_id}) | Source: ${nameSource} | Quality: ${dataQuality}`}
              style={{
                background: isSelected ? "#3b82f633" : "#1e293b",
                border: isSelected ? "1px solid #3b82f6" : "1px solid transparent",
                padding: "6px 8px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 12,
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Progress bar background */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${percent}%`,
                  background: "#f59e0b",
                  opacity: 0.2,
                  zIndex: 0,
                }}
              />

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  position: "relative",
                  zIndex: 1,
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontWeight: 500,
                    }}
                  >
                    #{i + 1} {resolvedName}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      padding: "1px 4px",
                      borderRadius: 3,
                      background: "#334155",
                      color: "#94a3b8",
                      flexShrink: 0,
                    }}
                  >
                    {nameSource}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      padding: "1px 4px",
                      borderRadius: 3,
                      background: "#1e3a8a",
                      color: "#93c5fd",
                      flexShrink: 0,
                    }}
                  >
                    {dataQuality}
                  </span>
                </div>
                <span style={{ color: "#f59e0b", fontWeight: "bold", flexShrink: 0 }}>
                  {s.score.toFixed(3)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CriticalityPanel;

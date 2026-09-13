/**
 * MapView — MapLibre GL JS basemap + deck.gl overlay layers.
 *
 * Renders infrastructure nodes as colored circles and edges as lines.
 * Failed nodes pulse red during cascade animation.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import maplibregl from "maplibre-gl";
import { Deck } from "@deck.gl/core";
import { ScatterplotLayer, LineLayer } from "@deck.gl/layers";
import type { InfraNode, InfraEdge } from "../types";
import { NODE_COLORS, NODE_LABELS, FAILED_COLOR, SELECTED_COLOR } from "../types";
import { useUIStore } from "../stores/uiStore";
import { useSimulationStore } from "../stores/simulationStore";

interface MapViewProps {
  nodes: InfraNode[];
  edges: InfraEdge[];
}

// Manipal center coordinates
const INITIAL_VIEW = {
  longitude: 74.789,
  latitude: 13.35,
  zoom: 14.5,
  pitch: 0,
  bearing: 0,
};

export default function MapView({ nodes, edges }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const deckRef = useRef<Deck | null>(null);

  const selectedNodeIds = useUIStore((s) => s.selectedNodeIds);
  const hoveredNodeId = useUIStore((s) => s.hoveredNodeId);
  const toggleNodeSelection = useUIStore((s) => s.toggleNodeSelection);
  const setHoveredNode = useUIStore((s) => s.setHoveredNode);
  const failedNodeIds = useSimulationStore((s) => s.failedNodeIds);
  const mode = useUIStore((s) => s.mode);
  const redundancyNodes = useUIStore((s) => s.redundancyNodes);

  // Pulsing animation for failed nodes
  const [pulseRadius, setPulseRadius] = useState(1);
  useEffect(() => {
    let frame: number;
    let start = performance.now();
    const animate = (now: number) => {
      const t = ((now - start) % 2000) / 2000; // 0-1 over 2 seconds
      setPulseRadius(1 + Math.sin(t * Math.PI) * 0.5);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Build node lookup for edge rendering
  const nodeById = useCallback(() => {
    const map = new Map<string, InfraNode>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  // Update deck.gl layers when state changes
  const updateLayers = useCallback(() => {
    if (!deckRef.current) return;
    const lookup = nodeById();

    const nodeLayer = new ScatterplotLayer<InfraNode>({
      id: "nodes",
      data: nodes,
      getPosition: (d) => [d.lng, d.lat],
      getRadius: (d) => {
        const base = d.node_type === "road_junction" ? 30 : 50;
        if (failedNodeIds.has(d.id)) return base * pulseRadius;
        return base;
      },
      getFillColor: (d: InfraNode) => {
        if (failedNodeIds.has(d.id)) return [239, 68, 68, 255];
        if (mode === "add_redundancy") {
          if (redundancyNodes.includes(d.id)) return [16, 185, 129, 255]; // Emerald
        } else {
          if (selectedNodeIds.has(d.id)) return [56, 189, 248, 255];
        }
        if (d.id === hoveredNodeId) return [250, 204, 21, 255];
        return NODE_COLORS[d.node_type] || [148, 163, 184, 255];
      },
      getLineColor: (d: InfraNode) => {
        if (mode === "add_redundancy" && redundancyNodes.includes(d.id)) return [255, 255, 255, 255];
        if (mode === "default" && selectedNodeIds.has(d.id)) return [255, 255, 255, 255];
        if (failedNodeIds.has(d.id)) return [127, 29, 29, 255];
        return [0, 0, 0, 100];
      },
      getLineWidth: (d: InfraNode) => {
        if (mode === "add_redundancy" && redundancyNodes.includes(d.id)) return 3;
        if (mode === "default" && selectedNodeIds.has(d.id)) return 3;
        return 1;
      },
      pickable: true,
      onClick: (info) => {
        if (info.object) {
          if (mode === "add_redundancy") {
            useUIStore.getState().addRedundancyNode(info.object.id);
          } else {
            toggleNodeSelection(info.object.id);
          }
        }
      },
      onHover: (info) => {
        setHoveredNode(info.object ? info.object.id : null);
      },
      radiusUnits: "meters" as const,
      updateTriggers: {
        getRadius: [failedNodeIds, pulseRadius],
        getFillColor: [selectedNodeIds, hoveredNodeId, failedNodeIds, mode, redundancyNodes],
        getLineColor: [selectedNodeIds, failedNodeIds, mode, redundancyNodes],
        getLineWidth: [selectedNodeIds, mode, redundancyNodes],
      },
    });

    // Build edge line data
    const edgeData = edges
      .map((e) => {
        const src = lookup.get(e.source_id);
        const tgt = lookup.get(e.target_id);
        if (!src || !tgt) return null;
        return { ...e, sourcePos: [src.lng, src.lat] as [number, number], targetPos: [tgt.lng, tgt.lat] as [number, number], src, tgt };
      })
      .filter(Boolean) as (InfraEdge & { sourcePos: [number, number]; targetPos: [number, number]; src: InfraNode; tgt: InfraNode })[];

    const edgeLayer = new LineLayer({
      id: "edges",
      data: edgeData,
      pickable: false,
      getSourcePosition: (d) => d.sourcePos,
      getTargetPosition: (d) => d.targetPos,
      getColor: (d) => {
        const srcFailed = failedNodeIds.has(d.src.id);
        const tgtFailed = failedNodeIds.has(d.tgt.id);
        if (srcFailed || tgtFailed) return [220, 38, 38, 80];
        return [100, 116, 139, 120];
      },
      getWidth: 2,
      updateTriggers: {
        getColor: [failedNodeIds],
      },
    });

    // Blast radius ring for newly failed nodes
    const currentWave = useSimulationStore.getState().currentWave;
    const result = useSimulationStore.getState().result;
    const waves = result ? result.waves : [];
    const blastNodes =
      currentWave >= 0 && currentWave < waves.length
        ? waves[currentWave].failed_node_ids
            .map((id: string) => lookup.get(id))
            .filter(Boolean) as InfraNode[]
        : [];

    const blastLayer = new ScatterplotLayer<InfraNode>({
      id: "blast-radius",
      data: blastNodes,
      pickable: false,
      getPosition: (d) => [d.lng, d.lat],
      getRadius: 120 * pulseRadius,
      getFillColor: [220, 38, 38, 40],
      radiusUnits: "meters" as const,
      updateTriggers: {
        getRadius: [pulseRadius, currentWave],
      },
    });

    deckRef.current.setProps({ layers: [edgeLayer, blastLayer, nodeLayer] });
  }, [nodes, edges, failedNodeIds, selectedNodeIds, hoveredNodeId, pulseRadius, nodeById, toggleNodeSelection, setHoveredNode]);

  // Initialize MapLibre + deck.gl
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [
          {
            id: "osm-tiles",
            type: "raster",
            source: "osm",
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude],
      zoom: INITIAL_VIEW.zoom,
      antialias: true,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    const deck = new Deck({
      parent: containerRef.current,
      viewState: INITIAL_VIEW,
      controller: false, // MapLibre handles interaction
      layers: [],
      style: { position: "absolute", top: "0", left: "0", zIndex: 1, pointerEvents: "auto" } as any,
      getCursor: ({ isHovering }) => (isHovering ? "pointer" : "grab"),
      getTooltip: ({ object }: { object?: InfraNode }) => {
        if (!object) return null;
        const typeLabel = NODE_LABELS[object.node_type] || object.node_type;
        const color = NODE_COLORS[object.node_type] || [148, 163, 184];
        const statusColor = object.status === "failed" ? "#ef4444" : "#22c55e";
        return {
          html: `
            <div style="font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 12px; color: #f8fafc; min-width: 160px; line-height: 1.4;">
              <div style="font-weight: 700; font-size: 13px; color: #ffffff; margin-bottom: 3px;">${object.display_name || object.name || "Unnamed Asset"}</div>
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: rgb(${color.join(',')});"></span>
                <span style="color: #94a3b8; font-size: 11px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em;">${typeLabel}</span>
                <span style="color: ${statusColor}; font-size: 10px; margin-left: auto; text-transform: capitalize;">${object.status}</span>
              </div>
              <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; color: #64748b; border-top: 1px solid #334155; padding-top: 4px; margin-top: 4px;">
                ID: ${object.id}
              </div>
              ${object.population_served ? `<div style="font-size: 11px; color: #cbd5e1; margin-top: 2px;">Pop Served: ${object.population_served.toLocaleString()}</div>` : ""}
              <div style="font-size: 10px; color: #a7f3d0; margin-top: 2px;">Source: ${object.name_source || object.data_source || "synthetic"} | Quality: ${object.data_quality || "estimated"}</div>
            </div>
          `,
          style: {
            backgroundColor: "#0f172a",
            border: "1px solid #334155",
            borderRadius: "6px",
            padding: "8px 12px",
            boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -4px rgba(0, 0, 0, 0.5)",
            pointerEvents: "none",
            zIndex: "1000",
          },
        };
      },
    });

    // Sync deck.gl viewState with MapLibre camera
    map.on("move", () => {
      const center = map.getCenter();
      deck.setProps({
        viewState: {
          longitude: center.lng,
          latitude: center.lat,
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          bearing: map.getBearing(),
        },
      });
    });

    mapRef.current = map;
    deckRef.current = deck;

    return () => {
      deck.finalize();
      map.remove();
      mapRef.current = null;
      deckRef.current = null;
    };
  }, []);

  // Re-render layers on state change
  useEffect(() => {
    updateLayers();
  }, [updateLayers]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
    />
  );
}

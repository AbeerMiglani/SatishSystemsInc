import { useQuery, useMutation } from "@tanstack/react-query";
import type { CentralityScore, InfraEdge, InfraNode, MitigationRecommendation, SimulationResult } from "../types";

// ---------------------------------------------------------------------------
// Networks
// ---------------------------------------------------------------------------

export function useNetworks() {
  return useQuery({
    queryKey: ["networks"],
    queryFn: async () => {
      const res = await fetch("/api/networks");
      if (!res.ok) throw new Error("Failed to fetch networks");
      return res.json() as Promise<{ id: string; name: string }[]>;
    },
  });
}

export function useNetworkTopology(networkId: string | null) {
  return useQuery({
    queryKey: ["networks", networkId, "topology"],
    queryFn: async () => {
      const [nodesRes, edgesRes] = await Promise.all([
        fetch(`/api/networks/${networkId}/nodes`),
        fetch(`/api/networks/${networkId}/edges`),
      ]);
      
      if (!nodesRes.ok || !edgesRes.ok) {
        throw new Error("Failed to fetch topology");
      }
      
      const nodes = await nodesRes.json() as InfraNode[];
      const edges = await edgesRes.json() as InfraEdge[];
      
      return { nodes, edges };
    },
    enabled: !!networkId,
  });
}

export function useCentrality(networkId: string | null) {
  return useQuery({
    queryKey: ["networks", networkId, "centrality"],
    queryFn: async () => {
      const res = await fetch(`/api/networks/${networkId}/centrality`);
      if (!res.ok) throw new Error("Failed to fetch centrality");
      return res.json() as Promise<CentralityScore[]>;
    },
    enabled: !!networkId,
  });
}

// ---------------------------------------------------------------------------
// Simulations
// ---------------------------------------------------------------------------

export function useRunSimulation() {
  return useMutation({
    mutationFn: async (params: { network_id: string; initial_failures: string[]; scenario_id?: string }) => {
      const res = await fetch("/api/simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error("Failed to start simulation");
      return res.json() as Promise<SimulationResult>;
    },
  });
}

export function useSimulationResult(simId: string | null) {
  return useQuery({
    queryKey: ["simulations", simId],
    queryFn: async () => {
      const res = await fetch(`/api/simulations/${simId}`);
      if (!res.ok) throw new Error("Failed to fetch simulation result");
      return res.json() as Promise<SimulationResult>;
    },
    enabled: !!simId,
    // Poll every 2 seconds if not completed/failed
    refetchInterval: (query) => {
      const state = query.state.data;
      if (state && (state.status === "completed" || state.status === "failed")) {
        return false;
      }

      return 2000;
    },
  });
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export function useCreateScenario() {
  return useMutation({
    mutationFn: async (params: { network_id: string; name: string; description?: string; modifications: any[]; initial_failures: string[] }) => {
      const res = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to create scenario");
      }
      return res.json();
    },
  });
}

export function useCompareScenarios(baselineSimId: string | null, scenarioId: string | null) {
  return useQuery({
    queryKey: ["scenarios", "compare", baselineSimId, scenarioId],
    queryFn: async () => {
      const res = await fetch(`/api/scenarios/compare/${baselineSimId}/${scenarioId}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to fetch comparison");
      }
      return res.json() as Promise<{ baseline_result: SimulationResult; scenario_result: SimulationResult }>;
    },
    enabled: !!baselineSimId && !!scenarioId,
  });
}

/**
 * Ranked mitigations for a completed simulation.
 *
 * Deliberately NOT named `useRecommendations`: a hook by that name was removed
 * because it had no call sites and its return type contradicted the endpoint,
 * and `test_frontend_contracts_p2.py` pins it as gone. This one is typed
 * against what the endpoint actually returns — a bare list.
 */
export function useMitigations(simulationId: string | null | undefined, limit = 5) {
  return useQuery<MitigationRecommendation[]>({
    queryKey: ["mitigations", simulationId, limit],
    enabled: !!simulationId,
    queryFn: async () => {
      const res = await fetch(`/api/simulations/${simulationId}/recommendations?limit=${limit}`);
      if (!res.ok) throw new Error("Failed to fetch mitigations");
      return res.json();
    },
  });
}

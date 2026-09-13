/**
 * Zustand store for simulation state.
 *
 * Manages the cascade animation: which nodes are failed, which wave
 * is currently displayed, and the full simulation result.
 * Also tracks the registry of completed simulations and created scenarios
 * for seamless reactive selection in ScenarioCompare.
 */

import { create } from "zustand";
import type { SimulationResult } from "../types";

export interface StoredSim {
  id: string;
  network_id: string;
  initial_failures: string[];
  total_failed?: number;
  is_baseline?: boolean;
  scenario_id?: string;
  created_at?: string;
}

export interface StoredScenario {
  id: string;
  name: string;
  network_id: string;
  initial_failures: string[];
  intervention_type?: string;
  created_at?: string;
}

const getInitialSimulations = (): StoredSim[] => {
  try {
    return JSON.parse(localStorage.getItem("ripple_simulations") || "[]");
  } catch {
    return [];
  }
};

const getInitialScenarios = (): StoredScenario[] => {
  try {
    return JSON.parse(localStorage.getItem("ripple_scenarios") || "[]");
  } catch {
    return [];
  }
};

interface SimulationState {
  /** The full simulation result object from the API */
  result: SimulationResult | null;
  /** Index of the currently-displayed wave (for animation) */
  currentWave: number;
  /** Set of node IDs that are failed up to the current wave */
  failedNodeIds: Set<string>;
  /** Whether the cascade animation is playing */
  isPlaying: boolean;
  /** Timer ID for the animation interval */
  animationTimer: ReturnType<typeof setTimeout> | null;

  // History and scenario registry
  simulations: StoredSim[];
  scenarios: StoredScenario[];
  baselineSimulationId: string | null;
  lastAppliedScenarioId: string | null;

  // Actions
  setSimulationResult: (result: SimulationResult) => void;
  addSimulation: (sim: StoredSim, isBaseline?: boolean) => void;
  registerScenario: (scenario: StoredScenario) => void;
  setBaselineSimulationId: (id: string | null) => void;
  setLastAppliedScenarioId: (id: string | null) => void;
  advanceWave: () => void;
  play: () => void;
  pause: () => void;
  reset: () => void;
  setWave: (index: number) => void;
  rewindToStart: () => void;
}

const initialSims = getInitialSimulations();
const initialBaseline = initialSims.find((s) => s.is_baseline)?.id || initialSims[0]?.id || null;

export const useSimulationStore = create<SimulationState>((set, get) => ({
  result: null,
  currentWave: -1,
  failedNodeIds: new Set(),
  isPlaying: false,
  animationTimer: null,

  simulations: initialSims,
  scenarios: getInitialScenarios(),
  baselineSimulationId: initialBaseline,
  lastAppliedScenarioId: null,

  setSimulationResult: (result) => {
    const state = get();
    if (state.animationTimer) clearInterval(state.animationTimer);

    let updatedSims = state.simulations;
    let newBaselineId = state.baselineSimulationId;

    if (result.status === "completed") {
      const isBaseline = !state.baselineSimulationId || updatedSims.length === 0;
      const simEntry: StoredSim = {
        id: result.id,
        network_id: result.network_id,
        initial_failures: result.initial_failures,
        total_failed: result.total_failed,
        is_baseline: isBaseline,
        created_at: new Date().toISOString(),
      };
      if (!updatedSims.some((s) => s.id === result.id)) {
        updatedSims = [simEntry, ...updatedSims].slice(0, 50);
        try {
          localStorage.setItem("ripple_simulations", JSON.stringify(updatedSims));
          window.dispatchEvent(new Event("ripple_simulations_updated"));
        } catch {}
      }
      if (isBaseline && !newBaselineId) {
        newBaselineId = result.id;
      }
    }

    set({
      result,
      currentWave: -1,
      failedNodeIds: new Set(),
      isPlaying: false,
      animationTimer: null,
      simulations: updatedSims,
      baselineSimulationId: newBaselineId,
    });

    if (result.status === "completed" && result.waves.length > 0) {
      setTimeout(() => get().play(), 300);
    }
  },

  addSimulation: (sim, isBaseline = false) => {
    const current = get().simulations;
    const updated = [sim, ...current.filter((s) => s.id !== sim.id)].slice(0, 50);
    try {
      localStorage.setItem("ripple_simulations", JSON.stringify(updated));
      window.dispatchEvent(new Event("ripple_simulations_updated"));
    } catch {}
    set((state) => ({
      simulations: updated,
      baselineSimulationId: isBaseline
        ? sim.id
        : state.baselineSimulationId ?? (sim.is_baseline ? sim.id : state.baselineSimulationId),
    }));
  },

  registerScenario: (scenario) => {
    const current = get().scenarios;
    const updated = [scenario, ...current.filter((s) => s.id !== scenario.id)].slice(0, 50);
    try {
      localStorage.setItem("ripple_scenarios", JSON.stringify(updated));
      window.dispatchEvent(new Event("ripple_scenarios_updated"));
    } catch {}
    set({
      scenarios: updated,
      lastAppliedScenarioId: scenario.id,
    });
  },

  setBaselineSimulationId: (id) => set({ baselineSimulationId: id }),
  setLastAppliedScenarioId: (id) => set({ lastAppliedScenarioId: id }),

  advanceWave: () => {
    const { result, currentWave, failedNodeIds, animationTimer } = get();
    if (!result || result.status !== "completed") return;

    const waves = result.waves;
    const nextWave = currentWave + 1;

    if (nextWave >= waves.length) {
      if (animationTimer) clearInterval(animationTimer);
      set({ isPlaying: false, animationTimer: null });
      return;
    }

    const newFailed = new Set(failedNodeIds);
    for (const id of waves[nextWave].failed_node_ids) {
      newFailed.add(id);
    }

    set({
      currentWave: nextWave,
      failedNodeIds: newFailed,
    });
  },

  play: () => {
    const { animationTimer, result, currentWave } = get();
    if (!result || result.status !== "completed") return;

    if (animationTimer) clearInterval(animationTimer);
    if (currentWave >= result.waves.length - 1) return;

    get().advanceWave();
    const timer = setInterval(() => {
      get().advanceWave();
    }, 800);

    set({ isPlaying: true, animationTimer: timer });
  },

  pause: () => {
    const { animationTimer } = get();
    if (animationTimer) clearInterval(animationTimer);
    set({ isPlaying: false, animationTimer: null });
  },

  reset: () => {
    const { animationTimer } = get();
    if (animationTimer) clearInterval(animationTimer);
    set({
      result: null,
      currentWave: -1,
      failedNodeIds: new Set(),
      isPlaying: false,
      animationTimer: null,
    });
  },

  setWave: (index) => {
    const { result } = get();
    if (!result || result.status !== "completed") return;

    const waves = result.waves;
    if (index < 0 || index >= waves.length) return;

    const newFailed = new Set<string>();
    for (let i = 0; i <= index; i++) {
      for (const id of waves[i].failed_node_ids) {
        newFailed.add(id);
      }
    }

    set({ currentWave: index, failedNodeIds: newFailed });
  },

  rewindToStart: () => {
    const { animationTimer } = get();
    if (animationTimer) clearInterval(animationTimer);
    set({
      currentWave: -1,
      failedNodeIds: new Set(),
      isPlaying: false,
      animationTimer: null,
    });
  },
}));

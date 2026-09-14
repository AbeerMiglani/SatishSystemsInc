/**
 * CascadeTimeline — compact horizontal control bar for the cascade animation.
 * Sits below the map, lets users scrub through waves, play/pause, rewind.
 */

import React from "react";
import { useSimulationStore } from "../stores/simulationStore";

export default function CascadeTimeline() {
  const result = useSimulationStore((s) => s.result);
  const currentWave = useSimulationStore((s) => s.currentWave);
  const isPlaying = useSimulationStore((s) => s.isPlaying);
  const play = useSimulationStore((s) => s.play);
  const pause = useSimulationStore((s) => s.pause);
  const setWave = useSimulationStore((s) => s.setWave);
  const rewindToStart = useSimulationStore((s) => s.rewindToStart);

  if (!result || result.status !== "completed") return null;

  const waves = result.waves;
  const waveCount = waves.length;

  const handlePlayPause = () => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  const handleStepBack = () => {
    if (currentWave <= 0) {
      rewindToStart();
    } else {
      setWave(currentWave - 1);
    }
  };

  const handleStepForward = () => {
    const next = currentWave + 1;
    if (next < waveCount) {
      setWave(next);
    }
  };

  const scrubberValue = currentWave >= 0 ? currentWave : 0;

  const waveLabel = currentWave === -1 ? "Pre-cascade" : `Wave ${currentWave + 1} / ${waveCount}`;

  return (
    <div
      style={{
        flexShrink: 0,
        height: 44,
        background: "var(--rp-surface-2)",
        borderTop: "1px solid var(--rp-divider)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 12px",
        userSelect: "none",
      }}
    >
      <button className="rp-btn rp-btn-secondary" onClick={() => rewindToStart()} title="Rewind to start">
        ⏮
      </button>
      <button className="rp-btn rp-btn-secondary" onClick={handleStepBack} title="Step back">
        ◀
      </button>
      <button className="rp-btn rp-btn-primary" onClick={handlePlayPause} title={isPlaying ? "Pause" : "Play"}>
        {isPlaying ? "⏸" : "▶"}
      </button>
      <button className="rp-btn rp-btn-secondary" onClick={handleStepForward} title="Step forward">
        ▶|
      </button>

      <input
        type="range"
        min={0}
        max={waveCount > 0 ? waveCount - 1 : 0}
        value={scrubberValue}
        onChange={(e) => setWave(Number(e.target.value))}
        style={{ flex: 1, accentColor: "var(--rp-accent)", cursor: "pointer" }}
      />

      <span style={{ fontSize: 11.5, color: "var(--rp-mute)", whiteSpace: "nowrap", minWidth: 110, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {waveLabel}
      </span>
    </div>
  );
}

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

  const waveLabel =
    currentWave === -1
      ? "Pre-cascade"
      : `Wave ${currentWave + 1} / ${waveCount}`;

  const btnStyle: React.CSSProperties = {
    background: "#334155",
    border: "none",
    color: "#e2e8f0",
    borderRadius: 4,
    padding: "4px 10px",
    fontSize: 13,
    cursor: "pointer",
    lineHeight: 1,
  };

  return (
    <div
      style={{
        flexShrink: 0,
        height: 48,
        background: "#1e293b",
        borderTop: "1px solid #334155",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 12px",
        userSelect: "none",
      }}
    >
      {/* Rewind */}
      <button style={btnStyle} onClick={() => rewindToStart()} title="Rewind to start">
        ⏮
      </button>

      {/* Step Back */}
      <button style={btnStyle} onClick={handleStepBack} title="Step back">
        ◀
      </button>

      {/* Play / Pause */}
      <button style={{ ...btnStyle, background: "#2563eb" }} onClick={handlePlayPause} title={isPlaying ? "Pause" : "Play"}>
        {isPlaying ? "⏸" : "▶"}
      </button>

      {/* Step Forward */}
      <button style={btnStyle} onClick={handleStepForward} title="Step forward">
        ▶|
      </button>

      {/* Scrubber */}
      <input
        type="range"
        min={0}
        max={waveCount > 0 ? waveCount - 1 : 0}
        value={scrubberValue}
        onChange={(e) => setWave(Number(e.target.value))}
        style={{ flex: 1, accentColor: "#3b82f6", cursor: "pointer" }}
      />

      {/* Wave label */}
      <span style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap", minWidth: 110, textAlign: "right" }}>
        {waveLabel}
      </span>
    </div>
  );
}

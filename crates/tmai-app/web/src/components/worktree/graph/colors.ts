export const LANE_COLORS = [
  "rgb(16,185,129)", // 0: emerald (main)
  "rgb(34,211,238)", // 1: cyan
  "rgb(168,85,247)", // 2: purple
  "rgb(59,130,246)", // 3: blue
  "rgb(245,158,11)", // 4: amber
  "rgb(236,72,153)", // 5: pink
  "rgb(20,184,166)", // 6: teal
  "rgb(249,115,22)", // 7: orange
];

/// Get lane color by index (cycles through palette)
export function laneColor(index: number): string {
  return LANE_COLORS[index % LANE_COLORS.length];
}

/// Get a dimmed version of a lane color (for inactive lanes)
export function laneDimColor(index: number): string {
  const c = LANE_COLORS[index % LANE_COLORS.length];
  // Replace rgb(...) with rgba(..., 0.3)
  return c.replace("rgb(", "rgba(").replace(")", ",0.3)");
}

/// Get a subtle background version of a lane color
export function laneBgColor(index: number): string {
  const c = LANE_COLORS[index % LANE_COLORS.length];
  return c.replace("rgb(", "rgba(").replace(")", ",0.06)");
}

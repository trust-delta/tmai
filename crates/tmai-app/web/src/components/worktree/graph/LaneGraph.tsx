import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import type { LaneLayout } from "./types";
import { ROW_H, COMMIT_R, BRANCH_R, LEFT_PAD } from "./layout";
import { laneColor, laneDimColor, laneBgColor } from "./colors";
import { api, type PrInfo } from "@/lib/api";

interface LaneGraphProps {
  layout: LaneLayout;
  selectedBranch: string | null;
  repoPath: string;
  defaultBranch: string;
  collapsedLanes: Set<string>;
  prMap: Record<string, PrInfo>;
  onSelectBranch: (branch: string) => void;
  onToggleCollapse: (branch: string) => void;
}

// Commit detail fetched from git log
interface CommitDetail {
  sha: string;
  subject: string;
  body: string;
}

export function LaneGraph({
  layout,
  selectedBranch,
  repoPath,
  defaultBranch,
  collapsedLanes,
  prMap,
  onSelectBranch,
  onToggleCollapse,
}: LaneGraphProps) {
  const [hoveredSha, setHoveredSha] = useState<string | null>(null);
  const [expandedSha, setExpandedSha] = useState<string | null>(null);
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { lanes, rows, connections, laneW, svgHeight } = layout;

  // SVG width = only the graph portion (lanes + padding)
  const graphW = LEFT_PAD + lanes.length * laneW + 12;

  // Find which lane is selected
  const selectedLaneIdx = lanes.find(l => l.branch === selectedBranch)?.laneIndex ?? -1;

  // Compute lane X position
  const laneX = useCallback((laneIdx: number) => LEFT_PAD + laneIdx * laneW + laneW / 2, [laneW]);

  // Find the Y range each lane spans
  const laneYRange = useMemo(() => {
    const ranges = new Map<number, { minY: number; maxY: number }>();
    for (const row of rows) {
      const existing = ranges.get(row.lane);
      if (!existing) {
        ranges.set(row.lane, { minY: row.y, maxY: row.y });
      } else {
        existing.minY = Math.min(existing.minY, row.y);
        existing.maxY = Math.max(existing.maxY, row.y);
      }
    }
    return ranges;
  }, [rows]);

  // Build set of branch tip SHAs
  const branchTipLanes = useMemo(() => {
    const tips = new Set<string>();
    const seenLanes = new Set<number>();
    for (const row of rows) {
      if (row.isFold) continue;
      if (!seenLanes.has(row.lane)) {
        tips.add(row.sha);
        seenLanes.add(row.lane);
      }
    }
    return tips;
  }, [rows]);

  // Resolve branch name for a commit's lane
  const branchForLane = useCallback((laneIdx: number) => {
    return lanes[laneIdx]?.branch ?? defaultBranch;
  }, [lanes, defaultBranch]);

  // Handle commit click
  const handleCommitClick = useCallback((sha: string, laneIdx: number) => {
    if (expandedSha === sha) {
      setExpandedSha(null);
      setCommitDetail(null);
      return;
    }
    setExpandedSha(sha);
    setCommitDetail(null);
    setDetailLoading(true);

    const branch = branchForLane(laneIdx);
    api.gitLog(repoPath, defaultBranch, branch)
      .then((commits) => {
        const found = commits.find(c => c.sha.startsWith(sha.slice(0, 7)) || sha.startsWith(c.sha));
        if (found) {
          setCommitDetail({ sha: found.sha, subject: found.subject, body: found.body });
        } else {
          const row = rows.find(r => r.sha === sha);
          setCommitDetail({ sha, subject: row?.subject ?? "", body: "" });
        }
      })
      .catch(() => {
        const row = rows.find(r => r.sha === sha);
        setCommitDetail({ sha, subject: row?.subject ?? "", body: "" });
      })
      .finally(() => setDetailLoading(false));
  }, [expandedSha, branchForLane, repoPath, defaultBranch, rows]);

  // Close expanded on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && expandedSha) {
        setExpandedSha(null);
        setCommitDetail(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedSha]);

  const expandedRow = expandedSha ? rows.find(r => r.sha === expandedSha) : null;

  return (
    <div ref={containerRef} className="relative inline-flex w-max min-w-full" style={{ minHeight: svgHeight }}>
      {/* Left: SVG graph (lanes, dots, curves) — fixed width */}
      <div className="shrink-0" style={{ width: graphW }}>
        <svg width={graphW} height={svgHeight}>
          <defs>
            <filter id="lane-glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="lane-glow-selected">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Lane backgrounds */}
          {lanes.map(lane => (
            <rect
              key={`bg-${lane.laneIndex}`}
              x={laneX(lane.laneIndex) - laneW / 2}
              y={0}
              width={laneW}
              height={svgHeight}
              fill={lane.laneIndex === selectedLaneIdx ? laneBgColor(lane.laneIndex) : "transparent"}
              className="cursor-pointer"
              onClick={() => onSelectBranch(lane.branch)}
            />
          ))}

          {/* Lane vertical lines */}
          {lanes.map(lane => {
            const range = laneYRange.get(lane.laneIndex);
            if (!range) return null;
            const isSelected = lane.laneIndex === selectedLaneIdx;
            return (
              <line
                key={`line-${lane.laneIndex}`}
                x1={laneX(lane.laneIndex)} y1={range.minY}
                x2={laneX(lane.laneIndex)} y2={range.maxY}
                stroke={isSelected ? lane.color : laneDimColor(lane.laneIndex)}
                strokeWidth={isSelected ? 2 : 1.5}
              />
            );
          })}

          {/* Fork/Merge curves */}
          {connections.map((conn, i) => {
            const fromX = laneX(conn.fromLane);
            const toX = laneX(conn.toLane);
            const dy = Math.abs(conn.toY - conn.fromY);
            const delta = Math.min(dy * 0.4, ROW_H * 1.5);
            return (
              <path
                key={`conn-${i}`}
                d={`M${fromX},${conn.fromY} C${fromX},${conn.fromY + delta} ${toX},${conn.toY - delta} ${toX},${conn.toY}`}
                stroke={conn.color} strokeWidth={1.5} strokeOpacity={0.5} fill="none"
              />
            );
          })}

          {/* Commit dots + fold indicators */}
          {rows.map(row => {
            const x = laneX(row.lane);
            const color = laneColor(row.lane);

            if (row.isFold) {
              return (
                <g key={row.sha} className="cursor-pointer" onClick={() => onToggleCollapse(branchForLane(row.lane))}>
                  <line x1={x} y1={row.y - 8} x2={x} y2={row.y + 8}
                    stroke={color} strokeWidth={1.5} strokeOpacity={0.3} strokeDasharray="2 3" />
                  {[-4, 0, 4].map(dy => (
                    <circle key={dy} cx={x} cy={row.y + dy} r={1.5} fill={color} fillOpacity={0.5} />
                  ))}
                </g>
              );
            }

            const isTip = branchTipLanes.has(row.sha);
            const isSelectedLane = row.lane === selectedLaneIdx;
            const isHovered = hoveredSha === row.sha;
            const isExpanded = expandedSha === row.sha;
            const r = isTip ? BRANCH_R : COMMIT_R;

            return (
              <g key={row.sha}>
                <circle
                  cx={x} cy={row.y}
                  r={isHovered || isExpanded ? r + 2 : r}
                  fill={color}
                  fillOpacity={isTip ? 0.2 : isHovered || isExpanded ? 0.25 : 0.15}
                  stroke={color}
                  strokeWidth={isTip || isSelectedLane || isExpanded ? 2 : isHovered ? 2 : 1.5}
                  strokeOpacity={isSelectedLane || isHovered || isExpanded ? 1 : 0.6}
                  filter={isTip && isSelectedLane ? "url(#lane-glow-selected)" : isTip ? "url(#lane-glow)" : undefined}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredSha(row.sha)}
                  onMouseLeave={() => setHoveredSha(null)}
                  onClick={() => handleCommitClick(row.sha, row.lane)}
                />
                {row.isMerge && (
                  <circle cx={x} cy={row.y} r={r + 3} fill="none" stroke={color} strokeWidth={1} strokeOpacity={0.3} />
                )}
              </g>
            );
          })}

          {/* Branch name headers */}
          {lanes.map(lane => {
            const isSelected = lane.laneIndex === selectedLaneIdx;
            const isCollapsed = collapsedLanes.has(lane.branch);
            const maxChars = Math.max(4, Math.floor(laneW / 7));
            const displayName = lane.branch.length > maxChars
              ? lane.branch.slice(0, Math.ceil(maxChars / 2)) + "\u2026" + lane.branch.slice(-(Math.floor(maxChars / 2)))
              : lane.branch;
            const laneCommitCount = rows.filter(r => r.lane === lane.laneIndex && !r.isFold).length;
            const showToggle = laneCommitCount > 2;

            return (
              <g key={`hdr-${lane.laneIndex}`}>
                <g className="cursor-pointer" onClick={() => onSelectBranch(lane.branch)}>
                  <title>{lane.branch}</title>
                  <text x={laneX(lane.laneIndex)} y={16} textAnchor="middle"
                    fill={isSelected ? lane.color : laneDimColor(lane.laneIndex)}
                    fontSize="10" fontWeight={isSelected ? "600" : "400"} style={{ userSelect: "none" }}>
                    {displayName}
                  </text>
                </g>
                {showToggle ? (
                  <g className="cursor-pointer" onClick={() => onToggleCollapse(lane.branch)}>
                    <title>{isCollapsed ? "Expand commits" : "Collapse commits"}</title>
                    <circle cx={laneX(lane.laneIndex)} cy={28} r={5}
                      fill={isCollapsed ? lane.color : "transparent"} fillOpacity={isCollapsed ? 0.15 : 0}
                      stroke={lane.color} strokeWidth={1} strokeOpacity={isSelected ? 0.8 : 0.4} />
                    <text x={laneX(lane.laneIndex)} y={29} textAnchor="middle" dominantBaseline="middle"
                      fill={lane.color} fillOpacity={isSelected ? 1 : 0.5} fontSize="8" fontWeight="600"
                      style={{ userSelect: "none" }}>
                      {isCollapsed ? "\u25B8" : "\u25BE"}
                    </text>
                  </g>
                ) : (
                  <circle cx={laneX(lane.laneIndex)} cy={28} r={3} fill={lane.color} fillOpacity={isSelected ? 1 : 0.4} />
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Right: HTML commit labels — absolute positioned to match SVG Y coords */}
      <div className="relative shrink-0" style={{ minHeight: svgHeight }}>
        {rows.map(row => {
          const isTip = branchTipLanes.has(row.sha);
          const isHovered = hoveredSha === row.sha;
          const isSelectedLane = row.lane === selectedLaneIdx;
          const isExpanded = expandedSha === row.sha;
          const color = laneColor(row.lane);

          // Fold indicator row
          if (row.isFold) {
            return (
              <div
                key={row.sha}
                className="absolute flex cursor-pointer items-center gap-2 px-2"
                style={{ height: ROW_H, top: row.y - ROW_H / 2, left: 0, right: 0 }}
                onClick={() => onToggleCollapse(branchForLane(row.lane))}
              >
                <span className="text-[10px]" style={{ color, opacity: 0.5 }}>{"\u22EE"}</span>
                <span className="text-[10px] text-zinc-500">
                  {row.foldCount} commit{(row.foldCount ?? 0) > 1 ? "s" : ""} hidden
                </span>
                <span className="text-[9px] text-zinc-600">click to expand</span>
              </div>
            );
          }

          const branch = lanes[row.lane]?.branch;
          const pr = branch ? prMap[branch] : undefined;

          return (
            <div
              key={row.sha}
              className={`absolute flex cursor-pointer items-center gap-2 px-2 transition-colors ${
                isHovered ? "bg-white/[0.02]" : ""
              } ${isExpanded ? "bg-cyan-500/[0.04]" : ""}`}
              style={{ height: ROW_H, top: row.y - ROW_H / 2, left: 0, right: 0 }}
              onMouseEnter={() => setHoveredSha(row.sha)}
              onMouseLeave={() => setHoveredSha(null)}
              onClick={() => handleCommitClick(row.sha, row.lane)}
            >
              {/* SHA */}
              <span
                className="shrink-0 font-mono text-[10px]"
                style={{ color: isHovered || isExpanded ? "rgb(34,211,238)" : "rgba(34,211,238,0.35)" }}
              >
                {row.sha.slice(0, 7)}
              </span>

              {/* Subject */}
              <span
                className="whitespace-nowrap text-[11px]"
                style={{
                  color: isHovered || isExpanded
                    ? "rgba(228,228,231,0.9)"
                    : isTip ? "rgba(228,228,231,0.6)"
                    : isSelectedLane ? "rgba(161,161,170,0.6)"
                    : "rgba(161,161,170,0.35)",
                  fontWeight: isTip ? 500 : 400,
                }}
              >
                {row.subject}
              </span>

              {/* Ref + PR badges (only for branch tips) */}
              {isTip && (
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* Ref badge */}
                  {row.refs.filter(r => !r.startsWith("origin/")).slice(0, 1).map(ref => (
                    <span key={ref} className="rounded px-1 py-0.5 text-[9px] font-semibold"
                      style={{ color, backgroundColor: color.replace("rgb(", "rgba(").replace(")", ",0.1)") }}>
                      {ref.startsWith("HEAD -> ") ? ref.slice(8) : ref}
                    </span>
                  ))}

                  {/* PR badge */}
                  {pr && (
                    <a href={pr.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:brightness-125"
                      style={{
                        backgroundColor: pr.is_draft ? "rgba(161,161,170,0.1)" : "rgba(34,197,94,0.1)",
                        color: pr.is_draft ? "rgba(161,161,170,0.6)" : "rgb(74,222,128)",
                      }}
                      onClick={e => e.stopPropagation()}
                    >
                      #{pr.number}
                      {pr.is_draft && <span className="text-[9px] opacity-60">draft</span>}
                      {/* Review decision icon */}
                      {pr.review_decision === "APPROVED" && <span className="text-green-400">{"\u2714"}</span>}
                      {pr.review_decision === "CHANGES_REQUESTED" && <span className="text-orange-400">{"\u2716"}</span>}
                      {/* CI dot */}
                      {pr.check_status && (
                        <span className={`inline-block h-2 w-2 rounded-full ${
                          pr.check_status === "SUCCESS" ? "bg-green-400"
                          : pr.check_status === "FAILURE" ? "bg-red-400"
                          : "bg-yellow-400"
                        }`} />
                      )}
                      {/* Review count */}
                      {pr.reviews > 0 && (
                        <span className="text-[9px] text-zinc-500">{pr.reviews}r</span>
                      )}
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Commit detail overlay */}
      {expandedRow && !expandedRow.isFold && (
        <div
          className="absolute z-10 rounded-lg border border-white/10 bg-zinc-900/95 shadow-xl backdrop-blur-sm"
          style={{
            left: graphW + 8,
            top: expandedRow.y + ROW_H / 2 + 4,
            right: 16,
            minWidth: 280,
          }}
        >
          <div className="p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] text-cyan-400 select-all">
                {commitDetail?.sha ?? expandedRow.sha}
              </span>
              <button
                onClick={() => { setExpandedSha(null); setCommitDetail(null); }}
                className="text-[10px] text-zinc-600 hover:text-zinc-300 transition-colors"
              >
                Esc
              </button>
            </div>
            <div className="mt-1.5 text-xs font-medium text-zinc-200 select-text">
              {expandedRow.subject}
            </div>
            {detailLoading ? (
              <div className="mt-2 text-[11px] text-zinc-600">Loading...</div>
            ) : commitDetail?.body ? (
              <div className="mt-2 rounded bg-white/[0.03] px-2 py-1.5 text-[11px] text-zinc-400 font-mono whitespace-pre-wrap break-words select-text max-h-48 overflow-y-auto">
                {commitDetail.body}
              </div>
            ) : null}
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-zinc-600">
              <span className="rounded px-1.5 py-0.5"
                style={{
                  backgroundColor: laneColor(expandedRow.lane).replace("rgb(", "rgba(").replace(")", ",0.1)"),
                  color: laneColor(expandedRow.lane),
                }}>
                {branchForLane(expandedRow.lane)}
              </span>
              {expandedRow.isMerge && (
                <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-purple-400">merge</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type PrInfo } from "@/lib/api";
import { CopyableSha } from "../CopyableSha";
import { laneBgColor, laneColor, laneDimColor } from "./colors";
import { BRANCH_R, COMMIT_R, LEFT_PAD, ROW_H } from "./layout";
import type { LaneLayout } from "./types";

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

// Wrapped in React.memo so that upstream re-renders driven by the ~1–2 Hz
// `agents` SSE stream (Claude Code title-glyph animation) don't repeat the
// whole SVG VDOM generation — with 200 commits × 6 lanes × N PRs this loop
// is the single biggest cost on the panel (measured as a self-DoS that
// wedges Chrome tabs while Branch graph is open). All props above this
// line are memoized upstream (`layout`, `prMap`, `onSelectBranch`,
// `onToggleCollapse`, primitives) so shallow equality holds on quiet SSE
// ticks.
export const LaneGraph = memo(function LaneGraph({
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

  // Build SHA → PrInfo map for placing PR badges at correct commit
  const prBySha = useMemo(() => {
    const map: Record<string, PrInfo> = {};
    for (const pr of Object.values(prMap)) {
      if (pr.head_sha) map[pr.head_sha] = pr;
    }
    return map;
  }, [prMap]);

  // SVG width = only the graph portion (lanes + padding)
  const graphW = LEFT_PAD + lanes.length * laneW + 12;

  // Find which lane is selected
  const selectedLaneIdx = lanes.find((l) => l.branch === selectedBranch)?.laneIndex ?? -1;

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
      if (row.kind === "fold") continue;
      if (!seenLanes.has(row.lane)) {
        tips.add(row.sha);
        seenLanes.add(row.lane);
      }
    }
    return tips;
  }, [rows]);

  // Resolve branch name for a commit's lane
  const branchForLane = useCallback(
    (laneIdx: number) => {
      return lanes[laneIdx]?.branch ?? defaultBranch;
    },
    [lanes, defaultBranch],
  );

  // Handle commit click
  const handleCommitClick = useCallback(
    (sha: string, laneIdx: number) => {
      if (expandedSha === sha) {
        setExpandedSha(null);
        setCommitDetail(null);
        return;
      }
      setExpandedSha(sha);
      setCommitDetail(null);
      setDetailLoading(true);

      const branch = branchForLane(laneIdx);
      api
        .gitLog(repoPath, defaultBranch, branch)
        .then((commits) => {
          const found = commits.find(
            (c) => c.sha.startsWith(sha.slice(0, 7)) || sha.startsWith(c.sha),
          );
          if (found) {
            setCommitDetail({ sha: found.sha, subject: found.subject, body: found.body });
          } else {
            const row = rows.find((r) => r.sha === sha);
            const subject = row && row.kind === "commit" ? row.subject : "";
            setCommitDetail({ sha, subject, body: "" });
          }
        })
        .catch(() => {
          const row = rows.find((r) => r.sha === sha);
          const subject = row && row.kind === "commit" ? row.subject : "";
          setCommitDetail({ sha, subject, body: "" });
        })
        .finally(() => setDetailLoading(false));
    },
    [expandedSha, branchForLane, repoPath, defaultBranch, rows],
  );

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

  const expandedRow = expandedSha ? rows.find((r) => r.sha === expandedSha) : null;

  return (
    <div
      ref={containerRef}
      className="relative inline-flex w-max min-w-full"
      style={{ minHeight: svgHeight }}
    >
      {/* Left: SVG graph (lanes, dots, curves) — fixed width */}
      <div className="shrink-0" style={{ width: graphW }}>
        <svg width={graphW} height={svgHeight} role="img" aria-label="Branch lane graph">
          <title>Branch lane graph</title>
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
          {lanes.map((lane) => (
            // biome-ignore lint/a11y/useSemanticElements: SVG rect has no semantic button equivalent
            <rect
              key={`bg-${lane.laneIndex}`}
              role="button"
              tabIndex={0}
              x={laneX(lane.laneIndex) - laneW / 2}
              y={0}
              width={laneW}
              height={svgHeight}
              fill={
                lane.laneIndex === selectedLaneIdx ? laneBgColor(lane.laneIndex) : "transparent"
              }
              className="cursor-pointer"
              onClick={() => onSelectBranch(lane.branch)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectBranch(lane.branch);
                }
              }}
            />
          ))}

          {/* Lane vertical lines */}
          {lanes.map((lane) => {
            const range = laneYRange.get(lane.laneIndex);
            if (!range) return null;
            const isSelected = lane.laneIndex === selectedLaneIdx;
            return (
              <line
                key={`line-${lane.laneIndex}`}
                x1={laneX(lane.laneIndex)}
                y1={range.minY}
                x2={laneX(lane.laneIndex)}
                y2={range.maxY}
                stroke={isSelected ? lane.color : laneDimColor(lane.laneIndex)}
                strokeWidth={isSelected ? 2 : 1.5}
              />
            );
          })}

          {/* Dashed fork lines for empty lanes (branches with no unique commits) */}
          {lanes.map((lane) => {
            if (laneYRange.has(lane.laneIndex)) return null; // has commits, skip
            // Find the row where this branch's ref appears (its HEAD commit in another lane)
            const refRow = rows.find(
              (r) =>
                r.kind === "commit" &&
                r.refs.some(
                  (ref) => ref.replace(/^HEAD -> /, "").replace(/^origin\//, "") === lane.branch,
                ),
            );
            if (!refRow) return null;
            const parentX = laneX(refRow.lane); // fork point on parent lane
            const childX = laneX(lane.laneIndex); // top of this lane
            const topY = rows.length > 0 ? rows[0].y : 0;
            return (
              <line
                key={`empty-lane-${lane.laneIndex}`}
                x1={parentX}
                y1={refRow.y}
                x2={childX}
                y2={topY}
                stroke={lane.color}
                strokeWidth={1.5}
                strokeOpacity={0.4}
                strokeDasharray="4 4"
              />
            );
          })}

          {/* PR arrows: open PRs use dashed lines to base lane header,
              merged PRs use solid lines to the actual merge commit */}
          {Object.values(prMap).map((pr) => {
            const srcLane = lanes.find((l) => l.branch === pr.head_branch);
            const tgtLane = lanes.find((l) => l.branch === pr.base_branch);
            if (!srcLane || !tgtLane) return null;
            if (srcLane.laneIndex === tgtLane.laneIndex) return null;

            const srcRange = laneYRange.get(srcLane.laneIndex);
            if (!srcRange) return null;

            const fromX = laneX(srcLane.laneIndex);
            const toX = laneX(tgtLane.laneIndex);
            const fromY = srcRange.minY;

            const isMerged = pr.state === "MERGED" && pr.merge_commit_sha;

            // For merged PRs, target the merge commit row; for open PRs, target lane header
            let toY = 28;
            if (isMerged) {
              const mergeRow = rows.find(
                (r) => r.kind === "commit" && r.sha === pr.merge_commit_sha,
              );
              if (mergeRow) {
                toY = mergeRow.y;
              }
            }

            const color = pr.is_draft ? "rgb(161,161,170)" : srcLane.color;

            const d = `M ${fromX} ${fromY} L ${toX} ${toY}`;

            const arrowSize = 4;
            const arrowD = `M ${toX - arrowSize} ${toY + arrowSize * 1.5} L ${toX} ${toY} L ${toX + arrowSize} ${toY + arrowSize * 1.5}`;

            return (
              <g key={`pr-target-${pr.number}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  strokeOpacity={isMerged ? 0.6 : 0.5}
                  strokeDasharray={isMerged ? undefined : "6 3"}
                />
                <path d={arrowD} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.6} />
              </g>
            );
          })}

          {/* Fork/Merge lines */}
          {connections.map((conn, _i) => {
            const fromX = laneX(conn.fromLane);
            const toX = laneX(conn.toLane);
            return (
              <line
                key={`conn-${conn.fromLane}-${conn.toLane}-${conn.fromY}-${conn.toY}`}
                x1={fromX}
                y1={conn.fromY}
                x2={toX}
                y2={conn.toY}
                stroke={conn.color}
                strokeWidth={1.5}
                strokeOpacity={0.5}
              />
            );
          })}

          {/* Commit dots + fold indicators */}
          {rows.map((row) => {
            const x = laneX(row.lane);
            const color = laneColor(row.lane);

            if (row.kind === "fold") {
              return (
                // biome-ignore lint/a11y/useSemanticElements: SVG g element has no semantic button equivalent
                <g
                  key={row.sha}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => onToggleCollapse(branchForLane(row.lane))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onToggleCollapse(branchForLane(row.lane));
                    }
                  }}
                >
                  <line
                    x1={x}
                    y1={row.y - 8}
                    x2={x}
                    y2={row.y + 8}
                    stroke={color}
                    strokeWidth={1.5}
                    strokeOpacity={0.3}
                    strokeDasharray="2 3"
                  />
                  {[-4, 0, 4].map((dy) => (
                    <circle
                      key={dy}
                      cx={x}
                      cy={row.y + dy}
                      r={1.5}
                      fill={color}
                      fillOpacity={0.5}
                    />
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
                {/* biome-ignore lint/a11y/noStaticElementInteractions: SVG circle has no semantic interactive equivalent */}
                <circle
                  cx={x}
                  cy={row.y}
                  r={isHovered || isExpanded ? r + 2 : r}
                  fill={color}
                  fillOpacity={isTip ? 0.2 : isHovered || isExpanded ? 0.25 : 0.15}
                  stroke={color}
                  strokeWidth={isTip || isSelectedLane || isExpanded ? 2 : isHovered ? 2 : 1.5}
                  strokeOpacity={isSelectedLane || isHovered || isExpanded ? 1 : 0.6}
                  filter={
                    isTip && isSelectedLane
                      ? "url(#lane-glow-selected)"
                      : isTip
                        ? "url(#lane-glow)"
                        : undefined
                  }
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredSha(row.sha)}
                  onMouseLeave={() => setHoveredSha(null)}
                  onClick={() => handleCommitClick(row.sha, row.lane)}
                />
                {row.isMerge && (
                  <circle
                    cx={x}
                    cy={row.y}
                    r={r + 3}
                    fill="none"
                    stroke={color}
                    strokeWidth={1}
                    strokeOpacity={0.3}
                  />
                )}
              </g>
            );
          })}

          {/* Branch name headers */}
          {lanes.map((lane) => {
            const isSelected = lane.laneIndex === selectedLaneIdx;
            const isCollapsed = collapsedLanes.has(lane.branch);
            const maxChars = Math.max(4, Math.floor(laneW / 7));
            const displayName =
              lane.branch.length > maxChars
                ? lane.branch.slice(0, Math.ceil(maxChars / 2)) +
                  "\u2026" +
                  lane.branch.slice(-Math.floor(maxChars / 2))
                : lane.branch;
            const laneCommitCount = rows.filter(
              (r) => r.lane === lane.laneIndex && r.kind === "commit",
            ).length;
            const showToggle = laneCommitCount > 2;

            return (
              <g key={`hdr-${lane.laneIndex}`}>
                {/* biome-ignore lint/a11y/useSemanticElements: SVG g element has no semantic button equivalent */}
                <g
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => onSelectBranch(lane.branch)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectBranch(lane.branch);
                    }
                  }}
                >
                  <title>{lane.branch}</title>
                  <text
                    x={laneX(lane.laneIndex)}
                    y={16}
                    textAnchor="middle"
                    fill={isSelected ? lane.color : laneDimColor(lane.laneIndex)}
                    fontSize="10"
                    fontWeight={isSelected ? "600" : "400"}
                    style={{ userSelect: "none" }}
                  >
                    {displayName}
                  </text>
                </g>
                {showToggle ? (
                  // biome-ignore lint/a11y/useSemanticElements: SVG g element has no semantic button equivalent
                  <g
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={() => onToggleCollapse(lane.branch)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onToggleCollapse(lane.branch);
                      }
                    }}
                  >
                    <title>{isCollapsed ? "Expand commits" : "Collapse commits"}</title>
                    <circle
                      cx={laneX(lane.laneIndex)}
                      cy={28}
                      r={5}
                      fill={isCollapsed ? lane.color : "transparent"}
                      fillOpacity={isCollapsed ? 0.15 : 0}
                      stroke={lane.color}
                      strokeWidth={1}
                      strokeOpacity={isSelected ? 0.8 : 0.4}
                    />
                    <text
                      x={laneX(lane.laneIndex)}
                      y={29}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={lane.color}
                      fillOpacity={isSelected ? 1 : 0.5}
                      fontSize="8"
                      fontWeight="600"
                      style={{ userSelect: "none" }}
                    >
                      {isCollapsed ? "\u25B8" : "\u25BE"}
                    </text>
                  </g>
                ) : (
                  <circle
                    cx={laneX(lane.laneIndex)}
                    cy={28}
                    r={3}
                    fill={lane.color}
                    fillOpacity={isSelected ? 1 : 0.4}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Right: HTML commit labels — absolute positioned to match SVG Y coords */}
      <div className="relative shrink-0" style={{ minHeight: svgHeight }}>
        {rows.map((row) => {
          const isHovered = hoveredSha === row.sha;
          const isSelectedLane = row.lane === selectedLaneIdx;
          const isExpanded = expandedSha === row.sha;
          const color = laneColor(row.lane);

          // Fold indicator row
          if (row.kind === "fold") {
            return (
              <button
                type="button"
                key={row.sha}
                className="absolute flex cursor-pointer items-center gap-2 px-2"
                style={{ height: ROW_H, top: row.y - ROW_H / 2, left: 0, right: 0 }}
                onClick={() => onToggleCollapse(branchForLane(row.lane))}
              >
                <span className="text-[10px]" style={{ color, opacity: 0.5 }}>
                  {"\u22EE"}
                </span>
                <span className="text-[10px] text-zinc-500">
                  {row.foldCount} commit{row.foldCount > 1 ? "s" : ""} hidden
                </span>
                <span className="text-[9px] text-zinc-600">click to expand</span>
              </button>
            );
          }

          const isTip = branchTipLanes.has(row.sha);
          const branch = lanes[row.lane]?.branch;
          // PR badge: prefer SHA match → origin/ remote ref → branch ref (if no head_sha data)
          const branchPr = branch ? prMap[branch] : undefined;
          const pr =
            prBySha[row.sha] ??
            (branchPr && row.refs.some((r) => r === `origin/${branch}`) ? branchPr : undefined) ??
            (branchPr && !branchPr.head_sha && row.refs.some((r) => !r.startsWith("origin/"))
              ? branchPr
              : undefined);

          return (
            <button
              type="button"
              key={row.sha}
              className={`absolute flex cursor-pointer items-center gap-2 px-2 text-left transition-colors ${
                isHovered ? "bg-white/[0.02]" : ""
              } ${isExpanded ? "bg-cyan-500/[0.04]" : ""}`}
              style={{ height: ROW_H, top: row.y - ROW_H / 2, left: 0, right: 0 }}
              onMouseEnter={() => setHoveredSha(row.sha)}
              onMouseLeave={() => setHoveredSha(null)}
              onClick={() => handleCommitClick(row.sha, row.lane)}
            >
              {/* SHA (click to copy) */}
              <CopyableSha
                sha={row.sha}
                className="text-[10px]"
                style={{
                  color: isHovered || isExpanded ? "rgb(34,211,238)" : "rgba(34,211,238,0.35)",
                }}
              />

              {/* Subject */}
              <span
                className="whitespace-nowrap text-[11px]"
                style={{
                  color:
                    isHovered || isExpanded
                      ? "rgba(228,228,231,0.9)"
                      : isTip
                        ? "rgba(228,228,231,0.6)"
                        : isSelectedLane
                          ? "rgba(161,161,170,0.6)"
                          : "rgba(161,161,170,0.35)",
                  fontWeight: isTip ? 500 : 400,
                }}
              >
                {row.subject}
              </span>

              {/* Ref + PR badges */}
              {(isTip || pr) && (
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* Ref badge (tips only) */}
                  {isTip &&
                    row.refs
                      .filter((r) => !r.startsWith("origin/"))
                      .slice(0, 1)
                      .map((ref) => (
                        <span
                          key={ref}
                          className="rounded px-1 py-0.5 text-[9px] font-semibold"
                          style={{
                            color,
                            backgroundColor: color.replace("rgb(", "rgba(").replace(")", ",0.1)"),
                          }}
                        >
                          {ref.startsWith("HEAD -> ") ? ref.slice(8) : ref}
                        </span>
                      ))}

                  {/* PR badge (at PR head commit) */}
                  {pr && (
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:brightness-125"
                      style={{
                        backgroundColor: pr.is_draft
                          ? "rgba(161,161,170,0.1)"
                          : "rgba(34,197,94,0.1)",
                        color: pr.is_draft ? "rgba(161,161,170,0.6)" : "rgb(74,222,128)",
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      #{pr.number}
                      {pr.is_draft && <span className="text-[9px] opacity-60">draft</span>}
                      {/* Review decision icon */}
                      {pr.review_decision === "APPROVED" && (
                        <span className="text-green-400">{"\u2714"}</span>
                      )}
                      {pr.review_decision === "CHANGES_REQUESTED" && (
                        <span className="text-orange-400">{"\u2716"}</span>
                      )}
                      {/* CI dot */}
                      {pr.check_status && (
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${
                            pr.check_status === "SUCCESS"
                              ? "bg-green-400"
                              : pr.check_status === "FAILURE"
                                ? "bg-red-400"
                                : "bg-yellow-400"
                          }`}
                        />
                      )}
                      {/* Review count */}
                      {pr.reviews > 0 && (
                        <span className="text-[9px] text-zinc-500">{pr.reviews}r</span>
                      )}
                    </a>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Commit detail overlay */}
      {expandedRow && expandedRow.kind === "commit" && (
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
              <CopyableSha
                sha={commitDetail?.sha ?? expandedRow.sha}
                displayLength={40}
                className="text-[11px] text-cyan-400"
              />
              <button
                type="button"
                onClick={() => {
                  setExpandedSha(null);
                  setCommitDetail(null);
                }}
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
              <span
                className="rounded px-1.5 py-0.5"
                style={{
                  backgroundColor: laneColor(expandedRow.lane)
                    .replace("rgb(", "rgba(")
                    .replace(")", ",0.1)"),
                  color: laneColor(expandedRow.lane),
                }}
              >
                {branchForLane(expandedRow.lane)}
              </span>
              {expandedRow.isMerge && (
                <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-purple-400">
                  merge
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

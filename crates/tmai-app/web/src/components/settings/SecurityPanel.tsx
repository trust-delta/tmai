import { useCallback, useEffect, useState } from "react";
import { api, type ScanResult, type SecuritySeverity } from "@/lib/api";

interface SecurityPanelProps {
  onClose: () => void;
}

/// Severity color mapping
function severityColor(severity: SecuritySeverity): string {
  switch (severity) {
    case "Critical":
      return "text-red-400";
    case "High":
      return "text-orange-400";
    case "Medium":
      return "text-yellow-400";
    case "Low":
      return "text-blue-400";
  }
}

/// Severity background color for badges
function severityBg(severity: SecuritySeverity): string {
  switch (severity) {
    case "Critical":
      return "bg-red-500/15 text-red-400";
    case "High":
      return "bg-orange-500/15 text-orange-400";
    case "Medium":
      return "bg-yellow-500/15 text-yellow-400";
    case "Low":
      return "bg-blue-500/15 text-blue-400";
  }
}

/// Count risks by severity
function countBySeverity(result: ScanResult, severity: SecuritySeverity): number {
  return result.risks.filter((r) => r.severity === severity).length;
}

// Security scan panel displayed in the main area
export function SecurityPanel({ onClose }: SecurityPanelProps) {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load cached scan result on mount
  useEffect(() => {
    api
      .lastSecurityScan()
      .then((result) => {
        if (result) setScanResult(result);
      })
      .catch(console.error);
  }, []);

  // Run a new scan
  const handleScan = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.runSecurityScan();
      setScanResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const severities: SecuritySeverity[] = ["Critical", "High", "Medium", "Low"];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-zinc-200">Security Scan</h2>
          <button
            type="button"
            onClick={handleScan}
            disabled={loading}
            className="rounded-md bg-cyan-500/20 px-3 py-1 text-xs text-cyan-400 transition-colors hover:bg-cyan-500/30 disabled:opacity-50"
          >
            {loading ? "Scanning..." : "Scan"}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1 text-sm text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-300"
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {error && <p className="text-xs text-red-400">{error}</p>}

        {!scanResult ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-zinc-500">No scan results yet</p>
            <p className="mt-1 text-xs text-zinc-600">
              Click Scan to check Claude Code settings for security risks
            </p>
          </div>
        ) : (
          <>
            {/* Summary */}
            <section>
              <div className="flex flex-wrap items-center gap-2">
                {severities.map((sev) => {
                  const count = countBySeverity(scanResult, sev);
                  if (count === 0) return null;
                  return (
                    <span
                      key={sev}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${severityBg(sev)}`}
                    >
                      {count} {sev}
                    </span>
                  );
                })}
                {scanResult.risks.length === 0 && (
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                    No risks detected
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11px] text-zinc-600">
                Scanned {scanResult.files_scanned} files, {scanResult.scanned_projects.length}{" "}
                projects at {new Date(scanResult.scanned_at).toLocaleTimeString()}
              </p>
            </section>

            {/* Findings */}
            {scanResult.risks.length > 0 && (
              <section className="space-y-2">
                {scanResult.risks.map((risk) => (
                  <div
                    key={`${risk.rule_id}-${risk.source}-${risk.summary}`}
                    className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={`text-xs font-mono font-bold ${severityColor(risk.severity)}`}
                      >
                        [{risk.rule_id}]
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-200">{risk.summary}</p>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                          <span>{risk.category}</span>
                          <span>·</span>
                          <span className="truncate">{risk.source}</span>
                        </div>
                        <p className="mt-2 text-xs text-zinc-400 leading-relaxed">{risk.detail}</p>
                        {risk.matched_value && (
                          <div className="mt-2 rounded bg-white/5 px-2 py-1">
                            <code className={`text-[11px] ${severityColor(risk.severity)}`}>
                              {risk.matched_value}
                            </code>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

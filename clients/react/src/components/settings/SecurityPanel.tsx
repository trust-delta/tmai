import { useCallback, useEffect, useState } from "react";
import { api, type ScanResult, type SecuritySeverity } from "@/lib/api";

interface SecurityPanelProps {
  onClose: () => void;
}

/// Severity color mapping
function severityColor(severity: SecuritySeverity): string {
  switch (severity) {
    case "Critical":
      return "text-destructive";
    case "High":
      return "text-warning";
    case "Medium":
      return "text-warning";
    case "Low":
      return "text-info";
  }
}

/// Severity background color for badges
function severityBg(severity: SecuritySeverity): string {
  switch (severity) {
    case "Critical":
      return "bg-destructive/15 text-destructive";
    case "High":
      return "bg-warning/15 text-warning";
    case "Medium":
      return "bg-warning/15 text-warning";
    case "Low":
      return "bg-info/15 text-info";
  }
}

/// Count risks by severity
function countBySeverity(result: ScanResult, severity: SecuritySeverity): number {
  return result.risks.filter((r) => r.severity === severity).length;
}

// Config audit panel displayed in the main area
export function SecurityPanel({ onClose }: SecurityPanelProps) {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load cached scan result on mount
  useEffect(() => {
    api
      .lastConfigAudit()
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
      const result = await api.runConfigAudit();
      setScanResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audit failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const severities: SecuritySeverity[] = ["Critical", "High", "Medium", "Low"];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground">Config Audit</h2>
          <button
            type="button"
            onClick={handleScan}
            disabled={loading}
            className="rounded-md bg-primary/20 px-3 py-1 text-xs text-primary transition-colors hover:bg-primary/30 disabled:opacity-50"
          >
            {loading ? "Auditing..." : "Audit"}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1 text-sm text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {error && <p className="text-xs text-destructive">{error}</p>}

        {!scanResult ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted-foreground">No audit results yet</p>
            <p className="mt-1 text-xs text-subtle-foreground">
              Click Audit to check Claude Code settings for security risks
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
                  <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">
                    No risks detected
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11px] text-subtle-foreground">
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
                    className="rounded-lg border border-hairline-strong bg-surface p-3"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={`text-xs font-mono font-bold ${severityColor(risk.severity)}`}
                      >
                        [{risk.rule_id}]
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{risk.summary}</p>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{risk.category}</span>
                          <span>·</span>
                          <span className="truncate">{risk.source}</span>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                          {risk.detail}
                        </p>
                        {risk.matched_value && (
                          <div className="mt-2 rounded bg-surface px-2 py-1">
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

// 📜 Hand-over — R panel's hand-over archive surface.
//
// The approach (`doc/approaches/2026-05-29-r-panel-as-project-artifact-
// inventory.md`) calls for `~/.tmai/handoffs/<unit>/` archive listing
// plus the most-recent baseline content. No wire exposes that
// directory yet; honest-degradation posture
// (`doc/decisions/2026-05-14-webui-simulated-onboarded-posture.md`)
// says we surface the gap with a TODO marker rather than fabricate
// or hide the section. The header (with `(0)` count) is the
// architecturally-present surface; the body explains why no items
// are available yet and which wire would populate it.

import { Section } from "./Section";

interface RHandoverSectionProps {
  unitName: string | null;
  expanded: boolean;
  onToggle: () => void;
}

export function RHandoverSection({ unitName, expanded, onToggle }: RHandoverSectionProps) {
  return (
    <Section
      id="handover"
      glyph="📜"
      label="Hand-over"
      count="0"
      expanded={expanded}
      onToggle={onToggle}
    >
      <Body unitName={unitName} />
    </Section>
  );
}

function Body({ unitName }: { unitName: string | null }) {
  if (unitName === null) {
    return <p className="text-subtle-foreground">Pick a project to see hand-overs.</p>;
  }
  return (
    <div className="space-y-1">
      <p className="text-subtle-foreground">
        Hand-over archive at <code className="text-foreground">~/.tmai/handoffs/{unitName}/</code>.
      </p>
      <p className="text-subtle-foreground">
        TODO(tmai-core: handoff archive wire) — archive enumeration + baseline content not yet
        surfaced over HTTP. Open the directory directly until the wire lands.
      </p>
    </div>
  );
}

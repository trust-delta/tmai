// Pure ctx-readout formatting helpers, migrated from the retired
// producer-console `ProducerCtxHeader` when the aim console became the sole
// seat. The component's render tests went with the component; these three
// pure helpers live on in `Shead`.

import { describe, expect, it } from "vitest";
import { formatThousands, renderBar, thresholdColorClass } from "../ctx-format";

describe("ctx-format — pure helpers", () => {
  it("formatThousands rounds bigint to nearest thousand with k suffix", () => {
    expect(formatThousands(142_000n)).toBe("142k");
    expect(formatThousands(199_500n)).toBe("200k");
    expect(formatThousands(0n)).toBe("0k");
  });

  it("renderBar gives proportional 10-wide segments rounded to nearest tenth", () => {
    expect(renderBar(0)).toEqual({ filled: 0, empty: 10, chars: "░░░░░░░░░░" });
    expect(renderBar(71)).toEqual({ filled: 7, empty: 3, chars: "▮▮▮▮▮▮▮░░░" });
    expect(renderBar(100)).toEqual({ filled: 10, empty: 0, chars: "▮▮▮▮▮▮▮▮▮▮" });
    // Clamp out-of-range
    expect(renderBar(-10).filled).toBe(0);
    expect(renderBar(150).filled).toBe(10);
  });

  // Semantic tokens (zinc→muted-foreground, amber→warning, red→destructive).
  it("thresholdColorClass flips muted / warning / destructive across the boundary", () => {
    expect(thresholdColorClass(50, 75)).toMatch(/muted-foreground/);
    expect(thresholdColorClass(66, 75)).toMatch(/warning/);
    expect(thresholdColorClass(74, 75)).toMatch(/warning/);
    expect(thresholdColorClass(75, 75)).toMatch(/destructive/);
    expect(thresholdColorClass(95, 75)).toMatch(/destructive/);
    // Disabled threshold keeps the readout muted regardless of pct
    expect(thresholdColorClass(99, 0)).toMatch(/muted-foreground/);
    // null pct (no ctx_usage yet) → muted
    expect(thresholdColorClass(null, 75)).toMatch(/muted-foreground/);
  });
});

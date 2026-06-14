// ◎ Aim body — the agent-authored interior (`AimWire.body`) rendered as
// markdown. Shared by BOTH aim surfaces (the R-panel `RAimsSection` inspector +
// the aim-console `AimPane` inspector), the same way both already share
// `aim-tree.ts`.
//
// WHY this exists: the rebuilt aim form expresses a node's structured-knowing as
// PROSE (headings / lists / `[[slug]]` cross-edges to other aim nodes), NOT as
// the old `[claimed]` / `[confirmed]` interior marks. The inspector's mark-list
// (`is[]`) is parsed only from those marks, so a new-form node parses to an
// EMPTY `is[]` and its whole body was invisible — the inspector showed only the
// one-line `aim:` ought and "— a pure ought —", even when the file carries a
// rich body. The body text is already on the wire (`AimWire.body`); this just
// surfaces it.
//
// Render path REUSES the established stack (`react-markdown` + `remark-gfm` +
// the shared `PROSE_CLASSES`) that `RRecordViewer` / `RPrViewer` use, so the
// aim body reads like every other markdown surface in the WebUI. `[[slug]]`
// wiki-links are rewritten to in-tree navigation: a slug that resolves to a
// loaded aim node becomes a clickable cross-ref (selects that node); an
// unresolved slug stays PLAIN text — a not-yet-authored node is not an error.
//
// Deliberately NOT a bespoke structured-knowing parser (障害 / 手段 / history
// sections as typed blocks). This is the "暫定 raw" surface: show the whole
// body now so the dogfood loop can decide what structured rendering, if any, is
// actually worth building.

import { useMemo } from "react";
import Markdown, { type Components, defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { PROSE_CLASSES } from "./r-viewer/prose";

// `[[slug]]` — the body's DAG cross-edge syntax. Same shape the record viewer's
// excerpt uses; here the target is an aim node, not a decision/approach record.
const WIKILINK = /\[\[([^[\]]+)\]\]/g;

export function AimBody({
  body,
  resolves,
  onNavigate,
}: {
  body: string;
  /** Does this slug name a loaded aim node (in the selection's repo)? Drives
   *  whether a `[[slug]]` renders as a clickable cross-ref or plain text. */
  resolves: (slug: string) => boolean;
  /** Navigate the panel's selection to a resolved aim node. */
  onNavigate: (slug: string) => void;
}) {
  const trimmed = body.trim();

  // Rewrite `[[slug]]` → a markdown link with a synthetic `aim:` scheme, then
  // intercept that scheme in the `a` override (mirrors `RRecordViewer`'s
  // `record:` scheme). Done before render so react-markdown parses it as a link.
  const withLinks = useMemo(
    () => trimmed.replace(WIKILINK, (_m, slug: string) => `[${slug}](aim:${slug})`),
    [trimmed],
  );

  const components = useMemo<Components>(
    () => ({
      a({ href, children }) {
        if (href?.startsWith("aim:")) {
          const slug = href.slice("aim:".length);
          if (!resolves(slug)) {
            // Unresolved cross-edge — plain, not an error (the node may not be
            // authored yet).
            return <span className="text-muted-foreground">{children}</span>;
          }
          return (
            <button
              type="button"
              onClick={() => onNavigate(slug)}
              className="font-mono text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              {children}
            </button>
          );
        }
        // Real links keep standard prose link rendering.
        return <a href={href}>{children}</a>;
      },
    }),
    [resolves, onNavigate],
  );

  // An empty body renders nothing — the section only appears when there is
  // interior prose to show (a pure-ought node stays clean).
  if (trimmed === "") return null;

  return (
    <section className="mt-3" data-testid="aim-body">
      <h4 className="font-mono text-[9px] uppercase tracking-wide text-subtle-foreground">body</h4>
      <div className={`mt-1 ${PROSE_CLASSES}`}>
        <Markdown
          remarkPlugins={[remarkGfm]}
          // Preserve the synthetic `aim:` scheme; sanitize everything else
          // exactly as react-markdown would by default.
          urlTransform={(url) => (url.startsWith("aim:") ? url : defaultUrlTransform(url))}
          components={components}
        >
          {withLinks}
        </Markdown>
      </div>
    </section>
  );
}

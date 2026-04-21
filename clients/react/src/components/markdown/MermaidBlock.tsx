import { useEffect, useRef, useState } from "react";

interface MermaidBlockProps {
  source: string;
}

type MermaidModule = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidModule> | null = null;
let instanceCounter = 0;

// Dynamically load and initialize mermaid exactly once per page session
function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "strict",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

// Render a mermaid fenced block; falls back to a plain code block on parse error
export function MermaidBlock({ source }: MermaidBlockProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const idRef = useRef(`mermaid-${++instanceCounter}`);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);
    const renderId = `mermaid-${++instanceCounter}`;
    idRef.current = renderId;

    loadMermaid()
      .then(async (mermaid) => {
        try {
          const result = await mermaid.render(renderId, source);
          if (!cancelled) setSvg(result.svg);
        } catch (e) {
          if (!cancelled) {
            setError(e instanceof Error ? e : new Error(String(e)));
          }
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) {
    return (
      <pre>
        <code className="language-mermaid">{source}</code>
      </pre>
    );
  }

  if (!svg) {
    return <div className="px-2 py-3 text-xs text-zinc-500">Rendering diagram…</div>;
  }

  return (
    <div
      className="mermaid-diagram flex justify-center overflow-x-auto py-2"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid returns sanitized SVG (securityLevel: strict)
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

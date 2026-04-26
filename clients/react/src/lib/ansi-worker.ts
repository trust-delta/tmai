// Web Worker: ANSI escape sequences → HTML conversion off the main thread.
//
// Why: long-running agents accumulate hundreds of KB of capture-pane
// scrollback. Running AnsiUp on that synchronously inside React's render
// path freezes the tab (10s+ in extreme cases). Moving the conversion to
// a worker keeps input handling, scrolling, and the Live tab responsive
// while the heavy History HTML is being rebuilt.
//
// AnsiUp is stateful (it carries forward color/style state between calls
// for streaming use), but for the History pipeline we always pass the full
// capped scrollback in one message and don't need that streaming behaviour.
// We construct a fresh AnsiUp per request so leftover state from a
// previous request can never bleed into the next render.
//
// DOMPurify is intentionally NOT done here: porting it to a worker
// requires a JSDOM polyfill which would balloon the worker bundle, and
// DOMPurify itself is fast enough on the main thread to not be the
// bottleneck. The worker returns raw HTML; the caller sanitizes.

import { AnsiUp } from "ansi_up";

interface ConvertRequest {
  id: number;
  content: string;
}

interface ConvertResponse {
  id: number;
  html: string;
}

self.onmessage = (e: MessageEvent<ConvertRequest>) => {
  const { id, content } = e.data;
  const ansi = new AnsiUp();
  const html = ansi.ansi_to_html(content);
  const response: ConvertResponse = { id, html };
  self.postMessage(response);
};

export type { ConvertRequest, ConvertResponse };

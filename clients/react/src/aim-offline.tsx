// Offline aim mode entry — the design-machine authoring surface.
//
// Mounts the UNCHANGED `AimFace` (the aim-console's worklist) against a locally
// picked `doc/aims/` directory via the File System Access API. The vite build
// (`vite.aim-offline.config.ts`) aliases `@/lib/api` → `@/lib/api-files`, so the
// reuse is total: `AimFace` + `useUnitAims` + the aim-tree / aim-body-parse
// logic run as-is, only the read/write transport is file-backed. No engine, no
// Rust, no HTTP. Drift is absent (git-derived, engine-only) — this is the
// static design-phase view.

import { type ReactElement, StrictMode, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { AimFace } from "@/components/aim-console/AimPane";
import { setAimsDirectory } from "@/lib/api-files";
import {
  applyThemeToDocument,
  resolveTheme,
  resolveThemeMode,
  systemPrefersLight,
} from "@/lib/theme";
import { loadUIPrefs } from "@/lib/ui-prefs";
import { UIPrefsProvider } from "@/lib/ui-prefs-provider";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/inter-tight/400.css";
import "@fontsource/inter-tight/500.css";
import "@fontsource/inter-tight/600.css";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/500.css";
import "./styles/globals.css";
import "@/styles/aim-console.css";
import "./styles/aim-offline.css";

// The File System Access API picker (Chromium). Accessed structurally rather
// than via a global augmentation so it never conflicts with a lib.dom
// declaration across TS versions.
interface DirectoryPickerWindow {
  showDirectoryPicker(options?: {
    mode?: "read" | "readwrite";
  }): Promise<FileSystemDirectoryHandle>;
}

function pickAimsDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = window as unknown as Partial<DirectoryPickerWindow>;
  if (typeof picker.showDirectoryPicker !== "function") {
    return Promise.reject(
      new Error("File System Access API がありません — Chrome / Edge で開いてください。"),
    );
  }
  return picker.showDirectoryPicker({ mode: "readwrite" });
}

function AimOffline(): ReactElement {
  const [label, setLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onPick = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const handle = await pickAimsDirectory();
      setAimsDirectory(handle, handle.name);
      setLabel(handle.name);
    } catch (e) {
      // Dismissing the native picker rejects with AbortError — not an error.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  if (label === null) {
    return (
      <div className="aim-offline-gate">
        <div className="aim-offline-gate-card">
          <h1>aim offline</h1>
          <p>
            doc/aims ディレクトリを選ぶと、ローカルのファイルを直接読み書きします（engine
            不要）。anchor はあなたが直接書き、body はエージェントが書きます。
          </p>
          <button type="button" className="aim-offline-pick" onClick={onPick}>
            doc/aims を選ぶ
          </button>
          {error !== null ? <p className="aim-offline-error">{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="aim-console aim-offline-root">
      <section className="ac-col ac-aim" aria-label="Aim">
        <AimFace unitName={label} />
      </section>
    </div>
  );
}

applyThemeToDocument(resolveTheme(resolveThemeMode(loadUIPrefs().themeMode, systemPrefersLight())));

const rootEl = document.getElementById("root");
if (rootEl === null) {
  throw new Error("aim-offline: #root element missing");
}
createRoot(rootEl).render(
  <StrictMode>
    <UIPrefsProvider>
      <AimOffline />
    </UIPrefsProvider>
  </StrictMode>,
);

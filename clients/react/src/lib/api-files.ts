// File-backed API for the OFFLINE aim mode (design-machine authoring).
//
// The aim-console reads its tree from `api.aims(unit)` and writes via
// `api.createAim` / `api.editAim`, all through `@/lib/api`. The offline build
// aliases `@/lib/api` to THIS module (see `vite.aim-offline.config.ts`), so the
// UNCHANGED `AimFace` + `useUnitAims` operate on a locally-picked `doc/aims/`
// directory via the File System Access API instead of the HTTP engine.
//
// Scope = the design phase: the static corpus (tree / neighborhood / progress
// from the body), NOT the live engine. `drift` / `working_delta` are `null`
// (git-derived, engine-only); `aimTone` handles that. Writes mirror the engine
// byte discipline through `aim-file-format` (frontmatter only — the agent
// authors the body; cross-edge lines and the body are preserved on edit).
//
// Every non-aim `api` method is inherited from the HTTP layer (spread below) so
// any transitive import resolves; `AimFace` only ever calls the three aim
// methods, so those engine-only paths are never reached offline.

export * from "./api-http";

import type { AimCreateRequest } from "@/types/generated/AimCreateRequest";
import type { AimEditRequest } from "@/types/generated/AimEditRequest";
import type { AimsResponse } from "@/types/generated/AimsResponse";
import type { AimWire } from "@/types/generated/AimWire";
import {
  editAimFrontmatter,
  fileToAimWire,
  serializeNewAim,
  validateAimSlug,
} from "./aim-file-format";
import { api as httpApi } from "./api-http";

// The operator-picked `doc/aims/` directory (set once by the offline entry's
// directory picker). All three aim methods read/write through it; `null` until
// a directory is chosen.
let aimsDir: FileSystemDirectoryHandle | null = null;
let aimsLabel = "doc/aims";

export function setAimsDirectory(handle: FileSystemDirectoryHandle, label?: string): void {
  aimsDir = handle;
  if (label !== undefined) aimsLabel = label;
}

export function aimsDirectoryName(): string {
  return aimsDir?.name ?? aimsLabel;
}

function requireDir(): FileSystemDirectoryHandle {
  if (aimsDir === null) {
    throw new Error("no doc/aims directory picked yet");
  }
  return aimsDir;
}

const AIM_FILE = /\.md$/;

async function readText(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  const fh = await dir.getFileHandle(name);
  const file = await fh.getFile();
  return file.text();
}

async function writeText(
  dir: FileSystemDirectoryHandle,
  name: string,
  content: string,
): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
}

async function fileExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

// Read every top-level `*.md` (single-level scan, mirroring tmai-core's
// `read_aims_dir` — so an `_archive/` or `_incubator/` subdir is excluded), and
// parse each into an `AimWire`. A malformed record is skipped (a console.warn,
// never a crash) so one bad file does not blank the whole tree.
async function readAims(dir: FileSystemDirectoryHandle): Promise<AimWire[]> {
  const aims: AimWire[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== "file" || !AIM_FILE.test(name)) continue;
    const slug = name.replace(AIM_FILE, "");
    try {
      aims.push(fileToAimWire(slug, await readText(dir, name)));
    } catch (e) {
      console.warn(`skipping unparseable aim record ${name}:`, e);
    }
  }
  return aims.sort((a, b) => a.slug.localeCompare(b.slug));
}

async function aims(unit: string): Promise<AimsResponse> {
  const dir = requireDir();
  const repoAims = await readAims(dir);
  return {
    unit,
    composed_at: new Date().toISOString(),
    repos: [
      {
        repo_label: dir.name,
        repo_root: dir.name,
        primary: true,
        repo_head: null,
        aims: repoAims,
      },
    ],
  };
}

async function createAim(_unit: string, body: AimCreateRequest): Promise<AimWire> {
  const dir = requireDir();
  const reason = validateAimSlug(body.slug);
  if (reason !== null) throw new Error(reason);

  const name = `${body.slug}.md`;
  if (await fileExists(dir, name)) {
    throw new Error(`an aim node '${body.slug}' already exists`);
  }
  // `state` defaults to `open` server-side; the offline create mirrors that.
  const content = serializeNewAim(body.aim, body.parent, "open");
  await writeText(dir, name, content);
  return fileToAimWire(body.slug, content);
}

async function editAim(_unit: string, slug: string, body: AimEditRequest): Promise<AimWire> {
  const dir = requireDir();
  const name = `${slug}.md`;
  if (!(await fileExists(dir, name))) {
    throw new Error(`no aim node '${slug}'`);
  }
  const edited = editAimFrontmatter(await readText(dir, name), body.aim, body.parent, body.state);
  await writeText(dir, name, edited);
  return fileToAimWire(slug, edited);
}

// The file-backed `api`: every HTTP method inherited, the three aim methods
// overridden. The local `api` export shadows the `export *`-re-exported one
// (same pattern as `api-tauri.ts`).
export const api = {
  ...httpApi,
  aims,
  createAim,
  editAim,
};

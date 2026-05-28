// 📁 Files — R panel's repo-link surface.
//
// NOT a file browser. The approach explicitly carves out IDE
// territory: R only surfaces the repo root link (github.com URL)
// and a deep-link generator for a path-on-branch the operator
// pastes a path into. The operator copies the link and opens it
// elsewhere; tmai stays out of editor / preview / git operations.
//
// The github URL is derived from any open PR in the unit's PR
// payload (PR `url` is always a github.com URL of the form
// `https://github.com/<owner>/<repo>/pull/<n>`). If the repo has no
// open PR the section degrades to surfacing the local repo path
// only; an explicit TODO marker calls out the missing dedicated
// remote-URL wire.

import { useState } from "react";
import { useUnitPrs } from "@/hooks/useUnitPrs";
import { Section } from "./Section";

interface RFilesSectionProps {
  currentProjectPath: string | null;
  unitName: string | null;
  expanded: boolean;
  onToggle: () => void;
}

export function RFilesSection({
  currentProjectPath,
  unitName,
  expanded,
  onToggle,
}: RFilesSectionProps) {
  const { data } = useUnitPrs(unitName);
  const repoLinks = collectRepoLinks(currentProjectPath, data?.repos ?? null);

  return (
    <Section
      id="files"
      glyph="📁"
      label="Files"
      count={`${repoLinks.length}`}
      expanded={expanded}
      onToggle={onToggle}
    >
      <Body currentProjectPath={currentProjectPath} repoLinks={repoLinks} />
    </Section>
  );
}

interface RepoLink {
  label: string;
  localPath: string;
  /** Github URL of the form `https://github.com/<owner>/<repo>`, or null
   *  when no open PR was found to derive it from. */
  githubUrl: string | null;
}

function collectRepoLinks(
  currentProjectPath: string | null,
  repos: { repo_path: string; repo_label: string; prs: { url: string }[] }[] | null,
): RepoLink[] {
  const out: RepoLink[] = [];
  const seen = new Set<string>();
  if (repos) {
    for (const repo of repos) {
      const firstPr = repo.prs[0];
      const githubUrl = firstPr ? deriveGithubRepoUrl(firstPr.url) : null;
      out.push({ label: repo.repo_label, localPath: repo.repo_path, githubUrl });
      seen.add(repo.repo_path);
    }
  }
  // Always include the currently-focused project even if PR fetch is
  // empty / not yet loaded — the operator can still copy the local
  // path. Avoid duplicating an entry already provided by the PR fan-out.
  if (currentProjectPath !== null && !seen.has(currentProjectPath)) {
    const label = currentProjectPath.split("/").filter(Boolean).pop() ?? currentProjectPath;
    out.unshift({ label, localPath: currentProjectPath, githubUrl: null });
  }
  return out;
}

function deriveGithubRepoUrl(prUrl: string): string | null {
  // PR urls look like https://github.com/<owner>/<repo>/pull/<n>;
  // strip the `/pull/<n>` suffix to get the repo root.
  const m = prUrl.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\/pull\/\d+/);
  return m ? m[1] : null;
}

interface BodyProps {
  currentProjectPath: string | null;
  repoLinks: RepoLink[];
}

function Body({ currentProjectPath, repoLinks }: BodyProps) {
  if (currentProjectPath === null) {
    return <p className="text-subtle-foreground">Pick a project to see files.</p>;
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {repoLinks.map((link) => (
          <li key={link.localPath} className="leading-snug">
            <span className="text-foreground">{link.label}</span>
            <div className="text-[11px] text-subtle-foreground">
              <code className="text-subtle-foreground">{link.localPath}</code>
            </div>
            {link.githubUrl !== null ? (
              <a
                href={link.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-foreground hover:underline"
              >
                {link.githubUrl}
              </a>
            ) : (
              <p className="text-[11px] text-subtle-foreground">
                TODO(tmai-core: repo remote-url wire) — no open PR available to derive github URL
                from; cannot deep-link.
              </p>
            )}
          </li>
        ))}
      </ul>
      <DeepLinkGenerator repoLinks={repoLinks} />
    </div>
  );
}

function DeepLinkGenerator({ repoLinks }: { repoLinks: RepoLink[] }) {
  const linkableRepos = repoLinks.filter(
    (r): r is RepoLink & { githubUrl: string } => r.githubUrl !== null,
  );
  const [repoIdx, setRepoIdx] = useState(0);
  const [branch, setBranch] = useState("main");
  const [path, setPath] = useState("");

  if (linkableRepos.length === 0) {
    return null;
  }
  const repo = linkableRepos[Math.min(repoIdx, linkableRepos.length - 1)];
  // Defensive sanitization before the deep-link is rendered as an
  // `href`. React already escapes attribute values so direct XSS is
  // not possible here; this is belt-and-braces against accidental
  // whitespace/newlines pasted into the inputs and against `../`
  // path-traversal segments that would build a misleading-looking
  // github URL. Allowlist mirrors what github tolerates in branch and
  // blob path segments: alphanumerics, `_`, `-`, `.`, `/`. Note this
  // also blocks `..` (a `.` alone is allowed, two consecutive `..`
  // would survive the char filter but the leading-`../` stripper
  // above handles the path-traversal shape).
  const sanitize = (s: string) => s.replace(/[\r\n\s]+/g, "").replace(/[^A-Za-z0-9_\-./]/g, "");
  const safeBranch = sanitize(branch);
  const safePath = sanitize(path)
    .replace(/^(?:\.\.\/)+/, "")
    .replace(/^\/+/, "");
  const deepLink = `${repo.githubUrl}/blob/${safeBranch}/${safePath}`;
  const trimmedPath = safePath;

  return (
    <div className="border-t border-hairline pt-2">
      <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">
        Deep-link generator
      </p>
      {linkableRepos.length > 1 && (
        <label className="block text-[11px] text-subtle-foreground">
          repo
          <select
            value={repoIdx}
            onChange={(e) => setRepoIdx(Number(e.target.value))}
            className="ml-1 rounded bg-surface px-1 text-foreground"
          >
            {linkableRepos.map((r, i) => (
              <option key={r.localPath} value={i}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-[11px] text-subtle-foreground">
        branch
        <input
          type="text"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          className="ml-1 rounded bg-surface px-1 font-mono text-foreground"
        />
      </label>
      <label className="block text-[11px] text-subtle-foreground">
        path
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="src/lib/api.ts"
          className="ml-1 rounded bg-surface px-1 font-mono text-foreground"
        />
      </label>
      {trimmedPath !== "" && (
        <a
          href={deepLink}
          target="_blank"
          rel="noopener noreferrer"
          className="block break-all text-[11px] text-foreground hover:underline"
        >
          {deepLink}
        </a>
      )}
    </div>
  );
}

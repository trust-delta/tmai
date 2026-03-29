/// Extract issue numbers from a branch name (e.g., "fix/123-desc" → [123])
export function extractIssueNumbers(branch: string): number[] {
  const nums: number[] = [];
  for (const part of branch.split(/[/\-_]/)) {
    const n = parseInt(part, 10);
    if (!Number.isNaN(n) && n > 0 && n < 100000) {
      nums.push(n);
    }
  }
  return nums;
}

/// Generate a worktree name from an issue (e.g., {number: 42, title: "Add login"} → "42-add-login")
export function issueToWorktreeName(issue: { number: number; title: string }): string {
  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return slug ? `${issue.number}-${slug}` : `${issue.number}`;
}

/// Extract issue references from text (e.g., "Fixes #42", "closes #7", "resolves #123")
export function extractIssueRefs(text: string): number[] {
  const nums: number[] = [];
  const pattern = /(?:fix(?:es)?|close[sd]?|resolve[sd]?)\s*#(\d+)/gi;
  for (const m of text.matchAll(pattern)) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n < 100000) nums.push(n);
  }
  // Also match standalone #N references
  const hashPattern = /#(\d+)/g;
  for (const m of text.matchAll(hashPattern)) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n < 100000 && !nums.includes(n)) nums.push(n);
  }
  return nums;
}

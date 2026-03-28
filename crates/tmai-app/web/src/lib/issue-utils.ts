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

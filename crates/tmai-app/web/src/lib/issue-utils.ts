/// Extract issue numbers from a branch name (e.g., "fix/123-desc" → [123])
export function extractIssueNumbers(branch: string): number[] {
  const nums: number[] = [];
  for (const part of branch.split(/[/\-_]/)) {
    const n = parseInt(part, 10);
    if (!isNaN(n) && n > 0 && n < 100000) {
      nums.push(n);
    }
  }
  return nums;
}

/// Extract issue references from text (e.g., "Fixes #42", "closes #7", "resolves #123")
export function extractIssueRefs(text: string): number[] {
  const nums: number[] = [];
  const pattern = /(?:fix(?:es)?|close[sd]?|resolve[sd]?)\s*#(\d+)/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const n = parseInt(match[1], 10);
    if (n > 0 && n < 100000) nums.push(n);
  }
  // Also match standalone #N references
  const hashPattern = /#(\d+)/g;
  while ((match = hashPattern.exec(text)) !== null) {
    const n = parseInt(match[1], 10);
    if (n > 0 && n < 100000 && !nums.includes(n)) nums.push(n);
  }
  return nums;
}

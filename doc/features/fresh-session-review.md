# Fresh Session Review

Automatically launch a context-free code review when an agent completes work.

## Why

AI agents accumulate context bias during a session — they wrote the code, so they're less likely to spot their own mistakes. Fresh Session Review launches a **separate agent with zero prior context** to review the git diff, providing an unbiased perspective.

Unlike adding "review your work" to CLAUDE.md instructions, this is **hook-event driven** — it triggers reliably on agent completion regardless of context length or agent behavior.

## How It Works

1. Agent completes work → Hook `Stop` event fires → `CoreEvent::AgentStopped`
2. ReviewService collects `git diff base_branch...HEAD`
3. A structured review prompt is generated and written to a temp file
4. A new tmux window opens and runs the review agent (Claude Code, Codex, or Gemini)
5. Review output is saved to `~/.local/share/tmai/reviews/{branch}.md`
6. (Optional) The review file path is sent back to the original session for automatic fixes

## Configuration

```toml
[review]
enabled = true
agent = "claude_code"       # claude_code / codex / gemini
auto_launch = true          # trigger on agent completion
auto_feedback = true        # send results back to original session
base_branch = "main"        # base branch for git diff
custom_instructions = ""    # additional review focus areas
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `false` | Enable the review feature |
| `agent` | `claude_code` | Review agent: `claude_code`, `codex`, or `gemini` |
| `auto_launch` | `false` | Automatically review when an agent stops |
| `auto_feedback` | `true` | Send review results back to original session |
| `base_branch` | `main` | Base branch for diff comparison |
| `custom_instructions` | `""` | Additional instructions appended to the review prompt |

## Manual Trigger

Press `R` (Shift+R) in the TUI to launch a review for the currently selected agent. This works independently of `auto_launch`.

## Auto-Feedback

When `auto_feedback = true`, after the review completes, the review file path is automatically sent to the original agent session:

```
Read the code review at ~/.local/share/tmai/reviews/feat-my-feature.md and fix Critical/Warning issues
```

The original agent reads the review file and applies fixes — creating a self-improving loop.

## Review Output

Reviews are saved to `~/.local/share/tmai/reviews/{branch}.md` with structured findings:

- **Severity levels**: Critical / Warning / Info
- **File and line references** for each finding
- **Recommended changes** summary

## Security

- All file paths and tmux targets are shell-escaped (single-quote wrapping)
- Branch names are sanitized to alphanumeric, hyphens, underscores, and dots
- Large diffs are truncated at ~100KB with UTF-8 safe boundaries
- Prompt files use timestamp + PID to prevent collisions

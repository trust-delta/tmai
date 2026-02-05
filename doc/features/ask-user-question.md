# AskUserQuestion Support

Direct option selection for Claude Code's AskUserQuestion tool.

## Overview

When Claude Code uses the `AskUserQuestion` tool to present options, tmai lets you select them directly with number keys—no need to type responses manually.

## How It Works

### Claude Code presents a question:

```
┌─────────────────────────────────────────────────────────────┐
│ Which approach do you prefer?                               │
│                                                             │
│ ❯ 1. Use async/await                                        │
│   2. Use callbacks                                          │
│   3. Use promises                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### tmai operation:

Just press `1`, `2`, or `3`.

## Keybindings

| Key | Action |
|-----|--------|
| `1-9` | Select option by number |
| `１-９` | Full-width numbers also work |
| `Space` | Toggle selection (multi-select mode) |
| `Enter` | Confirm multi-select |

## Single Select vs Multi-Select

### Single Select

Press the number key to immediately select and confirm.

```
Which framework should we use?

❯ 1. React
  2. Vue
  3. Svelte
```

Press `2` → Vue is selected and sent.

### Multi-Select

When `multi_select: true`, use Space to toggle selections, then Enter to confirm.

```
Which features do you want? (select multiple)

❯ 1. [ ] Authentication
  2. [ ] Dark mode
  3. [ ] API integration
  4. [ ] Tests
```

1. Press `1` or `Space` → Toggle Authentication
2. Press `3` → Toggle API integration
3. Press `Enter` → Confirm selections

## Detection

tmai detects AskUserQuestion patterns:

- Numbered options (`1.`, `2.`, etc.)
- Selection cursor (`❯` or `>`)
- Multi-select checkboxes (`[ ]`, `[x]`)

### Detection Priority

1. **AskUserQuestion** (highest) - Numbered options with cursor
2. **Yes/No approval** - Button-style confirmation
3. **`[y/n]` pattern** - Simple confirmation
4. **Error detection**
5. **Title-based detection** (lowest) - Spinner/idle indicators

## Status Display

When AskUserQuestion is detected:

```
┌─────────────────────────────────────────────────────────────┐
│ ● claude-1    [Approval: UserQuestion]    PTY              │
│   Options: 1. async/await  2. callbacks  3. promises        │
└─────────────────────────────────────────────────────────────┘
```

## Web Remote Support

AskUserQuestion works with Web Remote Control too:

```
┌─────────────────────────────────────┐
│  Which approach?                    │
│                                     │
│  [1] async/await                   │
│  [2] callbacks                     │
│  [3] promises                      │
│                                     │
└─────────────────────────────────────┘
```

Tap a button to select.

## Why This Matters

**Without tmai:**
1. Read the options
2. Type your response manually
3. Hope you formatted it correctly

**With tmai:**
1. Press a number key
2. Done

This is especially valuable when managing multiple agents—quick responses keep workflows moving.

## Next Steps

- [PTY Wrapping](./pty-wrapping.md) - More accurate detection
- [Web Remote Control](./web-remote.md) - Operate from smartphone

# Markdown Viewer

Browse and edit project documentation directly in the tmai dashboard.

## Overview

The Markdown Viewer provides a file tree and preview panel for markdown and text files in your project. It auto-detects and selects `CLAUDE.md` on first load.

## Accessing

1. Select a project in the sidebar
2. Click the markdown/docs option to open the Markdown panel

<!-- screenshot: markdown-viewer.png -->

## Features

### File Tree

The left sidebar shows a recursive file tree:

- **Folders** — Click to expand/collapse
- **Files** — Click to select and preview
- **Extension badges** — File type labels (`.md`, `.toml`, `.json`, etc.)
- **Read-only indicator** — Shows when a file cannot be edited

### Markdown Preview

Selected markdown files are rendered with GitHub Flavored Markdown (GFM) support:

- Headings, lists, tables
- Code blocks with syntax highlighting
- Links and images
- Task lists (checkboxes)

### Editing

Files with supported extensions can be edited in-place:

1. Click **Edit** to switch to edit mode
2. Modify the content in the textarea
3. Click **Save** to write changes or **Cancel** to discard

#### Editable File Types

| Extension | Type |
|-----------|------|
| `.md` | Markdown |
| `.json` | JSON |
| `.toml` | TOML |
| `.txt` | Plain text |
| `.yaml` / `.yml` | YAML |

Other file types are displayed as read-only.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/files/md-tree` | Get file tree (query: `root`) |
| GET | `/api/files/read` | Read file content (query: `path`) |
| POST | `/api/files/write` | Write file content |

## Related Documentation

- [File Browser](./file-browser.md) — General file browsing
- [WebUI Overview](./webui-overview.md) — Dashboard layout

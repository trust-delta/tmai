# File Browser

Browse directories and view files from the WebUI.

## Overview

The File Browser lets you explore project directories, read files, and edit configuration and documentation files.

## Features

### Directory Browsing

Browse the filesystem starting from registered project paths:

- **Directory listing** — Shows files and subdirectories
- **Git indicator** — Marks directories that are Git repositories
- **Navigation** — Click directories to explore deeper

### File Reading

Click any file to view its content. Files up to 1MB can be read. The content is displayed as plain text.

### File Editing

Files with supported extensions can be edited:

- `.md` (Markdown)
- `.json` (JSON)
- `.toml` (TOML)
- `.txt` (Plain text)
- `.yaml` / `.yml` (YAML)

Only existing files can be edited — new file creation is not supported via the API.

## Project Management

Register and manage project directories via the Settings panel:

1. Click the settings button (⚙) in the status bar
2. **Add Project** — Enter a directory path to register
3. **Remove Project** — Remove a registered project

Registered projects appear in the sidebar and enable branch graph visualization.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/directories` | List directory contents (query: `path`) |
| GET | `/api/files/read` | Read file content (query: `path`, max 1MB) |
| POST | `/api/files/write` | Write file content (restricted extensions) |
| GET | `/api/projects` | List registered projects |
| POST | `/api/projects` | Add a project |
| POST | `/api/projects/remove` | Remove a project |

## Security

- **Path validation** — Directory traversal is prevented
- **Write restrictions** — Only config/doc file types can be written
- **Existing files only** — Cannot create new files via the API
- **Size limit** — 1MB maximum for file reads

## Related Documentation

- [Markdown Viewer](./markdown-viewer.md) — Specialized markdown browsing and editing
- [WebUI Overview](./webui-overview.md) — Dashboard layout

# Usage Tracking

Monitor token consumption and spending for Claude Max/Pro subscriptions.

## Overview

The Usage Panel shows real-time usage meters for your Claude subscription, helping you avoid rate limits and track spending.

## Accessing

The Usage Panel is located at the bottom of the sidebar. Click to expand for detailed information.

<!-- screenshot: usage-panel.png -->

## Features

### Collapsed View

When collapsed, the top 2 usage meters are shown as compact badges in the header row with a refresh button.

### Expanded View

Click the header to expand and see all meters:

- **Progress bars** — Visual usage percentage with color coding
- **Meter names** — Subscription tier and limit type
- **Reset info** — When the usage counter resets
- **Spending details** — Dollar amounts where applicable
- **Last updated** — Relative timestamp of the last data fetch

### Color Coding

| Usage Level | Color | Meaning |
|-------------|-------|---------|
| < 50% | Cyan | Normal usage |
| 50% - 80% | Amber | Approaching limit |
| > 80% | Red | Near or at limit |

### Real-Time Updates

Usage data is updated via SSE events automatically. When the usage changes server-side, the panel updates without manual refresh.

### Manual Refresh

Click the refresh button (↻) to manually trigger a usage data fetch from the provider.

## Configuration

`~/.config/tmai/config.toml`:

```toml
[usage]
enabled = true           # Enable usage tracking (default: true)
auto_refresh_min = 5     # Auto-refresh interval in minutes
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/usage` | Get current usage data |
| POST | `/api/usage/fetch` | Trigger usage fetch from provider |
| GET | `/api/settings/usage` | Get usage tracking settings |
| PUT | `/api/settings/usage` | Update usage tracking settings |

## Related Documentation

- [WebUI Overview](./webui-overview.md) — Dashboard layout
- [Configuration Reference](../reference/config.md) — Config options

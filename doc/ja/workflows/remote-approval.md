# スマホから承認（Web Remote Control）

Web Remote Controlを使って、スマホから承認操作を行うワークフロー。

## ユースケース

- 長時間タスクを走らせて、外出先から承認
- 別の部屋のPCで動いているエージェントを手元で操作
- 複数マシンのエージェントを一元管理

## セットアップ

### 1. 設定確認

`~/.config/tmai/config.toml`:

```toml
[web]
enabled = true  # デフォルトで有効
port = 9876     # ポート番号
```

### 2. tmaiを起動

```bash
tmai
```

### 3. QRコードを表示

tmaiで `r` キーを押すと、QRコードが表示されます。

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ███████████████████████████                               │
│   █ ▄▄▄▄▄ █▀▄▀▄▀▀▄█ ▄▄▄▄▄ █                               │
│   █ █   █ █▄▀█▀▄▀▄█ █   █ █                               │
│   █ █▄▄▄█ █ ▄▀▄█▀██ █▄▄▄█ █                               │
│   ███████████████████████████                               │
│                                                             │
│   Scan with your phone                                      │
│   http://192.168.1.100:9876/?token=xxxx                    │
│                                                             │
│   Press any key to close                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4. スマホでスキャン

QRコードをスマホのカメラでスキャンし、ブラウザで開きます。

## スマホでの操作

### エージェント一覧

```
┌─────────────────────────────────────┐
│  tmai Remote                        │
├─────────────────────────────────────┤
│                                     │
│  ● agent-1        [Approval]        │
│    → Approve                        │
│                                     │
│  ○ agent-2        [Processing]      │
│                                     │
│  ○ agent-3        [Idle]            │
│                                     │
└─────────────────────────────────────┘
```

### 承認操作

- **Approve** ボタン: Enterを送信して確定

> **Note**: 拒否やその他の選択は、数字キーまたはテキスト入力を使用してください。

### AskUserQuestion

選択肢がある場合、番号ボタンが表示されます。

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

### テキスト入力

テキスト入力が必要な場合、入力フィールドが表示されます。

## ネットワーク設定

### 同一LAN内

スマホとPCが同じWi-Fiに接続されていれば、そのまま使えます。

### WSL環境

#### Mirrored mode（推奨）

`.wslconfig` に `networkingMode=mirrored` が設定されている場合：

```powershell
# Windowsファイアウォールでポートを許可
New-NetFirewallRule -DisplayName "tmai Web Remote" -Direction Inbound -Protocol TCP -LocalPort 9876 -Action Allow
```

#### NAT mode

```powershell
# ポートフォワーディング設定
.\scripts\setup-wsl-portforward.ps1
```

## セキュリティ

- URLにランダムトークンが含まれる
- トークンを知らないとアクセスできない
- 同一LAN内からのみアクセス可能

## 次のステップ

- [Web Remote Control 詳細](../features/web-remote.md)
- [マルチエージェント監視](./multi-agent.md)

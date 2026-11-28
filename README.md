<p align="center"><img src="public/logo.png" width="104" alt="MahzzTerm"></p>

<h1 align="center">MahzzTerm</h1>

<p align="center"><b>The Windows terminal built for working with AI agents.</b><br>
Command blocks, an agents panel, its own copilot and a file viewer, all in one window.</p>

<p align="center">
  <a href="https://github.com/MateoHdzC/mahzz-term/releases/latest"><img src="https://img.shields.io/github/v/release/MateoHdzC/mahzz-term?label=version&color=8b45ff" alt="Latest version"></a>
  <a href="https://github.com/MateoHdzC/mahzz-term/releases"><img src="https://img.shields.io/github/downloads/MateoHdzC/mahzz-term/total?color=25b4c4" alt="Downloads"></a>
  <a href="https://github.com/MateoHdzC/mahzz-term/actions/workflows/ci.yml"><img src="https://github.com/MateoHdzC/mahzz-term/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078d4" alt="Windows 10 and 11">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/MateoHdzC/mahzz-term?color=17b885" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://github.com/MateoHdzC/mahzz-term/releases/latest/download/MahzzTerm-setup.exe"><b>⬇️ Download for Windows</b></a> ·
  <a href="https://mahzzterm.xyz">🌐 mahzzterm.xyz</a> ·
  <a href="CHANGELOG.md">📝 Changelog</a> ·
  <a href="README.es.md">🗣️ Leer en español</a>
</p>

---

## ✨ Highlights

| Feature | What it does |
|---|---|
| 🧱 **Command blocks** | Every command is grouped with its output, duration and exit code. Copy, rerun or search any block. |
| ✦ **Agents panel** | See every agent running in the window (Claude Code, Codex, Gemini CLI, Aider…), whether it's working or waiting for you, and get notified when it finishes. |
| 🤖 **Mahzz-AI** | A floating copilot that reads your last command (output and error) so you can ask why it failed without copying anything. Local with Ollama or with your own API key. |
| 🌳 **Parallel tasks** | Each agent works in its own git worktree, so they never step on each other. Merge or discard with one click. |
| 🔌 **AI control (MCP)** | Claude Code and other AIs can read blocks and logs, run commands and drive MahzzTerm's tabs. |
| 🎨 **Make it yours** | Six logos, colors that follow the logo, editable themes, shortcuts and Spanish or English. |

## 🧰 Everything it does

<details open>
<summary><b>Terminal and editor</b></summary>

- **Command blocks:** output, duration and exit code for every command. Copy, rerun or search them.
- **Command editor:** syntax highlighting, multiple cursors, autocomplete and a context bar with the folder, the git branch and the project type.
- **Tabs and panes:** horizontal and vertical splits, tabs on top or in a side column, duplicate a tab and drag it to another window without losing it. The tab color tints the whole window.
- **Searchable logs:** commands and output from every tab for the last 30 days. When you reopen, each pane comes back with its blocks.
- **Productivity:** history (`Ctrl+R`), command palette, saved commands with parameters and a file tree.
- **SSH with blocks:** hosts in `~/.ssh/config` get blocks on the server too (bash).

</details>

<details open>
<summary><b>AI agents</b></summary>

- **Agents panel (✦):** who is working, who is waiting for your answer, and a Windows notification when an agent finishes while you look at something else. It also detects agents installed with npm (they run as `node`).
- **`Shift+Enter`** is a new line inside Claude Code, Codex and other interactive programs.
- **Parallel tasks:** each agent gets its own git worktree (`mahzz/…` branch). Merge it into your branch or discard it with one click.
- **Change review (`Ctrl+Shift+G`):** the files that changed in the repo with their diffs. Stage (`git add`) or revert from there.
- **Sessions:** `mahzz --resume` reopens a previous session's tabs, panes and folders. If Claude Code was open, the pane is left with `claude --continue` ready to run.
- **AI control (MCP):** a built-in MCP server so an AI can use the terminal like you do.

</details>

<details open>
<summary><b>Files</b></summary>

- **Viewer and editor:** click a file to open it on the side. Highlighted code with saving (`Ctrl+S`), rendered Markdown, HTML with a live preview, images, video, audio, PDF, Excel and Word.
- **Files like in VS Code:** rename (F2), create, send to the recycle bin (Del), cut, copy, paste and drag to move.
- **Windows integration (opt-in):** "Open in MahzzTerm" in the right-click menu of folders and drives, and MahzzTerm in "Open with" for your files.

</details>

<details open>
<summary><b>Customization and sync</b></summary>

- **Logos:** pick one of six in Settings → Appearance. It changes in the app, the taskbar (even when pinned), Alt+Tab and MahzzTerm's shortcuts.
- **Colors that follow the logo:** with the MahzzTerm theme, buttons, borders and highlights take the logo's color.
- **Themes and shortcuts:** editable themes, configurable shortcuts and Spanish or English.
- **Encrypted secrets:** stored encrypted with your Windows user.
- **Optional sync:** sign in with Google and your settings, themes, saved commands and history are kept in the app's private folder in your Drive.

</details>

### 🎨 Logos

| Classic | Blue | Ocean | Emerald | Ice | Aurora |
|:---:|:---:|:---:|:---:|:---:|:---:|
| <img src="public/logo.png" width="56" alt="Classic"> | <img src="public/logos/azul.png" width="56" alt="Blue"> | <img src="public/logos/oceano.png" width="56" alt="Ocean"> | <img src="public/logos/esmeralda.png" width="56" alt="Emerald"> | <img src="public/logos/hielo.png" width="56" alt="Ice"> | <img src="public/logos/aurora.png" width="56" alt="Aurora"> |

More detail in [docs/funciones.md](docs/funciones.md) (Spanish).

## 🚀 Install

1. Download **[MahzzTerm-setup.exe](https://github.com/MateoHdzC/mahzz-term/releases/latest/download/MahzzTerm-setup.exe)** from the latest release.
2. Open it. It doesn't ask for administrator rights.
3. Done. MahzzTerm updates itself: when it opens and every 6 hours it checks for a new version and tells you with a notification.

> [!NOTE]
> The installers aren't code-signed yet (see [Code signing policy](#code-signing-policy)), so Windows may show a "Windows protected your PC" warning. Click **More info → Run anyway**.

**Requirements:** Windows 10 or 11 with WebView2 and [PowerShell 7](https://github.com/PowerShell/PowerShell). [Ollama](https://ollama.com) only if you want Mahzz-AI with the local model.

## ⌨️ Keyboard shortcuts

| Action | Shortcut | | Action | Shortcut |
|---|---|---|---|---|
| New tab | `Ctrl+Shift+T` | | Agents panel | `Ctrl+Shift+A` |
| Duplicate tab | `Ctrl+Shift+U` | | Mahzz-AI | `Ctrl+Shift+M` |
| New window | `Ctrl+Shift+N` | | Review changes | `Ctrl+Shift+G` |
| Split right / down | `Ctrl+Shift+D` / `E` | | Search all logs | `Ctrl+Shift+F` |
| Close pane | `Ctrl+Shift+W` | | Search blocks | `Ctrl+F` |
| Go to tab 1–9 | `Ctrl+1` … `Ctrl+9` | | Command history | `Ctrl+R` |
| Move between panes | `Ctrl+Alt+Arrows` | | Command palette | `Ctrl+Shift+P` |
| Previous / next block | `Ctrl+↑` / `Ctrl+↓` | | Files | `Ctrl+Shift+B` |
| Save command | `Ctrl+Shift+S` | | Settings | `Ctrl+,` |

All of them can be changed in Settings → Shortcuts.

## 💻 The `mahzz` command

Inside MahzzTerm:

```powershell
mahzz --resume      # pick a previous session and reopen its tabs
mahzz --resume 2    # open the second most recent session right away
mahzz --agentes     # see the agents that are running
mahzz --cambios     # review the repository changes
```

## 🤖 Mahzz-AI

Open it with `Ctrl+Shift+M` or its button in the bar. If the model is missing, MahzzTerm offers to install it (and Ollama, if needed). You can also get it by hand:

```powershell
ollama pull dkdidmateo/mahzz
```

To use another service, add any OpenAI-compatible API in the panel settings (OpenAI, OpenRouter, Groq, DeepSeek, LM Studio…). The key is stored encrypted with your Windows user and never goes back to the interface.

## 🔌 AI control (MCP)

MahzzTerm ships an MCP server so an AI can use the terminal like you: see tabs, read blocks and logs, run commands, send keys to interactive programs and manage tabs and panes. To connect it to Claude Code:

```powershell
claude mcp add --scope user mahzzterm -- "C:\path\to\MahzzTerm.exe" --mcp
```

In Settings → General, **Connect to Claude Code** copies that command with the right path, and the **AI control** switch turns it off whenever you want. More detail in [docs/funciones.md](docs/funciones.md#control-por-ia-mcp).

## 🛠️ Development

<details>
<summary><b>Build from source</b></summary>

You need [Rust](https://rustup.rs) (stable), [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io).

```powershell
pnpm install
pnpm tauri dev      # development build
pnpm tauri build    # installer in src-tauri/target/release/bundle
```

Before pushing, the same checks the CI runs:

```powershell
cd src-tauri; cargo fmt --check; cargo clippy --all-targets -- -D warnings; cargo test
```

Every push and pull request runs [CI](.github/workflows/ci.yml): formatting, clippy (warnings count as errors) and tests for Rust on Windows, and type checking plus the build for the frontend.

</details>

<details>
<summary><b>Publish a version</b></summary>

```powershell
.\scripts\publicar.ps1             # build and leave the files in src-tauri/target/release/publicar
.\scripts\publicar.ps1 -Publicar   # also create the vX.Y.Z release on GitHub
```

It builds the signed installer and `latest.json` (used by the auto-updater). It needs the private signing key in `~\.tauri\mahzzterm.key`, which never goes into the repository. Release notes come from the version's section in `CHANGELOG.md`.

</details>

<details>
<summary><b>Logos</b></summary>

The logos in `public/logos` are 256 px PNGs generated from the original images with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\logos.ps1 -Origen C:\folder\with\opc1..opc5
```

It removes solid black backgrounds, deletes stray specks and centers each logo in a square.

</details>

<details>
<summary><b>Data folder</b></summary>

MahzzTerm keeps settings, history, sessions and the account in `%LOCALAPPDATA%\com.mahzz.mahzzterm\datos`. To use another folder (a portable copy or tests), set the `MAHZZTERM_DATOS` environment variable.

</details>

<details>
<summary><b>Google sign-in (optional)</b></summary>

The repository doesn't include credentials. To enable sync:

1. In Google Cloud, create an OAuth client of type **Desktop app** and enable the Google Drive API.
2. Download the JSON and save it as `src-tauri/credenciales/google.json`. That folder is in `.gitignore`.
3. Build again. Without that file the app works the same and just hides sync.

> If the OAuth client is in "Testing" mode, Google expires the session after 7 days. To make it last, publish the app on the consent screen.

</details>

## 🗺️ Roadmap

| Version | Theme | Status |
|---|---|---|
| 0.7 | Logos, logo colors, npm agents | ✅ Released |
| 0.8 | Agents | 🔨 In progress |
| 0.9 | Your way | ⏳ Next |
| 1.0 | Ready for everyone | ⏳ Next |

Full roadmap at [mahzzterm.xyz/en/roadmap](https://mahzzterm.xyz/en/roadmap/).

## Code signing policy

Installers are built on GitHub Actions from this repository ([`.github/workflows/release.yml`](.github/workflows/release.yml)) and every signature is approved by hand.

Free code signing from [SignPath Foundation](https://signpath.org) is pending. Until then, installers don't have an Authenticode signature and Windows may show a warning when you download them.

**Team**
- Committers and reviewers: [MateoHdzC](https://github.com/MateoHdzC)
- Approvers: [MateoHdzC](https://github.com/MateoHdzC)

## 🔒 Privacy

MahzzTerm doesn't send information to other systems except in these cases, and only the ones you ask for or turn on:

| What | When | What it sends |
|---|---|---|
| **Updates** | When it opens and every 6 hours | Only checks `latest.json` on GitHub releases. No personal data. Turn it off in Settings → General → **Check for updates automatically**. |
| **Google sync** | Only if you sign in | Your settings, to the app's private folder in your Drive. |
| **Mahzz-AI** | When you ask it something | Local model: talks to Ollama at `127.0.0.1`. With an API key: your question goes to the service you chose. |
| **AI control (MCP)** | If it's turned on | Listens only on `127.0.0.1` and requires a local key. |

## 📄 License

[MIT](LICENSE) © [MateoHdzC](https://github.com/MateoHdzC)

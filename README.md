# Solve Screenshot with AI

Capture a screenshot, send it to an AI CLI (Codex or Claude Code), and copy the answer straight to your clipboard — without leaving the keyboard.

## How it works

1. Trigger the command from Raycast.
2. A screenshot is taken (full screen or a region you select, depending on your preference).
3. The image path and your prompt are forwarded to the chosen AI CLI.
4. The response is copied to your clipboard and a HUD confirmation appears.

## Requirements

At least one of the following CLIs must be installed and available on your login-shell `PATH`:

| CLI | Install |
|-----|---------|
| **Codex** | `npm install -g @openai/codex` |
| **Claude Code** | `npm install -g @anthropic-ai/claude-code` |

The extension probes your login shell (`zsh -l -c 'command -v …'`) and several common install prefixes (`~/.bun/bin`, `/opt/homebrew/bin`, etc.) so standard package-manager installs are found automatically.

## Preferences

| Preference | Default | Description |
|------------|---------|-------------|
| **AI Solver** | Codex | Which CLI processes the screenshot — `Codex` or `Claude Code`. |
| **Screenshot Mode** | Full Screen | `Full Screen` captures everything. `Select Area` shows a crosshair so you can drag a region. |
| **System Prompt** | _(default)_ | Instructions sent to the AI. Leave blank to use the built-in default (solve the question and return Python code only). |
| **Show Progress** | On | When on, step-by-step toasts appear during capture and solving. Turn off for a silent run — errors always surface regardless. |

### Default system prompt

```
Solve the question in this screenshot and output only the final answer as Python code.
Do not include explanations, Markdown code fences, comments, labels, or any text outside the code.
```

The screenshot path and a safety clause (`Do not run any commands or edit any files.`) are always appended automatically, regardless of what you put in the custom prompt field.

## Usage tips

- **Select Area mode**: Raycast dismisses itself before the crosshair appears. Drag to select your region, then release — the AI call starts immediately.
- **Cancelling**: If you press `Escape` during area selection, no file is written and the extension exits cleanly with a "Screenshot cancelled" toast.
- **Custom prompts**: You can change the output format entirely. For example, `Explain this error in one sentence.` or `Translate the text in this screenshot to English.`

## Troubleshooting

**CLI not found** — The toast message names the missing binary and its install hint. Run the install command in a new terminal tab, then retry.

**Empty response** — Some prompts cause the AI to produce no output. Try rephrasing or switching solvers.

**Permissions** — macOS may prompt for Screen Recording permission the first time. Grant it in System Settings → Privacy & Security → Screen Recording.

**Claude Code — "Not authenticated"** — Run `claude login` in a terminal to complete the OAuth flow. Credentials are stored in `~/.claude.json`; the extension reads them directly from there.

# sendlayer-cli

Command-line interface for the [SendLayer](https://sendlayer.com) transactional email API.

Send emails, manage webhooks, and tail delivery events from your terminal.

## Install

### npm (cross-platform)

```sh
npm install -g sendlayer-cli
```

Requires Node.js 18 or newer. Verify it worked:

```sh
sendlayer --version
```

### Direct download

Grab a standalone binary — no Node.js required — from the
[latest release](https://github.com/SendLayer/sendlayer-cli/releases/latest):

| OS      | Architecture |
|---------|--------------|
| Linux   | x64, arm64   |
| macOS   | x64, arm64   |
| Windows | x64          |

<!--
The install channels below are not live yet. Each is blocked on infrastructure
rather than on code -- the scripts and the Homebrew formula are already built
and tested in CI. Uncomment a section once its channel is set up, and
re-enable the matching job in .github/workflows/release.yml.

Blocked on: install.sh / install.ps1 being hosted at sendlayer.com.
(The scripts themselves work and are parse-checked in CI; only the
https://sendlayer.com/... hosting is missing.)

### macOS / Linux (curl)

```sh
curl -fsSL https://sendlayer.com/install.sh | bash
```

Override version or install location:

```sh
curl -fsSL https://sendlayer.com/install.sh | SENDLAYER_VERSION=v0.2.0 bash
curl -fsSL https://sendlayer.com/install.sh | SENDLAYER_INSTALL_DIR=$HOME/.local/bin bash
```

### Windows (PowerShell)

```powershell
irm https://sendlayer.com/install.ps1 | iex
```

Override version or install location:

```powershell
$env:SENDLAYER_VERSION = 'v0.2.0'; irm https://sendlayer.com/install.ps1 | iex
$env:SENDLAYER_INSTALL_DIR = 'C:\tools\sendlayer'; irm https://sendlayer.com/install.ps1 | iex
```

Blocked on: the SendLayer/homebrew-sendlayer tap repo and HOMEBREW_TAP_TOKEN.

### macOS / Linux (Homebrew)

```sh
brew install sendlayer/sendlayer/sendlayer
```

Blocked on: the first winget submission (a manual PR to microsoft/winget-pkgs)
and WINGET_TOKEN.

### Windows (winget)

```powershell
winget install SendLayer.SendLayerCLI
```
-->

## Authenticate

```sh
sendlayer login
# or set the env var, which every command reads:
export SENDLAYER_API_KEY=sl_xxx
# or non-interactive, reading the key from the environment:
sendlayer login --key "$SENDLAYER_API_KEY"
```

Auth resolution: `--api-key` flag → `SENDLAYER_API_KEY` env → stored credentials.

Prefer the interactive prompt or the environment variable. A key passed on the
command line is visible in your shell history and to anyone who can run `ps`.

Check who you are:

```sh
sendlayer whoami
```

## Send an email

```sh
sendlayer emails send \
  --from "Paulie <paulie@example.com>" \
  --to user@example.com \
  --subject "Welcome" \
  --text "Glad to have you."
```

Use a JSON payload file for complex emails:

```sh
sendlayer emails send --file ./email.json
```

Where `email.json` is:

```json
{
  "from": { "email": "paulie@example.com", "name": "Paulie" },
  "to": [{ "email": "user@example.com" }],
  "subject": "Welcome",
  "html": "<h1>Hi!</h1>",
  "tags": ["onboarding"]
}
```

Attachments, headers, and multiple recipients:

```sh
sendlayer emails send \
  --from paulie@example.com \
  --to a@x.com,b@y.com \
  --cc admin@example.com \
  --subject "Invoice" \
  --html-file ./invoice.html \
  --attachment ./invoice.pdf:application/pdf \
  --header X-Campaign=Q2 \
  --tag billing
```

## Webhooks

```sh
sendlayer webhooks list
sendlayer webhooks create --url https://example.com/hook --event bounce
sendlayer webhooks delete 42
```

### Local development with `webhooks listen`

Stream events to your terminal and forward them to a local HTTP server:

```sh
# in one terminal — expose your local port over a public URL
ngrok http 4000

# in another terminal
sendlayer webhooks listen \
  --port 4000 \
  --public-url https://abc.ngrok.io \
  --forward-to http://localhost:3000/webhook
```

Notes:

- The CLI registers one SendLayer webhook per event type (default: all six).
- On `Ctrl+C` it deletes every webhook it created.
- If a previous run crashed, the next run will offer to clean up stale webhooks.

## Events

```sh
sendlayer events list --event delivered --limit 50
sendlayer events list --start 2026-05-01 --end 2026-05-09
sendlayer events list --message-id <message-id>
```

## Output formats

Every command supports `--json` for machine-readable output, and auto-detects non-TTY (CI/pipes) to default to JSON.

```sh
sendlayer events list --json | jq '.Events[] | .Message.Headers.To'
```

## Configuration

Credentials are stored at:

- macOS / Linux: `$XDG_CONFIG_HOME/sendlayer/credentials.json` (default `~/.config/sendlayer/credentials.json`)
- Windows: `%APPDATA%\sendlayer\credentials.json`

File mode is `0600`. Multiple profiles supported via `--profile <name>`. The first
profile you save becomes the default, and any command run without `--profile` uses
it; `sendlayer whoami` shows which one is active.

## Development

The CLI is written in TypeScript (`src/**/*.ts`). Two entrypoints:

- `bin/dev.js` — runs the TypeScript sources directly via ts-node, no build step.
- `bin/run.js` — runs the compiled output in `dist/` (what ships to users).

```sh
git clone https://github.com/SendLayer/sendlayer-cli
cd sendlayer-cli
npm install

# Run straight from TypeScript sources (fast inner loop):
./bin/dev.js whoami
npm run dev -- emails send --help

# Or build once and run the compiled CLI:
npm run build
./bin/run.js whoami
```

Quality checks (same as CI):

```sh
npm run lint        # eslint over src/**/*.ts
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # tsc -> dist/ + oclif manifest
```

Build native binaries with [Bun](https://bun.sh). `npm install` provides the pinned version:

```sh
npm run compile:binaries
```

## License

MIT

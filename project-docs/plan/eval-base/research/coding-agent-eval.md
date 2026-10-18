# Real coding agent in the eval layer: research (read-only)

Repo /home/pyosechang/projects/lophn, HEAD e4f69ac0f. Paths are repo-relative unless absolute. "Verified" = read in this repo or run locally without any model call. "String-present" = the token was found in the installed binary with `grep -a`, which proves the name exists but not the exact semantics. "Unverified" = needs a real run. No model provider was called, no CLI was run with a prompt, ~/.claude, ~/.codex, ~/.lophn were not read (only listed for existence).

## 0. Machine facts

| item | value |
|---|---|
| claude | `/home/pyosechang/.nvm/versions/node/v24.20.0/bin/claude` -> native `claude.exe`, `claude --version` = 2.1.302 |
| codex | `.../bin/codex` -> `@openai/codex/bin/codex.js` (native musl binary in `codex-linux-x64`), `codex-cli 0.161.0` |
| opencode | `.../bin/opencode` -> native `opencode.exe`, `1.18.35` |
| not installed | gemini, pi, hermes, openclaw, aider (not on PATH) |
| `lophn` on PATH | NO (`which lophn` empty). Dev needs a wrapper (see 1.6) |
| global dirs that exist | `~/.claude`, `~/.codex`, `~/.config/opencode`, `~/.local/share/opencode`, `~/.agents`, `~/.lophn` |
| API keys in env | `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are NOT set in this shell. |
| tools | `deno 2.9.7`, `node v24.20.0`, `tmux` (~/.local/bin), `/usr/bin/script`, `/usr/bin/python3`, `/usr/bin/systemd-run`; `systemctl --user is-system-running` = `degraded`; `XDG_RUNTIME_DIR` is set and `/run/user/<uid>` exists |
| `.dev-data/e2e/deno-dir` | does NOT exist in this checkout (so `deno task e2e:deps` was never run here; app E2E / release prepare cannot start until it is) |

## 1. How core hands a ticket to a coding agent

### 1.1 Core side (all verified)

1. AE tool `call` to `{role:"coding_agent", place:{app}}` with `refs:[{kind:"ticket"}]`, `options:{harness, model?}` -> `app-tickets` queue (one coding session per app; later hand-offs wait in a line): `project-docs/architecture/coding-agent.md:5-23, 46`.
2. `packages/core/apps/tickets/coding/launch.ts:36-67` `resolveLaunch`: harness = `options.harness ?? memory.defaults.harness`; the detection must exist with `discovery:"detected"` and `selected_executable !== null`, else the hand-off fails `not_connected` (`launch.ts:42-52`). `cwd` = the app's `source_path` (`launch.ts:56-66`). `launch.ts:70-115` `openSession` builds the plan via `launchPlanOf` and sends a Gateway `open` request after commit.
3. Token: `packages/core/apps/tickets/coding/relay.ts:217-245` issues the coding token after commit and puts it in `plan.env.LOPHN_CODING_TOKEN`. It is the only secret in the plan.
4. `CodingLaunchPlan` (`packages/protocol/coding-agent/launch-plan.ts:20-41`), strict zod at `:43-66`:

| field | meaning |
|---|---|
| `session` (`ses_`), `app` (`app_`), `ticket` (`tkt_`) | ids |
| `harness_id` | one of 7: claude, codex, opencode, gemini, hermes, pi, openclaw (`protocol/coding-agent/harness-id.ts:3-11`) |
| `cwd` | absolute app source folder |
| `executable` | absolute path that shell main reported in `harnessReport` |
| `argv` | `argv[0]` = executable basename; then `--model <m>` if given; then the prompt (positional for claude/codex/pi, `--prompt <p>` for opencode, `--prompt-interactive` for gemini) (`launch-plan.ts:154-170`, table `harness-adapter.ts:32-129`) |
| `env` | `TERM=xterm-256color`, `COLORTERM=truecolor` (`launch-plan.ts:69-72`) + `LOPHN_CODING_TOKEN` added later. NO `LOPHN_DAEMON_URL`, NO `LOPHN_HOME`, NO model key |
| `env_delete` | `LOPHN_TERMINAL_OBSERVE, LOPHN_TOKEN, LOPHN_CREDENTIAL, LOPHN_APP_BROKER_CREDENTIAL` (`:75-80`) |
| `first_prompt` | `firstPromptOf(ticket)` (`:93-103`): only the ticket id + 5 numbered CLI steps (show, claim, work, report, message send). The body is read by the agent via `lophn ticket show` |
| `prompt_delivery` | `{mode:"argv"}` or `{mode:"paste_after_hook", deadline_ms:10000}` |
| `title` | tab title |

   `paste_after_hook` exists in the schema but NO harness uses it today: all 5 launchable adapters have `prompt.kind:"argv"` (`harness-adapter.ts:40,52,65,84,96`); hermes/openclaw have `prompt:null` and cannot launch (`:114,125`). So the paste path (`launch.ts:90-91`, `requests.ts:9-10`) is dead for real harnesses; only `input` frames use bracketed paste.
5. Gateway frame: `{type:"coding_terminal", request}`, request kinds `open{request,plan}`, `input{request,session,text<=8192}`, `stop{request,session}` (`protocol/coding-agent/terminal-requests.ts:16-39`). Shell main answers with route `coding_agent_terminals/result` (`ok:true{terminal_ref?}` or `ok:false{reason: spawn_failed|no_terminal|folder_missing|host_lost}`, `:50-69`) and, when the PTY process ends, `coding_agent_terminals/exited{session, exit_code|null, reason: exited|killed|host_lost}` (`:72-84`). Both actors = user token. Gateway connections are limited to 4 per principal (`testing.md` app-path section).

### 1.2 What shell main (Electron) does (verified)

- `packages/shell/main/desktop/wiring/coding.ts:83-200`: creates a terminal supervisor (`terminal-host.cjs` child), `createCodingTerminalRequests(...)`; `reportResult`/`reportExited` call `ctx.coreInternal("memory","coding_agent_terminals","result"|"exited", body)`.
- `packages/shell/main/terminal/coding/requests.ts`:
  - `open` (`:244-293`): reject if the same session is known/opening; `checkFolder(plan.cwd)` (else `folder_missing`); `ensureRegistered(harness)` (`:182-242`): runs `lophn harness install --input {harness,dry_run:true[,command]}`; if skill or hook is `missing`, asks the human with an OS dialog, then runs the real install (`:168-180`). Refusal or failure never blocks the open. Then `supervisor.request({type:"open-coding", plan, columns:80, rows:24})`; the reply gives `terminal_ref`; session is recorded; result `ok` is sent.
  - `input` (`:295-319`): waits until the human is not focused on the tab, then writes `ESC[200~ text ESC[201~ \r` (bracketed paste then CR; constants `:83-85`).
  - `stop` (`:321-`): sends `close` to the terminal host, reports `exited` with reason `killed`.
  - Exit mapping (`:129-156`): runtime state `exited` -> `finish(..., "exited"|"killed", exit_code)`; `unknown`/host lost -> `host_lost`.
- Host (`packages/shell/terminal-host/launch-plan.ts:9-52`): re-parses the plan with the same zod schema, re-checks cwd, builds env = `stripPlatformEnv(host env)` minus `env_delete` plus `plan.env`; spawns `file=plan.executable, args=plan.argv.slice(1)` directly, no shell.
- `packages/shell/terminal-host/env.ts:4-21` `stripPlatformEnv` drops any env name matching `TOKEN|SECRET|PASSWORD|CREDENTIAL|KEYCHAIN|HANDLE|API_KEY|AUTH`, anything starting `LOPHN_`/`ELECTRON_`, and values containing `127.0.0.1:port`. Consequence: in the product path a harness NEVER receives `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` from the human's env; the harness must be logged in through its own config files. And `LOPHN_DAEMON_URL`/`LOPHN_HOME` are not forwarded either; the CLI finds core by `<LOPHN_HOME or default ~/.lophn>/run/location.json` or the default port (`packages/coding-agent/connection/client/daemon.ts:150-190`, `cli/main.ts:186-193`).
- PTY library: **node-pty 1.1.0** (`packages/shell/main/package.json`, `packages/shell/terminal-host/pty.ts:50-81`: `pty.spawn(file,args,{cwd,env,cols,rows,name:"xterm-256color"})`; `PtyHandle` = `write/resize/kill/onData/onExit`). Native module, rebuilt for Electron by `electron-rebuild` (`postinstall`).

### 1.3 Hook signals (verified)

- `packages/protocol/coding-agent/hook-signal.ts:33-72` `HOOK_EVENT_TABLE`: claude `SessionStart, UserPromptSubmit, Stop, StopFailure, PermissionRequest, PostToolUse, SessionEnd`; codex the same minus StopFailure/SessionEnd; gemini `SessionStart, BeforeAgent, AfterAgent, Notification, AfterTool, SessionEnd`; opencode `session.status, permission.asked, permission.replied`; pi `session_start, agent_start, agent_settled`. Signals: SessionStarted, TurnStarted, TurnEnded(completed|failed|interrupted), PermissionRequested, PermissionResolved, SessionEnded (`:5-24`). Subagent events (`agent_id` present), compact-started SessionStart and clear-ended SessionEnd are dropped (`:110-114`).
- Turn-end signals (`harness-adapter.ts:133-141`): claude `Stop`, codex `Stop`, gemini `AfterAgent`, opencode `session.status idle`, pi `agent_settled`; hermes/openclaw none.
- Path: harness runs global hook command `lophn hook <harness> <event>` with JSON on stdin -> CLI `hook` (`packages/coding-agent/cli/commands/hook.ts:16-38`) -> route `coding_agent_sessions/hook` (`protocol/coding-agent/hook.ts`, not written to the ledger) -> core turns it into agent events (SessionStarted/MessageReceived/TurnStarted/TurnEnded/SessionEnded...). Without a token the hook is a no-op (`hook.ts:20`).
- **Agent events are memory-only: no seq, never stored** (`packages/protocol/events/agent.ts:7-10`). So coding-agent turn timing from hooks is NOT retrievable after the fact through `events/list`; the eval must capture them live (Gateway/event stream) or time the hook calls itself.
- Session end is only the PTY exit (`coding-agent.md:44`); a harness that stays open after `ticket report` keeps the app's coding line blocked and the token live until the process exits. A real-harness driver MUST kill/exit the process after the report (the call is already closed by `TicketCompletionReported`).

### 1.4 What the test must do to play shell main with a REAL harness

Today (`tests/support/gateway/shell.ts:18-67`, `tests/support/app/activate.ts:229-269, 301-440`): `reportHarness` reports a FAKE path `/e2e/bin/claude`; `waitCodingTerminal` takes the `open` frame; `answerTerminal` sends `result ok`; `deliverRelease` plays the coding agent through in-process `cliMain` (`tests/support/coding/cli.ts`) and ends with `exitTerminal` (`activate.ts:433`). Nothing is spawned, no PTY.

For a real harness the replacement driver must:
1. Report the real detection: `core.call(harnessReport, {detections:[{harness_id:"claude", selected_executable:"<abs path>", discovery:"detected", version:..., auth:...}]})` (shape in `shell.ts:23-33`) before the AE hand-off.
2. Pre-install skill+hook into the harness config of the isolated HOME: `lophn harness install --input {"harness":"claude","command":"<abs lophn wrapper>"}` with `HOME=<iso>` (`packages/coding-agent/cli/commands/harness-run.ts:41-75`, install target = `${home}/${adapter.skill_dir}` and `${home}/${adapter.hook.path}`, `install.ts:283-330`). The hook command must be an absolute path without whitespace/quotes (`..` rejected) (change-log 0.2.0:462).
3. On `open`: validate/refuse like requests.ts (cwd exists), spawn `plan.executable` with `plan.argv.slice(1)`, `cwd=plan.cwd`, env = a built map: `plan.env` (token) + `PATH` that contains a `lophn` wrapper + the daemon address (`LOPHN_DAEMON_URL=core.baseUrl` or `LOPHN_HOME=<run home>`; neither is in the plan) + isolated HOME/config + model credentials. Then send `result ok{terminal_ref}`.
4. Wire PTY `onExit` -> `codingTerminalExited{session, exit_code, reason}`; implement `stop` frame (kill) and `input` frame (bracketed paste + `\r`) or answer `no_terminal`, because AE messages to the coding agent arrive as `input` frames.
5. Detect completion: wait for `TicketCompletionReported` (events/list, type filter, `protocol/events/domain.ts:59-70`) or `tickets/show` state `reported`, then terminate the harness and call `exited` (`exitTerminal`), so token is revoked and the AE gets its notification turn (`activate.ts:433-435` does the same for the fake).
6. Deal with the interactive blockers (see 2.3): trust dialog, API key approval, permission prompts.

PTY from Deno: **verified locally** that Deno 2.9.7 can load the already built node-pty from `packages/shell/main/node_modules/node-pty` (N-API, built with node-addon-api) via `createRequire("<repo>/packages/shell/main/package.json")("node-pty")` and spawn a PTY: output `hello-from-pty\r\n/dev/pts/16`, exit `{exitCode:3,signal:0}` (script `/tmp/claude-1000/-home-pyosechang-projects-lophn/f3ec91a4-b3f3-468d-b135-0a94c9c54e2a/scratchpad/pty-try/try.mjs`, `--allow-all`, no model). That makes the closest-to-product option cheap, but it requires `npm install` in `packages/shell/main` to have run (the `node_modules/node-pty/build/Release/pty.node` exists here). Adding `npm:node-pty` to the root deno.json would change the frozen lock (`deno.json` `"lock":{"frozen":true}`, AGENTS.md "의존성은 판을 정확히 고정") and node-pty needs a native build, so path-require from the shell's node_modules is the practical route. Other PTY routes available on this machine: `/usr/bin/script -q -c <cmd> /dev/null` (util-linux), python3 `pty`, `tmux new-session -d` + `send-keys`/`pipe-pane`. None is needed if a headless mode is used.

### 1.5 Headless / non-interactive modes (help output verified, behavior with hooks unverified)

| harness | headless command | flags that matter | exits when | notes |
|---|---|---|---|---|
| claude 2.1.302 | `claude -p "<prompt>"` | `--output-format json\|stream-json`, `--include-hook-events`, `--no-session-persistence`, `--max-budget-usd`, `--permission-mode`, `--dangerously-skip-permissions`, `--settings`, `--setting-sources`, `--session-id`, `--model`, `--effort`, `--bare` (skips hooks, keychain, CLAUDE.md; auth strictly ANTHROPIC_API_KEY) | the single prompt finishes | trust dialog is skipped in `-p` (help text); `--output-format json` returns one result object with usage (field set unverified); stream-json emits every message |
| codex 0.161.0 | `codex exec "<prompt>"` | `--json` (JSONL events), `-o/--output-last-message`, `-s workspace-write\|danger-full-access`, `--dangerously-bypass-approvals-and-sandbox`, `--dangerously-bypass-hook-trust`, `--ephemeral`, `--ignore-user-config`, `-C`, `-m`, `-c k=v` | finishes | hooks are only run if trusted; `--dangerously-bypass-hook-trust` is the exec flag; interactive TUI requires human `/hooks` trust (`harness-adapter.ts:54-55`) |
| opencode 1.18.35 | `opencode run "<msg>"` | `--format json` (raw JSON events), `--auto` (auto-approve permissions), `--dir`, `--model provider/model`, `--variant`, `--pure` (no external plugins; would disable the lophn hook plugin), `--attach` | finishes | TUI mode uses `--prompt` (what lophn uses) |

What headless changes versus the product path (certain from lophn code/doc; the CLIs' exact behavior is not):
- Product launches `claude <prompt>` in a PTY, interactive TUI (`launch-plan.ts:154-170`). Headless needs `-p`/`exec`/`run` inserted into argv; the plan's argv must be rewritten by the test, a deviation from "argv from core".
- Session lifetime: headless exits after the first prompt, so the PTY-exit => session-end rule fires right after the single run; if the agent exited without `ticket report` the result is `CodingSessionEndedUnreported` + call `failed` (`coding-agent.md:21`, `protocol/events/domain.ts:81-87`). Interactive stays open and the driver must end it.
- No `input` frames possible (no PTY to paste into): AE follow-up messages / `message send` replies cannot be delivered, so scenarios where the AE answers the coding agent need the interactive path.
- Permission prompts: headless cannot ask; needs bypass flags/settings. Interactive prompts show up as `PermissionRequested` hook signals and wait for a terminal answer (nobody answers in an eval).
- Whether SessionStart/Stop hooks fire in `claude -p` / `codex exec` is UNVERIFIED; lophn's state machine (running/waiting/idle/unknown) relies on them. Metrics do not depend on them.
- Deviation size: small for "does the product loop (claim, prepare, test, report, verify) work with a real model"; large for "does the interactive session lifecycle work".

### 1.6 `lophn` CLI for the real agent

The skill/first prompt tell the agent to run `lophn ticket ...`, `lophn release prepare`, `lophn app test` ... (`packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`). In dev there is no `lophn` on PATH and no wrapper file in the repo. `LOPHN_CLI` is read only by shell main (`wiring/coding.ts:98`) as an absolute path. The CLI entry is runnable: `packages/coding-agent/cli/main.ts` ends with `if (import.meta.main) Deno.exit(await cliMain(Deno.args))`. So the eval needs a 3-line shell wrapper: `exec deno run --allow-all <repo>/packages/coding-agent/cli/main.ts "$@"` placed first in the harness PATH, used both as the agent's `lophn` and as the hook `command`. The installed launcher (`packages/base/install/linux-install.ts:88-136`) uses `--cached-only --frozen` with narrow permissions and refuses `hook` without token; the wrapper above is simpler but widens permissions (acceptable in an eval, a deviation to note). Each `deno run` start is slow (`tests/support/coding/cli.ts:35` says in-process saves Deno startup "about eight times per app E2E"); a real agent will call it roughly 10 to 40 times.

## 2. Harness isolation

### 2.1 Config roots and auth (string-present in binaries unless noted)

| harness | isolate config/state | auth by key env | other relevant switches |
|---|---|---|---|
| claude | `CLAUDE_CONFIG_DIR` (string-present, 55 hits; default `~/.claude`; the binary also mentions "the HOME it defaults from"). The adapter writes hook+skills under HOME: `.claude/settings.json`, `.claude/skills` (`harness-adapter.ts:42-43`), so with `CLAUDE_CONFIG_DIR` set the product's `${home}/.claude` assumption no longer matches; use `HOME=<iso>` WITHOUT `CLAUDE_CONFIG_DIR` and let it default to `<iso>/.claude` (default resolution unverified) | `ANTHROPIC_API_KEY` (string-present). Interactive mode asks once to approve a custom API key (`customApiKeyResponses`) and asks onboarding/folder trust (`hasCompletedOnboarding`, `hasTrustDialogAccepted`), all string-present; these can be pre-seeded in `<iso>/.claude.json` (exact JSON shape unverified). `CLAUDE_CODE_OAUTH_TOKEN` also exists | `DISABLE_TELEMETRY`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_AUTOUPDATER` (string-present); settings `permissions.defaultMode` and `skipDangerousModePermissionPrompt` (string-present) set bypass permissions without touching argv |
| codex | `CODEX_HOME` (help text: `$CODEX_HOME/config.toml`, `$CODEX_HOME/<name>.config.toml`), also `CODEX_SQLITE_HOME` (string-present). The adapter writes hook to `~/.codex/hooks.json` and skills to `~/.agents/skills` (`harness-adapter.ts:53-56`): the hook file follows `CODEX_HOME` only if HOME is also isolated (`.codex` is the default under HOME); skills under `~/.agents` always follow HOME | `OPENAI_API_KEY`, `CODEX_API_KEY` (string-present); `codex login --with-api-key` reads stdin and stores auth in `CODEX_HOME/auth.json` (help verified) | `-c approval_policy=...`/`sandbox_mode=...` (string-present), `--ignore-user-config`, `--dangerously-bypass-hook-trust` (exec only), `trust_level` per project (string-present) |
| opencode | XDG dirs (`XDG_DATA_HOME` etc.) plus `OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG`, `OPENCODE_DB` (path or `:memory:`), `OPENCODE_TEST_HOME`, `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_DEFAULT_PLUGINS`, `OPENCODE_PERMISSION` (JSON permission map) (all string-present); earlier research notes opencode's own tests use an `isolatedEnv` of HOME+XDG+DB+config (git `ef3cf4ea5^:project-docs/plan/testing/research/research-cli.md:110, 253`). Hook plugin goes to `~/.config/opencode/plugins/lophn-status.ts` (`harness-adapter.ts:72-75`), follows `XDG_CONFIG_HOME`/HOME | provider keys by standard env (not verified), `opencode providers` for stored creds | `--auto` for permissions in TUI |

The same earlier research records that Codex's own e2e uses a temp `CODEX_HOME` + dummy key + `-c openai_base_url=...`, so isolation by temp CODEX_HOME is the supported pattern.

### 2.2 Where `harnesses/install.ts` writes (all verified)

`installGlobal(ports, {harness, home, dryRun, command?})` (`packages/coding-agent/harnesses/install.ts:283-330`) writes ONLY under the `home` argument, which comes from the CLI env `HOME` (`cli/main.ts:200` `options.home ?? env.get("HOME")`; `cli/launch-entry.ts:43`; permission flags are computed for exactly those paths, `cli/launch-entry.ts:39-57`). Targets per `harness-adapter.ts`:

| harness | skill dir (2 skills `lophn-build-app`, `lophn-repair`, `CODING_SKILL_NAMES` `:30`) | hook file |
|---|---|---|
| claude | `<home>/.claude/skills/<name>/SKILL.md` | `<home>/.claude/settings.json` (json, 7 events) |
| codex | `<home>/.agents/skills/...` | `<home>/.codex/hooks.json` (json, 5 events; needs human trust unless bypassed) |
| opencode | `<home>/.config/opencode/skills/...` | `<home>/.config/opencode/plugins/lophn-status.ts` (plugin file, only active when `LOPHN_CODING_TOKEN` is set) |
| gemini | `<home>/.gemini/skills` | `<home>/.gemini/settings.json` |
| pi | `<home>/.agents/skills` | `<home>/.pi/agent/extensions/lophn-status.ts` |

So **yes: running `HOME=<iso> lophn harness install` targets the isolated HOME** and never touches the human's ~/.claude etc. It preserves other keys in an existing JSON; unparsable settings -> `failed`. Existing tests: `packages/coding-agent/harnesses/install_test.ts`. Skills are thin stubs that point to `lophn guide <name>` (`install.ts:166-174`), so the actual procedure text comes from the CLI.

### 2.3 Isolation recipe and deviations from the product path
- Spawn env for the harness: `HOME=<run>/harness-home`, `PATH=<wrapper dir>:...`, plus `plan.env`. Do NOT inherit the human env (the product also strips secrets: `env.ts:4-21`). Keys: pass `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` from the eval runner's env explicitly (deviation: the product relies on the human's own login). A fidelity-preserving alternative is writing credentials into the isolated config (codex: `codex login --with-api-key` with `CODEX_HOME` set).
- Permission mode is not decided by lophn in the product (`coding-agent.md:62`). In the eval put bypass in the isolated config (claude `settings.json` `permissions.defaultMode`; codex `config.toml` `approval_policy="never"`, `sandbox_mode="danger-full-access"`; opencode `OPENCODE_PERMISSION`), which keeps `plan.argv` byte-identical to the product.
- Interactive first-run dialogs (theme/onboarding/trust/API key approval) cannot be answered by lophn and there is no screen reading; pre-seed the isolated config. Exact keys unverified.
- Concurrency: one coding session per app; separate eval trials need separate data roots (`createRun`) and separate harness HOMEs.

## 3. Coding-agent metrics (where each harness records them)

lophn itself records NOTHING about the harness's model usage: no code reads harness transcripts (`grep` of `jsonl|transcript` in packages shows only unrelated diagnostics/problem-test/storage code). `coding-agent.md:3` says lophn cannot look inside the product. All coding-agent token metrics must be read from the harness's own output/storage in the isolated HOME.

| harness | per-message usage | cache tokens | tool calls/errors | timestamps | source status |
|---|---|---|---|---|---|
| claude | `<config>/projects/<cwd-slug>/<session-id>.jsonl`, `assistant` lines with `message.usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}` (+ `cache_creation.ephemeral_5m_input_tokens`) | `cache_read_input_tokens`, `cache_creation_input_tokens`; Anthropic input_tokens EXCLUDES cache (lophn models this as `cache_in_input:false`, `providers/adapters/messages.ts:353,372`) | `tool_use` blocks in assistant lines; `tool_result` blocks with `is_error` in user lines (`tool_use_result` field) | per-line `timestamp` | string-present in the binary: `cache_creation_input_tokens` 71 hits, `cache_read_input_tokens` 69, `ephemeral_5m_input_tokens` 15, `is_error` 135, `tool_use_result` 15, `projects`; line layout and slug rule NOT verified offline (I did not read ~/.claude transcripts). Streaming alternative: `claude -p --output-format stream-json` (+`--include-hook-events`) is documented in `--help`; the final result message should carry total usage/cost (field names unverified) |
| codex | `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` | `event_msg` of type `token_count` with `info.total_token_usage` / `last_token_usage` incl. `input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens` | `function_call` / `function_call_output` items, `exec_command_end` events (exit code) | line `timestamp` | string-present in binary: `token_count` 14, `total_token_usage` 8, `last_token_usage` 1, `cached_input_tokens` 16, `reasoning_output_tokens` 15, `rollout-` 28, `exec_command_end` 1, `function_call_output` 17; layout not verified. `codex exec --json` prints events as JSONL on stdout (help verified; usage fields unverified) |
| opencode | local sqlite db (`opencode.db` string-present; `opencode db path` prints it; `OPENCODE_DB` overrides) and CLI `opencode export [sessionID]` (JSON, `--sanitize`), `opencode stats --models --tools` (token usage and cost statistics), `opencode run --format json` | stored per assistant message as tokens {input, output, reasoning, cache {read, write}} and cost (unverified; `cache_read` 22 hits, `time_created` 24 hits string-present) | tool parts with state/status in the export (unverified) | `time_created`/`time` fields | CLI commands verified by `--help`; JSON schema unverified |

Practical reading: prefer the harness's machine-readable stream when running headless (stream-json / `--json` / `--format json`) for exact per-turn usage; for the interactive path read the session file after exit from the isolated HOME. Cost: Claude and Codex files carry tokens, not necessarily money; compute with the catalog prices (`lophn-agent/models/snapshot.json`, see roadmap/eval.md "model 단가") or mark `unknown`. Wall-clock per coding task can be taken without parsing harness files: `open` frame arrival, PTY spawn, first hook, last `Stop`, process exit, all stamped by the driver.

## 4. lophn-side metrics for role agents (all verified)

### 4.1 `modelCallList` / `modelCallRead`
Route `model-calls/list` input `{turn?, session?, cursor?}` and `model-calls/read` (`packages/protocol/lophn-agent/model-calls.ts:119-141`). Actors user/agent/machine/coding_agent. Record schema `modelCallRecordSchema` (`packages/protocol/lophn-agent/model-call-values.ts:174-234`):

- identity: `id (mcl_)`, `turn`, `session`, `model_use` (`judgment|organizing`), `agent_hash`, `purpose` (`judgment|title_summary|conversation_compression`), `attempt_kind` (`initial|retry`), `attempt_order`, `retry_of`.
- `model` (`:152-172`): `provider`, `name`, `protocol`, `credential_revision`, `option_values {requested, applied}` (reasoning effort etc.), `limits {context_limit,input_limit,output_limit,supports_tools}`, `catalog_basis`, `price_basis`, `billing_route` (`api|subscription|extra_usage|unknown`).
- `usage` (`:55-65`): `input, output, cache_read, cache_write, reasoning` (each nullable int, null = unknown), `cache_in_input` (OpenAI adapters true: `providers/adapters/responses.ts:320`, `chat-completions.ts:331`; Anthropic messages false), `reasoning_in_output`, `definition_revision`. Normalize before summing across providers.
- timing: `started_at`, `finished_at`, `duration_ms`, `first_output_ms` (nullable).
- `state` `started|finished`; `outcome` (`:105-131`): `kind` in `complete|partial|failed|cancelled|uncertain`, `code` (only when failed) in `temporary|credential_unavailable|model_unavailable|context_exceeded|invalid_request|unknown|cancelled|refused` (`provider-values.ts:127-136`), `retry_at`, `finish_reason`, `http_status`, `provider_code`.
- `cost` (`:69-90`): `kind` in `reported|estimated|subscription|free|unknown`, `amount` decimal string, `currency`, `basis`, `confirmed_at`. A `started` call has cost `unknown`; a late `supplement` can add usage/cost/outcome (`model-calls.ts:71-82`).

### 4.2 Turn timing
- `turns/list` and `turns/read` (`protocol/lophn-agent/turn-reads.ts:35-55`) return `turnRecordSchema` (`turn-values.ts:99-118`): `started_at`, `finished_at`, `limits {model_attempts,stall_ms,active_ms}` (default 30 / 300000 / 1800000, `:77-81`), `elapsed {active_ms, stall_ms, checkpoint_at}` (monotone checkpoint value; time waiting for a human decision is excluded), `outcome` `{kind: completed|failed|interrupted, reason}`:
  - completed: `answer_completed`
  - failed: `model_error, tool_error, context_limit, model_attempt_limit, stall_limit, active_limit, repeated_tool_failure, effect_unknown, clock_uncertain, configuration_unavailable, target_unavailable, no_answer`
  - interrupted: `user_stopped, restarted, session_ended` (`:13-30`).
- `agent-traces/read` (`traces.ts:117-125`, target `{turn|session|model_call}`) is an existing aggregator that already returns `times {wall_ms, active_ms, model_ms, first_output_ms, tool_ms}` and `activity {model:{attempts,failed[],partial[],cancelled[],uncertain[],unfinished[]}, tools:{steps,succeeded,failed[],denied[],not_executed[],uncertain[],unfinished[],external[]}}` (`traces.ts:41-78`; assembly `packages/core/lophn-agent/observability/model.ts:60-187`). Note `wall_ms` is set equal to `active_ms` (`model.ts:181`), so there is no true wall clock including human waits; `mergeTraces` merges a session (`:196-250`). `agent-usage/read` (`traces.ts:186`) totals tokens/costs for `{from_at, through_at}` with optional turn/session/role/model (`:132-167`, `unknown_calls`, `missing_records`, `complete`). Roadmap/eval.md says it has no consumer yet; verify against a real run.

### 4.3 `toolCallList` and tool accuracy
Route `tool-calls/list` input `{turn|session|model_call (one required), cursor, limit<=100}` (`tool-calls.ts:238-262`). Record `toolCallOutputSchema` (`tool-values.ts:161-215`): `tool`, `effect` (`read|write|external`), `confirm`, `extension` (MCP), `app_api` binding (app, release, command, blueprint_hash, permission_basis... present when the call is an app-api command tool), `input`/`output` hashes, `attempt` (0|1, one retry) with `retry_of`, `retry_at`, `decision` `{decision: allow|ask|deny, reason, effect: read|reversible_write|irreversible, approval, session_grant...}`, `state` `requested|started|finished`, `started_at`, `finished_at`, `duration_ms`, `outcome {kind, code}`.

`outcome.kind` is one of `success | failure | not_executed | uncertain`; the codes that actually occur (verified in code):

| kind | code | where | meaning for accuracy |
|---|---|---|---|
| success | `ok` | `packages/core/lophn-agent/tools/work.ts:149-156` | handler succeeded (handler may still return status failure/uncertain/not_executed: then kind=status, code=status) |
| failure | `not_found` | tool name not in the listed tools (`work.ts:111-118`; `run-loop/tool-batch.ts:257-266`) | hallucinated/unavailable tool name |
| failure | `invalid_input` | args are not a JSON object (`tool-batch.ts:268-277`) or fail the input zod schema (`work.ts:121-128`) or were rewritten by validation (`:130-138`) | schema-invalid call |
| failure | `unavailable` | tool has no handler (`work.ts:140-148`), gate check could not run (`work.ts:175-182`), handler error | infra |
| failure | `conflict` | gate says request changed (`work.ts:206-211`), handler conflict | |
| failure | `forbidden`, `unauthorized`, `internal`, `not_found` | handler error mapped through `FAILURE_CODES` (`work.ts:41-49, 150-160`); summary is a fixed sentence (`work.ts:31-39`) so forbidden and not_found look identical to the model | business failure in a legal call |
| not_executed | `denied` | Gate denied (`work.ts:186-193`) | policy/permission block, `decision.decision=deny` |
| not_executed | `rejected` | human rejected the approval (`work.ts:194-201`) | |
| not_executed | `cancelled` | approval request cancelled (`work.ts:202-209`) | |
| not_executed | `stopped`, `superseded`, `limit_reached`, `configuration_revoked`, `earlier_call_failed` | pre-entry gate (`tool-batch.ts:56-66`, `notExecuted` `:173-181`; MCP `configuration_revoked` `mcp-connections.ts:709`) | not the model's fault: exclude from accuracy denominators |
| uncertain | handler-defined / app `unknown` (`tools/app-tools.ts:158-168`) | effect not known | |

Definable accuracy numbers from these records (plus `activity.tools` of `agent-traces/read`):
- schema accuracy = 1 - (failure with code `invalid_input` + `not_found`) / (calls that reached the batch, i.e. all except pre-entry `not_executed` codes). Caveat: `invalid_input` can also come from the handler, not only the schema; the record cannot separate them (no `executed` flag is stored; `ToolCallOutcome.executed` exists only in memory, `work.ts:58-65`).
- success rate = `success` / total; denied rate = `not_executed` with `decision.deny`; asked rate = `decision.ask`; retry rate = `attempt=1`; repeated failure = turn outcome `repeated_tool_failure`.
- For app-api tools: rows with `app_api != null` give the calendar app-api call success rate.
- Truncation: model outcome `partial` (output cap `MAX_OUTPUT_TOKENS = 4096`, `lophn-agent/models/resolve.ts:41`).
- Agent events `ToolCallEnded.outcome` use a coarser `ok|error|denied|cancelled` (memory only, `protocol/events/agent.ts:99-106`); the ledger events `ToolCallRequested/Decided/Started/Finished/Supplemented` are defined in `protocol/lophn-agent/tool-calls.ts:264-`.

Reading these needs a user token (the test's `core.call`), after the turn, filtered by `session`.

## 5. Ledger timestamps that bound a coding task

| boundary | where it is exposed | exact? |
|---|---|---|
| human message sent / AE turn start | `turns/list` -> `started_at` of the AE turn | yes |
| ticket created | NO ticket-created domain event (roadmap/eval.md: "ticket이 생겼다는 domain event는 없다"; the domain events are the 10 in `protocol/events/domain.ts:116-130`). `tickets/show` (`protocol/coding-agent/ticket/routes.ts:97-124`) returns `state, goal, check, evidence, claim, completion, check_result, verdict, revision` and NO timestamps. Proxy: the AE `ticket_create` tool call `finished_at` in `toolCallList` | indirect |
| hand-off / coding terminal open | Gateway `coding_terminal open` frame arrival time (test-side clock); `calls/read` for call state | test clock |
| claimed | `ticket claim` output `expires_at` (`ticket/claims.ts:24-30`); claim lasts exactly 1 hour (`packages/core/apps/tickets/expiry.ts:6` `CLAIM_DURATION_MS = 3_600_000`), so claimed_at = expires_at - 1h; `tickets/show.claim.expires_at` | derivable |
| release prepare start/end | `release prepare` is a coding-token command; `release status`/`releases/preparation` returns `{status: preparing|completed|cancelled|failed|unknown, bundle_hash, release, test}` with NO timestamps (`protocol/apps/releases.ts:245-262`). Release record (`releases/get_record`, `list_records`) has `created_at` (`releases.ts:179`; `activation.ts:77`), i.e. when the release was finalized. Start must be stamped by the driver (CLI call time) | partial |
| app test start/end | `app test status` -> `request {accepted, preparation_failed, start_attempted_at, started_at, start_unknown, result_ref, reason}` (`protocol/problems/tests.ts:240-262`); `get-verification` / `app test result` return execution evidence with `started_at`, `ended_at`, `end_reason`, `exit_code`, `memory_limit_mode` (`tests.ts:122-150`) | yes |
| report | domain event `TicketCompletionReported` (subject tkt, payload app/release/session) via `events/list` with `at` (`protocol/events/events.ts:44-70`, `domain.ts:59-70`); `tickets/show.completion` | yes |
| AE verification | domain event `TicketVerified` (`domain.ts:105-108`) with `at`; `tickets/show.verdict` | yes |
| activation | `ApprovalDecided` (kind `activation`, with `applied` result) event `at`; release record `activation.started_at`, `activated_at`, `status` `activating|active|failed|...`, `failure` (`activation.ts:57-81`); failure event `ReleaseActivationFailed` | yes |
| coding session exit | only the driver's `codingTerminalExited` call time (memory event `SessionEnded` is not stored) | test clock |
| app-api calls after activation | tool calls with `app_api` binding in the role's `toolCallList` (started_at/finished_at/duration_ms); `apps/invocations` records (fields not inspected) | yes |

`events/list` = `{after_seq, types?, subjects?, limit}` returning `events[{seq,type,subject,actor,turn,payload,at}]` (actors include user and coding_agent). Per-command timestamps of what the coding agent runs (claim, prepare, test, report) are not stored; the wrapper from 1.6 can log start/end per `lophn` invocation as a cheap, product-neutral substitute.

## 6. Time and cost reality

- No measured E2E timings exist in the docs. `architecture/testing.md:17`: whole `deno task e2e` must stay under 10 minutes ("전체가 10분 안에 끝나야 한다"); app E2E files: `tests/e2e/app-*_test.ts` = 6 files, 1,527 lines total (`app-activation` 398, `app-call` 325, `app-data-rewind` 282, `app-restart` 263, `app-release` 162, `app-sandbox` 97). I did not run them (the deps cache is missing and the run would write under `.dev-data`).
- Timeouts that bound each step in code (worst-case envelopes): `deliverRelease` waits up to 300 s for release prepare and 300 s for the app test result (`tests/support/app/activate.ts:368, 404`); default `until`/`waitTurnEnd` wait is 30 s (`tests/support/core/human.ts:23`); `packages/core/apps/releases/prepare/from-source.ts:47` `STEP_LIMIT_MS = 120_000` per blueprint evaluation / UI build step; app test frozen timeout 240 s (`packages/core/problems/tests/app-test/frozen.ts:16`), app-test job 720 s (`.../control.ts:65`); activation drain grace 30 s (`packages/core/apps/releases/activation/orchestrator.ts:23`); claim 1 h; turn `active_ms` 30 min.
- Release prepare needs `deno task e2e:deps` (`tests/support/coding/prepare-deps.ts`): it is the ONLY network step; it runs a real template release prepare once into `.dev-data/e2e/deno-dir` to cache npm/jsr/esbuild; the app E2E core then runs with that `DENO_DIR` and only loopback network (`tests/support/coding/deps.ts`, `testing.md:60-62`). `appCoreEnv()` throws if the dir is empty or `XDG_RUNTIME_DIR` is unset. A real-network eval root can use a normal DENO_DIR but then fetches happen inside prepare (adds time and flakiness). A calendar app written by a real agent may import packages the template cache does not contain, so a cached-only offline prepare can fail: unverified; keep network on or widen the cache.
- App test uses `systemd-run --user --scope` for a memory limit (`packages/core/problems/tests/work/spawn.ts`, `supervision/security/memory-limit.ts`); needs user systemd: here `systemctl --user is-system-running` = `degraded` and `XDG_RUNTIME_DIR` exists; `memory_limit_mode` is recorded in the verification evidence, so a degraded environment may run without the cap or fail (unverified which).
- Real harness cost model: a calendar-MVP build by an agent is on the order of tens of tool calls and minutes of wall time per attempt; the budget guard must live in the harness flags (`claude -p --max-budget-usd`, `--effort`, `--model`; codex `-m`; opencode `--variant`) or in the eval driver (kill after N minutes), because lophn has no visibility into the harness model calls and `tests/live/budget.ts` counts only test-side fetches.

## Options to run a real coding agent in eval

### Option A. Interactive harness in a PTY driven by the test (closest to product)
- What: a `tests/support/harness/` driver replaces `answerTerminal` + `codingCli` + `exitTerminal`: spawns `plan.executable` with `plan.argv.slice(1)` in a node-pty obtained by `createRequire` from `packages/shell/main/node_modules` (works under Deno, verified), env = plan.env + isolated HOME + PATH with a `lophn` wrapper + `LOPHN_DAEMON_URL`; implements `input` (bracketed paste) and `stop`; calls `codingTerminalExited` on PTY exit; ends the process when `TicketCompletionReported` appears.
- Changes vs product path: shell-main's human prompt (harness install dialog) replaced by a scripted `lophn harness install` into the isolated HOME; permission mode pre-set in the isolated config; env scrubbing replaced by an explicit allow-list including the model key; only the Electron/terminal-host layer is replaced (its own tests cover that layer).
- Isolation: `HOME=<run>/harness-home` per trial (+ `CODEX_HOME` for codex); keys only from the runner's env; never reads/writes ~/.claude, ~/.codex, ~/.lophn.
- Metrics: coding agent: session file in the isolated HOME after exit (claude `projects/*/*.jsonl`, codex `sessions/**/rollout-*.jsonl`, opencode `opencode export`/db), plus driver stamps (open, spawn, first hook, report, exit); role agents: `modelCallList`, `toolCallList`, `agent-traces/read`, `turns/list`.
- Effort: largest. About one module for the PTY driver (~150-250 lines), one wrapper script, one config seeder per harness (claude first), a metric parser per harness; plus resolving first-run dialogs (unverified) and the deps cache. Fragile points: TUI dialogs, `Stop` hook firing, process never exiting.

### Option B. Headless one-shot (`claude -p`, `codex exec`, `opencode run`) spawned by the test with plan.cwd/env
- What: same driver contract but spawn with non-interactive flags and plain pipes, no PTY. Take `plan.argv` and insert `-p` / `exec` / `run`. Process exit is the session end; the driver then calls `exited`. Use `--output-format stream-json` / `--json` / `--format json` for exact usage and tool results.
- Changes vs product path: TUI, input frames, permission prompts, paste, trust dialog all gone; argv differs; if the agent exits without `ticket report` the session ends `unreported` and the call fails (product-correct); hook state machine may not run the same (unverified, not needed for the scenario). AE-to-coding-agent follow-up messages impossible.
- Isolation: same HOME/CODEX_HOME recipe; `--no-session-persistence`/`--ephemeral` avoid files; bypass permissions via settings or flags.
- Metrics: best of all options: structured stdout with per-turn usage/cost (claude result message, codex JSONL `token_count`, opencode json events) captured directly by the driver; no transcript path guessing.
- Effort: smallest to get green (~80-120 lines driver + wrapper). Biggest fidelity loss; good for "can a role agent plan + a real coding agent build + the lophn pipeline accept it".

### Option C. Hybrid: headless for long scenarios, one interactive smoke case, CLI-playing agent elsewhere
- What: B for the long scenarios (calendar MVP, app-api follow-up, maintenance feature) because of cost, retries and parseable metrics; one small A case to cover the PTY/hook/input path. Keep the existing CLI-playing `deliverRelease` for scenarios that test only the role agent (no second model), so the quality of the AE/PM is isolated (matches the recommendation in `scratchpad/research/infra.md:131`).
- Changes vs product path: as B for long scenarios; as A for the smoke case.
- Isolation, metrics: as in A and B.
- Effort: B plus about half of A; value: stable numbers where they matter, one cheap test that the interactive plumbing still works.

## Gaps (not verifiable offline, or missing in the repo)

1. First-run behavior of the real harnesses in an isolated HOME: onboarding/theme, folder trust, API-key approval, bypass-permission confirmation. Exact config keys to pre-seed are not verified (names `hasCompletedOnboarding`, `hasTrustDialogAccepted`, `customApiKeyResponses`, `skipDangerousModePermissionPrompt` exist in the claude binary; shapes unknown). Needs one real manual run to record.
2. Exact JSONL/JSON layouts for usage, cache and tool errors for claude/codex/opencode; field names above come from binary string presence, not from reading a transcript. `claude -p --output-format json|stream-json`, `codex exec --json`, `opencode run --format json` outputs must be sampled once (small prompt) to freeze the parser.
3. Whether hooks fire in headless modes and whether `HOME` alone (no `CLAUDE_CONFIG_DIR`) redirects claude's whole config including `.claude.json`.
4. Cost conversion for harness usage: only tokens are in harness files; prices come from lophn's catalog snapshot; subscription/OAuth runs have no price.
5. No `ticket created` / `release prepare start-end` / per-CLI-command timestamps in the ledger; hook-derived coding agent events are memory-only. The driver must stamp them itself or the product must add records (a product change, outside this research).
6. `wall_ms` in `agent-traces/read` equals `active_ms` (excludes human-wait time), so true elapsed time per AE turn = `finished_at - started_at` from `turns/list`.
7. Tool accuracy cannot tell schema-invalid input from handler-level `invalid_input` (the stored outcome has no `executed` flag). If that split matters the aggregator needs a field, or the eval reads `tool_call_output` bodies via `turns/body-view`.
8. No `lophn` binary or wrapper in dev; hook command and the agent's `lophn ...` calls need a wrapper script (and the daemon address, since `plan.env` has none).
9. Deps cache `.dev-data/e2e/deno-dir` is absent here; an agent-written calendar app may need packages beyond the cached template deps, so offline prepare may fail.
10. Real E2E timings were not measured (no existing numbers; running requires the cache and writes under `.dev-data`). `systemctl --user` is `degraded` here; the effect on `systemd-run --scope` for app test is unknown.
11. Model credentials for the coding agent: the product strips `*API_KEY*` env; using an API key in the eval is a deliberate deviation (document it). No `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` exists in this machine's shell, so a key must be supplied by the human (AGENTS.md: ask before real provider calls).
12. Gemini, pi, hermes, openclaw are not installed here; only claude, codex, opencode can be exercised. hermes/openclaw cannot be launched by product design (`prompt:null`).
13. `paste_after_hook` has no real user today, so it needs no eval support.
14. node-pty-from-Deno works only because `packages/shell/main/node_modules/node-pty/build/Release/pty.node` is built in this checkout; fresh clones/worktrees need `npm install` in `packages/shell/main` (or use `script`/tmux).

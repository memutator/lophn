# Read side of app diagnosis: what exists today

Scope: facts only, read at `/home/pyosechang/projects/lophn-worktrees/app-call-input` (branch `docs/call-record-roadmap`, HEAD `4148bf373`). Every row has a `path:line` I opened. Nothing was run; no `~/.lophn` was touched. "Doc says" is marked where I compared to `project-docs/architecture/app-call.md` or `observability.md`.

Abbreviations: `CLI` = `packages/cli/commands`, `P` = `packages/protocol`, `C` = `packages/core`, `S` = `packages/shell`.

---

## A. Agent-facing diagnosis reads

### A.0 How an agent reaches a read

- The model sees ONE tool named `lophn` with input `{args: string[]}` (`C/lophn-agent/tools/lophn/tool.ts:35-41`, schema at `:58-63`). The loop resolves `lophn app logs ...` to the command's own tool definition before recording, Gate and retry (`C/lophn-agent/tools/dispatch.ts:7-13`, called at `C/lophn-agent/run-loop/tool-batch.ts:207` and `prepare.ts:665`). The command table in `CLI/` is shared by the binary and the agent (`CLI/commands/types.ts:1-4`).
- Which commands a workspace kind can call: `workspaces:` on each command. Home and app workspaces get `app.status|logs|invocations|event_publications` (`CLI/commands/app.ts:212,325,352,374`); project workspaces do not.
- The credential's reachable routes = routes named by that workspace kind's commands + `WORKSPACE_READS` (`C/agent-workspaces/credentials.ts:30-43,57-84`). For an app workspace the credential carries condition `app=<that app>`; other apps' rows are "the same answer as not existing" (`credentials.ts:96-124`, comment at `:96-104`; per-row scope check for invocations at `C/apps/invocations/reads.ts:20-39`). Home has no `app` condition.
- File tools (`file.read`, `file.grep`) can read only the scope folders: app source, shared folders, skills, artifacts (`C/agent-workspaces/workspace/workspace-folders.ts:34-67`). The app log folder `<data>/apps/<app>/logs` is not in that list. `shell.run` read scope was not checked (see "Not verified").

### A.1 The reads

| # | Read (command name) | Defined | Actors / workspaces | Input filters | Output fields | Limits |
|---|---|---|---|---|---|---|
| 1 | `app.status` (CLI `lophn app status <app>`) | CLI `CLI/commands/app.ts:203-227`; route `app.runtime` `P/apps/runtime.ts:196-215`; core handler `C/apps/runtime/reads.ts:42-72` + overlay with live supervisor memory `reads.ts:121-146`, wired `C/apps/control.ts:803-808` | route actors user, agent, app, machine (`runtime.ts:212`); command workspaces home, app | `app` only | `{app, state:{state: preparing\|stopped\|running\|unavailable, termination_pending, reason?:{code,summary}}, observation: {app, release, mode, process_nonce, endpoint, ready, accepting, reason?} \| null, observed_at}` (`runtime.ts:17-47`; `readBody` strips `as_of_seq`, `next_cursor`, `omitted`, `CLI/commands/app.ts:38-53`). Summary line: `app <id> is <state> (<code>: <summary>)` (`app.ts:215-226`) | Current supervisor memory only: no history, no last-exit time (`P/apps/runtime.ts:49-52` "현재 supervisor 연결의 메모리 값"; `model.ts:44-70`). Reason codes I saw in code: `no_observation`, `terminating` (`C/apps/runtime/model.ts:11-20`), `crash_loop`, `start_failed`, `unexpected_exit` (`C/apps/runtime/supervisor/supervisor.ts:167,387,441,454,498,648`), `starting` (`CLI/commands/preview.ts:19`) |
| 2 | `app.logs` (`lophn app logs <app>`) | CLI `app.ts:316-339`; route `P/apps/runtime.ts:216-225`, input/output `P/apps/app-log.ts:43-61`; core handler is an empty placeholder (`C/apps/runtime/reads.ts:73-92`) replaced by `withAppLogFile` (`reads.ts:149-205`, wired `C/apps/control.ts:809-823`) | actors user, agent, app (`runtime.ts:186,223`); workspaces home, app | `app` (required), `invocation`, `since` (inclusive), `until` (exclusive), `limit` 1..1000 default 200 (`app-log.ts:43-50`, `:32-33`) | `{lines:[{at, invocation\|null, text}], truncated}` oldest first; `text` max 300 chars (`app-log.ts:31,35-39,53-58`) | Reads `app.log.1` then `app.log` fully (`control.ts:814-819`), keeps the newest `limit` matching lines (`reads.ts:192`), re-redacts each line and fails the whole read with `unavailable` if one cannot be made safe (`reads.ts:192-203`). Matches by string compare on `at` (`reads.ts:186-187`). No filter by text, by line kind, or by operation |
| 3 | `app.invocations` (`lophn app invocations <app>`) | CLI `app.ts:341-362`; route `P/apps/calls/invocation.ts:100-137`; core `C/apps/invocations/reads.ts:47-82`; store `C/apps/invocations/store.ts:26-66` | route actors user, agent, machine (not app) (`invocation.ts:97`); workspaces home, app | `app`, `session`, `turn`, `effect`, `status` (running\|succeeded\|failed\|denied\|unknown), `reverted`, `mode`, `release`, `limit` 1..200 (`invocation.ts:104-117`). CLI drops `cursor` and requires `app` (`app.ts:347-350`). No time filter, no operation-name filter, no caller-kind filter (store.ts:33-47 is the full list of WHERE columns) | rows of `appInvocationSchema`: `id, app, release, mode, operation:{kind: operation\|command\|start\|data_change, name\|reason\|from,to}, caller (6 kinds or null), effect, status, started_at, finished_at, input_hash, summary, detail_hash, changeset?{hash,size_bytes}, reverted_by` (`invocation.ts:60-84`) | newest first (`store.ts:54`); page 50 default (`reads.ts:14`), max 200; CLI shows only the first page and says "more exist; narrow the filter" (`app.ts:55-60,356-361`). `summary` for a failed row is `{outcome:"failed", error_code}` plus optional `changeset_dropped` (`C/apps/calls/record.ts:36-55`); the error message is not stored. `detail_hash` is `null` in every writer (grep below) |
| 4 | `app.event_publications` (`lophn app event-publications <app>`) | CLI `app.ts:365-385`; handler `C/apps/events/reads.ts` | home, app | `app`, `event`, `limit` | publications with `trace_id`, reachable/unreachable/refused counts (CLI description `app.ts:368-370`) | only the most recent 200 per app are kept (description `app.ts:370`) |
| 5 | `app.read` (`lophn app read [app]`) | `CLI/commands/app.ts:62-91` | all workspace kinds | `app` | app record: name, description, status, active release, source folder (description `app.ts:66-67`) | No diagnostics beyond `active_release` and `status` |
| 6 | `release.list`, `release.get` | `CLI/commands/release.ts:19-58,60-82` | all workspace kinds | `app` / `release` | "the failure when activation failed" (`release.ts:22-23`); last activation and failure with its reason (`release.ts:63-65`) | release-time failures only |
| 7 | `declaration.check` | `CLI/commands/app.ts:179-201` | all kinds | `app` | `{errors, warnings, permission_review}` | static check of the source declaration |
| 8 | `app.sdk_status` | `CLI/commands/app.ts:252-271` | home, app | `app?` | SDK pins vs current, level, note files | version drift only |
| 9 | `browser.logs <tab>` | `CLI/commands/browser.ts:206-224`; route `browserLogs` `P/lophn-agent/host-queue.ts:534` | all kinds | `tab` | "console lines and page errors of a tab you opened since the shell attached to it (the last 200 lines)"; text is wrapped as untrusted (`browser.ts:211-222`) | tab you opened; phone tab has none; this is the preview/browser tab, not the person's live screen |
| 10 | `release.prepare` / `release.activate` results (not reads, but they carry diagnosis) | `CLI/commands/release.ts:84-117,119-145`; `P/apps/releases.ts:96-119` | app | - | prepare failure `{status:"failed", stage: build\|dependencies\|migration\|handlers\|release, reason}`; activate failure `{failure:{code,summary,restored}}` | The only existing output with a `stage` field; the comment states why it is an output and not an error: "오류 code는 model에 고정 글만 닿아 떨어진 이유가 가려진다" (`releases.ts:95`) |

Probe (not a read): `preview.call` (`CLI/commands/preview.ts:152-210`, workspace app only). Its description says "Nothing is recorded and live data is never touched" (`preview.ts:157-159`). Its result is `{outcome}` with summary `preview call of <name> <status> (<denial.code|error.code>)` (`preview.ts:195-209`). The service path for preview does not touch the ledger (`C/apps/calls/service.ts:343-346`, `:347-372`).

Routes that exist but have no agent command (grep: `grep -rn "appInvocation\b\|appUsage\b" packages/cli packages/core/agent-workspaces` returns only `credentials.ts:16,38` and `workspace-data.ts:9,231`):

| Route | Where | Who can call |
|---|---|---|
| `app.invocation` (single row by id) | `P/apps/calls/invocation.ts:139-149`; core `C/apps/invocations/reads.ts:84-103` | actors user, agent, machine by route, but no `lophn` command uses it and it is not in `WORKSPACE_READS`; shell renderer and phone allowlist reach it (`P/remote/allowlist.ts:237-238`) |
| `app.usage` | `P/apps/usage.ts:26-37`; core `C/apps/usage/reads.ts:9-55` | In `WORKSPACE_READS` (`credentials.ts:38`) so the runtime can build home workspace memory (`workspace-data.ts:231`); core answers `forbidden` for non-home agent sessions (`usage/reads.ts:15-22`). It lists which other apps/projects' agents call this app's commands. It is not a diagnosis of failures |
| `diagnostics/list`, `diagnostics/status` | see C | not in any agent credential list (grep: `ListDiagnostics`/`diagnosticsList` appear only in `P/diagnostics`, `C/diagnostics`, `C/main/daemon/wiring/diagnostics.ts`) |

### A.2 Exactly what text the model receives

Chain for a `lophn app logs` / `app invocations` / `app status` call:

1. Command `run` returns `{summary, content, arrayKeys}`; e.g. logs: `"<n> lines"` or `"<n> lines (older lines exist; narrow with since, until or invocation)"` (`CLI/commands/app.ts:330-338`); invocations: `"<n> invocations"` or `"<n> invocations (more exist; narrow the filter)"` (`app.ts:55-60,356-361`); status: `app <id> is <state> (<code>: <summary>)` (`app.ts:215-226`).
2. `toolResultOf` wraps it as a success `ToolResult` with `complete: true`, `source: null`, `continuation: null`, `pending: []` (`C/lophn-agent/tools/lophn/command-tool.ts:33-51`).
3. Over 24 KiB of JSON (`C/lophn-agent/tools/result.ts:6`): `spillLarge` writes the full JSON to `<dataRoot>/tool-results/<session>/<tool_call>.json` and gives the model a preview with `complete:false` and the pending sentence "The full result (N bytes) is in <path>. Read parts with file.read (offset, limit) or search it with file.grep." (`C/lophn-agent/tools/spill.ts:57-90`; path from `P/lophn-agent/tool-results.ts:1-15`). The preview drops array items from the END of the array, quarter at a time (`C/lophn-agent/tools/result.ts:107-145`, `:139-140`). For `app.logs` the array is oldest-first (`P/apps/app-log.ts:52` comment), so the dropped tail is the NEWEST lines; for `app.invocations` it is newest-first, so the dropped tail is the oldest rows. Record: `content.omitted = {lines: n}` (`result.ts:143`).
4. History text for the next model call is exactly this JSON string: `{"status","code","summary","content","complete","source","continuation","pending"}` (`C/lophn-agent/run-loop/history.ts:25-35`). Older tool results are replaced by a fixed sentence once context is tight, the two newest batches are kept (`history.ts:50-61`).

Failure path (a read that returns `err`): `executeToolCall` maps the error code to a fixed sentence and drops the original message: `invalid_input: "tool input is not valid"`, `unauthorized: "tool call is not authorized"`, `forbidden` and `not_found`: `"tool target is not available"`, `conflict: "tool call conflicted"`, `unavailable: "tool is unavailable"`, `internal: "tool call failed"` (`C/lophn-agent/tools/work.ts:40-48`). The handler's message is appended only for `invalid_input`, for tools in `INPUT_SCOPED_FAILURES` (`skill.read`, `agent.card`, `ask.secret`, `work.ts:64-70`), and for `browser.*`/`tab.*` `unavailable|conflict` and `browser.*` `not_found` (`work.ts:54-60`) (`work.ts:166-176`). `details.missing` secret slots add a fixed sentence (`work.ts:177-185`). `app.status`, `app.logs`, `app.invocations`, `preview.*` are not in any of those lists, so a core `forbidden`/`not_found`/`unavailable` from them reaches the model as the fixed sentence only. The error `hint` and `trace_id` are not read on this path: `agentCall`'s core client keeps only `code`, `message`, `details` from the error body (`C/main/agent-runtime/core-http.ts:44-62`).

Static text the model sees about the reads (command `description`): logs `"Read app output, reported problems, exceptions, screen errors and process exits; newest lines last. Filter by invocation, since (inclusive), until (exclusive) and limit."` (`CLI/commands/app.ts:319-321`); invocations `"List an app's calls (operations and commands) with their caller, effect, status and times, newest first. Successful reads are not recorded; failed reads, writes and denied calls are. Filter by status, effect, release, mode, session or turn."` (`app.ts:344-346`); status `"Read whether an app is running: its state (and the reason when it is unavailable) and the latest supervisor observation."` (`app.ts:206-208`). The invocations description says denied calls are recorded; the code does not record all denials (A.3). The logs description does not mention the 300-char cut.

### A.3 Calls that leave no invocation row (these are what a read of `app.invocations` cannot show)

From `C/apps/calls/service.ts`:

| Outcome | Returned to caller | Row? | Line |
|---|---|---|---|
| successful read | `{invocation:null, outcome:succeeded}` | no (by design) | `:487-490` |
| preview call (any result) | `{invocation:null, ...}` | no | `:343-372` |
| `not_declared` (live) | `denied`, `invocation:null` | no | `:288`, `:291` |
| `not_declared`, `app_unavailable` (preview) | denied, null | no | `:359`, `:369` |
| archived app (human view) | `denied(app_archived)`, null | no | `:272-276` |
| archived app (agent) | `err not_found` | no | `:272-275` |
| call body too large (live/preview) | `err invalid_input "call body exceeds the size limit"` | no | `:324-325`, `:331-345`, `:367-368` |
| caller verification failure, credential mismatch | `err forbidden|...` | no | `:241-262` |
| `gate_blocked` (operation by non-person), `call_loop`, `call_too_deep`, post-lookup `app_unavailable` | `denied` with id | yes (`recordDenied`) | `:314`, `:322`, `:402`, `:419`, `:457` |
| failed read, unknown read | row via `settleRead` / `closeUnknown` | yes | `:538-550`, `:510-533` |
| write/external start..finish | row begun before send | yes | `:445-476` |

### A.4 The `lophn` binary (person's terminal, coding-agent harness)

Output is `renderLines(content)` (or `--json`), failures print `code: message` and `details` only: no `hint`, no `trace_id` (`CLI/main.ts:286`, `packages/cli/output.ts:72-96,114-134`). Exit codes: success 0, internal 1, invalid_input 2, unauthorized/forbidden 3, failed 4, unavailable 5, effect_unknown 6 (`output.ts:10-18,24-41`). `details.diagnosis === "effect_unknown"` is the one existing `details` convention read by the CLI (`output.ts:21`; set at `packages/cli/connection/client/core.ts:46`).

---

## B. App log

### B.1 Storage and numbers (all confirmed in code)

| Fact | Value | Where |
|---|---|---|
| Files | `<data root>/apps/<app>/logs/app.log`, `app.log.1` | `P/apps/app-storage.ts:24-34` |
| Rotation | before appending a line that would take `app.log` over 8 MiB, rename `app.log` to `app.log.1` (previous `.1` overwritten), size reset | `P/apps/app-log.ts:30` (`APP_LOG_FILE_MAX_BYTES = 8*1024*1024`); `C/apps/runtime/observations/log-file.ts:60-65` |
| Cut | `redact(raw).slice(0, 300)`: redaction first, then 300 UTF-16 code units, no ellipsis or marker appended | `log-file.ts:46`; `P/apps/app-log.ts:31` |
| Per-line input cap | a stdout/stderr line over 16 KiB before redaction is dropped entirely (no log line, no marker) | `C/apps/runtime/observations/stream-decoder.ts:6,26,48-54`; `log-file.ts:79-82` (`onDropped() {}`) |
| Line JSON | `{at, invocation: inv_...|null, text}` | `log-file.ts:47`; `P/apps/app-log.ts:35-39` |
| Write failure | swallowed; next line retries | `log-file.ts:49-71` |
| Writer | only the app supervisor process (`createAppLogFile`), `logFileOf(app)` | `C/main/app-supervisor/assembly.ts:509-521` |
| Invocation mark | stdout/stderr head `[inv=inv_<25 chars>] ` is stripped into `invocation`; a non-id head stays in `text` | `log-file.ts:22,74-84` |
| Read | up to 1000 lines, default 200; two files; see A.1 row 2 | `P/apps/app-log.ts:32-33` |
| Preview children | not written (supervisor `attach` is for the live child; the doc says preview output and errors are not logged) | `app-call.md:216` (doc); `C/apps/runtime/view-errors.ts:35-36` for preview screen errors |

### B.2 Line kinds (exact text format) and invocation id presence

| # | Kind | Text format | Who writes (path:line) | `invocation` column |
|---|---|---|---|---|
| 1 | raw stdout / stderr line | the line as printed, redacted, cut to 300. Multi-line output becomes one log line per output line (a stack trace is N lines) | child stdout and stderr both piped through `file.attach` (`C/main/app-supervisor/assembly.ts:748-752`; `log-file.ts:74-84`) | `inv_...` only if the line began with `[inv=<id>] `; plain `console.log` in a handler has none (nothing adds the mark except the SDK, `packages/sdk/cap-problem/report-port.ts:31`) |
| 2 | `reportProblem` | `error <name>[: <message>][ <details JSON>]` (newlines to spaces); printed to stderr with `[inv=<id>] ` head when inside an invocation context | `packages/sdk/cap-problem/report-port.ts:20-33`; contract `P/apps/app-log.ts:14-16` (this is mechanically kind 1) | yes, when called inside a handler; null otherwise |
| 3 | uncaught exception / handler-thrown `Error` | head `exception <name>[: <message>]` | `C/apps/permissions/broker/problems.ts:29-39`; sources: handler non-rejection `Error` (`C/apps/runtime/entrypoint/invoke.ts:190-198` with `main.ts:93-`), a skipped synced change (`entrypoint/control-server.ts:155-165`: `exception Error: a synced change was skipped: ...`), process-level uncaught exception/rejection observer (`entrypoint/crash.ts:5-22` also writes the raw text to stderr, which becomes kind 1 lines with null invocation) | `invocation.id` from the observation, else null (`problems.ts:27`) |
| 4 | stack frame | `  at <bundle-relative path>:<line>:<column>` (two leading spaces), one line per frame, resolved through the sealed bundle's source map | `problems.ts:40-46` | same as its exception head |
| 5 | screen error (page) | `view_error <error\|unhandledrejection\|render_error> <name>[: <message>]` | page -> shell main `S/main/app-frame/view-error.ts:94-106` -> core `app.log_view_error` (`P/apps/app-log.ts:62-85`, actor user only) -> `viewErrorText` (`C/apps/runtime/view-errors.ts:12-18`) -> supervisor op `apps.append_log` (`assembly.ts:968-973`) | always null (`assembly.ts:971`; `view-errors.ts:38`) |
| 6 | rejected screen call | `view_error call_rejected <operation>: <code>: <message>[ (<detail>)]` where detail is `view lost: <why>`, `declaration: <code>`, or `call path: <code>`; core writes it for live views only, once per (operation, message) per view binding, at most 32 per binding (`C/apps/views/call.ts:150-196`, constants `:150-153`). Shell main writes it, without detail, when it rejected the call before reaching core: `invalid_input` only (`S/main/app-frame/app-call.ts:52-56,62,77`; `view-error.ts:108-123`), under the 20 per 60 s per view window (`view-error.ts:12-13,77-91`) | core `C/apps/views/call.ts:177-196` via `ports.log` -> `appLogWriter` (`view-errors.ts:20-28`); shell main as above | always null |
| 7 | process exit | `process_exit <unexpected_exit\|v8_oom\|start_failed\|ready_timeout\|crash_loop>: <message>`; messages: `the app process exited with code N`, `the app process was terminated by a signal`, `the app process ran out of V8 heap`, `<start-failure summary>`, `automatic restart stopped after N unexpected exits`; intended stops write nothing | `C/apps/runtime/observations/crash.ts:5-62`; `assembly.ts:800-826` | always null |

So: 7 distinct text formats (5 sources in the doc's terms: stdout/stderr incl. `error`; uncaught exception incl. frames; screen errors incl. `call_rejected`; process exit). Kinds 5, 6, 7 are written by lophn components and never carry an invocation id; only kinds written from inside the app process can.

Writers of `app.log` lines, by call (grep: `grep -n "append(" C/main/app-supervisor/assembly.ts`): `assembly.ts:500` (exception service), `:821` (crash lines), `:971` (`apps.append_log` op used by view-errors).

What does not reach the log: preview process output and errors, preview screen errors (`view-errors.ts:35-36` returns `written:false`), core-side `invalid_input` from `callView` before `rejected()` runs (`C/apps/views/call.ts:204-207` returns `err` for an invalid `checkCall`; shell main normally catches that case first), shell-main outcomes `not_found` -> resume and any other core error -> `fail("unavailable","app is not available")` (`S/main/app-frame/app-call.ts:62,77-79`: only `invalid_input` is passed to `deps.rejected`), and the issue file states core down / re-binding `unavailable` is deliberately not written (`project-docs/issues/view-call-rejection-unrecorded.yaml`, `closed:`).

---

## C. Core and shell logs, ids

### C.1 Files

| File | Writer | Contents | Who can read it | Shown in UI? |
|---|---|---|---|---|
| `<data root>/logs/core-{0..4}.jsonl` | core logger file writer (10 MiB x 5) | log records `{timestamp, level, service_name, trace_id?, span_id?, component, event, message?, fields?}`; info and above always; debug and span lines only when setting `diagnostics.trace` is on (doc: `observability.md` "log file", "trace 설정"; I did not re-verify the default) | local file reader only; no route reads it (`C/diagnostics/list.ts:59-61` regex `^platform-\d+\.jsonl$` excludes it) | no |
| `<data root>/logs/platform-{N}.jsonl` | `createSafeLog` from fixed `Diagnostic` kinds (`C/diagnostics/log.ts:12-100`) | `DiagnosticRecord {at, component, kind: log\|crash\|health, code, error_type, location, message, redaction}` (`P/diagnostics/diagnostics.ts:12-25`). Producers (grep `diagnosticsWrite`): core daemon crash (`C/main/daemon/wiring/diagnostics.ts:63,110`), app-supervisor child `lophn_internal` (`C/main/daemon/wiring/apps.ts:976-985`), agent-runtime child (`wiring/lophn-agent-runtime.ts:279-285`), shell main crash (`C/main/daemon/diagnostics.ts:62-72`). The message is a fixed sentence per kind (`log.ts:20-25`); `error_type` is one of `internal_exception`, `disk_full`, `ledger_corruption` (`P/supervision/supervision.ts:339-343`); `location` is a registered id (`daemon-crash`, `agent-runtime-crash`, `agent-runtime-turn-start`, `app-supervisor-crash`, `shell-main-crash`, `C/diagnostics/crash.ts:5-11`). Kinds: `lophn_internal`, `unattributed_observation`, `shell_view_lifetime`, `app_invocation_delivery_loss` (`supervision.ts:329-333`); the last has a schema and a description but no emitter (grep `app_invocation_delivery_loss` in `packages` finds only `supervision.ts:329,383` and `C/diagnostics/log.ts:24`) | route `diagnostics/list` (`P/diagnostics/diagnostics.ts:32-47`): actors all four, max 200 newest, filter `component`, `kind` (`C/diagnostics/list.ts:18-48`). No CLI command, no agent tool, no renderer caller (grep in `S/`, `CLI/` finds none) | no |
| `<data root>/logs/shell-view.jsonl` | core, on shell main's `shell_view_lifetime` diagnostic (`C/main/daemon/diagnostics.ts:19-34,36-58`) | `{at, component, kind:"diagnostic", code:"shell_view_lifetime", view_id, generation, created, hidden, replaced, disposed, attached}` | file only | no |
| shell main log | `console.log("[lophn] <msg>")` to the Electron process stdout (`S/main/desktop/wiring/context.ts:190`); no file writer in `S/main` except the terminal trace (`S/main/terminal/trace-file.ts`; grep `appendFile\|createWriteStream` in `S/main`) | e.g. `view <id> generation=<n> view-error <observation> app=<app> mode=<mode>[ unsent]` (`S/main/app-frame/view-error.ts:143-147`); `... view-error dropped reason=invalid` (`:101`) | stdout of the Electron process | no |
| `<data root>/logs/terminal-trace.jsonl` | shell main, only with trace on | terminal events | file | no |

What `core-*.jsonl` holds for an app call: core has no logger call in the app call path (`grep -n "logger\." -r C/apps C/main/app-supervisor C/server` shows only `registration/source-folder.ts:202`, `server.ts:146,197,239,449`, `host-link.ts:97`, `identity/registry.ts:364`: none in `calls/` or `views/`). With trace on, every API request ends a debug span line named `<METHOD> /<resource>/<method>` with attributes `http.request.method`, `http.route`, `http.response.status_code` (`C/server/server.ts:165-179`); an app call therefore appears as `POST /apps/call_tool`, `POST /app_views/call`, etc. (`routePath` is `/${resource}/${method}`, `P/base/route.ts:238-240`). Writer/reader commands add child spans `ledger.command` with `lophn.command=<command name>` and `ledger.read` with `lophn.read=<resource/method>` (`C/main/daemon/core.ts:313-333`). No span or log line in this path carries an app id, operation/command name, invocation id, caller kind or outcome; the only handler-error log is `api handler_threw` with exception kind and first frame (`server.ts:146-150`, `describeThrown`). `app.call_tool` and `app_views.call` are memory routes (not ledger commands), so they have no `ledger.*` child span (`P/apps/calls/call.ts:81-92`, `P/apps/views.ts:95-103`; the spans are only on `runtime.writer.command` and `runtime.readers.read`, `core.ts:313-333`).

Agent-runtime spans (`agent.turn` > `agent.model_call`, `agent.tool_call`; attributes in `C/lophn-agent/run-loop/spans.ts:7-125`): `agent.tool_call` carries `lophn.session`, `lophn.turn`, `lophn.model_call`, `lophn.tool` (resolved command definition name or `unknown`), `lophn.tool_attempt`, and at end `lophn.tool_call`, `lophn.outcome`, `lophn.code` (`spans.ts:84-110`; started at `core-ports.ts:640-662`). The agent caller stored in an invocation row holds the same `{session, turn, tool_call}` (`P/apps/calls/caller.ts:32-37`), so an agent-called invocation and its `agent.tool_call` span share ids by value, but only when trace is on, and only inside the agent-runtime's own trace.

### C.2 Trace ids: where they exist and where they stop

grep commands: `grep -rn "traceparent\|x-trace-id\|trace_id\|traceId" packages/shell packages/cli packages/relay packages/remote-client packages/coding-agent packages/sdk --include=*.ts --include=*.tsx` (no hits except a CLI description string, `CLI/commands/app.ts:369`, and `packages/sdk/cap-tool/context.ts:21`); `grep -rn "traceparent\|x-trace-id" packages/core packages/protocol packages/base` (hits listed below).

| Layer | Has a trace id? | Evidence |
|---|---|---|
| Core HTTP API server | yes: reads incoming `traceparent` (valid shape only), makes a server span, sets response headers `traceparent` and `x-trace-id` | `C/server/server.ts:165-178`; parent from header `:607-` |
| Error envelope | yes: `error.trace_id` on responses with status >= 400 from `dispatchHttp`, and on `json(failure(...), traceId)` paths | `P/base/errors.ts:4-19`; `C/server/request.ts:48-58`; `server.ts:300-304`, `:614` (`withTraceId` when status >= 400) |
| Ledger writer/reader worker calls | yes, as child spans of the request span | `C/main/daemon/core.ts:313-333` |
| Agent runtime child | has its own tracer and trace ids (per turn); its HTTP calls to core use global `fetch` and set no `traceparent` (`C/main/agent-runtime/core-http.ts:20-33`; `tracedFetch` is passed only to the model-provider driver and the catalog fetch, `C/main/agent-runtime/main.ts:507-513`); it never reads `x-trace-id` or `error.trace_id` (`core-http.ts:44-62`) | not joined to the core request trace |
| CLI binary / `lophn` command | no: sends no `traceparent`, prints no `trace_id` | grep above; `packages/cli/output.ts:114-134` |
| Shell main (desktop) | no: does not send `traceparent`; its core client returns `parsed.data.error` (so `trace_id` is in the returned error object) but nothing in `S/` reads it | `S/main/desktop/core/client.ts:173-195`; grep above |
| Renderer / page (`lophnApp`) | no: `AppViewOutcome` error is `{code, message}` only | `P/apps/views.ts:80-93` |
| App supervisor | no (no telemetry/logger/trace reference in `C/main/app-supervisor/*.ts`, `C/apps/runtime/supervisor/*.ts`; grep `trace\|telemetry\|logger`) | - |
| App process | no trace for the call. The call request carries `invocation` id and `context.caller`; only the `event` caller has a `trace_id` field and the app process parses and passes it through | `P/apps/calls/process-wire.ts:31-43`; `C/apps/runtime/entrypoint/wire.ts:35,89-125`; `P/apps/calls/caller.ts:54-70` |
| Invocation rows | only inside `caller` JSON for `{kind: event}`; the column set has no trace column (`C/apps/invocations/schema.ts:9-37`) | event publication also stores `trace_id` (`C/apps/events/store.ts:14-21,69`, from `activeTraceId() ?? newTraceId(random)`, `C/apps/events/publish.ts:40,193`) |
| App log lines | no field (`{at, invocation, text}`) | `P/apps/app-log.ts:35-39` |
| `platform-*.jsonl`, `shell-view.jsonl` | no field | `P/diagnostics/diagnostics.ts:12-21`; `C/main/daemon/diagnostics.ts:19-34` |

---

## D. Error vocabulary

| Item | Exact content | Where |
|---|---|---|
| Seven codes | `invalid_input, unauthorized, forbidden, not_found, conflict, unavailable, internal` | `packages/base/errors.ts:1-9` |
| `LophnError` | `{code, message, details?: Record<string, unknown>}` | `packages/base/errors.ts:11-15` |
| `Result` | `{ok:true, value} \| {ok:false, error}` with `ok()`, `err()` | `packages/base/result.ts:3-14` |
| HTTP envelope | `{error:{code, message, details?, trace_id? (32 hex), hint?}}` | `P/base/errors.ts:4-19` |
| `hint` | fixed sentence per code, e.g. internal: "Core failed unexpectedly; search core stderr (or the OTLP backend) for this trace_id." | `C/server/request.ts:30-45`; no client reads it (grep `\.hint` in `packages` finds no use of `error.hint`) |
| Status mapping | 400/401/403/404/409/503/500 | `P/base/errors.ts:21-30` |
| Handler exceptions | become `internal` "internal error" on the wire; log has exception kind + first frame | `packages/base/errors.ts:17-25`; `server.ts:146-150,194-202` |
| App call outcome | `succeeded {result}` \| `failed {error:{code: string, message}, missing?}` \| `denied {denial:{code, message}}` \| `unknown {reason}` | `P/apps/calls/call.ts:57-79` |
| Denial codes (6) | `gate_blocked, call_loop, call_too_deep, app_archived, app_unavailable, not_declared` | `call.ts:38-48`; messages `C/apps/calls/service.ts:146-152` |
| Unknown reasons (4) | `unavailable, connection_lost, core_restarted, timeout` | `call.ts:52-57` |
| `failed.error.code` | a free string. Values produced by lophn's own app-process entrypoint: `not_found` ("operation is not declared", "command is not declared", "handler is not registered"), `invalid_input` (command schema failure), `internal` ("handler failed", "result is not JSON", "result exceeds the size limit", "changeset could not be read"), `conflict` ("call does not match this process", HTTP 409 path); values an app handler may choose: `invalid_input, forbidden, conflict, unavailable` via `HandlerRejection`, message cut to 200 chars | `C/apps/runtime/entrypoint/invoke.ts:36-47,65-95,128-143,159-196,200-228`; `C/apps/invocations/context.ts:70-97`; `P/apps/calls/process-wire.ts:59-61` |
| Invocation status | `running, succeeded, failed, denied, unknown` | `P/apps/calls/invocation.ts:42-48` |
| Invocation `summary` | JSON object <= 16 KiB; writers set `{outcome, error_code?, changeset_dropped?}` (`C/apps/calls/record.ts:23-55`) | `P/apps/invocations.ts:6-14` |
| `AppViewOutcome` | `{ok:true, value} \| {ok:false, error:{code: string, message}}`; comment: "앱이 낸 오류의 code는 일곱 오류 code가 아니다" | `P/apps/views.ts:80-93` |
| View outcome mapping | denial -> `forbidden` (gate_blocked, not_declared) / `conflict` (loop, deep) / `unavailable` (archived, app_unavailable); path error -> fixed messages; `NOT_AVAILABLE = forbidden "operation is not available"` for undeclared and out-of-app operations alike | `C/apps/views/call.ts:60-103` |
| Release prepare | `{status:"failed", stage: build\|dependencies\|migration\|handlers\|release, reason}` | `P/apps/releases.ts:113-119` |
| Runtime reason | `{code: string, summary: string}` free strings | `P/apps/runtime.ts:19-24` |
| Program notice kinds (11) | `release_activated, release_failed, release_rolled_back, app_unavailable, app_data_migrated, app_data_restored, lophn_updated, sdk_update_needed, session_stopped_by_app, phone_changed, app_sync_away` | `P/apps/notice.ts:43-55` |
| Diagnostic `error_class` | `internal_exception, disk_full, ledger_corruption` | `P/supervision/supervision.ts:339-343` |
| CLI exit codes | see A.4 | `packages/cli/output.ts:10-18` |

Is there a field or convention for fault / layer / stage / owner of an error? Command: `grep -niE "\b(origin|source|fault|layer|stage|owner|blame|culprit)\b" packages/protocol/base/errors.ts packages/protocol/base/envelope.ts packages/base/errors.ts packages/protocol/apps/calls/*.ts packages/protocol/apps/views.ts packages/protocol/apps/runtime.ts packages/protocol/apps/app-log.ts`. Result: only comment words ("source" for "source map" `app-log.ts:25`; `owner`/`source` in view-event payloads `views.ts:121-140`; "source row" `process-wire.ts:142`). None describes who caused an error. Facts that exist near the idea:
- `stage` exists only in the release prepare output (`releases.ts:113-119`).
- `denied` vs `failed` vs `unknown` in the call outcome separates "did not reach the handler" (denied), "handler/app process answered an error" (failed), "no answer" (unknown). A lophn-side failure that happens after the call reached the app process (for example `internal: result exceeds the size limit`, `invoke.ts:213-224`; `not_found: handler is not registered`, `invoke.ts:136`) is `failed` with a `code` string from the same set an app can choose.
- `details.reason` is an ad hoc per-route convention (24 occurrences of `details: { reason` in `packages`: `grep -rnE "details: \{ ?reason" packages --include=*.ts | grep -v _test | wc -l`).
- `app_sync_log.origin` (`machine`/`device`) is about sync, not errors (`C/apps/sync/log.ts:184-193`).

---

## E. Guidance agents get today

All quotes are from the file, verbatim.

| # | Where | Sentence | Covers |
|---|---|---|---|
| 1 | `C/agent-workspaces/prompts/app.md:127-133` | "When the app seems to misbehave, read before you decide: `lophn app status`, `lophn app logs` (narrow by invocation or time), `lophn app invocations` (for example `--status failed`). Log lines: `error <name>: <message>` is a `reportProblem` branch, `exception <name>: <message>` an uncaught exception, `view_error` a screen error, `process_exit <reason>: <message>` an abnormal end (`crash_loop` means lophn stopped restarting it). Fix the cause and release, then tell the person what did not work and how it works now." | the only app-agent paragraph on diagnosing misbehavior; no mention of `call_rejected`, of 300-char cut, of "no record is ambiguous", or of lophn-side faults |
| 2 | `app.md:70-71` | "Walk the journeys with `lophn preview call` ... the outcome is `succeeded`, `failed` (the app's `error`), `denied` or `unknown`. Preview output and errors are not in `lophn app logs`." | preview vs logs |
| 3 | `app.md:61-63` | "`failed` gives `stage` and `reason`: fix, commit, prepare again." | release prepare failure |
| 4 | `app.md:88-89` | "`failed`: read `failure` (`code`, `summary`, `restored`: the previous release runs again) and `lophn app logs`, fix it, go back to step 3." | activation failure |
| 5 | `app.md:124-126` | "`lophn app event-publications` shows what an app published and how many subscribers got it; the calls it caused are in `lophn app invocations` with an event caller." | event path |
| 6 | `app.md:200` | "Do not edit the declaration (`lophn.ts`) to hide a problem." | |
| 7 | `app.md:3-5`, `:11-12` | "When the app misbehaves, you find the cause and fix it." and "The program does not open a conversation when the app keeps crashing; the person may ask you." | |
| 8 | `app.md:153-156` | "The lophn browser ... is the browser for this work. If it fails, do not start another browser ... Tell the person the reason the error gave you." | browser failure, not app failure |
| 9 | `C/agent-workspaces/skills/repair-app/SKILL.md:13-22` | "Read what happened: `lophn app read` with its ID, `lophn app status`, `lophn app logs` (recent errors; narrow by time) and `lophn app invocations` for failed calls." / "Do not interpret the cause or change code." / "Hand it to lophn at that app with `lophn call send` ... point to the evidence by invocation id and log time." | Home-side triage; routes the problem to the app agent |
| 10 | `prompts/home.md:69-73` | "When the person asks whether their apps are healthy, read each app with `lophn app read` and `lophn app status`, recent errors in its log with `lophn app logs`, failed calls with `lophn app invocations` (`--status failed`). Tell them in their words what works, what does not and who is fixing it." | Home |
| 11 | `prompts/home.md:131-132` | "Do not design an app in detail, interpret why a problem happened, or write app code. That work is done in a conversation at the app." | Home forbidden from interpreting |
| 12 | `prompts/project.md:34-36` | "Work on an app (its declaration, a release, a package, a bug in it) goes to lophn at that app with `lophn call send`" | project agent |
| 13 | `C/agent-workspaces/skills/design-app/SKILL.md:48-49` | "Failure branches: refusals, failed outside calls, silent fallbacks. Name each cause differently and call `reportProblem` with it in the code." | writing code that logs |
| 14 | `packages/sdk/cap-problem/guide.md:8-16` | "줄 꼴은 `error <name>[: <message>][ <details JSON>]`이다 ... 줄은 redaction한 뒤 300자로 잘린다. App Engineer와 coding agent는 앱 log에서 이 줄을 찾는다." / "쓰지 않을 곳: 잡히지 않은 예외와 handler가 던진 `Error`. 앱 진입점이 앱 log에 저절로 쓴다." | `reportProblem` |
| 15 | `C/apps/packages/template/app/AGENTS.md.tmpl:85-87` | "실패 분기는 `@lophn/cap-problem`의 `reportProblem(name, message?, details?)`로 앱 log에 error 한 줄을 쓴다 ... 처리하지 못한 예외는 lophn 진입점이 앱 log에 쓴다." (also `:110-111`) | app source AGENTS.md |
| 16 | `AGENTS.md.tmpl:92-93` | "preview는 fixture 격리 사본에서 화면·operation·command를 확인하는 것뿐이고 운영 정상의 증거가 아니다." | preview limit |
| 17 | `packages/sdk/app-ui/guide.md:42-47` | `AppErrorBoundary` render errors reach the app log as `view_error`; the person sees "Couldn't show this screen." and [Try again] | screen errors |
| 18 | `app-ui/guide.md:31-33` | `OperationButton` on failure shows "<label> didn't finish. Try again." and `onFailed` receives the code (`invalid_input`, `forbidden`, `conflict`, `unavailable`) | what the person sees on a failed operation |
| 19 | `C/agent-workspaces/prompts/prompts.ts:32` | "Report to the person as to a manager ... Leave out logs, version numbers, command names, IDs and test output unless they ask for them. Keep what you confirmed apart from what you infer ..." | reporting |
| 20 | `prompts.ts:66` | "If a call fails, work is blocked or another agent refused it, do not hand it to a different agent to get around the block. Tell the person instead." | |
| 21 | `C/agent-workspaces/skills/publish-package/SKILL.md:93`, `prompts/project.md:60` | A bug/problem in a package goes to lophn at the app that owns it (`owner_app`) | the only "bug goes to X" rule; it is about packages |

Points with no coverage (grep commands):
- Distinguishing an app bug from a lophn bug: `grep -rniwE "bug|bugs|fault|faulty" packages/core/agent-workspaces packages/sdk/*/guide.md packages/core/apps/packages/template packages/core/lophn-agent/instructions` returns only `publish-package/SKILL.md:93` (package bug), `prompts/project.md:34` (app bug routing), `sdk/agent/guide.md:244,252` (an unrelated example schema) and two "not a bug" lines about phone `unavailable` (`design-app/phone-features.md:60`, `migrate-sdk/cap-phone-1.0.0.md:61`). Nothing says how to tell that lophn rather than the app caused a failure.
- Reporting a lophn/platform problem: no sentence and no tool. `grep -rniE "feedback|report_(bug|problem)|bug_report|file_issue|report.problem" packages/cli packages/core/lophn-agent/tools packages/protocol/lophn-agent --include=*.ts -l` returns nothing. The command list has no such command (names in `CLI/commands/*.ts`: agent.*, app.*, ask.secret, browser.*, call.*, core.stop, declaration.check, ext.call, job.*, login.*, machine.*, package.*, preview.*, project.*, release.*, run.*, session.list, settings.*, tab.*, team.*, workflow.*). The only escalation path text is `lophn call send` to the app's lophn (rows 9, 12, 21).
- "No record" vs "did not happen": the invocations description states "Successful reads are not recorded" (`CLI/commands/app.ts:345`), but no guidance says that an empty `app.invocations` / `app.logs` does not mean the screen call did not occur, nor which rejections leave no row (A.3).
- What to do when a person's screen fails but `preview.call` succeeds: the only related text is the preview limits (rows 2, 16). Nothing about the person's screen using a different path (view `app_views.call`, `person` caller) than `preview.call` with an agent caller (`preview.ts:190-193`).
- `call_rejected`: not in any guidance file (`grep -rn "call_rejected" packages` finds only `C/apps/views/call.ts`, `S/main/app-frame/view-error.ts`, `P/apps/app-log.ts`).
- `view_error` is mentioned in `app.md:130-131` and `app-ui/guide.md:45` only as "a screen error".

---

## F. Where a lophn-side fault can reach the person today

| Surface | What it shows | Evidence |
|---|---|---|
| The app's own screen | The app decides. SDK `OperationButton`: "<label> didn't finish. Try again." with no cause; `useOperation().run` returns `{ok:false, code}`; `AppErrorBoundary`: "Couldn't show this screen." (`packages/sdk/app-ui/guide.md:25-47`). If the app code swallows the failure, nothing is shown (per `project-docs/issues/view-call-rejection-unrecorded.yaml`, `impact:`) | |
| "App is not running" screen | When opening an app tab is refused with `unavailable`, `app-not-running.tsx` reads runtime state and says the app is off or starting, with [Turn on] | `S/renderer/app-frame/app-not-running.tsx:1-40` (recent commits `190448c9e`..`26f5681d5`) |
| Program notices (ledger table, Inbox / app Activity) | 11 fixed-template kinds (see D). `release_failed` body is `params.reason`; `app_unavailable` title "The app stopped and is not running", body the reason. Notices are written by `runtime/commands.ts:262` (app_unavailable) and `releases/commands.ts:392` (release_failed). Eight kinds also raise a desktop notification: `release_failed, release_rolled_back, app_unavailable, app_data_restored, sdk_update_needed, session_stopped_by_app, phone_changed, app_sync_away` | `C/apps/notices/program-text.ts:6-60`; `S/main/desktop/wiring/notice.ts:45-55` |
| Settings > Diagnostics | Component availability (`core, ledger, app-runtime, sandbox, agent-runtime`) with a safe reason, on a "Run checks" press, and the Trace toggle. It does not show `diagnostics/list` records, app logs, or per-call failures | `S/renderer/desktop/settings/diagnostics/diagnostics-panel.tsx:1-50`; `core-source.ts:21-48`; `P/diagnostics/diagnostics.ts:51-72` |
| `diagnostics/list` records | Not displayed anywhere (see C.1) | |
| App-detail Activity view | Lists `app.invocations` (live mode, limit 100) and program notices | `S/renderer/app-frame/app-detail/reads.ts:75,660-745` |
| App log | Not shown to the person; read by agents (`app.logs`) | |
| An agent tool to report a platform problem | None found (grep in E) | |

Problems/diagnostics UI of kind "problem list": none. `grep -rniE "Problems\b" packages/shell/renderer --include=*.tsx -l` finds one unrelated file (`model-info-form.tsx`). The doc agrees: "저장하는 problem 모델 ... 은 없다" (`app-call.md:20`); `project-docs/products/change-log/0.6/drop-problem-model-app-log-file.yaml` is the removal record (not opened).

---

## G. What depends on the `invocations` table

Schema: `C/apps/invocations/schema.ts:9-37`. Columns: `id, app, release, mode (live|preview), operation JSON, caller JSON, caller_kind, session, turn, effect (read|write|external), status (5), started_at, finished_at, input_hash, summary (<=16384), detail_hash, changeset_hash, changeset_size, reverted_by`. CHECKs: `(caller IS NULL) = (caller_kind IS NULL)`, `(session IS NULL) = (turn IS NULL)`, `(caller_kind IS 'agent') = (session IS NOT NULL)`, `(finished_at IS NOT NULL) = (status <> 'running')`, `changeset_hash IS NULL OR effect <> 'read'`, `reverted_by IS NULL OR status IN (succeeded, failed, unknown)` (`schema.ts:23-35`; caller_kind enum gets `event` in a later step `schema.ts:100-`). Triggers: terminal rows immutable except `reverted_by` and clearing changeset (`schema.ts:48-69` and re-created `:79-103`); delete blocked, except inside an erase window (`schema.ts:71-73`; `C/apps/registration/schema.ts:90-93`). Index columns: `(app, release, mode, id)`, `(app, id)`, `(session, turn, id)`, `(status, id)` (`schema.ts:44-47`).

### G.1 Writers

| Writer | path:line | Rows |
|---|---|---|
| `begin` (running row) then `finish` | `C/apps/calls/service.ts:445-476` (write/external), `:621`/`:590` (phone/applied/sync), ledger `C/apps/invocations/ledger.ts:95-124` begin, `:126-209` finish | write, external, app start |
| `recordOnce` closed-at-once rows | `service.ts:202` (denied), `:512` (read unknown), `:538` (failed/unknown read); `ledger.ts:211-232` | denied with started_at null, failed reads |
| App start row with start changeset | `C/apps/routes.ts:370-415` (`operation.kind:"start"`, `caller:null`) | start |
| Core-restart closer: `running` rows become `unknown` | `C/apps/invocations/restart.ts:46-100` | |
| `reverted_by` marker | `ledger.ts:256-271` (`UPDATE ... reverted_by`) called from `C/apps/rewind/run.ts:115` | |
| Changeset prune on release switch | `ledger.ts:273-296`; called `C/apps/releases/activation/assembly.ts:512`, `C/main/daemon/wiring/apps.ts:633` | |
| Erase on app delete | `C/apps/registration/delete.ts:30,57` | |

### G.2 Readers

| Reader | path:line | Depends on |
|---|---|---|
| Diagnosis list/get routes | `C/apps/invocations/reads.ts:47-103` | all columns; per-row app scope |
| CLI/agent `app.invocations` | `CLI/commands/app.ts:341-362` | |
| Shell renderer Activity view | `S/renderer/app-frame/app-detail/reads.ts:75,678,739` (limit 100, mode live) | status, effect, operation name, caller |
| Phone (remote allowlist) | `P/remote/allowlist.ts:237-238` | |
| Rewind plan | `C/apps/rewind/plan.ts:61,72-86`: `ledger.list({app, release: active, mode:"live", reverted:false})` filtered by `effect !== "read"`, `status !== "denied"`, `operation.kind !== "data_change"`, `id >= from`, and it refuses a plan if the list is truncated so `from` is missing (`plan.ts:87-`) | effect, status, mode, reverted_by, id order |
| Rewind run | `C/apps/rewind/run.ts:80-120` (`changesetOf` at `:84`, `markReverted` at `:115`); rewind table `app_rewinds(from_invocation, invocations JSON)` `C/apps/rewind/schema.ts:13,20`, store `rewind/store.ts:61-78,100-118` | changeset blob, status |
| Session rewind (agent session) | SQL on `invocations` joined to `turns`/`messages`: `i.session = ? and i.effect in ('write','external') and i.mode='live' and i.status <> 'denied' and i.reverted_by is null` `C/main/daemon/rewind-glue.ts:15-31`; consumer `C/lophn-agent/session/rewind/files.ts:81,211-248`; renderer `S/renderer/conversation/agent-tab-core-source-rewind.ts:71-94` | session, turn, effect, status, mode, reverted_by |
| Usage (`app.usage`) | `C/apps/usage/users.ts:88-95`: `select distinct json_extract(operation,'$.name'), session from invocations where app=? and caller_kind='agent' and operation.kind='command'` | caller_kind, operation JSON, session |
| Sync log backfill | `C/apps/sync/log.ts:522-543` (`ledger.list({app, release, mode:"live"})` filtered `effect !== "read"` and (`changeset !== null` or `status === "unknown"`)); sync log column `invocation` `C/apps/sync/schema.ts:28,68`, partial index `:39-40,94-95` | effect, changeset, status, id link |
| Event chain ancestry | `C/main/daemon/wiring/apps.ts:593` (`ledger.get(parent)`: own-app check and caller chain) | app, caller |
| Per-release changeset budget | `C/apps/invocations/store.ts:104-114` (`SUM(changeset_size)`), used by `changesetVerdict` (`model.ts:44-53`) | changeset_size |

Facts for the "same concept or beside" question:
- Rewind, session rewind, sync backfill and the changeset budget all select on `effect` / `changeset` / `status`; reads have `effect="read"` and cannot hold a changeset (CHECK `schema.ts:34`).
- Rows are append-only with a terminal-state lock; the 5-value `status`, the `caller_kind` CHECK, and the summary cap would all apply to any new row kind.
- The Activity UI and the rewind plan list rows with `mode="live"` and fixed `limit`s (100 and unbounded-until-`from` respectively; the plan errors when `from` is cut off by the list, `plan.ts:87-`).
- The `detail_hash` column exists and is never set to a non-null value by any writer (`grep -rn "detail_hash" packages --include=*.ts | grep -v _test` shows `null` at `routes.ts:406`, `service.ts:462,476,524,594`, `record.ts:86`, `restart.ts:99`, `ledger.ts:107`).
- Preview calls never use the ledger (A.3), although `mode` allows `preview`.

---

## Gaps list (what no existing read can answer)

Facts about what is missing for an agent that is told "a screen shows an error".

1. There is no read that lists calls that reached lophn but ended before the app handler and left no invocation row (`not_declared`, archived, oversize body, caller-verification failures; A.3). The only trace of a rejected live screen call is a `view_error call_rejected` log line, and only for the paths in B.2 row 6 (core live views, once per (operation, message), 32 per binding; shell main only for `invalid_input`).
2. No read distinguishes "the call never happened" from "the call succeeded and is unrecorded": successful reads are unrecorded by design (`service.ts:487-490`), and `app.invocations` returns neither a negative nor a count for them.
3. A call record has no call id visible to the person's screen or to the agent's tool result for a view call: `AppViewOutcome` has no id (`P/apps/views.ts:80-93`), and `app_views.call` drops the invocation id (`C/apps/views/call.ts:259-260`).
4. No field says where a call ended (stage) or whose side produced a failure; `failed` merges app-chosen codes and lophn-produced codes (`invoke.ts:136,213-216` vs `context.ts:70-77`), and `denied` merges Gate, loop, archive, not-declared, app-unavailable (`call.ts:38-48`).
5. The failed-invocation row holds only `error_code` (`record.ts:48-52`); the error message is not stored anywhere (`app.invocations`) and the `lophn` tool shows the model only a fixed sentence for most core errors (`work.ts:40-48,166-176`).
6. The error `hint` and `trace_id` never reach the model or the CLI output (`core-http.ts:44-62`, `output.ts:114-134`), and there is no tool to read `core-*.jsonl`, `platform-*.jsonl` or `diagnostics/list` (A.1, C.1).
7. No existing read joins one call across layers: shell main, core, supervisor and app process share no call id for a screen call except the invocation id, which exists only after the core path made a row; the app log carries an invocation id only for lines written inside the app process (B.2).
8. `app.logs` has no filter by line kind, by operation, or by who wrote the line (lophn vs app), and a time filter compares strings of `at` (`reads.ts:182-184`). Multi-line stderr output becomes many lines with null invocation (B.2 row 1), and lines are cut at 300 characters with no marker (`log-file.ts:46`).
9. `app.logs` preview-spill drops the newest lines first (A.2 step 3); the model sees the oldest lines unless it reads the spill file.
10. `app.invocations` has no filter by time, operation name, caller kind, or error code, and no way to read the next page from the CLI (`app.ts:347-350`).
11. `app.status` shows only the current supervisor observation; there is no read of past exits, last crash time, restart count or when the app last became ready beyond the log lines (B.2 row 7).
12. There is no read of what the person's screen actually called or saw: `browser.logs` covers only tabs the agent opened (`browser.ts:206-224`), and the person's live screen is not readable by the agent.
13. `preview.call` runs the command or operation with an agent caller against fixture data and records nothing (`preview.ts:190-193`; `service.ts:343-372`); no read reports what differs between the preview path and the person's live screen path.
14. No guidance text and no tool covers reporting a lophn-side fault, or telling it apart from an app fault (E).
15. `diagnostics/list` exists with no consumer and `app_invocation_delivery_loss` has no emitter (C.1).

## Counts

- Agent-facing diagnosis reads: 4 primary (`app.status`, `app.logs`, `app.invocations`, `app.event_publications`) + 6 adjacent that carry diagnostic facts (`app.read`, `release.list`, `release.get`, `declaration.check`, `app.sdk_status`, `browser.logs`) = 10. Plus 1 probe (`preview.call`) and 2 release-time results with failure detail (`release.prepare`, `release.activate`). Routes with no agent command: 4 (`app.invocation`, `app.usage`, `diagnostics/list`, `diagnostics/status`).
- App log line kinds: 7 text formats (5 sources by the doc's count). Of these, only kinds 1-4 (written from inside the app process) can carry an invocation id; kinds 5-7 never do.
- Layers with a trace id vs not (11 layers/stores listed in C.2): 3 have trace ids as spans/headers (core API server including error envelope, ledger worker spans, agent runtime child, which is not joined to core); 2 carry a trace id only as a data field for event calls (invocation row `caller` for `event`, `app_event_publications` row); 6 have none (CLI binary, shell main, page/`AppViewOutcome`, app supervisor, app process for ordinary calls, app log lines). `platform-*.jsonl` and `shell-view.jsonl` have none (2 more stores, not counted as layers).
- Denial codes: 6. Common error codes: 7. Invocation statuses: 5. Call outcome statuses: 4. Program notice kinds: 11.

## Not verified / surprises

Not verified (not run, or not opened):
- I did not run anything: no check of the packaged app, real `app.log` contents, or `core-*.jsonl` content for a real call. The doc itself lists "packaged app creates `core-*.jsonl`" as unverified (`observability.md` "열린 것").
- Default value and effect of `diagnostics.trace` (taken from the doc; I read `P/diagnostics/trace.ts` for the key only).
- Whether `shell.run` can read the app log directory or `~/.lophn` files directly (the agent used `shell.run` 42 times in the incident). I read file-tool scope only (`workspace-folders.ts`); `shell.run` scope (`C/lophn-agent/tools/shell/run.ts`, Gate rules) was not opened.
- The exact value of the `lophn.tool` span attribute for `lophn app logs` (inferred as the resolved command name from `tool-batch.ts:207` and `core-ports.ts:649-655`; not run).
- Whether agent-runtime core calls really carry no `traceparent` at runtime: read from `main.ts:507-513` and `core-http.ts:20-33`; `startAgentRuntime`'s `fetch` option is not passed at the main entry (`main.ts:508-513`), but I did not trace every call site of `agentCall`.
- `project-docs/products/change-log/0.6/drop-problem-model-app-log-file.yaml`, `app.event_publications` core handler details (`C/apps/events/reads.ts`) and `browserLogs` core handler were not read beyond their definitions/descriptions.
- Phone-side (`packages/mobile`, phone backend) logging and the phone view call path were not examined.

Surprises and doc contradictions:
- `app-call.md` boundary text lists denial codes `gate_blocked, call_loop, call_too_deep, app_archived` ("경계와 계약") but the code has six; `app_unavailable` and `not_declared` are also codes (`call.ts:38-48`). The doc's app-log item 4 describes `call_rejected` message as `<code>: <message>`; code can append ` (<detail>)` (`views/call.ts:174-176`).
- The `app.invocations` command description says "denied calls are [recorded]" but `not_declared` and archived denials return `invocation:null` with no row (A.3).
- `app-call.md` says the agent calls `app.logs` as a tool; in code the model sees one `lophn` tool and the command is resolved from `args` (A.0).
- `executeToolCall` hides the handler error message for these reads, but the release prepare output type documents a workaround: failures are returned as successful output with `stage` and `reason` (`releases.ts:95`).
- The `lophn` binary and the agent runtime both ignore `error.hint` and `error.trace_id` although the doc's guarantee 5 (`observability.md`) says the body carries it; nothing in `packages` reads them (A.4, C.2).
- `app.logs` over-limit preview drops the newest lines (A.2). The logs command says "newest lines last" (`app.ts:320`).
- `diagnostics/list` is wired with all four actors allowed but no caller exists; `app_invocation_delivery_loss` has a schema, a description and no producer.
- The core logger is never called in the app call path; with trace off a failed app call leaves nothing in `core-*.jsonl` (C.1).
- A handler-thrown non-rejection `Error` yields three artifacts: `failed internal "handler failed"` outcome + row `error_code internal`, an `exception` log line with the invocation id, and the SDK-less stderr. App handlers that throw `HandlerRejection` get only the outcome/row, no log line (`invoke.ts:185-198`).

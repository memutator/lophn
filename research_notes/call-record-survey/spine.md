# Call spine survey: core call path to the app handler, and the non-screen callers

Scope: read-only survey of `/home/pyosechang/projects/lophn-worktrees/app-call-input` (branch `docs/call-record-roadmap`). Facts only; every `path:line` below was opened. Paths are relative to `packages/core/apps/` unless they start with `packages/` or another top-level name. "row" = an `invocations` ledger row. Korean source comments are paraphrased in English.

Short names used throughout:
- `service.ts` = `calls/service.ts`, `caller.ts` = `calls/caller.ts`, `record.ts` = `calls/record.ts`
- `link.ts` = `runtime/supervisor-link.ts`, `relay.ts` = `runtime/supervisor/relay.ts`
- `invoke.ts` = `runtime/entrypoint/invoke.ts`

---

## 1. Hop map (one live call, in order)

Ids that exist in the spine: the **invocation id** (`inv_...`) is the only per-call id. It is also the flight id (`Flight.id = base.id`, service.ts:394). There is **no trace id** anywhere in the spine (`grep -n trace calls/*.ts runtime/entrypoint/invoke.ts runtime/supervisor/relay.ts` only hits the event-caller field `trace_id` in caller.ts:32,168). The only other per-hop ids are the pipe request id `apps-request-<n>` (link.ts:135, core to supervisor, not related to the invocation id) and, for preview targets, `process_nonce` (the live process nonce is not in the call request; it lives in the supervisor's `ControlTarget`, runtime/supervisor/supervisor.ts:772-776).

| # | hop | path:function | id available at this hop |
|---|---|---|---|
| H0 | HTTP dispatch (pre-spine) | `packages/core/server/dispatch.ts:227` `dispatchHttp`: actor allowed for route (:175-186, route `app.call_tool` actors are `user,agent,app`, protocol/apps/calls/call.ts:108), POST only (:239), header/body limits (:233, :249), content-type (:258), JSON parse, then `memory()` zod-parses the body (:485-488 "invalid memory body") and calls the handler (:490-495). A throw is caught at :290-292 (`onThrown`, `asInternalError`). | none. Credential context only. |
| H1 | route handler | `routes.ts:69` `callToolHandler`: maps credential actor to `CallAuth` (user/agent -> `{actor}`; app -> `{actor:"app", app}`; anything else -> forbidden, :81). `program`, `flow`, `event` auth can only be made by core-internal callers (runs.ts, publish.ts), never by route. | none |
| H2 | call entry | `service.ts:238` `call` | none until H7 |
| H3 | caller verification | `caller.ts:79` `verifyCaller` (called service.ts:258); also previewOnly / device / machine claims at service.ts:243-257 | none (reads ids the *caller* supplies: parent invocation, tool_call, job_run, instance) |
| H4 | intake admit | `service.ts:268` -> `calls/intake.ts:62` `admit`. If intake is closed (activation drain, rewind) the call **waits with no timeout** until `open` (intake.ts:56-60). Skipped for preview target. | none |
| H5 | archived check | `service.ts:270-277` | none |
| H6 | declaration lookup | `service.ts:281` -> `routes.ts:294` `appToolLookupOf().find` (live) / `routes.ts:284` `findPreview` (preview, called from `callPreview` service.ts:352). `lookups.ts` is NOT the call-path lookup (it holds list/skill readers only). | none |
| H7 | **invocation id minted** | `service.ts:297` `deps.ids.newId("inv")` inside `call`, building `base: CallRecordBase` (:296-305). This is the first and only mint point for a live call. (Preview mints at :361 but never records, and `invocation: null` is returned.) `input_hash` is computed at :304. | `base.id` (every later hop in `call`/`run`/`execute` has `base`) |
| H8 | pre-queue rules | operation-vs-caller rule :309-315; call chain loop/depth :317-322 (`calls/loop.ts:6`); size :324 (`checkSize` :331-343). These use `base.id` only to record denials. | `base.id` |
| H9 | run | `service.ts:378` `run`; builds `Flight` :393; `intake.enter(flight)` :494; `Promise.race([work(), forcedResult])` :496 | `base.id` |
| H10 | Gate | `service.ts:411-420` -> `calls/gate.ts:33` `callAllowed` (non-person only). The gate target gets `{app, tool, effect, public}`, **not** the invocation id. | no |
| H11 | write lane | `service.ts:423-431` `queue.acquire(app)` (`calls/queue.ts:29`); read skips it | no |
| H12 | execute / begin | `service.ts:440` `execute`; `ledger.begin` :445 (write/external only; ledger.ts:95) | `base.id` |
| H13 | process link | `service.ts:453` `deps.link.call(processTarget, request)`; `requestOf` :219-236 puts `invocation: base.id` into the request. `link.ts:516` `createAppProcessLink.call` | `request.invocation` |
| H14 | pipe to supervisor | `link.ts:124` `channel.request` (op `apps.call`, 125 s timeout = 120 s + 5 s, link.ts:61,533) | request body only; pipe request id is separate |
| H15 | supervisor | `runtime/supervisor/control-link.ts:101` `answer` -> op `packages/core/main/app-supervisor/assembly.ts:981` -> `parse(callInputSchema)` (:286-295) -> `relay.ts:202` `relay.call` | `request.invocation` (not inspected; "supervisor does not look inside", relay.ts:1-3) |
| H16 | socket HTTP | `packages/core/main/app-supervisor/control-http.ts:107` `unixControlTransport`: connect probe (:111) then POST `/_lophn/control/call`, timeout 120 s (relay.ts:38,230), response cap (relay.ts:233-236) | in JSON body only; no header carries it |
| H17 | app process HTTP | `runtime/entrypoint/http.ts:30` `serveUnix` -> `control-server.ts:351` handler -> `invoke.ts:48` `handleCall` | `call.invocation` after parse (invoke.ts:64) |
| H18 | handler | `invoke.ts:99` `run` -> `port.run(context, ...)` (invoke.ts:143-157, AsyncLocalStorage in `entrypoint/tool-port.ts:22`) -> `handler.handle(input)` | `InvocationContext.invocation` (invocations/context.ts:31). SDK `reportProblem` prefixes log lines `[inv=<id>]` (packages/sdk/cap-problem/report-port.ts:11,29-30). `reportCaught` passes `call.invocation` (invoke.ts:194, main.ts:93-114). |
| H19 | return | response `{status, result\|error, changeset, hlc?, changeset_dropped?}` (invoke.ts:44,218; `fitChangeset` invoke.ts:86 / fit.ts:3) -> `relay.ts:242-247` parse -> `assembly.ts:982-988` -> pipe -> `link.ts:541-553` -> `service.ts:469` `settleResponse` -> `ledger.finish` :472 -> `ok({invocation, outcome})` :485. The response does **not** carry the invocation id back (the id is re-attached by core from `base.id`). | `base.id` |

Notes on id flow:
- The id is minted after admit (H4), archived (H5) and lookup (H6). Any exit before H7 has no id.
- `inLane` (sync apply paths) creates a flight id with `newId("inv")` at service.ts:644 that is a **different** id from the invocation ids it later mints per change (service.ts:692, :788, :869, :987).
- The app process does not know the core-side ids other than the invocation id and caller ids inside `context.caller` (agent: session/turn/tool_call; program: job/job_run; flow: instance; event: publisher/event/publication/trace_id/chain/parent_invocation; person: view_session; app: app/release/parent_invocation).
- Event delivery carries a `trace_id` (publication), taken from telemetry's active trace if any (`main/daemon/wiring/apps.ts:526`, events/publish.ts:193). The call spine does not read it.

---

## 2. Exit table

"Row" column: `none` = no ledger row. Fault class uses `app | contract | platform | state | unclear`. "log" = anything written to app log (supervisor `app.log`) or core log. `grep -n "logger\|log(\|telemetry\|console\." calls/*.ts runtime/supervisor-link.ts runtime/supervisor/relay.ts runtime/supervisor/control-link.ts runtime/entrypoint/invoke.ts runtime/entrypoint/control-server.ts invocations/*.ts` (run from `packages/core/apps`) returns nothing: **no spine file writes any log**. The only log writes tied to a call are listed in the log column explicitly (they come from the SDK/supervisor/event-delivery/views, not the spine).

Outcome vocabulary: `err(code,msg)` = `Result` error (route returns an error; no `outcome`); `denied(code)`, `failed`, `unknown` = `ToolCallOutput.outcome` (protocol/apps/calls/call.ts:70-91). Denied messages come from `DENIAL_MESSAGES` (service.ts:145-152).

### 2a. Before the id is minted (verifyCaller, archived, lookup). No row for any of these.

| id | path:line | function | condition | caller receives | row | log | class |
|---|---|---|---|---|---|---|---|
| P1 | service.ts:245 | call | previewOnly credential but caller not person | err forbidden "only a person can use a previews-only credential" | none | none | contract. **No production code sets `previewOnly`** (`grep -rn previewOnly --include=*.ts packages \| grep -v mobile` hits only calls/service.ts, calls/caller.ts, calls_test.ts), so P1/P2 are unreachable outside tests |
| P2 | service.ts:248 | call | previewOnly credential and live target | err forbidden "this credential calls previews only" | none | none | contract (same note) |
| P3 | service.ts:256 | call | person caller claims `device` or `machine` | err forbidden "a call cannot claim a device or a machine" | none | none | contract |
| P4 | caller.ts:86 | verifyCaller | `KIND_OF_ACTOR[auth.actor] !== caller.kind` | err forbidden "caller kind does not match the credential" | none | none | contract |
| P5 | caller.ts:97 | verifyCaller | agent target not (live, release null) and not preview | err invalid_input "agent calls target the live active release or its own preview" | none | none | contract |
| P6 | caller.ts:109 | verifyCaller | `agentToolCall` returns null (turn not running / unknown tool_call) | err forbidden "unknown tool call" | none | none | state (turn ended) or contract (made-up ids): unclear, same message |
| P7 | caller.ts:117 | verifyCaller | agent preview call from a session not in that app's workspace | err forbidden "only a session in the app's workspace calls its preview" | none | none | contract |
| P8 | caller.ts:133 | verifyCaller | program target not (live, null) | err invalid_input "program calls target the live active release" | none | none | contract (core-internal caller, so really platform bug if hit) |
| P9 | caller.ts:145 | verifyCaller | program body job/job_run != credential | err forbidden "job run does not match the credential" | none | none | platform (only core-internal code builds it) |
| P10 | caller.ts:156 | verifyCaller | event target not (live, null) | err invalid_input "event deliveries target the live active release" | none | none | platform |
| P11 | caller.ts:172 | verifyCaller | event body fields != credential | err forbidden "event delivery does not match the credential" | none | none | platform |
| P12 | caller.ts:179 | verifyCaller | flow target not (live, null) | err invalid_input "flow calls target the live active release" | none | none | platform |
| P13 | caller.ts:186 | verifyCaller | flow instance != credential | err forbidden "workflow instance does not match the credential" | none | none | platform |
| P14 | caller.ts:197 | verifyCaller | app target not (live, null) | err invalid_input "app calls target the live active release" | none | none | contract |
| P15 | caller.ts:203 | verifyCaller | app caller body `app` != credential app | err forbidden "app does not match the credential" | none | none | contract |
| P16 | caller.ts:207 | verifyCaller | app caller `release` != active release of that app | err forbidden "release is not the active release" | none | none | state (release swapped while the app ran) |
| P17 | caller.ts:214 | verifyCaller | app caller's `parent_invocation` is null, not in flights, other app, or other release | err forbidden "unknown parent invocation" | none | none | unclear: app calling from a timer / after its parent finished is contract; core restart or abandon is state |
| P18 | service.ts:274 | call | app archived and `auth.actor === "agent"` | err not_found "app not found" | none | none | state |
| P19 | service.ts:276 | call | app archived and actor not agent | outcome denied(app_archived) "the app is archived", `invocation: null` | none | none | state |
| P20 | service.ts:288 | call | `lookup.find` -> null (see note) | outcome denied(not_declared) "the app does not declare this operation or command", `invocation: null` | none | none | unclear: contract (name not declared) vs state (app has no active release / release id of target not found) share one outcome. `find` returns null for: no active release (routes.ts:297), release/app mismatch (:297), name absent (:304, :326) |
| P21 | service.ts:291 | call | name is a subscription handler but caller is not `event` | outcome denied(not_declared), same message, `invocation: null` | none | none | contract |
| P22 | service.ts:359 | callPreview | preview declared lookup null (no preview with that nonce, or name absent) | outcome denied(not_declared), `invocation: null` | none (by design: preview) | none | unclear: state (preview stopped) vs contract |
| P23 | service.ts:370 | callPreview | `link.call` returned `sent:false` | outcome denied(app_unavailable) "the app is not running", `invocation: null` | none (by design) | none | state / platform (see C-group, error is discarded) |
| P24 | service.ts:339 | checkSize | request JSON > `CALL_BODY_MAX_BYTES` (= control frame max - 2 KiB, runtime/entrypoint/limits.ts:43). Called from service.ts:324 (live, after id minted but before any row) and :367 (preview) | err invalid_input "call body exceeds the size limit" | none | none | contract (documented size rule) |
| P25 | caller.ts:108 / :205; service.ts:271, :287, :358, :418 | passthrough | `callers.agentToolCall`, `activeRelease`, `archived`, `lookup.find`, `findPreview`, `callAllowed` (assignment / grants read) returned an error | err with whatever code/message that port produced (not enumerated here; the ports are `CallerDirectory`, `AppStates`, `AppToolLookup`, `CallGateDeps`) | none | none | platform (storage / reader failure) |

### 2b. After the id is minted, handler not reached

| id | path:line | function | condition | caller receives | row | log | class |
|---|---|---|---|---|---|---|---|
| D1 | service.ts:309-314 | call | `kind === "operation"` and caller not person/event | denied(gate_blocked) "the call is not granted", `invocation: base.id` | yes: `recordOnce`, status `denied`, started_at null, summary `{outcome:"denied", error_code:"gate_blocked"}` (record.ts:32-34) | none | contract (rule: operations are for screens) |
| D2 | service.ts:322 | call | target app already in the chain | denied(call_loop) "the app is already in the call chain" | yes, status denied, summary error_code call_loop | none | contract (rule cited: loop check) |
| D3 | service.ts:322 | call | chain length >= `APP_CALL_DEPTH_LIMIT` (8, protocol/apps/channel-values.ts:24) | denied(call_too_deep) "the call chain is too deep" | yes, status denied | none | contract |
| D4 | service.ts:419 | work | `callAllowed` false: agent assignment `judge` = deny; app caller without active `app.call` grant covering the tool; flow assignment deny or private tool outside creator workspace (gate.ts:46-96) | denied(gate_blocked) "the call is not granted" (same text as D1) | yes, status denied | none | contract (missing grant / not assigned: rule citable) or state (grant revoked): unclear, one message |
| D5 | service.ts:402 | flight.abandon | intake `abandon(app)` while `phase !== "sent"` (activation drain exceeded 30 s, releases/activation/orchestrator.ts:23,35) | denied(app_unavailable) "the app is not running" | yes (`recordDenied`), status denied | none | state |
| D6 | service.ts:457 | execute | read, `sent.sent === false` | denied(app_unavailable) "the app is not running" | yes (`recordDenied`), status denied | none | unclear: see "C-group", error discarded |
| D7 | service.ts:458-466 | execute | write/external, `sent.sent === false` | denied(app_unavailable) "the app is not running", `invocation: base.id` | yes, but status is **`failed`** with summary `{outcome:"denied", error_code:"app_unavailable"}` (the ledger's `finish` cannot take status `denied`, ports.ts:117). Reads in D6 get status `denied`. | none | unclear |
| T1 | service.ts:440-492 | execute (no try/catch) | any throw inside `execute`/`work` (e.g. a port throws instead of returning `err`) | exception propagates; route-level catch gives internal error (dispatch.ts:290-292) | a write that already passed `begin` stays `running` until core restart; otherwise none | `onThrown` hook at dispatch.ts:291 (what it logs: not read) | platform |
| T2 | service.ts:445-449 | execute | `ledger.begin` returned err (e.g. conflict "invocation already exists", invalid_input "invalid invocation") | err passthrough | none | none | platform |
| T3 | service.ts:210, :546 | recordDenied / settleRead | `recordOnce` returned err | err passthrough; the denial / the failed read is lost | none | none | platform |
| T4 | service.ts:465, :479 | execute | `ledger.finish` returned err after the app answered (or was not reached) | err passthrough (the caller gets an error although the app may have run) | the row stays `running` until core restart (R1) | none | platform |
| T5 | service.ts:527 | closeUnknown | `finish` (write) or `recordOnce` (read) returned err while closing as unknown | err passthrough | write: row stays `running`; read: none | none | platform |

### 2c. Handler not reached: errors from the link, supervisor, relay and the app process control server. All of them become `D6`/`D7` (`sent:false`) or `U` (`sent:true, response:null`) at service.ts:456 / :469

`link.call` returns `{sent:false, error}`; **`service.ts:456-467` and `:370` look only at `sent` and discard `error`** (grep: `sent.error` is never read in `calls/`). So every row below that is `sent:false` reaches the caller as `denied(app_unavailable) "the app is not running"` regardless of the underlying code/message.

| id | path:line | function | condition | link/relay result | caller ends as | class |
|---|---|---|---|---|---|---|
| C1 | link.ts:126-132 | channel.request | supervisor pipe not bound | unavailable "app supervisor is not ready", no `sent` detail -> sent:false | D6/D7 | state (core/supervisor starting) or platform |
| C2 | link.ts:181-194 | channel.request | writing the frame to the pipe failed. If the first send never started: no `details.sent` -> sent:false; if started (body chunks failed): `details.sent` -> sent:true | "request could not be sent to the app supervisor" | D6/D7 or U | platform |
| C3 | link.ts:216-223 | onMessage | supervisor answered `ok:false`: carries only op error code+message, no `details` | e.g. invalid_input "invalid op input" (assembly.ts:293), internal "op failed" (control-link.ts:149-157), not_found/unavailable "unknown op" (control-link.ts:107-117) | D6/D7 | platform |
| C4 | link.ts:541-550 | link.call | supervisor `callOutputSchema` parse fails | unavailable "app supervisor answered badly" -> sent:false | D6/D7 | platform |
| C5 | link.ts:518-529 | link.call | request > body cap again | invalid_input "call body exceeds the size limit" -> sent:false | unreachable in practice: `checkSize` (service.ts:324) uses the same JSON of the same request | n/a |
| C6 | relay.ts:204-211 | relay.call | `context.app/mode` != target | invalid_input "the call context does not match its target" | unreachable from core's own request (service.ts:434-438, :224-233 build both) | n/a |
| C7 | relay.ts:216 | relay.call | `live(app)` undefined: no child, not probed, not opened, or stopping (supervisor.ts:762-776) | unavailable "the app is not ready" | D6/D7 | state (app off, starting, stopping, crash loop) |
| C8 | relay.ts:217-219 | relay.call | `target.release` set and != the running release | unavailable "the target release is not running" | D6/D7 | state (rebound screen after release switch) |
| C9 | relay.ts:224 | relay.call | preview process not found | unavailable "the preview process is not ready" | P23 | state |
| C10 | relay.ts:238-239 | relay.call | `not_sent`: connect probe to the socket failed (control-http.ts:111) | unavailable "the app process did not accept the connection" | D6/D7 | state (process just died / not listening) or platform |
| C11 | relay.ts:253-254 | relay.call | app returned HTTP 4xx or 503 (`refused`, relay.ts:142-144) | `rejectionOf` keeps the app-process code+message in `error` (relay.ts:107-139), then discarded by service | D6/D7 | see C12-C16 |
| C12 | runtime/entrypoint/invoke.ts:52-53 | handleCall | `!state.accepting` or `state.closed` (`accepting` is false until control `open`, after `close`/`shutdown`: control.ts:88,96-106) | 503 unavailable "process is not accepting calls" | D6/D7 | state |
| C13 | invoke.ts:55-57 | handleCall | raw body > `CALL_BODY_MAX_BYTES` | 400 invalid_input "call body exceeds the size limit" | D6/D7 | contract (but unreachable, see C5) |
| C14 | invoke.ts:61-63 | handleCall | body not JSON | 400 invalid_input "call body is not JSON" | D6/D7 | platform |
| C15 | invoke.ts:64-65 | handleCall | `parseProcessCall` (`entrypoint/wire.ts:150`, a hand copy of `processCallRequestSchema` + `appToolCallerSchema`) rejects: unknown/missing field, bad id, bad caller shape, `isJson` false | 400 invalid_input "call request is invalid" | D6/D7 | platform (hand-copy drift; app-call.md "지키는 것" 8 names this failure mode as "silently rejected") |
| C16 | invoke.ts:67-74 | handleCall | context app/mode/release != this process identity | 409 conflict "call does not match this process" | D6/D7 | state (release switch race) |
| C17 | runtime/entrypoint/http.ts:65-68 | handle | Host header != `lophn.invalid` | 400 invalid_input "host is not lophn.invalid" | D6/D7 | platform (unreachable from core's transport, which sets host: control-http.ts:85) |

### 2d. Handler reached or possibly reached

| id | path:line | function | condition | caller receives | row | log | class |
|---|---|---|---|---|---|---|---|
| U1 | service.ts:405 -> record.ts:36-42 | flight.abandon | abandon while `phase === "sent"` | unknown `connection_lost`, `invocation: base.id` | yes: write -> `finish` status unknown, changeset null (service.ts:520-526); read -> `recordOnce` unknown (:512-519). Summary is `{outcome:"unknown"}` with **no reason** | none | state (activation drain) |
| U2 | service.ts:469 / record.ts:46 | execute / settleResponse | `sent:true, response:null` | unknown `connection_lost` (the only reason code produced; see note below) | yes: write -> finish unknown; read -> `settleRead` recordOnce unknown (:491). Summary `{outcome:"unknown"}` | none. If the app process died: supervisor writes `process_exit unexpected_exit: ...` / `v8_oom` with `invocation: null` (observations/crash.ts:58-61, assembly.ts:821). | see causes below |
| F1 | service.ts:469-485, :491 | settleResponse | app responded `status:"error"` (any `{code,message}` string pair) | failed `{code, message}` exactly as the app process produced it (record.ts:57-65); `missing` secret slots may be added by a layer above (not in spine) | yes: write -> finish failed; read -> recordOnce failed. Summary `{outcome:"failed", error_code}` (message **not** stored) + `changeset_dropped` if flagged | see causes below | see causes below |
| R1 | invocations/restart.ts:82-105 | closeUnfinishedInvocations | core restarted with rows still `running` | caller connection is gone; nothing returned | yes: `finish` status unknown, summary `{outcome:"unknown", reason:"core_restarted", observation:"result_not_observed", evidence:[...]}`, changeset null | none seen | state |

Causes behind **U2** (all end as unknown `connection_lost`, indistinguishable in outcome and row):
| id | path:line | cause | class |
|---|---|---|---|
| U2a | relay.ts:241; control-http.ts:112-114 | connection lost after send, request timed out at 120 s (control-http.ts:75-77), or response body over the cap (control-http.ts:32-47; cap = `CALL_RESPONSE_MAX_BYTES` for commands, 8 MiB for operations, relay.ts:233-236) | unclear: app handler hung or crashed (app), response bigger than the cap (app/contract) |
| U2b | relay.ts:247-251 | HTTP 200 but body is not JSON or fails `processCallResponseSchema` (e.g. `result` not zod-valid JSON though `isJson` passed) | platform |
| U2c | relay.ts:256 | any other status (5xx except 503, 3xx...). The app http layer returns 500 with empty body if the handler chain throws (entrypoint/http.ts:44-48) | platform (app process bug in lophn code) or app |
| U2d | link.ts:138-148 | core waited 125 s for the supervisor and gave up (`details.sent`) | platform |
| U2e | link.ts:116-122, :262-265 | `failPending` / `unbind`: supervisor child ended or stopped while the request was pending | platform or state |
| U2f | link.ts:239-245 | supervisor response stream cut off / unparseable | platform |
| U2g | observations/crash.ts:58-61; assembly.ts:821 | app process exits mid-call (crash, V8 OOM, signal) -> socket drops -> U2a. The supervisor writes `process_exit <evidence>: ...` to the app log with `invocation: null`; the call row is `unknown` with no link between the two | app (crash) or platform (killed by lophn): unclear |
| U2h | entrypoint/state.ts:44; service.ts:430 | no timeout exists inside the app process; a hung handler keeps the process-side write mutex (`state.exclusive`, entrypoint/state.ts:44) after core has released its lane (service.ts:430) at the 120 s timeout | app |

Causes behind **F1** (what the app process produces at `status:"error"`; code, exact message, log):
| id | path:line | cause | code / message | app log | class |
|---|---|---|---|---|---|
| F1a | invoke.ts:117 | operation name not in the process's loaded declaration (and not a subscription handler for an event caller) | not_found "operation is not declared" | none | state/platform (core's lookup said declared, process disagrees: release mismatch) |
| F1b | invoke.ts:125 | command not in declaration | not_found "command is not declared" | none | same |
| F1c | invoke.ts:127-129 | command input fails the declared `inputSchema` (`validateInput`) | invalid_input `<validateInput message>` | none | contract (input shape; schema citable). Note: the only input shape check is here, in the app process, after the row is begun |
| F1d | invoke.ts:134-136 | declared but no handler registered | not_found "handler is not registered" | none | app |
| F1e | invoke.ts:169-171 | sync app's `syncedWrite` failed | `{code, message}` of the sync error | none | unclear |
| F1f | invoke.ts:181-184 | changeset could not be read after the handler | internal "changeset could not be read" | none | platform |
| F1g | invoke.ts:187-191; invocations/context.ts:67-97 | handler threw `HandlerRejection` (SDK packages/sdk/cap-tool/rejection.ts:15-26; codes invalid_input, forbidden, conflict, unavailable; message cut to 200 chars) | that code + message | **none** (returns before `reportCaught`) | app (handler rejected on purpose) |
| F1h | invoke.ts:192-200 | handler threw anything else | internal "handler failed" (original message not returned: "원문은 내보내지 않는다") | yes **only if `instanceof Error`**: `reportCaught` -> broker `observe-exception` -> app log `exception <name>: <message>` + `  at path:line:col` lines carrying `invocation` id (invoke.ts:194; main.ts:93-114; permissions/broker/problems.ts:33-47). A thrown non-Error (string etc.) writes nothing | app |
| F1i | invoke.ts:203-204 | handler result not JSON (`isJson` false) | internal "result is not JSON" | none | app (or contract: lophn rule, JSON only) |
| F1j | invoke.ts:207-216 | result > `RESULT_MAX_BYTES` (command: control frame - 2 KiB; operation: 8 MiB - 1 KiB, limits.ts:45-48) | internal "result exceeds the size limit" | none | contract (size rule) or app: unclear |
| F1k | fit.ts:3-9 | response with changeset too large | not an error: ok/failed outcome stays, `changeset_dropped:"too_large"` added; core stores it in the summary (record.ts:47-49) | none | n/a |
| F1l | ledger.ts:147-158, :206-207 | core could not store the changeset (`too_large`, `release_full`, `unavailable`) | outcome unchanged, summary gets `changeset_dropped` | none | n/a |

Sync-lane exits (not `call`; same ledger): `inLane` (service.ts:630-673) used by phone push (`applyPhone` :678), folder import (`applyChanges` :751, `mergeSnapshot` :858) and held re-apply (`applyHeld` :957). Facts: sync not attached -> err unavailable "sync is not attached" (:567); release not active -> err conflict "the release is not active" (:575-579) -- both before any row; size -> err invalid_input "the changes exceed the size limit" (:767) no row; supervisor/process error after `begin` -> `closeFailed` (:600-614) writes row `failed` with summary `{outcome:"failed", error_code:<code>}` and returns the same err; app not a sync app -> row failed + invalid_input "the app does not sync its data" (:616-618); held -> row failed `error_code:"held"` (:717-732); skipped -> row failed `error_code:"skipped"` (:734-745, folder: `error_code:<status>` :833-838); abandon -> row unknown + err unavailable "the app is not running" (:649-655). Inconsistency: `applyPhone` (:712) and `applyChanges` (:819) close **any** supervisor error, including a lost connection, as `failed`; `mergeSnapshot` (:902-905) treats `unavailable` as unknown.

---

## 3. Per-caller entry table (non-screen callers)

`packages/core/apps/calls` consumers found by `grep -rn "path\.call\|\.path\.call\|appCallPath" --include=*.ts packages | grep -v "_test\|mobile"`: routes.ts:73,76 (route), apps.ts:544 (event deliver), runs.ts:261,279,283 (run service), views/call.ts:223 (screen, via wiring/apps.ts:411). That is the full list of production callers of `AppToolCallPath.call`. App-to-app and agent/CLI-preview enter via the route (routes.ts).

### 3.1 Agent app command tool (`lophn <slug> <command>`)
- Entry: `packages/core/lophn-agent/tools/app-tool/command.ts:115-125` `appCommandTool(...).handler` -> `readOf(ctx.core, appCallTool, {...})`; caller = `{kind:"agent", session, turn, tool_call}` (command.ts:73-80). Credential actor agent -> route `app.call_tool` -> H0/H1.
- Before the spine (none of these write an invocation row):
  1. `packages/core/lophn-agent/run-loop/prepare.ts:664-679` `dispatch`: `resolveAppCall` (`tools/lophn/resolve.ts:35-62`) parses argv against only the commands the agent may call *now* (assignment ∩ declaration ∩ public/private rule, command.ts:52-71). No hit: the call stays a `lophn` tool call and its handler answers (`tools/lophn/tool.ts:41-48`: parse error text, help text, `unknownCommandError`, or invalid_input "the call did not resolve to a command" :43).
  2. `packages/core/lophn-agent/tools/work.ts:121-165` `executeToolCall`: tool not in `ctx.listed` -> failure not_found "tool is not available" (:128); input check -> failure invalid_input `<message>` (:130-148, incl. "tool input was rewritten" :147); no handler -> failure unavailable "tool has no handler" (:152-157); run-loop Gate `askGate` (:162, :199-240): denied -> `not_executed` "tool call was denied (<reason>)" (:231); rejected / cancelled -> `not_executed`; gate unavailable -> failure "tool is unavailable" (:218). The Gate (human ask) is before the spine; the spine's own Gate (`gate.ts:69-84`, `judge` attended) runs again at H10.
- What the model sees:
  - Result `err` from the route (P1-P25 errors, T2/T3): `work.ts:165-189`. Message text is **dropped** except for invalid_input: `FAILURE_SUMMARIES` fixed sentences (work.ts:37-48): forbidden and not_found -> "tool target is not available"; unavailable -> "tool is unavailable"; internal -> "tool call failed"; conflict -> "tool call conflicted"; invalid_input -> "tool input is not valid: <message>" (:171-175). status `failure`.
  - Outcome (`resultOf`, command.ts:137-185): succeeded -> status success, summary "command <name> of <app> finished", content `{invocation, result}`; failed -> status failure, "command <name> of <app> failed" (+ missing-secret sentence), content `{invocation, error:{code,message}, missing?}`; denied -> status `not_executed`, "command <name> of <app> was not run", content `{invocation, denied:{code,message}}`; unknown -> status `uncertain`, "the result of command <name> of <app> is not known", content `{invocation, reason}`, pending note ("the read can be repeated" / "check the app before repeating this call"). So a denial reaches the model with the spine's code+message and `invocation` (null for P19-P21).
- Recorded: spine rows as in section 2. `executeToolCall` outcomes (`{kind, code}`, work.ts:36-39, 85-97) are returned to the loop; where/how they are stored in the session was not read.

### 3.2 CLI
- `lophn app call`: **does not exist.** `grep -n 'name: "app\.' packages/cli/commands/app.ts` lists app.read/tools/create/link_source/status/phone_target/sdk_status/sdk_decide/sdk_feature/logs/invocations/event_publications/take_in/sync_held/sync_resume; `grep -rn appCallTool packages/cli --include=*.ts` hits only `preview.ts`.
- Human `lophn <slug> <command>`: `packages/cli/commands/app-command.ts:58-75` -> `run.ts:71` `start` -> route `runStart` -> `packages/core/runs/service.ts:231` `startTool` (resolveApp via `runs.ts:236-245`, `store.create`; the call runs un-awaited, :250) -> `callTool` :254 -> `tools.call` at `packages/core/main/daemon/wiring/runs.ts:247-297`, which builds caller `{kind:"person", view_session:<run id>}` with `{actor:"user"}` (:278-282) for a human run. No Gate (person, service.ts:411).
  - Before the spine: flag/input parse (`appCommandInput`, app-command.ts:31-45), `loadAppCommands` (app list; unknown slug -> empty -> unknown command, :80-107), run creation. Nothing recorded as an invocation.
  - What the person sees: `finish` (cli/commands/run.ts:33-69): done -> result text; else `failed: <reason>: <message>`. Mapping `runs/service.ts:267-298`: route `err` -> reason `tool_denied`, message `<code>: <message>`; outcome denied -> `tool_denied` with message = denial **code only** (message dropped, :293); failed -> `tool_failed` `<code>: <message>`; unknown -> `tool_unknown` `<reason>`; thrown -> internal (:264-265). The run keeps `invocation` only for done/failed (:281, :289), not for denied/unknown.
- `lophn preview call`: `packages/cli/commands/preview.ts:152-205`. Reads `previewsGet`, then `appCallTool` with a preview target. Caller is `{kind:"agent", ...ctx.caller}` if `ctx.caller` is set, else **`{kind:"person"}` with no `view_session`** (:191-193) while `appToolCallerSchema` requires `view_session` (protocol/apps/calls/caller.ts:24) -> a human-terminal call would fail the zod parse at `dispatch.ts:485-488` ("invalid memory body"). Whether `ctx.caller` is ever undefined for this command was not checked. Output: `preview call of <name> <status> (<code>)` with `content.outcome`; route error is returned as is. Preview never writes a row (service.ts:345-346, :279).

### 3.3 Jobs (program)
- Entry: `packages/core/main/daemon/wiring/jobs.ts:151-196` `starter.start` -> `ctx.runService.start({kind:"tool", app, tool, input?}, origin={job, job_run})` -> `runs.ts:283-296`: caller `{kind:"program", job, job_run}`, auth `{actor:"program", program:{job, job_run}}`.
- Before the spine: scheduler/approval of the job (not read); `resolveApp`; run row. In the spine: `verifyCaller` caller.ts:131-152 (P8, P9); Gate is `ok(true)` for program (gate.ts:43). `kind` is always `command` (runs.ts:256), so operations never come from here.
- Result to the job: run state. Same mapping as 3.2 (`runs/service.ts:267-298`): denied -> `tool_denied` + denial code; failed -> `tool_failed`; unknown -> `tool_unknown`. How the job run page / notice shows it: not read.

### 3.4 Event subscription delivery
- Entry: `events/publish.ts:224-267` loop over `handed` subscribers calling `deps.deliver` = `path.call` (`main/daemon/wiring/apps.ts:544`) with `kind:"operation"`, `name:"on.<source>.<event>"`, `input: payload`, caller `{kind:"event", publisher, event, publication, trace_id, chain, parent_invocation}` and auth `{actor:"event", event:{..., parent}}` (publish.ts:229-253).
- Before the spine (all counted in the publication row `app_event_publications`, not in invocations): `subscribersOf` SQL on active releases' `subscriptions` (publish.ts:88-109); `audience` filter; `deps.running` -> `"running" | "none" | "down"` from a supervisor observation (apps.ts:529-543: ready + accepting + handler name registered; `down` is counted as `unreachable`); `checkCallChain` -> `refused` (publish.ts:184-187, :197).
- In the spine: `verifyCaller` P10/P11; lookup finds subscription handler as operation with effect `write`, `public:false`, `subscription:true` (routes.ts:305-317); Gate is `ok(true)` for event (gate.ts:45); operation rule passes for `event` (service.ts:311-312); loop/depth uses `parent` flight (service.ts:317-322).
- After: publish.ts:255-266 only acts on `!delivered.ok` (route-level `err`) or a throw: `deps.failed(...)` -> core logger **warn** `component:"apps/events", event:"delivery_failed", fields:{app, name:event, message}` (apps.ts:553-559). Outcomes `denied`, `failed`, `unknown` (returned as `ok`) are ignored: no log; only the invocation row, if one was written, records them (and P19-P22-type denials have none).

### 3.5 App-to-app calls
- Entry (app side): `packages/sdk/cap-tool/connect.ts:158-201` `connectCommands(...).call(name, input)` -> `host.post("/_lophn/broker/apps/call", {target_app, command, input?, parent_invocation: currentContext()?.invocation ?? null})` (:173-178). SDK-local results: `forbidden "command is outside the connection"` (:167), `unavailable "app calls are not available"` (:170), a thrown `post` -> `ok:true` outcome unknown `connection_lost` (:179-188, even when nothing was sent), non-200 -> `AppError` from the body or `unavailable "request failed"` (:189, :91-110), body mismatch -> "response did not match" (:197).
- Hop: broker endpoint `packages/core/apps/permissions/broker/server.ts` (credential mismatch -> unauthorized; blocked connection -> unavailable "broker is closing"; body too large / not JSON / not object -> invalid_input; `process_nonce`/`mode` mismatch -> unauthorized; thrown -> internal) -> `permissions/broker/apps-call.ts:30-61` (invalid body -> invalid_input "apps call input is invalid" :32; non-live child -> forbidden "only a live app process calls other apps" :35-40; core reply not matching schema -> internal "core answered the app call badly" :59) -> `assembly.ts:393-408` `appCall` -> `asChild` (:356-390): no credential -> unavailable "the app has no credential"; core unreachable -> unavailable "core is unreachable"; non-200 -> code mapped by `errorCodeOf` (assembly.ts:219-244, **core `internal` becomes `unavailable`**), message from the core body or "core refused the request" -> core HTTP route -> H0/H1 with actor app (routes.ts:75-79).
- Caller sent: `{kind:"app", app:<child app>, release:<child release>, parent_invocation}` (apps-call.ts:46-51); `verifyCaller` P14-P17; Gate = active grant `app.call` covering that tool of that app (gate.ts:86-96); operation kind never allowed (D1 since `kind:"command"` is hard-coded, apps-call.ts:43, operations cannot be reached).
- Recorded: broker-hop rejections write no row and no log (`grep -rn "logger\|console\.\|append(" apps/permissions/broker/*.ts` hits only the exception writer problems.ts). The calling app's own invocation row (the parent) stays; the failed child call leaves no trace unless the callee row exists.
- What the calling app code sees: `AppResult<CallOutput>`; every spine outcome (including denied and unknown) is `ok:true` with `outcome`; only route/broker errors are `ok:false`.

### 3.6 Workflow / flow instances
- Entry: `packages/core/main/flow-host/host.ts:142-185` `runOutcome` -> `deps.runs.start({kind:"tool",...}, origin={instance, creator})` -> `runs.ts:260-274`: caller `{kind:"flow", instance}`, auth `{actor:"flow", flow:{instance, agent:origin.creator.agent, workspace:origin.creator.workspace}}`.
- In the spine: `verifyCaller` P12/P13; Gate at gate.ts:46-68: `judge(app_tool, assignment, ..., "unattended")` deny -> D4; else public tool allowed; else only if the creator's workspace is that app (:65-67).
- Result to the flow: host.ts:181-182: run `failed` -> `failure(run.error.reason, run.error.message)` (same reason/message mapping as 3.2: e.g. reason `tool_denied`, message = denial code; `tool_failed` with `<code>: <message>`); `start` error -> `failure(code, message)` (:169).

### 3.7 Phone sync apply (and folder import, held re-apply)
- Not through `call`. Phone: `packages/core/apps/sync/service.ts:55-101` `push` -> `deps.phone.apply` -> `service.ts:678` `applyPhone` -> `inLane`. Caller recorded `{kind:"person", view_session:<change id>, device}` (service.ts:697-701), operation name from the phone (`input.operation`), `input_hash: null`.
- Before: `deviceOf` -> forbidden "only a paired device can sync" (sync/service.ts:37-39, :60); `activeOf` -> not_found "app not found" (:48); `active.value !== input.release` -> conflict "the release is not active" with `details.active_release` (:65-70); not a phone app -> invalid_input "the app does not run on the phone" (:71-76). No row for these.
- Folder: `packages/core/folder/import/apply.ts:99,155` -> `applyChanges` / `mergeSnapshot`, caller `{kind:"person", view_session:<change id|"snapshot:<n>">, machine}` (service.ts:796-800, :874-878). Held re-apply `applyHeld` (service.ts:957), caller supplied by its route (not traced).
- Errors and rows: see sync-lane paragraph at the end of 2d.

### 3.8 Screens (listed only because they enter the same path; owned by another survey)
- `packages/core/apps/views/call.ts:195-261` `callView`: caller `{kind:"person", view_session:<view id>}`, `{actor:"user"}`. It writes a `call_rejected` app log line when the call did not produce a row that "already tells the failure" (`logRejected` :166-193, :257-260). Not repeated here.

### 3.9 Other callers searched
- Any other production site that builds `ToolCallInput`: `grep -rn "ToolCallInput\|AppToolCallPath" --include=*.ts packages -l | grep -v "_test\|mobile"` lists `ports.ts, calls/service.ts, calls/caller.ts, permissions/broker/apps-call.ts, routes.ts, views/ports.ts, events/publish.ts, main/daemon/wiring/context.ts, protocol/apps/calls/call.ts, protocol/lophn-agent/tool-calls.ts`. No further caller found. The doc's coding-agent MCP path (app-call.md:292, "person caller and preview-only credential") has no producer in code (see P1). Phone `apps/call_tool` is explicitly not in the remote allowlist (`packages/protocol/remote/allowlist.ts:138`), phone goes through `app_views.call`.
- App start is the only other writer of rows with a non-call operation (`routes.ts:339-416`, `operation.kind:"start"`, caller null).

---

## 4. Recording rules as implemented

When a live call leaves a ledger row (service.ts):

| case | row | deciding lines |
|---|---|---|
| preview target | never | service.ts:279 `if (target.mode === "preview") return callPreview(...)`; comment :345-346 ("preview does not use the ledger"); outcome built :371-374 with `invocation: null` |
| rejected before the id is minted (P1-P25) | never | no `deps.ledger` use before :296 |
| `app_archived`, `not_declared` (live) | never, outcome has `invocation: null` | :276, :288, :291 |
| denied: operation by non-person/event; call_loop; call_too_deep; Gate deny | yes, one `recordOnce` row, status `denied`, `started_at` null, `finished_at` set | :198-212 `recordDenied`, :309-322, :419 |
| read, handler reached, **success** | never | :487-490 `// 성공한 읽기는 기록을 남기지 않는다.` / `if (settled.status === "succeeded") return ok({ invocation: null, ... })` |
| read, failed / unknown / not sent | yes, one `recordOnce` row written at the end (`settleRead` :533-548; not-sent :457; abandon :511-519) | :423, :456-457, :488-491 |
| write/external | row `running` is begun **before** sending (`ledger.begin`, :444-449), then `finish` to succeeded/failed/unknown (:458-479, :520-526) | :423-428 queue, :444 `if (record)` |
| write/external, `sent:false` | row exists with status `failed`, summary `{outcome:"denied", error_code:"app_unavailable"}` | :458-466; `finish` status type excludes `denied` (ports.ts:117) |
| write/external, thrown error in `execute` | row left `running` until core restart closes it as unknown | no try/catch :440-492; restart.ts:82-105 |
| effect `read` with a changeset | rejected by ledger (invalid_input "a read has no changeset") | invocations/ledger.ts:135-140 |

Row contents (what is stored):
- `input_hash`: `await fingerprint(input.input ?? null)` (service.ts:304) = `sha256Hex(canonicalize(value))` (`packages/base/hash.ts:12-14`) of the raw input as sent by the caller, or of JSON `null` when no input. For sync-lane rows it is `null` (service.ts:703, :802, :880, :993). The app process computes a different hash, `inputHashOf(validated input)` (entrypoint/cap-host.ts:104), only for the broker context (invoke.ts:153); it is not written to the ledger.
- `summary` (`record.ts`, `invocations/model.ts`): `{outcome:"succeeded"}`, `{outcome:"failed", error_code:<app code>}`, `{outcome:"denied", error_code:<denial code>}`, `{outcome:"unknown"}` (no reason; reason `core_restarted` + `observation` + `evidence` only from restart.ts:92-98), each optionally plus `changeset_dropped`. Sync lane adds `error_code:"held"|"skipped"|<result status>`. The error **message** is not stored (record.ts:57-65). Summary passes `redactSummary` (keys secret/token/password/credential/authorization/cookie -> replaced, model.ts:54-78) and must be <= 16 KiB (`INVOCATION_SUMMARY_MAX_BYTES`, protocol/apps/invocations.ts:6).
- `detail_hash`: always `null`. `grep -rn "detail_hash" --include=*.ts packages | grep -v "_test\|mobile"`: every write is `detail_hash: null` (service.ts:462,476,524,594; record.ts:86; routes.ts:406); the column, schema check and `finish` parameter exist (invocations/schema.ts:28,41; ledger.ts:61,176) but nothing sets a value.
- Input body and result body: **not stored** anywhere in the ledger. `CallRecordBase` comment: "does not hold the input and output body" (record.ts:9). Result and error body reach only the caller. The `changeset` blob (bytes of DB changes for write/external, `changeset_hash`/`changeset_size`) is the only body-like data stored, subject to size/release caps (`changesetVerdict`, model.ts:44-51).
- `caller`: full caller JSON as supplied (agent: session, turn, tool_call; program: job, job_run; flow: instance; event: publisher, event, publication, trace_id, chain, parent_invocation; person: view_session [+ device/machine]; app: app, release, parent_invocation) plus extracted `caller_kind`, `session`, `turn` columns (invocations/store.ts:68-100). `operation` = `{kind:"operation"|"command", name}`. `release` is NOT NULL (hence no preview rows). `mode`, `effect` stored.
- Rows are immutable after finish except `reverted_by` and changeset pruning (schema trigger invocations/schema.ts:48-72). A row cannot be recorded twice (`begin`/`recordOnce` conflict "invocation already exists", ledger.ts:118-119, :229-230; `finish` conflict "invocation is already finished", :184).
- Persisted outside the ledger: nothing about calls in the app log except SDK/supervisor lines (F1h exception lines with `invocation`, `reportProblem` lines with `[inv=]`, `process_exit ...` lines with `invocation: null`); console output of handlers has `invocation: null` (app-call.md:216, consistent with main.ts:69 `currentInvocation: () => null` for the process-level exception observer; only runtime-caught handler throws carry the id).

---

## 5. Counts

Counted sites are the distinct `path:line` exits of `call`/`caller`/`run`/`execute` (section 2a-2b plus U1/U2/F1/R1 as outcome sites), not the causes behind them.

By what the caller of `path.call` receives (rows P1-P25, D1-D7, T1-T5, U1, U2, F1; R1 excluded because no caller receives anything):
- err `forbidden`: 12 (P1, P2, P3, P4, P6, P7, P9, P11, P13, P15, P16, P17)
- err `invalid_input`: 6 (P5, P8, P10, P12, P14, P24)
- err `not_found`: 1 (P18)
- err passthrough (code set by the port that failed): 12 sites = P25 (6: caller.ts:108, caller.ts:205, service.ts:271, :287, :358, :418) + T2 (:449) + T3 (:210, :546) + T4 (:465, :479) + T5 (:527)
- thrown exception reaching dispatch: 1 (T1)
- outcome `denied`: 12 sites (gate_blocked 2: D1, D4; call_loop 1; call_too_deep 1; app_archived 1: P19; not_declared 3: P20, P21, P22; app_unavailable 4: D5, D6, D7, P23)
- outcome `unknown`: 2 sites (U1, U2), both reason `connection_lost`; the other three declared reasons `unavailable`, `core_restarted`, `timeout` (protocol/apps/calls/call.ts:63-68) are never produced: `grep -rn 'reason: "timeout"\|reason: "unavailable"\|"core_restarted"\|status: "unknown"' packages/core --include=*.ts` shows only service.ts:514,521 and record.ts:38,40 for call outcomes
- outcome `failed`: 1 site (F1) fed by 10 distinct app-process cause rows (F1a-F1j; F1k/F1l are not exits)

Total distinct exit sites: 47 (12 + 6 + 1 + 12 + 1 + 12 + 2 + 1 = 47).

Exits that leave **no ledger record at all**: 33 = err sites with a known code (P1-P17 = 17, P18, P24 => 19) + passthrough err sites that cannot have a row (caller.ts:108, :205, service.ts:271, :287, :358, :418, :210, :449, :546 = 9) + denied outcomes without a row (P19, P20, P21, P22, P23 = 5). Exits that leave a closed row: 10 (D1-D7, U1, U2, F1). Exits that leave a row stuck `running` or ambiguous: 4 (service.ts:465/:479 = T4, :527 = T5, and T1 after `begin`). 33 + 10 + 4 = 47. Of the 33, 2 are preview-only denials without a row by design (P22, P23) and 2 are unreachable outside tests (P1, P2).

Same code+message produced for different fault classes:
1. `denied(app_unavailable)` "the app is not running" (service.ts:152): covers state (C1 core/supervisor not ready, C7 app off/starting/stopping, C8 release switched, C10 socket closed, C12 process not accepting, C16 release race, D5 activation abandon) AND platform (C2 pipe write failure, C3 supervisor op error incl. "invalid op input" and "op failed", C4 bad supervisor answer, C14 body not JSON, C15 lophn's own hand-copy parser rejecting lophn's own message). This is the exact collision: an internal hop's rejection of lophn's message and "app is off" are the same outcome, same text, same code, and the underlying error is discarded at service.ts:456 (and :370).
2. `denied(not_declared)` "the app does not declare this operation or command": contract (undeclared name, P20/P21) and state (app/release has no active declaration, routes.ts:297; preview not running, P22).
3. `denied(gate_blocked)` "the call is not granted": contract (D1 operation rule, D4 missing grant/assignment) and state (grant revoked or assignment changed between calls; D4).
4. outcome `unknown` `connection_lost`: app crash/hang (U2a, U2g, U2h), platform (U2b, U2c, U2d, U2f), state (U1, U2e).
5. `failed` code `internal`: app (F1h "handler failed", F1i "result is not JSON", F1j "result exceeds the size limit") and platform (F1f "changeset could not be read") share code `internal`; messages differ. `failed not_found` is produced both by app-process declaration mismatch (F1a/F1b "... is not declared") and by `HandlerRejection`-less missing handler (F1d); the core-side twin of F1a/F1b is `denied(not_declared)`, a different outcome status for the same fact.
6. err `forbidden` "unknown tool call" (P6) and "unknown parent invocation" (P17) mix contract and state.
7. status `denied` rows (reads, D6) vs status `failed` rows with summary outcome `denied` (writes, D7) for the same cause (app not running).

---

## 6. Not verified / surprises

Not verified (not opened or not conclusive):
- How agent `executeToolCall` outcomes are persisted in the session (`tool_calls`) and shown in the shell.
- `dispatch.ts` `scopeAllowed` placement for memory routes (defined :215, called :305 and :542 for other route kinds; not seen in the `memory()` path I read).
- The `onThrown` hook content, `asInternalError` exact message.
- Error codes of `CallerDirectory.agentToolCall`, `assignmentOf`, `appGrantsOf`, `ledger.begin/finish` storage failures.
- `cap-host.ts` post path in the app process for app-to-app (`BrokerClient.appsCall`, broker-client.ts:52-58) and its failure modes.
- The job run's own presentation of a failed tool run, and the job approval checks before `starter.start`.
- Whether `ctx.caller` is undefined for `lophn preview call` run from a plain terminal.
- Which component reaches `app.logs` rows with `invocation` set for `reportProblem` in preview (not relevant to live spine).
- Supervisor internals beyond the `apps.call` op (restart policy, memory observers), SDK `cap-store` and other capability errors that a handler may rethrow.

Surprises / contradictions with `project-docs/architecture/app-call.md`:
1. Doc "지키는 것" 호출 경로 (app-call.md:148): "failed reads and denied calls are recorded". In code only denials from `gate_blocked`, `call_loop`, `call_too_deep` and pre-send `app_unavailable` are recorded; `app_archived`, `not_declared` (live and preview) and every `err` before the id is minted are not (P1-P25).
2. Doc (:147): "blocked before sending (app stopped, no connection) is distinguished as `unavailable`". Code returns outcome `denied(app_unavailable)`, not an `unavailable` error code, and the underlying `error` is dropped (service.ts:456-467, :370). For writes the row status is `failed` (D7), for reads `denied` (D6).
3. Doc (:245) lists the block codes `gate_blocked`, `call_loop`, `call_too_deep`, `app_archived` (plus `unknown` and `unavailable`). The code's `ToolDenial` codes also include `not_declared` and `app_unavailable` (protocol/apps/calls/call.ts:49-56, service.ts:145-152), and `app_unavailable` is an outcome, not an error code `unavailable`.
4. The app process's own rejections (wire parser 400, 503 not accepting, 409 mismatch) look like "app is not running" to every caller (C11-C16). This is the described bug class ("rejected by a lophn-internal hop before reaching the app"): the message and rejection reason exist in `relay.ts:107-139` (`rejectionOf`) and are then discarded.
5. `protocol/apps/calls/call.ts:63-68` declares unknown reasons `unavailable`, `core_restarted`, `timeout`; only `connection_lost` is produced (record.ts:40).
6. `ports.ts` doc comment for `AppToolCallPath` (ports.ts:42-52) says program/flow are judged by the creator's assignment; `gate.ts:43` returns `ok(true)` for program without any judgment (matches app-call.md :114, contradicts the ports.ts comment).
7. `previewOnly` auth and the "coding agent MCP preview call" (app-call.md:292) have no production producer (P1/P2).
8. App log doc (:216): "only SDK invocation-context lines carry invocation (`reportProblem`, uncaught exception)". Code: runtime-caught handler throws (`reportCaught`, invoke.ts:194) carry the id; the process-level uncaught exception observer is created with `currentInvocation: () => null` (main.ts:69). So exceptions that escape the runtime lose the id; handler throws caught by `handleCall` keep it.
9. `HandlerRejection`, JSON-result and size-limit failures write nothing to the app log; only non-`HandlerRejection` `Error` throws are reported (F1g-F1j).
10. Admission wait has no timeout (intake.ts:62-68): a call made while activation holds intake blocks inside `call` before an id exists, and the caller sees nothing until it opens.
11. `lophn preview call` human path builds a caller that violates the caller schema (see 3.2).
12. Unlogged but observable: event delivery is the only spine-adjacent place that writes a core log line (`delivery_failed`, apps.ts:553-559) and only for route-level `err`, not for denied/failed/unknown outcomes.

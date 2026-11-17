# Survey: app screen call, from the page to core's call path

Scope: everything between an app's screen code and `ports.path.call` (core), on desktop and phone, plus opening a view, the other page-to-main channels, and preview vs live. Static reading only (nothing was run). Branch `docs/call-record-roadmap`. All paths are relative to the repo root; line numbers are from files I opened.

Vocabulary used in tables:
- "app log" = the app's log file written through core `apps.append_log` (`packages/core/main/app-supervisor/assembly.ts:968-973`), text cut to 300 chars and redacted (`packages/core/apps/runtime/observations/log-file.ts:46`).
- "shell log" = shell main `log()`, which is `console.log("[lophn] ...")` (`packages/shell/main/desktop/wiring/context.ts:190`). I did not find where (or whether) it goes to a file.
- "invocation" = the call path's ledger row. Not read beyond `callPreview`/`call` entry (another surveyor).
- Fault class: app / contract / platform / state / unclear.

---

## 1. Hop maps

### 1A. Desktop: live or preview screen -> `ports.path.call`

| # | Hop | File: function (line) | Ids that exist here | Boundary / validation / transform |
|---|---|---|---|---|
| 0 | Page code | SDK `useOperation.run` -> `app.callOperation(operation.name, input)` (`packages/sdk/app-ui/use-operation.ts:62`) | none (page does not know its app, `app-ipc.ts:2`) | none; `input` is whatever the app passed |
| 1 | Context bridge | `contextBridge.exposeInMainWorld("lophnApp", createAppTool(transport, location.search))` (`packages/shell/preload/app.ts:22-25`) | none | main world -> isolated world argument copy (Electron behavior, not verified). Comment at `packages/shell/preload/views-api.ts:27` says contextBridge does not carry Error properties other than the message |
| 2 | Preload | `callOperation` (`packages/shell/preload/app-tool.ts:298-299`) -> `request` (`:69-85`) | none sent | builds `{operation, input}` with no check. `transport.invoke` = `ipcRenderer.invoke` (`preload/app.ts:13-14`) |
| 3 | Electron IPC | channel `app:call-operation` (`packages/shell/ipc/app.ts:5`) | `event.sender.id` (webContents id), `event.senderFrame` | structured clone, so `undefined` properties survive (`app-call.ts:185-187`). A non-cloneable value makes `invoke` reject (not verified at runtime) |
| 4 | Main IPC guard | `registerAppIpc` handler (`app-ipc.ts:95-98`) -> `senderView` (`:67-87`) | webContents id -> registry `byContents` (`registry.ts:490, 494-500`) -> `BoundView {view_session, generation, target{app,mode,release,screen,place}, binding{release,bundleHash,processNonce}}` (`view-model.ts:30-35`) | checks sender alive, main frame, page URL parses to this view's app host and same screen (`app-ipc.ts:83-86`). Else `NOT_APP_VIEW` |
| 5 | Main call service | `createAppCall.call` (`app-call.ts:209-235`), wired in `desktop/wiring/app-calls.ts:21-26,46` | `view.view_session` = `view-<uuid>` (`desktop/wiring/app-views.ts:115`) | `checkCall` (`app-call.ts:188-204`): object, only keys `operation`/`input`, `JSON.parse(JSON.stringify(input ?? null))`. **Transforms silently**: undefined fields dropped, NaN/Infinity -> null, Date -> string. `operation` is not type-checked. Builds `{view, operation, input}` |
| 6 | Core client (shell) | `ctx.coreInternal` (`desktop/wiring/context.ts:207-221`) -> `session.internal` (`desktop/core/client.ts:234-238`, bypasses the renderer allowlist) -> `rpc.call` (`packages/protocol/client/client.ts:67-122`) | Bearer user token only; no trace header set (`client.ts:78-92`) | (a) `route.input.safeParse(body)` = `appViewsCallInputSchema` strictObject `{view: string 8..64 no control char, operation: string, input: jsonValueSchema}` (`protocol/apps/views.ts:79-83`, `client.ts:72-77`) -> `invalid_input: invalid input`; (b) `JSON.stringify`; (c) `fetch` with no timeout/AbortSignal (`desktop/core/node-io.ts:8-14`); (d) non-200 -> `errorBodySchema` (`client.ts:102-109`, keeps `code,message,details,trace_id,hint`), else `request failed`; (e) output `z.strictObject({outcome: appViewOutcomeSchema})` (`views.ts:100`, `client.ts:116-120`) -> mismatch = `internal` |
| 7 | Core HTTP | `server.ts:165-177` (span, `x-trace-id` response header, `trace_id` in error bodies `request.ts:48-58`); `gateRequest` (`request.ts:~100-126`); `dispatchHttp` (`dispatch.ts:226-262`) | **trace_id** minted per HTTP request (accepts incoming `traceparent`, `server.ts:171`); `ctx.principal` = owner | headers size, POST, `readLimitedBody` 256 KiB (`request.ts:152,190,201,226` "body exceeds limit"), content-type (`dispatch.ts:258`), `invalid json` (`request.ts:237`), depth 16 (`:259` "json too deep"), 4096 items (`:269,286` "json too large") over the **whole** body `{view,operation,input}`; then `memory()` (`dispatch.ts:478-497`): `route.input.safeParse` again -> `invalid_input: invalid memory body` (`:487`). Output is **not** re-parsed on the server (`:496`) |
| 8 | Core view route | `appViewHandlers` (`core/apps/views/mod.ts:71-94`) -> `views.call` (`:284-294`) | owner = `ctx.principal`; `entry.view` | `table.get(owner, view)`; missing -> `not_found: view is not open` (`:289-291`) |
| 9 | Core call service | `callView` (`core/apps/views/call.ts:195-261`) | `entry.view`, `entry.binding.{release,process_nonce}`, `entry.args.{app,mode}`; builds `caller:{kind:"person", view_session}` (`:238`) | `checkCall` (`:23-50`): operation blank/trim/control/`*`; input `JSON.stringify` (reject undefined/throw), <= 64 KiB, JSON round trip equality; `lost` check (`:209-214`); `declaredEffect` lookup (`:129-155`, preview via `findPreview`); then `ports.path.call({target,kind:"operation",name,input,caller},{actor:"user"})` (`:223-244`) |
| 10 | **Stop**: `ports.path.call` | `core/apps/calls/service.ts:220+` (other surveyor) | invocation id minted in path (`service.ts:297`) | I note only: `path.call` is typed `ToolCallInput`, no zod parse in the function; `checkSize` (`service.ts:331-342`, 254 KiB) cannot trigger from this entry because step 9 caps at 64 KiB |
| 11 | Result mapping | `outcomeOf` (`call.ts:91-126`), `coreFailure` (`:72-88`), `logRejected` (`:166-193`) | | maps outcome/denial/failure to `{ok,value}` / `{ok:false,error:{code,message}}` |
| 12 | Back in shell | `app-call.ts:229-235`; IPC reply; preload `replyOf` (`app-tool.ts:56-66`) then `request` throws `new Error("<code>: <message>")` (`:83`) | | preload re-validates the **shape of lophn's own reply** (ok boolean, error.code/message strings); transport reject or bad shape -> `unavailable: app bridge is unavailable` (`:77-82`) |
| 13 | Page SDK | `codeOf` (`use-operation.ts:34-37`) | | regex `/^([a-z_]+):/` on the message; fallback `"unavailable"` |

Identity summary on desktop: no call id exists anywhere. Per-call-ish ids that exist: webContents id (hop 3-4), `view_session` + `generation` (hop 4+), HTTP `trace_id` at core (hop 7, not returned to the page: `app-call.ts` uses only `.code`), invocation id (hop 10, only for calls that reach the path and are recorded; `callPreview` returns `invocation: null`, `service.ts:366-372`).

### 1B. Phone: guest page -> `ports.path.call`

| # | Hop | File: function (line) | Ids | Boundary / validation / transform |
|---|---|---|---|---|
| 0 | Guest page | same SDK `useOperation` (`app-ui-native/mod.ts:17-26` re-exports `app-ui/use-operation.ts`) | none | none |
| 1 | Guest bridge | `lophnApp.callOperation` (`packages/mobile/guest/bridge.ts:83-107`) | guest-local numeric `id` (`:48,101`) | `undefined` -> `null` (`:84`); `JSON.stringify` (throw -> `invalid_input: the input is not JSON`, `:86-90`); > 64 KiB -> `invalid_input: call input is over 64 KiB` (`:91-93`); `JSON.parse` round trip (`:94`); waits for `init` (`:95`) |
| 2a | Local branch (app runs on the phone, effect read/write in `init.local.operations`) | `runLocal` -> `run` (`packages/mobile/src/apps/guest/local-call.ts:263-341`) | local change id `ids.newId("chg")` used as `invocation` for the in-guest host (`:266,277`) | stays inside the guest; no core hop. Result JSON round trip (`:326-330`) |
| 2b | Host branch | `postMessage({type:"call", id, operation, input})` (`bridge.ts:101-104`) | `id` guest counter; sandbox `origin = "<view>:<time><rand>"` (`guest/screen.tsx:57-59`) | message crosses the sandbox as JSON (not verified how) |
| 3 | Host session | `GuestScreen onMessage={session.receive}` (`screen.tsx:122`) -> `createGuestSession.receive` (`apps/guest/session.ts:231-261`) | `view` prop only | `parsePhoneGuestMessage` (`protocol/apps/phone-screen.ts:209-233`): 8 MiB+1 KiB, JSON, `phoneGuestMessageSchema` (`:116-129`: `call{id:int, operation:string, input:jsonValueSchema + 64 KiB}`). **A failure returns silently** (`session.ts:234-235`) |
| 4 | View link | `linkView.call` (`apps/view.ts:125-136`), bound by `useAppScreen` (`apps/use-app-screen.ts:178`) | view id `view_<ULID>` from `newId("view")` (`use-app-screen.ts:63`), preview `usePreview` `useMemo` (`drive/use-preview.ts:59`) | builds `{view, operation, input}`; **no zod parse on the phone**; `core.call({kind, resource, method, body})` (`view.ts:53-69`); `not_found` -> `open()` then retry once (`:128-130`) |
| 5 | Remote link | `connection.call` -> `send` (`packages/remote-client/connection.ts:367-369, 299-318`) | frame id `c<n>` | `channel.send`: JSON, `REMOTE_FRAME_MAX_BYTES` (`protocol/remote/channel.ts:246-251` -> `invalid_input: remote frame too large`); at most 8 in flight, others queued (`connection.ts:57,368-369`); pending map resolves only on a result frame or `lose()` (`:264-272`); **no per-call timeout** |
| 6 | Core remote | `host.ts:195-217` -> `createRemoteCall` (`core/remote/call.ts:132-187`) | principal/owner `device:<id>` (`call.ts:28-30`) | route lookup (`not_found: route not found`), credential revalidate, `authorize` against `REMOTE_ALLOWED_ROUTES` (includes `app_views/*`, `allowlist.ts:136`), `admission.enterHttp`, builds a `Request` with `JSON.stringify(call.body ?? {})` and runs the **same `dispatchHttp`** as hop 7 above. It does not go through `server.ts` (no span/trace id: grep `startSpan|traceId|trace_id` in `packages/core/remote` returned nothing). Errors are reduced to `{code,message}` (`host.ts:~214-224`) |
| 7 | Core view table | same as 1A hops 8-11 | | same code and logging (`logRejected` writes the app log for live views regardless of owner) |
| 8 | Back | `view.ts:131-135` -> `session.reply` (`session.ts:227-229`) -> `post({type:"reply"})` (`screen.tsx:83`) -> guest `setOnMessage` (`bridge.ts:65-72`) rejects `new Error("<code>: <message>")` | | reply is posted only if `live()` and `ref.current` exists. `parsePhoneHostMessage` exists (`phone-screen.ts:232`) but grep shows no caller (`grep -rn "parsePhoneHostMessage" packages`: only the definition) |

Phone identity summary: guest-local `id`, view id `view_<ULID>`, frame id `c<n>`, device principal. No call id; no trace id.

---

## 2. Exit table

"Page receives" is exactly what the page sees: desktop `Error("<code>: <message>")` from `callOperation`; phone `Error("<code>: <message>")` from the guest bridge. "Recorded" lists only what I found by reading.

### 2A. Desktop call (`app:call-operation`)

| ID | path:line | function | condition | page receives | recorded | class |
|---|---|---|---|---|---|---|
| DC1 | `preload/app-tool.ts:77-83` | `request` | `invoke` rejects (non-cloneable arg, main handler threw, no handler registered, destroyed) or reply fails `replyOf` | `unavailable: app bridge is unavailable` | none | unclear: same text for app input that cannot be cloned (contract) and for lophn handler failure (platform) |
| DC2 | `main/app-frame/app-ipc.ts:89-92,96-97` | `senderView` | sender destroyed / not a registered live view / not main frame / URL not this view's app+screen (also an old guest after remount, `registry.ts:213-219`) | `forbidden: sender is not an app view` | none | state (view replaced or page navigated); unclear if a sub-frame sends |
| DC3 | `app-call.ts:215-218,210-214` | `call` / `checkCall` | not object, array, key other than `operation`/`input`, `JSON.stringify` throws (BigInt, cycle) | `invalid_input: call is invalid` | `callRejected` -> core `app.log_view_error` -> app log line `view_error call_rejected <op or (invalid operation)>: invalid_input: call is invalid` for **live** (`view-error.ts:348-362`, `core/apps/runtime/view-errors.ts:30-48`); shell log line `view <id> generation=N view-error call_rejected app=.. mode=.. [unsent]` (`view-error.ts:380-384`). Preview: shell log only (`view-errors.ts:36-39` returns `written:false`). Rate limit 20/min per view shared with page errors (`view-error.ts:313-328`, dropped silently) | contract |
| DC4 | `app-call.ts:232` | `call` | core replied `invalid_input`. Sources: (a) client schema `invalid input` (`client.ts:75-77`): `operation` not a string, lone-surrogate string (jsonValueSchema -> canonicalize `canonical-json.ts:1-14`), view id; (b) dispatch `body exceeds limit` / `json too deep` / `json too large` / `invalid memory body` (`request.ts`, `dispatch.ts:487`); (c) core `checkCall` `call is invalid` (`call.ts:201-204`: blank/space/control/`*` operation, input > 64 KiB) | `invalid_input: call is invalid` (original reason is lost) | same as DC3 (the log line is written by shell main, since core's `callView` returns before `logRejected`, `call.ts:201-204`, and `mod.ts:289` path) | unclear: (c) and operation-not-string are contract; (a) view-id/schema and (b) depth limit mix app input with lophn's own message; same text |
| DC5 | `app-call.ts:233-234`; core `views/mod.ts:289-291` | `call` | core `not_found: view is not open` (core restarted, evicted, closed) | `unavailable: app is not available`; `resume` kicks `refreshEntry` (`registry.ts:301-304`) but this call is **not** retried | none (core returns before `logRejected`) | state |
| DC6 | `app-call.ts:225-228,234`; `desktop/core/client.ts:236,121-126`; `wiring/context.ts:215-220`; `protocol/client/client.ts:94-101,102-109,116-120`; `dispatch.ts:491` | `call` | any other core error: `core is not ready`, `transport failed`, non-200 with code, `request failed`, schema mismatch -> `internal`, `route unavailable`, `forbidden: 허용되지 않은 호출이다` (allowlist), `unauthorized`, thrown `.catch` | `unavailable: app is not available` | none at this layer. Core `server.ts:196-203` logs `request_threw` only for throws escaping a handler | unclear: platform (transport, internal, schema) and state (core restarting) share text |
| DC7 | `core/apps/views/call.ts:209-214` | `callView` | `entry.lost !== null` (`app_stopped`, `app_archived`, `conflict`, `evicted`; `table.ts:250-258`) | `unavailable: app is not available` | live: app log `view_error call_rejected <op>: unavailable: app is not available (view lost: <reason>)`, dedup per (op,message), at most 32 per binding (`call.ts:160,178-185`, cleared on rebind `table.ts:236-238`). Preview: none (`call.ts:173`) | state |
| DC8 | `call.ts:215-221` | `callView` | declaration lookup returned an error | `unavailable: app is not available` | live: same log with `(declaration: <code>)`; preview none | platform |
| DC9 | `call.ts:222,59` | `callView` | operation not declared in the bound release (also subscription handlers, other app's operations) | `forbidden: operation is not available` | live: app log `.. forbidden: operation is not available`; preview none | contract |
| DC10 | `call.ts:74-75` | `coreFailure` | `path.call` returned `invalid_input` (e.g. `service.ts:340-343`, `caller.ts` verifyCaller) | `invalid_input: call is invalid` | live: app log `.. (call path: invalid_input)`; preview none | platform: the path rejecting lophn's own message; same text as DC3/DC4 |
| DC11 | `call.ts:76-78` | `coreFailure` | `path.call` returned `forbidden` or `unauthorized` (e.g. "a call cannot claim a device or a machine", `service.ts`) | `forbidden: operation is not available` (the same constant as DC9) | live: app log `.. (call path: forbidden)`; preview none | unclear: same text as DC9 (contract) but this is lophn refusing |
| DC12 | `call.ts:79-80` | `coreFailure` | `path.call` returned `conflict` | `conflict: the app view changed` | live: app log; preview none | state |
| DC13 | `call.ts:81-86` | `coreFailure` | `path.call` returned any other error (not_found, unavailable, internal, `.catch` -> `core call failed`), effect read | `unavailable: app is not available` | live: app log `(call path: <code>)`; preview none | unclear: platform/state, same text as DC6/DC7/DC8 |
| DC14 | `call.ts:81-86` | `coreFailure` | same as DC13 with effect write/external | `unavailable: result unknown` | live: app log; preview none | unclear (same text as DC21) |
| DC15 | `call.ts:103-104` | `outcomeOf` | succeeded but result > `CALL_RESULT_MAX_BYTES` 8 MiB | `unavailable: result is too large` | live: app log (invocation says succeeded, `call.ts:255-260`); preview none | unclear: the app broke a lophn size rule (contract) but the code is `unavailable` |
| DC16 | `call.ts:107-111`; app side `core/apps/runtime/entrypoint/invoke.ts:61-67,83-95,190-216` | `outcomeOf` | outcome `failed` with `{code,message}` strings. Includes app handler errors (HandlerRejection code+message; any other throw -> `internal: handler failed`, `invoke.ts:200`) **and runtime-generated errors in the same shape**: `not_found: operation is not declared`, `not_found: handler is not registered`, `internal: result is not JSON`, `internal: result exceeds the size limit`, `invalid_input` for commands only | `<code>: <message>` verbatim | invocation by the path (not read); no app log line from this layer (`call.ts:257-260`); app log gets the caught exception via `reportCaught` (`invoke.ts:190-196`, not read further) | app for handler errors; platform for the runtime-generated ones. The page cannot tell them apart |
| DC17 | `call.ts:112` | `outcomeOf` | `failed` but error is not `{code:string,message:string}` | `unavailable: app response did not match` | live: app log if no invocation | platform |
| DC18 | `call.ts:114-120` | `outcomeOf` | `denied` `gate_blocked` (Gate decision, `service.ts:419`) / `not_declared` (`service.ts:288,291`; rarely reached because DC9 stops undeclared names first) / unknown code | `forbidden: the call is not granted` / `forbidden: the app does not declare this operation or command` (messages `calls/service.ts:145-152`) | `gate_blocked`: denied invocation row (`recordDenied`, with id). `not_declared`: `invocation: null` (`service.ts:288,291`), so for live the app log line is written (`call.ts:257-260`) | contract (missing grant, undeclared) |
| DC19 | `call.ts:62-69,114-120` | `outcomeOf` | `denied` `call_loop` / `call_too_deep` | `conflict: <message>` | invocation | state/unclear (cannot arise for a person caller; not verified) |
| DC20 | `call.ts:62-69,114-120` | `outcomeOf` | `denied` `app_archived` / `app_unavailable` | `unavailable: the app is archived` / `unavailable: the app is not running` | `app_archived`: `invocation: null` (`service.ts:276`) so live app log line. `app_unavailable`: denied invocation row with id in live (`service.ts:402,457-466`), `invocation: null` in preview (`service.ts:370`) | state |
| DC21 | `call.ts:121-122` | `outcomeOf` | outcome `unknown` (reasons `unavailable|connection_lost|core_restarted|timeout`, `calls/call.ts:~56-61`) | `unavailable: result unknown` (reason dropped) | invocation | state/platform; reason is not passed on |
| DC22 | `call.ts:123-124` | `outcomeOf` | unknown `status` | `unavailable: app response did not match` | live: app log | platform |

No timeout exists on the shell side: `nodeFetch` has no AbortSignal (`node-io.ts:8-14`), `app-call.ts` has no timer, core's view table has no timer. (Timeouts inside the path/app process are another surveyor's.)

### 2B. Phone call

| ID | path:line | function | condition | page receives | recorded | class |
|---|---|---|---|---|---|---|
| PC1 | `guest/bridge.ts:86-90` | `callOperation` | `JSON.stringify` throws | `invalid_input: the input is not JSON` | none | contract |
| PC2 | `guest/bridge.ts:91-93` | `callOperation` | input > 64 KiB | `invalid_input: call input is over 64 KiB` | none | contract |
| PC3 | `guest/bridge.ts:98` | `callOperation` | `init.local` says read/write but no runner | `unavailable: this screen has no app database` | none | platform |
| PC4 | `apps/guest/local-call.ts:269-272` | `run` | `db.beginCall()` throws | `unavailable: <db message>` | none | platform |
| PC5 | `local-call.ts:304-308,202` | `run` | local call still running after 3000 ms (rolled back) | `unavailable: <op> did not finish within 3000 ms` | none | unclear: slow app handler vs platform limit |
| PC6 | `local-call.ts:309-314` | `run` | `db.endCall` throws | `internal: <message>` | none | platform |
| PC7 | `local-call.ts:210-217,324` | `failure` | local handler threw | `<code>: <message>`: HandlerRejection code, else `internal: <the thrown message>` (here the message is passed through, unlike desktop's `handler failed`) | none (only `console.warn` for a read that changed data, `:319-321`) | app |
| PC8 | `local-call.ts:326-330` | `run` | result not JSON | `internal: the result of <op> is not JSON` | none | app |
| PC9 | `apps/guest/session.ts:232-235` | `receive` | host drops the message: not live, not a string, `parsePhoneGuestMessage` fails (size, not JSON, shape, `jsonValueSchema`/canonicalize e.g. lone surrogate, `phone-screen.ts:209-233`) | nothing: **the guest promise never settles** (`pending` map in `bridge.ts:38`, no timeout) | none | unclear: contract (input rejected) or platform (schema mismatch), invisible |
| PC10 | `session.ts:227-229`; `screen.tsx:83` | `reply` | reply not posted when the session is closed/failed or `ref.current` is null | nothing (promise never settles) | none | state |
| PC11 | `session.ts:244-251` | `receive` | `options.call` rejects | `internal: <message>` | none | platform |
| PC12 | `apps/view.ts:127-136,64-69` | `call` | any non-ok core reply, after one reopen+retry on `not_found` | `unavailable: <core message>` — **every core code becomes `unavailable`**. Messages seen here include `not connected`, `connection closed` (`remote-client/connection.ts:297-302,266-272`), `remote frame too large` (`channel.ts:249-251`), `invalid memory body`, `json too deep`, `json too large`, `body exceeds limit`, `call is invalid` (`call.ts:203`), `view is not open` (when reopen fails), `route not found`, `internal error`, admission text, `String(thrown)` | none on the phone. Core writes nothing for these (they return before `logRejected`, or are rejected in dispatch). The phone has no route to `app.log_view_error` (`protocol/remote/allowlist.ts:136-139`; `grep -rn "log_view_error" packages/mobile packages/remote-client` empty) | unclear: contract (`call is invalid`, depth/size), platform (`internal error`, `remote frame too large`), state (`not connected`, `connection closed`, `view is not open`) |
| PC13 | `apps/local/use-local-screen.ts:48-49` | `away` | local app, view on computer not open | `unavailable: the computer is not reachable` | none | state |
| PC14 | `apps/local/store.ts:311-326` | `external` | computer unreachable / outbox push failed / app not installed / local changes not yet on the computer | `unavailable: the computer is not reachable` / `<push error message>` / `the app is not installed` / `local changes are not on the computer yet` | none | state |

Outcomes produced by core (DC7-DC22 above) reach the guest verbatim through `reply` -> `bridge.ts:69-70`; core's own app-log lines for live views apply to phone-owned views too (`call.ts:173` only checks mode). Preview phone views: `call.ts:173` writes nothing.

### 2C. Opening a view (D)

Desktop path: renderer `EmbeddedView` -> `views.openApp` (`renderer/app-frame/embedded-view.tsx:159`) -> preload `createViewsApi.call` (`preload/views-api.ts:28-41`) -> IPC `shell:view-open-app` (`ipc/app-frame.ts:18`) -> `createViewIpc.openApp` (`view-ipc.ts:356-363`) -> `appFrame.open` (`registry.ts:359-417`) -> `bindView` (`binding.ts:48-81`) -> core `app_views/open` (`views/table.ts:275-326`). The renderer gets **only the code** as `Error(code)` (`views-api.ts:36-39`); the message is dropped, and an invoke failure becomes `Error("unavailable")`.

| ID | path:line | function | condition | page (renderer) receives | recorded | class |
|---|---|---|---|---|---|---|
| OP1 | `desktop/ipc-guard.ts:86-104` via `view-ipc.ts:338-339` | `checkCaller` | sender not a live registered webContents / not main frame / URL mismatch | `forbidden` (message `sender is not a live registered webContents` / `sender is not the main frame` / `sender url does not match its registration` dropped) | none | platform |
| OP2 | `view-ipc.ts:340-349` | `guard` | caller not a desktop window | `forbidden` (`caller is not a desktop window`) | none | platform |
| OP3 | `ipc-guard.ts:110-131` via `view-ipc.ts:350-351` | `checkInput` | not serializable / > 64 KiB / `appViewOpenSchema` mismatch (`ipc/app-frame.ts:64-81`) | `invalid_input` | none | platform (renderer is lophn's own code) |
| OP4 | `registry.ts:365-371`; `view-model.ts:151-181` | `open` / `checkOpen` | second shape check (ids, mode, live needs release, place, card pairing) fails | `invalid_input` (`view request is invalid`) | none | platform |
| OP5 | `registry.ts:372-374` | `open` | window not open | `invalid_input` (`window is not open`) | none | state |
| OP6 | `registry.ts:389-394` | `open` | view bound in core, but the window closed meanwhile; core view closed | `invalid_input` (`window is not open`) | none | state |
| OP7 | `binding.ts:37-42`; core `table.ts:188-212` | `mapped` | core `invalid_input`: `the app has no such screen`, `the screen does not open in this place`, `params do not match the screen`; or client/dispatch `invalid input`/`invalid memory body` | `invalid_input` | none | contract for screen/place/params (app's declaration), platform for schema/dispatch |
| OP8 | `binding.ts:37-42` | `mapped` | core `forbidden` (credential scope) | `forbidden` | none | platform |
| OP9 | `binding.ts:37-42`; `table.ts:121-125,150-154,285-288,293-294,304-308` | `mapped` | core `conflict`: `the preview runs another release`, `the app now runs another release`, `the view is open with other arguments`, `the view changed` | `conflict` | none | state |
| OP10 | `binding.ts:43-45`; `table.ts:65-76,107-114,118-120,147-149,158-159` | `mapped` | any other core error: `not_found: app not found`, `unavailable`: `app is archived`, `app is not running`, `preview is not running`, `app is not available`, `the screen declaration is unknown`, error from a port, plus shell-side `core is not ready`, `transport failed`, `internal` | `unavailable` (message normalized to `app is not available` and dropped by the preload) | none | unclear: state (off/archived/starting) vs platform (transport/internal) share the code; renderer cannot tell |
| OP11 | `binding.ts:56-57`; `app-connection.ts:154,176` | `hosts` | grant list could not be read (or > 20 pages) | `unavailable` (`grants are unavailable`) | none | platform |
| OP12 | `views-api.ts:36-38` | `call` | `invoke` rejects | `unavailable` | none | platform |
| OP13 | `registry.ts:284-287` | `refreshEntry` | resume/refresh (after core restart, `AppViewEvent` rebound/lost, `refresh()`) fails | no code; `connectionState = "unavailable"` pushed to renderer (`registry.ts:234-238`). `ViewChrome` shows a label (`renderer/app-frame/view-chrome.tsx:25-33`) in panel and card only | none. Note: `ConnectionState` `stopped` and `preparing` exist as types (`view-model.ts:23-27`) but `grep -n '"stopped"' packages/shell/main/app-frame/*.ts` finds only the type definition; main never sets them | state |

What each place renders for a failed open (`EmbeddedView` default is `ErrorState target={label}` = "Couldn't load {label}." + [Reload], `embedded-view.tsx:262-265`, strings `design/i18n/catalog/common.ts:18,34`):

| Place | File:line | `renderFailure` / `onFailed` | Result |
|---|---|---|---|
| tab (app space) | `workspace/app-screen-tab.tsx:143-163` | `renderFailure = useNotRunningFailure` | `unavailable` -> `AppNotRunning` (`app-frame/app-not-running.tsx:23-96,105-114`): reads run state; app off -> text "This app is turned off..." + [Turn on]; starting -> "This app is starting..."; halted -> "It exited unexpectedly..."; else `ErrorState`. Any other code -> default `ErrorState` |
| panel | `workspace/app-panel-tab.tsx:290-312` | `renderFailure`: `invalid_input`/`forbidden` -> notice "This screen can't open as a panel..." + [Open app space]; else `notRunning.renderFailure` | as above |
| sidebar | `workspace/sidebar/sidebar-panels.tsx:212-224` | `renderFailure = notRunning.renderFailure` | as tab |
| tray | `shell/tray/tray.tsx:126-137` | `renderFailure = notRunning.renderFailure` | as tab |
| card | `workspace/visuals/app-card-block.tsx:150-168` | `onFailed`: `conflict` -> settled `contract_changed`; `invalid_input`/`forbidden` -> `not_card` ("This screen can't be shown as a card."); no `renderFailure` | `unavailable` -> default `ErrorState` (no not-running explanation) |
| app window | `app-frame/app-window.tsx:48-57` | none | default `ErrorState` for every code |
| preview tab | `workspace/app-preview-tab.tsx:299-312` | none | default `ErrorState` for every code |

Phone open (`packages/mobile/src/apps/view.ts:75-92`, states rendered by `screens/apps/body.tsx:29-117`):

| ID | path:line | condition | page receives | recorded | class |
|---|---|---|---|---|---|
| PO1 | `view.ts:84-90` | open error `not_found` or `unavailable` (includes `ask` catch -> `unavailable: String(thrown)`, `:65-69`, and `not connected`) | state `stopped`: "{app} isn't running on {computer}" + [Retry] (`mobile-apps.ts:21-23`) | none | unclear: state (off/archived) and platform (transport) share the screen |
| PO2 | `view.ts:84-90` | any other code (`invalid_input`, `conflict`, `forbidden`, `internal`, `unauthorized`) | state `failed`: "This screen couldn't open" (`mobile-apps.ts:6`); the code is not shown | none | unclear |
| PO3 | `view.ts:106-111` | `AppViewEvent` `lost` with `app_stopped`/`app_archived` | state `stopped` | none | state |

### 2D. Other page-to-main channels (E)

All handlers share `senderView` (`app-ipc.ts:67-87`). Failure `NOT_APP_VIEW` = `forbidden: sender is not an app view` (`:89-92`) on every channel; recorded nowhere.

| ID | path:line | channel / function | condition | page receives | recorded | class |
|---|---|---|---|---|---|---|
| EC1 | `external-link.ts:377-391` | `app:open-external` | not `{url}` only, not http(s), userinfo, > 8192 chars | `invalid_input: external link is invalid` (thrown as `Error("invalid_input: ...")` by `request`, `app-tool.ts:300-302`) | none | contract |
| EC2 | `external-link.ts:396-404` | same | `shell.openExternal` rejects | `unavailable: browser did not open` | shell log `external link not opened app=.. mode=.. origin=.. path=..` | platform |
| EC3 | `app-agents.ts:179-191` | `app:agents` (`sessions.end`, `calls.send|read|cancel|list`, `agents.list`) | input not record / op unknown | `{ok:false,error:{invalid_input,"input is invalid"}}` (Result form, `app-tool.ts:88-103`) | none | contract |
| EC4 | `app-agents.ts:192-198` | same | everything else is core's answer verbatim (`app` overwritten) | core `{code,message}`; because `result()` returns the whole reply object (`app-tool.ts:94-95`) and the client keeps `details`/`trace_id`/`hint` (`client.ts:103-108`), the page can also receive those fields (static reading) | none at this layer | unclear (mixed) |
| EC5 | `app-sessions.ts:218-221,235-236,245-254` | `app:sessions-list|status|stop` | input shape | `invalid_input: input is invalid` | none | contract |
| EC6 | `app-sessions.ts:224-232` | same | core answer verbatim | core `{code,message}` (+extra fields as EC4) | none | unclear |
| EC7 | `app-agent.ts:76-88` | `app:agent-open` | not `{agent[,title][,workspace]}`, title blank | `invalid_input: input is invalid` | none | contract |
| EC8 | `app-agent.ts:89-102` | same | core error returned verbatim (`:98`); session missing -> `unavailable: core is not available` | core `{code,message}` / `unavailable: core is not available` | none | unclear / platform |
| EC9 | `app-agent.ts:47-49,54-58` | `app:agent-snapshot`, `app:agent-send` via `check` | session not string / core `invalid_input` | `invalid_input: session is invalid` | none | contract |
| EC10 | `app-agent.ts:26,59-61,69` | same | core `not_found|forbidden|unauthorized`, or session absent, or terminal session | `forbidden: session is not available` | none | state/contract: "not found" and "not visible" are intentionally the same |
| EC11 | `app-agent.ts:62-63` | same | other core error | `unavailable: core is not available` | none | unclear (platform/state) |
| EC12 | `app-agent.ts:118-120` | `app:agent-send` | `type` not `send|stop|answer|rename` | `forbidden: an app cannot send this input` | none | contract |
| EC13 | `app-agent.ts:114,128-129` | snapshot/send | core error verbatim | core `{code,message}` | none | unclear |
| EC14 | `app-projects.ts:305-310` | `app:projects-list` | core `conflict` | `conflict: projects changed` | none | state |
| EC15 | `app-projects.ts:311-317` | same | any other core error | `unavailable: core is not available` | none | unclear |
| EC16 | `preload/app-tool.ts:94-102` | all Result channels | `invoke` rejects or reply fails `replyOf` | `{ok:false,error:{code:"unavailable",message:"app bridge is unavailable"}}` | none | unclear |
| EC17 | `app-ipc.ts:137-140`; `view-error.ts:332-342,365-385`; core `view-errors.ts:36-39` | `app:view-error` (fire and forget, `ipc.on`) | sender not an app view: dropped; rate limit exceeded: dropped silently (`:334`); malformed: shell log `view <id> generation=N view-error dropped reason=invalid`; forwarded: shell log `... view-error <observation> app=.. mode=.. [unsent]`. `sent` is `result.ok` of the core call (`app-views.ts:195-201`), so it is `true` even when core answers `written:false` (preview mode, or no app log file, `assembly.ts:968-973`) | nothing (no reply) | see left | n/a |
| EC18 | `registry.ts:543-549` | main -> page app events | `entry.contents` undefined (page not attached): dropped | nothing | none | state |
| EC19 | `preload/tab-head.ts:44-50`; `app-tool.ts:382-391`; renderer `webview-host.tsx:426-438`, `ipc/app-tab-head.ts:49-` | `setTabHead`, `setKeepAlive` (host-only, never reach main) | non-cloneable value: caught and ignored; renderer `readTabHead` drops unknown/blank/oversize silently | nothing | none | n/a |

Validation location for E: the page-side preload does none; every shape check is in the per-channel main service (above) or in core's route schema (for `app:agents`, `app:sessions-*`, `app:agent-*`, `app:projects-list`, the shell RPC client's `route.input.safeParse` runs first, `client.ts:72-77`, giving `invalid_input: invalid input` verbatim to the page).

---

## 3. What the screen code sees and does (C)

Desktop `callOperation`:
- Resolves with the app's result value (`app-tool.ts:84`) or rejects with `new Error("<code>: <message>")` (`:83`). Only code and message reach the page; for `callOperation` and `openExternal` the comment is "고정 code와 main의 문구만 싣는다. transport 오류 원문은 페이지로 넘기지 않는다" (`:68`).
- `AppBridge` type in the SDK documents the same: `실패는 "<code>: <message>" Error로 온다` (`packages/sdk/app-ui/use-operation.ts:15-18`).
- Result-form channels (`agent`, `sessions`, `calls`, `agents`, `projects`) never throw; they return the reply object (`app-tool.ts:88-103`).

Phone `callOperation`: same Error string form (`guest/bridge.ts:70,89,92,98`).

`useOperation` (`packages/sdk/app-ui/use-operation.ts:46-76`):
- state `{status: "idle"|"pending"|"done", value|"failed", code}` (`:24-28`); `run` resolves `{ok:true,value}` or `{ok:false, code}` or `undefined` if already running (`:30-43, 54`).
- `codeOf` keeps only the part before `:` and only if it matches `/^([a-z_]+):/`, else `"unavailable"` (`:34-37`). The **message is discarded**. An app error code with an uppercase letter, digit or dash becomes `unavailable`.
- Nothing logs. `grep -rn "console\.\|reportProblem" packages/sdk/app-ui packages/sdk/app-ui-native packages/sdk/agent` returned no hit. The only thing `app-ui` sends to lophn is the render error event `lophn:render-error` from `AppErrorBoundary` (`app-error-boundary.tsx:56-58`), which preload turns into `view_error render_error` (`app-tool.ts:497-504`). A failed call is not a render error unless the app throws it in render.
- With `app` undefined it throws `unavailable: app bridge is unavailable` (`:59`).

`OperationButton` (`operation-button.tsx:105-154`): on failure shows `"{action} didn't finish. Try again."` (`common.error.action-failed`, `design/i18n/catalog/common.ts:33`) next to the button (`:142-151`) and calls `onFailed(code)` (`:124`). Same for the native one (`app-ui-native/operation-button.tsx:45-50,68-72`). `AppErrorBoundary`'s own text is "Couldn't show this screen." + [Retry] (`common.ts:35`).

`ErrorState` (`packages/design/components/feedback/error-state/error-state.tsx:14-32`): props are only `target` and `onRetry`; shows "Couldn't load {target}." (`common.ts:34`) and a [Reload] button. It cannot show code or message by design ("원인은 추측하지 않는다", `:9`). `ReadState` passes `failed` as the `target` string (`read-state/read-state.tsx:84-85`). `@lophn/app-ui` neither uses nor re-exports `ErrorState`/`ReadState`; the guide only says they live in `@lophn/ui/<category>` (`packages/sdk/app-ui/guide.md:12-14`).

`useProjects` and `@lophn/agent` hooks keep only `error.code` (`app-ui/use-projects.ts:60-66`, `sdk/agent/use-calls.ts:49-51`); `sdk/agent/session.ts:80-82,174-175,211-214` formats `"<code>: <message>"` into its own error strings.

Templates (`packages/core/apps/packages/template/app/`; no other `*.tmpl` under `packages/` generates screen code, `find . -name "*.tmpl"` shows the rest under `tests/support`):
- `src/screens/home/app.tsx.tmpl:8-15` renders only `<p>A lophn app.</p>`; `src/handlers.ts.tmpl:3-4` registers nothing. No generated call code and no failure handling.
- `src/screens/home/main.tsx.tmpl:5-16` wraps the root in `AppErrorBoundary`.
- `AGENTS.md.tmpl:85-87`: "실패 분기는 `@lophn/cap-problem`의 `reportProblem(name, message?, details?)`로 앱 log에 error 한 줄을 쓴다" and `:110-111` "잡히지 않은 예외는 lophn 진입점이 앱 log에 쓴다". `reportProblem` is exported by `@lophn/cap-problem` (`packages/sdk/cap-problem/guide.md:20-23`); I did not verify it can run in a screen page.
- Built-in skill `design-app/SKILL.md:48-49`: "Failure branches ... call `reportProblem` with it in the code". The phone screen example swallows failure: `if (result?.ok) setOrders(...)` with no else (`SKILL.md:267-272`).
- `sdk/app-ui/guide.md:36-37` documents `onFailed` codes as `invalid_input`, `forbidden`, `conflict`, `unavailable` only.

---

## 4. Validation inventory

Order is the order a desktop call meets them. "internal" = checks a message lophn itself built.

| # | path:line | check | rejects | checks app input / lophn message |
|---|---|---|---|---|
| V1 | `ipc` structured clone (`app-call.ts:185-187`) | clone | non-cloneable values | app input (transport) |
| V2 | `app-ipc.ts:67-87` | sender view + URL | wrong sender | lophn identity |
| V3 | `app-tool.ts:56-66` (`replyOf`, on the way back) | reply shape | main's reply not `{ok,...}` | **internal** (lophn's own reply) |
| V4 | `app-call.ts:188-204` | object, keys, JSON round trip | non-object, array, extra key, BigInt, cycle; **transforms** the rest | app input (and the page envelope) |
| V5 | `protocol/client/client.ts:72-77`, schema `views.ts:79-83` | strictObject `{view, operation: string, input: jsonValue}`, `appViewIdSchema` | non-string operation, lone surrogate (`canonical-json.ts:1-14`), non-finite number, non-plain object, view id | both: `operation`/`input` are app's; `view` is lophn's |
| V6 | `core/server/request.ts:152-269,286`; `dispatch.ts:250-261` | size 256 KiB, JSON, depth 16, items 4096 on `{view,operation,input}` | big/deep/wide input | app input (limits apply to the envelope, so effective input depth is 14) |
| V7 | `dispatch.ts:478-488` | **same schema as V5** | same as V5 | both (double validation of V5) |
| V8 | `core/apps/views/call.ts:23-50` | operation blank/trim/control/`*`; input stringify, 64 KiB bytes, round-trip equality | blank/padded/control/wildcard operation, big input | app input (third JSON round trip after V4, and after V5 which does not transform) |
| V9 | `call.ts:129-155`, `:209-214` | lost; declaration lookup | lost view, undeclared operation | state / app's declaration |
| V10 | `core/apps/calls/service.ts:331-342` | `checkSize` 254 KiB on the built request | unreachable from this path (V8 caps at 64 KiB); reachable from `preview.call` | **internal** hop (lophn's own message, but caused by app input) |
| V11 | `core/apps/calls/caller.ts:80+` (`verifyCaller`) | caller kind matches credential, target form | `forbidden` / `invalid_input` | **internal** (lophn's own message) |
| V12 | `core/apps/runtime/entrypoint/invoke.ts:42-83` (app process) | call body size, JSON, `parseProcessCall`, context matches process, operation declared | `invalid_input` / `conflict` HTTP-ish statuses and `not_found` outcomes | **internal** (lophn's message to the app process). `invoke.ts:100-104` states "operation의 schema는 앱 code의 일이라 입력을 검사하지 않는다" |
| V13 | `invoke.ts:201-216` | result JSON and size | `internal: result is not JSON` / `result exceeds the size limit` | app output |
| V14 | `call.ts:94-125` (`outcomeOf`) | outcome status, `error` strings, result size 8 MiB | `app response did not match`, `result is too large` | **internal** (shape of path outcome) + app output size |
| V15 | `protocol/client/client.ts:116-120`, schema `views.ts:86-100` | `{outcome: ok{value: jsonValue}|{error:{code,message}}}` strict | schema mismatch -> `internal` -> page sees `unavailable: app is not available` | **internal** (lophn's own reply); server does not parse output (`dispatch.ts:496`) |
| V16 | `app-call.ts:229-231` | none (`as {outcome}` cast after V15) | | |

Phone, in order:
| # | path:line | check | app input vs internal |
|---|---|---|---|
| W1 | `guest/bridge.ts:84-94` | undefined -> null, JSON.stringify, 64 KiB, JSON.parse | app input |
| W2 | `protocol/apps/phone-screen.ts:209-233,108-129` (host) | size 8 MiB+1 KiB, JSON, strict schema incl. `jsonValueSchema` + 64 KiB (**second copy of W1's limit**) | app input; failure silent (`session.ts:234-235`) |
| W3 | `remote/channel.ts:246-251` | frame size | lophn frame carrying app input |
| W4 | `core/remote/call.ts:132-186` | route allowlist, credential, admission, then `dispatchHttp` = V6, V7, V8... | lophn identity + app input |
| W5 | core view table V8-V15 | same as desktop | |
| W6 | `phone-screen.ts:159-190` host-to-guest schema | defined, **not applied** (no caller of `parsePhoneHostMessage`) | would be internal |
| W7 | local: `local-call.ts:326-330` | result JSON round trip | app output |

Double validation present today: V5 and V7 are the same schema applied at the client and again at the server; V4 and V8 are both JSON round trips (V5 does not transform, so V8 is the third); the 64 KiB input limit is checked in V8 (desktop) and in W1 and W2 (phone, two copies), but not in `app-call.ts`; the shell's JSON round trip and the phone guest's are independent copies (`app-call.ts:188-204` vs `bridge.ts:84-94`; the comment at `app-call.ts:185-186` says "폰 bridge와 같은 규칙").

---

## 5. Repro path differences (F)

Implementations:
- Agent `preview.call` and `lophn preview call` are one command definition: `defineCommand({name: "preview.call"})` in `packages/cli/commands/preview.ts:152-208`, listed once in `PREVIEW_COMMANDS` (`:210`; `grep -rn "preview.call" packages --include=*.ts` finds only this file for code). It reads `previews/get`, then core read `apps/call_tool` with `target:{mode:"preview", app, process_nonce}`, `caller:{kind:"person"}` (CLI without ctx.caller) or `{kind:"agent", ...ctx.caller}` (`:177-193`). Its description says "Nothing is recorded" (`:156`). I did not trace how the agent's `lophn` tool dispatches CLI commands.
- Agent browser tools (`tab open --preview <app>`, `browser snapshot|act|screenshot|evaluate|logs`, `packages/cli/commands/tab.ts:39-69`, `browser.ts:63-228`) drive the real preview tab, whose page runs the same preload and calls main like a person (mode `preview`). `browser.logs` reads "console lines and page errors" (`browser.ts:207-210`); `browser.evaluate` runs JS in the page (`:178-205`), not verified in which world. A phone tab (`tab open --phone`) has no console and no page script (`browser.ts:197,210`) and reaches core through the phone path.
- Core handler for `apps/call_tool`: `callToolHandler` (`core/apps/routes.ts:69-83`) -> `path.call` directly.

| Hop | Person's live screen | Person's preview tab (desktop) | Agent `preview.call` | Agent CLI (`lophn preview call`) | Agent browser tools on preview tab |
|---|---|---|---|---|---|
| page SDK + `codeOf` / `OperationButton` | yes | yes | no | no | yes (it is the person's page) |
| preload `request` / `replyOf` | yes | yes | no | no | yes |
| IPC + `senderView` | yes | yes | no | no | yes |
| shell `checkCall` JSON round trip | yes | yes | no | no | yes |
| shell RPC client schema (`app_views.call`) | yes | yes | no (CLI client validates `apps/call_tool` input instead) | no (same) | yes |
| core dispatch limits (256 KiB, depth 16, items 4096) | yes (`app_views/call`) | yes | yes (`apps/call_tool` route) | yes | yes |
| core view table lookup (`table.get`, `lost`) | yes | yes (mode preview) | no | no | yes |
| `callView` `checkCall` (64 KiB, blank/`*` operation) + `declaredEffect` | yes | yes | no | no | yes |
| `ports.path.call` | yes, caller `person`+`view_session` | yes (`callPreview`, no Gate, no ledger, `invocation: null`, `service.ts:~352-372`) | yes, caller `person` (no `view_session`) or `agent` (`preview.ts:190-193`) | yes (same) | yes (as preview tab) |
| `outcomeOf` mapping to `{ok,error}` (`call.ts:91-126`) | yes | yes | no: agent gets the raw outcome `succeeded|failed|denied|unknown` with `denial.code` / `unknown.reason` (`preview.ts:195-206`) | no | yes (page gets mapped form) |
| app-log line for rejected call (`logRejected`) | yes (live) | no (`call.ts:173`) | no | no | no |
| shell `callRejected` -> `log_view_error` | yes | forwarded, but core skips preview (`view-errors.ts:36-39`) | no | no | same as preview tab |
| invocation row | yes (live) | no | no (`callPreview`) | no | no |
| Error string `"<code>: <message>"` seen by caller | yes | yes | no (JSON outcome) | no | via page only |
| 64 KiB input cap | yes | yes | no (256 KiB RPC body, then `checkSize` 254 KiB) | no | yes |
| Input transformations (`undefined` dropped etc.) | yes | yes | no (CLI JSON args) | no | yes |

---

## 6. Counts

Rows are the table rows above (one row = one site/condition; a row may carry several messages).

By code received by the page:

| Group | invalid_input | forbidden | conflict | unavailable | internal | app-defined `<code>` | no reply at all | no code (silent) | total |
|---|---|---|---|---|---|---|---|---|---|
| Desktop call DC1-DC22 | 3 (DC3,4,10) | 4 (DC2,9,11,18) | 2 (DC12,19) | 12 (DC1,5,6,7,8,13,14,15,17,20,21,22) | 0 | 1 (DC16) | 0 | 0 | 22 |
| Phone call PC1-PC14 | 2 | 0 | 0 | 6 (PC3,4,5,12,13,14) | 3 (PC6,8,11) | 1 (PC7) | 2 (PC9,10) | 0 | 14 |
| Desktop open OP1-OP13 | 5 (OP3,4,5,6,7) | 3 (OP1,2,8) | 1 (OP9) | 3 (OP10,11,12) | 0 | 0 | 0 | 1 (OP13) | 13 |
| Phone open PO1-PO3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 (stopped / failed / stopped screens, code not shown) | 3 |
| Other channels EC1-EC19 | 5 (EC1,3,5,7,9) | 2 (EC10,12) | 1 (EC14) | 4 (EC2,11,15,16) | 0 | 4 core pass-through, code unfiltered (EC4,6,8,13) | 0 | 3 (EC17,18,19) | 19 |

The `NOT_APP_VIEW` `forbidden: sender is not an app view` is a shared exit on every one of these channels (`app-ipc.ts:96-136`) and is not counted in the EC rows (it is DC2 for calls).

Exits with no record of any kind (no app log, no shell log, no core log line, no invocation) that I found:
- Desktop call, live: DC1, DC2, DC5, DC6 = 4. In preview mode also DC7-DC14, DC17, DC22 (10 more, because `logRejected` is live-only, `call.ts:173`, and `callPreview` writes no ledger row) = 14; DC15 in preview unclear. DC3/DC4 in preview have only a shell log line.
- Phone call: all 14 (PC1-PC14). The only phone-side output is `console.warn` for `local-call.ts:319-321`, guest `fatal` (`session.ts:258` -> `console.warn`, `screen.tsx:53-54`) and runtime errors (`session.ts:271`). Nothing reaches core or the app log: no hit for `log_view_error` in `packages/mobile`, no `unhandledrejection` handler (grep `unhandled|rejectionTracking` in `packages/mobile/guest packages/mobile/src/apps` hits only a fixture).
- Desktop open: all 13 (OP1-OP13). Phone open: 3.
- Other channels: 17 of 19 have no record (the exceptions are EC2, which writes a shell log line, and EC17, which writes shell log lines for two of its four branches; EC18/EC19 are silent drops and count as no record).
- Total with no record: 4 + 14 + 13 + 3 + 17 = 51 (desktop call counted in live mode; 61 if preview-mode desktop call exits are used instead of live: 14 + 14 + 13 + 3 + 17 = 61).

Places where one code+message is produced for two or more fault classes (same text, different cause):
1. `unavailable: app is not available`: `app-call.ts:234` (core not_found = state; transport/internal/forbidden/unauthorized/schema = platform; core not ready = state), `call.ts:211` (view lost = state), `call.ts:218` (declaration lookup = platform), `call.ts:85` (path failure read). At least 4 sites, 3 causes.
2. `forbidden: operation is not available`: `call.ts:59` (undeclared = contract) vs `call.ts:76-78` (path forbidden/unauthorized = lophn refusing, e.g. credential/caller problem).
3. `invalid_input: call is invalid`: `app-call.ts:211` (used for shape, DC3; and DC4 core invalid_input including lophn's own schema failures), `call.ts:75`/`:203`.
4. `unavailable: app bridge is unavailable`: `app-tool.ts:81,101` (non-cloneable app value vs lophn handler failure).
5. `unavailable: result unknown`: `call.ts:84` (transport broke after send) vs `call.ts:122` (outcome unknown with four reasons not passed on).
6. Same code, app and platform origin: `not_found`, `invalid_input`, `internal` in a `failed` outcome come from app HandlerRejection and from the app-process runtime (`invoke.ts:61-67,87-95,200,205,212`). `internal: handler failed` is the app throwing; `internal: result exceeds the size limit` is lophn's limit.
7. Phone: `unavailable: <core message>` for every core code (`view.ts:132-135`), so contract (`call is invalid`), platform (`internal error`) and state (`connection closed`) are all `unavailable`.
8. Desktop open: renderer gets `unavailable` for app not found, archived, off, starting, preview absent, grants unreadable, transport down, internal (OP10-OP12).

---

## 7. Not verified / surprises

Not verified:
- Electron runtime behavior: what `contextBridge` does with args/Errors, whether non-cloneable values reject `invoke` (statements marked "not verified").
- How the phone sandbox serializes `postMessage` between guest and host (the host treats it as a JSON string, `session.ts:232`).
- `ports.path.call` internals, which denials/unknown reasons can arise for a `person` caller, and whether preview invocations leave any row beyond what `callPreview` shows (`service.ts:~352-372` shows `invocation: null`).
- Screen byte serving (`app-protocol.ts`, `electron-app-frame.ts`, `crash.ts` health) and the `lophn-app://` load path: not read; page load failures are outside both D and the exit table.
- How the agent's `lophn` tool reaches CLI commands (so "agent `preview.call`" vs "agent CLI" is treated as one implementation).
- `browser.act` / `browser.evaluate` injection world and whether `lophnApp` is reachable from `evaluate`.
- Whether `@lophn/cap-problem` `reportProblem` can run in a screen page.
- `core.diagnostic` and the destination of `console.log("[lophn] ...")`.
- Nothing was executed; no test or build.

Surprises:
1. Phone: the host silently drops a guest message it cannot parse (`session.ts:234-235`) and the remote link has no per-call timeout (`connection.ts` pending map), so a rejected call can leave the guest's promise pending forever. A lone-surrogate string passes the guest's JSON round trip and fails the host's `jsonValueSchema` (canonicalize), which is a concrete case; on desktop the same input yields `invalid_input: call is invalid`.
2. Phone converts every core error code to `unavailable` and keeps the core message (`view.ts:132-135`); the phone cannot write app log lines (no `log_view_error` route for devices, `allowlist.ts:136-139`) and `callView` returns its own `invalid_input` before `logRejected` (`call.ts:201-204`), so a phone call with a bad operation name leaves no record anywhere.
3. Desktop `invalid_input: call is invalid` is a reused label: the shell relabels any core `invalid_input` (including the shell's own client schema failure, depth/size limits from `dispatch`, and path-level rejections) as the app's bad call and logs it as `call_rejected` (`app-call.ts:232`). The app log therefore cannot distinguish app from platform for these.
4. `shell` `sent` flag in `view-error.ts:371-384` is true when core accepted the request even if `written:false` (preview or no log file), so the shell log line `view-error ... ` can exist without any app log line.
5. `ConnectionState` `stopped`/`preparing` are never set by main (`grep` above); the only non-`running` state the main sets is `unavailable`.
6. `result()` channels forward the whole core error object (including `trace_id`, `hint`, `details` when core sends them) to the page (`app-tool.ts:94-95` + `client.ts:103-108`); `callOperation` forwards only code and message. This is a static reading.
7. Core's HTTP server mints a `trace_id` for every request and accepts an incoming `traceparent` (`server.ts:165-177`), but the shell client sets no such header (`client.ts:78-92`), the remote (phone) path bypasses `server.ts` entirely (`core/remote/call.ts:166`), and the page never receives the trace id.
8. `parsePhoneHostMessage` / `phoneHostMessageSchema` have no caller.
9. `useOperation.codeOf` discards the message and collapses any non-`[a-z_]` code to `unavailable`; `ErrorState` cannot display a cause by design. So today the screen side can never surface code or message unless the app's own code does, and the SDK and templates never log a failed call.
10. DC16: the page cannot tell an app handler's `internal: handler failed` / `not_found` from the same codes emitted by the app-process runtime for lophn-side mismatches.

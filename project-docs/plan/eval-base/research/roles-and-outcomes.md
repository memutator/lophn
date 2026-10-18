# Roles, tools, outcomes: input for the eval layer

Read-only research of /home/pyosechang/projects/lophn (HEAD 221f8b9b9). Paths are repo-relative. "AR" = project-docs/products/AGENT-ROLE.md. Sizes were measured by importing the real modules in a scratch Deno script (no network, no repo edit): `agentTools()` + `builtinToolNames(role)` + `rolePrompt(role)` + `placeInfo()` + `skillListText()`. Scripts: scratchpad/research/size.ts, place.ts, routes.ts.

## 0. Legend (read paths used in the table)

All reads are core routes called as the human (`core.call(route, input)` from tests/support/core/mod.ts). Route = `resource/method` on the wire.

| Tag | What it reads | Route (export in packages/protocol/...) | Notes |
|---|---|---|---|
| R-tools | every tool call of a session: tool name, outcome | `tool-calls/list` (`toolCallList`, lophn-agent/tool-calls.ts:254) | `{session}` input. Tool args need R-args. |
| R-args | the tool call input JSON | `turns/body-view` (`turnBodyView`, lophn-agent/turn-reads.ts:145), kind `tool_call_input`, id `tcl_...`; output via kind `tool_call_output` | user actor only; 64 KiB cap |
| R-call | one agent call record: `to` (role+place), `reply` (none/result/conversation), `state` (accepted/done/failed/cancelled), `fail_reason`, `receiver_session` | `calls/read` (`callRead`, lophn-agent/calls.ts:261) | needs a call id. There is NO list-calls route. |
| R-callid | call id of a call | `session_messages/list` (`receivedMessageList`, lophn-agent/received-messages.ts:40) on the RECEIVER session, field `.call`, `.from.kind`, `.reply_to`; or the `call` tool output (R-args kind tool_call_output) | used by tests/e2e/agent-call_test.ts:165-178 |
| R-sess | new receiver session opened | `sessions/list` (`agentSessionList` with `{agent:{role,project\|app}}`) | tests/e2e/agent-call_test.ts:143-162 |
| R-q | question waiting for the human | `session_snapshots/list` (`sessionSnapshotsList`, events/) `.questions[]`; content via `ask/read` (`askRead`) | tests/support/core/human.ts:195-208 `waitQuestion` |
| R-perm | permission request waiting | same snapshot `.permission_requests[]`; or `approvals/pending` (`approvalsPending`) | human.ts:181-192 `waitPermission`; answer with `decide` (human.ts:210) |
| R-ticket | ticket (goal, check, evidence, state open/claimed/reported/verified/failed/cancelled) | `tickets/list`, `tickets/show` (`ticketList`, `ticketShow`, coding-agent/ticket/routes.ts) | no TicketCreated domain event exists; read the table |
| R-text | the model's final answer text | `messages/list` (`messagesList`, lophn-agent/messages.ts:172) + `messages/body` (`messageBody`) | tests/e2e/registration_test.ts uses messageBody |
| R-problem | problem list/state | `problems/list_problems`, `problems/get_problem` (`problemList`, `problemGet`) | |
| R-opdef | Operator definitions of a place | `agent-definitions/list` (`agentDefinitionList` with `{place}`), `agent-definitions/read` | tests/e2e/registration_test.ts, pm-tools_test.ts |
| R-ctx | context draft/applied/contract/glossary/violations | `contexts/draft`, `contexts/get`, `contexts/contract`, `terms/list`, `contexts/violations` (`contextDraftRoute`, `contextGetRoute`, `contextContractRoute`, `glossaryListRoute`, `contextViolationsRoute`, projects/) | |
| R-file | file on disk | app source `<source>/blueprint.ts`, project folders, draft folder under data root | the eval run folder is /tmp/lophn-e2e-<random>/{home,work} (tests/support/core/mod.ts createRun) |
| R-events | domain events | `events/list` (`eventsList`). Types that exist: AppCreated, AppSourceConnected, ProblemOpened, ProblemReopened, ReleaseActivationFailed, TicketClaimExpired, TicketVerified, ContextBundleDraftSaved, ContextBundleSubmitted, ContextBundleApplied, ContextBundleCheckFailed, ContextViolationFound, GlossaryEntrySet, ToolCallRequested/Decided/Started/Finished (protocol/events/domain.ts, defineEvent grep) | no call or ticket-created or operator-created event type |

Setup tags: S-base = `createRun` + `bootCore` + provider connect + `openSession` + `say` (tests/support/core/human.ts). Cost tag: low = S-base only, medium = project/app/Operator fixture, high = coding agent or multi-session.

## 1. Compact table

Column "written?" = is the behavior in the role prompt today (prompt line numbers are in `packages/core/agent-roles/roles/<role>/prompt.md`, role dirs: lophn, app-engineer, operator, project-manager).

| Item | Written? | Tools the model must use | Observable outcome | Where readable | Setup (before the human message) | Cost |
|---|---|---|---|---|---|---|
| L1 intent unclear -> questions | yes, lophn:11-12 (`ask`, one decision at a time); guide questions-and-decisions.md | `ask` | an `ask` tool call, 1 question, 2-4 options; no `call`/`app.create` | R-tools, R-q (askRead) | S-base only; lophn session | low |
| L2 compare: existing app, then SDK/package, then new | yes, lophn:13-16 (reads app.list, app.get, package.list first) | `app.list`, `app.get`, `package.list` (+ `package.get`), then `call` or `ask` or text | the 3 reads happen before any conclusion; final text recommends first fitting option (a fixture app that fits -> recommends it, not new app) | R-tools (order), R-text | needs apps registered (`appCreate`) for the "existing app fits" case; none for "new app"; SDK packages are installed by core on first boot (unverified count) | medium |
| L3 compare: existing project, widen context, new project | partly, lophn:17-18 only a sentence; lophn has NO tool to create a project (only `app.create`) and no `project.list`; the project list is only in place text ("Projects" section, place-info.ts:253-255) | `context.list`, `context.get`, text, maybe `call` to PM | recommendation text; no project created (cannot be) | R-text, R-tools | project(s) registered via `projectApi.register` (human.ts `openProject`) with a context | medium |
| L4 plan = app work -> call App Engineer, reply none; new app -> register first | yes, lophn:19-21 | `app.create` (new), `call` {to:{role:"app_engineer",place:{app:name}}, reply:"none"} | call record to AE of that app, reply `none`; new app: `AppCreated` + `app.create` before `call` | R-tools, R-args, R-call (via R-callid on the AE session), R-sess, `apps/list`, R-events AppCreated | existing-app case: `appCreate` (AE definition is auto-created on register); new-app case: nothing. The receiving AE session starts a REAL model turn on its own | low (new app) / medium (existing) |
| L5 plan needs material/search -> call PM, reply result | yes, lophn:22-23 | `call` {to:{role:"project_manager",place:{project:name}}, reply:"result"} | call record reply `result`, to PM of the right project | R-call, R-args | project registered (PM auto-created); receiving PM runs a real turn | medium |
| L6 how to use lophn / what a setting means | yes, lophn:26-28 (`guide.read`, `settings.get`, "say you do not know") ; 8 guides | `guide.read`, `settings.get` | tool reads, answer matches guide/setting; for unknown questions the text says it does not know | R-tools, R-text | S-base only | low |
| L7 are my apps healthy | yes, lophn:29-32 (`app.get`, `problem.list`, `problem.get`, `ticket.list`; "not confirmed") | those 4 reads | reads of all 4; text separates confirmed from inferred; contains "not confirmed" for unread numbers | R-tools, R-text | app registered + a problem (`observeViewError`, tests/e2e/reaction_test.ts:70-97 does this without any app process) + optionally a ticket | medium |
| L8 wants Operator -> do not create, call PM (project) or AE (app) | yes, lophn:24-25; also enforced by tool list (lophn has no `operator.create`, tool-lists.ts:51) | `call` | call to the place's PM or AE; no direct creation | R-call, R-args | project and/or app registered | low-medium |
| A1 human asks for app/change -> ticket | yes, AE:24-27 (and "if answers missing, do not write the ticket, say what you need", AE:26-27; `ask` AE:17-19) | `ticket.create`, maybe `ask`, `blueprint.check` | ticket with goal, one `check` (app_test/test_command/text), evidence; OR an `ask` when scope missing | R-ticket, R-args | app registered (`appCreate`), source linked (`appConnectSource`), AE session. `startTestApp` (tests/support/app/activate.ts:88-136) does all of it | medium |
| A2 problem opened/reopened (program calls) -> ticket from problem | yes, AE:38-41 | `problem.get`, `ticket.create`, maybe `problem.set_state` | ticket with evidence `{kind:"problem",id}`; problem state not changed without evidence | R-ticket (evidence), R-problem, R-sess | `appCreate` + `observeViewError` (reaction_test.ts:70-97). Default reaction `reactions.problem_opened` = open (settings key, reaction_test.ts:50) opens the AE session itself | medium |
| A3 annotation -> ticket with annotation evidence | yes, AE:42-43 | `image.read` (annotation:<id>), `ticket.create` | ticket evidence `{kind:"annotation",id}` | R-ticket | `appCreate` + `uploadScreenshot` (tests/support/annotation/upload.ts) + `annotationSend` (tests/e2e/annotation_test.ts) | medium |
| A4 blueprint written/fixed and checked before hand-over | yes, AE:20-23 (file tools + `blueprint.check`) | `file.read`, `file.write`/`file.edit`, `blueprint.check` | `blueprint.ts` changed; a `blueprint.check` call AFTER the last edit and BEFORE the `call` to coding_agent | R-file `<source>/blueprint.ts`; R-tools order (response_order/created_at); note `blueprints/check` actors are only coding_agent,agent (apps/blueprint, `blueprintCheck`) so a program cannot re-run it as human; use validator code in protocol/apps/blueprint/ on the file | app with source linked (write scope only exists when `appSource !== null`, place-folders.ts:36-39) | medium |
| A5 pick package + exact version, pin in blueprint | yes, AE:22-23 (`package.list`, `package.get`, "pin exact versions") | `package.list`, `package.get`, file edit | `sdk_dependencies` entry `{name, version}` with name in package list and version in that package's versions; exact SemVer is program-checked (protocol/apps/blueprint/uses.ts:79) | R-file blueprint.ts; `packages/list`, `packages/versions` (`packagesList`, `packagesVersions`) | app with source linked | medium |
| A6 ticket ready -> hand to coding agent (conversation), choose harness | yes, AE:28-32 | `call` {to:{role:"coding_agent",place:{app}}, reply:"conversation", refs:[ticket], options?} | call record role coding_agent, reply conversation; options omitted unless the human named a harness | R-call; `calls/sendable` `queued_coding`; R-args | app + source + AE->coding_agent grant (`agentGrantsSet`, activate.ts:116-123 else not_allowed) + `connectGateway` + `reportHarness`. For judgement only, grade the `call` input; no coding agent needs to run (tests/support/coding/hand-off.ts `handOffQueued` pattern) | medium (judgment) / high (full path to terminal) |
| A7 coding agent message -> answer or fix blueprint/dependency | yes, AE:30-32 | `reply` (call = the conversation call), `file.edit`, `blueprint.check` | a `reply` on that call id and/or blueprint.ts diff | R-tools, R-file | active claim + CLI message (`codingCli(...).run(...)`, tests/support/coding/cli.ts) after the hand-off reached a terminal | high |
| A8 completion reported -> verify against check, tell human | yes, AE:33-37 (`ticket.verify`) ; "report to the person" is just text (no tool) | `ticket.show`-like reads, `ticket.verify` | ticket state `verified`; `TicketVerified` event; final text reports result | R-ticket, R-events, R-text | full coding path: claim, `release prepare`, `app test`, `ticket report` (activate.ts `deliverRelease` 301-445) but that helper scripts the AE with fake replies; needs a new coding-agent-only helper | high |
| A9 verification fails -> leave failed, decide re-hand | yes, AE:35-36 | `ticket.verify` result failed, then `call` or `ask`/text | ticket `failed`; optionally new call | R-ticket, R-call | as A8 with a bad report | high |
| A10 claim expired / session ended without report -> decide re-hand | thin, AE:36-37 ("decide the same"); how it arrives is not in the prompt "When you start work" (AE:10-14 lists only calls and 3 reactions) | `call` or text | new coding call, or text explaining why not | R-call, R-events TicketClaimExpired | claim expiry or terminal exit without report (coding_test.ts rows `unclaimed-end`, `claimed-end`) | high |
| A11 activation failed -> read evidence, ticket for the cause | yes, AE:40-41 | `release.get`, `problem.*`, `ticket.create` | ticket with evidence release/file | R-ticket, R-events ReleaseActivationFailed | a release whose activation fails (tests/support/app/patch-migration.ts; app-activation_test.ts) | high |
| A12 beyond the app (reuse, project planning) -> call lophn, none | yes, AE:52-53 | `call` {to:{role:"lophn"},reply:"none"} | call to lophn, reply none | R-call | app registered | low-medium |
| A13 needs material -> call PM, result | yes, AE:53-54 | `call` {to:{role:"project_manager",place:{project}},reply:"result"} | call to the PM of the named project, reply result | R-call | app + project registered. Gap: AE place text lists no projects (place-info.ts:253-258 only lophn gets "Projects"), so the human message must name the project or the model must find it | medium |
| A14 Operator for this app: create/change | yes, AE:44-46 | `operator.create` / `operator.update` (Gate -> permission request) | permission request, then Operator in the app place; no grants set; refuses another app's | R-perm + `decide`, R-opdef | app registered; human `decide(allow)` on the request | low-medium |
| O1 do the job from context + granted app-api, say what was checked | yes, operator:10-17 | `context.search`, `context.get`, app-api tools (`app__<id>__<api>`), file reads | answer lists what was read; app place: no file written; project place may write project folders | R-text, R-tools, R-file (diff of source/project folder) | Operator definition (`operatorCreate`), contexts attached, `agentGrantsSet` for app-apis; see operator_test.ts | medium |
| O2, O3 | numbering gap in AR (O1 then O4) | | | | | |
| O4 bug/missing feature -> call AE, none | yes, operator:20-21 | `call` {to:{role:"app_engineer",place:{app}},reply:"none"} | call to that app's AE; no fix attempt (no write in app place) | R-call, R-file unchanged | Operator in app (or project) place + app registered; bug must come from the human message or a granted app-api result | medium |
| O5 blocked until fix -> call AE with result, then continue | yes, operator:22-23 | `call` reply:"result"; continue after reply | call reply `result`; later a turn after the reply input | R-call, R-tools across 2 turns | as O4 plus real AE that replies (or a stub reply by the test via another route) | high |
| O6 context contract must change -> call PM | yes, operator:24-25 (reply mode not stated; AR 5.1 says none) | `call` {to PM of the project} | call to PM; no write to contract/draft | R-call, R-ctx | Operator in project place with a context attached | medium |
| O7 own definition/grants -> tell the human | yes, operator:26-27 ("tell the person"); Operator has no `operator.*` tool | none (text) or `ask` | no `call`; text addressed to human | R-tools, R-text | Operator exists | low |
| C1 context requested -> contract + search scripts via draft/test/submit | yes, PM:24-36 (read, `context.draft`, write files, `context.test`, `context.submit`) | `context.get`, `context.draft`, file tools in draft folder, `context.test`, `context.submit` | order draft < test(pass) < submit; applied version number up; contract valid | R-ctx, R-events ContextBundleDraftSaved/Submitted/Applied/CheckFailed, R-tools order | project folder with real documents (`openProject(core, folder)`); pm-context_test.ts:253 pattern | medium (many model calls) |
| C2 boundary: tight inside, minimal links across, reason per link | yes, PM:20-23; BUT PM:53-54 says boundary is a person's decision and to `ask` | `context.draft` x N, `ask`, text | number of contexts, cross-context relations in contract, reasons in text | R-ctx contract (relations `to`), R-text, R-q | project with docs that clearly split into 2 topics | high (long output) |
| C3 passing draft applied without asking human | yes, PM:35-36 | `context.submit` | no `ask`/permission before submit; `ContextBundleApplied` | R-tools, R-q (empty), R-events | as C1 | medium |
| C4 pdf/docs table of contents (only PM) | NOT written; no outline tool exists (removed, project-docs/issues/contexts.md:12; change-log/0.2.0.md:210); not in tool-lists.ts | none | n/a | n/a | n/a | not evaluable today |
| C5 regenerate toc on request | NOT written, same | none | n/a | n/a | n/a | not evaluable today |
| C6 violation reaction -> change contract or tell human to fix doc | yes, PM:41-44 | `context.violations`, draft/test/submit OR text; must NOT write documents | either bundle submitted, or text telling the human what to fix; document files byte-identical | R-ctx violations, R-file hash of documents, R-events ContextViolationFound, R-text | applied context + a document edited to break the rule; pm-context_test.ts "violation-calls-pm" second batch (header lines 14-20). Program opens PM session itself (default reaction open) | medium-high |
| C7 glossary: set term as the human said, never change a human-defined term, report conflicts | yes, PM:37-40 | `glossary.set`, `ask` | `GlossaryEntrySet` with the human's wording verbatim; no overwrite of a defined term | `terms/list` (`glossaryListRoute`), R-events GlossaryEntrySet | applied context (glossary is per context) | medium |
| C8 new project/app needed -> call lophn, none | yes, PM:48-49 | `call` {to:{role:"lophn"},reply:"none"} | call to lophn | R-call | project registered, PM session | low-medium |
| C9 Operator for this project | yes, PM:45-47 | `operator.create`/`operator.update` (Gate) | permission request then Operator in project place; none for another project | R-perm, R-opdef | project registered; `decide` | low-medium |
| T19 refused work is not passed to another agent | yes, in 5 places: prompts.ts:52 (product rule), lophn:51-52, AE:62-63, operator:33-34, PM:64-65 | `call` (once), then text | exactly one outgoing `call` after a refusal/failed delivery; text tells the human; no second call to a different role/place | R-tools (count `call`), R-call `state failed`/`fail_reason not_allowed`, R-sess (no new sessions elsewhere) | block a target: `agentGrantsSet` entry `{kind:"agent",agent,setting:"never"}` (agent-call_test.ts:200-205, call-gate_test.ts); or a receiver that replies "no" | low-medium |

## 2. Where the instructions live and how the system prompt is built

Files (bytes, `wc -c`):

| File | Bytes |
|---|---|
| packages/core/agent-roles/roles/lophn/prompt.md (60 lines) | 3098 |
| roles/app-engineer/prompt.md (70 lines) | 3832 |
| roles/operator/prompt.md (41 lines) | 1896 |
| roles/project-manager/prompt.md (72 lines) | 3618 |
| roles/prompts.ts (PRODUCT_INSTRUCTIONS const, prompts.ts:36-55; `rolePrompt()` prompts.ts:25-32) | 3541 |
| roles/guides.ts (map of 8 guides, `guide.read` reads it) | 1364 |
| roles/lophn/guides/*.md (8 files: connections, features-and-screens, instructions, questions-and-decisions, rewind, roles-and-grants, settings, skills-and-mcp) | 15 726 total |
| skills/context-init/SKILL.md, skills/context-update/SKILL.md (bundled, root.ts) | 3527, 2626 |

Facts:
- Prompts are English; the product rule `PRODUCT_INSTRUCTIONS` (2 166 chars, prompts.ts:36-55) is prepended to every role prompt: `rolePrompt(role)` returns `${PRODUCT_INSTRUCTIONS}\n\n${text}` (prompts.ts:30). Roles are keyed `lophn`, `project_manager`, `app_engineer`, `operator` (prompts.ts:17-22). Prompt .md files are imported as text modules because the runtime has no read permission outside the data root (prompts.ts:15-16).
- Guides are NOT in the prompt. They are read by the tool `guide.read` (tools/guide.ts:20-44), which every role has (READ_TOOLS, tool-lists.ts:42); only lophn's prompt tells the model to use it (lophn:26-28).
- Assembly: `assembleTurnPrompt` (packages/core/lophn-agent/prompt-assembly/turn-prompt.ts:195-262), called from run-loop/prepare.ts (build at ~line 455-505). System blocks in this order (turn-prompt.ts:215-220), empty ones dropped:
  1. `role` = rolePrompt(role) (cache boundary)
  2. `instructions` = "# Instructions" + "## Global instructions" + "## Project instructions (LOPHN.md)" + "## Agent instructions" (turn-prompt.ts:71-86; each layer max 32 768 bytes, instructions/model.ts:7; lophn has no project layer, instructions/turn.ts:35-37; a layer that cannot be read blocks the turn, turn.ts:19-20)
  3. `skills` = "# Skills" list: name + description of enabled skills only (skill-list.ts:12-26). Both bundled skills are global, so every role sees both (321 chars measured).
  4. `place` = `placeInfo(role, data, 12000)` (agent-roles/place/place-info.ts:240-271): "# Your place", "You are <name>, a <Role>", `Place: project|app ...` with folders / source folder / (AE only) blueprint path, AE only "Active release: <v>. app-api: ...", "Agents you can call" lines, lophn "Projects" and "Apps", operator "Apps", and "Contexts" (PM and Operator full text up to 12 000 chars, else names, else a count; lophn names only).
  Then `tools` (sorted by wire name, turn-prompt.ts:224-229) and `messages` (history). Tool order in the registry is TOOL_ORDER (tool-lists.ts:85-135).
- Place data is read by `placeData` (place/place-data.ts) with the turn's agent credential.
- "Agents you can call" lines come from `calls/sendable` = OPEN sessions that the sender's grants allow (router/reads.ts:50-91, ports.ts:68 `listOpen`), not from the list of agents. A fresh core with no open PM or AE session shows none; the model has to build `to` from names it knows. Only lophn's place text lists all Projects and Apps (place-info.ts:253-258); Operator lists granted Apps; AE and PM list neither.
- `ROLE_LINE.lophn` in place-data.ts:35-40 says "Plans work, registers projects and apps, and hands work to others." but lophn has only `app.create` (tool-lists.ts:51) and no project creation tool; a mismatch the model can be misled by when other roles read it in the "Agents you can call" list.
- Per-role project layer: only `LOPHN.md` of the place's project is injected as the "Project instructions" layer (PROJECT_LAYER, place/project-layer.ts; AR P9). lophn reads other projects' `LOPHN.md` with the tool `instructions.read` (tools/instructions.ts:17, `instructions/get`).
- `LOPHN.md` writes go through a Gate (hooks.ts:15-31).

## 3. Tool lists per role

Source: packages/core/agent-roles/tool-lists.ts (COMMON 5-19, WORK 22, READ 25-45, LOPHN_ONLY 48, ROLE_WRITE 50-71, `builtinToolNames` 75-82). Definitions: packages/core/main/agent-tools.ts:20-37 collects 49 definitions (49 = size.ts "defs 49").

- COMMON (13): file.read, file.glob, file.grep, pdf.read, image.read, web.search, web.fetch, call, reply, cancel, session.list, ask, skill.read
- READ (19, all roles): ticket.list, ticket.get, problem.list, problem.get, app.list, app.get, blueprint.check, package.list, package.get, release.list, release.get, context.list, context.get, context.search, context.test, context.violations, guide.read, settings.get, visual.show
- WORK (3, all but lophn): file.write, file.edit, shell.run
- lophn (34): COMMON + READ + instructions.read + app.create
- App Engineer (44): COMMON + READ + WORK + ticket.create, ticket.update, ticket.verify, ticket.cancel, problem.set_state, app.link_source, package.publish, operator.create, operator.update
- Operator (35): COMMON + READ + WORK (no writes of its own) + granted app-api tools (named `app__<app id>__<api>`, long names hashed; added per turn from grants, not in tool-lists.ts) and granted MCP tools
- Project Manager (40): COMMON + READ + WORK + context.draft, context.submit, glossary.set, operator.create, operator.update
- `image.read` is dropped for models without vision by the core registry, not by this list (tool-lists.ts:73).
- Wire names replace "." with "_" (e.g. `ticket_create`, `context_draft`, `app_create`); tests/e2e/agent-call_test.ts:49-69 uses `app_create` / `context_draft` / `ticket_create` to tell the role from a request.
- Unavailable to a role by design: lophn has no file.write/edit/shell.run, no ticket.*, no operator.*, no context.draft/submit; Operator has no operator.*, no ticket.*; AE has no context.draft; PM has no ticket.*.
- File scope (place/place-folders.ts:19-43): lophn read all project folders, write none; PM read+write project folders and draft folders; project Operator read+write project folders; app AE read+write the app source only if a source is linked (`appSource !== null`), else nothing; app Operator read source, write none.

Gates seen in tools (a permission request to the human, observable as R-perm): `call` to an agent whose grant is "ask" (bundles/call.ts:41-52), `operator.create`/`operator.update` (tools/operator.ts:103,131, settings edit intent), writes to `LOPHN.md` (hooks.ts), app-api tools whose grant is "ask".

Tools relevant to the judgment items and their route names (core/*/agent-tools):

| Tool | Core route used (routes: field) | File |
|---|---|---|
| call | `calls/send` (`callSend`) + `agent-definitions/list`, `projects/list`, `apps/list` for name resolution | lophn-agent/tools/bundles/call.ts:26-81 |
| reply / cancel / session.list | `calls/reply`, `calls/cancel`, `calls/sendable` | same file 82-122 |
| ask | none (in-memory, `ask/wait`) | bundles/ask.ts |
| ticket.create/update/verify/cancel/list/get | `tickets/create|update|verify|cancel|list|show` | apps/agent-tools/ticket.ts |
| app.create / app.link_source / app.list / app.get / blueprint.check | `apps/create`, `apps/connect_source`, `apps/list`, `apps/get`(+problems), `blueprints/check` | apps/agent-tools/app.ts |
| package.list/get/publish | `packages/list`, `packages/versions`+`packages/usage`+`packages/guide_body`, `packages/publish` | apps/agent-tools/package.ts |
| problem.list/get/set_state | `problems/list_problems`, `problems/get_problem`, `problems/set_state` | problems/agent-tools.ts |
| context.* / glossary.set | `contexts/list|get|search|violations|open_draft|test_draft|submit_bundle`, `terms/set` | agent-roles/tools/context.ts |
| operator.create / update | `operators/create`, `operators/change` | agent-roles/tools/operator.ts |
| guide.read / settings.get / instructions.read | none / `settings/list` / `instructions/get` | agent-roles/tools/guide.ts, instructions.ts |

Facts about the `call` tool input (the thing most items grade): `to` is `{session}` or `{role, place:{project:name}|{app:name}, name?}` (role: project_manager, app_engineer, operator, lophn, coding_agent), `reply` none|result|conversation, `body`, `refs` (ticket|problem|file|session|annotation), `options` {harness, model} only for coding_agent (bundles/call.ts:31-39; protocol/lophn-agent/calls.ts:176-185). `reply:"conversation"` is allowed only for AE and coding agent. Result of the tool: `{call, state, fail_reason}` (call.ts:63-79). Failure reasons that appear in the tool result: not_found, not_allowed, closed; late ones: receiver_ended, lophn_restarted (calls.ts:101-107).

`ticket.create` input: `{app, goal, check, evidence?}`; `check` is ONE of `{kind:"app_test"}`, `{kind:"test_command",...}`, `{kind:"text",text}` (coding-agent/ticket/values.ts:66-88); evidence kinds problem, ticket, release, file, annotation (values.ts:92-96). AE prompt says "the acceptance checks" (plural, AE:25-26) while the schema allows one check; AR A8 says "acceptance check".

## 4. What the model receives per role (chars; tokens = chars/4)

Measured with size.ts (tool JSON = `{name, description, input_schema}` for each tool, `JSON.stringify` of the zod JSON schema; the real wire adds a small provider wrapper):

| Role | Tools | Tool JSON chars | Role prompt chars (PRODUCT + role) | Skills list | Place text (minimal fixture) | Total chars | Tokens (chars/4) |
|---|---|---|---|---|---|---|---|
| lophn | 34 | 18 570 | 5 264 | 321 | ~408 | ~24 560 | ~6 100 |
| App Engineer | 44 | 28 704 | 5 998 | 321 | ~499 | ~35 520 | ~8 900 |
| Operator | 35 (+ granted app-api and MCP tools) | 19 213 | 4 062 | 321 | ~425 | ~24 020 | ~6 000 |
| Project Manager | 40 | 24 032 | 5 784 | 321 | ~416 | ~30 550 | ~7 600 (+ up to 12 000 chars = ~3 000 tokens of context text) |

Not included: Global/Project/Agent instructions (0 to 32 768 bytes each), conversation history, tool results, notices, and the human message. Place text grows with agents, apps, projects, and contexts (context text budget 12 000 chars, place-data.ts CONTEXT_TEXT_BUDGET).

Largest tool definitions: call 3 858, ticket.create 2 290, operator.create 1 805, reply 1 553, operator.update 1 427, ask 1 268, package.publish 1 238, ticket.update 1 153, problem.list 613, context.draft 593, shell.run 588, context.search 570, file.read 528. Tools are about 75 to 80 percent of the fixed input; the role prompts are 4 000 to 6 000 chars.

Per scenario cost driver: every model call re-sends the full prefix (tools + system) plus history; a scenario of N model calls is about N x 6 000-9 000 input tokens (cache boundaries exist at role/instructions/place, turn-prompt.ts:193, 254-262). A `call` makes the RECEIVER open a new session and run its own real model turn (agent-call.md "session을 열 때마다 token이 든다"), so a "call" scenario costs at least 2 sessions unless the test stops/archives the receiver (`archiveSession`, agent-call_test.ts:168-174) right after the call record appears.

## 5. How a run can be set up and read (existing helpers)

tests/support (testing.md "tests/support" table):
- `core/` (mod.ts, human.ts, process.ts): `createRun`, `bootCore`, `Core.call/tryCall`, `connectFakeProvider(core, {url}, {key?})` (human.ts:64-104; protocol anthropic-messages; model name hard-coded `MODEL_NAME = "claude-sonnet-4-5"` human.ts:25, so a real model needs that made a parameter), `openProject(core, folder, name?)` (registers a project with one folder, PM definition auto-created; human.ts:115-132), `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitQuestion`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`.
- `app/activate.ts`: `startTestApp` (appCreate + template source + `appConnectSource` + AE->coding_agent grant + `connectGateway` + `reportHarness` + AE session; the `_fake` arg is unused, activate.ts:88-136), `activateTestApp` (whole path to a running app, uses fake AE replies), `aeLane` (fake only). `deliverRelease`, `handOff`, `verifyTicket`, `approveActivation` script the AE with fake replies and need a coding-agent-only variant for a real AE.
- `coding/cli.ts` `codingCli(core, token)` runs coding agent CLI commands in-process (`ticket claim`, `release prepare`, `app test`, `ticket report`, message); `coding/hand-off.ts` `createTicket`, `handOffQueued` are fake-AE scripts.
- `gateway/` `connectGateway`, `waitCodingTerminal`, `answerTerminal`, `exitTerminal`, `reportHarness`.
- `annotation/upload.ts` `uploadScreenshot`; `fake-oauth/` not relevant.
- `fake-server/` (probe.ts `systemText`, `toolNames`, `lastUserText`, `lastToolResult`, `idIn`) reads the FAKE server journal only; useless with a real model (no journal). The real-model equivalent must read the ledger via the routes in section 0.
- Program-opened sessions: problem -> `observeViewError` (route `problems/observe-view-error`, user actor) -> Reactor opens AE (reaction_test.ts:70-97, 161-190); annotation -> `annotations/send`; violation -> edit a document in an applied context (pm-context_test.ts second batch); activation failure and claim expiry need a coding path (high).
- Operator: `operatorCreate` (protocol `operators/create`, actors user, agent) as the human in operator_test.ts; grants with `agentGrantsSet` (protocol approvals, `agent_grants/set`, user actor).
- `tests/live/suite.ts:44-52` already builds the REAL role tool bundle in-process (`selectTools(builtinToolNames("project_manager"), {input_media}, agentTools({file: FILE_HOOKS}))`) and calls a real provider through `createModelResolver` (suite.ts:95-150) with system "You are a test agent." and a canned message; this is the pattern for a core-less "one model call" eval. With `rolePrompt(role)` + `placeInfo()` + `skillListText()` + `assembleTurnPrompt` (pure, takes a `pack` WirePacker) one can reproduce the exact first request of a real turn and grade only the FIRST response (first tool call and its args). That works for: L1 (ask), L4/L5/L8/A12/A13/C8/O4/O6 (call target and reply mode if the model calls without reading first; models often read first, so allow N steps with canned tool results), T19 (canned `state: failed, fail_reason: not_allowed` result then check the next response is text, not another `call`), O7, L6 (first tool = guide.read). It cannot grade items that depend on disk or ledger state.

## 6. Existing code that already reads model-judgment results (candidate graders)

| Where | What it reads | Reusable as eval grader? |
|---|---|---|
| tests/e2e/agent-call_test.ts:143-178 (`sessionIds`, `opened`, `messagesOf`, `callOf`, `callRecord`) | receiver session opened, call id, call state and fail_reason | yes, as is, for L4/L5/L8/A12/A13/O4-O6/C8/T19 |
| tests/support/core/human.ts:160-208 (`turnsOf`, `waitTurnEnd`, `waitPermission`, `waitQuestion`) | turn done, pending permission, pending question | yes (L1, A14, C9, A1 ask-instead-of-ticket) |
| tests/e2e/reaction_test.ts:100-126 (`reactionSessions`, `pendingOne`) | program-opened AE sessions and the problem refs | yes for A2 |
| tests/e2e/call-gate_test.ts, pm-tools_test.ts, approval_test.ts | `toolCallList`, `agentSessionList`, `receivedMessageList`, `agentDefinitionList` after a permission | yes (pattern for R-tools, R-opdef) |
| tests/e2e/registration_test.ts | `appList`, `agentDefinitionList`, `messageBody` | yes (new app registered, final text read) |
| tests/support/app/activate.ts `stateOf` (line 70-75) | `ticketShow` state | yes (A1/A8/A9) |
| packages/shell/renderer/conversation/agent-tab-core-source-calls.ts:17 | `callRead` for the conversation view | product code, shows the call record is a stable read |
| packages/core/lophn-agent/observability (agent-traces/read, `agentTraceRead`, protocol lophn-agent/traces.ts:99-123) | per-turn trace: tool_calls ids, model_calls ids, activity counts (succeeded/failed/denied) | possible aggregate (denied count for gate-blocked actions) |
| packages/protocol/apps/blueprint/{check,value,uses}.ts | validation of a blueprint file (exact SemVer deps) | yes: run on the final `blueprint.ts` for A4/A5 (note the `blueprints/check` route itself is agent/coding_agent only) |

No code today grades a *judgment* (right recipient, right reply mode, ask vs act). Everything above reads facts after a fake script. There is no `eval` text in project-docs (grep `eval` in project-docs: none relevant) and no tool-order assertion helper; "A4 check after edit before hand-over" needs ordering from `toolCallList` (fields `response_order`, `model_call`, timestamps).

## 7. Notes that change what is gradable (facts found while reading)

1. No list-calls route. Calls are reached by id (`calls/read`) from the receiver's received messages or from the `call` tool output. For a negative check ("no second call"), count `call` tool calls in R-tools instead.
2. `call` failures at send time (not_found, not_allowed, closed) leave NO agent_calls row for unresolved names (agent-call_test.ts:289-306: not_found has no row). T19 and "wrong name" checks must read the tool result/R-tools, not R-call.
3. lophn cannot register a project (no tool) and cannot create an Operator (no tool); L3 "create a new project" and L8 are judged by text and by which `call` is made, not by a created object. ROLE_LINE for lophn claims it "registers projects" (place-data.ts:35).
4. PM prompt tension for C2/C3: PM:20-23 "draw the boundary first" vs PM:53-54 "Do not decide ... a boundary ... Ask with `ask`". An eval for C2 will see `ask` before the first `context.draft` or not; AR C2 says PM draws the boundary. Needs a decision before grading.
5. C4/C5 (pdf/docs table of contents, PM only) have no tool and no prompt text; the outline tools were deleted (change-log/0.2.0.md:210; project-docs/issues/contexts.md:12). Not evaluable.
6. AR O2, O3 do not exist (numbering O1, O4-O7).
7. A10 (claim expiry / ended without report): the AE prompt's "When you start work" (AE:10-14) lists calls and three reactions only; how E4 arrives is not stated in the prompt.
8. Receiver turns are real. In a real-model run every `call` makes the receiver open a session and spend a model turn (L4, L5, L8, A12, A13, O4-O6, C8). To grade only the sender, archive or stop the receiver once its first received message is visible (R-callid), or accept the cost.
9. Default grants let every agent call every other without asking (AR T4; roles-and-grants.md:37-40), so `call` scenarios need no permission request unless a grant was set to "ask"/"never" (`agentGrantsSet`, agent-call_test.ts:200-205).
10. `operator.create`/`operator.update` always raise a permission request (Gate on settings edit, tools/operator.ts:103,131), so A14/C9 need a `decide(allow)` step in the harness (human.ts:210) and read the Operator through R-opdef afterwards; the Operator's grants stay empty (tool input has no grant fields, operator.ts:33-36).
11. AE can write files only when the app has a linked source (place-folders.ts:36-39); an eval for A4/A5 must link a source folder first (core restarts the agent runtime child after folders change; use `settle`, human.ts:51-61).
12. Provider setup for tests is the fake: `connectFakeProvider` takes any URL and optional key, protocol `anthropic-messages`, but the model name is a constant (human.ts:25) and E2E policy says "인터넷은 막는다" (testing.md rule 9) and `AGENTS.md` asks the human before any real provider call. The live suite caps calls at 10 per file and 90 s per call (tests/live/budget.ts:4-5); a multi-step eval exceeds that.
13. Time/turn count: a typical scenario is 2 to 8 model calls per session (read tools, then the judgment call, then a closing text). At about 6 000 to 9 000 input tokens per call (section 4), one scenario is about 15 000 to 70 000 input tokens before caching.

## 8. Setup recipes (what a scenario needs, in terms of existing helpers)

| Scenario group | Recipe | Helper exists? |
|---|---|---|
| lophn alone (L1, L6, T19 with grant) | `bootCore` -> connect provider -> `openSession({role:"lophn"})` -> `say` | yes |
| lophn + apps (L2, L4, L7, L8) | above + `appCreate` (protocol apps) x N; L7 adds `observeViewError`; AE definition is created at register | `appCreate` yes; problem via reaction_test.ts `reportViewError` (local fn, would move into support) |
| lophn + project (L3, L5, L8) | above + `openProject(core, folder)`; add a context via PM-only path (needs a real or scripted PM) or leave without contexts | `openProject` yes; context creation needs the PM draft path (pm-context_test.ts) |
| AE (A1, A12-A14) | `startTestApp` (or just `appCreate` + `appConnectSource`) -> `openSession({role:"app_engineer", app})` | yes (`startTestApp`) |
| AE with program trigger (A2, A3, A11) | A2: `observeViewError`; A3: `uploadScreenshot` + `annotationSend`; A11: failing release patch | A2/A3 yes in tests; A11 needs coding path |
| AE hand-over (A6) | `startTestApp` (grant + gateway + harness already there) and read the `call` input/record | yes |
| AE full loop (A7-A10) | coding CLI steps by the test after a REAL AE has made the ticket and handed it (new helper; existing ones script the AE) | no |
| Operator (O1, O4-O7) | `operatorCreate` in place + contexts attached + `agentGrantsSet` for app-apis + `openSession({role:"operator", ...})` | partly (operator_test.ts) |
| PM (C1-C3, C6-C9) | `openProject(core, folder with real docs)` -> `openSession({role:"project_manager", project})`; C6 needs an applied context and a broken document | partly (pm-context_test.ts) |

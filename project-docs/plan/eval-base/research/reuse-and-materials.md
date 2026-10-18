# Reuse surfaces, materials (snapshot/restore) and versioning: research notes

Repo: /home/pyosechang/projects/lophn (main @ e4f69ac0f). Read-only investigation. All paths relative to repo root.
Note on wording: "AE" = App Engineer agent. "user" actor = the harness's user token (what `core.call` uses in tests).

======================================================================
## PART 1. REUSE SURFACES
======================================================================

### 1.1 Built-in SDK packages installed into every data root

Installer: `packages/core/main/daemon/wiring/sdk-install.ts:11-24` (wiring `build`) -> `installSdkCopies` (`packages/core/apps/packages/install.ts:326-362`).
- Copies every `packages/sdk/*` folder that has a `deno.json` (install.ts:339-348) PLUS two "support sources" `packages/design` (-> `@lophn/ui`) and `packages/design/wording` (-> `@lophn/wording`) (`packages/core/apps/packages/vendor.ts` SUPPORT_SOURCES).
- Location: `<root>/sdk/<part>/<version>` (0444 files / 0555 dirs); user packages go to `<root>/sdk/@me/<part>/<version>` (install.ts `packageInstallPath`, ~L98-108). Version comes from each `deno.json`; all are `1.0.0`.
- Same bytes -> left alone; different bytes -> deleted and rewritten on every boot (install.ts `installCopy`). So SDK content can change under the SAME version "1.0.0" when lophn source changes. (Matters for versioning, Part 3.)
- Built-ins are NOT registered in the package catalog ("catalog 등록은 하지 않는다", install.ts:1-5; change-log `project-docs/products/change-log/0.2.0.md:475,488`).

Installed set (8 packages) and what each provides:

| package | provides | guide |
|---|---|---|
| `@lophn/ui` (packages/design) | UI components in 8 category sub-paths: primitives, input, layout, navigation, data (Table, DataTable, DataState, Tree, List, StatTile/StatRow, charts: bar/line/scatter/distribution/graph), feedback (ReadState, EmptyState, ErrorState, Skeleton, StatusMark, StaleNote), overlay (Dialog, Menu, Popover, Toast, Sheet, Tooltip, Palette), reading (Markdown, CodeBlock, DiffView, Toc), plus `tokens.css`, `base.css`, `@lophn/ui/shared`. About 91 `export` lines across the 8 category `mod.ts` files. | NO guide.md. Each category `packages/design/components/<cat>/mod.ts` has a one-line "when to use" comment above each export (e.g. `data/mod.ts:2-3`). Import map in installed copy. |
| `@lophn/app-ui` | `AppApiButton`, `useAppApi`, `AppErrorBoundary`, `appBridge` | `packages/sdk/app-ui/guide.md` (86 lines) |
| `@lophn/blueprint` | `defineBlueprint`, `validateBlueprint`, `validateInput`, `canonicalInputHash`; blueprint keys `name, description, screens, app_api, permissions, app_connections, sdk_dependencies` | `packages/sdk/blueprint/guide.md` (66) |
| `@lophn/cap-app-api` | `appApi(key, handler)`, `AppApiRejection`, `readResult`, `currentContext`, **`connectAppApi(app, apis)`** (call another app's app-api through core) | `packages/sdk/cap-app-api/guide.md` (68) |
| `@lophn/cap-store` | `openStore()` app SQLite, `migrate`, `migrationOfSql`, `transaction` | `packages/sdk/cap-store/guide.md` (60) |
| `@lophn/cap-problem` | `reportProblem(name,message,details?)`, exception observer | `packages/sdk/cap-problem/guide.md` (62) |
| `@lophn/cap-project` | `listProjects()`, `currentProject()` | `packages/sdk/cap-project/guide.md` (42) |
| `@lophn/wording` (packages/design/wording) | i18n catalog check/generate (`check.ts`, `generate.ts`) | NO guide.md |

NOT installed (source exists, guide.md exists, but no `deno.json`, so the installer skips them, install.ts:339-348): `@lophn/cap-fs` (59 lines guide), `@lophn/cap-net` (63), `@lophn/cap-secret` (57). Yet `packages/core/apps/releases/sdk-permissions.ts:6-14` has permission rules for exactly these three. So a blueprint that depends on them cannot resolve (`sdk_not_installed`, `packages/core/apps/releases/bundle/lock.ts:158-170`). Relevant for scenarios that need fs/net/secret.

Guide visibility by actor (important for "does the agent find it"):
- Coding agent: can read `<root>/sdk/<part>/1.0.0/guide.md` via the app's `.lophn/import-map.json` (SKILL lophn-build-app step 4, `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md:50-53`). It runs with the harness's normal filesystem.
- AE and lophn: NO file access to `<root>/sdk` or `<root>/templates`. File tool scope is `placeScope` (`packages/core/agent-roles/place/place-folders.ts:21-44`): AE read/write = its own app source only; lophn read = project folders only, write none; Operator(app) read = app source. `grep sdk|templates` over `packages/core/agent-roles` and `packages/core/lophn-agent/tools` finds nothing.
- AE/lophn `package.list`/`package.get` read the catalog, which contains ONLY `@me/*` published packages (no `@lophn/*`). `package.get name=@lophn/ui` would be not_found. The 0.2.0 change-log records this as a known gap ("`package show`가 내장 sdk guide를 주지 못하는 것은 이슈로 남겼다", L488); `project-docs/issues/*.md` does not contain it (grep "sdk" in issues = 0 hits), so the issue was NOT actually filed.

### 1.2 Packages published by apps (`package.publish`)

Tool: `packages/core/apps/agent-tools/package.ts:124-` (tool name `package.publish`, role = AE only: `packages/core/agent-roles/tool-lists.ts:49-61`, ROLE_WRITE_TOOLS.app_engineer). Route `package.publish` memory route, `actors: ["agent"]` (`packages/protocol/apps/package-routes.ts:97`). Handler: `packages/core/apps/packages/publish.ts:49-`.
- Who: only an agent whose bound app == `input.app` (publish.ts:51-56). No human approval ("낼 때 사람 승인은 없다", publish.ts:3).
- What: a FOLDER of the app source at the HEAD commit of `app.source_path` (package.ts: `headOf` via `git rev-parse HEAD`; tool input `path` = source-relative folder). Files are extracted from the commit (`extractCommit`), those under `path/` are bundled sorted (publish.ts:81-93). Uncommitted changes are not published.
- Input: `name` must be `@me/<kebab>` (package-routes.ts:73-76), exact semver `version`, one-line `description`, `guide{purpose,api,examples}` (all three nonblank), `permissions[]`, `tests[]` min 1 = ids (`vrf_`) of PASSED `app_test`/`test_command` verifications OF THIS APP (publish.ts:57-70). Because verifications live in the ledger, publish requires that the app has gone through the release+app-test path first (ties to Part 2).
- Versioning: semver; "낸 version은 바뀌지 않는다" (publish.ts:3). `package.register_version` is machine-only; same name+version with different bytes -> `conflict` (change-log 0.2.0:488). `bundle_hash = sha256(bundleBytes(sorted files))`, `guide_hash = sha256(guide text)` (publish.ts:95-103, install.ts `bundleBytes` ~L58-72).
- Result on disk: read-only install copy at `<root>/sdk/@me/<part>/<version>/` (publish.ts:122-129) and catalog rows (`packages`, `package_versions`, guide blob).
- No E2E or unit test calls `package.publish` (grep over tests/ = 0 hits; only `packages/core/apps/packages/install_test.ts` for install). This path is un-exercised in the repo, so scenario 1->2 reuse via a published package would be the first real run. Expect bugs.
- Kinds: `packageKindSchema` still has `component|capability|domain|format` (`packages/protocol/apps/packages.ts:6-11`) but new packages register `kind: null` (publish.ts register call).

How another app depends on it:
1. Blueprint `sdk_dependencies: [{name:"@me/foo", version:"1.0.0"}]` (exact SemVer only; `packages/protocol/apps/blueprint/uses.ts:73-95`; `PACKAGE_NAME` regex `^@(?:me|lophn)/...` in `blueprint/types.ts`).
2. App `deno.json` import map entry `"@me/foo": "lophn-sdk:@me/foo@1.0.0/mod.ts"` (resolution in `packages/core/apps/packages/template/import-map.ts:23-45`; template test `packages/core/apps/packages/template/app/tests/blueprint_test.ts.tmpl:37-50` asserts blueprint deps == import map).
3. Source imports by the bare specifier (`from "@me/foo"`). Release prepare vendors the install copy into the sealed bundle; manifest `dependencies[].source` is `"package"` for `@me/*` and `"sdk"` for `@lophn/*` (`packages/core/apps/releases/prepare/from-source.ts:331-337`). Release prepare rejects a manifest whose deps differ from the blueprint (`releases/commands.ts:521-531`).
Who edits them: AE edits blueprint + deno.json with file tools (AE prompt L21-23); coding agent is told NOT to change blueprint/deps itself (SKILL lophn-build-app step 5, L73-75) and to ask AE with `message send`.

Visibility:
- `package.list` (tool `package.ts:59-76`): route `packages.list`, paged 50, sorted `@me` first (`packages/core/apps/packages/reads.ts:75-110`). Returns `{id,name,description,kind,versions[{version,bundle_hash,guide_hash,permissions}]}`.
- `package.get name [version]` (package.ts:77-123): newest version if omitted; returns `{name, version, permissions, other_versions, used_by:[{app,release}], guide(text, up to TEXT_MAX_BYTES), guide_truncated}`. `used_by` is computed from release-pinned `sdk_dependencies` (`packages/core/apps/packages/store.ts:47-60`).
- Coding agent CLI `lophn package list|show` (`packages/coding-agent/cli/commands/package.ts`; routes in `packages/protocol/coding-agent/cli-commands.ts:205-221`). Description says "declared dependencies only", but the route reads the whole catalog; `query` is accepted in the CLI input schema but `packages.list` handler ignores it (reads.ts:75-110, no `query` handling).
- Program route `packages.usage {name,version}` -> `[{app,release}]` (package-routes.ts, readActors include `user`), usable by a grader.

### 1.3 Cross-app app-api use at runtime

Yes, app A can call app B's app-api. Mechanism (`project-docs/architecture/app-call.md:1-30`, "app ─ sdk ─ broker" path):
- SDK: `connectAppApi(app, apis)` from `@lophn/cap-app-api` (`packages/sdk/cap-app-api/connect.ts`, guide `packages/sdk/cap-app-api/guide.md`), posts to `/_lophn/broker/apps/call`; core resolves the caller, checks Gate, records invocation. Result `{invocation, outcome: succeeded|failed|denied|unknown}`.
- Declaration: blueprint `app_connections: [{app:"app_<id>", app_api:["key",...], reason:"..."}]` (`blueprint/types.ts` AppApiUseDeclaration; validated in `blueprint/uses.ts:15-65`): target must be an app ID (`^app_[0-7]...{25}$`), not the owner, app_api list nonempty, exact keys (no `*`), nonblank reason, no duplicate app.
- Human consent: activation compares new declarations to current active app grants; added app_apis/resources force an approval request, first activation always asks (`packages/core/apps/releases/compare.ts:17-59`, `project-docs/architecture/activation.md` flow). Effective scope = declaration INTERSECT active app grant (`packages/core/apps/permissions/effective.ts`). Direction caller->target only.
- Call chain guards: same app again (call_loop) or depth over limit rejected (app-call.md last bullet in "지키는 것").
- `blueprint.check` does NOT verify that the target app/app_api exists (grep "connection" in `packages/core/apps/blueprint/check.ts` and `packages/protocol/apps/blueprint/check.ts` = 0 hits). Existence is only effective at runtime (`targetCommands` in effective.ts).
- No test: `grep app_connections|connectAppApi tests/` = 0 hits (tests/e2e/app-call_test.ts + `tests/support/app/patch-call.ts` only exercise big_write/put_text/external_ping via user/agent callers).
- Blueprint needs the literal target app ID. App IDs are generated (`tx.newId("app")`) UNLESS a USER-actor `app.create` passes `id` (`packages/core/apps/registration/commands.ts:105-110`: "미리 배정한 ID는 사람 자격만 쓴다"; `protocol/apps/apps.ts:75-80`). So a material restore can pin the app id; an agent run cannot.

Discovery of other apps' app-apis by agents (the weak spot):
- `app.list` tool (`packages/core/apps/agent-tools/app.ts:44-58`) returns `App[]` with fields `id, slug, name, description (one line), planning_version, source_path, active_release, revision, run_enabled, status` (`packages/protocol/apps/apps.ts:46-60`). NO app_api list, no blueprint.
- `app.get` (app.ts:61-86) = same App + `open_problems` count (+ `open_problems_capped`). NO app_api.
- Route `app.app_api` (`packages/protocol/apps/blueprint/read.ts:78-92`, actors user/coding_agent/agent/app/machine) returns the active release's `app_api[] {key,label,description,effect,input,project_scope}`, `screens`, `declarations`, `evidence` but NO agent tool wraps it. It is only used inside `visual.show` (`apps/agent-tools/visual.ts`) and by the app-api tool builder. `release.get`/`release.list` return hashes only, not blueprint.
- app-api become model TOOLS only when the HUMAN assigned the app to that agent (grant kind "app"): tools = app INTERSECT active-release declaration INTERSECT agent grant (`packages/core/lophn-agent/tools/app-tools.ts:55-100`, `app-toolkit.ts:30-60`). A grant is user-only (`SetAgentGrant`, `packages/protocol/approvals/grants.ts:156-159`).
- File access: lophn reads only project folders, AE only its own app source (place-folders.ts), so neither can read another app's `blueprint.ts`.
=> Without a grant, lophn and AE have NO tool that lists another app's app-apis. The only ways: (a) `call` the other app's AE and ask, (b) the harness/scenario grants the app to the agent, (c) the person types the info. This matters: the lophn prompt's L2 order ("change an existing app / build on SDK or package / new app") reads `app.list`, `app.get`, `package.list` (prompt L14-16) and none of them reveals app-apis. A scenario that expects "AE finds calendar app-api and wires `app_connections`" is, today, structurally unlikely unless seeded by grant or told in the user message. Report as a product finding rather than a model failure.
- The same applies to coding agent: `lophn app blueprint` is scoped to its own app (token is one-app scope, `project-docs/architecture/coding-agent.md:43`).

### 1.4 Reusing code from another app's source other than via package

- Product path: none. `package.publish` from the owning app is the only supported path (publish.ts reads the app's own git commit). AE `call`s with "Reuse across apps ... go to lophn" (AE prompt L52-53; AGENT-ROLE A12 "(제안)").
- Not forbidden but unsupported: the external coding agent has the normal filesystem; `app.get` exposes the other app's absolute `source_path`, so a coding agent could read/copy files from another app. No lophn mechanism records or reflects that. (SKILL lophn-build-app step 4 tells it to copy a lophn UI component file into `src/` to customize it, L69-72, which is a copy-not-reuse path and it detaches from updates.)
- `@lophn/ui` components copied into app `src/` are explicitly allowed, so "copy of SDK component" is a legit-looking pattern a grader must treat as a miss for "used the package" (or as acceptable-with-reason).
- Project documents/contexts are a separate reuse axis (PM contexts) not packages.

### 1.5 Exact reuse instructions per agent

lophn (`packages/core/agent-roles/roles/lophn/prompt.md:12-16`):
"For a new app or a change to an app, compare options in this order and recommend the first one that fits: change an existing app, build on an existing SDK or package, build a new app. Read `app.list`, `app.get` and `package.list` before you conclude that nothing fits." (AGENT-ROLE L2, marked "(제안)", AGENT-ROLE.md:29). Also L4 (hand to AE with `call`, none reply; new app `app.create` first; prompt L19-21). Product-wide prompt (`roles/prompts.ts:36-55`) has no reuse text.
Gaps: `package.list` shows only @me user packages (no UI components); `app.list/get` show no app-api. lophn cannot read sdk guides; its `guide.read` guides (packages/core/agent-roles/roles/lophn/guides/*.md, 8 files) never mention packages/SDK/reuse (grep = only app-api grant mentions).

App Engineer (`packages/core/agent-roles/roles/app-engineer/prompt.md:21-23`): "Keep the app's blueprint ... correct. Edit it with the file tools and read the result with `blueprint.check`. Choose the packages the app uses with `package.list` and `package.get`, and pin exact versions in the blueprint's dependencies." (AGENT-ROLE A5 line 43; A4 line 42). And L52-53: "Do not plan beyond the app. Reuse across apps and project planning go to lophn with `call` and no reply expected." (AGENT-ROLE A12, line 50, "(제안)"). The AE has no instruction to use `app.app_api`-like info because it has no such tool. AE sees only `@me` published packages; template apps already pin 7 SDK packages in the blueprint (see 1.7), so SDK "pinning" is mostly already done by the template.

Coding agent skills:
- `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md:50-72` step 4 "쓸 package를 찾는다": before new code, read API/examples of packages the app DECLARED as dependencies: built-in SDK -> installed copy `guide.md` via `.lophn/import-map.json`; user package -> `lophn package show`; "선언되지 않은 package는 쓸 수 없다"; UI from `@lophn/ui/<category>` with the 8-category list (L55-66) and "어떤 component가 있는지는 분류의 mod.ts가 목록이고 export마다 '언제 쓰나' 한 줄이 있다" (L67-69); token CSS only, no raw colors (L70-71).
- Command list L28-33: `package list`, `package show` ("읽기만. 내장 SDK는 여기에 없다").
- Step 5 (L73-75): blueprint/dependency change goes via `message send` to AE and waits.
- `lophn-repair/SKILL.md`: no package/reuse step (grep package|reuse|guide only hits command list line 41-42 and "문서"; the repair skill never reads package guides).
- Template `AGENTS.md` at the app root (the file the coding agent reads first; `packages/core/apps/packages/template/app/AGENTS.md.tmpl`): L43-45 "새 SDK Package는 설치 catalog(`lophn_sdk`)에서 찾고 exact version만 쓴다"; L83-88 "재사용 기준": promote to SDK package only when 2+ real users, clear domain name/IO, token-based styling; "한 번 쓴 것을 미리 일반화하지 않는다". STALE REFERENCES: `lophn_sdk` catalog, `lophn_session` op `summary`, and skills `lophn-navigate`, `lophn-save` do not exist (only `lophn-build-app` and `lophn-repair`, `CODING_SKILL_NAMES`; grep of those names hits only this template file). The coding agent is told to follow non-existent skills.

### 1.6 Program-checkable signals of reuse (for a grader)

All reads via the user token (no model, no secrets):
1. Blueprint dependency pins: `releases` row stores canonical blueprint; `packages.usage {name,version}` -> `[{app, release}]` (store.ts:47-60); or `git show <commit>:blueprint.ts` / evaluate; or sealed bundle `<root>/apps/<app>/bundles/<bundle_hash>/` manifest `dependencies[].source`/`name`/`version` (`packages/core/apps/releases/bundle/manifest.ts`). Cheap check: set of `sdk_dependencies` names beyond the template's 7 -> new reuse. `@me/*` entry present -> used a published package.
2. Cross-app use: blueprint `app_connections[].app` / `app_api[]` (in `app.app_api` route output `declarations.app_connections`, `packages/protocol/apps/blueprint/read.ts:51-58`); source imports `connectAppApi` from `@lophn/cap-app-api`; runtime proof: `app.invocations {app: <target>}` (route `appInvocations`, used in tests/e2e/operator_test.ts:98-110) with caller kind = app; and grants/approval: activation approval request `intent.target.kind === "activation"` with `added_app_apis` for the caller (tests/support/app/activate.ts:`approveActivation`).
3. Import specifiers in app source at commit: `git grep -nE "from ['\"](@me/[a-z0-9-]+|@lophn/[a-z-]+(/[a-z]+)?)['\"]" <commit>`; count distinct `@lophn/ui/<category>` imports vs the template's baseline (template imports only primitives, input, layout, feedback + `lucide-react`; see 1.7). Also `deno.json` `imports` entries starting `lophn-sdk:`.
4. Tool-call trace: `tool-calls/list {session}` (`toolCallList`, `packages/protocol/lophn-agent/tool-calls.ts`) with inputs/outputs via body-view (eval roadmap `project-docs/products/roadmap/eval.md` "결과를 읽는 길" table). Checks: `package.list` / `package.get{name}` / `app.list` / `app.get{app}` ordered BEFORE `ticket.create` (AE) or before `call` to AE / `app.create` (lophn). Ordering by tool-call seq/time within a session. For the AE note that `app.get` of a SPECIFIC other app id is the only discoverable cross-app signal; `package.get` for the `@me` name is the package signal. `call` text/refs to the AE can be graded for "mentions package X / app Y" only by a program-level substring on structured fields (call refs), not on prose (eval roadmap rule: do not assert on prose).
5. Ticket content: `tickets/show` goal/check/evidence (program can look for the package name or app id in goal; weak).
6. Absence of duplicate implementation (hard; heuristics, all program-checkable on the committed tree):
   a. Export-symbol collision: parse the installed package's public exports (`<root>/sdk/@me/<part>/<ver>/mod.ts`, or `@lophn/ui` category `mod.ts` named exports) and check the app `src/` for local declarations with the same exported identifier (`function DataTable`, `const StatTile`, `export function formatMoney`).
   b. File-content similarity: sha256 per file of the package install copy vs app `src/**` (byte-identical copy detection for the "copy component into src" pattern; near-copy via normalized-token shingles, a few lines of code).
   c. For app logic reuse via cross-app call: the target's feature key present in the caller's `app_connections` AND no new table/handler in the caller that duplicates it is not mechanically decidable; use a case-specific oracle (e.g. "the new app's migrations must not create a table named like `event`" for the calendar case).
   d. Positive-only fallback: define reuse as `(package pinned) AND (at least one import from it resolved in source)`; absence-of-duplicate left as a per-case optional assertion with `wrong` record (eval roadmap requires `wrong` example per case, eval.md "case 하나에 들어가는 것").
   e. Dependency-vs-use gap: pinned but not imported (dependency declared yet unused) is detectable by comparing sdk_dependencies with source imports (template already pins `@lophn/wording`, so noise).
7. Template baseline to diff against: the 7 pinned SDK deps + imports in 1.7, so "reused X" must count only what is ABOVE the template.

### 1.7 App template

Source: `packages/core/apps/packages/template/app/*.tmpl` (strip `.tmpl`); installed read-only to `<root>/templates/app/` on every boot (`template/install.ts`, byte-compared each time, no fixed hash). Scaffold: `template/scaffold.ts`; used by `tests/support/app/source.ts:createAppSource` (copies template, git init, one commit).
Contents (files): `AGENTS.md`, `CLAUDE.md`, `blueprint.ts`, `deno.json`, `deno.lock`, `main.ts`, `.gitignore`, `migrations/0-1.sql`, `scripts/{build-ui,generate-wording}.ts`, `src/{app-api,items}.ts`, `src/screens/items/{app.tsx,bridge.ts,index.html,main.tsx,app.module.css}`, `src/wording/{en,placeholders,t}.ts`, `tests/{blueprint,items,wording}_test.ts`, `tests/fixtures/items.json`.
Already uses (blueprint `sdk_dependencies`, `blueprint.ts.tmpl:54-62`): `@lophn/blueprint, cap-problem, cap-app-api, cap-store, ui, app-ui, wording` (7, all 1.0.0). `src/app-api.ts` uses `appApi/AppApiRejection/readResult` (cap-app-api), `openStore` (cap-store), `reportProblem` (cap-problem). Screen `app.tsx` imports `Button` (`@lophn/ui/primitives`), `Field, Input` (`input`), `AppShell` (`layout`), `ReadState` (`feedback`), plus `lucide-react` `Inbox`. Not used by template: `@lophn/ui/data|navigation|overlay|reading`, `cap-project`, `@me/*`, `app_connections` (empty array).
Implication for grading: a "calendar app MVP" built from the template inherits the 7 deps for free; reuse evidence must be extra imports (e.g. DataTable, Dialog, Tabs, charts) or `@me/*`.

======================================================================
## PART 2. MATERIALS: CAPTURE AND RESTORE THROUGH PRODUCT PATHS
======================================================================

Data root layout (listing of `.dev-data/`, repo-local dev root; also `packages/core/install-and-update/data-root.ts`, `packages/core/agent-roles/place/data-folder.ts`): `lophn.db` (+ `-wal`, `-shm`; the ledger SQLite), `ledger-id` (file `ldg_<32hex>`, `packages/core/storage/migration/ledger-id.ts:1-27`), `blobs/` (sha256 content store, purposes, tmp, unreferenced), `derived/lophn-agent`, `agents/` (global agent definition files), `projects/<prj_id>/` (project settings layer, project agents, draft/contexts folders), `apps/<app_id>/{data/app.sqlite, data/backups, bundles/<bundle_hash>, staging, preview}` (`releases/activation/assembly.ts:266,496,522`), `sdk/…` (read-only install copies), `templates/app/` (read-only), `settings.json` (0600), `secrets.json` (0600; provider keys & OAuth tokens, `core/secrets/file-store.ts:1`), `run/`, `logs/`, `shell/`. Data root and managed dirs must be 0700 owned by the user, no symlinks, else boot refused (`data-root.ts:1-60`).

### 2.0 Whole-data-root copy: is it supported?
- No product feature for it. Evidence of what breaks / what is guarded:
  - `ledger-id` is created at ledger creation; derived stores record the ledger id and rebuild if it differs (ledger-id.ts:1-8). A file copy of `lophn.db`+`ledger-id` keeps the same id (OK); copying `lophn.db` without the matching `-wal` yields a stale ledger.
  - `history_mismatch` start failure: if applied schema steps' `version`/`contentHash` differ from the installed code's migration list, core refuses to start (`packages/core/storage/migration/migrations.ts:96-112`, surfaced by `tests/support/core/try-boot.ts:StartFailure`). So a data root snapshot is valid only for the lophn code version (migration list) that wrote it, or a compatible newer one (`newer_schema` is another failure). Per AGENTS.md "개발 데이터는 schema가 바뀌면 지우고 새로 만든다" and no-migration policy, a stored root snapshot would rot on every schema change. Treat whole-root copy as unsupported for materials.
  - SDK copies and template are 0444/0555, so `cp -r` then delete needs chmod first (change-log 0.2.0:497; `removeInstallCopy`). They are re-laid at boot anyway, so exclude `sdk/` and `templates/` from any snapshot (except `sdk/@me/*` which is generated from publish and also in catalog+blobs).
  - Subscription OAuth tokens in `secrets.json` rotate on refresh; "root를 복사하거나 core 둘을 같이 띄우면 안 된다" (eval roadmap eval.md "띄우기, provider, 비용").
  - Absolute paths are baked into ledger rows (app `source_path`, project folders). A root restored elsewhere has dangling paths unless `/tmp/lophn-e2e-*` style paths are reproduced.
- Therefore materials should be restored by REPLAYING product routes on a fresh root, not by copying the root. Fresh root per trial is also an eval requirement (eval.md "case 고르는 규칙" 6).

Harness API available (tests/support): `createRun` (temp run dir with `home/` LOPHN_HOME, `work/` project folders + app sources outside data root, `user-home/`), `bootCore` (env cleared; user token via hello frame; `tests/support/core/process.ts`), `Core.call(route,input[,compare])`, `core.upload` (secrets/put), `core.ids.newId(prefix)` (caller-chosen ids for projects/sessions: `tests/support/core/human.ts` `openProject`, `openSession`), `connectFakeProvider`, `settle`, `until`. `tools/dev.ts` boots a core with fake provider into `.dev-data/`.

### 2.1 App source folder at a version -> ACTIVE app

Capture (after a scenario): the source is a git repo at `<work>/<slug>` (or wherever the AE linked it). Capture = copy the repo incl. `.git` (or `git bundle create`), record commit (40 hex, release `code_commit`) and tree hash (Part 3). Release prepare only reads tree objects of a named commit (`packages/core/apps/releases/prepare/git-extract.ts:1-8`, rejects uncommitted/symlink/.git metadata), so working-tree-only state is not captured by the product at all; require "committed" before capture.
Also capture: app id, slug, name, description (`app.get`), active release number, `bundle_hash`, `blueprint_hash` (`releases/list_records`), the app's grant entries (`app_grants/list`), agent grants of its Operators, `data_schema`.

Restore in a fresh root (full product path as tests do it; `tests/support/app/activate.ts` `activateTestApp`, `project-docs/architecture/testing.md` "앱 길"):
1. `apps/create` {id?, slug, name, description}: USER actor, can pre-assign `id` so ids in `app_connections` and in the material stay valid (registration/commands.ts:105-110). Needed for chained materials.
2. Put source on disk (copy repo), then `apps/connect_source` {app, source_path abs} with `compare {base_revision}` (user | app-scoped coding connection | that app's AE). After connect, core polls (1s) and restarts the agent runtime child because source folder is a place folder; wait with `settle` (activate.ts:`startTestApp`).
3. Agent grant so AE may call coding agent: `agent_grants/set` for `{role:app_engineer, app}` with `{kind:"agent", agent:{role:"coding_agent",app}, setting:"never"}` (activate.ts; user actor). Without it `call` is `not_allowed`.
4. Gateway: `connectGateway(core)` + `reportHarness(core)` play the shell-main role (harness detection + terminal frame). The coding token exists only in the Gateway `coding_terminal` frame `plan.env.LOPHN_CODING_TOKEN` (testing.md; coding-agent.md:44). No user route mints it.
5. AE session + a model: `openSession({role:"app_engineer", app})`, `say("App <id>: <goal>")`. THE AE MUST RUN: `ticket.create` is `actors:["agent"]` (`packages/protocol/coding-agent/ticket/routes.ts:51`), the hand-off is a `call` tool call from the AE (agent actor), and `ticket.verify` is `actors:["agent"]` (routes.ts:148). Neither has a user path (`ticket.cancel` is the only user-capable ticket command, routes.ts:162).
6. Coding-agent role (test plays it) through CLI with the token: `ticket show` -> `ticket claim` -> `release prepare` -> poll `release status` until `completed` (bundle_hash, test hash) -> `app test` (kind `app_test`, with `test` hash) -> poll `app test status/result` -> `release status` (core finalizes release, returns `release` id) -> `ticket report` (verifications) -> exit terminal to revoke token. `release.prepare_bundle` accepts only `coding_agent|machine` actors (`packages/protocol/apps/releases.ts:209-212`), `release.prepare` and `releases.list_records` are machine; test results are machine-written. No user path.
7. AE `ticket.verify result=verified` -> domain event `TicketVerified` -> activation handler (`project-docs/architecture/activation.md`). Needs the AE agent again (second AE turn, `tail:"verify"` in `scriptAe`).
8. `approvals/pending` -> find request with `intent.target.kind === "activation"` and `app` -> `approvals/decide {request, choice:{kind:"allow"}}` (USER actor, `packages/protocol/approvals/requests.ts:154`; `approveActivation`). First activation always asks; later ones ask only if declarations grew or migration `loss`.
9. Wait `app/runtime` state running+ready+accepting (`waitRunning`).
Can activation happen without an agent? No. Needs AE (ticket.create, call, ticket.verify) AND a coding-agent token (CLI). The only agent decisions are the three tool calls (`ticket_create`, `call`, `ticket_verify`), so a deterministic fake-model script (`aeLane`/`scriptAe`, `tests/support/app/activate.ts:111-170`) suffices; it does not need a real model. The fake and a real provider can coexist since model is chosen per session (`sessions/change-model`, eval.md "case 하나가 도는 모양"): use the fake provider only for the restore AE session, then the real model for the scenario sessions. Caveats: `connectFakeProvider` sets the global default model to fake (human.ts:`modelDefaultChange`), the eval roadmap wants no global default (so the receiving side session fails `model_required`), so material-restore must use a session-level model or an agent-definition model rather than the global default; `connectFakeProvider` hard-codes model name `claude-sonnet-4-5` (human.ts:25). Also it costs real time: release prepare (esbuild/deno build, `deno task e2e:deps` pre-fetched DENO_DIR; `systemd-run --user --scope` for app tests; E2E-only network is loopback). Each app restore ~ tens of seconds to minutes (activate.ts waits up to 300 s per phase).
Alternative with fewer steps: NONE supported. `tests/support` states "data root에 release를 직접 깔지 않는다". A "machine" shortcut route exists only in-process (`release.prepare`), not exposed to user token.
What can't be pinned: ticket ids, release ids (`rel_`), verification ids (`vrf_`), invocation ids, call ids, timestamps; they are fresh per restore.

### 2.2 App data (store contents) of an active app
- Capture: via the app's own read app-apis through `app.call_api` (actors user|agent|app, `packages/protocol/apps/calls/call.ts:97-103`), i.e. list/export APIs the app declares. Or copy `<root>/apps/<app>/data/app.sqlite` (needs the app stopped: only the app process opens it; WAL). Raw file capture is NOT a product path.
- Restore: either (a) re-run the app's WRITE app-apis as the user actor (`core.call(appCallApi, {...})`, used in `tests/e2e/operator_test.ts:98,218`), producing invocations/changesets normally (rewind-capable; this is the product path), or (b) put a prepared `app.sqlite` fixture into preview only (`apps/preview/area.ts` takes a fixture, preview is throwaway). Writing the live `app.sqlite` directly bypasses invocation/changeset records (rewind cannot see it, `architecture/app-call.md`) and the ledger. Recommendation: express seed data as an ordered list of `(api, input)` calls, replay in restore. Needs app ACTIVE and running. No agent required (user actor allowed, `app.call_api`). `project_scope: true` APIs need a project in the call (project must exist first).

### 2.3 Project folder with documents
- Capture: folder copy (+ `git` state since tests do `git init`/commit per project folder `work/`). Project metadata: `project/get`/`project/list`.
- Restore: copy files to a fresh path, then `project/create` (`projectApi.register`, USER actor, `packages/protocol/projects/project-api.ts:86-90`) with caller-chosen `id: core.ids.newId("prj")` (so ids can be stable), `name`, `title`, `purpose`, `folders:[{path, description, subfolders}]`. Helper `openProject` (tests/support/core/human.ts:106-123) then `settle` because the runtime child restarts (project folders widen Deno write permissions, human.ts `settle` doc). No agent needed.
- Documents with `LOPHN.md`: just files (see 2.6).

### 2.4 Applied context (contract + search script)
- Capture: the applied bundle is `bundle.json` (single file: schema, contract types/rules, searches, saved_views, examples; sample in `tests/e2e/pm-context_test.ts:46-89`) in the context's version folder under `<root>/projects/<prj>/…`; also readable via routes `context/get`, `context/contract`, `context/bundles` (READ_ACTORS user|agent, `packages/protocol/projects/context-api.ts:854-990`). Capture `bundle.json` bytes.
- Restore requires an AGENT: `context.create` is user|agent (context-api.ts:719-723) but `bundle.open_draft` is `["agent"]` (`context-drafts.ts:45-48`), `bundle.test_draft` is `["agent"]` (context-drafts.ts:56-60 area), `bundle.submit` is `["agent"]` (context-api.ts:760-764), `bundle.finish_check` machine. User-only: `bundle.rollback`, `view.save/update/delete`, `context.archive`. `glossary.set/remove` user|agent. So there is NO user path to apply a bundle; the PM must run `context_draft` -> `file_write(<draft folder>/bundle.json)` -> `context_test` -> `context_submit` (exactly what pm-context_test does with the fake: `tests/e2e/pm-context_test.ts:120-160`, 3 scripted replies). A deterministic fake-model PM script reusing that shape can restore any `bundle.json` byte-identically; isolated test must pass (`applies:true`) because example `expect_keys` must match the project documents, so restore the project folder BEFORE the context. A real PM model is not needed for restore.
- IDs: context id/draft id come back from `context_draft` result; not pinnable.

### 2.5 Published package version
- Capture: the install copy `<root>/sdk/@me/<part>/<version>/` (files) + catalog entry (name, description, versions, permissions, guide text via `packages/guide_body`) + the source repo/commit/path it came from.
- Restore: the only path is `package.publish` by the AE of an app (agent actor), whose tool needs (a) the app connected to a git source containing the folder at HEAD, (b) `tests[]` = passed verification ids of THAT app in the new ledger (so the app must have gone through 2.1 first in this root, or at least a prepared release + passed app test), (c) the same name+version bytes (idempotent; different bytes => conflict). A deterministic fake AE script `package_publish{...}` works (one tool call), but verification ids must be read from the ledger (`release.get` tests list) at run time (`reply: (request, journal) => ...` function replies exist in fake server, testing.md "가짜 셋"). No user or machine route is exposed for register. Since `package.publish` has never been exercised by a test (grep = 0), plan an E2E to prove it first.
- Alternative: instead of publish, have the scenario depend on the publishing app (restore app 1 and run the publish step as part of the material recipe).

### 2.6 Instruction layers, Operators, agent grants
- LOPHN.md layers are plain files (`packages/core/lophn-agent/instructions/files.ts:1-12`, `packages/protocol/lophn-agent/instructions.ts:61-66`): global `<root>/LOPHN.md`, project `<first project folder>/LOPHN.md`, agent body file in the agent definition (`<root>/agents/…`, `<root>/projects/<prj>/agents`, `<root>/apps/<app>/agents`, `data-folder.ts`). Max 32 KiB (`INSTRUCTION_FILE_MAX_BYTES`). "파일 저장은 사람이 editor에서 하고 agent는 만들 길이 없다" -> restore = write the files directly; no route. Project `LOPHN.md` rides along with the project folder material. Global LOPHN.md and agent-definition files live INSIDE the data root, so write them after boot into `<root>/…`; core reads on each use. The app/project-scoped agent folders contain the ids in the path, so restore after `project/create`/`apps/create` with pinned ids.
- Operators: `operators/create` (`CreateOperator`) actors `["user","agent"]` (`packages/protocol/lophn-agent/agent-definitions.ts:190-193`). Used in tests/e2e/operator_test.ts:65. Input defined in `createOperatorInputSchema` (place, name, ...). USER path exists.
- Grants: `agent_grants/set` USER only (`SetAgentGrant`, grants.ts:156-159); `agentGrantsGet` to capture (operator_test.ts:256,285). Entries reference app ids, so restore after app ids exist (pin ids).
- Settings: `<root>/settings.json` written before boot (testing.md: `lophn-agent.model.catalog_auto_update:false`), or `settings` routes. Model choice is per session/definition/project/global default (eval.md).
- Providers: `providers/definitions` -> `secrets/put` (`core.upload`) -> `providers/connect` -> model default / `sessions/change-model` (eval.md); secret values must come from `.env` at run time, never from a material.

### 2.7 Non-portable and must-recreate list
- Generated ids: `rel_`, `tkt_`, `vrf_`, `cal_` (call), `ses_` (unless caller-chosen: sessions, projects, providers use caller-supplied ids in helpers; apps only if USER passes `id`), invocation ids, approval request ids, context/bundle/draft ids, `key_` idempotency keys, timestamps/seqs.
- `ledger-id`, `lophn.db`: per-root, schema-version bound (history_mismatch).
- Secrets and OAuth tokens (`secrets.json`), provider ids/endpoints (fake server endpoint is recorded in the ledger; port must be stable for reuse: `tools/dev.ts` uses fixed 7499 for that reason).
- Absolute paths: `app.source_path`, project folders, `apps/<id>/…` data paths, coding terminal cwd.
- `sdk/` and `templates/` (re-laid each boot, read-only; version in file names but bytes can change).
- Coding tokens (per session, revoked).
- Runtime state: app process socket folder under `XDG_RUNTIME_DIR` per data root (testing.md "앱 길"): app tests need `XDG_RUNTIME_DIR` and user systemd (`systemd-run --user --scope`), else app E2E fails.
- App `data/backups`, `bundles/` (sealed bundles are content-addressed and rebuilt by release prepare).

### 2.8 Summary table: what needs which actor

| state | capture | recreate path | needs agent actor? | notes |
|---|---|---|---|---|
| app source @ commit | git repo + commit | copy repo; `apps/create`(id pinned) + `apps/connect_source` | no for registration | files are plain; registration alone gives no release |
| ACTIVE app | commit + metadata | create, connect, grant, AE ticket.create+call, coding CLI (claim, release prepare, app test, report), AE ticket.verify, user approval | YES: AE (3 tool calls) + coding-agent CLI role (test code) | fake-model script OK |
| app data | export via read app-api | `app.call_api` writes as user | no | needs app running; replay not copy |
| project + docs | folder copy | `project/create` (user) | no | restart settle |
| applied context | `bundle.json` | PM `context_draft`/`file_write`/`context_test`/`context_submit` | YES: PM (4 tool calls) | fake script from pm-context_test works; no user path |
| published package | install copy + source | AE `package.publish` with vrf ids | YES: AE (1 tool call) after app has passed tests | never tested in repo |
| LOPHN.md layers | files | write files | no | user edits files only |
| Operator | definition read | `operators/create` (user) | no | |
| grants | `agent_grants/get` | `agent_grants/set` (user) | no | after app ids exist |
| provider/secrets | not captured | `secrets/put` + `providers/connect` | no | from env at run time |

======================================================================
## PART 3. VERSIONING
======================================================================

Existing identities in code:
- `packages/base/hash.ts`: `sha256Hex(bytes|string)` and `fingerprint(value)` = sha256 of `canonicalize(value)` (`packages/base/canonical-json.ts:16`, sorted-key canonical JSON; rejects non-finite numbers, cycles, non-plain objects).
- `bundleBytes(files)` in `packages/core/apps/packages/install.ts:~58-72`: concatenates sorted `path\nlength\nbytes\n` records; `sha256Hex(bundleBytes)` is the package `bundle_hash` (publish.ts:95-103) and install copy identity. This is the repo's existing "folder content hash".
- Releases: `code_commit` (40-hex git commit of the app source), `bundle_hash` (sha256 of manifest JSON + file hashes, `releases/bundle/manifest.ts:manifestBytes`), `blueprint_hash` (sha256 of canonical blueprint JSON, `releases/commands.ts:502-506`), monotonically increasing `number` per app, `data_schema`.
- Packages: exact semver (immutable once registered), `bundle_hash`, `guide_hash`.
- Built-in SDK: semver in `deno.json` ("1.0.0") that does NOT track content (re-laid each boot, bytes may change at the same version).
- Template: no version; byte-compared each boot (`template/install.ts:1-3`).
- Ledger: `ledger-id` random per ledger (ledger-id.ts) (not a content version).
- The eval roadmap says to record lophn version via git (`project-docs/products/roadmap/eval.md`, scorecards named `<날짜>-<model>.md`).

Recommended minimal scheme (no new infra; both pieces exist in code):

Option A (recommended): every material = a typed tuple with a CONTENT HASH computed by one function and a human label.
- `material_id` (human label, e.g. `calendar-app`), `kind`, `content_hash`, plus optional `source_ref`.
- `content_hash` = `sha256Hex(bundleBytes(sortedFiles))` over the material's files after excluding `.git/`, `node_modules/`, `.lophn/`, `dist/`, and `*.sqlite*`. Reasons: (1) it is exactly how packages are identified today (`bundle_hash`), so for a published-package material the hash equals the catalog's `bundle_hash` and a grader can compare directly; (2) independent of git author/time so a regenerated material with identical content has an identical id (a git commit hash is not stable across re-creation); (3) works for non-git materials (project folders with docs, LOPHN.md, `bundle.json`, seed lists).
- For git app sources add `git rev-parse HEAD^{tree}` (tree hash) as secondary field and keep the commit hash only as provenance: tree hash is content-only and git already computes it; commit hash varies with author/date (`tests/support/app/source.ts` uses fixed identity but real time stamps, so two creations differ). The release's `code_commit` ties a hash back to a ledger release of a given run.
- Material versioning = chain: `version = content_hash` with `parent` pointer to the material it was derived from (scenario output "saved as new material version") and `produced_by = {scenario_id, trial_id, lophn_commit}`. Scorecard lists `[(material_id, content_hash[:12])...]`.
- Where to compute: the harness, on a path outside the data root (`work/` folder) using `packages/base/hash.ts`, and `install.ts bundleBytes` (exported). Must read files in sorted path order; the existing function sorts by byte string comparison on paths.

Option B (simplest, git only): store each material as a git repo (or one repo with one tag/commit per material version) and use the commit hash as version. Pros: trivial to snapshot/diff an app source (`app.source_path` is already a git repo and release prepare needs a commit). Cons: not applicable to non-git materials (grants, seed call list, bundle.json) unless wrapped in a git repo too; commit hashes change when the same content is recreated; two worker runs produce different commits for identical content. Use Option B only as the storage format (a repo per material) and still key the scorecard by Option A's tree/content hash.

Also record in each scorecard line, because outcomes depend on them though they are not materials:
- lophn code version: `git rev-parse HEAD` of the lophn repo (+ dirty flag) AND `sha256Hex(bundleBytes(<root>/sdk + <root>/templates/app))` as the environment hash, since SDK and template change under fixed semver "1.0.0" and template has no version (above). Role prompts live in the lophn commit.
- model ids per role, scenario id, trial count, per `eval.md` scorecard shape.
- Material hash of the INPUT set (sorted list) + hash(es) of OUTPUT materials saved.

Ids inside material content: since blueprint `app_connections` pins `app_<id>` and the agent grants pin app ids, a material that references other materials must either (a) be restored with USER-pinned ids (`apps/create id`, `project/create id`) and carry those ids in its manifest, or (b) be treated as parameterized (placeholder replaced at restore). Option (a) is supported by code today (apps/create user `id`, projects register `id`, sessions `id`), so material manifests can carry `{app_id: "app_..."}` and the dependent material's blueprint is valid across restores.

======================================================================
## KEY FINDINGS / RISKS FOR THE DESIGN
======================================================================
1. Reuse discovery gaps (product, not model): lophn/AE cannot list another app's app-apis (`app.list/get` omit them; `app.app_api` route has no tool; file scope excludes other apps' sources) and cannot read built-in SDK guides (`package.*` sees `@me` only; no sdk file scope). The reuse prompts (lophn prompt L14-16, AE prompt L21-23) point at tools that cannot show UI components or app-apis. An eval for "finds app-api of app X" will measure these gaps unless the case grants the app to the agent (app-api tools appear) or the scenario text names it.
2. `package.publish` untested end-to-end; `app_connections`/`connectAppApi` untested end-to-end; `blueprint.check` does not validate connection targets. Scenarios 2 (app-api) and any `@me` reuse need a smoke E2E first.
3. Template `AGENTS.md.tmpl` references non-existent `lophn_sdk`, `lophn-navigate`, `lophn-save`, `lophn_session`: the coding agent's first-read file contains dead pointers.
4. Restoring an ACTIVE app = ~3 AE tool calls + coding CLI + approval; deterministic with a fake-model AE (existing helpers). Context restore = PM 4 tool calls (fake). Package restore = AE 1 tool call. Everything else is user-actor routes or plain files.
5. Whole-root copy is not a product feature and is guarded by `history_mismatch`/`newer_schema`, absolute paths and secret rotation. Replay recipes per material are the only schema-change-proof path.
6. Pin ids with USER `apps/create id` / `project/create id` so chained materials reference stable ids.
7. Content hash recommendation: `sha256Hex(bundleBytes(files))` (+ git tree hash for repos); record lophn commit and sdk/template environment hash in every scorecard.

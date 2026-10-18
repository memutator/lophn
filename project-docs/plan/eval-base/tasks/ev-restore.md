# ev-restore

trial마다 새 data root에 재료(material)를 제품 route로 되살리고, 시나리오 setup이 쓰는 helper(grant, 열린 problem, ticket)와 이 계획의 재료 넷(`apps-home@1`, `projects-home@1`, `tax-receipts@1`, `operators-home@1`)을 만든다. 되살리기에는 진짜 model을 쓰지 않는다. 에이전트가 움직여야 하는 곳(context)은 fake 대본으로 간다.

- 단위: ev-restore (wave 2)
- 선행: ev-contract
- 소유(이 task만 고친다):
  - `tests/eval/restore/**`
  - `tests/eval/materials/**`
- 읽을 것:
  - 이 계획: `project-docs/plan/eval-base/README.md`(자리, 정한 것, 계약), `project-docs/products/roadmap/eval.md`의 "재료"(종류와 되살리는 길, 자리와 조립), "책임에 따른 call: 작은 판단 case"(case마다 world와 setup), "진짜로 도는 것"
  - architecture: `project-docs/architecture/testing.md`(`tests/support`, 앱 길, fake server), `project-docs/architecture/approval.md`(grant: `never`/`ask`/`excluded`), `project-docs/architecture/agent-call.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`, `contexts`, `approvals`, `agents`; `project-docs/module-catalog.yaml`의 `tests`
  - 본보기(그대로 import해서 쓴다):
    - `tests/support/core/mod.ts`: `Core`(`call`, `tryCall`, `ids`), `Run`(`run.work`, `run.home`)
    - `tests/support/core/human.ts`: `connectFakeProvider`, `openSession`, `say`, `waitTurnEnd`, `until`, `settle`
    - `tests/support/core/process.ts`: `runtimePids`
    - `tests/support/fake-server/mod.ts`, `tests/support/fake-server/probe.ts`: `startFakeServer`, `Step`, `Reply`, `JournalEntry`, `lastToolResult`, `idIn`
  - 본보기(복사해서 줄인다. test file이라 import할 수 없다):
    - `tests/e2e/pm-context_test.ts`의 `bundle()`, `draftOf`, `afterDraft`, `runRow`: context를 만드는 길(PM이 `context_draft` → `bundle.json` 쓰기 → `context_test` → `context_submit`, 적용을 `contextGetRoute`로 기다림)
    - `tests/e2e/reaction_test.ts`의 `reportViewError`: 앱 process 없이 problem을 여는 길
    - `tests/e2e/operator_test.ts`(`operatorCreate` 입력), `tests/e2e/registration_test.ts`(`appCreate`만으로 App Engineer가 생기는 것)
    - `tests/support/app/activate.ts`의 `tool`, `scriptAe`: App Engineer fake 대본의 모양
- 계약:
  - 쓰는 것:
    - `tests/eval/types.ts`(ev-contract): `MaterialManifest = { kind: MaterialKind; ids: Record<string, string>; needs: string[]; parent: string | null; produced_by: { scenario: string; trial: number; run: string } | null; content_hash: string }`, `MaterialKind = "app" | "project" | "context" | "operator"`(단수), `WorldIds`, `SetupContext = { core: Core; fake: FakeServer; world: WorldIds }`, `Participant`(`Omit<NamedAgent, "role"> & { role: Role }`. `NamedAgent`·`Role`은 `packages/protocol/lophn-agent/calls.ts`·`places.ts`). `WorldIds`는 이름으로 키를 잡는다: `apps`(app.name → `Id<"app">`), `projects`(project.name → `Id<"prj">`), `folders`(project.name → 되살린 폴더 절대 path), `contexts`(context name → ctx id), `operators`(Operator name → `Id<"agt">`). 이 task는 이 type을 정의하지 않고 import한다.
    - protocol(고정 route, 사람 자격으로 부른다): `appCreate`(`packages/protocol/apps/apps.ts`, `id`를 미리 정할 수 있다), `projectApi.register`(`packages/protocol/projects/project-api.ts`, `id` 필수), `contextCreateRoute`·`contextGetRoute`(`packages/protocol/projects/context-api.ts`, `contextCreateRoute`는 `id: ctx_...`를 정할 수 있다), `operatorCreate`(`packages/protocol/lophn-agent/agent-definitions.ts`, `id: agt_...`), `agentGrantsSet`(`packages/protocol/approvals/grants.ts`), `observeViewError`·`problemList`(`packages/protocol/problems/`), `settingsUpdate`(`packages/protocol/config/`), `modelDefaultChange`(`packages/protocol/lophn-agent/models.ts`), `idSchema`(`packages/protocol/base/ids.ts`).
  - 내놓는 것(ev-runner, ev-cases-*, ev-versions가 기댄다):
    - `tests/eval/restore/mod.ts`:
      - `beginRestore(core: Core): Promise<SetupContext>`: fake server를 띄우고 `connectFakeProvider`로 붙인다(전역 기본 model이 fake가 된다). `world`는 빈 map들로 시작한다.
      - `restoreWorld(ctx: SetupContext, refs: string[]): Promise<Result<void>>`: `refs`는 `이름@n` 목록. `needs`를 따라 순서를 정하고, 재료마다 hash를 확인한 뒤 되살리며 `ctx.world`를 채운다. hash가 다르면 되살리기 전에 멈춘다.
      - `endRestore(ctx: SetupContext): Promise<void>`: 전역 기본 model을 `null`로 되돌리고(`modelDefaultChange`) fake server를 닫는다. 이 뒤 root에는 model이 어디에도 없다. ev-provider가 이 상태를 기대한다.
      - `agentRefOf(world: WorldIds, participant: Participant): AgentRef`: `Participant`를 이름으로 풀어 `AgentRef`로 만든다(lophn은 그대로, PM은 `place.project`를 `world.projects`로, App Engineer는 `place.app`을 `world.apps`로, Operator는 `name`을 `world.operators`로). 못 풀면 던진다. `excludeCall`이 쓰고 ev-runner도 같은 것을 쓸 수 있게 export한다.
    - `tests/eval/restore/setup.ts`(시나리오 `setup`이 `SetupContext`를 받아 부른다):
      - `excludeCall(ctx, from: Participant, to: Participant): Promise<void>`: `from`의 grant를 `[{ kind: "agent", agent: <to를 푼 call 대상>, setting: "excluded" }]`로 바꾼다(T19).
      - `openProblem(ctx, app: string): Promise<{ problem: string }>`: `app`은 app.name. 앱에 open problem 하나.
      - `openTicket(ctx, app: string, goal: string): Promise<{ ticket: string }>`: `app`은 app.name. 앱에 open ticket 하나.
    - `tests/eval/restore/manifest.ts`: `loadMaterial(root, ref)`, `verifyMaterial(...)`, `writeMaterial(...)`(아래 "할 일" 3), `contentHash(files)`. 내용 hash의 정본은 여기다. ev-versions는 registry에 이 hash를 `material.json`에서 읽어 적기만 한다.
    - `tests/eval/materials/<이름>/1/`: 재료 넷(아래 "할 일" 5). 이름은 `apps-home`, `projects-home`, `tax-receipts`, `operators-home`.

## 할 일

근거: `project-docs/products/roadmap/eval.md`의 "재료", `project-docs/architecture/testing.md`.

1. **hash** (`tests/eval/restore/hash.ts`): `contentHash(files: { path: string; bytes: Uint8Array }[]): Promise<string>`. file을 path 순으로 정렬해 `<path>\n<byte 수>\n<bytes>\n`을 이은 byte의 `sha256Hex`(`packages/base/mod.ts`)다. hash는 file을 쓴 그대로의 byte로 잰다. 이 모양은 `packages/core/apps/packages/install.ts`의 `bundleBytes`와 같지만 import하지 않고 이 file에 10줄로 쓴다. 이유: core를 variant로 바꿔도 재료의 hash가 변하면 안 된다.
2. **재료 읽기와 확인** (`manifest.ts`):
   - 재료 자리는 `tests/eval/materials/<이름>/<n>/material.json`과 `files/`다. `loadMaterial(root, "이름@n")`은 manifest와 `files/` 아래 모든 file(상대 path, bytes)을 읽는다. `ref` 쪼개기(`이름@n`)는 3줄로 이 file 안에서 한다.
   - `verifyMaterial`은 `contentHash(files)`와 `manifest.content_hash`를 견주고 다르면 `err({ code: "conflict", message: "material <ref> content hash differs" })`다(`Result`는 `packages/base/mod.ts`). `restoreWorld`는 재료를 되살리기 전에 이것을 부르고, 실패하면 아무것도 되살리지 않는다.
   - `ids`의 값은 `idSchema(prefix).parse`로 읽을 때 확인한다(오타를 일찍 잡는다). `ids`의 키는 `WorldIds`와 같은 이름이다(앱은 app.name, project는 project.name, context·Operator는 그 name).
   - data file(`material.json`, `files/*.json`)은 `JSON.stringify(value, null, 2) + "\n"`로 쓴다. `tests/eval/materials/`는 lead가 `deno.json`의 `fmt.exclude`에 넣으므로 `deno fmt`가 다시 쓰지 않는다. 손으로 쓸 때도 이 모양을 지킨다. `writeMaterial`도 같은 모양으로 쓴다.
   - 순서: `needs`를 깊이 우선으로 따라가며 중복을 한 번씩만 넣는다. 순환이면 `err`.
3. **새 n 쓰기** (`manifest.ts`): `writeMaterial(root, name, n, manifest(content_hash 뺀 것), files)`. 이미 있는 `<이름>/<n>/`이면 쓰지 않고 `err({ code: "conflict" })`다(commit된 재료를 덮어쓰지 않는다). `content_hash`는 `contentHash(files)`로 채운다. 이 계획의 판단 case는 `save`가 없어 아직 아무도 부르지 않지만 ev-runner가 쓴다.
4. **되살리기** (`restoreWorld` 안, 종류마다 file 하나: `apps.ts`, `projects.ts`, `context.ts`, `operators.ts`):
   - `app`(`files/apps.json`: `[{ slug, name, description }]`, `manifest.ids[name]`가 앱 id): `appCreate({ id, slug, name, description })`. source는 연결하지 않는다. 등록만으로 그 앱의 App Engineer를 열 수 있다(`tests/e2e/registration_test.ts`의 `app-creates-ae`). `ctx.world.apps[name] = id`.
   - `project`(`files/projects.json`: `[{ name, title, purpose }]`와 `files/<name>/**` 문서, `manifest.ids[name]`가 project id): `files/<name>/`를 `ctx.core.run.work` 아래 `<name>`으로 복사하고 `projectApi.register({ id, name, title, purpose, folders: [{ path, description: "", subfolders: [] }] })`를 부른다. project를 등록하면 core가 agent runtime child를 새 권한으로 다시 띄우므로 `runtimePids`로 앞 pid를 잡아 두고 부른 뒤 `settle(core, before)`를 기다린다(`tests/support/core/human.ts`의 `openProject`와 같다. 그 helper는 id를 못 정하므로 쓰지 않는다). `ctx.world.projects[name]`, `ctx.world.folders[name]`.
   - `context`(`files/context.json`: `{ project: <project name>, name, title, purpose }`, `files/bundle.json`, `manifest.ids[name]`가 ctx id): ① `contextCreateRoute({ id, project, title, purpose })`(사람 자격으로 id를 정한다). ② `ctx.fake.reset()` 뒤 PM fake 대본: `context_draft { context: id }` → `file_write`로 `<folder>/bundle.json` → `context_test` → `context_submit` → `text`. `tests/e2e/pm-context_test.ts`의 `afterDraft`와 같은 모양이다. ③ PM session(`{ role: "project_manager", project: <id> }`)을 `openSession`+`say`로 열고 `waitTurnEnd`, 그 뒤 `contextGetRoute`의 `applied`가 생길 때까지 `until`로 기다린다. 적용이 안 되면 `err`(fake journal의 마지막 tool 결과를 message에 담는다). `context_draft { context }`가 아직 판이 없는 context에 안 되면 `{ name, purpose }`(새 context)로 바꾸고 id는 응답에서 받아 쓰되, 그 경우 `manifest.ids`를 쓰지 않고 보고에 적는다. `ctx.world.contexts[name] = id`.
   - `operator`(`files/operators.json`: `[{ place: { kind: "app" | "project", name }, definition: { name, body, contexts?: <context name>[] } }]`, `manifest.ids[definition.name]`가 `agt_` id): place의 name을 `ctx.world.apps` / `ctx.world.projects`로, `contexts`의 name을 `ctx.world.contexts`로 풀어 `operatorCreate({ id, place: { kind, id }, definition })`. model은 정의에 넣지 않는다(model은 ev-provider가 붙인다). `ctx.world.operators[name] = id`.
   - 되살리기가 연 session(PM 등)을 따로 모으지 않는다. collector가 t0 이전에 시작한 turn을 시간으로 잘라 뺀다.
5. **재료 넷** (`tests/eval/materials/<이름>/1/`). 각 `material.json`의 `content_hash`는 `files/`를 다 쓴 뒤 `contentHash`로 잰 값이다(임시 script로 재서 채운다). `produced_by`는 `null`, `parent`는 `null`.
   - `apps-home@1` (`kind: "app"`, `needs: []`): 앱 둘. `{ slug: "ledger", name: "가계부" }`, `{ slug: "todo", name: "할일" }`(`ids` 키는 `가계부`, `할일`). `description`은 한 줄(줄바꿈 금지).
   - `projects-home@1` (`kind: "project"`, `needs: []`): project name `tax`(title 세무)와 `hr`(title 인사)(`ids` 키는 `tax`, `hr`). `files/tax/`에는 문서 몇 개: 공제 한도 자료(L5가 모으라는 것) 둘 정도, 그리고 `tax-receipts@1`의 bundle이 읽을 `receipts/*.md` 둘(frontmatter `slug`, `store`, `amount`, `date`). `files/hr/`는 문서 하나면 된다. 문서는 짧게, 한국어로.
   - `tax-receipts@1` (`kind: "context"`, `needs: ["projects-home@1"]`): project `tax`의 context 하나(name `receipts`, title "영수증". `ids` 키는 `receipts`). `bundle.json`은 `pm-context_test.ts`의 `bundle()` 모양에서 type `Receipt`(docs `receipts/*.md`, key `slug`, 칸 `store`, `amount`, `date`)로 만든다. **공급자(supplier) 칸은 일부러 넣지 않는다**(O6이 "계약에 공급자 칸이 없다"를 알아채는지 보는 case다). `examples`의 `expect_keys`는 `files/tax/receipts/`에 있는 slug와 맞춘다. 만든 뒤 `bundleContentSchema.parse`(`packages/protocol/projects/context-contract.ts`)가 통과하는지 먼저 본다.
   - `operators-home@1` (`kind: "operator"`, `needs: ["apps-home@1", "projects-home@1", "tax-receipts@1"]`): Operator 둘. 앱 `가계부`의 Operator(이름 `월말정리`)와 project `tax`의 Operator(이름 `세무정리`, `contexts: ["receipts"]`)(`ids` 키는 `월말정리`, `세무정리`). `body`는 한두 줄의 짧은 지침. grant는 이 재료에 넣지 않는다(case의 setup이다).
   - 고정 id는 `app_`, `prj_`, `ctx_`, `agt_` + ULID 26자(`[0-7][0-9a-hjkmnp-tv-z]{25}`)다. 눈에 띄게 읽히는 값으로 직접 정한다(예: 끝에 `ap01`처럼). `i l o u`는 쓸 수 없다. `idSchema(...).parse`로 확인한다.
6. **setup helper** (`setup.ts`):
   - `excludeCall`: 위 계약대로. `from`·`to`를 `agentRefOf`로 푼다. `agentGrantsSet({ agent: <from을 푼 AgentRef>, entries })`는 entries를 통째로 바꾼다(새 root라 다른 줄이 없다).
   - `openProblem`: 먼저 `settingsUpdate`로 `reactions.problem_opened`를 `"off"`로 둔다(기본 `open`이면 App Engineer session이 열려 fake 대본을 쓴다. `tests/e2e/reaction_test.ts`의 `setMode`). 그 뒤 `observeViewError`로 앱에 problem을 연다(`reportViewError`의 입력 모양을 그대로 쓰되 `report_id`로 message를 달리 한다). 받은 `accepted.problem`을 돌려준다.
   - `openTicket`: App Engineer는 ticket을 만드는 유일한 자격이다(`ticketCreate`의 actors는 `agent`뿐). `ctx.fake.reset()` 뒤 App Engineer fake 대본 `ticket_create { app, goal, check: { kind: "text", text: ... } }` → `text`를 걸고, `openSession`(`{ role: "app_engineer", app: <app.name을 푼 id> }`)+`say`+`waitTurnEnd`. ticket id는 `ticketList`(`packages/protocol/coding-agent/ticket/`)로 읽는다. 열린 앱이 없어도 되는 것은 core가 앱 등록만 보기 때문이다(`packages/core/apps/tickets/commands.ts`의 `create`).
7. **위험 test** (`tests/eval/restore/manifest_test.ts`, 1 file): 아래 "끝남"의 문장 그대로. 임시 폴더만 쓴다(core를 띄우지 않는다).

## 끝남

- `deno task check`가 통과한다. `tests/eval/restore/manifest_test.ts`도 check가 돌린다. core를 띄우지 않고 임시 폴더만 쓰는 순수 test여야 한다.
- 위험 test: "재료 file이 한 byte라도 달라지면 hash 확인이 거절하고, 이미 있는 `<이름>/<n>/`에는 새 재료를 쓰지 않는다" (committed 재료가 조용히 바뀌어 모든 기준 run이 다른 world에서 돈 것이 되는 것을 막는다.)
- 되살리기 자체(core를 띄우는 길)는 test로 만들지 않는다(subprocess를 띄우는 test는 사람에게 묻는다). 대신 임시 script(scratchpad, commit하지 않는다)로 한 번 확인한다: `createRun` → `bootCore` → `const ctx = await beginRestore(core)` → `restoreWorld(ctx, ["operators-home@1"])` → `endRestore(ctx)` → `appList`·`projectApi.list`·`agentDefinitionList`·`contextGetRoute`로 넷이 되살아났는지 읽고, 이어서 `openProblem`·`openTicket`·`excludeCall`을 한 번씩 부른다. fake provider만 쓴다. 진짜 provider는 부르지 않는다.
- 주석과 test 이름에 task id·요구 ID를 쓰지 않는다(`deno task check`의 source 검사).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`deno.json`의 `eval` task와 `fmt.exclude`는 lead가 한다)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 정한 것(특히 `context_draft`를 `{ context }`로 부른 결과, ULID 값, `ids` 칸이 실제로 어느 칸이 되었는지)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: `MaterialManifest` 칸이 위 기대와 다르면 여기 적는다. `SetupContext`·`WorldIds`가 `types.ts`에 위 모양으로 있는지 적는다.
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음". 켜진 앱·앱 data·package·call 재료와 App Engineer가 실제 일을 하는 setup은 `eval-coding`의 몫이다.

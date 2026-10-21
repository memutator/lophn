# ab-preview

App Engineer가 prepared release를 preview로 띄우고, 거기 뜬 앱의 tool을 부르고, 닫는 tool 셋 `preview.start`, `preview.call`, `preview.stop`을 더한다. preview의 모양(봉인된 bundle, fixture data, net과 secret 대역, 앱마다 하나)은 그대로이고 여는 쪽에 App Engineer를 더한다(README "App Engineer의 새 tool", roadmap "새로 더하는 것"). coding agent의 길(`lophn app preview start`와 coding MCP)은 그대로다.

- 단위: preview (wave 1)
- 선행: ab-cli
- 소유(이 task만 고친다):
  - `packages/protocol/apps/previews.ts`
  - `packages/protocol/apps/calls/call.ts`(규칙 주석만)
  - `packages/core/apps/preview/{service.ts,model.ts}`
  - `packages/core/apps/releases/activation/desired.ts`(`createCopyPreviewBundles`의 fixture만)
  - `packages/core/apps/calls/{caller.ts,service.ts,calls_test.ts}`
  - `packages/core/apps/agent-tools/preview.ts`(새 file)
  - `packages/core/apps/agent-tools/mod.ts`
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/core/apps/{ports.ts,routes.ts}`(`findPreview`의 `takesInput`만)
  - `packages/coding-agent/cli/main_test.ts`(134줄 `fixture_hash` → `fixture`만. ab-cli 뒤)
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "정한 것 › App Engineer의 새 tool", "뼈대 검토에서 정한 것"의 "`previews.start`의 입력 `fixture_hash`는 `fixture`(bundle 안 path)가 된다"와 "`release.prepare`의 handler 검사는 preview service로 봉인된 bundle을 띄운다"(ab-release-prepare가 이 service를 쓴다)
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`의 "모양 › 새로 더하는 것", "정한 것(agent)"의 "examples gate와 그 실행기를 지운다"(App Engineer가 preview에서 tool을 직접 불러 확인한다). `project-docs/products/roadmap/app-preview.md`의 "지금 코드 › core"(preview의 지금 모양. `fixture_hash`는 이 task로 바뀐다)
  - architecture: `project-docs/architecture/app-call.md`의 "흐름"(부르는 길 넷과 previewOnly)과 73-78줄(preview 호출 규칙: 기록·막기·줄 없음, bundle 선언으로 판정). 이 task로 "preview를 부르는 쪽"이 틀린다. 문서는 계획 끝에 lead가 고친다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`(`app-runtime`), `agent-tool-spi`, `core-api`; `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 코드(줄은 main `dd956b49f`)
    - protocol: `packages/protocol/apps/previews.ts` 14-19(`previewInputSchema`), 21-35(관측. `reason`은 `{code, summary}`), 47-63(`previewsStart`). 경로 schema 본보기는 `relativePathSchema`(`packages/protocol/projects/values.ts` 28-36, `packages/protocol/apps/releases.ts`가 이미 import한다). `packages/protocol/apps/calls/call.ts` 130-133(규칙 주석), 191-205(`appCallTool`, actors에 `agent`가 있다)
    - preview service: `packages/core/apps/preview/service.ts`의 `PreviewBundle.fixture` 52-53, 자격 주석과 `actorKind` 127-130, `gate` 169-191, `start`의 fixture 224-234. `authorize`는 조립에서 `createTargetAuthorizer`다(`packages/core/apps/control.ts` 450-451). App Engineer 자격은 `conditions.app`이 담당 앱이라(`packages/core/agent-roles/credentials.ts` 84-113) 다른 앱 target은 `not_found`, operation이 없는 role은 `forbidden`이다(`packages/core/server/identity/model.ts` 118-152).
    - preview 대기: `packages/core/apps/preview/launcher.ts` 118(`READY_TIMEOUT_MS` 30초), 284-310(실패 이유 `start_failed`), 334-349(`unexpected_exit`), 351-371(`wireOf`의 ready와 reason). `packages/core/apps/preview/model.ts` 46-49(`PREVIEW_STARTING`, code `starting`). model.ts는 type import만 있어 agent tool file이 import해도 된다.
    - bundle: `packages/core/apps/releases/activation/desired.ts` 234-281(`createCopyPreviewBundles`. 머리 주석 234, fixture 257-268). fixture byte는 disposable 영역의 `app.sqlite`가 된다(`packages/core/apps/preview/area.ts` 36-50).
    - 앱 호출 경로: `packages/core/apps/calls/caller.ts` 40-90(`verifyCaller`. live 검사 51-56, agent 58-74), `packages/core/apps/calls/service.ts` 136-198(`call`. previewOnly 140-148, preview 갈래 165), 215-244(`callPreview`와 주석). agent의 `AgentRef`는 `{ role: "app_engineer", app }`이다(`packages/protocol/lophn-agent/places.ts` 39-47). `app.call_tool` memory 처리기(`packages/core/apps/routes.ts` 51-65)와 dispatch(`packages/core/server/dispatch.ts` 482-500)는 operation을 보지 않는다. 그래서 agent의 preview 호출 경계는 `verifyCaller` 하나다.
    - 선언 조회: `packages/core/apps/ports.ts` 57-77(`AppToolLookup.findPreview`), `packages/core/apps/routes.ts` 139-149(`appToolLookupOf.findPreview`. preview service의 `declared`에서 `ToolDeclaration`을 찾고 `effect`만 준다). 앱은 `inputSchema`가 null인 tool에 `input`이 오면 거절한다(`packages/protocol/apps/blueprint/schema.ts` 315-323, `packages/core/apps/runtime/entrypoint/invoke.ts` 90).
    - test: `packages/core/apps/calls/calls_test.ts`의 `setup` 45-145(`agentToolCall` 89-91, `findPreview` 98-106), "previewOnly 호출은 live로 새지 않고 preview 호출은 ledger를 남기지 않는다" 457-496
    - tool: 본보기 `packages/core/apps/agent-tools/release.ts`(`readOf`), `packages/core/apps/agent-tools/app.ts` 112-138, agent caller 꼴 `packages/core/lophn-agent/tools/app-tools.ts` 76-82·103-110, 결과 꼴 131-179(`resultOf`. export되지 않아 쓰지 않는다), `packages/core/lophn-agent/tools/fit-result.ts`(`fitted`). tool 정의 file은 agent runtime child에서 실리므로 store나 DB를 import하지 않는다(`packages/core/lophn-agent/tools/spi.ts` 1-2). model은 오류 code마다 고정 글만 받는다(`packages/core/lophn-agent/tools/work.ts` 34-42).
    - 목록: `packages/core/apps/agent-tools/mod.ts`, `packages/core/agent-roles/tool-lists.ts` 57-69(`app_engineer`), 91-140(`TOOL_ORDER`). `packages/core/main/agent-tools_test.ts`가 목록과 정의가 맞는지, 입력이 JSON Schema로 바뀌는지 본다.
    - 발급: `roleOperations`(`credentials.ts` 53-78)가 tool의 `routes`에서 operation을 모으고 `agentRuntimePolicies`(`packages/core/lophn-agent/run-loop/runtime.ts` 78-96)가 agent 발급 정책을 만든다. `packages/core/apps/control.ts` 209-216(coding agent의 preview 정책)은 고치지 않는다.
    - 같은 route를 쓰는 곳: coding CLI(`packages/protocol/coding-agent/cli-commands.ts` 165-167)는 `previewsStart.input`을 그대로 쓴다. `packages/coding-agent/cli/main_test.ts` 129-160이 `fixture_hash: null`을 싣는다(134줄, ab-cli 소유. 아래 "넘길 줄"). `tests/e2e/app-release_test.ts`도 싣지만 check 밖이라 두고 보고에 적는다.
- 계약:
  - 쓰는 것: `previews.start|get|stop`(`packages/protocol/apps/previews.ts`), `app.call_tool`(`packages/protocol/apps/calls/call.ts`), `releases.get_record`
  - 내놓는 것:
    - tool `preview.start`: 입력 `{release: rel_…, fixture?: string}`. `fixture`는 bundle 안 상대 경로(sqlite file)다. 그 release의 bundle로 그 앱의 preview를 띄우고(앞 preview는 지금처럼 닫힌다) ready나 실패까지, 길어도 60초 기다린다. 출력 `{app, release, process_nonce, ready: boolean, reason?: string}`.
    - tool `preview.call`: 입력 `{app: app_…, tool: string, input?: JSON}`. 그 앱의 지금 preview에 `app.call_tool`(target `{mode: "preview", app, process_nonce}`, caller는 부른 agent)을 보낸다. 출력은 core가 준 outcome(`succeeded | failed | denied | unknown`)이다. 떠 있는 preview가 없으면 그렇다고 돌려준다. 입력 없는 tool은 입력 없음, `null`, `{}`를 모두 받는다(ab-runtime과 같은 규칙).
    - tool `preview.stop`: 입력 `{app: app_…}`. 그 앱의 지금 preview를 닫는다.
    - 셋은 App Engineer만 갖는다(`tool-lists.ts`의 `app_engineer` 쓰기 목록과 `TOOL_ORDER`의 `release.get` 바로 뒤). credential operation은 tool의 `routes`에서 나오고(`roleOperations`), agent 발급 정책도 거기서 저절로 오른다(`agentRuntimePolicies`). `packages/core/apps/control.ts`의 `appsOperationPolicies`(coding agent의 preview 정책)는 고치지 않는다.
    - route `previews.start`의 입력 `input.fixture_hash`가 `input.fixture: relativePath | null`(bundle 안 경로)로 바뀐다. `PreviewBundle.fixture`는 경로를 받아 manifest로 찾는다. bundle file이 아니면 지금처럼 `invalid_input`이다.
    - preview service는 `user`, `coding_agent`에 더해 `agent` 자격도 받는다. 앱 범위는 지금 `authorize`(operation과 앱 조건)가 본다. Operator는 tool이 없어 operation이 없다.
    - 앱 호출 경로(`verifyCaller`): caller `agent`가 target `preview`를 부를 수 있다. 그 agent가 target 앱의 App Engineer일 때만이고 아니면 `forbidden`이다. agent의 live 호출 규칙(활성 release, release null)은 그대로다. preview 호출은 지금처럼 Gate, 쓰기 줄, invocation 기록이 없다. preview 호출에서 선언 `inputSchema`가 null인 tool에 온 `input`이 `null`이나 `{}`면 앱에 보내지 않는다.

## 할 일

근거: README "App Engineer의 새 tool"과 roadmap "examples gate와 그 실행기를 지운다". preview가 이미 fixture data로 격리된 앱을 띄우므로 App Engineer가 그것을 직접 부른다.

1. protocol
   - `previews.ts`: `previewInputSchema`의 `fixture_hash: sha256Schema.nullable()`을 `fixture: relativePathSchema.nullable()`로 바꾼다. 주석에 "봉인된 bundle 안의 상대 경로(manifest의 `files[].path`)"를 적는다. 안 쓰게 된 `sha256Schema` import가 있으면 지운다.
   - `calls/call.ts` 130-133 주석: "app은 live이고 release가 null이다. agent는 live(release null)이거나, 그 앱의 App Engineer면 그 앱의 preview다."
2. bundle의 fixture: `desired.ts`의 `fixture(hash)`를 `fixture(path)`로 바꾸고 234줄 주석을 맞춘다. `parts.manifest.files`에서 `entry.path === path`를 찾고, 읽은 byte의 hash가 manifest의 `hash`와 같을 때만 준다(봉인 사본이 바뀌지 않았다는 확인은 그대로). 없으면 `undefined`다.
3. preview service(`service.ts`)
   - `PreviewBundle.fixture`의 type과 주석을 경로로 바꾸고 `start`가 `input.fixture`를 넘기게 한다. 오류 글은 "fixture is not a file of this bundle" 그대로다.
   - `gate`가 `agent`도 받게 한다. 127-130 주석을 "사람, coding agent, agent가 preview를 연다. agent의 앱 범위는 credential의 operation과 앱 조건(`authorize`)이 정한다. 앱 자식과 machine은 열지 못한다"로 고친다.
   - `model.ts`는 바꿀 것이 없으면 그대로 둔다.
4. 앱 호출 경로
   - `caller.ts`의 `verifyCaller`: 지금 51-56의 "agent와 app은 live, release null" 검사를 갈래마다 나눈다. app caller는 지금 그대로다. agent caller는 `agentToolCall`로 확인한 뒤, target이 `preview`면 `agent.role === "app_engineer" && agent.app === target.app`일 때만 통과하고 아니면 `forbidden`("only the App Engineer of the app calls its preview")이다. target이 live면 지금처럼 release가 null이어야 한다(`invalid_input`).
   - `service.ts`(calls): `callPreview` 주석(215-216)을 "부른 쪽은 사람이나 그 앱의 App Engineer다(verifyCaller). Gate도 줄도 기록도 없다"로 고친다. previewOnly 갈래(140-148)는 그대로다(사람만).
   - 입력 없는 tool: `findPreview`가 effect와 함께 그 tool이 입력을 받는지(`takesInput: boolean`, 선언 `inputSchema !== null`)를 주게 하고, `callPreview`는 `takesInput`이 false이고 `input`이 `null`이거나 칸 없는 object면 `input` 없이 보낸다. 이 일은 `packages/core/apps/ports.ts`(`findPreview` 반환 type 한 줄)와 `packages/core/apps/routes.ts`(`appToolLookupOf.findPreview` 한 줄)를 고쳐야 한다. 두 file은 이 task 소유 밖이고 이 계획의 다른 task도 갖지 않는다. 최소로 고치고 "넘길 줄"에 적는다. lead가 막으면 이 항목만 빼고 보고한다.
5. agent tool(`agent-tools/preview.ts`, 새 file). 셋 다 `effect: "write"`다(process를 띄우거나 preview DB를 바꿀 수 있어 자동 재시도하지 않는다).
   - `preview.start`: 입력 `z.strictObject({ release: idSchema("rel"), fixture: relativePathSchema.optional() })`, `routes: [releasesGetRecord, previewsStart, previewsGet]`.
     1. `releases.get_record`로 release를 읽는다. null이면 `notFound("release not found")`.
     2. `previews.start`에 `{ input: { app, bundle_hash, release, fixture: fixture ?? null } }`을 보낸다.
     3. `previews.get { app, process_nonce }`를 500ms마다 읽어 `observation.ready`이거나, `reason.code`가 `starting`(`PREVIEW_STARTING`)이 아니거나, `observation`이 null이면 멈춘다. 60초(`PREVIEW_READY_WAIT_MS`, launcher의 ready 상한 30초에 credential과 spawn 여유를 더한 값)가 지나거나 `ctx.signal`이 끊기면 그때의 상태로 멈춘다. 기다림 timer는 끝에 지운다.
     4. `fitted`로 `{ app, release, process_nonce, ready, reason? }`를 돌려준다. `reason`은 `"<code>: <summary>"`, 관측이 없으면 "the preview process is gone", 상한이면 "the preview did not become ready in 60 seconds"다.
   - `preview.call`: 입력 `z.strictObject({ app: idSchema("app"), tool: z.string().min(1), input: z.unknown().optional() })`, `routes: [previewsGet, appCallTool]`. `previews.get { app }`의 관측이 null이면 `fitted("no preview is running for this app; start one with preview.start", { running: false })`다. 있으면 `readOf(ctx.core, appCallTool, { target: { mode: "preview", app, process_nonce }, tool, ...(input === undefined ? {} : { input }), caller: { kind: "agent", session: ctx.session, turn: ctx.turn, tool_call: ctx.tool_call } })`. 출력은 `fitted`로 `{ outcome }`를 싣고 summary에 status를 적는다(`denied`면 denial code, `failed`면 앱의 오류 code).
   - `preview.stop`: 입력 `z.strictObject({ app: idSchema("app") })`, `routes: [previewsGet, previewsStop]`. 관측이 null이면 "no preview is running for this app", 있으면 그 nonce로 `previews.stop`.
   - 설명 글(영어) 예. `preview.start`: "Start a preview of a prepared release of your app: the sealed bundle runs with fixture data and stand-ins for network and secrets. fixture is the path of a sqlite file inside the bundle to start the data from. The previous preview of the app stops. Waits until it is ready or failed." `preview.call`: "Call a tool of your app's running preview and return its outcome. Nothing is recorded and live data is never touched. Omit input for a tool that takes none." `preview.stop`: "Stop your app's running preview."
   - `mod.ts`의 `APPS_AGENT_TOOLS`와 `tool-lists.ts`(`app_engineer` 쓰기 목록, `TOOL_ORDER`의 `release.get` 뒤에 `preview.start`, `preview.call`, `preview.stop`)에 더한다.
6. 위험 test(`calls_test.ts`. 아래 "끝남")
   - `setup`의 `agentToolCall`이 돌려줄 agent를 `state.agent`(기본 `{ role: "lophn" }`)로 바꾸고 `findPreview` 가짜가 `takesInput`도 주게 한다. 다른 test의 판정은 그대로다.
   - 앱 A의 preview(`pv-nonce-1`, tool `w.new`는 write)를 표로 부른다. 부른 쪽마다 결과와 앱 process에 보낸 수를 본다.
     - A의 App Engineer: `succeeded`, 보낸 것 1, `invocation`은 null, 기록 0
     - B의 App Engineer: `forbidden`, 0
     - lophn, Project Manager(`{ role: "project_manager", project }`), Operator(`{ role: "operator", agent }`): `forbidden`, 0
     - A의 App Engineer라도 caller의 tool call을 모르면(`agentToolCall`이 null) `forbidden`, 0
   - 입력 없는 tool(`takesInput: false`)에 A의 App Engineer가 `{}`와 `null`을 주면 앱에 보낸 요청에 `input`이 없다. 같은 test의 한 줄로 본다(따로 test를 만들지 않는다).
   - preview 시작의 경계(다른 앱의 App Engineer가 그 앱의 preview를 띄우지 못한다)는 따로 test하지 않는다. 판정이 `createTargetAuthorizer`와 `authorize`를 그대로 쓰고, test하려면 이 task 소유 밖의 새 test file(`preview/service_test.ts`)이 필요하다. 보고의 "정한 것"에 적는다.

## 끝남

- `deno task check`가 통과한다.
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다.
- 바꾼 곳의 test: `deno test --no-check packages/core/apps/calls packages/core/apps/preview packages/core/main/agent-tools_test.ts packages/coding-agent/cli/main_test.ts`
- 위험 test: "그 앱의 App Engineer만 그 앱의 preview tool을 부르고, 다른 앱의 App Engineer와 다른 role은 앱 process에 닿지 못한다"(`calls_test.ts`)
- 남지 않음
  - `git grep -n "fixture_hash" -- packages tools`가 0줄이다(`tests/e2e`는 check 밖이라 둔다).
  - `git grep -n "사람과 coding agent만 preview\|부른 쪽은 사람뿐" -- packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`agent-tools/mod.ts`와 `tool-lists.ts`는 이 task가 고친다). 다르면 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(기다림 상한과 간격, preview 시작 경계에 test를 두지 않은 것, tool 결과의 꼴)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"(`main_test.ts`, `ports.ts`, `routes.ts`의 그 줄은 이제 소유다)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 예상: App Engineer가 preview를 띄우면 사람이 보던 그 앱의 preview가 닫힌다(앱마다 하나). 사람 화면에 preview 탭을 여는 길은 이 계획 밖이다(`app-preview.md`).

# fl-check

PM이 쓴 `flow.ts`를 실행하지 않고 type check만 하는 `workflow.check` tool을 더하고, PM의 내장 skill `guide-workflows`에 flow 절을 쓰고, job tool 설명을 flow 시작에 맞춘다. PM은 instance를 시작하지 못하므로 쓰고 나서 볼 길이 이것이다.

- 단위: check (wave 3)
- 선행: fl-workflows, fl-sdk. `wiring/workflows.ts`는 `fl-workflows`가 먼저 고치고, type check는 설치된 `@lophn/flow`가 있어야 돈다.
- 소유(이 task만 고친다):
  - `packages/core/main/flow-host/check.ts` (새 file)
  - `packages/core/workflows/agent-tools.ts`
  - `packages/core/workflows/register.ts`
  - `packages/core/main/daemon/wiring/workflows.ts`
  - `packages/core/agent-roles/skills/guide-workflows/SKILL.md`
  - `packages/core/jobs/agent-tools.ts`
  - `packages/core/agent-roles/tool-lists.ts`
- 읽을 것:
  - 계획: `project-docs/plan/flow/README.md`의 "PM", "SDK", "process"
  - 본보기: `packages/core/apps/blueprint/check.ts`(`checkBlueprint`: 임시 폴더에 import map, 좁은 Deno, 한도 시간, `unavailable`), `packages/core/apps/agent-tools/app.ts`의 `blueprint.check` tool(약 166행), `packages/core/apps/register.ts`의 `memoryRoutes`(`blueprintCheck`), `packages/core/main/daemon/wiring/apps.ts`의 `memory` 목록(`checkBlueprint(...)` 붙인 자리)
  - architecture: `project-docs/architecture/workflow.md`("쓰기 범위", "agent tool과 CLI"), `project-docs/architecture/layers.md`(workflows module은 apps를 import하지 않는다. 그래서 check는 `core/main`에 둔다)
  - 코드: `packages/core/apps/packages/template/import-map.ts`의 `devImportMap`(값이 `lophn-sdk:<name>@<version>/<경로>` 꼴이어야 파일로 풀린다. 경로가 없으면 폴더 URL이 되어 import가 안 풀린다), `packages/protocol/workflows/paths.ts`의 `workflowFolder`, `packages/protocol/workflows/mod.ts`의 `workflowCheck`·`WORKFLOW_FLOW_FILE`·`FLOW_SDK_NAME`·`FLOW_SDK_VERSION`(flow-wire), `packages/core/agent-roles/tool-lists.ts`와 `packages/core/main/agent-tools_test.ts`(아래 "등록할 것")
  - 이웃 계획: `bs-jobs`가 `packages/core/jobs/{due,scheduler,ports}.ts`와 `wiring/jobs.ts`를 소유한다. 여기서 고치는 것은 `packages/core/jobs/agent-tools.ts`의 설명뿐이다.
- 계약:
  - 쓰는 것: `fl-contract`의 `workflowCheck`(`CheckWorkflow`, input `{workflow}`, output `{errors}`), `WORKFLOW_FLOW_FILE`, `FLOW_SDK_NAME`·`FLOW_SDK_VERSION`, `workflowFolder`. `devImportMap`.
  - 내놓는 것: agent tool `workflow.check`(effect `read`). 역할 tool 목록 등록은 아래 "등록할 것".

## 할 일

1. `main/flow-host/check.ts`: `checkWorkflow(deps: {dataRoot: string; resolveProject: (ref: string) => Promise<Result<{id: Id<"prj">}>>}): MemoryHandler`. 이유: workflows module은 apps를 import하지 않으므로 `devImportMap`을 쓰는 이 handler는 `core/main`에 둔다(`layers.md`). `fl-host`가 소유한 `flags.ts`·`channel.ts`·`host.ts`는 import하지 않는다(wave 3에서 같이 도는 task라 서로 기대지 않는다).
   - 입력 `workflow`는 `<project 이름>/<name>`이다. `/`로 갈라 앞은 `resolveProject`로 풀고(`not_found`·`invalid_input`은 그대로 돌려준다), 뒤는 `workflowKeySchema`가 이미 slug로 검증했으므로 경로에 그대로 쓴다.
   - `<workflowFolder>/flow.ts`가 없으면(`Deno.stat`) `ok({errors: ["flow.ts is missing"]})`. 폴더가 없을 때도 같다.
   - 있으면 임시 폴더(`Deno.makeTempDir({prefix: "flow-check-"})`)에 import map을 쓴다: `devImportMap({[FLOW_SDK_NAME]: `lophn-sdk:${FLOW_SDK_NAME}@${FLOW_SDK_VERSION}/mod.ts`}, dataRoot, dataRoot)`(`fl-host`가 `<data>/flows/import-map.json`에 쓰는 map과 같은 내용이다. 값이 상대 경로가 아니라 마지막 인자는 결과에 영향이 없다). 끝나면 `finally`에서 지운다(`checkBlueprint`와 같다).
   - `Deno.Command(Deno.execPath(), {args: ["check", "--no-config", "--no-remote", "--no-npm", "--cached-only", "--no-lock", `--import-map=${map}`, flowPath], cwd: folder, env: {NO_COLOR: "1"}, stdin: "null", stdout: "piped", stderr: "piped", signal: AbortSignal.timeout(LIMIT_MS)})`. `LIMIT_MS`는 30초다(첫 check는 lib 준비로 blueprint의 10초보다 느릴 수 있다). 시간이 넘으면 `err({code: "unavailable", message: "workflow check did not finish"})`.
   - **`deno check`는 권한 flag(`--allow-*`)와 `--no-prompt`를 받지 않는다**(2.9.7에서 `--no-prompt`는 unexpected argument로 실패한다). type check는 code를 실행하지 않으므로 권한이 필요 없다. 막는 것은 위 flag다: 원격·npm import와 config와 lock을 끄고 SDK는 import map으로만 푼다. 그래서 flow.ts가 `https:`/`npm:`/`jsr:`를 import하면 오류가 되어 PM에게 그대로 보인다(sandbox에서도 어차피 못 쓴다).
   - 종료 code 0이면 `ok({errors: []})`. 아니면 stderr를 오류로 쪼갠다. `NO_COLOR=1`이라 ANSI는 없다. 한 오류는 `TS\d+ [ERROR]: …` 또는 `error: …`로 시작하는 줄 하나와 그 블록의 첫 `at file://…:줄:칸` 줄을 합친 문자열 하나다. 코드 발췌와 `~~~` 줄, 첫 `Check …` 줄, 끝 `error: Type checking failed.`은 버린다. 문자열 안 `file://<workflow 폴더>/`는 지워 `flow.ts:2:16`처럼 보이게 하고, 개수는 20개까지 자른다(자르면 마지막에 `… and N more`). 오류 블록을 못 알아보면 stderr의 첫 비지 않은 줄 하나를 오류로 싣는다(`checkBlueprint`의 `reason`과 같다).
   - 실제 `deno check` 출력 꼴(2026-10-23 확인): `TS2322 [ERROR]: Type 'number' is not assignable to type 'string'.` / 코드 줄 / `~~~~` / `    at file:///…/flow.ts:2:16` / 빈 줄 / `    The expected type comes from …` / `error: Type checking failed.`
2. `workflows/agent-tools.ts`: tool `workflow.check`(input `z.strictObject({workflow: workflowKeySchema})`, `routes: [workflowCheck]`, effect `read`). 설명에 "Type-check the flow.ts of a flow workflow (`<project>/<name>`) against the installed `@lophn/flow` SDK and return the errors. Type check only: it does not run the flow and does not start an instance."를 쓰고 비면 통과라고 적는다. 요약은 `blueprint.check`처럼 `errors.length === 0 ? "flow.ts of … has no type errors" : "… has N errors"`, 본문은 `{errors}`. `workflow.get` 설명에 한 줄 더한다: `by: program`은 flow가 낸 report이고 `program_exited`는 flow process가 끝났다는 줄(끝 code와 stderr 끝 줄)이며 그때 instance는 `ended`가 된다. 이 tool에 `workflowKeySchema` import가 필요하면 `protocol/workflows/mod.ts`에서 가져온다.
3. `workflows/register.ts`의 `memoryRoutes`에 `workflowCheck`를 더한다(주석의 "다섯 route"는 여섯으로). `wiring/workflows.ts`의 `memory` 목록에 `[route(workflowCheck), checkWorkflow({dataRoot: ctx.root.path, resolveProject: projects.resolve})]`를 붙인다(`projects`는 같은 파일 위쪽에 이미 만든 객체다). contract는 `CheckWorkflow` 임시 handler를 두지 않았으므로(등록되지 않은 route라 기동을 막지 않는다) 지울 것이 없다. 호출한 쪽이 그 project의 PM인지는 보지 않는다: 읽기만 하는 type check라서다. 이 tool을 가진 role은 아래 목록이 PM으로 좁힌다.
4. `guide-workflows/SKILL.md`: 지금 영어 문서에 맞는 말투로 flow 절을 쓰고, 틀린 문장을 고친다.
   - 위쪽 설명: "A person starts an instance of it (a job may start one later)"는 "A person or a job starts it"으로, 이 줄 뒤 "There is no tool that starts an instance, so an agent cannot start one."은 둔다(`job.create`의 `workflow_start`로 job을 만드는 길은 있지만 시작하는 tool은 없다).
   - "The declaration" 절의 `kind` 항목: "`flow` is declared but cannot be started yet."를 지우고 "`flow`: a program (`flow.ts`) runs the steps; see Flow workflows below."로 바꾼다. `grep -rn "cannot be started yet" packages/core/agent-roles`가 0줄이어야 한다.
   - 새 절 "Flow workflows"(예시 yaml 뒤, "A step message…" 앞이나 "After you write it" 앞):
     - 폴더: `workflow.yaml`(`kind: flow`와 `steps`만 읽는다. `steps`의 key가 step 이름이고 화면과 report가 쓴다. 다른 칸(`by`, `prompt`, `participants`)은 lophn이 읽지 않으니 메모로만 쓴다), `flow.ts`(code. 같은 폴더의 다른 file을 상대 경로로 import할 수 있다), `workflow.md`, 선택 artifacts. 짧은 `flow.ts` 예 하나(`input`을 읽고 `agent`로 일을 시키고 `tool`을 부르고 `report`).
     - SDK `@lophn/flow`가 내놓는 다섯: `input`(시작 입력 글), `instance`(instance id), `agent({agent, prompt, input?, schema?})`(agent 하나를 run으로 부르고 끝날 때까지 기다려 답을 준다. `agent`는 `{role, place?, name?}`), `tool({app, tool, input?})`(앱 tool 하나), `report({step, text, next?})`(`workflow.report`와 같은 뜻. `next: "end"`면 끝). `agent`·`tool`·`report`는 던지지 않고 `{ok: true, result}` 또는 `{ok: false, reason, message}`를 준다.
     - 실패와 다시 하기는 code의 일이다. lophn은 자동으로 다시 하지 않고 성공인지도 판정하지 않는다. 그래서 `ok: false`를 보고 다시 부를지, `report`로 어떻게 알릴지, 던져서 끝낼지 code가 정한다. 던지거나 끝나면 instance가 `ended`가 되고 끝 code와 stderr 끝 줄이 남는다. core가 꺼졌다 켜지면 도는 flow는 다시 띄우지 않고 `ended`로 닫는다.
     - sandbox: flow는 sandbox 안 process 하나에서 돈다. 읽기는 그 workflow 폴더와 설치된 SDK뿐이고 네트워크, file 쓰기, 다른 program 실행, 환경 변수가 없다. 바깥에 닿는 일은 모두 앱 tool(`tool`)이나 agent(`agent`)로 한다. `console.log`는 stderr로 가고 instance의 끝 줄에서 보인다. 가져올 수 있는 것은 `@lophn/flow`, 같은 폴더의 file, 권한이 필요 없는 JavaScript 내장뿐이다(`npm:`, URL, `jsr:` 없음).
     - 할당: flow가 부르는 앱 tool은 이 project의 PM인 당신의 지금 할당과 맡은 domain 안에서만 된다. flow를 쓰기 전에 그 앱을 PM에게 할당해 달라고 사람에게 `ask`로 청한다. 할당이 없으면 `tool`이 `ok: false`로 돌아온다. flow가 부르는 agent는 누구든 되지만 받은 agent는 자기 할당으로만 일한다.
     - `workflow.check`: `flow.ts`를 쓰거나 고친 뒤 `workflow.check`에 `<project>/<name>`을 주어 type error를 읽는다. 실행하지 않으므로 flow가 도는 것을 확인하는 길은 아니다. 오류가 비면 통과다.
     - 시작: 사람(화면, CLI)과 job이 시작한다. 당신이나 다른 agent는 시작하지 못한다. 시작 입력은 `input`으로 온다.
   - "After you write it": `workflow.list`에서 flow 선언이 틀렸거나 `flow.ts`가 없으면 `problem`(`no_flow_file`)으로 보인다는 한 줄. "What you do not do"의 마지막 항목(Do not start a workflow instance)은 둔다.
5. `packages/core/jobs/agent-tools.ts`: 지금 `ACTION_NOTE`는 `workflow_start`를 "(starts a workflow instance with `text`)"라고만 쓰고 agent workflow만 말하지는 않지만 flow에서의 `step`은 말하지 않는다. 이렇게 고친다: "`workflow_start` (starts an instance of an agent or flow workflow, named `<project name>/<name>`, with `text`; `step` picks where an agent workflow starts and is `invalid_input` for a flow)". 이 file의 다른 설명은 건드리지 않는다. 이유: job이 flow를 시작하는 길을 PM이 알아야 flow를 정해진 때 돌릴 수 있다.

## 등록할 것

이 task가 `packages/core/agent-roles/tool-lists.ts`에 두 줄을 더한다(PM 목록과 `TOOL_ORDER`, 다른 role에는 열지 않는다). `packages/core/main/agent-tools_test.ts`가 정의만 있고 목록에 없는 tool을 실패시키므로 같은 task에서 넣어야 check가 통과한다.
- `ROLE_WRITE_TOOLS.project_manager`에 `"workflow.check"`.
- `TOOL_ORDER`에 `"workflow.edit"` 뒤, `"job.create"` 앞으로 `"workflow.check"`.


## 끝남

- `deno task check`가 통과한다. `lead/boot.sh`가 기동한다(route와 handler가 맞아야 한다).
- 위험 test: 없음 (type check 결과는 `deno check`의 몫이고 권한 경계는 읽기 전용 route와 `flow.ts` 실행 없음으로 지킨다. 계획의 위험 test 넷에 없다).
- 손으로 한 번 본다: 임시 data root나 `.dev-data/`에 PM의 workflow 폴더와 `flow.ts`(일부러 틀린 type 하나)를 두고 `workflow.check`가 줄 단위 오류를 주고, 고친 뒤 `errors: []`를 주는지. SDK 설치 사본이 있는 data root가 필요하다(`fl-sdk`).
- 남지 않음: `grep -rn "cannot be started yet" packages/core/agent-roles`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없음(`tool-lists.ts`는 이 task가 고친다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

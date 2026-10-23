# fl-runs

program caller와 run origin을 job에서 떼어 낸다. workflow instance가 연 tool run이 PM의 지금 할당과 맡은 domain 안에서만 앱 tool을 부르게 하고, 앱 process의 손 사본 parser와 `sdk/cap-tool`과 invocation 기록이 새 `flow` caller를 받게 한다. 하나라도 빠지면 그 호출이 말없이 거절된다(`architecture/app-call.md`).

- 단위: runs (wave 2)
- 선행: fl-contract
- 소유(이 task만 고친다):
  - `packages/core/runs/service.ts`
  - `packages/core/runs/service_test.ts`
  - `packages/core/runs/store.ts`
  - `packages/core/runs/store_test.ts`
  - `packages/core/runs/mod.ts`
  - `packages/core/main/daemon/wiring/runs.ts`
  - `packages/core/apps/calls/caller.ts`
  - `packages/core/apps/calls/gate.ts`
  - `packages/core/apps/calls/calls_test.ts`
  - `packages/core/apps/ports.ts`
  - `packages/core/apps/invocations/schema.ts`
  - `packages/core/apps/invocations/context.ts`
  - `packages/core/apps/runtime/entrypoint/wire.ts`
  - `packages/sdk/cap-tool/context.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`(program, 부른 쪽 확인, 손 사본 parser, "program caller를 따로 둔다"), `project-docs/architecture/run.md`("시작"의 origin, "취소", "켤 때와 session 끝"), `project-docs/architecture/job.md`(program caller의 판정), `project-docs/architecture/approval.md`(unattended, 할당이 허락), `project-docs/architecture/domain.md`(비공개 tool 거르기)
  - 계획: `project-docs/plan/flow/README.md`의 "자격"과 "위험 test"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `runs`, `apps`, `project-docs/module-catalog.yaml`의 `packages/core/runs`, `packages/core/apps`, `packages/core/main`, `packages/sdk`
  - 본보기(program 갈래를 따라 flow를 더한다):
    - `packages/core/apps/calls/caller.ts`(`CallAuth`, `VerifiedCaller`, `KIND_OF_ACTOR`, `verifyCaller`의 program 갈래)
    - `packages/core/apps/calls/gate.ts`(`callAllowed`의 program 갈래: `assignmentOf` → `judge(..., "unattended")` → `public` → `toolDomainOf`·`agentDomainsOf`). PM의 domain은 `packages/core/main/daemon/agent-domains.ts`의 `agentDomains`가 이미 읽는다(`project_manager` → 그 project의 active domain)
    - `packages/core/apps/routes.ts`의 `callToolHandler`: route는 actor가 `user`·`agent`·`app`일 때만 `CallAuth`를 만든다. `program`·`flow` 자격은 route로 못 만든다(고치지 않는다)
    - 손 사본 넷: `packages/protocol/apps/calls/caller.ts`(원본), `packages/core/apps/runtime/entrypoint/wire.ts`의 `caller()`, `packages/core/apps/invocations/context.ts`의 `InvocationCaller`, `packages/sdk/cap-tool/context.ts`의 `AppToolCaller`. `wire-check.ts`의 `exact`(모르는·빠진 칸의 이름을 돌려주고 없으면 undefined), `id`, `record`
    - `packages/core/main/daemon/wiring/runs.ts`의 `tools.call`(program 자격을 만드는 곳)
    - `packages/core/runs/service.ts`의 `cancel`, `runningRuns`, contract가 둔 `originColumns`
  - 이웃 계획: `bs-jobs`가 `packages/core/jobs/*`와 `wiring/jobs.ts`를 소유한다. 건드리지 않는다. `RunOrigin`의 job 갈래 모양은 그대로다(`wiring/jobs.ts`의 `const origin: RunOrigin = {job, job_run, creator, creator_place}`는 합의 한 갈래라 그대로 컴파일된다).
  - 존재하는 test와 fake(새로 만들지 않고 이것을 쓴다): `packages/core/apps/calls/calls_test.ts`의 `setup()`(가짜 `callers`, `lookup`, `ledger`, `link`, `assignmentOf`, `agentDomainsOf`, `toolDomainOf`와 `state`로 할당·domain·공개 여부를 바꾼다), `programCaller`·`programAuth`, `status()`, `newApp()`, `ids`. subprocess·Worker·서버는 쓰지 않는다.
- 계약:
  - 쓰는 것: `fl-contract`의 `appToolCallerSchema`의 `{kind: "flow", instance}`, `RunOrigin = JobOrigin | InstanceOrigin`(`packages/core/runs/ports.ts`), `RunRecord.instance`.
  - 내놓는 것: `RunService.cancelOfInstance(instance: Id<"wfi">): Promise<void>`(그 instance가 연 `running` run을 모두 `cancel`한다. best-effort). `fl-host`가 `stop`에서 부른다. `CallAuth`에 `flow?: {instance, agent, place}`와 actor `"flow"`.

## 할 일

contract가 이미 해 둔 것: `runs.instance` 칸과 `store.ts`/`service.ts`의 `originColumns`, `appToolCallerSchema`의 `flow`, `RunOrigin = JobOrigin | InstanceOrigin`, `wiring/runs.ts`의 `flow tool calls are not wired yet` 임시 줄. `verifyCaller`에는 임시 줄이 없다(`KIND_OF_ACTOR` 비교가 flow 본문을 막고 있다).

1. `packages/core/apps/calls/caller.ts`
   - `CallAuth.actor`에 `"flow"`, `CallAuth.flow?: {instance: Id<"wfi">; agent: AgentRef; place: Place | null}`(주석: route는 이 자격을 만들지 못하고 core 안 run 연산만 만든다. program과 같다).
   - `VerifiedCaller`에 `{kind: "flow"; instance: Id<"wfi">; agent: AgentRef; place: Place | null}`, `KIND_OF_ACTOR.flow = "flow"`.
   - `verifyCaller`: program 갈래 뒤, app 갈래 앞에 flow 갈래를 둔다. target이 live active release(`mode: "live"`, `release: null`)가 아니면 `invalid_input`("flow calls target the live active release"). `auth.flow`가 없거나 `auth.flow.instance !== caller.instance`면 `forbidden`("workflow instance does not match the credential"). 아니면 `ok({kind: "flow", instance, agent, place})`로 자격의 값을 쓴다(본문 값이 아니다). 근거: `app-call.md` "부른 쪽은 호출 본문이 주장하는 대로 믿지 않고…".
2. `packages/core/apps/calls/gate.ts`: `callAllowed`의 `if (caller.kind === "program")`을 `caller.kind === "program" || caller.kind === "flow"`로 넓힌다. 두 종류 모두 `caller.agent`로 같은 코드를 탄다(`assignmentOf` → `judge(…, "unattended")` → `target.public` → `toolDomainOf`·`agentDomainsOf`). 사본을 만들지 않는다. 주석에 "job의 creator 또는 flow instance의 project PM"을 적는다. 근거: README "자격", `approval.md`(job이 할당을 넓히지 못하는 까닭, flow는 code를 쓴 PM의 할당을 넓히지 못한다).
3. 기록
   - `packages/core/apps/invocations/schema.ts`: `caller_kind` CHECK의 literal 목록 `('person', 'agent', 'app', 'program')`을 ``appToolCallerSchema.options.map((o) => `'${o.shape.kind.value}'`).join(", ")``로 만든다(protocol 원본에서 만들어 손 사본이 하나 줄고, 다음에 kind가 늘어도 CHECK에서 말없이 실패하지 않는다. zod 4.6.5에서 `.options[i].shape.kind.value`가 literal 값을 준다). `import { appToolCallerSchema } from "../../../protocol/apps/calls/caller.ts"`.
   - `packages/core/apps/invocations/context.ts`의 `InvocationCaller`에 `{kind: "flow"; instance: string}`. `ledger`·`store`는 `caller?.kind`를 그대로 쓰므로 고칠 것이 없다(확인해 둠: `store.ts`의 `insertInvocation`). `packages/core/apps/ports.ts`의 `AppToolCallPath` 주석(33번째 줄 근처 "actor가 program(job이 연 tool run)이면…")에 flow를 같이 적는다.
4. 손 사본: `packages/core/apps/runtime/entrypoint/wire.ts`의 `InvocationCaller`에 `{kind: "flow"; instance: string}`, `caller()`의 `switch`에 `case "flow": { if (exact(source, ["kind", "instance"])) return; const instance = id(source.instance, "wfi"); return instance ? {kind: "flow", instance} : undefined; }`(`exact`는 문제가 있으면 문제의 이름을 돌려주므로 truthy면 거절이다. 위 program 갈래와 같은 꼴). `packages/sdk/cap-tool/context.ts`의 `AppToolCaller`에 같은 variant. 원본 주석("protocol/apps/calls/caller.ts와 같다")을 지키고 `mod.ts`의 export 이름은 그대로다.
5. `packages/core/runs/service.ts`
   - `cancel`을 `return` 객체 안에서 꺼내 위쪽 `async function cancel(id)`로 두고 객체에는 `cancel,`로 넣는다(`this` 없이 쓰려고).
   - `cancelOfInstance(instance: Id<"wfi">): Promise<void>`: `for (const run of await runningRuns()) if (run.instance === instance) await cancel(run.id as Id<"run">);`. best-effort라 결과는 버린다(이미 끝난 run은 `conflict`). 별도 store 쿼리를 만들지 않는다(`running()`이 이미 `instance`를 싣는다). 근거: `run.md` "취소" — agent run이면 입력을 빼거나 `StopTurn`을 보내고, tool run은 run만 `cancelled`가 된다. 이미 보낸 앱 호출은 멈추지 않는다.
   - `originColumns`(contract)가 `startAgent`·`startTool` 두 곳에서 쓰이는지 확인하고 주석을 맞춘다. `runs/mod.ts`에 `type JobOrigin`, `type InstanceOrigin`을 export한다(`fl-host`가 `InstanceOrigin`을 가져온다).
6. `packages/core/main/daemon/wiring/runs.ts`의 `tools.call`: contract가 둔 `flow tool calls are not wired yet` 줄을 지우고, `origin`이 `"instance" in origin`이면 `ctx.appCallPath.call({...call, caller: {kind: "flow", instance: origin.instance}}, {actor: "flow", flow: {instance: origin.instance, agent: origin.creator, place: origin.creator_place}})`를 돌려준다. 아니면 기존 person·program 삼항이 그대로다. 주석 "job이 연 run은 program caller로…"에 instance가 연 run은 flow caller라는 것을 적는다.
7. 위험 test 둘(아래). 둘 다 `calls_test.ts`의 기존 test를 넓히는 것이다. `entrypoint/wire_test.ts`는 소유 목록에 있지만 만들지 않는다: parity test가 이미 `calls_test.ts`에 있고(`parseProcessCall`과 `processCallRequestSchema`를 같은 표로 비교한다), 한 동작은 한 층에서만 본다.
8. `deno test --allow-all packages/core/apps/calls/calls_test.ts packages/core/runs packages/core/apps/invocations`로 바꾼 곳의 test만 돌리고 `deno task check`를 돈다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test 1 (`packages/core/apps/calls/calls_test.ts`, 기존 "job이 부르는 앱 tool은 …" test를 넓힌다): "flow caller의 앱 tool 호출은 PM의 할당 밖이거나 PM이 맡지 않은 domain의 비공개 tool이면 denied(`gate_blocked`)이고 앱 process에 아무것도 가지 않는다. program caller와 같은 표를 두 종류가 돈다."
  - 이름을 "job과 workflow instance가 부르는 앱 tool은 만든 agent(job의 creator, project PM)의 할당이나 domain 밖이면 실행되지 않는다"로 바꾼다. 기존 8줄 표(not assigned, removed tool, private tool of another domain, unreadable creator domains, tool domain not found, lophn creator private tool, public of another domain, private of own domain)를 `[["program", programCaller(JOB, RUN), programAuth()], ["flow", flowCaller(WFI), flowAuth()]]` 바깥 반복으로 감싸고, 판정(`status`, `t.sent.length`, denied 기록의 `caller`)은 그대로 둔다. 메시지에 종류를 붙인다.
  - helper를 같은 file 위쪽에 더한다: `const WFI = ids.newId("wfi") as Id<"wfi">`, `const PRJ = ids.newId("prj") as Id<"prj">`, `flowCaller(instance): AppToolCaller = {kind: "flow", instance}`, `flowAuth(instance = WFI): CallAuth = {actor: "flow", flow: {instance, agent: {role: "project_manager", project: PRJ} as AgentRef, place: {kind: "project", id: PRJ}}}`. fake는 `setup()` 그대로(`state.assignment`, `state.domains`, `state.toolDomainId`).
  - 같은 file의 "부른 쪽 종류가 credential과 다르거나 …" test 표에 다섯 줄을 더한다(모두 `forbidden`, `t.sent.length === 0`): 사람 credential이 flow라고 주장(`{actor: "user"}`), agent credential이 flow라고 주장(`{actor: "agent"}`), program 자격이 flow 본문을 보냄(`programAuth()`), flow 자격이 program 본문을 보냄(`flowAuth()`), 본문 instance가 자격의 instance와 다름(`flowAuth(다른 wfi)`). 이 줄들이 route에서 flow 자격이 만들어지지 못한다는 것(`callToolHandler`는 `program`·`flow` actor를 만들지 않는다)과 자격과 본문 대조를 함께 지킨다.
  - 이 test가 의미 있는지 확인했다: `gate.ts`의 `|| caller.kind === "flow"`를 빼면 `flow: not assigned` 줄에서 실패한다.
- 위험 test 2 (같은 file의 기존 "앱 process의 parseProcessCall은 네 caller 종류에서 …" test를 넓힌다): "앱 process의 caller parser(`wire.ts`)가 protocol `appToolCallerSchema`의 다섯 종류(person, agent, app, program, flow)를 `processCallRequestSchema`와 같은 판정으로 받고, 모르는 칸이나 빠진 칸이나 다른 prefix의 id는 거절한다."
  - 이름의 "네"를 "다섯"으로 바꾸고 표에 `["flow", flowCaller(WFI), true]`, `["flow without instance", {kind: "flow"}, false]`, `["flow with a job field", {kind: "flow", instance: WFI, job: JOB}, false]`, `["flow with another id kind", {kind: "flow", instance: JOB}, false]`를 더한다. 판정 코드는 그대로다.
- 남지 않음: `grep -rn "flow tool calls are not wired yet" packages`가 0줄이다.
- 남지 않음: `grep -rn "'program')" packages/core/apps/invocations/schema.ts`가 0줄이다(CHECK 목록이 protocol에서 만들어진다).
- 새 subprocess·Worker·서버 test는 만들지 않는다(AGENTS.md). 이미 있는 `calls_test.ts`는 가짜 port로 돈다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음. `runs/mod.ts` export는 이 task가 직접 한다. 문서(architecture `app-call.md`의 caller 네 종류→다섯 종류와 flow 판정, `run.md`의 origin과 `cancelOfInstance`, `approval.md`, `domain.md`)는 계획이 land된 뒤 lead가 고친다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): 없음 예상.
- 정한 것: 문서에 답이 없어 worker가 정한 것. 이미 정한 것: `entrypoint/wire_test.ts`는 만들지 않고 기존 parity test를 넓힌다. `caller_kind` CHECK는 protocol 원본에서 만든다. `cancelOfInstance`는 `running()` 목록을 `instance`로 거른다.
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 예상: flow의 app 호출이 invocation 기록에 `flow`로 남지만 app 활동 화면과 rewind 목록은 "Scheduled job"으로 보인다(문구를 새로 만들지 않았다). `cancelOfInstance`는 process를 죽이지 않는다(`fl-host`가 process를 먼저 죽이고 부른다. 반대 순서면 그 사이 새 요청이 run을 또 열 수 있다).

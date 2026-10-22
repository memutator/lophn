# sj-apps-program-caller

앱 호출 경로에 부르는 쪽 `program`을 더한다. job이 연 tool run의 앱 호출은 그 job을 만든 agent(creator)의 지금 할당과 domain 거르기로 판정하고, 막히면 handler에 가기 전에 invocation을 `denied`로 남긴다. 호출 경로는 묻지 않고 막기만 한다(`architecture/app-call.md`).

- 단위: apps (wave 2)
- 선행: `sj-jobs-contract`
- 소유(이 task만 고친다):
  - `packages/protocol/apps/calls/caller.ts`
  - `packages/protocol/apps/calls/call.ts` (규칙 주석 한 줄만)
  - `packages/core/apps/calls/`
  - `packages/core/apps/ports.ts`
  - `packages/core/apps/routes.ts`
  - `packages/core/apps/invocations/{schema,store,context}.ts`
  - `packages/core/apps/runtime/entrypoint/wire.ts`
  - `packages/sdk/cap-tool/context.ts`
  - `packages/shell/renderer/app-frame/app-detail/{core-source,source,model}.ts`
  - `packages/shell/renderer/app-frame/app-detail/activity/activity-tab.tsx`
  - `packages/shell/renderer/app-frame/app-detail/testdata/fake-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-rewind.ts`
  - `packages/core/main/daemon/wiring/apps.ts`
  - `packages/core/main/daemon/wiring/apps-usage.ts`
  - `packages/core/main/daemon/agent-domains.ts` (새 file)
- 읽을 것:
  - 계획: `project-docs/plan/schedule-job/README.md`의 "정한 것" 중 "할 일"(앱 tool 호출)과 "누가"(job run은 만든 agent의 할당으로 돈다), `tasks/sj-jobs-contract.md`의 "접점 › program caller"
  - architecture
    - `project-docs/architecture/app-call.md`의 "지키는 것": "부른 쪽은 호출 본문이 주장하는 대로 믿지 않고 core가 확인한다", "tool 호출은 domain을 싣지 않고 invocation에도 domain이 없다", "다른 domain의 agent는 앱의 `public` tool만 본다", "호출 경로는 묻지 않고 막기만 한다"
    - `project-docs/architecture/approval.md`의 "판정"(`judge`는 할당만 보고 효과는 쓰지 않는다)과 "turn mode"(unattended)
    - `project-docs/architecture/domain.md`의 "다른 domain의 비공개 tool은 보이지 않는다"(tool의 domain을 읽지 못하면 비공개로 본다)와 흐름 도식의 `tool` 줄
    - `project-docs/architecture/layers.md`: feature module끼리 import하지 않고 `core/main`이 조립한다
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`, `app-spi`, `sdk-api`, `project-docs/module-catalog.yaml`의 `packages/core/apps`, `packages/core/main`, `packages/sdk`
  - 호출 경로 코드(바꾼다)
    - `packages/core/apps/calls/caller.ts`: `CallAuth`, `VerifiedCaller`, `KIND_OF_ACTOR`, `verifyCaller`
    - `packages/core/apps/calls/gate.ts`: `CallGateDeps`, `callAllowed`
    - `packages/core/apps/calls/service.ts`: `createAppCalls`의 `call`, `run`, `work`, `recordDenied`
    - `packages/core/apps/calls/calls_test.ts`: `setup`, "부른 쪽 종류가 credential과 다르거나…", "agent는 할당하지 않은 앱의 tool과 할당에서 뺀 tool을 부르지 못한다"
  - 판정 재료: `packages/core/approvals/gate/judge.ts`의 `judge`(mode 인자, `not_assigned`, `removed`), `packages/core/apps/ports.ts`의 `AppToolLookup`과 `AppToolCallPath` 주석, `packages/core/apps/routes.ts`의 `appToolLookupOf`와 `callToolHandler`(route는 `program` credential을 만들지 못한다)
  - 같은 domain 규칙의 본보기(agent tool 목록 쪽): `packages/core/lophn-agent/tools/app-public.ts`의 `withPublicOnly`, `packages/core/main/agent-runtime/product-driver.ts`의 `callerDomains`·`toolDomain`
  - 옮길 것: `packages/core/main/daemon/wiring/apps-usage.ts`의 `portsOf`(`agentDomains`, `domainOf`). 꽂는 곳은 `wiring/apps.ts`의 `createAppCalls({...})`
  - 부른 쪽 종류를 나열한 곳(아래 "할 일" 2~3, 10이 하나씩 고친다)
    - 같은 schema를 쓰는 protocol: `invocation.ts`, `call.ts`, `process-wire.ts`, `rewind.ts`(`appToolCallerSchema`를 import하므로 고칠 것 없음)
    - 손으로 둔 사본: `packages/sdk/cap-tool/context.ts`, `packages/core/apps/invocations/context.ts`, `packages/core/apps/runtime/entrypoint/wire.ts`
    - 표: `packages/core/apps/invocations/schema.ts`의 `caller_kind` CHECK
    - 화면: `app-detail/source.ts`의 `Caller`, `core-source.ts`의 `callerOf`, `model.ts`의 `callerText`, `activity/activity-tab.tsx`의 `CalledBy`, `packages/shell/renderer/conversation/agent-tab-core-source-rewind.ts`의 `callerName`
    - 읽기만 한다(바꾸지 않는다): `invocations/rows.ts`와 `rewind/plan.ts`(schema로 읽어 넘긴다), `apps/usage/users.ts`(`caller_kind = 'agent'`만 센다), `activity/rewind-panel.tsx`(`callerText`를 쓴다)
  - wording: `.claude/skills/wording/SKILL.md`, `packages/design/wording/catalog/{app-space,conversation}.ts`
- 계약:
  - 쓰는 것: `idSchema("job")`·`idSchema("jbr")`(`packages/protocol/base/ids.ts`, `sj-jobs-contract`). `judge`(`packages/core/approvals/gate/`)와 `CallGateDeps.assignmentOf`
  - 내놓는 것(`sj-jobs-contract`의 "program caller"가 정한 모양 그대로)
    - wire `appToolCallerSchema`에 `{kind: "program", job: Id<"job">, job_run: Id<"jbr">}`. invocation 기록, process-wire, SDK `AppToolCaller`, 앱 process의 caller 검사(`runtime/entrypoint/wire.ts`)가 같은 모양을 싣는다.
    - `CallAuth`에 `{actor: "program", program: {job, job_run, agent: AgentRef, place: Place | null}}`. `KIND_OF_ACTOR`에 `program: "program"`. route의 actors는 그대로(`user | agent | app`)라 route로 온 program caller는 `forbidden`이다.
    - `VerifiedCaller`에 `{kind: "program", job, job_run, agent, place}`. `verifyCaller`는 본문의 `job`·`job_run`이 `auth.program`의 것과 같아야 하고(아니면 `forbidden`), target은 live 활성 release만이다.
    - `AppToolLookup.find`가 `{release, effect, public, domain}`을 돌려준다(`appToolLookupOf`).
    - `callAllowed`(`gate.ts`)가 program caller를 agent처럼 할당 `judge`(mode `unattended`)로 보고, 거기에 domain 거르기를 더한다. 거르기 재료는 `CallGateDeps`에 port를 더해 `wiring/apps.ts`가 꽂는다(creator가 맡은 domain 집합, 앱 domain 이름의 id).
    - invocation 표 `caller_kind` check에 `'program'`.
    - 화면(앱 상세의 호출 기록, rewind 목록, 대화 rewind 목록)의 부른 쪽 이름에 "Scheduled job"을 더한다. 제목은 붙이지 않는다(job이 지워졌을 수 있다).

## 정한 것

- 할당은 호출 때 읽는다. 담아 두지 않는다. 사람이 할당을 바꾸면 다음 차례부터 따른다.
- domain 거르기는 agent의 tool 목록과 같은 규칙이다(`architecture/domain.md`: 공개 tool이거나 creator가 맡은 domain의 tool). 지금 agent의 호출은 이 거르기를 호출 때 하지 않고(tool 목록에서만 뺀다) program caller만 호출 때 한다. creator는 lophn(domain 없음), Project Manager(project의 active domain), App Engineer(앱의 active domain)뿐이라 Operator 정의를 읽을 필요가 없다. 읽지 못하면 막는다.
- creator의 domain 셈은 `wiring/apps-usage.ts`의 `portsOf`(`agentDomains`, `domainOf`)와 같다. 사본을 만들지 않으려고 둘을 새 file `agent-domains.ts`로 옮기고 `apps-usage.ts`와 `apps.ts`가 같이 import한다(wiring file끼리 import하지 않는다. 둘 이상이 쓰는 값은 wiring 밖 file이 갖는다). `product-driver.ts`의 `callerDomains`는 agent runtime child 안에서 core route로 읽는 다른 길이라 건드리지 않는다.
- core는 그 job run이 지금 도는지 다시 보지 않는다. program 자격은 core 안 run 연산만 만들고 jobs 표는 다른 module이다.
- wording catalog에 key만 더한다(소유 밖 예외).
- `CallAuth`는 union으로 쪼개지 않고 한 객체 type에 `program?`을 더한다. `call()`이 `auth.previewOnly`를, `verifyCaller`가 `auth.app`을 좁히지 않고 읽는다. `actor === "program"`일 때만 `program`이 있어야 하는 것은 `verifyCaller`가 본다.
- 못 읽었을 때: domain 집합이나 tool의 domain id를 못 읽으면 `ok(false)`라 `denied(gate_blocked)`가 invocation에 남는다(domain.md의 "막는 쪽으로 실패한다"). 할당을 못 읽은 것은 지금 agent와 같게 `err`를 올린다(호출이 오류로 돌아가고 run은 `tool_denied`로 닫힌다). `public` tool이면 domain port를 부르지 않는다.
- `judge`에는 mode `"unattended"`를 넘긴다. 지금은 `ASK_EXTERNAL_WHEN_ATTENDED`가 꺼져 있어 결과가 같지만, job 호출은 사람이 없는 호출이라는 뜻을 코드에 적는다.
- 사용 관계(`apps/usage/users.ts`)는 바꾸지 않는다. program 호출은 session이 없어 invocation 쪽 재료로는 세지 않는다. creator가 할당받은 grant 쪽 재료로는 센다.
- DDL은 그 자리에서 고친다(`apps.invocations.tables`의 `caller_kind` CHECK). migration, 새 schema step, 옛 CHECK 읽기를 만들지 않는다(AGENTS.md "호환성"). 옛 data root(`.dev-data` 포함)는 `history_mismatch`로 뜨지 않으니 지우고 새로 만든다. changelog 줄은 lead가 쓴다. 사람의 `~/.lophn`은 건드리지 않는다.

## 할 일

1. wire에 갈래를 더한다: `packages/protocol/apps/calls/caller.ts`의 `appToolCallerSchema`에 `z.strictObject({ kind: z.literal("program"), job: idSchema("job"), job_run: idSchema("jbr") })`. `protocol/jobs`를 import하지 않는다(순환). `invocation.ts`, `call.ts`, `process-wire.ts`, `rewind.ts`가 이 schema 하나를 쓰므로 이 한 줄이 네 곳을 같이 넓힌다.
2. zod를 못 쓰는 사본 셋에 같은 갈래를 더한다. SDK는 core를 import하지 않고 앱 process는 Zod를 싣지 않아서 손으로 맞춘다.
   - `packages/sdk/cap-tool/context.ts`의 `AppToolCaller`, `packages/core/apps/invocations/context.ts`의 `InvocationCaller`: type 갈래 하나.
   - `packages/core/apps/runtime/entrypoint/wire.ts`: `InvocationCaller` type과 `caller()`의 switch에 `case "program"`(`exact(source, ["kind", "job", "job_run"])`, `id(source.job, "job")`, `id(source.job_run, "jbr")`). 빼면 `caller()`가 undefined를 내고 `parseProcessCall`이 호출 전체를 거절해서, job의 앱 호출이 앱 process에서 전부 실패한다. fake link를 쓰는 `calls_test.ts`의 다른 test는 이것을 잡지 못하므로 "끝남"의 사본 test를 둔다.
3. invocation 표: `invocations/schema.ts`의 `caller_kind` CHECK를 `('person', 'agent', 'app', 'program')`으로 고친다(step id 그대로). `store.ts`는 `caller?.kind`를 그대로 넣고 `session`·`turn`은 agent만 채우므로 CHECK `(caller_kind IS 'agent') = (session IS NOT NULL)`이 program에서도 맞다. 코드는 고치지 않고 확인만 한다.
4. 선언 조회에 `public`·`domain`을 싣는다: `packages/core/apps/ports.ts`의 `AppToolLookup.find` 반환 type과 주석, `routes.ts`의 `appToolLookupOf.find`가 `declared.public`, `declared.domain`을 돌려준다. `findPreview`는 그대로다(preview는 판정을 거치지 않는다).
5. `calls/caller.ts`
   - `CallAuth`의 `actor`에 `"program"`, 칸 `program?: { job; job_run; agent: AgentRef; place: Place | null }`.
   - `VerifiedCaller`에 `{ kind: "program"; job; job_run; agent; place }`. `KIND_OF_ACTOR`에 `program: "program"`.
   - `verifyCaller`: person 갈래 뒤에 program 갈래. target이 live이고 release가 null이 아니면 `invalid_input`. `auth.program`이 없거나 `job`·`job_run`이 본문과 다르면 `forbidden`. 이유: 본문은 주장일 뿐이고 core가 만든 자격과 맞춰 본다(app-call.md). `CallerChecks`는 늘리지 않는다(정한 것: run이 도는지 다시 보지 않는다).
6. `calls/gate.ts`
   - `CallGateDeps`에 `agentDomainsOf(agent: AgentRef): Result<readonly string[]>`와 `toolDomainOf(app: Id<"app">, name: string): Result<string | null>`(domain id)를 더한다.
   - `callAllowed`의 `target`에 `public: boolean; domain: string`을 더한다.
   - program 갈래: `assignmentOf(caller.agent)` → `judge(..., "unattended")`가 deny면 false. 이어 `target.public`이면 true. 아니면 `toolDomainOf(app, domain)`과 `agentDomainsOf(agent)`를 읽어 하나라도 `err`이거나 tool의 domain id가 null이면 `ok(false)`, 아니면 `domains.includes(id)`. agent 갈래는 그대로 둔다(정한 것).
7. `calls/service.ts`: `call()`이 `found.value`에서 `public`·`domain`도 꺼내 `run(input, caller, base, declared)`로 넘기고, `work()`가 `callAllowed`의 `target`에 싣는다. `recordDenied(base, "gate_blocked")` 경로가 이미 invocation을 `denied`로 남기므로 program 전용 분기를 더하지 않는다. `base.caller`가 `{kind: "program", ...}` 본문이라 기록에 부른 쪽이 남는다.
8. creator의 domain 셈을 옮긴다
   - 새 `packages/core/main/daemon/agent-domains.ts`: `apps-usage.ts`의 `portsOf`를 그대로 옮겨 `agentDomainPorts(sql)`로 export한다(`UsagePorts` 반환).
   - `wiring/apps-usage.ts`: `portsOf` 정의와 거기에만 쓰던 import를 지우고 `agentDomainPorts`를 import한다. `createReaderRegistration`·`createCoreRegistration`의 동작은 같다.
   - `wiring/apps.ts`: `link`를 연 뒤 `const domains = agentDomainPorts(link.sql)`을 만들고 `createAppCalls`에 `agentDomainsOf`·`toolDomainOf`를 꽂는다. throw를 `err({ code: "unavailable", ... })`로 바꾸는 작은 helper 하나를 같은 file에 둔다(`domainNamesOf`의 try/catch와 같은 꼴).
9. 이름 풀기: `routes.ts`의 `callToolHandler`는 고치지 않는다. `program` credential은 route가 아니라 `runs` wiring이 `appCallPath.call`을 직접 부를 때만 생긴다(`sj-runs-job-origin`).
10. 화면의 부른 쪽 이름(글만 더한다. 새 배치는 없다)
    - `app-detail/source.ts`의 `Caller`에 `{ readonly kind: "program" }`, `core-source.ts`의 `callerOf`에 `case "program": return { kind: "program" }`(제목을 읽지 않는다), `model.ts`의 `callerText`에 `t("app-detail.label.caller-program")`, `activity/activity-tab.tsx`의 `CalledBy`에 `case "program"`(`t("app-detail.label.called-by-program")`).
    - `conversation/agent-tab-core-source-rewind.ts`의 `callerName`: app 갈래로 떨어지기 전에 `caller.kind === "program"`이면 `t("conversation.label.rewind-caller-program")`을 돌려준다. 빼면 `appGet({ app: undefined })`가 실패하고 `undefined`가 이름으로 나온다.
    - wording key 셋: `app-detail.label.caller-program`("Scheduled job"), `app-detail.label.called-by-program`("A scheduled job"), `conversation.label.rewind-caller-program`("Scheduled job"). `catalog/app-space.ts`와 `catalog/conversation.ts`에 더하고 `deno task wording`으로 placeholders를 다시 만든다. 손으로 생성물을 고치지 않는다.
    - `testdata/fake-source.ts`: fake 호출 한 줄의 caller를 program으로 바꿔 `deno task dev:mock`에서 이름이 보이게 한다. 줄을 세는 test가 있으면 맞춘다.
11. `packages/protocol/apps/calls/call.ts`의 규칙 주석(`caller.kind`는 route의 actor와 맞는다)에 program을 더한다: program은 route의 actor가 아니고 core 안 run 연산만 만든다(`app.call_tool`로 오면 `forbidden`). 주석 한 줄이고 코드는 고치지 않는다.
12. test는 `calls_test.ts`(아래 "끝남"의 위험 test 둘). 첫째는 `setup()`의 `lookup.find`가 `public`·`domain`을 싣고 `deps`가 새 port 둘을 꽂도록 고친다. 기존 test가 쓰는 기본값은 공개 tool로 두어 결과가 그대로다. 둘째(`parseProcessCall` 사본)는 `../runtime/entrypoint/wire.ts`와 `../../../protocol/apps/calls/process-wire.ts`를 import하는 순수 함수 test다.

## 끝남

- `deno task check`가 통과한다. 화면 쪽을 건드렸으므로 `deno run -A packages/shell/renderer/build.ts`도 선다.
- 위험 test(배정됨): "job이 부르는 앱 tool은 그 job을 만든 agent의 할당이나 domain 밖이면 실행되지 않는다"(`packages/core/apps/calls/calls_test.ts`). 할당에 없는 앱, 할당에서 뺀 tool, creator가 맡지 않은 domain의 비공개 tool이 모두 `denied(gate_blocked)`이고 invocation이 `denied`로 남는다.
  - `setup()`에 지금 있는 상태(`assignment`, `records`, `sent`)에 `domains`(creator의 domain id 목록, 읽지 못하는 경우도 만든다)와 tool별 `public`·`domain`을 더한다.
  - 표 한 번으로 돌린다: 할당 없는 앱, 뺀 tool, 다른 domain의 비공개 tool, creator 집합을 읽지 못함(비공개 tool), tool의 domain id를 못 찾음(비공개 tool), lophn creator(집합 없음)의 비공개 tool은 모두 `gate_blocked`다. 공개 tool(다른 domain 것), creator가 맡은 domain의 비공개 tool은 `succeeded`다.
  - 막힌 줄마다 `sent`가 늘지 않고, `records`에 `status: "denied"`이고 caller가 `{ kind: "program", ... }`인 줄이 남는다.
  - 같은 file의 "부른 쪽 종류가 credential과 다르거나…" 표에 줄 셋을 더한다(새 test가 아니다): 사람 credential이 program이라고 주장, agent credential이 program이라고 주장, program 자격이 다른 `job_run`의 본문을 보냄. 모두 `forbidden`이고 handler에 가지 않는다.
- 위험 test(배정됨): "앱 process의 `parseProcessCall`은 네 caller 종류(person, agent, app, program)에서 `processCallRequestSchema`와 같은 판정을 한다"(`packages/core/apps/calls/calls_test.ts`에 순수 함수 test 하나. 새 test file은 없다). 이유: `runtime/entrypoint/wire.ts`는 Zod를 싣지 않는 손 사본이라 `program` 갈래를 빼먹으면 `caller()`가 undefined를 내고 `parseProcessCall`이 호출 전체를 거절해서 job의 앱 호출이 모두 말없이 실패한다. fake link를 쓰는 다른 test는 이것을 보지 못한다.
  - 종류마다 맞는 caller 한 개를 `processCallRequestSchema.safeParse(request).success`와 `parseProcessCall(request) !== undefined`가 둘 다 true로 받는지 본다. 프로토콜 쪽 `appToolCallerSchema`가 받는 한 꼴이 사본에서 거절되면 안 된다.
  - 틀린 caller(program에 `job_run` 빠짐, 모르는 `kind`) 하나씩은 둘 다 거절하는지 본다.
  - id는 `ids.newId("job")` 꼴로 만든다(prefix가 틀리면 둘 다 거절하므로 같은 id를 쓴다).
- 남지 않음
  - `grep -n "function portsOf" packages/core/main/daemon/wiring/apps-usage.ts`가 0줄이다.
  - `grep -rn "caller_kind IN ('person', 'agent', 'app')" packages`가 0줄이다.
  - `grep -c program packages/sdk/cap-tool/context.ts packages/core/apps/invocations/context.ts packages/core/apps/runtime/entrypoint/wire.ts`가 셋 다 1 이상이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 예상(wording 생성물은 이 task가 `deno task wording`으로 다시 만든다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): 없음 예상
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: wording catalog(`app-space.ts`, `conversation.ts`와 생성된 placeholders 둘).
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 고치지 않은 문서(lead가 끝에 고친다): `architecture/app-call.md`(program caller, 호출 때 domain 거르기), `architecture/approval.md`
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

# sj-apps-program-caller

앱 tool을 부르는 쪽에 program을 더한다. 앱 호출 경로(`packages/core/apps/calls/`)는 묻지 않고 막기만 한다. agent caller는 `gate.ts`의 `callAllowed`가 그 agent의 지금 할당을 `judge`로 본다. job run의 앱 tool 호출은 caller `program`으로 들어와 그 job을 만든 agent의 할당과 domain으로 같은 판정을 mode `unattended`로 받는다.

- 단위: apps (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/calls/caller.ts`
  - `packages/core/apps/calls/`
  - `packages/core/apps/invocations/schema.ts`
  - `packages/core/apps/invocations/store.ts`
  - `packages/core/apps/invocations/context.ts`
  - `packages/sdk/cap-tool/context.ts`
  - `packages/shell/renderer/app-frame/app-detail/core-source.ts`
  - `packages/shell/renderer/app-frame/app-detail/source.ts`
  - `packages/shell/renderer/app-frame/app-detail/model.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-rewind.ts`
  - `packages/core/apps/runtime/entrypoint/wire.ts`
  - `packages/shell/renderer/app-frame/app-detail/activity/activity-tab.tsx`
  - `packages/core/main/daemon/wiring/apps.ts`
- 읽을 것:
  - 계획: `project-docs/plan/schedule-job/README.md`의 "정한 것"(앱 tool을 부르는 쪽은 program이고 그 job을 만든 agent의 할당 안에서만 부른다)과 "뼈대 검토에서 정한 것"(할당은 부를 때만 확인한다. 막히면 그 job run이 실패로 남는다)
  - architecture: `project-docs/architecture/app-call.md`의 "흐름"과 "지키는 것"(부른 쪽 확인, 호출 경로는 묻지 않고 막기만 한다, invocation 기록, denied도 남긴다). `project-docs/architecture/approval.md`의 "흐름"(앱 호출 경로)과 "지키는 것"의 판정·turn mode. `project-docs/architecture/domain.md`의 "지키는 것" 중 "다른 domain의 비공개 tool은 보이지 않는다"
  - roadmap: `project-docs/products/roadmap/headless-schedule.md`의 "권한"
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/apps`(apps), `packages/sdk`(sdk), `packages/shell/renderer`(shell). `project-docs/boundary-catalog.yaml`의 `core-api`(route `app.call_tool`), `child-supervision-protocol`(process-wire), `sdk-api`(`AppToolCaller`), `approvals`
  - 계약: `project-docs/plan/schedule-job/tasks/sj-jobs-contract.md`(id 접두사 `job`·`jbr`), `project-docs/plan/schedule-job/tasks/sj-runs-job-origin.md`(이 caller로 부르는 쪽)
  - 코드: `packages/core/apps/calls/service.ts`(`call`, `run`의 `work()`가 `callAllowed`를 부르는 자리), `packages/core/apps/calls/gate.ts`(`callAllowed`, `CallGateDeps`의 `assignmentOf`·`appGrantsOf`), `packages/core/apps/calls/calls_test.ts`(`setup()`의 가짜 deps, 부른 쪽 test, 할당 test), `packages/core/apps/runtime/entrypoint/wire.ts`(앱 process가 caller를 읽는 곳), `packages/core/lophn-agent/tools/app-public.ts`(`withPublicOnly`: agent의 tool 목록에서 다른 domain의 비공개 tool을 빼는 규칙), `packages/core/main/daemon/wiring/apps-usage.ts`의 `portsOf`(`agentDomains`, `domainOf`: agent가 맡은 domain과 앱 domain 이름의 id를 core 안에서 셈하는 본보기. wiring file끼리는 import하지 않는다)
  - skill: `.claude/skills/write-test/SKILL.md`, `.claude/skills/wording/SKILL.md`
- 계약:
  - 쓰는 것: `idSchema("job")`, `idSchema("jbr")`(`packages/protocol/base/ids.ts`. `sj-jobs-contract`의 schema와 같은 모양이고, `protocol/jobs`를 import하면 `protocol-cycle`이다). `packages/core/approvals/gate/`의 `judge`(`gate.ts`가 이미 부른다), 할당(`CallGateDeps.assignmentOf`), turn mode `unattended`
  - 내놓는 것:
    - wire caller `appToolCallerSchema`에 `{kind: "program", job: Id<"job">, job_run: Id<"jbr">}`를 더한다. invocation 기록, process-wire, SDK `AppToolCaller`가 같은 모양을 싣는다.
    - `CallAuth`에 `{actor: "program", program: {job, job_run, agent: AgentRef, place: Place | null}}`를 더한다. core 안(run 연산)에서만 만든다. route `app.call_tool`의 actor에는 더하지 않는다.
    - `VerifiedCaller`에 `{kind: "program", job, job_run, agent: AgentRef, place: Place | null}`를 더한다. 할당은 부를 때만, `agent`(job을 만든 agent)의 그때 할당과 mode `unattended`로 판정한다. job을 만들거나 켤 때는 보지 않는다. 할당 밖이거나 creator가 맡지 않은 domain의 비공개 tool이면(README "살 단계 검토에서 정한 것") handler에 보내기 전에 막고, invocation을 `denied`(`gate_blocked`)로 남기고, 부른 쪽에 outcome `denied`를 돌려준다. 그 job run은 이 결과로 실패로 남는다(`sj-runs-job-origin`).
    - invocation 표 `caller_kind`에 `'program'`
    - 화면(앱 상세의 호출 기록, 대화 rewind 목록)의 부른 쪽 이름에 program(job)을 더한다.

## 할 일

1. wire caller에 program을 더한다(`packages/protocol/apps/calls/caller.ts`). 근거: `app-call.md` "지키는 것"(부른 쪽은 core가 확인한다), boundary `core-api`·`child-supervision-protocol`.
   - `appToolCallerSchema`에 `z.strictObject({ kind: z.literal("program"), job: idSchema("job"), job_run: idSchema("jbr") })`를 더한다.
   - 정한 것: `packages/protocol/jobs/values.ts`의 `jobIdSchema`·`jobRunIdSchema`를 import하지 않고 같은 모양의 `idSchema("job")`·`idSchema("jbr")`(`packages/protocol/base/ids.ts`)를 쓴다. (이유: `sj-jobs-contract`의 `packages/protocol/jobs/`가 `packages/protocol/apps/channel-values.ts`를 import한다. 거꾸로 import하면 `tools/check-deps.ts`의 `protocol-cycle`이 떨어진다.)
   - 이 kind 위에 주석을 단다: core 안 run 연산만 이 caller를 만든다. route `app.call_tool`의 어떤 자격(user, agent, app, machine)도 이 kind로 부르지 못한다.
   - `call.ts`, `invocation.ts`, `process-wire.ts`, `rewind.ts`는 이 schema를 그대로 쓰므로 고치지 않는다.
2. core의 부른 쪽 확인에 program을 더한다(`packages/core/apps/calls/caller.ts`). 근거: `app-call.md` "지키는 것"의 부른 쪽 확인.
   - `CallAuth`를 union으로 바꿔 `{ actor: "program"; program: { job: Id<"job">; job_run: Id<"jbr">; agent: AgentRef; place: Place | null } }`를 더한다. 지금 모양 `{ actor: "user" | "agent" | "app"; app?; previewOnly? }`은 한 갈래로 그대로 둔다.
   - `VerifiedCaller`에 `{ kind: "program"; job: Id<"job">; job_run: Id<"jbr">; agent: AgentRef; place: Place | null }`를 더한다.
   - `KIND_OF_ACTOR`에 `program: "program"`을 더한다. route의 actor는 `user | agent | app`뿐이라(`packages/core/apps/routes.ts`의 `callToolHandler`. 고치지 않는다) route로 온 caller `program`은 지금 규칙대로 `forbidden`이다.
   - `verifyCaller`: program은 본문의 `job`·`job_run`이 `auth.program`의 것과 같아야 한다. 다르면 `forbidden`이다. target은 agent·app처럼 live 활성 release(`mode: "live"`, `release: null`)만이고, 그 오류 글에 program을 더한다. 맞으면 `auth.program`의 `agent`·`place`를 담아 돌려준다.
   - 정한 것: core는 그 job run이 지금 도는지 다시 보지 않는다. (이유: program 자격은 route로 들어올 수 없고 core 안 run 연산만 만든다(계약). jobs 표는 다른 module이다.)
   - `service.ts`에서 `auth.previewOnly`를 읽는 곳은 actor로 좁힌다. program 자격에는 `previewOnly`가 없다.
3. program caller의 할당 확인을 둔다(`packages/core/apps/calls/gate.ts`, `service.ts`). 근거: README "뼈대 검토에서 정한 것"(할당은 부를 때만), `architecture/approval.md` "지키는 것"(`deny`는 어느 mode에서나 막는다, unattended의 `ask`는 `run`이 된다), `architecture/app-call.md` "지키는 것"(호출 경로는 묻지 않고 막기만 한다).
   - `callAllowed`가 agent caller에 하는 할당 확인(`deps.assignmentOf(caller.agent)` → `judge(...)`가 `deny`면 막는다)을 program caller에도 돌린다. 할당을 읽는 agent는 `caller.agent`(job을 만든 agent)이고, `judge`의 mode는 `unattended`다. `service.ts`의 `work()`는 지금처럼 사람이 아닌 caller마다 `callAllowed`를 부른다.
   - 정한 것: Gate와 할당 쪽에 program 종류를 새로 만들지 않는다. 판정 입력의 부른 쪽 자리에 creator를 agent로 넣는다. (이유: 판정 근거가 creator의 할당이라 agent와 같은 줄을 탄다. `packages/core/approvals`와 `packages/protocol/approvals`는 이 task 소유가 아니다.)
   - `deny`면 handler에 보내기 전에 `recordDenied(base, "gate_blocked")`로 막는다. 기록의 caller는 wire caller `{kind: "program", job, job_run}`이다.
   - 앱 호출 경로는 묻지 않는다. `ask`는 지나간다(program에는 기다리는 turn이 없고, unattended의 `ask`는 `run`이다).
   - 할당은 이 호출 때 읽는다. 담아 두지 않는다. 사람이 할당을 바꾸면 다음 차례부터 따른다.
   - 다른 domain의 비공개 tool을 거른다(planner, 2026-10-21). job이 부르는 tool은 그 job을 만든 agent의 tool 목록에 뜰 tool이어야 한다: 앱이 할당되어 있고, 그 agent가 맡은 domain의 tool이거나 공개 tool이다(`architecture/domain.md`, 지금 거르기는 `packages/core/lophn-agent/tools/app-public.ts`). 거르기에 필요한 creator의 domain 집합과 tool의 domain은 `packages/core/main/daemon/wiring/apps.ts`에서 port로 넣는다. 거르면 `gate_blocked`로 막히고 job run이 실패로 남는다. 위험 test에 "creator가 맡지 않은 domain의 비공개 tool은 job으로도 부를 수 없다" 줄을 더한다.
   - `gate.ts` 머리 주석("agent는 할당(judge)으로, 앱은 부른 앱의 active grant `app.call`로 본다")에 program을 더한다.
4. invocation 표에 program을 더한다(`packages/core/apps/invocations/schema.ts`, `store.ts`). 근거: `app-call.md` "지키는 것"(invocation 기록은 지우지 않는다. Gate 등에 막힌 호출도 남긴다).
   - `caller_kind`의 CHECK를 `IN ('person', 'agent', 'app', 'program')`으로 고친다. schema step `apps.invocations.tables`를 그 자리에서 고치고 migration step을 더하지 않는다(AGENTS.md "호환성"). step hash가 바뀌므로 개발 data(`.dev-data/`)는 지우고 새로 만든다.
   - program 줄은 `session`·`turn`이 null이다. `insertInvocation`은 agent만 둘을 채우므로 `CHECK ((caller_kind IS 'agent') = (session IS NOT NULL))`에 맞는다. `store.ts`는 고칠 것이 없으면 그대로 둔다.
   - `packages/core/apps/usage/users.ts`의 `caller_kind = 'agent'`는 고치지 않는다. 다른 domain이 쓰는 public tool은 creator의 할당으로 이미 센다.
5. 앱 process로 가는 caller 모양을 맞춘다. 근거: boundary `sdk-api`·`child-supervision-protocol`, 두 `context.ts`의 주석("필드가 바뀌면 같이 바꾼다").
   - `packages/core/apps/invocations/context.ts`의 `InvocationCaller`와 `packages/sdk/cap-tool/context.ts`의 `AppToolCaller`에 `{ kind: "program"; job: string; job_run: string }`을 더한다.
   - `packages/core/apps/runtime/entrypoint/wire.ts`의 `InvocationCaller`와 `caller()`에 `case "program"`을 더한다: `exact(source, ["kind", "job", "job_run"])`, `id(source.job, "job")`, `id(source.job_run, "jbr")`. 이것이 없으면 앱 process가 program 호출을 모두 `400 invalid_input`("call request is invalid")으로 돌려준다.
6. 화면의 부른 쪽 이름에 program을 더한다. 근거: 계약 "내놓는 것"의 화면 줄.
   - `packages/shell/renderer/app-frame/app-detail/source.ts`의 `Caller`에 `{ readonly kind: "program"; readonly job: string; readonly jobRun: string }`을 더한다.
   - `core-source.ts`의 `callerOf`에 `case "program"`(`{ kind: "program", job: caller.job, jobRun: caller.job_run }`)을 더한다.
   - `model.ts`의 `callerText`(지금 person, agent, app, start)에 `case "program"`(`t("app-detail.label.caller-program")`)을 더한다. 호출 기록 줄과 rewind panel(`activity/rewind-panel.tsx`)이 이 함수를 쓴다.
   - `packages/shell/renderer/conversation/agent-tab-core-source-rewind.ts`의 `callerName`은 person·agent가 아니면 app으로 읽는다. app 앞에서 program을 갈라 `t("conversation.label.rewind-caller-program")`을 돌려준다.
   - `packages/shell/renderer/app-frame/app-detail/activity/activity-tab.tsx`의 `CalledBy`는 kind마다 case가 있어 program 줄의 자세히 칸이 빈다. `case "program"`(`<span>{callerText(caller)}</span>`)을 더한다.
   - wording key 둘을 더한다: `packages/design/wording/catalog/app-space.ts`의 `app-detail.label.caller-program`, `packages/design/wording/catalog/conversation.ts`의 `conversation.label.rewind-caller-program`. 값은 둘 다 `"Scheduled job"`이다. 그다음 `deno task wording`(wording skill).
   - 정한 것: 부른 쪽 이름은 고정 문구이고 job 제목을 읽지 않는다. (이유: 계약에 job 하나를 읽는 read가 없다(`job.list`는 목록이다). `job.delete`가 job을 지워도 호출 기록은 남으니 제목이 없는 줄이 생긴다.)
   - 정한 것: wireframe은 고치지 않는다. (이유: 화면 모양이 아니라 있는 목록에 부른 쪽 이름 한 종류를 더한다.)
7. 위험 test를 쓴다(`packages/core/apps/calls/calls_test.ts`). 근거: write-test "권한, secret, sandbox 경계: Gate 판정".
   - 새 test "job이 부르는 앱 tool은 그 job을 만든 agent의 할당 밖이면 실행되지 않는다". 준비는 한 번 하고 경우는 표로 돈다.

     | creator의 할당 | tool effect | 기대 |
     |---|---|---|
     | 그 앱 줄이 없다 | read | outcome `denied`(`gate_blocked`), 앱에 보내지 않는다, invocation이 `denied`이고 caller가 `{kind: "program", job, job_run}`이다 |
     | 그 앱 줄이 있고 그 tool을 뺐다 | write | outcome `denied`(`gate_blocked`), 앱에 보내지 않는다 |
     | 그 앱 줄이 있다 | external | 사람을 기다리지 않고 보낸다, `succeeded` |

   - 할당은 `setup()`의 `state.assignment`(가짜 `assignmentOf`)로 주고, 판정은 `gate.ts`가 import한 진짜 `judge`다. 있는 test "agent는 할당하지 않은 앱의 tool과 할당에서 뺀 tool을 부르지 못한다"와 같은 꼴이다. `setup()`의 가짜 `lookup.find`는 tool 이름의 `w.` 앞붙임으로만 효과를 정하므로 external 줄은 그 가짜를 넓혀 준다. 3의 domain 거르기에 쓰는 port도 `setup()`에 가짜를 둔다.
   - 있는 test "부른 쪽 종류가 credential과 다르거나 모르는 부모 invocation을 주장하면 handler까지 가지 않는다"의 표에 두 줄을 더한다: 사람 자격(`{ actor: "user" }`)으로 caller program을 주장한다. program 자격의 `job_run`과 본문의 `job_run`이 다르다. 둘 다 `forbidden`이고 앱에 보내지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 화면을 고쳤으니 `deno run -A packages/shell/renderer/build.ts`가 된다.
- `deno run --allow-read tools/check-wording.ts`가 새 key에 오류를 내지 않는다.
- 위험 test: "job이 부르는 앱 tool은 그 job을 만든 agent의 할당 밖이면 실행되지 않는다"(`packages/core/apps/calls/calls_test.ts`)
- 남지 않음:
  - `grep -rn "IN ('person', 'agent', 'app')" packages`가 0줄이다.
  - `grep -rn "protocol/jobs" packages/protocol/apps`가 0줄이다.
  - `grep -rn 'actor: "program"' packages/core/apps/routes.ts packages/core/apps/mcp`가 0줄이다(route와 MCP는 program 자격을 만들지 않는다).
  - `grep -L '"program"' packages/protocol/apps/calls/caller.ts packages/core/apps/calls/caller.ts packages/core/apps/invocations/context.ts packages/sdk/cap-tool/context.ts packages/core/apps/runtime/entrypoint/wire.ts packages/shell/renderer/app-frame/app-detail/model.ts packages/shell/renderer/conversation/agent-tab-core-source-rewind.ts`가 0줄이다(일곱 file 모두 program을 안다).
  - 바꾼 file에 `TODO`·`FIXME`가 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording catalog key 둘(`app-detail.label.caller-program`, `conversation.label.rewind-caller-program`)과 `deno task wording`이 다시 만든 `*.placeholders.ts`
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것. 앞 계획 land 뒤 이름이 brief와 달랐던 곳
- 넘길 줄: 소유 밖에서 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

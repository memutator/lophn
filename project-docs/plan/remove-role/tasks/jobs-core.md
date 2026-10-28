# jobs-core

job을 만든 쪽을 (agent, place)로, agent_run의 대상을 `AgentAddress`로 바꾼다. agent는 같은 agent·같은 place가 만든 job만 다루고 사람은 모두 다룬다. job tool 넷은 세 place 종류 모두에서 쓴다(목록은 `place-tools`). `packages/protocol/jobs/*`는 `contract-session`이 고정한 목표 꼴로 이 task가 제자리에서 바꾸고, type이 깨지는 화면을 최소로 맞춘다.

- 단위: jobs (wave 2)
- 선행: runs-core, wireframe-sidebar. job run이 run 출처의 새 creator를 쓴다.
- 소유(이 task만 고친다):
  - `packages/core/jobs`
  - `packages/core/main/daemon/wiring/{jobs,jobs-registration}.ts`
  - `packages/protocol/jobs/{values,jobs}.ts`
  - `packages/shell/renderer/desktop/settings/jobs` (넘길 줄: job 기록 꼴)
  - `packages/shell/renderer/desktop/connection/waiting/{decide,model,fake-source}.ts` (넘길 줄: 멈춘 job의 creator)
  - `packages/shell/renderer/desktop/connection/events/{snapshots,waiting-store}.ts` (넘길 줄: 멈춘 job의 creator)
- 추가 소유(뼈대 검토, planner): 살 단계가 "소유 줄 밖"으로 적은 file을 소유로 옮긴다. 그 step의 "넘길 줄"/"lead가 소유에 더한다" 표시는 이제 이 task의 일이다.
  - `tools/wireframes/pages/screens/project-window.tsx`
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "정한 것" › "주소와 넘기기"(job을 만든 쪽은 (agent, place), agent는 같은 agent·같은 place가 만든 job만 다룬다, 사람은 모두), "session과 place 종류"(tool 목록 셋에 job tool 넷이 모두 든다), "저장과 test"(schema `jobs.creator_role`·`creator_id`), "뼈대 검토"(job 꼴은 이 task가 제자리에서 바꾼다, wave 2와 3을 함께 올린다)
  - 계약 brief: `project-docs/plan/remove-role/tasks/contract-session.md`의 "제자리에서 바꿀 꼴의 목표" › job, `tasks/contract-agent.md`(`AgentId`, `AgentAtPlace`, `AgentAddress`, `LOPHN_AGENT_ID`), `tasks/router-core.md`(`resolveAddress`), `tasks/runs-core.md`(`JobOrigin`, `agent_resolved`, `wiring/jobs.ts`에 남긴 옛 꼴 옮김 줄)
  - architecture: `project-docs/architecture/job.md`("지키는 것"의 job: 이름은 만들 때 풀어 저장, "만들고 고치는 쪽", "할 일마다 시작과 끝", "권한", "화면"), `app-call.md`("지키는 것"의 program caller: 판정은 만든 agent의 지금 할당과 domain)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `jobs`, `agent-tool-spi`, `shell`. `project-docs/module-catalog.yaml`의 `packages/core/jobs`(이름 풀기·시간대·timer는 port, 다른 module의 표를 SQL로 읽지 않는다)
  - test 규칙: `.claude/skills/write-test/SKILL.md`
  - 계약 code: `packages/protocol/lophn-agent/places.ts`(`agentIdSchema`, `agentAtPlaceOutputSchema`, `agentAddressSchema`, `placeOutputSchema`, `LOPHN_AGENT_ID`, `Place`)
  - 고칠 code:
    - protocol: `packages/protocol/jobs/values.ts`(`jobActionInputSchema`, `jobActionSchema`), `jobs.ts`(`jobRecordSchema`, `jobCreate`·`jobList`의 주석)
    - jobs: `packages/core/jobs/schema.ts`, `rows.ts`(`creatorFromRow`, `creatorColumns`), `store.ts`(`loadJobs`, `insertJob`), `ports.ts`(`JobTargets`), `commands.ts`(`resolveAction`, `loadOwned`, `CREATOR_ROLES` 122줄, `create` 140줄), `reads.ts`(`list`), `agent-tools.ts`(`ACTION_NOTE`, `OWN_NOTE`), `commands_test.ts`, `due_test.ts`(52줄 `creator`)
    - 배선: `packages/core/main/daemon/wiring/jobs-registration.ts`(`targetsOf`), `jobs.ts`(starter의 `origin`과 `agent_resolved`, `runPlaceOf`)
    - 넘길 줄(화면): `packages/shell/renderer/desktop/connection/waiting/model.ts`(`jobActionText`의 `agentLabel(action.agent)`), `connection/events/waiting-store.ts`(`jobHold`), `connection/waiting/fake-source.ts`(`JOB_HOLD_AGENT`·`JOB_HOLD_TOOL`·`JOB_HOLD_WORKFLOW`·`JOB_HOLD_BLOCKED`)
  - 부르는 곳(type이 깨지지 않으면 고치지 않는다): `packages/shell/renderer/desktop/settings/jobs/{source,model,core-source}.ts`(자기 view type `AgentRefView`를 쓰고 type 없는 `call`로 읽는다. wave 3 `shell-desktop`이 화면을 옮긴다), `connection/events/snapshots.ts`, `connection/waiting/decide.ts`
- 계약:
  - 쓰는 것: `contract-session`이 적은 job 목표 꼴. `contract-agent`의 `AgentAtPlace`, `AgentAddress`. `router-core`의 `resolveAddress`. `runs-core`의 run 출처 꼴.
  - 내놓는 것: `jobs/*` 꼴: 기록의 `creator: AgentAtPlace`, action input `agent_run.agent: AgentAddress`, 저장 action `agent_run` = `{ agent: AgentId, agent_place: Place | null, ... }`. 열 `jobs.creator_agent TEXT NOT NULL`, `jobs.creator_place TEXT`(null이면 home, 아니면 `prj_…`·`app_…`)이고 `creator_role`·`creator_id`와 그 CHECK는 없다. schema step을 고치고 개발 data는 지운다. 만드는 쪽을 role로 거르던 `CREATOR_ROLES` 검사는 없다.

## 할 일

1. `packages/protocol/jobs/values.ts`(contract-session "job").
   - `jobActionInputSchema`의 `agent_run.agent`: `agentAddressSchema`(이름과 place. place가 없으면 home). `namedAgentSchema` import를 뺀다.
   - `jobActionSchema`의 `agent_run`: `{ kind, agent: agentIdSchema, agent_place: placeOutputSchema.nullable(), prompt, input?, schema? }`. 주석: "`agent`·`agent_place`는 만들 때 푼 부를 agent와 그 place다(home이면 null)". `agentRefOutputSchema` import를 뺀다.
2. `packages/protocol/jobs/jobs.ts`.
   - `jobRecordSchema.creator: agentAtPlaceOutputSchema`. 위 주석: "creator는 job을 만든 session의 (agent, place)다".
   - `jobCreate` 위 주석: "사람은 job을 만들지 못한다." 뒤 role 문장("만든 agent가 lophn·Project Manager·App Engineer가 아니면 forbidden")을 지운다.
   - `jobList` 위 주석: "agent에게는 같은 agent가 같은 place에서 만든 job만, user에게는 모든 job을 준다."
3. 표(README "schema"; contract `jobs.creator_agent`, `jobs.creator_place`).
   - `packages/core/jobs/schema.ts`: `creator_role`, `creator_id`, 그 둘의 CHECK를 지우고 `creator_agent TEXT NOT NULL`, `creator_place TEXT`를 둔다. 머리 주석: `creator_place`는 home이면 NULL, 아니면 `prj_…`·`app_…` id다. 개발 data는 지운다(AGENTS.md "호환성").
   - `rows.ts`: `creatorFromRow(row)` → `{ agent: row.creator_agent, place: row.creator_place === null ? null : { kind: <prefix>, id: row.creator_place } }`. kind는 id 접두(`prj_` → `project`, `app_` → `app`)로 안다(아래 "정한 것"). `creatorColumns(creator: AgentAtPlace)` → `{ creator_agent: creator.agent, creator_place: creator.place?.id ?? null }`. "Operator는 job을 만들지 못하므로…" 주석을 지운다.
   - `store.ts`: `loadJobs`의 `creator?: AgentAtPlace` 거르기는 `creator_agent = ? AND creator_place IS ?`. `insertJob`의 열 이름과 `creator: AgentAtPlace`.
4. 만드는 쪽과 다루는 범위(README "job을 만든 쪽은 (agent, place)다", `job.md` "만들고 고치는 쪽").
   - `packages/core/jobs/ports.ts`의 `JobTargets`: `creatorOf(session): AgentAtPlace | undefined`, `resolveAgent(address: AgentAddress): Result<AgentAtPlace>`(못 풀면 `not_found`). "coding agent는 invalid_input" 주석을 지운다.
   - `commands.ts`:
     - `CREATOR_ROLES`와 그 검사, "only lophn, a Project Manager or an App Engineer creates a job" 글을 지운다. 만드는 것은 지금처럼 agent 자격만이고(`job.create`의 actor), session을 모르면 `forbidden` "the session is not known".
     - `loadOwned`: `creatorColumns(me)`와 `creatorColumns(job.creator)`가 같아야 한다(같은 agent, 같은 place). 남의 job은 `not_found`다. user는 모두다.
     - `resolveAction`의 `agent_run`: `targets.resolveAgent(input.agent)`가 준 `AgentAtPlace`를 `{ agent: r.agent, agent_place: r.place }`로 저장한다.
   - `reads.ts`: `list`의 `creator` type만 따라간다.
   - `agent-tools.ts`:
     - `ACTION_NOTE`의 `{role, place?, name?}`를 "`{agent, place?}`(agent is the agent's name; place is {project: name} or {app: name}; no place means home)"로.
     - `OWN_NOTE`: "You can change or delete only jobs you created in this place."
5. 배선.
   - `packages/core/main/daemon/wiring/jobs-registration.ts`의 `targetsOf`:
     - `creatorOf(session)`: `loadSession`이 준 행의 agent 칸과 `placeOf(row)`(`sessions-core` 뒤 `session/model.ts`의 이름)로 `{ agent, place }`. `agentRefOf`를 쓰지 않는다.
     - `resolveAgent(address)`: `createSessionDirectory({ ...placeDepsOf(sql), publish: () => {}, sql: () => sql }).resolveAddress(address)`(router-core)를 그대로 돌려준다. `coding_agent` 거절, `placeOfAgentRef`, Operator place 찾기를 지운다.
   - `wiring/jobs.ts`의 starter: `origin = { job, job_run, creator: job.creator }`. `agent_run`은 `{ kind: "agent_resolved", agent: { agent: action.agent, place: action.agent_place }, prompt, input?, schema? }`. `runs-core`가 남긴 옛 꼴 옮김 줄(옛 ref의 id 함수), `runPlaceOf`, `placeOfAgentRef`·`AgentRef`·`Place`·`RunPlace` import 가운데 쓰이지 않는 것을 지운다.
6. 화면 넘길 줄(job 기록 꼴이 바뀌어 type이 깨지는 곳만).
   - `connection/events/waiting-store.ts`의 `jobHold`: `WaitingEntry.agent`는 아직 옛 `CallAgent`다(`shell-events`가 `AgentId`로 바꾼다). `agent`는 `creator.agent === LOPHN_AGENT_ID ? { role: "lophn" } : { role: "operator", agent: creator.agent }`, `place`는 `creator.place`. `placeOfAgentRef` import를 뺀다.
   - `connection/waiting/model.ts`의 `jobActionText`: `agent_run`의 `agent`는 `AgentId`다. lophn이면 `waiting.label.agent-lophn`, 아니면 `waiting.label.agent-operator` key(있는 key를 쓴다. 새 key를 더하지 않는다).
   - `connection/waiting/fake-source.ts`: `JOB_HOLD_*`의 `creator`와 `agent_run`을 새 꼴로. lophn이 만든 것은 `{ agent: "lophn", place: null }`, 옛 App Engineer·PM이 만든 것은 그 place의 lophn(`{ agent: "lophn", place: { kind: "app", id: ORDERS } }`, `{ agent: "lophn", place: { kind: "project", id: PROJECT } }`), `agent_run`은 `agent: "lophn", agent_place: { kind: "project", id: PROJECT }`. 주석의 role 이름("App Engineer가 만든", "Project Manager가 만든")을 place 말로.
   - `settings/jobs`, `snapshots.ts`, `decide.ts`는 type이 깨질 때만 고친다. role로 가르는 화면 글(`creatorText`, `jobsOfProject`)은 `shell-desktop`의 일이다.
7. test(`write-test` skill).
   - `commands_test.ts`를 위험 test로 옮겨 고친다(아래 "끝남"). 대역 `creatorOf`가 session마다 `AgentAtPlace`를 준다: `LOPHN_1`·`LOPHN_2` = `{ agent: "lophn", place: null }`, `LOPHN_PRJ` = `{ agent: "lophn", place: { kind: "project", id: PRJ } }`, `OTHER` = `{ agent: "agt_…", place: null }`. `LOPHN_1`이 만든 job을 `LOPHN_PRJ`와 `OTHER`가 고치거나 지우면 `not_found`이고 job이 그대로다. `LOPHN_2`와 user는 고친다. user가 지우면 job과 job run이 함께 사라진다. 여러 경우는 준비 한 번에 표로 돈다.
   - `due_test.ts`: `insertJob`의 `creator`를 `{ agent: "lophn", place: null }`로, `agent_run` action이 있으면 새 꼴로. test 이름과 판정은 그대로다.
   - `scheduler_test.ts`, `schedule_test.ts`는 꼴이 걸리면만 고친다.

## 정한 것

- `jobs.creator_place`의 kind는 id 접두로 안다(`prj_` → project, `app_` → app). 이유: contract가 이 열을 id 하나로 정했고, id 접두는 `idSchema("prj")`·`idSchema("app")`가 정한다. 열을 하나 더 두지 않는다(AGENTS.md "속도").
- `creatorOf`와 `job.create`의 검사에서 place 종류를 묻지 않는다. 세 place 종류 모두 job을 만든다. 이유: README "셋 모두에 job tool 넷이 든다". 어느 session이 job tool을 받는지는 tool 목록(`place-tools`)이 정한다.
- 대기 card의 agent label은 `shell-events` 전까지 lophn과 그 밖(옛 Operator label)으로만 가른다. 이유: `WaitingEntry.agent`가 아직 옛 `CallAgent`이고, label 글과 wording은 wave 3 `shell-events`·`cleanup-shell`의 일이다.

## 끝남

- `npm run check`가 통과한다.
- renderer를 고쳤으므로 `node packages/shell/renderer/build.ts`가 선다.
- 바꾼 곳의 test: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test packages/core/jobs/commands_test.ts packages/core/jobs/due_test.ts packages/core/jobs/scheduler_test.ts packages/core/jobs/schedule_test.ts packages/core/apps/calls/calls_test.ts`
- 위험 test: "agent는 같은 agent가 같은 place에서 만든 job만 고치고 지운다. 다른 place의 같은 agent와 다른 agent에게는 없는 job이고, 사람은 모두 고치고 지운다"(`packages/core/jobs/commands_test.ts`의 지금 test를 옮겨 고친다. 다른 agent가 job을 고치면 남의 할당으로 일을 시키는 길이 된다, `job.md` "만들고 고치는 쪽"). job의 tool_run이 만든 agent의 할당과 domain 밖에서 막히는 것은 `calls_test.ts`(`place-tools` 소유)가 보고, 이 task는 통과만 확인한다.
- 남지 않음:
  - `grep -rn "creator_role\|creator_id\|CREATOR_ROLES\|AgentRef\|agentRefOutputSchema\|NamedAgent\|namedAgentSchema\|placeOfAgentRef\|coding_agent\|project_manager\|app_engineer\|Project Manager\|App Engineer\|Operator" packages/core/jobs packages/protocol/jobs packages/core/main/daemon/wiring/jobs.ts packages/core/main/daemon/wiring/jobs-registration.ts`가 0줄이다.
  - `grep -n "role" packages/core/jobs/agent-tools.ts packages/core/main/daemon/wiring/jobs.ts`가 0줄이다.
  - `grep -n "placeOfAgentRef\|project_manager\|app_engineer" packages/shell/renderer/desktop/connection/events/waiting-store.ts packages/shell/renderer/desktop/connection/waiting/fake-source.ts`가 0줄이다.
- 이 task 뒤에도 남는 것(보고의 "알려진 미완 동작"에 옮긴다): Settings › Scheduled jobs의 만든 쪽 줄(`creatorText`)과 project 창 job panel의 거르기(`jobsOfProject`, `packages/shell/renderer/desktop/settings/jobs/model.ts`)가 role로 갈라 새 job을 바르게 보이지 못한다(`shell-desktop`). 대기 card의 agent label이 lophn이 아니면 옛 Operator 글이다(`shell-events`, `cleanup-shell`).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

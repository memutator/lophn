# schedule-job: 정해진 때 run을 돌리는 job

- **목표:** core에 scheduler와 job을 둔다. job은 주기와 원샷 run 하나(agent 호출 또는 앱 tool 호출)와 놓친 차례 정책이다. agent가 만들고 켠다.
- **재료:**
  - roadmap `project-docs/products/roadmap/headless-schedule.md`("놓친 차례", "무엇을 만드나" 2, "정한 것", "권한")
  - architecture `approval.md`("turn mode"의 unattended, "시킨 것이 승낙이고 할당이 허락이다")
  - architecture: `event.md`, `layers.md`, `place-session.md`. `headless-run`이 쓴 run 문서
- **범위 밖:**
  - flow(program이 이끄는 workflow, `workflow.md` "정할 것" 1)
  - 앱 secret의 OAuth(gdrive 예). roadmap "따로 필요한 것"이다.
  - lophn이 꺼져 있을 때 도는 상주 daemon
  - 새 e2e와 eval(사람이 정하고 돌린다). 있는 e2e는 land가 돌리므로 깨지지 않게 한다("lead가 할 일").
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `sj-`로 시작한다.
- **시작 조건:** `headless-run`이 land했다.
- **brief의 기준:** brief는 2026-10-21에 쓰고 2026-10-22 main(`550f75416`)에 다시 맞췄다. `headless-run`이 만드는 것(run module, run route, CLI, run 화면)은 그 계획 brief의 이름으로 적었다. 그 계획이 land하면 planner가 land한 이름과 다시 맞춘 뒤 연다.

## 정한 것

roadmap `headless-schedule.md`의 "정한 것"을 따른다. 정리하면 이렇다.

- **언제 도나**
  - lophn(tray 포함)이 켜져 있을 때만 돈다.
  - 놓친 차례는 몇 번이든 한 번으로 치고, 몇 번 놓쳤는지는 기록에 남긴다.
  - 앞 차례가 돌면 이번 차례는 건너뛴다.
  - 도는 중에 lophn이 꺼져 끊긴 run은 놓친 차례로 친다.
- **주기와 정책**
  - 주기는 간격(`every`)과 하루 중 시각(`at`, 선택)이다. cron 문법은 쓰지 않는다.
  - 놓친 차례의 정책은 `run`(켜지면 바로)과 `hold`(대기 목록 card로 알리고 사람이 [지금 실행]이나 [건너뛰기])다.
- **누가**
  - job은 agent가 만들고 켠다. 사람이 시킨 것이 승낙이다(사람).
  - job의 run은 unattended다.
- schedule은 기록 event(`tx.emit`)나 Bus에 얹지 않는다(Reactor는 `reactor-remove`가 지웠다). 시각과 timer는 주입한 Clock으로 받는다(AGENTS.md).

이 계획에서 더 정한 것:

- **job tool은 lophn, Project Manager, App Engineer에게 준다**(`job.create`, `job.update`, `job.delete`, `job.list`). 근거: 사람이 일을 맡기는 쪽이 이 셋이다. Operator는 job이 부르는 쪽이다.
- **job의 원샷 run이 부를 수 있는 것은 `headless-run`의 run과 같다:** agent 호출(lophn agent 누구나) 또는 앱 tool 호출. 앱 tool을 부르는 쪽은 program이고, 그 job을 만든 agent의 할당 안에서만 부른다.
- **job 목록과 job run 기록은 화면에 둔다.** 자리와 모양은 `ui-design` skill로 wireframe부터 정한다. job이 연 session은 `headless-run`처럼 그 job 아래에 묶어 보인다.
- **job 표에는 다음 차례 시각과 마지막 run을 둔다.** 켤 때 다음 차례가 지났으면 놓친 것으로 본다.

### 뼈대 검토에서 정한 것 (agent, 2026-10-21)

- **timer는 Clock 옆의 작은 port(`JobTimers {set, clear}`)로 주입한다.** `packages/base`의 `Clock`은 `now`·`nowMs`뿐이라(timer가 없다) 고치지 않는다.
- **주기와 시각**
  - `every`의 단위는 `m | h | d`다.
  - `at`은 하루 단위 간격(`Nd`)에만 쓴다. 시각은 이 컴퓨터의 local 시간대다.
  - 서머타임으로 그 시각이 없는 날은 그 뒤 첫 시각에 돈다. 같은 시각이 두 번 오는 날은 한 번만 돈다.
- **"켤 때"는 lophn을 켤 때다.** 꺼 둔 job을 다시 켜면 그때부터 새로 센다. 놓친 것으로 치지 않는다.
- **`hold`로 기다리는 줄**
  - 기다리는 동안 또 놓친 차례는 같은 줄에 접는다.
  - 제때 온 차례가 돌면 기다리던 줄은 건너뜀(`superseded`)으로 닫는다. 지금 돈 run이 놓친 일을 대신하기 때문이다.
  - 앞 run이 도는 중에 사람이 [지금 실행]을 누르면 `conflict`이고, card는 남는다. 겹쳐 돌지 않는다는 규칙 그대로다.
- **job 지우기**
  - `job.delete`는 job과 그 run 기록을 지운다. 도는 run은 끝까지 돈다.
  - 사람도 job 화면에서 끄고 지운다. "시킨 것이 승낙"이지만, 사람이 멈출 길은 있어야 한다.
- **job이 부를 agent는 call tool과 같은 꼴(`{role, place?, name?}`)로 받는다.** model은 agent를 이름으로 안다. 이름은 job을 만들 때 core가 AgentRef로 풀어 저장한다. tool file이 아니라 core route가 푼다.
- **할당은 부를 때만 확인한다.** 막히면 그 job run이 실패로 남는다.
- **job에 `title`을 둔다.** 목록과 card에 보일 이름이다.
- **job 화면은 모든 place의 job을 한곳에 모은 목록 하나다.** lophn이 만든 job은 place가 없기 때문이다. 자리와 모양은 wireframe에서 정한다.

### 살 단계 검토에서 정한 것 (agent, 2026-10-21)

- **job이 부르는 앱 tool도 다른 domain의 비공개 tool이면 막는다.** 그 job을 만든 agent의 tool 목록에 뜰 tool만 부른다. 앱이 할당되어 있고, 맡은 domain의 tool이거나 공개 tool이어야 한다(`architecture/domain.md`). 근거: 이 거르기가 없으면 job을 통해 agent가 못 쓰는 tool을 부르게 된다. 권한 경계라 위험 test를 둔다(`sj-apps-program-caller`).
- **job이 연 run의 session은 다른 run처럼 sidebar에서 그 run 아래에 묶인다.** run에는 job의 `title`을 붙여 보인다. job 화면의 기록 줄은 그 run으로 가는 길이다. 근거: session을 run 아래와 job 아래 두 곳에 묶으면 같은 session이 두 번 보인다. 그래서 위 "job이 연 session은 그 job 아래에 묶어 보인다"를 이렇게 고친다.
- **시간대는 tx port `jobZonePort {zone(): string}`로 받는다.** `jobs-registration.ts`가 `Intl.DateTimeFormat().resolvedOptions().timeZone`으로 채운다. 환경 hook은 writer Worker에 닿지 않는다.
- **`jobRunEnded`에 선택 칸 `reason`을 둔다.** run을 시작조차 못 한 job run(agent나 앱이 없어짐)도 왜 실패했는지 남긴다.
- **agent는 자기가 만든 job만 고치고 지운다. 사람은 모든 job을 고치고 지운다.** job run은 만든 agent의 할당으로 돈다. 다른 agent가 고칠 수 있으면 남의 할당으로 일을 시키는 길이 된다. 위험 test: "agent는 다른 agent가 만든 job을 고치거나 지우지 못한다"(`sj-jobs-store`).
- **서머타임으로 없는 시각은 시계가 건너뛴 그 시각에 돈다.** 02:30이 없으면 03:00이다.
- **run 기록에 `job` 칸을 둔다.** job이 연 run이면 그 job id이고, 아니면 null이다. sidebar가 run에 job의 `title`을 보이려면 필요하다(`sj-runs-job-origin`).
- **job 화면은 Settings › System › "Scheduled jobs"에 둔다(안).** 화면 낱말은 "Scheduled job"이다. 사람이 gallery에서 자리를 정한다.
- **job의 원샷 run은 이미 푼 AgentRef로 시작한다.** run의 시작 입력을 만드는 helper(예: `runStartOfJobAction`)는 `sj-runs-job-origin`이 두고, scheduler(`sj-jobs-scheduler`)가 쓴다.
- **run service를 jobs wiring에 넘기는 자리(`wiring/context.ts`의 `Late` 칸)는 lead가 등록한다.**
- **app 상세의 부른 쪽 이름과 job 화면은 같은 낱말을 쓴다.** 낱말은 job 화면 wireframe이 정하고, `sj-apps-program-caller`의 wording이 따른다.

## 사람이 정할 것

- 없음.

## 순서

- wave와 선행은 tasks의 brief가 정한다. 계약(job의 모양, job tool, scheduler port)을 먼저 고정한다.

## lead가 할 일

- `workflow`와 같이 돌 수 있다. 겹치는 file은 계획 `workflow`의 README "lead가 할 일"이 적는다(2026-10-22 뼈대 대조: tool 목록과 agent tool test, `ids.ts`, `events/transient.ts`, `check-deps.ts`, renderer `workspace/source.ts`·`workspace.tsx`·sidebar, wording). 나중에 land하는 lead가 rebase 때 두 쪽을 다 남긴다.
- merge할 때마다 바뀐 곳의 test를 돌린다.
- `deno task check`는 `tests/e2e`, `tests/eval`, `tests/support`도 type check하고 `tests/eval`의 test도 돈다. protocol type, route, helper를 바꾸는 task는 그것을 쓰는 `tests/` 줄도 같이 고친다(brief에 적었다).
- land(`project-docs/plan/tools/lead/land.sh`)는 `check:full`과 `deno task e2e`를 돈다. `LOPHN_LAND_SKIP_E2E`를 쓰지 않는다. 있는 e2e가 깨지면 이 계획 안에서 고친다. 새 e2e는 더하지 않고 eval은 돌리지 않는다(사람).
- 새 module `packages/core/jobs`는 lead가 빈 `packages/core/jobs/mod.ts`와 `project-docs/module-catalog.yaml`·`project-docs/boundary-catalog.yaml`(boundary `jobs`) 줄을 `sj-jobs-contract`보다 먼저 commit한다. 폴더가 없으면 `check-modules`가 "없는 path"로, 줄이 없으면 "catalog에 없는 폴더"로 떨어진다. worker는 `project-docs`를 고치지 못한다.
- 위험 test는 roadmap의 둘(놓친 차례가 여러 번이어도 한 번만 돈다. 앞 차례가 도는 동안 같은 job이 또 돌지 않는다. `sj-jobs-due`)과 이 계획이 더한 셋이다: 서머타임 날의 차례(`sj-jobs-store`), 남이 만든 job 고치기(`sj-jobs-store`), program caller의 할당과 domain(`sj-apps-program-caller`).
- 다 끝나면
  - 새 architecture 문서(job)를 쓴다. `project-docs/architecture/layers.md`의 feature module 목록("말", "모양")에 jobs를 더한다.
  - `project-docs/architecture/app-call.md`에 program caller(부른 쪽 확인, creator의 할당과 domain으로 막기)를 더한다.
  - `project-docs/architecture/event.md` "지키는 것"의 "program은 agent를 부르지 않는다"와 `project-docs/products/AGENT-ROLE.md` 6절에 job이 agent를 부르는 때(사람이 시킨 job의 차례)를 더한다.
  - roadmap `headless-schedule.md`에서 land된 것을 지운다.
  - changelog 열린 판에 항목을 덧붙이고, 계획 폴더를 지운다.
- 사람에게 묻는 것: push. 그 밖은 planner에게 묻는다.

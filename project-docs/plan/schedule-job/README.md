# schedule-job: 정해진 때 run을 돌리거나 workflow를 시작하는 job

- **목표:** core에 scheduler와 job을 둔다.
  - job은 주기, 할 일 하나, 놓친 차례 정책이다.
  - 할 일은 agent 호출 run, 앱 tool 호출 run, project의 `kind: agent` workflow instance 시작 가운데 하나다.
  - agent가 만들고 켠다. 사람은 화면에서 보고, 끄고, 지운다.
  - `hold` 정책의 놓친 차례는 대기 목록 card로 사람에게 묻는다.
- **재료:**
  - roadmap `project-docs/products/roadmap/headless-schedule.md`: "놓친 차례", "무엇을 만드나" 2, "정한 것", "권한"
  - roadmap `workflow.md`의 "남은 일" 5(job이 instance를 시작한다)
  - architecture:
    - `run.md`: run 시작, run 기록, 끝을 아는 법, 켤 때 복구, 화면
    - `workflow.md`: `StartWorkflow`, instance 상태, 시작한 쪽
    - `approval.md`: unattended, "시킨 것이 승낙이고 할당이 허락이다"
    - `app-call.md`: 앱 호출 경로와 부르는 쪽
    - `domain.md`: 비공개 tool 거르기
    - `event.md`: Reactor 없음, 뒤에 움직일 일은 같은 tx에서
    - `place-session.md`, `layers.md`
    - `workspace-layout.md`: activity bar와 desk
    - `agent-definition.md`: role마다 tool 목록
  - `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`
- **범위 밖:**
  - flow(`workflow.md` "정할 것" 1)
  - 앱 secret의 OAuth(gdrive 예, roadmap "따로 필요한 것")
  - lophn이 꺼져 있을 때 도는 상주 daemon
  - 자동 재시도
  - 새 e2e와 eval: 사람에게 묻는다. 있는 e2e는 land가 돌리고 통과해야 한다.
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `sj-`로 시작한다.
- **시작 조건:** 없다. `headless-run`, `workflow`, `workflow-shell`이 land했다(main `dd5808470`, `v0.6.0`).
- **옛 계획:** 2026-10-21에 쓴 옛 brief는 지웠다(git 기록에 있다). 그 뒤 run, workflow, desk, activity bar가 land해서 새로 썼다.

## 정한 것

roadmap `headless-schedule.md`의 "정한 것"을 따른다. 아래는 이 계획에 걸려 agent가 정한 것이다. 옛 계획의 결정 가운데 지금도 맞는 것은 다시 확인해 옮겼다(2026-10-22).

언제 도나
- **lophn(tray 포함)이 켜져 있을 때만 돈다.** scheduler는 주입한 Clock과 작은 timer port(`set`, `clear`)로 깨어난다. `packages/base`의 Clock은 고치지 않는다.
- **놓친 차례는 몇 번이든 한 번으로 친다.** 몇 번 놓쳤는지는 기록에 남긴다. 도는 중에 lophn이 꺼져 끊긴 차례도 놓친 차례로 친다(`run.md` "켤 때").
- **앞 차례가 아직 돌면 이번 차례는 건너뛰고, 건너뛴 사실을 기록에 남긴다.**
  - "아직 돈다"는 할 일에 따라 다르다.
  - run이면 그 run이 `running`인 동안이다.
  - workflow 시작이면 앞 차례가 시작한 instance가 `running`인 동안이다. instance의 끝은 참가자가 말한 기록일 뿐이다(`workflow.md`). 끝나지 않은 instance가 이어지면 건너뛴 기록이 쌓이고, 사람은 그것을 화면에서 본다.
- **"켤 때"는 lophn을 켤 때다.** 꺼 둔 job을 다시 켜면 그때부터 새로 세고, 놓친 것으로 치지 않는다.

주기
- **주기는 간격(`every`)과 하루 중 시각(`at`, 선택)이다. cron 문법은 쓰지 않는다.**
  - `every`의 단위는 `m | h | d`다.
  - `at`은 하루 단위 간격(`Nd`)에만 쓴다. 시각은 이 컴퓨터의 local 시간대이고, 시간대는 port로 받는다.
- **서머타임**
  - 시계가 건너뛰어 없는 시각은 건너뛴 그 시각에 돈다. 02:30이 없으면 03:00이다.
  - 같은 시각이 두 번 오는 날은 한 번만 돈다.

놓친 차례 정책
- **`run`은 켜지면 바로 한 번 돈다.**
- **`hold`는 대기 목록 card로 알리고, 사람이 [지금 실행]이나 [건너뛰기]를 고른다.**
  - 기다리는 동안 또 놓친 차례는 같은 줄에 접는다.
  - 제때 온 차례가 돌면 기다리던 줄은 `superseded`로 닫는다.
  - 앞 차례가 도는 중에 [지금 실행]을 누르면 `conflict`이고, card는 남는다.
  - card는 꺼졌다 켜져도 남는다. 정본은 core 표다.

할 일
- **agent 호출:** 부를 agent를 call tool과 같은 꼴(`{role, place?, name?}`)로 받는다.
  - job을 만들 때 core가 AgentRef로 풀어 저장한다.
  - 차례마다 run 연산(`run.md`)으로 새 session을 열고 unattended turn으로 돈다.
- **앱 tool 호출:** 앱 호출 경로에 부르는 쪽 `program`을 더한다.
  - 그 job을 만든 agent의 지금 할당과 domain 거르기(그 agent의 tool 목록에 뜰 tool만)로 판정한다. mode는 unattended다.
  - 막히면 그 job run이 실패로 남는다. 권한 경계라 위험 test를 둔다.
- **workflow 시작:** project의 workflow(`<project 이름>/<name>`)와 입력 글, 고른 step(선택)을 받는다.
  - 차례마다 workflows service로 instance를 시작한다. 시작한 쪽은 `job:<id>`로 instance 줄에 남는다.
  - 사람만 받는 `StartWorkflow` route는 그대로 두고, job은 core 안 길로 시작한다.
- **run 기록과 instance에 job을 단다.**
  - job이 연 run은 `job` 칸에 그 job id를 갖는다.
  - job이 시작한 instance는 시작한 쪽이 job이다.
  - 화면은 거기에 job의 `title`을 보인다.
- **자동 재시도는 없다.** 실패한 차례는 기록에 남고, 다시 하기는 사람이나 flow의 일이다.

누가
- **job tool(`job.create`, `job.update`, `job.delete`, `job.list`)은 lophn, Project Manager, App Engineer가 받는다.** Operator는 job이 부르는 쪽이다.
- **agent는 자기가 만든 job만 고치고 지운다. 사람은 모든 job을 고치고, 끄고, 지운다.**
  - job run은 만든 agent의 할당으로 돈다.
  - 다른 agent가 고칠 수 있으면 남의 할당으로 일을 시키는 길이 된다. 권한 경계라 위험 test를 둔다.
- **job에 `title`을 둔다.** 목록, card, run과 instance에 보일 이름이다.
- **job 지우기는 job과 그 기록을 지운다.** 도는 run이나 instance는 끝까지 돈다. 지운 job이 남긴 run과 instance에서는 job 이름이 사라진다.
- **job이 부른 agent도 job tool을 받아 job을 만들 수 있다.** 막지 않는다. program은 약하게 두고, 고치기는 만든 agent만 하며, 사람은 모든 job을 화면에서 본다(뼈대·살 검토, 2026-10-22).

화면
- **job 목록과 job run 기록은 모든 place의 job을 한곳에 모은 화면 하나다.** lophn이 만든 job은 place가 없다.
  - 자리는 wireframe에서 정한다. 추천은 Settings › System › "Scheduled jobs"다. project 창의 activity bar는 project마다이고 job은 project를 건너기 때문이다.
- **hold card는 대기 목록의 셋째 read source다.** 지금은 session snapshot과 activation 동의 둘이다.
- **모양은 wireframe으로 먼저 그리고 사람이 본다**(`ui-design` skill). 승인 전에는 renderer task가 돌지 않는다.

기록 event
- **scheduler를 기록 event나 Bus에 얹지 않는다.** 뒤에 움직일 일은 그 일을 아는 command가 같은 tx에서 한다(`event.md`).
- **화면이 다시 읽게 하는 신호는 run과 workflow의 본보기를 따른다.**

## 사람이 정할 것

- job 화면과 hold card의 wireframe을 본다.

## 순서

- wave와 선행은 tasks의 brief가 정한다.
- 계약을 먼저 고정한다: job과 job run의 모양, route, tool, scheduler port, program caller, run과 instance의 job 칸.
- renderer task는 wireframe 승인 뒤에 돈다.

## lead가 할 일

- **lead가 직접 등록한다**(뼈대와 살 검토, 2026-10-22).
  - 계약 task 전: 빈 `packages/core/jobs/mod.ts`와 catalog 줄(module `packages/core/jobs`, boundary `jobs`, `agent-tool-spi.provided_by`에 `jobs`)
  - 계약 task와 같이(wave 2 전):
    - `packages/protocol/mod.ts`의 `export * as jobs`와 `ALL_ROUTES`. 없으면 renderer allowlist가 job route를 막는다.
    - `packages/core/main/daemon/wiring/context.ts`의 `Late`·`LATE_KEYS`에 `runService`, `workflowService`. wave 2의 `sj-workflows-job-start`와 wave 3의 `sj-runs-job-origin`이 `ctx.provide`한다.
  - `sj-jobs-store` 뒤: `assembly.ts`의 `TEAMS`에 둘(`core/jobs/register.ts`, `wiring/jobs-registration.ts`)과 `TEAM_MODULES` url 둘. workflows 뒤에 둔다.
  - `sj-jobs-scheduler` 뒤: `WIRINGS`에 `jobsWiring`을 `workflowsWiring` 바로 뒤에 둔다.
  - wording key를 더한 merge마다 wording 생성을 돈다.
- **gallery Drafts.** 화면 task 셋이 각자 자기 draft와 `drafts/index.tsx`의 줄을 지운다. 그 file은 merge 때 lead가 맞춘다.
- **merge와 land.**
  - merge할 때마다 바뀐 곳의 test를 돌린다.
  - land는 `check:full`과 `deno task e2e`를 돈다. 새 e2e는 더하지 않는다.
  - renderer를 고치는 task(화면 셋과 `sj-apps-program-caller`의 caller 표시)는 `deno run -A packages/shell/renderer/build.ts`도 돈다.
- **gallery server는 `timeout 900 python3 -m http.server 0 -d tools/wireframes`로만 띄운다.** worker 지시문에 있다.
- **위험 test**
  - 놓친 차례가 여러 번이어도 job은 한 번만 돈다.
  - 앞 차례가 도는 동안 같은 job이 또 돌지 않는다(run과 workflow 둘 다).
  - 서머타임 날의 차례
  - agent는 다른 agent가 만든 job을 고치거나 지우지 못한다.
  - program caller는 만든 agent의 할당과 domain 밖의 앱 tool을 부르지 못한다.
  - 앱 process의 caller parser(`wire.ts`)가 네 caller 종류를 protocol schema와 똑같이 받는다. 손으로 맞추는 사본이라 놓치면 job의 앱 호출이 모두 말없이 거절된다.
- **다 끝나면 문서를 고친다.**
  - 새 architecture 문서(job)를 쓴다.
  - 고칠 문서: `layers.md`(feature module에 jobs), `app-call.md`(program caller와 부를 때 domain 거르기), `run.md`(job 칸, 켤 때 끊긴 job 차례는 놓친 차례), `workflow.md`(job이 시작한 instance), `event.md`("program은 agent를 부르지 않는다" 옆에 사람이 시킨 job의 차례), `approval.md`(unattended를 싣는 곳에 job)
  - `project-docs/products/AGENT-ROLE.md`(job이 agent를 부르는 때, job tool)
  - roadmap `headless-schedule.md`와 `workflow.md`에서 land된 것을 지운다.
  - changelog 열린 판에 항목을 덧붙이고, 계획 폴더를 지운다. 0.6.0은 닫혔으니 열린 판은 `0.7.0.md`다. 없으면 `_template.md` 꼴로 만든다. `runs`의 `job` 열과 `invocations`의 `caller_kind` CHECK를 제자리에서 바꾸므로 개발 data를 새로 만든다고 적는다(migration 없음).
- **사람에게 묻는 것:** push, wireframe 승인. 그 밖은 planner에게 묻는다.

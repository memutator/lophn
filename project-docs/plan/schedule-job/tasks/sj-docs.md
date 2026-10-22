# sj-docs

계획이 land한 job을 문서에 맞춘다. 새 `architecture/job.md`를 쓰고, job이 걸친 architecture 문서 여섯과 `AGENT-ROLE.md`를 고치고, roadmap 둘에서 land된 것을 지운다. 문서는 지금 plan branch의 코드가 정본이다. brief의 글을 옮기지 말고 코드를 열어 확인한 것만 쓴다.

- 단위: docs (wave 4)
- 선행: sj-jobs-scheduler
- 소유(이 task만 고친다):
  - `project-docs/architecture/job.md` (새 file)
  - `project-docs/architecture/{layers,app-call,run,workflow,event,approval}.md`
  - `project-docs/products/AGENT-ROLE.md`
  - `project-docs/products/roadmap/{headless-schedule,workflow}.md`
  - `project-docs/issues/job.md` (첫 머리 줄에 `project-docs/architecture/job.md` path를 더하는 것만)
- 읽을 것:
  - 규칙: `AGENTS.md`("말", "문서"), 지금 architecture 문서의 꼴(`project-docs/architecture/run.md`가 가장 가까운 본보기다: 머리 문단, "흐름" 그림, "지키는 것", "왜 이 모양인가")
  - 계획: `project-docs/plan/schedule-job/README.md`("정한 것", "lead가 할 일"의 "다 끝나면 문서를 고친다"), `tasks/*.md`의 "정한 것"
  - 코드(정본):
    - `packages/protocol/jobs/{values,jobs}.ts`, `packages/protocol/events/transient.ts`의 `JobChanged`
    - `packages/core/jobs/{ports,schema,store,schedule,commands,reads,due,scheduler,agent-tools}.ts`
    - `packages/core/main/daemon/wiring/{jobs,jobs-registration}.ts`, `packages/core/main/daemon/assembly.ts`(WIRINGS 순서)
    - program caller: `packages/protocol/apps/calls/caller.ts`, `packages/core/apps/calls/{caller,gate,service}.ts`, `packages/core/main/daemon/agent-domains.ts`, `packages/core/apps/runtime/entrypoint/wire.ts`
    - run의 job 칸: `packages/protocol/runs/runs.ts`, `packages/core/runs/{service,ports}.ts`, `packages/core/main/daemon/wiring/runs.ts`
    - instance의 시작한 쪽: `packages/protocol/workflows/instances.ts`의 `startedBySchema`, `packages/core/workflows/service.ts`
    - tool 목록: `packages/core/agent-roles/tool-lists.ts`의 `JOB_TOOL_NAMES`
    - 화면: `packages/shell/renderer/desktop/settings/jobs/`, `packages/shell/renderer/desktop/connection/waiting/`(job hold card), `packages/shell/renderer/workspace/core-source.ts`(job 제목 붙이기). project 사이드바 panel(`sj-shell-jobs-sidebar`)은 같은 때 만들고 있다. 그 brief(`tasks/sj-shell-jobs-sidebar.md`)의 "정한 것"으로 쓴다.
  - 고칠 문서 지금: 위 소유의 file들, `project-docs/issues/job.md`
- 계약: 없음(문서만 고친다)

## 할 일

1. **`architecture/job.md`(새).** `run.md` 꼴로 쓴다. 담을 것:
   - job이 무엇인가(주기 `every`·`at`, 할 일 하나 `agent_run`·`tool_run`·`workflow_start`, 놓친 차례 정책 `run`·`hold`, `title`), 만드는 쪽과 고치는 쪽(agent만 만들고, agent는 자기가 만든 것만 고치고 지우며, 사람은 모두 고치고 끄고 지운다), 계약·규칙·끼우는 곳의 path.
   - 흐름 그림: job tool/route → `jobs` 표 → scheduler 바퀴(`open`으로 끝난 instance 닫기 → `job.claim_due` → `starter.start` → `job_run.started` → run 기다려 `job_run.ended`) → timer. wake는 job command의 commit 뒤 할 일(`JOBS_CHANGED_TOPIC`)이 `JobChanged`를 내고 scheduler를 깨운다.
   - 지키는 것: 언제 도나(lophn이 켜져 있을 때만, 1시간 상한, 최소 1초), 놓친 차례(몇 번이든 한 번, `missed_count`, 도는 중 꺼져 끊긴 차례도 놓친 차례, 다시 켠 job은 새로 셈), 겹침(`job_runs` 표 하나로, 앞 차례가 `queued`·`running`이면 `skipped(overlap)`, unique index 둘), hold(`held` 줄 하나에 접기, 제때 온 차례가 `superseded`로 닫음, [Start now]의 `conflict`), 서머타임(없는 시각은 건너뛴 직후, 두 번 오는 시각은 첫 번째 한 번, `at` 없는 `Nd`는 고정 길이), 할 일마다 시작(agent_run은 `agent_resolved`로 늘 새 session, tool_run은 program caller, workflow_start는 `{kind: "job", job}`), 끝(run은 `waitRun`, instance는 다음 바퀴가 상태를 읽어 `ended`→done·`stopped`→cancelled, program은 instance의 끝을 판정하지 않는다), 켤 때(`startup` claim이 남은 줄을 `interrupted`로 닫음, workflow_start의 running 줄은 둔다), 지우기(job과 job run을 지우고 도는 것은 끝까지 돈다), 자동 재시도 없음, job run 상태 여덟과 `reason` 값.
   - 권한: job tool은 lophn·Project Manager·App Engineer, Operator는 받지 않는다. tool_run은 만든 agent의 지금 할당(unattended)과 domain 거르기로 판정하고 막히면 `denied`(`gate_blocked`). job이 부른 agent도 job을 만들 수 있다(막지 않는다).
   - 화면: Settings › System › Scheduled jobs(모든 job), project 창 activity bar의 Scheduled jobs panel(그 project와 걸린 job과 그 규칙), 대기 목록의 hold card(셋째 read source), run 줄과 instance 줄의 job 제목(`job.list`로 붙인다, 지운 job은 제목 없음).
   - 왜 이 모양인가: scheduler를 기록 event나 Bus에 얹지 않는 이유(`event.md`), 다른 module의 표를 SQL로 읽지 않아 workflow job run은 scheduler가 닫는 이유, program caller를 wire에 따로 둔 이유, `revision`·`compare`가 없는 이유, place를 칸으로 두지 않는 이유, cron을 쓰지 않는 이유.
   - 알려진 미완은 `project-docs/issues/job.md`를 가리킨다.
2. **`architecture/layers.md`.** feature module 목록에 `jobs`를 더한다(runs·workflows와 같은 자리, 같은 규칙: lophn-agent와 다른 feature module을 import하지 않고 port로 받는다).
3. **`architecture/app-call.md`.** 부르는 쪽에 `program`(job run이 tool을 부를 때, core 안 run 연산만 만든다)을 더하고, 판정(만든 agent의 할당 unattended + 그 agent의 tool 목록에 뜰 tool인가: 공개 tool이거나 맡은 domain의 tool)과 막힐 때의 기록을 쓴다. 앱 process의 caller parser(`wire.ts`)가 protocol schema의 손 사본이라 네 종류를 같이 받아야 한다는 것도 적는다.
4. **`architecture/run.md`.** run 기록의 `job` 칸(job이 연 run만 값), core 안 시작 `RunService.start(input, origin?)`와 `agent_resolved` 갈래, origin이 있는 tool run은 program caller로 부르는 것, 화면에서 job run 줄은 이름 자리에 job 제목을 보이는 것. "켤 때"에 job 쪽 끊긴 차례는 job이 놓친 차례로 친다는 한 줄과 `job.md` 가리키기.
5. **`architecture/workflow.md`.** 시작한 쪽 `started_by`가 사람 또는 job(`{kind: "job", job}`), job은 `StartWorkflow` route가 아니라 core 안 `workflowService.start`로 시작한다는 것, instance 줄과 머리의 job 제목. "시작은 사람만" 같은 문장이 있으면 고친다.
6. **`architecture/event.md`.** "program은 agent를 부르지 않는다" 근처에 사람이 시킨 job의 차례(agent가 만들고 사람이 켜 둔 job이 정해진 때 agent를 부르는 것)를 예외가 아닌 사람이 시킨 일로 적고, scheduler를 Bus에 얹지 않는다는 것, `JobChanged`가 남지 않는 event라는 것을 적는다.
7. **`architecture/approval.md`.** unattended를 싣는 곳에 job을 더한다(job이 연 agent run의 turn, job의 tool 호출은 만든 agent의 할당을 unattended로 판정).
8. **`products/AGENT-ROLE.md`.** job이 agent를 부르는 때(정해진 때, 늘 새 session, unattended), job tool 넷과 받는 role, "자기가 만든 job만 고친다".
9. **roadmap.** `headless-schedule.md`에서 land된 job 부분("무엇을 만드나" 2, 정한 것 가운데 이 계획이 한 것, 단계의 job)을 지우고, 남는 것(flow, 따로 필요한 것, 정할 것 가운데 남은 것)만 둔다. 머리의 상태 줄에 job이 계획 `schedule-job`으로 land했고 동작은 `architecture/job.md`라고 쓴다. `workflow.md` "남은 일" 4를 지우고 번호를 맞춘다. 다른 문서가 지운 절을 가리키면(`grep -rn "headless-schedule.md" project-docs`) 고친다.
10. `project-docs/issues/job.md` 머리 줄 끝에 ``. `project-docs/architecture/job.md` ``를 더한다.
11. 확인: `deno task check:full`(docs check가 path와 fmt를 본다). 문서에 쓴 file path와 이름은 모두 `grep`이나 `ls`로 있는지 본다.

## 정한 것

- 말: 개발자 영어 단어를 그대로 쓴다(job, job run, scheduler, hold, claim). 번역어를 만들지 않는다.
- task id, commit hash, 계획 이름 밖의 요구 ID를 문서에 쓰지 않는다. roadmap 상태 줄에는 계획 이름만 쓴다.
- 코드와 brief가 다르면 코드가 맞다. 다른 곳은 보고에 적는다.

## 끝남

- `deno task check:full`이 통과한다.
- `grep -rn "남은 일" project-docs/products/roadmap/workflow.md` 근처에 job이 instance를 시작하는 항목이 없다.
- 위험 test: 없음(문서).

## 보고

- 바꾼 file, 통과한 check
- 코드와 brief(또는 계획 README)가 달라 코드대로 쓴 곳
- 문서에 쓰려다 코드에서 확인하지 못한 것
- **무겁게 짠 것**, **알려진 미완 동작**: 없으면 "없음"

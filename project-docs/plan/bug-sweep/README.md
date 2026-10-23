# bug-sweep: job 고치기와 작은 bug 묶음

- **목표:** 열린 이슈 가운데 고칠 안이 정해진 작은 bug를 고친다.
  - job: 잠든 사이 늦은 차례를 놓친 차례로 치고, 끝 기록이 실패한 job run이 그 job을 막지 않게 한다.
  - 사람 눈에 보이는 것: 아무 일도 안 하는 붙이기 단추, 다른 desk의 terminal이 연 URL, workflow 그림의 되돌아가는 선.
  - agent와 권한: 끈 MCP server의 tool, shell 물음 거절 이유.
  - 앱 만들기: release 준비의 handler 실패 이유, 앱 폴더의 의존 풀기.
  - 개발: agent runtime stderr, shell이 문자열로 부르는 route.
- **재료:**
  - 이슈: `project-docs/issues/job.md`(둘 다), `activation.md`(둘 다), `approval.md`(둘 다), `shell.md`(둘 다), `platform.md`, `ui-kit.md`, `workspace-layout.md`의 "다른 desk에 있는 terminal이 연 URL". 이슈마다 "지금", "고치려면"의 추천안, "정한 것"이 이 계획의 요구다.
  - architecture: `job.md`, `activation.md`, `approval.md`, `agent-definition.md`(tool 목록 고정과 notice), `browser-tab.md`(bridge), `workspace-layout.md`(desk), `ui-kit.md`, `testing.md`
  - `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`
- **범위 밖:**
  - 고칠 때를 미룬 이슈: desk를 떠났다 오면 browser page가 다시 load됨, workflow 폴더 이름을 바꾸면 desk가 합쳐짐(둘 다 "실제로 불편할 때"), docx 읽기("필요해지는 형식 하나씩"), codex hook trust(coding agent 연결 보류), `shell.run`의 file 범위(사람이 2026-10-19 "일단 그대로").
  - 붙이기 기능 자체. 단추를 지우고 기능을 만들 때 다시 더한다.
  - 새 e2e와 eval. 있는 e2e는 land가 돌리고 통과해야 한다.
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `bs-`로 시작한다. task끼리 기대지 않아 wave 하나다.
- **시작 조건:** 없다. `schedule-job`이 land했다(main `ccb8133ec`).

## task

| id | 이슈 | 고치는 안 |
|---|---|---|
| `bs-jobs` | job 둘 | 10분 넘게 늦은 차례는 놓친 차례, 최대 잠 1분, 바퀴마다 열린 run 줄의 run을 한 번 읽어 끝났으면 닫기 |
| `bs-release-probe-reason` | activation 첫째 | 진입점의 409 본문에 빠진·더해진 tool 이름, `probeChild`가 그 글을 reason에 싣기 |
| `bs-app-import-map` | activation 둘째 | 템플릿 task가 돌기 전에 `deno.json`에서 dev import map을 다시 쓰기 |
| `bs-agent-gate` | approval 둘 | MCP `call()`이 부를 때 지금 층을 읽어 꺼진 server를 거절, 거절 이유를 tool 결과에 싣기 |
| `bs-attach-remove` | shell 첫째 | 붙이기 단추, `onAttach`, host의 `attach`, wording key를 지우고 wireframe 맞추기 |
| `bs-route-string-check` | shell 둘째 | `tools/check-source.ts`에 shell의 문자열 route 호출이 protocol route 목록에 있는지 보는 규칙 |
| `bs-runtime-stderr` | platform | agent runtime slot에 `onStderr`를 걸어 core stderr에 접두를 붙여 쓰기 |
| `bs-graph-back-edge` | ui-kit | 되돌아가는 edge를 node 줄 위 여백으로 돌려 그리기 |
| `bs-bridge-other-desk` | workspace-layout 둘째 | terminal을 모든 desk에서 찾고 그 terminal의 desk에 browser 탭 열기 |

## 정한 것

이슈의 "정한 것"과 추천안을 따른다. 아래는 이 계획에 걸려 더 정한 것이다.

- **늦은 차례(사람, 2026-10-23. planner 추천).** 차례 시각보다 10분 넘게 늦게 처리한 차례는 켤 때와 같이 놓친 차례다. `hold`면 card로 묻고 `run`이면 한 번 돈다. 10분 안이면 지금처럼 제때 온 차례다.
- **최대 잠 1분(agent).** scheduler가 다음 차례까지 거는 timer의 상한(`HOUR_MS`)을 1분으로 줄인다. 잠에서 깬 뒤 바퀴가 늦게 도는 것(이슈 "더해")을 shell의 깨어남 알림 없이 막는다. 할 일이 없는 바퀴는 읽기뿐이라 싸다. 이름도 뜻에 맞게 바꾼다.
- **끝 기록 다시 하기(agent).** 바퀴마다 이미 `closeFinished`가 workflow 줄을 instance 상태로 닫는다. 같은 자리에서 `running`이고 `run`이 있는 줄의 run을 한 번 읽어(지금 `waitRun` 말고 읽기) 끝났으면 `job_run.ended`를 다시 적는다. 다시 부르기 loop는 두지 않는다.
- **handler 실패 이유는 두 번째로 고치는 bug다.** 그래서 이번에는 진입점의 거절까지 지나는 test를 둔다(archived guard는 가짜 probe로 돌아 이 길을 못 봤다).
- **문자열 route 규칙이 지금 깨진 호출을 찾으면** 그 task는 남의 file을 고치지 않고 보고한다. lead가 fix task로 돌린다.

## 위험 test

`write-test` 기준으로 셋만 둔다. 화면, 문구, layout, 내부 구현은 test하지 않는다.
- `bs-jobs`: 켜진 채 10분 넘게 늦은 `hold` 차례는 돌지 않고 `held` 줄이 된다. 10분 안이면 돈다. 주입한 Clock으로 돈다.
- `bs-release-probe-reason`: handler 없는 tool을 선언한 앱의 준비 실패 reason에 그 tool 이름이 있다. 진입점의 거절을 지난다.
- `bs-agent-gate`: session 도중 끈 MCP server의 tool은 그 session에서 부르면 거절된다.

## lead가 할 일

- merge 때:
  - `bs-attach-remove`, `bs-bridge-other-desk`, `bs-graph-back-edge`를 merge할 때 `deno run -A packages/shell/renderer/build.ts`를 돈다(`check:full`이 renderer build를 보지 않는다).
  - wording key를 지운 task 뒤에는 wording 생성을 다시 돈다.
  - task가 고친 이슈를 `issue` skill대로 archived로 닫는다(`closed`, `guard`, `닫음`).
- 다 끝나면:
  - architecture: `job.md`("지키는 것"의 놓친 차례와 hold, scheduler 잠), `approval.md`와 `agent-definition.md`(끈 MCP server는 session 도중에도 부를 때 막힌다), `activation.md`(handler 실패 reason), `ui-kit.md`(GraphDiagram의 되돌아가는 edge), `browser-tab.md`(다른 desk의 terminal), 그 밖에 task가 바꾼 동작과 다른 문장.
  - changelog 열린 판 `project-docs/products/change-log/0.7.0.md`에 항목을 덧붙인다.
  - 계획 폴더를 지운다.
- 사람에게 묻는 것: AGENTS.md "사람에게 묻는 것"(push 등). 그 밖은 planner에게 묻는다.

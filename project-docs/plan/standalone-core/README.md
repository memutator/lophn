# standalone-core

- 목표: core를 shell 수명에서 떼고 shell·CLI가 같은 control socket과 ensure로 붙게 한다. 화면 없이도 job이 돈다.
- 재료: `project-docs/products/roadmap/standalone-core.md`의 정한 것, `project-docs/products/roadmap/platform-ipc.md`, `project-docs/architecture/{job,coding-agent,platform,event,layers,testing,run,approval}.md`, boundary·module catalog.
- 범위 밖: OS service 등록, 원격·다른 사용자 연결, core의 crash 재시작 감독, API의 unix socket 전환, shell 없는 알림.

## 정한 것

- roadmap의 정한 것 1–8은 그대로다. core instance lock과 shell single-instance lock은 서로 다른 것을 지킨다.
- Quit는 shell만 닫고 core는 idle-exit로 끝난다. 모두 끄는 `Stop lophn`을 따로 둔다. (사람이 추천을 받음, 2026-11-08) job을 shell 수명에서 떼기 위해서다.
- CLI도 ensure로 core를 띄운다. `lophn core stop`은 띄우지 않고 도는 core만 끈다. (사람이 추천을 받음, 2026-11-08) 화면 없는 실행과 명시 종료가 필요해서다.
- 사람 결정 handle은 control `connect {client: shell}`이 주는 shell 전용 capability로만 등록한다. HTTP user token, agent·worker credential, route, CLI에는 등록 길이 없다. OS peer 신원 검증은 하지 않는다. (planner) 같은 사용자 process(앱·flow·터미널 agent)는 이미 막지 않고(`architecture/layers.md:42`) `secrets.json`을 바로 읽을 수 있어 peer 검증이 더 막는 것이 없고, Node에 peer credential API가 없어 3 OS native addon이 든다. Hermes도 socket ACL을 경계로 쓴다.
- user credential의 `conditions.process`는 남기되 shell은 `electron-main`, CLI는 `cli`로 나눈다. (agent) registry가 user의 process 존재를 요구하고 값 자체를 `electron-main`으로 비교하는 곳은 없어서다.
- test core는 자기 pid를 가진 detached process로 띄우고 `ready` 뒤 identify·connect, 정상 종료는 control stop, crash는 그 pid의 SIGKILL로 한다. 기존 home별 child 확인과 `keep`는 남긴다. (agent) stdin 수명 없이도 자기 process만 정리해야 해서다.
- `run/user-token`·`run/location.json`은 runtime file이라 data migration이 필요 없다. lock을 잡은 core가 잔여 file을 지우고 읽기·쓰기 계약을 없앤다. ledger·설정·agent 파일 모양은 바꾸지 않는다. (agent)

## task

**wave 1은 `platform-ipc` 전체가 land한 뒤에만 연다.** `pipc-` task나 socket-dir 공용 구현 file은 이 계획이 소유하지 않는다. lead가 실제로 land한 공용 export를 확인해 control socket이 import하게 한다. 외부 선행은 status 도구가 판정하지 않으므로 lead가 직접 막는다. 같은 core·protocol file을 다시 만지는 task는 병렬로 돌리지 않는다.

| wave | id | 하는 일 |
|---|---|---|
| 1 | `score-control` | control 계약·서버, shell capability 경계, 공용 ensure를 더한다 |
| 2 | `score-idle` | module별 일 읽기와 client 집계로 10분 idle-exit를 붙인다 |
| 3 | `score-shell` | shell 연결·재연결, Quit/Stop lophn, core-only autostart를 옮긴다 |
| 4 | `score-cli` | CLI 자격·주소 찾기·ensure와 core stop을 옮긴다 |
| 5 | `score-launchers` | test support·dev·CI·doctor·설치 검증·eval launcher를 옮긴다 |
| 6 | `score-cleanup` | 마지막 parent pipe·hello·runtime metadata 정의와 임시 전환을 지운다 |

## lead가 할 일

- `project-docs/plan/tools/lead/lead.sh standalone-core`가 연 worktree에서만 진행한다. 새 subprocess·Worker·서버 test와 E2E는 만들기 전에 사람에게 묻는다. 자세한 후보는 brief에 있다.
- review에서 사람 결정 handle 등록 길이 control의 shell capability 하나뿐인지 본다(HTTP·Gateway·agent route·CLI에 길이 없고, CLI는 `client: shell`을 보내지 않는다).
- protocol은 쓰는 곳을 같은 변경에서 맞추고 `v2`를 만들지 않는다. 옛 소비자를 먼저 옮기고 정의는 마지막에 지운다. 중간 작업에 필요한 옛 wiring은 전환용일 뿐이며 최종 land에는 남기지 않는다. task마다 `npm run check`를 통과시킨다.
- 공용 등록 목록은 lead가 맞춘다: `packages/protocol/**/mod.ts`, `packages/core/main/daemon/assembly.ts`, `packages/core/main/daemon/wiring/context.ts`, `packages/core/install-and-update/mod.ts`, `packages/cli/commands/mod.ts`, 필요한 i18n catalog·module catalog. 새 SDK·지침 변경은 이 계획에 넣지 않는다.
- 동작을 land하는 같은 변경에서 architecture를 갱신한다: `project-docs/architecture/job.md:66`, `project-docs/architecture/coding-agent.md:23` 및 자격·host 수명 설명, `project-docs/architecture/platform.md`의 core 종료·data root·autostart, `project-docs/architecture/run.md:98-123`, `project-docs/architecture/testing.md:50-51`, `project-docs/architecture/app-notice.md:80`. shell 없는 toast는 재생하지 않는다(`project-docs/architecture/event.md`).
- `project-docs/boundary-catalog.yaml`의 `coding-agent-cli-interface`(user-token 설명), `child-supervision-protocol`(shell↔core와 core↔child 구분), 새 control 계약과 module notes를 맞춘다. `project-docs/architecture/approval.md`에는 HTTP/agent 자격과 shell capability가 다른 이유를 기록한다. `project-docs/products/roadmap/headless-schedule.md`의 상주 daemon 제외 결정을 고치고 changelog에 이번 결정을 남긴다.
- 마지막에 `hello|parent pipe|parent가|user-token|location.json`으로 architecture·catalog를 다시 찾는다. agent runtime·앱·worker의 감독 pipe는 지우지 않는다. `status.py standalone-core build`, check, 필요한 renderer build와 사람이 허락한 검증 결과를 확인한다.

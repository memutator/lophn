# failure-hardening

- 목표: 다른 harness 15개가 이미 겪고 막아 둔 실패 가운데 lophn에 없는 것을 고친다. 깨진 입력 하나, 죽은 자식 하나, 조용히 끝난 Worker 하나가 앱 전체나 session을 멈추지 않게 하고, 실패했을 때 사람과 model이 원인을 알게 한다.
- 재료:
  - `project-docs/products/roadmap/failure-hardening.md` (넣지 않은 것과 이유)
  - `research_notes/error-handling-verify/{agent-loop,tools-session,runtime,terminal,harness-gui}.md` (main `25edb533d`에서 항목마다 코드를 열어 확인한 것: 실패 경로, 고칠 file, 크기. commit하지 않은 file이라 main checkout의 절대 경로로 읽는다)
  - 조사 보고서 `../harness-lab/_report/error-handling/` (저장소 밖. 업계 기준과 다른 harness의 구현)
  - `project-docs/architecture/{platform,agent-definition,approval,harness-gui,terminal-agent,coding-agent,extension}.md`
- 범위 밖: `project-docs/products/roadmap/failure-hardening.md`의 "계획에 넣지 않은 것". task가 그 항목을 같이 고치지 않는다.
- 단위: `loop`(run-loop), `provider`, `tools`, `core`(daemon, 저장소, agent runtime), `shell`(shell main의 core 연결과 extension spawn), `gui`(harness-gui adapter), `term`(터미널 탭과 hook 설치). 소유는 brief가 정한다.
- 순서: wave 1의 21개는 소유가 겹치지 않아 한꺼번에 띄울 수 있다. wave 2의 `loop-stop`은 wave 1이 모두 합쳐진 뒤 띄운다.

항목 번호는 조사 보고서의 영역별 번호다(`loop`=lophn-agent-loop, `tools`=lophn-tools-session, `rt`=lophn-runtime, `term`=lophn-terminal, `gui`=lophn-harness-gui).

## 정한 것

- **범위는 대조에서 그대로 있다고 확인된 `표준`·`흔함`(G1)과 lophn 고유(G2) 항목이다.** 모범 사례(G3)는 같은 file을 고치는 김에 한두 줄로 되는 것만 넣는다(atomic write, harness stderr의 secret 가리기). (agent)
- **shell은 core의 pipe 방어를 import하지 않고 spawn하는 곳에 직접 쓴다.** `tools/check-deps.ts`가 shell → core를 막고, `packages/base`는 `node:` import를 못 쓴다. 한 줄(`stream.on("error", ...)`)이라 옮기지 않는다. spawn하는 곳은 둘뿐이다(`nodeSpawn`, terminal supervisor). (agent)
- **harness-gui는 adapter file마다 task 하나다.** stream 안전, timeout, 수명이 모두 네 adapter(2,800~3,500줄)를 고쳐서 관심사로 나누면 모든 task가 같은 file에서 부딪힌다. 공통 실패 꼴(`failure.ts`)은 만들지 않고 ACP error `code`에 공통 오류 코드 일곱을 쓴다. (agent)
- **ledger writer가 죽으면 core가 `exit(1)`한다.** shell이 core를 다시 띄운다. ready 전에 죽으면 기동 실패로 돌려줘 시작 실패 화면이 바로 뜬다. writer만 다시 띄우는 길은 writer 안 기억(준비한 blob, confirmation handle)을 잃고 새 core 상태와 화면이 필요해 하지 않는다. graceful shutdown은 shell이 다시 띄우지 않으므로 쓰지 않는다. 죽기를 되풀이하면 `shell-core-connection`의 재시작 상한이 시작 실패 화면으로 보낸다. (agent)
- **reset 정보가 없는 429는 quota 소진이 아니라 일시 제한이다.** 2초, 4초로 두 번 다시 보내고 그래도 429면 지금처럼 끝난다. 구분하는 harness가 9/9다. 잃는 것은 정말 소진된 계정에서 요청 둘이다. (agent)
- **같은 tool 호출이 같은 실패로 세 번 이어지면 네 번째부터 돌리지 않고 model에게 방법을 바꾸라고 답한다. 여섯 번이면 turn을 `repeated_tool_failure`로 끝낸다.** 바로 이어진 똑같은 호출만 본다. "기본 상한 없음"(change-log 0.14)과 부딪히지 않는다: 진행하는 turn은 건드리지 않는다. (agent)
- **빈 응답은 한 번 되묻고, 또 비면 turn을 `no_answer`로 끝낸다.** (agent)
- **Stop 뒤 마지막 tool round는 이력에 남긴다.** 멈춘 turn에 이력만 싣는 checkpoint를 한 번 받는다. 다음 turn의 model이 방금 쓴 file을 모르고 다시 쓰지 않게 한다. (agent)
- **기록하지 못한 tool 호출은 읽기만 돌린다.** model 호출은 이미 기록 실패면 보내지 않는다. 같은 규칙이다. (agent)
- **`file.grep`과 `file.glob`은 Worker에서 돌리고 10초에 끊는다.** 끊기면 model에게 pattern이 너무 오래 걸렸다고 답한다. ripgrep은 lophn에 없고 넣으려면 OS별 포장과 pattern 문법 차이(Rust regex)가 따라온다. 줄 길이 상한만으로는 `(a+)+$`를 못 막는다. (agent)
- **MCP `isError` 본문은 감싸지 않고 model에게 준다.** `project-docs/architecture/approval.md`가 MCP 결과를 감싸지 않기로 했다. (agent)
- **extension tool 호출의 기한은 5분이다.** browser 호출(30초)보다 길게 잡는다. manifest에 tool별 기한 칸은 만들지 않는다. (agent)
- **저장소 오류는 원인(disk full, locked, corrupt, io)을 오류 글에 싣는다.** 화면을 새로 만들지 않고 지금 그 글이 보이는 곳에 그대로 보인다. corrupt면 writer를 fault로 만들어 core가 끝나고 다음 기동이 지금의 시작 실패 화면으로 간다. (agent)
- **blob 부속 기록은 본문이 없다고 확인된 것만 지운다.** 지우는 곳은 멈출 때 도는 maintenance뿐이고(주기 GC는 관찰만 한다) 30초 안에 끝나야 해서 한 번에 지우는 수를 묶는다. 이슈 `blob-metadata-left-after-gc`를 닫는다. (agent)
- **터미널 env 청소는 이름 허용 목록을 둔다.** `SSH_AUTH_SOCK`, `XAUTHORITY`, `GIT_AUTHOR_*`, `GIT_COMMITTER_*`, proxy 변수(`HTTP_PROXY` 등)는 남긴다. local port 값을 지우는 규칙은 그 밖의 이름에 그대로 둔다(lophn endpoint가 새지 않게). (agent)
- **login shell env는 `nodeSpawn`이 가진다.** headless harness도 같은 PATH를 얻고, harness-gui의 자기 사본과 "실패를 영영 기억하는" cache가 없어진다. 느린 rc file이면 extension이 최대 5초 늦게 뜬다(앱 시작은 막지 않는다). (agent)
- **종료 순서의 전체 기한은 90초다.** 단계별 기한의 합(65초)보다 길어야 정상 종료를 자르지 않는다. (agent)
- **core 재시작 상한은 ready 뒤 60초 안에 다섯 번이다.** 넘으면 지금의 시작 실패 화면에 멈춘다. (agent)
- **agent runtime 감독이 포기하면 log를 남기고 60초 뒤 한 번 다시 띄운다.** 사람에게 알림은 띄우지 않는다. 맞는 알림 종류가 없고 새로 만들면 protocol이 바뀐다. (agent)
- **실패 문구는 원인(사용량 한도, 로그인 거절, rate limit)을 말하고 [Retry]는 그대로 둔다.** 결제하거나 key를 고친 사람이 그 자리에서 다시 할 수 있어야 한다. quota 상태를 남겨 보내기 전에 막는 일(loop #16)은 넣지 않았다(roadmap). (agent)

## 사람이 정할 것

1. **`tools-grep`에 Worker를 띄우는 test 하나를 새로 써도 되는가.** AGENTS.md가 Worker·subprocess test는 묻게 한다. "끝나지 않는 pattern(`^(a+)+$`)이 기한 안에 돌아온다"이고, 이 task가 지키려는 것 그 자체라 추천한다. 답이 오기 전에는 test 없이 간다(brief가 그렇게 쓰여 있다). 허락되면 lead가 worker에게 알린다.

`core-lifetime`은 Worker test를 쓰지 않는다. writer Worker를 가짜로 바꿔 끼울 길이 없고 test만을 위해 만들지 않는다. `ext-spawn`, `runtime-children`도 지키는 동작이 진짜 자식 process에서만 보여 test가 없다. 이 셋은 land 뒤 change-log `checklist`의 손 확인으로 본다.

## task

| wave | id | 단위 | 선행 | 고치는 것 |
|---|---|---|---|---|
| 1 | `loop-turn` | loop | 없음 | 잘린 응답 hint(loop #19), 빈 응답(#20), provider 밖 실패의 문구(#41), 재시도 jitter와 연결 끊김 사다리(#8, #11), 고정 prompt가 예산을 넘을 때 헛 compact(tools #9), 없는 tool 이름 hint(#10), 같은 실패 호출 반복(#12, loop #31), 기록 못 한 tool 호출(#22, rt #30) |
| 1 | `loop-driver` | loop | 없음 | `FinishTurn` 실패로 `running`에 남는 turn(loop #2b), compaction 실패 되풀이(tools #3), 요약 호출 재시도(#4), 재시작 때 열린 tool_call 닫기와 다음 turn에 알리기(#23) |
| 1 | `provider-error-text` | provider | 없음 | 실패 원인 문구(loop #38) |
| 1 | `provider-failures` | provider | 없음 | 429 분류(loop #7), overflow 분류(tools #2), refresh 실패의 일시·영구 구분(loop #13b), 요청 중 401에 갱신 뒤 한 번 재시도(#12) |
| 1 | `mcp-failures` | tools | 없음 | 큰 MCP 결과(tools #7), `isError` 본문(#14), 보낸 뒤 실패의 결과 불명(#19), stdio server 죽음 감지(#37), 재연결 횟수 reset(#38) |
| 1 | `tools-grep` | tools | 없음 | `file.grep`·`file.glob`의 regex를 Worker와 기한으로(tools #25) |
| 1 | `tools-file-write` | tools | 없음 | 인코딩·줄끝·BOM 보존(tools #28), atomic write(#29), 쓰기 크기 상한과 오류 글(#30) |
| 1 | `core-lifetime` | core | 없음 | writer Worker 죽음(rt #28), 종료 순서의 전체 기한(#15), 비정상 종료 표지(#16) |
| 1 | `storage-errors` | core | 없음 | 저장소 오류 원인(rt #27, #33), corrupt면 writer fault(#26 b) |
| 1 | `blob-gc` | core | 없음 | blob 부속 기록 짝 삭제와 고아 sweep(rt #35, #36) |
| 1 | `runtime-children` | core | 없음 | agent runtime이 끝날 때 `shell.run` 자식 정리(rt #4), shell timeout의 결과 불명(tools #19), supervisor 포기 뒤 알림과 재시도(rt #7) |
| 1 | `core-smalls` | core | 없음 | 서로 무관한 작은 것 셋: idle-exit가 도는 turn을 본다(rt #32), git 없음 오류(#23), extension tool 호출 기한(tools #40, #16) |
| 1 | `shell-core-connection` | shell | 없음 | core 재시작 상한(rt #8), lock 전에 core를 건드리는 두 번째 shell과 Quit 중 ensure(#12, 이슈 둘) |
| 1 | `ext-spawn` | shell | 없음 | 자식 pipe `error`(gui #11, term #9), exit와 stdio drain(gui #12), 종료 때 자식 정리(#20), spawn 실패 원인(gui #1, term #3), login env(gui #2, term #2), `start` 실패와 `stop` 기한(gui #7, #19, #9의 `index.ts` 쪽) |
| 1 | `gui-claude` | gui | 없음 | 입력 오류 표시(gui #35), 입력 줄 막힘(#30), rewind·fork 실패 뒤 상태(#26), 요청 기한(#14), `stop` 기한(#19), 시작 실패 때 자식 leak(#7), stderr secret(#34) |
| 1 | `gui-codex` | gui | 없음 | frame 파싱 예외(gui #9), 요청·기동 기한(#14, #6), 실패 뒤 자식 정리(#17), stderr secret(#34) |
| 1 | `gui-omp` | gui | 없음 | frame 꼴 예외와 떠 있는 promise(gui #9), TUI로 넘길 session id(#27), 기동·요청·`stop` 기한(#6, #14, #19), 큰 frame(#10), stderr secret(#34) |
| 1 | `gui-opencode` | gui | 없음 | 시작 실패 때 자식 leak(gui #7), SSE 재연결(#15)과 그 뒤 실패 정리(#17), 요청 기한(#14), 큰 frame(#10), stderr secret(#34) |
| 1 | `term-host` | term | 없음 | host 안 예외 격리(term #10), main이 죽으면 host도 끝난다(#11), 종료 때 PTY 자식 정리와 죽은 `host-lost` 요청 삭제(#12), PTY spawn 실패 원인(#4), env 청소(#5) |
| 1 | `term-supervisor` | term | 없음 | host pipe `error`(term #9), 요청 기한과 깨진 줄(#8), host 종료 원인 기록(#15), 입력 전달 확인(#35), 거절된 뒤 남은 paste 조각(#36) |
| 1 | `hooks-install` | term | 없음 | harness 설정 file의 atomic write와 순서(term #27), 읽은 뒤 바뀐 설정 덮어쓰기(#28), `lophn hook`의 stdin 기한(#7) |
| 2 | `loop-stop` | loop | `loop-turn`, `provider-failures` | Stop 뒤 마지막 tool round(loop #26), server가 거절한 image를 이력에서 빼기(tools #8) |

## 돌리기 전에

- lead worktree에서 `research_notes/error-handling-verify/`는 보이지 않는다(commit하지 않았다). brief에 필요한 사실은 옮겨 적었다. 더 보려면 main checkout의 절대 경로로 읽는다.
- core type check 하나가 약 2.6GB다. wave 1을 한꺼번에 띄울 수 있지만 `check:full`은 동시에 둘까지라, 기계에 맞춰 나눠 띄운다. 먼저 띄울 것: `ext-spawn`, `gui-codex`, `gui-omp`, `term-host`, `term-supervisor`, `core-lifetime`, `tools-grep`(조사 보고서의 1순위).
- `loop-turn`이 가장 크다(작은 것 여덟과 중간 하나, 하루쯤). 한 번 실패하면 없는 tool 이름 hint(tools #10)와 반복 호출(#12)을 떼어 새 task로 만든다. `gui-opencode`가 길어지면 SSE 재연결 뒤 따라잡기를 이슈로 뗀다.
- `core-lifetime`(writer가 죽으면 core `exit(1)`)과 `shell-core-connection`(재시작 상한)은 같이 land한다. 앞의 것만 올라가면 writer가 계속 죽을 때 shell이 core를 끝없이 다시 띄운다.

## lead가 할 일

- merge 전: test file을 새로 만드는 task가 넷이다(`term-host`의 `main_test.ts`, `tools-file-write`의 `write_test.ts`, `storage-errors`의 `tx_test.ts`, `blob-gc`의 `maintenance_test.ts`). `npm run check`의 flows 단계가 "어느 tests file에도 오르지 않음"으로 멈추고, worker는 project-docs를 고치지 않으니 그 한 가지 실패를 보고한다. lead가 task worktree에서 `project-docs/flows/tests/<group>.yaml`에 줄을 더해 commit한 뒤 `merge.sh`를 돌린다(`flows` skill).
- merge마다: 그 task가 바꾼 동작을 `project-docs/flows/areas/`와 architecture 문서에 맞춘다. 실패 갈래나 오류 code가 생긴 곳이 대상이다.
  - `platform.md`: `core-lifetime`, `shell-core-connection`, `runtime-children`, `storage-errors`, `blob-gc`, `core-smalls`(idle-exit가 일로 치는 것).
  - `agent-definition.md`: `loop-turn`, `loop-driver`, `loop-stop`, `provider-failures`, `provider-error-text`, `tools-*`, `mcp-failures`.
  - `harness-gui.md`: `ext-spawn`, `gui-*`(규칙 4, 7, 9). `extension.md`: `ext-spawn`.
  - `terminal-agent.md`·`coding-agent.md`: `term-*`, `hooks-install`.
- 이슈 닫기: `failed-finish-leaves-turn-running`(`loop-driver`), `blob-metadata-left-after-gc`(`blob-gc`), `second-shell-touches-core-before-lock`·`quit-ensure-restarts-core`(`shell-core-connection`).
- 다 끝나면: change-log 항목(`project-docs/products/change-log/0.23/failure-hardening.yaml`)을 쓴다. 결정은 위 "정한 것"(`by: agent`)과 사람이 정한 것. `checklist`에 설치한 앱에서 볼 것을 적는다(터미널 탭에서 `ssh-add -l`이 되는가, core를 kill하면 다시 뜨고 다섯 번이면 시작 실패 화면인가, harness GUI에서 CLI를 kill해도 앱이 사는가). 계획 폴더를 지운다. `project-docs/products/roadmap/failure-hardening.md`는 남긴다.
- SDK 판과 앱 agent 지침(guide, 내장 skill, template)은 이 계획이 바꾸지 않는다. task가 바꿔야 한다고 보고하면 `sdk-note` skill을 따른다.

# S6. coding agent 연결

상태: **확인됨** (2026-10-15). 2장의 결정 다섯과 12장은 사람이 확인했다(docs-review).

## 1. 범위

App Engineer가 ticket을 coding agent에게 맡기고, 메시지를 주고받고, 완료 보고로 닫히는 길이다. call의 봉투와 상태는 S3, agent event는 S1, ticket과 claim의 상태는 core-app-tickets 요구가 맡고, 여기는 harness와 이어지는 쪽을 적는다.

- 요구가 이미 정한 것(req-1050~1101, 1491, coding-agent-cli)은 되풀이하지 않고 ID로 건다.
- 조사: `../research/orca.md`, `paseo.md`, `events-*.md`.

## 2. 한 줄과 결정

통로는 CLI 하나다. App Engineer가 맡기면 lophn이 그 앱 하나 범위의 token을 만들고, harness adapter가 터미널 탭에 TUI를 앱 source 폴더에서 띄운다. coding agent는 CLI로 ticket을 claim하고, 메시지를 보내고, 완료를 보고한다. lophn은 harness의 hook으로 상태를 받고, App Engineer의 메시지는 idle일 때만 PTY에 넣는다.

| # | 결정 (사람 확인, 2026-10-15) | 이유 |
|---|---|---|
| 1 | harness가 turn 끝을 알리지 못해 상태가 unknown이면 App Engineer의 메시지를 넣지 않고 실패로 돌려준다. 첫 prompt만 넣는다. Settings에 제품마다 이것을 보인다 | program은 결정적으로만 판정한다. 화면을 읽어 짐작하지 않는다(orca는 짐작한다) |
| 2 | 앱 하나에는 coding agent session이 한 번에 하나만 돈다(req-1516). 그동안 온 맡기기는 Router가 앱마다 줄에 세웠다가 앞 session이 끝나면 연다 | 같은 source 폴더에 둘이면 서로 부딪친다. worktree로 나누면 합칠 쪽이 없다. App Engineer는 code를 짜지 않는다 |
| 3 | App Engineer가 coding call을 cancel하면 session을 멈추고 token을 회수한다(claim이 풀림). ticket은 열린 채 남아 다시 맡길 수 있다 | ticket 취소(req-1062)와 다르다. "이 맡기기를 멈춘다"이지 "이 일을 버린다"가 아니다 |
| 4 | coding agent의 권한 mode는 lophn이 정하지 않는다. Settings의 실행 옵션(req-1080)과 harness 기본을 따른다 | coding agent의 tool call은 harness의 일이다(S2 5장). 터미널 탭에 사람이 있다 |
| 5 | harness의 권한 물음은 대기 목록에 보이기만 하고, 누르면 그 session의 터미널 탭으로 focus를 옮긴다. 답은 TUI에서 한다 | harness마다 물음의 모양이 달라 lophn 화면에 답하는 UI를 두면 쓸데없이 깨지기 쉬운 의존이 생긴다. focus 옮기기는 harness와 상관없다 |

## 3. 부품과 소유

| 부품 | 맡는 일 | 지금 코드 |
|---|---|---|
| Harness adapter | 제품마다 4장의 것을 가진다(req-1075) | `packages/coding-agent/` |
| 터미널 탭 | PTY를 열고 adapter가 정한 argv로 process를 띄운다. 입력을 넣는다 | shell |
| Coding token | 앱 하나 범위로 만들고 회수한다(req-1052, 1061, 1063). 범위는 core-server req-0206 | core |
| CLI | core API를 거치는 통로(req-1070, 1200). ticket, 메시지, 완료 보고, hook 받기 | CLI |
| Router | 맡기기와 메시지를 harness transport로 배달한다(S3 7장) | core |
| Reactor | 완료 보고, claim 만료, 보고 없는 끝을 맡긴 App Engineer에게 보내고 call을 닫는다(S1 5장) | core |

## 4. adapter가 갖는 것

| 칸 | 내용 | 근거 |
|---|---|---|
| 찾기 | 실행 파일, version, 로그인 여부. 확인 못하면 확인 못함 | req-1075, 1078 |
| 띄우기 | argv(실행 옵션 포함). shell을 거치지 않고 process를 직접 띄운다. 첫 prompt는 argv로 넘긴다. argv로 못 넘기는 제품은 session 시작 hook을 받은 뒤 PTY에 paste한다. 둘 다 안 되면 맡길 수 없는 제품으로 Settings에 보인다(화면 출력으로 준비를 짐작하지 않는다, 2장 1) | req-1080, 1097, 2026-10-15 결정 |
| skill | 설치 위치. 사람이 고친 파일은 덮지 않는다. 그러려고 lophn이 마지막에 쓴 내용의 hash만 남긴다(receipt의 나머지는 지운다) | req-1054, 1083 |
| hook | 앱 source 폴더 안 harness의 project 설정에 둔다. git에 안 들어가는 local 설정이 있으면 그쪽. 사람이 고친 설정은 skill처럼 덮지 않는다 | `../changes.md`, req-1083. release bundle에는 들지 않는다(core-app-releases) |
| event 매핑 | hook의 이름과 칸을 S1 agent event로 바꾼다(6장) | req-1098 |
| 외부 session ID | hook이나 session 파일에서 실제로 받은 것만 | req-1099 |
| turn 끝 신호 | 있는지. 없으면 2장 1 | 2장 1 |

turn 끝 신호는 조사에서 여섯 제품이 갖고 있다: Claude Code `Stop`, Codex `Stop`·`notify`, Gemini CLI `AfterAgent`, OpenCode `session.status` idle, pi(조사는 `agent_end`, 지금 코드는 일부러 `agent_settled`를 쓴다. 이름은 refactor session이 확인한다), Hermes `on_session_end`(이름과 달리 turn마다 온다). OpenClaw는 설정만으로 알리는 장치가 없고 native plugin의 `agent_end`만 있다(`../research/turn-end-hermes-openclaw.md`, 12장 1).

**hook이 lophn에 닿는 길:** harness가 hook command로 lophn CLI의 hook 명령을 부른다. CLI는 session 환경 변수의 coding token으로 인증하고, stdin JSON을 core에 넘긴다. core가 agent event로 바꾼다. orca(hook script가 POST)와 paseo(env token)도 같다.

## 5. 맡기기

1. App Engineer가 call을 보낸다. 받는 곳은 coding agent, 근거는 ticket 하나, harness와 실행 옵션은 고르지 않으면 Settings 기본이다(req-1080, S3).
2. Router가 그 앱에 끝나지 않은 coding agent session이 있는지 본다. 있으면 새로 열지 않고 그 앱의 줄(메모리)에 세우며 call은 accepted로 기다린다. lophn이 꺼졌다 켜지면 줄에 있던 call은 failed(이유: lophn 재시작)로 돌아간다. 앞 session이 끝나면(`SessionEnded`) 다음 것을 연다(2장 2, req-1516). 기다리는 동안 보낸 쪽은 cancel할 수 있다.
3. core가 그 앱 하나 범위의 token을 만든다(req-1052). 새 앱이면 source 폴더를 template으로 준비한다(req-1130).
4. adapter가 skill과 hook이 있는지 확인하고, 터미널 탭에서 TUI를 앱 source 폴더로 띄운다. token은 환경 변수로, 첫 prompt는 shell을 거치지 않고 넘긴다(req-1067, 1091, 1095, 1097). 터미널 탭은 그 앱의 앱 공간에서 열고, focus를 옮기지 않고 toast로 알린다(req-1091).
5. hook이 session 시작을 알리면 `SessionStarted`를 내고 외부 session ID를 잇는다(S1 6장). hook이 없는 제품(Hermes, OpenClaw)은 lophn이 PTY를 띄울 때 `SessionStarted`를 낸다. 이때 외부 session ID는 없다(req-1099).
6. coding agent가 CLI로 ticket을 읽고 claim하고 일한다(req-1216). ticket 읽기는 근거 annotation의 메모, component, source 위치, release, screenshot 파일 경로를 함께 돌려준다(req-1488, S9 9장). 막히거나 blueprint를 바꿔야 하면 CLI로 메시지를 보낸다(req-1491). 그 메시지는 Router가 맡긴 App Engineer session에 넣는다. 닫혀 있으면 그 앱의 App Engineer 새 session이 받는다(S3 4장).
7. 완료 보고, claim 만료, 보고 없는 끝은 domain event로 Reactor가 맡긴 App Engineer에게 보내고 call을 닫는다(S1 5장, S3 7장).

## 6. 상태와 event

| hook이 알리는 것 | agent event(S1 6장) |
|---|---|
| session 시작 | `SessionStarted`(외부 session ID) |
| turn 시작, 끝 | `TurnStarted`, `TurnEnded` |
| 권한 물음과 답 | `PermissionRequested`, `PermissionResolved`. 대기 목록에 보이고, 누르면 그 터미널 탭으로 focus를 옮긴다. 답은 TUI에서 한다(2장 5) |
| process 끝 | `SessionEnded` |

- lophn이 PTY에 첫 prompt나 메시지를 넣으면 `MessageReceived`를 낸다.
- 상태(running, waiting, idle, unknown)는 이 event로 계산하고, 알려 주지 않은 것은 unknown이다(req-1098).

## 7. 메시지 넣기 (App Engineer → coding agent)

- App Engineer가 reply tool로 보낸 메시지는 Router가 PTY에 넣는다(S3 7장).
- 상태가 idle일 때만 넣는다. 도는 중이면 idle이 될 때까지 기다린다.
- 사람이 그 터미널 탭에 focus해 있으면 넣지 않고 기다린다. 사람의 입력과 섞이지 않게 한다.
- 상태가 unknown이거나 adapter에 turn 끝 신호가 없으면 넣지 않고, "이 harness는 turn 끝을 알리지 않는다"는 이유로 App Engineer에게 실패를 돌려준다(2장 1).
- lophn이 꺼지면 기다리던 메시지는 session과 함께 버려진다(S1 10장).

## 8. 끝

| 일 | session | token, claim | ticket | domain event | call |
|---|---|---|---|---|---|
| 완료 보고 | coding agent가 끝내거나 남는다 | session이 끝날 때 회수 | 보고됨 | `TicketCompletionReported` | done |
| claim 만료 | 그대로 | claim 정리 | 그대로 | `TicketClaimExpired` | failed |
| 보고 없이 process 끝 | 끝 | 회수, claim 반납(req-1101) | 그대로 | `CodingSessionEndedUnreported` | failed |
| ticket 취소 | 멈춤(req-1062) | 회수 | 취소 | | cancelled |
| call cancel | 멈춤(2장 3) | 회수(claim 풀림) | 열린 채 | | cancelled |
| lophn 꺼짐 | 끝(S1 10장) | 회수, claim 반납 | 그대로 | 보고가 없었으면 `CodingSessionEndedUnreported` | failed |

## 9. 권한

- 권한 mode는 lophn이 정하지 않는다(2장 4). harness가 묻는 것은 TUI에 뜨고 대기 목록에도 보인다. 대기 목록에서 누르면 그 터미널 탭으로 간다(2장 5).
- coding agent가 lophn에 닿는 범위는 token 범위다: 그 앱의 정보, 문제, ticket, 공통 SDK와 template(req-1064, core-server req-0206).
- coding agent는 사람과 직접 이야기하지 않는다. 사람은 App Engineer에게 청한다(AGENT-ROLE P8).

## 10. 지울 옛 것

- `packages/coding-agent/mcp-server`, `--toolsets`, MCP 설정 출력(`../changes.md`).
- 문제 하나에 수리 ticket 하나를 예약하던 것(`ticket_open_repair_problems`). 근거 요구가 없다.
- 사람이 ticket을 직접 만드는 길. 사람은 App Engineer에게 청한다(req-1450, AGENT-ROLE P8).
- keychain에 두던 coding token(req-1052가 환경 변수로 바꿨다).
- lophn agent tool의 `ticket.claim`, `ticket.renew_claim`, `ticket.report_completion`(coding agent CLI 몫, S4 9장).

## 11. 하지 않는 것

- 앱 하나에 coding session 여럿, worktree.
- 화면 출력을 읽어 idle을 짐작하기.
- lophn이 꺼져도 PTY를 살려 두는 daemon, 외부 session resume.
- lophn이 coding agent의 권한 mode를 정하기.
- harness의 권한 물음에 lophn 화면에서 답하기.
- heartbeat가 없다고 session을 실패로 처리하기. 끝은 claim 만료와 process 끝으로 안다.

## 12. 다시 따진 것

1. **정함(사람, 2026-10-15): Hermes와 OpenClaw는 turn 끝 신호가 없는 제품으로 다룬다.** 첫 prompt만 넣고 그 뒤 메시지는 2장 1대로 실패를 돌려준다. Hermes는 `on_session_end`가 turn마다 오지만 hook 설정이 사용자 전역뿐이고, OpenClaw는 lophn이 만든 native plugin을 사용자 설정에 설치해야 한다. hook은 앱 source 폴더 안에만 둔다는 원칙을 넘지 않는다. process 끝은 PTY exit으로 안다(`../research/turn-end-hermes-openclaw.md`).
2. **정함: CLI의 hook 명령을 요구로 썼다(req-1517).**
3. **정함(사람, 2026-10-15): 실패 이유 `busy`를 두지 않고 줄에 세운다.** 바쁨으로 돌려주면 다시 맡길 때를 보낸 쪽이 알 길이 없다. 앞 session의 끝은 앞 ticket을 맡긴 session으로 가고, 바쁨을 받은 쪽은 reaction으로 열린 다른 session일 때가 흔하다. req-1501은 그대로다.

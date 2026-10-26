# coding agent event 추상화 비교: herdr, orca, emdash, paseo와 lophn

터미널이나 protocol로 띄운 coding agent(Claude Code, Codex, Gemini CLI, OpenCode, pi 등)에게서 "무엇이 돌고, 지금 무슨 상태인가"를 어떻게 알아내고 어떤 모양으로 추상화하는지 비교한다. 네 제품은 2026-10-26에 소스를 새로 받아 읽었다(설치·실행하지 않음). 제품별 원 보고서는 `research_notes/coding agent event 추상화 비교/{herdr,orca,emdash,paseo}.md`에 있고, 줄 번호와 file 경로는 거기 있다.

| 제품 | repo | commit | 형태 |
|---|---|---|---|
| herdr | github.com/herdrdev/herdr | `5608de06` (2026-10-24, v0.9.5) | Rust 터미널 multiplexer(server가 PTY를 갖고 TUI는 client) |
| orca | github.com/stablyai/orca | `c0714b9c` (2026-10-26) | Electron IDE, worktree마다 agent |
| emdash | github.com/generalaction/emdash | `e21cd3d8` (2026-10-23) | Electron, 37개 제품, worktree·SSH |
| paseo | github.com/getpaseo/paseo | `033b2cdf` (2026-10-26, v0.13.1) | daemon + mobile·web·desktop client |

lophn 칸은 이 비교 뒤 0.9.0에서 바꾼 모습이다(`project-docs/architecture/terminal-agent.md`, `coding-agent.md`).

## 0. 요약

- 넷은 **신호를 얻는 방식**이 다르다. herdr는 화면을 읽고, orca는 hook을 주로 쓰며 그 위에 여러 신호를 겹겹이 쌓고, emdash는 hook과 ACP 두 길을 따로 돌리고, paseo는 agent를 터미널이 아니라 SDK·app-server·ACP로 직접 몬다.
- 터미널 TUI를 다루는 셋(herdr, orca, emdash)과 paseo의 "터미널 탭" 모두 **hook은 터미널을 가진 쪽이 받는다**(loopback HTTP POST나 unix socket, 터미널 env의 key·token).
- 상태 값은 모두 4~5개로 수렴한다: 돈다 / 사람이 필요하다(권한·질문) / 끝났다(또는 쉰다) / 모른다. "안 본 끝"을 따로 두는 곳이 둘이다(herdr `Done`, orca `unseen` 성격의 phase).
- 공통 함정이 있다. 세 곳이 따로 같은 것을 겪었다.
  - Claude Code는 Esc·Ctrl-C로 끊으면 `Stop` hook을 보내지 않는다.
  - 거절한 권한 물음에는 `PostToolUse`가 오지 않는다.
  - Codex는 실패한 turn에 `Stop`이 없다.
  - subagent의 hook과 compact·clear의 `SessionStart`는 session 경계가 아니다.
- 화면이나 title로 상태를 짐작하는 쪽(herdr, orca의 fallback)은 상태 오판 이슈가 가장 많고, 규칙 file을 원격에서 주기적으로 갱신해 CLI 화면 변화를 따라간다.
- 앱 안에서 권한 물음에 답하는 것은 agent를 protocol로 모는 경로(paseo chat, emdash ACP, orca structured chat)뿐이다. 터미널 TUI는 모두 "보이기만 하고 답은 터미널에서"다(orca는 카드에서 PTY에 키를 친다).

## 1. 한눈에

| | lophn (0.9.0) | herdr | orca | emdash | paseo |
|---|---|---|---|---|---|
| 무엇이 도는지 | foreground process(Linux `/proc` tpgid·cmdline) 또는 hook | foreground process group probe(300–500ms) | hook, 없으면 title | hook의 provider, ACP는 띄운 것 | 띄운 provider(터미널 탭은 hook) |
| 상태의 출처 | hook만 | 화면 규칙(TOML manifest) 주, hook(6개 제품) | hook 주, OSC 7501, title 글리프, 키 입력 추론 | hook(TUI), ACP event, hook 없으면 Enter heuristic | SDK·JSON-RPC·SSE·ACP event |
| 상태 값 | running / waiting / idle / unknown + unseen | Idle / Working / Blocked / Unknown (+Done) | working / blocked / waiting / done + outcome, sessionBoundary | idle / working / awaiting-input / error / completed | initializing / idle / running / error / closed + attention |
| 공통 schema | 터미널 상태 하나. coding session은 lophn agent와 같은 `AgentEvent` | 상태 하나, turn id 없음 | 4상태 행 + 큰 payload | `CanonicalHookEvent` → `AgentStatus` | `AgentStreamEvent` union(timeline, tool call detail, permission, subagent) |
| hook 길 | `lophn hook` → unix socket(shell main), 터미널 key | python/node → unix socket, 0600, token 없음 | `curl` → loopback HTTP, 앱 전체 token 하나 | `curl` → loopback HTTP, server token 하나 | 터미널 탭: loopback POST, 터미널마다 token |
| hook 설치 | 전역, 처음 알아볼 때 묻고 Settings에서도 | 전역, 사람이 명령으로 | 전역, 켤 때마다 자동(기본 켬) | 전역, 묻지 않음, uninstall 안 불림 | 전역, opt-in(기본 끔) |
| 권한 물음 답 | 터미널에서만 | 터미널에서만 | 카드가 PTY에 키를 친다 | TUI는 터미널, ACP는 앱 | 앱(SDK callback·RPC 답) |
| 알림 | 안 보고 있을 때만: 탭 점, 창이 focus 밖이면 OS 알림 | 사이드바 + toast·소리 | sidebar phase + 알림(사람이 멈춘 turn은 제외) | sidebar 배지 + OS 알림·소리 | push / 앱 안(presence로 고름) |
| 저장 | 안 함(메모리, runtime push) | 메모리, event ring 512, 놓치면 snapshot | 행마다 최신값 file, 실패한 hook spool → replay | 최신값만(LiveModel + SQLite cache) | timeline seq·epoch, cursor 재동기. 정본은 제품 transcript |
| 메시지 주입 | (coding session) idle일 때만, 줄, 사람 focus면 대기 | paste + Enter, Blocked면 거절 | paste + 지연 CR, 안 들어가면 재시도 | 날 PTY write | steer / interrupt API |

## 2. 하나씩

### herdr: 화면을 읽는다

- agent별 TOML manifest가 화면 아래 영역에 우선순위 붙은 regex를 건다(Claude만 15개쯤: `esc to interrupt`·spinner는 working 970, `❯` 입력 상자는 idle 950, bash 권한 물음은 blocked 850). OSC 0/2 title과 OSC 9;4 progress도 같은 엔진에 들어간다. manifest는 herdr.dev에서 자동 갱신한다.
- **Claude의 상태 hook을 쓰다가 지웠다.** cancel·interrupt 길에서 hook이 오지 않아서다(CHANGELOG). 지금 Claude·Codex hook은 SessionStart(session id)뿐이고, hook으로 lifecycle을 받는 것은 pi, omp, opencode, kilo, kimi, mastracode 여섯이다.
- 무엇이 도는지는 PTY의 foreground process group을 probe해 안다(이름, argv0, node·bun·python·`sh -c` wrapper의 script). hook이 없어도 된다.
- 화면 판정과 hook 판정을 고르는 `terminal/state.rs`가 순서 버그를 고치느라 suppression·generation map으로 가득하다. open issue 400개 중 40개쯤이 상태 오판이다(Blocked를 idle로, OSC title에 남은 spinner 때문에 몇 시간 working 등).
- `Done`은 "사람이 아직 안 본 Idle"로 파생한다. turn id와 session 끝 event가 없다(level-triggered).
- 인증은 socket 0600뿐이라 같은 사용자의 어떤 process든 아무 pane의 상태를 보고할 수 있다.

### orca: hook을 주로, 신호를 여러 겹 쌓는다

- 우선순위: hook > OSC 7501(자체 "Program Status Protocol", hook이 2분 조용하고 서로 다를 때만 넘겨받음) > title 글리프(braille spinner, Claude `✳`, Gemini `✋`) > 키 입력 추론(Esc·Ctrl-C 뒤 title이 5초 안에 idle로 바뀌면 끊긴 것으로 본다).
- 화면 글자 규칙 엔진(per-agent JSON, GitHub release에서 4시간마다 갱신)은 행 상태가 아니라 "지금 입력해도 되나"(send gating, `terminal wait --for tui-idle`)에만 쓴다.
- Claude hook 12종을 버전에 따라 놓는다. Notification과 PreCompact는 일부러 안 놓는다(PreCompact는 취소된 compact에서도 와서 working에 멈춘다).
- 상태는 working / blocked / waiting / done. turn 결과는 `outcome`(success, failure, cancellation, …)이고 **값이 없으면 unknown이다. plain Stop만 보고 성공이라 짐작하지 않는다.** `/clear`·수동 compact는 `done + sessionBoundary`로 turn 끝과 구별하고 알림을 내지 않는다. main agent 상태와 subagent까지 접은 상태를 나눠 lead가 멈춰도 자식이 돌면 working이다.
- Codex는 실패한 turn에 Stop이 없어 rollout transcript를 읽어 failure를 붙인다.
- hook POST가 실패하면 shell script가 spool file에 쌓고 다음 시작에 replay한다(launch token hash와 종료 기록으로 거른다).
- `src/main/agent-hooks/`만 file이 190개쯤이다. 설계라기보다 issue 번호가 달린 땜질이 쌓인 모양이다.

### emdash: hook 길과 ACP 길이 따로 돈다

- TUI: 37개 제품마다 hook parser를 두고 `start` / `stop` / `error` / `notification` / `session`으로 줄인다. Claude 권한 물음은 Notification 글에 `/permission|approval/i` regex를 걸어 안다(전용 hook을 안 놓는다).
- start hook이 없는 제품(Codex, Qwen, Devin, pi …)은 Enter를 누르면 working으로 본다. 문서는 "추론하지 않는다"고 쓰고 코드는 다르다. 권한 물음에 Enter로 답해도 working이 된다.
- 여러 제품이 Stop과 SessionEnd를 같은 `stop`으로 매핑해 turn 끝과 session 끝을 섞는다.
- ACP: 순수 `decide` / `evolve` state machine. 도는 동안 온 prompt는 줄에 세우고(편집·순서 바꾸기 가능), 권한은 `PermissionBroker`가 JSON-RPC promise를 쥐고 앱 안 `PermissionBand`로 답한다. background subagent가 돌면 busy로 보고 줄을 막는다.
- hook을 전역에 묻지 않고 놓으며, `deleteHooks`는 있지만 부르는 곳이 없다.

### paseo: 터미널을 거의 쓰지 않는다

- 주 제품(chat agent)은 daemon이 agent process를 직접 갖고 Claude Agent SDK, `codex app-server` JSON-RPC, OpenCode HTTP+SSE, ACP로 몬다. 화면·hook·transcript 해석이 필요 없고 정보가 가장 풍부하다(timeline item, 정규화된 tool call detail, 권한 요청·응답, subagent, usage).
- 대신 "이 event가 어느 turn 것인가"를 맞추는 땜질이 많다(turn id 직접 발급, 끝난 turn의 늦은 event 버리기, interrupt 뒤 stale `result` 숨기기, Claude 버전별 idle 규칙).
- 대화의 정본은 제품 transcript다. timeline은 메모리이고 resume 때 transcript에서 다시 짓는다. 그래서 turn 중 reload에서 답이 두 번 보이거나 잘린다(#7917).
- 터미널 탭에서 사람이 띄운 agent는 일부러 3상태(running, idle, needs-input)만 opt-in hook으로 받는다. 단독 Ctrl-C·Esc를 보면 상태를 지운다(Claude가 Stop을 안 보내서).
- 메시지 주입은 steer와 interrupt를 구별한다(Claude `priority:"next"`, Codex `turn/steer`).

## 3. 신호 원천별

| 원천 | 쓰는 곳 | 장점 | 비용 |
|---|---|---|---|
| hook(제품 설정의 명령) | 전부(paseo는 터미널 탭만) | 결정적, 제품이 직접 알림 | 사람 전역 설정에 써야 함. 제품마다 event 이름과 빠진 신호가 다름 |
| foreground process | herdr, lophn | hook 없이 무엇이 도는지와 끝을 안다 | OS별 구현. node로 도는 CLI는 argv를 봐야 함 |
| 화면 글자 | herdr(주), orca(send gating) | 설치 없이 바로 | CLI 화면이 바뀔 때마다 규칙 갱신. 오판이 가장 많음 |
| title·OSC 글리프 | herdr, orca | 설치 없이 | Claude가 spinner 글자를 바꾸자 깨짐(orca #13889) |
| 자체 OSC protocol | orca(7501, 9999) | 제품이 협조하면 깔끔 | 지원 제품이 적음 |
| 키 입력 | paseo, orca, lophn | interrupt처럼 hook이 없는 끝을 앎 | Esc는 메뉴 닫기에도 쓰임 → "끝"이 아니라 "모름"으로 둬야 안전 |
| SDK·JSON-RPC·ACP | paseo, emdash ACP, orca structured | 가장 풍부, 앱 안에서 답하기 가능 | agent 실행을 소유해야 함. 사람이 쓰던 터미널 경험이 아님 |

## 4. 제품별 함정 (둘 이상이 겪은 것)

- **Claude Esc·Ctrl-C:** `Stop`이 오지 않는다. herdr는 hook을 버렸고, paseo는 단독 키를 보고 지우고, orca는 title 변화와 맞춘다. lophn은 단독 Esc·Ctrl-C를 unknown으로 내린다(터미널 상태만, core coding session은 아직).
- **권한 거절:** `PostToolUse`가 오지 않는다. orca는 `PostToolUseFailure`와 다음 Stop으로 풀고, lophn은 `PostToolUseFailure`를 받고 turn이 끝나면 남은 물음을 닫는다.
- **Codex:** 실패한 turn에 Stop이 없다(orca는 rollout transcript로 메움). 0.150부터 `Interrupt` hook이 있다(orca·lophn이 받음). 새 hook은 사람이 `/hooks`에서 trust해야 돈다.
- **session 경계가 아닌 것:** subagent hook(`agent_id`), `SessionStart` source compact, `SessionEnd` reason clear. orca·lophn은 버리거나 경계로만 표시하고, emdash는 구별하지 않는다.
- **subagent가 도는 동안:** Claude는 background subagent가 있으면 running을 보고한다(paseo). lead만 멈추고 자식이 돌 때 working으로 둘지(orca, emdash ACP) 정해야 한다.
- **OpenCode:** `session.status` idle과 deprecated `session.idle`이 같은 끝을 두 번 알린다(emdash는 dedupe, lophn은 status만 듣는다).

## 5. lophn이 가져온 것

- 터미널 탭 상태로 둔다(session이 아니다). paseo의 나눔이다.
- 무엇이 도는지는 foreground process로 안다(herdr), 상태는 hook만(화면 짐작은 하지 않는다).
- hook은 터미널을 가진 shell main이 터미널 key로 받는다(browser bridge와 같은 꼴). 앱 하나 범위 token·hook 설치 동의는 넷보다 엄격한 쪽을 유지했다.
- 알림은 orca·herdr처럼 사람이 보고 있으면 내지 않고, 사람이 멈춘 turn은 알리지 않는다. 작업 중 점은 X 자리에서 pulse한다.
- 남은 것: core coding session 상태의 Esc 규칙, Codex 실패 turn, macOS의 node CLI 식별(hook이 올 때까지 모름), Windows 미지원, 앱 안에서 권한 답하기(protocol로 몰 때만 가능).

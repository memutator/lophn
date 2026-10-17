# coding-agent

App Engineer는 ticket을 사람이 쓰던 coding agent(`external-coding-agent`)에게 맡기고, 메시지를 주고받고, 완료 보고로 닫는다. coding agent는 lophn 밖의 제품이라 lophn이 그 안을 들여다볼 수 없다. 이 문서는 lophn이 제품을 띄우고, 상태를 알고, 메시지를 넣고, 일이 끝났음을 판정하는 메커니즘이다. 여러 곳에 걸쳐 있다. `app-tickets`가 session 상태와 claim을 갖고, shell이 터미널을 띄우고, `coding-agent`가 제품별 표와 CLI를 갖고, Router와 Reactor가 call을 닫는다.

## 흐름

```
App Engineer ─call(ticket)─▶ Router ─CodingTransport─▶ app-tickets
                                ▲        앱마다 한 번에 session 하나. 있으면 앱의 줄에 세운다(call은 accepted로 기다림)
                                │        실행 계획(argv, env)을 짜 commit 뒤로 보낸다
                                │                     │
                                │       core-api의 Gateway frame (open / input / stop)
                                │                     ▼
                                │   shell main ── harness install dry_run ─▶ 없으면 사람에게 묻고 install ─▶ 사용자 home 전역에 skill, hook
                                │      │  터미널 탭(PTY)에 제품을 띄움. cwd = 앱 source, env = 앱 하나 범위 token
                                │      ▼
                                │   external-coding-agent
                                │      ├─ harness hook ─▶ lophn hook <harness> <event> ─┐ coding-agent-cli
                                │      └─ ticket claim / show / report, message send ──┤ (token으로 인증)
                                │                                                       ▼
                                │                          core-api ─▶ app-tickets: hook 신호를 agent event로, 상태 계산
                                │
        Reactor ◀── domain event: 완료 보고 / claim 만료 / 보고 없는 끝 ── app-tickets
          └─ call을 닫고, 맡긴 App Engineer(열린 session, 없으면 새 session)에 입력으로 알린다
        App Engineer의 reply ─▶ Router ─▶ idle일 때만 PTY에 넣는다(사람이 그 탭에 focus해 있으면 풀릴 때까지 shell main이 쥔다)
```

끝나는 길마다 남는 것은 다르다.

```
끝나는 길            session           claim / token        ticket     call
완료 보고            그대로            claim 끝, token은     reported   done
                                       session이 끝날 때
claim 만료           그대로            claim 정리            그대로     failed
보고 없이 process 끝  끝               claim 반납, 회수       그대로     failed
ticket 취소          멈춤              회수                  cancelled  cancelled
call cancel          멈춤              회수 (claim 풀림)      열린 채    cancelled
lophn 꺼짐           끝(PTY 안 살림)   정산, 회수             그대로     failed
```

## 지키는 것

- **coding agent가 lophn에 닿는 길은 CLI 하나이고 인증은 앱 하나 범위의 token이다.** token은 session이 끝나면 회수하고, 회수한 token의 새 호출은 거절한다. 다른 앱의 것은 볼 수 없다.
- **token 원문은 저장하지 않는다.** commit 뒤에 만들어 실행 계획의 env에만 담는다. 표, 오류, log에 넣지 않고, 그래서 shell main은 이 frame을 renderer로 중계하지 않는다. token이 한 번이라도 새면 그 앱 하나가 열린다.
- **상태는 hook이 알린 event에서만 계산한다.** 화면 출력을 읽어 idle을 짐작하지 않는다. 알려 준 적이 없으면 unknown이다. program은 결정적으로만 판정한다.
- **상태는 running, waiting(권한 물음 대기), idle, unknown 넷이다.** 첫 hook이 오기 전에는 unknown이라 메시지를 넣지 않는다. 메시지를 PTY에 넣지 못해도 Router는 이미 배달했다고 본 것이라 되돌릴 길이 없다. 다음 메시지만 허락한다.
- **제품 감지는 shell main이 CLI를 exec해서 하고 core는 보고를 받는다.** core는 사람의 PATH와 실행 파일을 모른다. 처음 읽기는 실행 파일 찾기만 하고, 제품을 실제로 실행하는 version·login probe는 사람이 다시 감지를 눌렀을 때만 돈다. 사람이 시키지 않았는데 제품을 띄우지 않는다.
- **외부 session ID는 hook이나 session 파일에서 실제로 받은 것만 쓴다.** hook이 없는 제품은 PTY를 띄웠을 때 session 시작을 알리고 ID는 비워 둔다. ID를 짐작해 채우지 않는다.
- **메시지는 idle일 때만 PTY에 넣는다.** 상태가 unknown이거나 turn 끝 신호가 없는 제품이면 넣지 않고 실패로 돌려준다. 도는 중이면 기다렸다가 turn이 끝나면 하나씩 넣는다. 사람이 그 탭에 focus해 있으면 shell main이 풀릴 때까지 쥔다. 사람의 입력과 섞이면 둘 다 망가진다. 붙여 넣기 구간으로 보내고 제출은 마지막 CR 하나로 해서 글 안의 줄바꿈이 제출이 되지 않게 한다.
- **앱 하나에 coding session은 한 번에 하나다.** 그동안 온 맡기기는 앱마다 줄에 세웠다가 앞 session이 끝나면 연다. 같은 source 폴더에 둘이 돌면 서로 부딪친다. 줄은 lophn이 꺼지면 비우고 그 call은 실패로 돌려준다.
- **session의 끝은 터미널 process의 exit으로만 안다.** 제품의 `SessionEnd` hook은 끝으로 쓰지 않는다. compact로 시작한 `SessionStart`, clear로 끝난 `SessionEnd`, subagent의 hook도 session 경계가 아니라 버린다. 끝을 hook에 기대면 hook이 없는 제품이나 clear 한 번에 session을 잘못 닫는다. heartbeat가 없다는 이유로 실패 처리하지 않는다.
- **완료 보고는 현재 유효한 claim과 그 claim으로 준비된 release가 있어야 접수한다.** 접수하면 claim이 끝난다. claim 기한은 정확히 1시간이고, 만료 정리가 늦어도 쓰기는 즉시 기한을 검사한다.
- **끝나는 길마다 call은 한 번만 닫힌다.** 완료 보고, claim 만료, 보고 없는 끝은 domain event이고 Reactor가 같은 (handler, seq)로 두 번 일해도 한 번만 닫는다. 이미 취소되었거나 Router가 먼저 닫은 call은 닫지도 알리지도 않는다.
- **call cancel은 session을 멈추고 token을 회수하되 ticket은 열어 둔다.** 다시 맡길 수 있다. ticket 취소는 별개이고 ticket을 닫는다. "이 맡기기를 멈춘다"와 "이 일을 버린다"는 다르다.
- **skill과 hook은 harness의 사용자 전역 설정에 한 번 놓고, 놓기 전에 사람에게 묻는다.** 맡길 때 shell main이 `lophn harness install`을 `dry_run`으로 불러 없는지만 보고, 없으면 놓을 file을 보여 주고 묻는다. 허락하면 놓고 결과를 보인다. 거절은 기억하지 않고 다음에 다시 묻는다. 묻거나 놓기가 실패해도 맡기기는 막지 않는다(hook이 없어 상태가 unknown이고 메시지는 실패한다). `dry_run`은 우리 항목이 있으면 내용이 달라도 `unchanged`라 lophn이 업데이트돼도 다시 묻지 않는다. 개발 실행만 예외다. PATH의 `lophn`이 없거나 설치된 판이라, shell main이 `LOPHN_CLI` 경로를 hook command로 넘기고 그때의 `dry_run`은 우리 항목의 command가 다르면 놓을 것이 있다고 본다.
- **전역 설정은 사람의 다른 항목을 보존한다.** json hook 설정은 event마다 우리 항목(`lophn hook <harness> `나 개발 실행의 `<절대 경로> hook <harness> `로 시작하는 command) 하나만 두고 다른 key·hook·indent를 그대로 둔다. 파싱되지 않는 설정 file은 건드리지 않고 `failed`다. plugin file과 skill 폴더는 우리 것이라 내용이 다르면 덮는다. 설치를 하는 CLI 실행은 그 harness의 hook 설정 폴더와 skill 폴더의 쓰기 권한만 갖는다.
- **전역 skill은 얇고 절차는 `lophn guide <name>`이 낸다.** 전역 SKILL.md는 frontmatter와 "절차는 `lophn guide <name>`을 따른다"뿐이라 lophn이 바뀌어도 다시 놓을 일이 없다.
- **전역 hook은 lophn과 상관없는 harness 실행에서도 불린다.** coding token이 없으면 launcher가 deno를 띄우지 않고 끝나고, `lophn hook`도 stdin을 읽지 않고 아무것도 보내지 않은 채 성공한다. pi extension과 OpenCode plugin은 token이 없으면 hook을 등록하지 않는다.
- **첫 prompt는 argv의 한 인자로 넘기고 shell을 거치지 않는다.** quote나 escape를 조합하지 않는다. prompt는 ticket id만 싣고 본문이나 token을 복제하지 않는다. 본문은 agent가 CLI로 읽는다. argv로 못 넘기는 제품은 session 시작 hook을 받은 뒤 붙여 넣고, 기한이 지나면 넣지 않는다.
- **coding agent의 권한 mode는 lophn이 정하지 않는다.** harness의 권한 물음은 대기 목록에 보이기만 하고 답은 터미널 탭에서 한다. 대기 목록에서 누르면 그 탭으로 focus가 옮겨 간다.
- **lophn이 꺼져도 PTY를 살려 두지 않는다.** 외부 session resume도 없다. 켤 때 claim이 남은 session은 모두 정산한다.

## 왜 이 모양인가

- **통로는 CLI 하나.** 옛 MCP server와 toolset은 지웠다. hook도 같은 CLI의 명령이고 session 환경 변수의 token으로 인증한다. orca(hook script가 POST)와 paseo(env token)도 같은 꼴이다.
- **hook으로 상태를 안다.** orca는 화면을 읽어 짐작하지만 lophn은 짐작하지 않는다. turn 끝 신호가 있는 제품은 Claude Code `Stop`, Codex `Stop`, Gemini CLI `AfterAgent`, OpenCode `session.status` idle(전역 plugin이 root session의 event만 넘긴다. 뒤따르는 deprecated `session.idle`은 같은 끝이라 듣지 않는다), pi `agent_settled`다. pi는 `agent_end` 뒤에 retry와 compaction이 남을 수 있어 끝이 확정되는 쪽을 쓴다.
- **hook을 앱 폴더가 아니라 전역에 한 번 놓는다.** 열 때마다 앱 폴더에 놓으면 앱 source에 harness 설정이 섞이고(release 제외 목록이 따라온다), 사람이 고친 file을 지키려고 hash 기록이 필요하다. 전역에 한 번 놓고 사람에게 묻는 쪽이 단순하다. 감지 표는 7종(Claude Code, Codex, OpenCode, Gemini CLI, pi, Hermes, OpenClaw)을 유지한다.
- **Hermes와 OpenClaw는 아직 맡길 수 없는 제품이다.** 전역 skill·hook 위치와 첫 prompt를 argv로 넘기는 방법을 확인하지 못해 칸이 비어 있다. 확인하면 전역 설치로 hook을 놓을 수 있다.
- **CLI 출력을 data fence로 감싸지 않는다.** 사용자 앱과 사람이 쓴 글은 공격자로 보지 않는다(AGENTS.md). 줄로 풀어 쓰고 `--json`이면 JSON 하나다.
- **busy 실패 대신 줄에 세운다.** 바쁨으로 돌려주면 다시 맡길 때를 보낸 쪽이 알 길이 없다. 앞 session의 끝은 앞 ticket을 맡긴 session으로 가고, 바쁨을 받은 쪽은 reaction으로 열린 다른 session일 때가 흔하다.
- **worktree로 나눠 session 여럿을 돌리지 않는다.** 합칠 쪽이 없다. App Engineer는 code를 짜지 않는다.
- **harness의 권한 물음에 lophn 화면으로 답하지 않는다.** 제품마다 물음의 모양이 달라 그 UI를 두면 쓸데없이 깨지기 쉬운 의존이 생긴다. focus를 옮기는 것은 제품과 상관없다.
- **상태·정산·call 닫기를 같은 transaction에서 고친다.** session 상태가 writer 쪽 표에 있고 상태를 고치는 일이 정산, call 닫기와 한 transaction이어야 하므로, hook, 터미널 결과, Reactor, 메시지가 모두 command 하나로 writer에 들어간다.
- **사람은 coding agent와 직접 이야기하지 않는다.** 사람은 App Engineer에게 청하고, coding agent가 사람에게 말을 거는 길은 없다. 막히면 App Engineer에게 메시지를 보낸다. 닫혀 있으면 그 앱의 새 App Engineer session이 받는다.

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
                                │      ├─ ticket claim / show / report, message send ──┤ (token으로 인증)
                                │      └─ MCP POST /mcp: 앱 tool 목록·호출(preview만) ──┤
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

- **coding agent가 lophn에 닿는 길은 CLI와 MCP endpoint 둘이고 인증은 같은 앱 하나 범위의 token이다.** token은 session이 끝나면 회수하고, 회수한 token의 새 호출은 거절한다. 다른 앱의 것은 볼 수 없다.
  - MCP endpoint(`POST /mcp`, operation `coding.mcp`)는 그 앱의 tool만 보이고, 호출은 그 앱의 지금 도는 preview로만 간다. preview가 없으면 `unavailable`이고 live 앱은 부르지 않는다([app-call.md](app-call.md)). coding agent는 자기 코드를 harness의 tool 호출로 확인하고, 사용자 data에는 닿지 않는다.
- **MCP 설정은 그 session의 실행 계획(argv, env)에만 싣고 사람의 전역 설정에 쓰지 않는다.** token 원문은 env `LOPHN_CODING_TOKEN`에만 있고 설정은 그 이름만 가리킨다. argv는 `ps`에 보이기 때문이다. core의 port가 아직 열리지 않았으면 MCP 없이 띄운다.
  - Claude Code: argv 끝(prompt 뒤)에 `--mcp-config <json>`. header의 `${LOPHN_CODING_TOKEN}`은 Claude Code가 env에서 편다. flag가 variadic이라 뒤의 positional을 삼켜 맨 끝에 둔다. `--strict-mcp-config`는 쓰지 않아 사람의 다른 MCP server가 남는다.
  - Codex: 실행 파일 바로 뒤에 `-c mcp_servers.lophn.url=…`, `-c mcp_servers.lophn.bearer_token_env_var="LOPHN_CODING_TOKEN"`.
  - OpenCode: env `OPENCODE_CONFIG_CONTENT`. 사람이 이미 그 env를 쓰면 이 값이 덮는다.
  - Gemini CLI는 MCP를 `settings.json`에서만 정해 session마다 넣을 길이 없고, pi는 MCP가 없어 잇지 않는다. Hermes와 OpenClaw는 맡길 수 없는 제품이다.
  - MCP tool의 권한 물음은 다른 권한 물음처럼 터미널 탭에서 사람이 답한다.
- **token 원문은 저장하지 않는다.** commit 뒤에 만들어 실행 계획의 env에만 담는다. 표, 오류, log에 넣지 않고, 그래서 shell main은 이 frame을 renderer로 중계하지 않는다. token이 한 번이라도 새면 그 앱 하나가 열린다.
- **상태는 hook이 알린 event에서만 계산한다.** 화면 출력을 읽어 idle을 짐작하지 않는다. 알려 준 적이 없으면 unknown이다. program은 결정적으로만 판정한다.
- **상태는 running, waiting(권한 물음 대기), idle, unknown 넷이다.** 첫 hook이 오기 전에는 unknown이라 메시지를 넣지 않는다. 메시지를 PTY에 넣지 못해도 Router는 이미 배달했다고 본 것이라 되돌릴 길이 없다. 다음 메시지만 허락한다.
- **제품 감지는 shell main이 CLI를 exec해서 하고 core는 보고를 받는다.** core는 사람의 PATH와 실행 파일을 모른다. 처음 읽기는 실행 파일 찾기만 하고, 제품을 실제로 실행하는 version·login probe는 사람이 다시 감지를 눌렀을 때만 돈다. 사람이 시키지 않았는데 제품을 띄우지 않는다.
- **외부 session ID는 hook이나 session 파일에서 실제로 받은 것만 쓴다.** hook이 없는 제품은 PTY를 띄웠을 때 session 시작을 알리고 ID는 비워 둔다. ID를 짐작해 채우지 않는다.
- **메시지는 idle일 때만 PTY에 넣는다.** 상태가 unknown이거나 turn 끝 신호가 없는 제품이면 넣지 않고 실패로 돌려준다. 도는 중이면 기다렸다가 turn이 끝나면 하나씩 넣는다. 사람이 그 탭에 focus해 있으면 shell main이 풀릴 때까지 쥔다. 사람의 입력과 섞이면 둘 다 망가진다. 붙여 넣기 구간으로 보내고 제출은 마지막 CR 하나로 해서 글 안의 줄바꿈이 제출이 되지 않게 한다.
- **source 폴더가 없는 앱은 맡길 때 core가 만든다.** lophn이 `app.create`로 등록한 앱에는 source가 없다. App Engineer가 그 앱의 coding agent에게 `call`하면, core가 tx 전에 내장 template을 `<data root>/apps/<app>/source`(`appDefaultSource`, `packages/protocol/apps/app-storage.ts`)에 깔고 git으로 commit한 뒤(사람의 git 설정은 읽지 않는다) `apps/connect_source`로 잇는다(`packages/core/apps/tickets/coding/scaffold-source.ts`). 폴더가 이미 있으면 덮지 않고, commit이 있으면 그대로 잇는다.
- **앱 하나에 coding session은 한 번에 하나다.** 그동안 온 맡기기는 앱마다 줄에 세웠다가 앞 session이 끝나면 연다. 같은 source 폴더에 둘이 돌면 서로 부딪친다. 줄은 lophn이 꺼지면 비우고 그 call은 실패로 돌려준다.
- **session의 끝은 터미널 process의 exit으로만 안다.** 제품의 `SessionEnd` hook은 끝으로 쓰지 않는다. compact로 시작한 `SessionStart`, clear로 끝난 `SessionEnd`, subagent의 hook도 session 경계가 아니라 버린다. 끝을 hook에 기대면 hook이 없는 제품이나 clear 한 번에 session을 잘못 닫는다. heartbeat가 없다는 이유로 실패 처리하지 않는다.
- **완료 보고는 현재 유효한 claim과 그 claim으로 준비된 release가 있어야 접수한다.** 접수하면 claim이 끝난다. claim 기한은 정확히 1시간이고, 만료 정리가 늦어도 쓰기는 즉시 기한을 검사한다.
- **release 확정은 CLI의 `release status`가 일으킨다.** 순서는 `release prepare`(접수) → `release status`(`completed`가 되면 `bundle_hash`와 고정 시험 hash `test`) → `app test`(`kind`, `request_key`, `app`만 보내면 core가 그 앱의 마지막으로 끝난 준비의 bundle hash와 `test`로 채운다. 새 준비를 받으면 지운다) → `app test status`·`app test result`(통과 확인) → `release status`(core가 같은 bundle hash로 통과한 app test를 찾아 확정하고 `release` id를 준다) → `ticket report`. 확정은 접수한 coding agent의 claim을 다시 검사하는 machine 쪽 일이고, coding agent는 `test`를 스스로 만들 수 없어 core가 봉인 bundle 사본에서 만들어 준다. 확정 command 자체는 CLI 표에 없다.
- **ticket의 check는 하나이고 `app_test`, `examples`, `text` 중 하나다.** coding agent가 쓴 test는 program이 돌리지 않는다. code를 쓴 쪽이 기준도 쓰면 자기 채점이기 때문이다. `app_test`는 플랫폼 검사 다섯이라 앱의 업무 규칙을 보지 않는다. `text`는 runner가 돌리지 않고 App Engineer가 판단한다. `reproduction` 종류와 `test_command`는 없다.
- **업무 규칙은 App Engineer가 쓴 tool 예시(`examples`)를 program이 돌려 확인한다.** 예시는 tool, 입력, 기대 결과(`expect`) 1~20개로, 사람의 요구에서 뽑아 ticket에 적는다. coding agent는 예시를 고치지 못하고 틀린 것 같으면 App Engineer에게 메시지로 청한다. 수리 ticket의 예시는 원래 증상을 보이는 호출과 고쳐진 기대 결과다.
  - 완료 보고를 접수하면 Reactor가 core의 machine 자격으로 `examples` test를 요청한다. 예시는 요청이 아니라 접수 준비가 ticket의 현재 check와 보고 release를 같은 transaction에서 읽어 싣는다. runner는 보고된 release의 봉인 bundle을 격리 사본으로 띄워 예시를 차례로 부르고 첫 불일치에서 멈춘다. 기존 app test runner가 앱을 부르는 길을 다시 쓰고 새 runner는 없다. 앞 예시가 만든 data는 뒤 예시에 보인다.
  - 비교 규칙은 객체는 `expect`의 key가 다 있고 값이 맞아야 하고(실제 결과에 key가 더 있어도 된다), 배열은 길이가 같고 원소가 차례로 맞아야 하고, 나머지는 `===`다. 오류로 끝난 호출은 불일치다. 예시를 test로 만들 수 없으면(bundle 사본을 못 읽음) 재시도하지 않고 fail로 남긴다.
  - 예시가 모두 맞으면 예시의 write가 남긴 changeset을 뒤집어 적용해 첫 호출 전 상태로 돌아오는지 본다. 돌아오지 않으면 fail이다. 되돌아온 write tool이 증거의 `proven`이다. write tool의 되돌리기는 이렇게 실제로 성공한 호출로 증명한다. tool 선언에 test용 fixture 입력을 두지 않는다. 운영과 무관한 data가 선언에 들어가고, 앞 호출이 만든 id를 고정 값으로 맞출 수 없다. 앱 자신의 test는 harness 밖 in-process라 changeset이 없어 증명 재료가 아니다.
  - 검증이 끝나 `VerificationRecorded`가 나면 handler가 결과를 ticket에 남긴다. `ticket.verify`는 check가 `examples`인 ticket을 이 보고에서 현재 check로 돌아 pass가 기록된 뒤에만 verified로 받고, 아니면 `conflict`다. 예시를 고친 뒤의 옛 결과는 check hash가 달라 근거가 아니다. `app_test`와 `text` ticket에는 이 관문이 없다.
  - coding agent는 앱 `tests/`에 자기 test를 돌려 볼 수 있으나 그 결과는 test result가 아니라 보고 summary의 "수행한 확인"이다.
- **app test의 `rewind`는 만든 입력으로 write tool을 불러 본다.** 호출이 성공했는데 되돌리기가 틀리면 fail이다. 호출 자체가 실패하면(앞선 상태가 있어야 하는 tool) fail이 아니라 "증명 못 함"이고 증거 `unproven`과 pass 이유 한 줄에 남는다. 막으면 정상 앱이 release되지 못한다.
  - examples run이 끝나면 같은 (app, bundle_hash)로 통과한 app test의 증명 못 함에서 그 examples가 증명한 tool을 뺀 나머지를 앱 problem `rewind_unproven`으로 알린다. examples가 fail이면 빼지 않고, 판정할 수 없었으면 알리지 않는다. core가 요청을 보낼 때 app test pass 이유에서 증명 못 함을 읽어 live app credential과 함께 넘기고, runner가 결과를 기록한 뒤 보고한다(`packages/core/problems/tests/unproven.ts`). 검사별 증거는 observations blob에 hash만 남아 core가 읽을 수 없어 pass 이유 한 줄을 쓴다.
  - examples가 아닌 ticket은 알리지 않는다. release마다 알리면 examples가 이미 증명한 tool도 매번 경고가 되고, activation 때 알리려면 activation이 모르는 app test 증거를 apps → problems 경계 너머로 이어야 한다(열린 이슈 `project-docs/issues/activation.md`).
- **보고할 실패 분기는 ticket이 정한다.** 앱을 만들거나 기능을 더하는 ticket에 App Engineer가 분기와 이름을 적고, coding agent가 그 자리에 `reportProblem`을 둔다. 잡히지 않은 예외와 handler가 던진 `Error`는 진입점이 보고하므로 따로 두지 않는다. 앱 template의 `withStore`도 저장소를 여는 일만 `store_unavailable`로 보고하고 업무 일의 예외는 그대로 던진다.
- **끝나는 길마다 call은 한 번만 닫힌다.** 완료 보고, claim 만료, 보고 없는 끝은 domain event이고 Reactor가 같은 (handler, seq)로 두 번 일해도 한 번만 닫는다. 이미 취소되었거나 Router가 먼저 닫은 call은 닫지도 알리지도 않는다.
- **coding session의 place는 그 앱이고 받는 쪽은 그 앱의 App Engineer다.** 터미널은 app space의 패널 탭으로 열린다. 완료 보고, claim 만료, 보고 없는 끝과 coding agent의 메시지가 모두 그 App Engineer로 간다. 앱마다 App Engineer가 하나라 맡긴 App Engineer와 받는 App Engineer가 같다.
- **call cancel은 session을 멈추고 token을 회수하되 ticket은 열어 둔다.** 다시 맡길 수 있다. ticket 취소는 별개이고 ticket을 닫는다. "이 맡기기를 멈춘다"와 "이 일을 버린다"는 다르다.
- **skill과 hook은 harness의 사용자 전역 설정에 한 번 놓고, 놓기 전에 사람에게 묻는다.** 맡길 때 shell main이 `lophn harness install`을 `dry_run`으로 불러 없는지만 보고, 없으면 놓을 file을 보여 주고 묻는다. 허락하면 놓고 결과를 보인다. 거절은 기억하지 않고 다음에 다시 묻는다. 묻거나 놓기가 실패해도 맡기기는 막지 않는다(hook이 없어 상태가 unknown이고 메시지는 실패한다). `dry_run`은 우리 항목이 있으면 내용이 달라도 `unchanged`라 lophn이 업데이트돼도 다시 묻지 않는다. 개발 실행만 예외다. PATH의 `lophn`이 없거나 설치된 판이라, shell main이 `LOPHN_CLI` 경로를 hook command로 넘기고 그때의 `dry_run`은 우리 항목의 command가 다르면 놓을 것이 있다고 본다.
- **전역 설정은 사람의 다른 항목을 보존한다.** json hook 설정은 event마다 우리 항목(`lophn hook <harness> `나 개발 실행의 `<절대 경로> hook <harness> `로 시작하는 command) 하나만 두고 다른 key·hook·indent를 그대로 둔다. 파싱되지 않는 설정 file은 건드리지 않고 `failed`다. plugin file과 skill 폴더는 우리 것이라 내용이 다르면 덮는다. 설치를 하는 CLI 실행은 그 harness의 hook 설정 폴더와 skill 폴더의 쓰기 권한만 갖는다.
- **전역 skill은 얇고 절차는 `lophn guide <name>`이 낸다.** 전역 SKILL.md는 frontmatter와 "절차는 `lophn guide <name>`을 따른다"뿐이라 lophn이 바뀌어도 다시 놓을 일이 없다.
- **전역 hook은 lophn과 상관없는 harness 실행에서도 불린다.** coding token이 없으면 launcher가 deno를 띄우지 않고 끝나고, `lophn hook`도 stdin을 읽지 않고 아무것도 보내지 않은 채 성공한다. pi extension과 OpenCode plugin은 token이 없으면 hook을 등록하지 않는다.
- **첫 prompt는 argv의 한 인자로 넘기고 shell을 거치지 않는다.** quote나 escape를 조합하지 않는다. prompt는 ticket id만 싣고 본문이나 token을 복제하지 않는다. 본문은 agent가 CLI로 읽는다. argv로 못 넘기는 제품은 session 시작 hook을 받은 뒤 붙여 넣고, 기한이 지나면 넣지 않는다.
- **coding agent의 권한 mode는 lophn이 정하지 않는다.** harness의 권한 물음은 대기 목록에 보이기만 하고 답은 터미널 탭에서 한다. 대기 목록에서 누르면 그 탭으로 focus가 옮겨 간다.
- **coding 탭은 `BROWSER`(browser bridge)를 받지 않는다.** app space 패널에는 browser 탭을 열 pane이 없다. coding agent가 연 URL과 그 탭의 Ctrl/Cmd-click link는 OS browser로 간다([browser-tab.md](browser-tab.md)).
- **터미널을 열고 첫 hook 신호가 없는 coding session은 대기 목록에 "터미널에서 확인이 필요할 수 있다"로 보인다.** Claude Code는 처음 여는 폴더마다 folder trust를 묻고, 고를 때까지 hook이 돌지 않는다. 그래서 첫 신호가 `SessionStarted`인 harness의 coding session이 5초(`STARTING_QUIET_MS`) 안에 신호가 없으면 shell renderer가 항목(`coding_start`)을 넣는다(`packages/shell/renderer/desktop/connection/events/waiting-store.ts`). 세는 길은 둘이다. 터미널을 연 창은 runtime(`TerminalApi.onRuntime`)으로, 뒤에 연 창이나 다시 붙은 창은 snapshot에서 `unknown`이고 SessionStart가 있는 harness인 coding session으로 센다. 어느 길이든 delay와 지우는 조건은 같고, snapshot에서 첫 신호를 들은 session은 다시 세지 않는다. 누르면 그 탭으로 focus가 간다(detached 창의 탭이면 그 창을 앞으로 가져온다). 첫 신호(`SessionStarted` event), `SessionEnded`, 터미널 exit·unknown, 또는 snapshot에서 신호를 들은 session이면 지운다. lophn은 trust 화면을 알아보려고 화면 글자를 읽지 않고, 대신 답하지 않으며, `~/.claude.json`을 쓰지 않는다.
- **lophn이 꺼져도 PTY를 살려 두지 않는다.** 외부 session resume도 없다. 켤 때 claim이 남은 session은 모두 정산한다.

## 왜 이 모양인가

- **통로는 CLI와 앱 tool용 MCP 하나.** lophn 기능 전체를 내던 옛 MCP server와 toolset은 지웠고 되살리지 않는다. 지금 MCP endpoint는 앱 tool을 preview에서 부르는 데만 쓰고, 나머지(ticket, 메시지, release, hook)는 CLI다. 앱 tool은 harness가 tool로 부르는 것이 자연스럽고 선언이 이미 MCP tool 모양이라 MCP로 냈다. hook도 같은 CLI의 명령이고 session 환경 변수의 token으로 인증한다. orca(hook script가 POST)와 paseo(env token)도 같은 꼴이다.
- **hook으로 상태를 안다.** orca는 화면을 읽어 짐작하지만 lophn은 짐작하지 않는다. turn 끝 신호가 있는 제품은 Claude Code `Stop`, Codex `Stop`, Gemini CLI `AfterAgent`, OpenCode `session.status` idle(전역 plugin이 root session의 event만 넘긴다. 뒤따르는 deprecated `session.idle`은 같은 끝이라 듣지 않는다), pi `agent_settled`다. pi는 `agent_end` 뒤에 retry와 compaction이 남을 수 있어 끝이 확정되는 쪽을 쓴다.
- **hook을 앱 폴더가 아니라 전역에 한 번 놓는다.** 열 때마다 앱 폴더에 놓으면 앱 source에 harness 설정이 섞이고(release 제외 목록이 따라온다), 사람이 고친 file을 지키려고 hash 기록이 필요하다. 전역에 한 번 놓고 사람에게 묻는 쪽이 단순하다. 감지 표는 7종(Claude Code, Codex, OpenCode, Gemini CLI, pi, Hermes, OpenClaw)을 유지한다.
- **Hermes와 OpenClaw는 아직 맡길 수 없는 제품이다.** 전역 skill·hook 위치와 첫 prompt를 argv로 넘기는 방법을 확인하지 못해 칸이 비어 있다. 확인하면 전역 설치로 hook을 놓을 수 있다.
- **CLI 출력을 data fence로 감싸지 않는다.** 사용자 앱과 사람이 쓴 글은 공격자로 보지 않는다(AGENTS.md). 줄로 풀어 쓰고 `--json`이면 JSON 하나다.
- **busy 실패 대신 줄에 세운다.** 바쁨으로 돌려주면 다시 맡길 때를 보낸 쪽이 알 길이 없다. 앞 session의 끝은 앞 ticket을 맡긴 session으로 가고, 바쁨을 받은 쪽은 reaction으로 열린 다른 session일 때가 흔하다.
- **worktree로 나눠 session 여럿을 돌리지 않는다.** 합칠 쪽이 없다. App Engineer는 code를 짜지 않는다.
- **harness의 권한 물음에 lophn 화면으로 답하지 않는다.** 제품마다 물음의 모양이 달라 그 UI를 두면 쓸데없이 깨지기 쉬운 의존이 생긴다. focus를 옮기는 것은 제품과 상관없다.
- **첫 신호 대기는 core가 아니라 shell renderer가 센다.** core는 터미널이 열린 때 event를 내지 않고 시계를 밀 수 없어 delay를 걸지 못한다. shell은 terminal runtime을 이미 받고, "첫 신호"의 근거는 core의 `SessionStarted` event와 snapshot 하나뿐이다. snapshot이 coding session의 harness를 싣는 것은 뒤에 연 창이 runtime을 받지 않아 harness를 달리 알 길이 없어서다.
- **상태·정산·call 닫기를 같은 transaction에서 고친다.** session 상태가 writer 쪽 표에 있고 상태를 고치는 일이 정산, call 닫기와 한 transaction이어야 하므로, hook, 터미널 결과, Reactor, 메시지가 모두 command 하나로 writer에 들어간다.
- **사람은 coding agent와 직접 이야기하지 않는다.** 사람은 App Engineer에게 청하고, coding agent가 사람에게 말을 거는 길은 없다. 막히면 App Engineer에게 메시지를 보낸다. 닫혀 있으면 그 앱의 새 App Engineer session이 받는다.
- **메시지의 답은 App Engineer가 `call`로 보내야 터미널에 간다.** App Engineer가 `to:{session:"<봉투의 coding agent session>"}`, `reply:"conversation"`으로 `call`하면 Router가 열린 coding session을 `open_session`으로 풀고 transport가 PTY에 넣는다. 글로만 답하면(사람에게 한 요약 포함) coding agent는 받지 못한다. 그래서 coding agent가 보낸 call의 봉투가 이 길을 한 줄로 알린다([agent-call.md](agent-call.md)). core는 글을 대신 보내지 않는다. 답할지, 무엇을 답할지는 App Engineer가 정한다.

# agent-call

agent 사이의 일 맡기기와 답하기를 하나의 모양(call)으로 푼다. handoff, 결과를 받는 escalate, program의 알림이 모두 같은 봉투를 쓰고, 받는 곳과 답 방식만 봉투의 칸으로 다르다. 보낸 쪽은 기다리며 막히지 않는다. 답과 늦게 안 실패는 보낸 session의 새 입력으로 돌아온다. 사람에게 올리는 것은 call이 아니라 session 안에서 묻는 것이다(escalate는 이 뜻으로만 쓴다). 같은 규칙 위에서 agent가 session을 열어 팀을 꾸리고(spawn), 팀의 자식이 묻는 것을 부모에게 올린다.

## 문제

- agent마다 일을 맡기고 답을 받는 길이 따로 있으면 실패 처리, 권한 검사, 화면이 길마다 한 벌씩 생긴다. 조용히 사라지는 call이 하나라도 있으면 보낸 agent는 일이 진행 중인 줄 알고 영영 기다린다.
- turn이 분 단위이고 입력 하나가 turn 하나, turn이 곧 token이다. 보낸 turn이 결과를 기다리거나 재시도로 같은 일을 두 번 하면 비용이 곧바로 든다.
- 받은 글은 다른 agent(AI가 만든 글)가 쓴 것이다. 사람의 글과 구별되지 않거나, 받은 것이 곧 허락으로 읽히면 막아야 할 지시가 따라진다.
- workspace마다 agent가 열이라 어느 agent가 어느 workspace로 부를 수 있는지를 쌍마다 고르기엔 경우가 너무 많다. 한 앱이나 project를 통째로 떼어 놓을 방법도 필요하다.
- 일손을 늘리는 agent가 생기면 누가 누구에게 말할 수 있는지, 자식의 질문이 누구에게 가는지, 얼마나 늘릴 수 있는지가 정해져 있어야 한다.

## 목표와 비목표

- 목표: 사람 메시지, program 알림, agent의 call이 하나의 입구(Router)로 받는 session에 들어간다. 받는 곳(새 session, 열린 session)과 답 방식(none, result, conversation)만 다르다.
- 목표: 모든 실패가 이유와 함께 보낸 쪽에 한 번 돌아온다. 꺼졌다 켜져도 조용히 사라진 call이 없다.
- 목표: 받은 입력이 받은 turn에서도 뒤 turn의 이력에서도 같은 bytes로 사람의 글과 구별된다(prompt cache가 깨지지 않는다).
- 목표: 시야(어느 workspace로 부를 수 있나)는 사람이 크게 정하고(private, 쌍 규칙) 기본은 모두 허용이다.
- 비목표: 동기 호출, timeout, 자동 재시도, durable queue. 입력함은 메모리이고 잃은 것은 켤 때 정산한다.
- 비목표: call 자체를 판정하거나 사람에게 묻기. 받은 agent가 자기 할당으로만 일하는 것이 이미 일을 거른다.
- 비목표: 도는 turn에 다른 agent의 입력을 끼우기, 보낸 쪽 대화 원문 넘기기, 이름 짐작, read grant, A2A식 polling·SSE·webhook.
- 비목표: 사람에게 올리는 길. 그것은 call이 아니라 session 안의 질문과 승인이다(`architecture/approval.md`).

## 모델

```
 보낸 쪽                                  Router                                  받는 쪽
 ───────                                  ──────                                  ───────
 person (메시지)             ─┐           받는 곳 풀기                        ┌─ lophn session
 lophn call send|reply|cancel  ─┤       ├ 새 session   : agent handle+workspace로 하나 │   입력함(메모리)
 program (알림)              ─┘─ route ─▶ ├ 열린 session : session ID           │
                                          └ 둘 다        : 열려 있으면 거기,    ├─ harness session
                                            닫혔으면 fallback의 agent+workspace 새 session │   harness queue
                                          agent_calls 행: agent가 보낸 것만
                                          unattended 표시: 봉투, 입력, 행에 싣는다

 agent가 보낸 call이 call 정책 밖이면     ─▶ forbidden
 agent가 보낸 call이 팀 규칙 밖이면        ─▶ forbidden
 agent가 보낸 call을 받는 agent가 못 받으면 ─▶ invalid_input
   (셋 다 call 행도 새 session도 남지 않는다)
```

- **보낸 쪽**은 사람, program, agent session, 앱, 다른 컴퓨터의 agent 다섯이다. 앱은 앱 화면이 보낸다("앱이 보낸 call"). 다른 컴퓨터의 agent는 mail로 보낸다: 받는 기계의 Router가 mail을 같은 call id의 call로 돌리고, 답·실패·취소는 mail로 돌아간다(`architecture/machine-a2a.md`). program은 늦은 실패와 취소의 알림, `tools_changed` 알림, workflow의 step 메시지다(종류만 있고 근거 칸이 없다). step 메시지는 `kind: step`이고 call 행이 없다(`architecture/workflow.md`).
- **받는 곳**(`to`)은 셋 중 하나다. `{session}`(열린 session), `{agent, workspace?}`(새 session), `{agent, workspace?, session, fallback: "new"}`(열린 session, 닫혔으면 그 agent+workspace의 새 session). `agent`는 handle이고 workspace가 없으면 home이다. handle은 전역에 하나라(범위 있는 agent 포함) 하나로 풀린다. 단 handle `lophn`은 workspace마다 하나라 workspace와 짝으로 풀린다(`{agent: "lophn", workspace: X}`는 X의 lophn, workspace를 빼면 Home). agent가 보낸 call은 workspace를 빼면 부른 session의 workspace로 바뀐다(`lophn`과 spawn만, 다른 agent는 home 그대로). 그래서 workspace를 뺀 `lophn` call은 부른 쪽 workspace의 lophn에게 새 session을 연다. Home lophn은 Home에서 보낸 call이나 사람·program의 call로만 닿는다. 범위 있는 agent(`architecture/agent-definition.md`)는 그 workspace에 여는 call로만 닿고 다른 곳에 열려 하면 `not_found`다.
- **답 방식**은 none(답 없음), result(받은 agent가 reply로 결과 하나), conversation(양쪽이 같은 call에 말을 잇는다)이다. 칸은 program이 정한다: lophn과 custom 모두 셋이다(custom도 `lophn` tool로 `call.reply`를 늘 가진다).
- **상태**는 accepted, done, failed, cancelled 넷이다. 끝난 행은 다시 바뀌지 않는다. 배달 실패는 accepted를 거치지 않고 바로 failed로 생긴다. 실패 이유는 `not_found`, `closed`, `receiver_ended`, `lophn_restarted`이고, 다른 컴퓨터로 보낸 call만 `expired`, `skipped`, `old_version`을 더 받는다. 다른 컴퓨터로 보낸 call은 accepted인 동안 배달 상태(`pending`, `unknown`, `held`, `running`)를 따로 갖는다(`architecture/machine-a2a.md`).
  - none은 받는 turn이 입력을 가져갈 때(consumed) done이다. result는 받은 agent의 reply가 done으로 만든다. conversation은 program이 done으로 만들지 않고 취소나 실패로 끝난다.
- **`agent_calls` 행**은 agent, 앱, 다른 컴퓨터의 agent가 보낸 call과 workflow가 다른 컴퓨터로 넘긴 step에만 있다. 보낸 session, 보낸 앱(`<앱 id>|<slug>`), 보낸 컴퓨터의 agent 가운데 하나(다른 컴퓨터로 넘긴 step은 셋 다 없다), 풀린 받는 곳(`to`), 받는 session, 답 방식, 상태, 실패 이유, dedup 값, consumed, unattended, ask(`question` | `approval`, 팀의 ask call에만), 앱이 보낸 result call의 답 글(`result`), 다른 컴퓨터로 보낸 행의 배달 상태(`delivery`)와 그 기계에서 받은 session(`remote_session`)을 갖는다. 내용(body, refs)은 받는 session의 받은 메시지 기록에 있다.
- **부를 수 있는 session 목록**(`session.list`, route `calls/sendable`)의 항목은 session ID, agent handle·이름, 제목, workspace, 상태, 마지막 활동 시각이다. 상태는 running, waiting, idle, unknown이다. waiting은 도는 turn이 사람의 동의나 질문 답을 기다리는 것이고, 그 turn이 없으면 idle이다. 자기 자신과 닫힌 session은 빼고, 팀 member에게는 부모·형제·자기 밑만 보인다. GUI 탭 팀원(아래 28)의 상태와 제목은 그 탭의 ACP 상태에서 읽는다(harness 자신의 승인 card를 기다리면 waiting, 묶인 탭이 없으면 idle). `team read`의 상태도 같다.
- **call 읽기**(route `calls/read`)는 agent에게 자기가 보냈거나 받은 call만 보인다.
- **팀**은 spawn tree다. `lophn team spawn`으로 연 session은 연 session의 자식이고 `sessions.spawned_by`에 부모가 남는다(바뀌지 않는다). spawn은 새 session을 여는 call의 한 갈래라 call 하나를 같이 만든다. `call.send`의 `to: {agent, workspace}` 새 session은 `spawned_by`가 없는 팀 밖이다(Home lophn이 project lophn에 넘기는 흐름이 팀 규칙에 묶이지 않게).
- 팀은 화면과 탭 목록에도 쓰인다. session snapshot과 `SessionStarted`가 `spawned_by`를 실어 왼쪽 sidebar가 desk 묶음 안에서 자식 session 줄을 부모 줄 아래로 들여 그리고(다른 컴퓨터에서 도는 팀원의 자리는 snapshot의 `runs_on`으로 선다), `lophn tab list`는 자기 탭과 자기 밑(`spawned_by`를 거슬러 닿는) session의 탭을 낸다. 부모·형제의 탭은 보지 못한다(`architecture/workspace-layout.md` "agent가 연 탭").

## 지키는 것

### 구조

1. Router는 feature module을 import하지 않는다. session 목록, 배달, call 표는 port이고 wiring이 끼운다. 세 종류의 보낸 쪽이 모두 쓰는 입구라 한 module에 기대면 순환이 생긴다.
2. 보낸 쪽을 막지 않는다. 동기 호출, timeout, 자동 재시도가 없다. 입력 하나가 turn 하나이고 turn이 token이라 재시도가 곧 비용이다.
3. 입력함과 Bus는 main thread 메모리에 있고 command는 writer Worker의 tx에서 돈다. 그래서 입력함 적용은 tx가 commit된 뒤에만 한다. 되돌린 tx나 재전달은 입력을 넣지 않는다. 입력함을 표로 옮기면 durable queue라 쓰지 않는다. 이 길이 없으면 "commit됐는데 입력이 안 들어간" 틈이 생긴다.
4. 받는 session 기록의 본문은 blob이고 tx 안에서는 blob을 만들 수 없다. 그래서 call 본문(redaction 거친)과 고정 문구(늦은 실패 알림, 취소 알림)는 writer 앞 단계가 미리 blob으로 준비한다. 고정 문구가 몇 개뿐이라 쓰이지 않을 때의 낭비가 작고, inline 글로 바꾸면 받은 메시지 기록의 꼴(계약)이 바뀐다.
5. 새 session을 열지 열린 session에 보낼지는 보내는 쪽이 고른다. "있으면 보내고 없으면 연다"를 기본으로 두지 않는다. session을 열 때마다 token이 든다. "열린 session, 없으면 새 session"(`fallback`)은 놓치면 안 되는 사실을 돌려줄 때만 쓴다.
6. 받는 쪽의 앱(id, slug, 이름)과 project(id, 이름)는 정확히 맞아야 풀린다. 짐작하지 않는다. 앱은 id와 slug를 먼저 보고 표시 이름은 마지막에 본다(표시 이름만 unique가 아니고 이름 바꾸기로 겹칠 수 있다). 풀리지 않으면 `not_found`, 같은 이름이 여럿이면 `invalid_input`이고 오류에 후보 slug가 실린다. 지침은 앱을 slug로 가리키게 한다.
7. agent가 archived 앱 workspace로 보내는 call은 없는 앱과 같은 `not_found`다(사람, 2026-11-07). archived 앱은 agent에게 보이지 않는 규칙의 한 부분이다(`architecture/app-call.md`). 사람과 program이 같은 workspace를 여는 길은 `conflict`(closed) 그대로다. 이미 열려 있던 session 주소로 보내는 call은 그 session이 입력을 받지 않아 `closed`다.
8. 부르는 것 자체에는 묻지 않는다. call tool에 Gate가 없다. workspace 안에서 누구를 부를지는 지침과 workflow의 일이다(`products/AGENT.md` T5).
9. 받은 메시지는 허락이 아니다. 받은 agent는 자기 할당으로만 일한다(`products/AGENT.md` T6). program이 막는 것은 이것 하나다. "거절당한 일을 다른 agent에게 돌려 시키지 않기"는 의미 판단이라 program이 막을 수 없고 agent 지침에 둔다.

### 시야

10. 어느 workspace에서 어느 workspace로 부를 수 있는지는 call 정책이 정한다. 사람이 설정 `lophn-agent.call_policy`로 정한다. 아무것도 없으면 모두 허용이다.
    - `private`(project·앱의 목록): private workspace는 다른 workspace(home 포함)와 call을 주고받지 않고 안에서는 부른다. 들어오는 쪽·나가는 쪽을 나누지 않는다. home은 전역 agent가 어디서든 불리는 자리라 private이 될 수 없다.
    - 다른 컴퓨터의 앱을 부르는 호출(`app.call_tool`의 `remote` target, `architecture/app-call.md`)에도 `private`이 선다. 부르는 컴퓨터는 부른 agent나 앱의 workspace가 private이면 보내지 않고, 받는 컴퓨터는 대상 앱의 workspace가 private이면 받지 않는다. 각자 자기 call 정책의 `private` 목록으로 보고, `workspaces`·`agents` 쌍 규칙은 컴퓨터 사이에 보지 않는다(쌍의 key가 컴퓨터마다의 id다). 사람의 화면과 터미널은 private이어도 부른다. 다른 컴퓨터의 agent에게 맡기는 call(`calls/send_remote`)도 같다: 부르는 컴퓨터는 부른 session의 workspace가 private이면 보내지 않고, 받는 컴퓨터는 받는 workspace가 private이면 없는 workspace로 답한다(`architecture/machine-a2a.md`).
    - `workspaces`(workspace 쌍)와 `agents`(agent id 쌍): private 위에 두는 예외다. allow나 거절이다.
    - 판정 순서: agent 쌍 규칙 → workspace 쌍 규칙 → 같은 workspace면 허용 → private → 기본(허용). 같은 쌍이 여럿이면 먼저 적힌 것이 이긴다. agent 쌍 규칙은 workspace를 보지 않아 모든 workspace 사이에 닿는다(private도 뚫는다).
    - 고정 예외 하나: Home의 lophn(`lophn_home`)이 private workspace의 lophn(`lophn_<id>`)에게 `reply: none`으로 보내는 call은 private 검사만 통과한다. `app.sdk_decide`(`update-apps`)가 앱의 lophn에게 일을 넘기는 길이다. 그 command가 호출한 home session의 이름으로 같은 Router 길을 지나 보내므로 이 예외와 call 정책이 그대로 걸리고, 거절되면 결정 기록도 남지 않는다(`architecture/ui-kit.md`의 "SDK 결정과 맡기기"). 일은 들어가고 답·결과는 나오지 않는다. 앱 lophn이 낸 기능 결과(state와 한 줄 사유)만 `app.sdk_status`로 home에 보인다. `result`·`conversation`, 다른 home agent, lophn이 아닌 받는 agent, private 쪽에서 나가는 call은 그대로 막힌다. 이 예외는 agent 쌍·workspace 쌍 규칙을 이기지 않는다(그 규칙이 이 쌍을 막으면 막힌다).
    - Router는 agent가 보낸 call만, 받는 곳을 푼 뒤 명함 검사보다 앞서 본다. 거절은 `forbidden`이고 tx가 되돌아간다. 설정은 call마다 data root의 설정 file에서 읽어 바꾸면 다음 call부터 닿는다. 사람은 Settings › Agents의 "Calls between workspaces" 절에서 private workspace와 규칙을 더하고 지운다.
11. Router는 agent가 보낸 call을 받는 agent의 명함(`architecture/agent-definition.md`)과 대조한다. body의 block(`text` → text, `image` → image, `resource_link`·`resource` → file)이 명함의 입력 modality에 없거나 답 방식이 명함의 답 방식에 없으면 `invalid_input`이고 글에 받는 agent와 빠진 것을 적는다. 받는 곳을 푼 뒤 배달 전에 본다.
    - 사람 메시지, program 알림, workflow step, 답은 보지 않는다. 명함을 읽고 고르는 것은 부르는 agent라 막는 것도 agent의 고르기 실수만이다.
    - model이 이미지를 못 받는 것은 거절하지 않고 명함이 알린다.
    - 명함의 `callable`은 home·here만 묻고 Home에서 다른 workspace로 가는 고정 예외는 반영하지 않는다.
12. 다른 workspace의 session이 부른 call로 열린 session은 부른 workspace를 남긴다(`architecture/workspace-session.md`가 읽기 범위를 정한다).

### 실패

13. 실패는 조용히 버리지 않고 한 번만 알린다. 같은 실패를 tool 결과와 입력 둘로 받으면 agent가 두 번 반응한다.
    - 보낼 때 바로 아는 배달 실패(`not_found`, `closed`)는 agent에게 call tool 결과(`state: failed`, 이유)로만 돌려준다.
    - 배달 뒤에 늦게 아는 실패(`receiver_ended`: 받은 session이 답 없이 끝남, `lophn_restarted`)는 tool 결과가 이미 돌아간 뒤라 이유를 붙여 보낸 session에 새 입력으로 돌아간다. 보낸 session이 이미 없으면 알릴 곳이 없어 둔다. 끝나는 session 자신이 보낸 call의 알림은 받을 곳이 없다.
    - 사람이 보낸 쪽이면 오류 코드(`not_found`, `conflict`, `unavailable`)로 바로 돌려준다. program 보낸 쪽은 `state: failed`와 이유를 받는다. 보낸 쪽마다 꼴이 다른 것은 보낸 쪽이 더 늘 때 통일한다.
    - 이미 끝난 call(취소, Router가 먼저 닫음)에는 실패 알림이 다시 가지 않는다.
14. 이름을 풀지 못한 call은 행이 없다(받는 곳을 적을 수 없다). 이유와 call ID는 그대로 돌려준다. 끝난 행은 trigger가 막아 바뀌지 않는다. 이어지는 일은 새 call이다.
15. 닫힌 call에 늦게 온 답은 오류가 아니라 `closed: true`로 돌려준다. 받은 agent가 답이 전해지지 않았음을 알아야 한다. 답 없는 call(none)에는 답할 수 없고 `conflict`다. 당사자가 아닌 session의 답이나 취소는 `forbidden`이다.
16. 보낸 agent는 자기가 보낸 call만, 사람은 모두 취소한다. 받는 session이 그 call을 이미 가져갔으면 취소 알림을 보내고, 아직 가져가지 않았으면 그 입력을 queue에서 거둔다(알림 없음). 닫힌 call은 받는 session의 다음 turn 입력이 되지 않는다. 끝나는 session의 ask, 끝난 팀원 자리가 보낸 call, 다른 컴퓨터의 cancel도 같다. (agent, 2026-11-22. 전에는 가져가지 않은 call도 입력으로 남고 그 뒤 turn에 알림이 갔다)
17. dedup(보낸 session + tool call ID)은 unique다. run-loop는 일시 실패한 read tool을 같은 tool call로 한 번 더 부르고 call 보내기의 효과는 read라 그 대상이다. 첫 시도가 call을 만들고 실패로 돌아온 뒤의 재시도가 call과 session을 하나 더 만들지 않아야 한다. 같은 dedup은 처음 call의 결과를 그대로 돌려준다.

### 꺼졌다 켜질 때

18. 입력함은 메모리라 꺼지면 사라진다. 그래서 turn이 입력을 가져갔는지(consumed)를 행에 적고, lophn을 켤 때 accepted인데 가져가지 않은 call을 `failed(lophn_restarted)`로 닫는다. 이 기계에서 낸 팀의 ask call은 가져갔어도 닫는다(아래 "팀". 다른 컴퓨터의 팀원이 낸 ask는 짝이 그 컴퓨터에 있어 가져갔으면 둔다). 가져간 result call도 그 turn이 답 없이 끝나면 닫는다: turn이 재시작으로 끊기면 `failed(lophn_restarted)`, 실패하거나 멈추면 `failed(receiver_ended)`이고(agent runtime child만 사라져 끊긴 turn은 실패다) 보낸 쪽은 늦은 실패로 안다(다른 컴퓨터에서 온 call이면 실패 mail로 간다). 이유: 가져간 call을 accepted로 두면 부른 쪽이 받은 session이 보관될 때까지 기다린다. 정상으로 끝난 turn, 이미 답했거나 취소된 call, conversation call은 그대로다. 다른 컴퓨터에서 받은 workflow step은 닫지 않고 그 컴퓨터에 진행 줄 하나만 보낸다(`architecture/workflow.md` 51). (agent, 2026-11-21. 전에는 accepted로 남겼다)
    - 같은 tx에서 돌던 turn도 interrupted로 닫고, agent runtime이 turn을 읽기 전에 끝낸다. durable queue를 만들지 않는 대신 조용히 사라지는 call이 없게 하는 장치다. 입력함이 메모리인 한 켤 때 정산은 필요하다.
19. none은 받는 turn이 입력을 가져갈 때 done이 된다. 배달할 때 done으로 두면 켤 때 입력함과 함께 잃은 handoff를 위 장치가 가리지 못한다. 가져간 뒤에도 accepted로 두면 받은 session을 archive할 때 이미 넘어간 일에 `receiver_ended`가 가고 화면의 [Cancel]이 남는다.

### 내용

20. 보낸 쪽의 대화 원문은 넘기지 않는다. body와 refs만 간다. body는 redaction을 거친 뒤에만 받는 session 기록에 들어간다.
    - body는 MCP ContentBlock 꼴의 배열이다: `text`, `image {mimeType, blob}`, `resource_link`, `resource`. 사람 메시지(`SendMessage.content`)도 같은 꼴이다. 저장할 때는 block마다 메시지 content의 part 하나가 된다.
    - redaction은 글(text, link, resource text)에만 한다. 이미지는 bytes 대신 blob hash를 싣는다. 본문 상한(240 KiB)에 이미지가 들어가지 않기 때문이다. bytes는 보낸 자격이 먼저 올린 blob이다(사람 `message-images/upload`, agent `message-images/prepare`). 이미지를 담은 메시지가 생기는 같은 transaction에서 그 blob의 참조를 건다.
    - 넘길 것은 값으로 싣는다. agent는 `lophn call send|reply --image <path>`로 자기 session이 읽을 수 있는 file(file tool과 같은 workspace 안 검사, 180 KB 이하)을 image block으로 싣는다. 받는 쪽에는 그 file의 읽기 허락이 가지 않는다.
    - 이미지는 그 blob을 참조하는 메시지가 있는 session에서만 읽힌다. 다른 session은 hash를 알아도 읽지 못한다. 참조를 걸 때 blob store가 현재 자격이 그 hash를 준비했는지 확인하므로 남의 hash를 자기 메시지에 실어 읽기를 얻을 수도 없다.
21. unattended는 call을 따라 간다. unattended turn이 보낸 call과 답에 표시가 실리고(부른 agent credential의 turn mode에서 core가 찍는다), Router가 그 표시를 봉투, 입력함 입력, `agent_calls` 행에 옮긴다. 받는 turn은 그 입력으로 unattended가 된다(`architecture/approval.md`의 turn mode).
    - 답의 표시는 call 행이 아니라 답한 turn에서 온다. unattended call을 받은 session에 사람이 끼어들어 attended turn이 답하면 그 답은 attended다.
    - 늦은 실패와 취소 알림은 그 call 행의 표시를 따른다. 그러지 않으면 unattended 사슬의 알림 turn이 attended가 되어 사람 없이 shell `ask`에 멈춘다.
    - reaction과 화면의 사람 메시지는 표시가 없어 attended다. skip은 call을 따라 가지 않는다(사람이 정한 것은 그 대화다). 예외는 둘이다. `SendMessage`에 `unattended: true`를 실어 넣은 사람 메시지(run 입력, `architecture/run.md`)와 workflow가 넣은 step 입력(`architecture/workflow.md`)은 unattended turn을 연다.
    - agent call의 표시는 받은 메시지 기록과 태그 글에 넣지 않는다. 받은 turn과 뒤 이력이 같은 bytes를 만들고 mode는 turn 행에 남는다. run 입력은 메시지에 `unattended`를 남기되(켤 때 입력함에 되돌리지 않으려고) 태그 글과 받은 봉투에는 싣지 않는다. step 입력의 표시는 입력함 입력에만 있고 받은 봉투와 메시지에는 instance와 step 이름만 남는다.

### 순서와 이력

22. 입력함 순서는 사람 메시지가 먼저, 그다음 들어온 순서다. steer(도는 turn의 다음 model 요청 앞에 넣기)는 사람 메시지만 고른다. call, 답, reaction, 알림은 항상 다음 turn이다.
    - 아직 turn이 가져가지 않은 사람 메시지는 글을 고치거나 사람 메시지끼리 순서를 바꿀 수 있다. 고치면 redaction을 거친 새 본문 blob으로 메시지 본문과 blob 참조를 같은 transaction에서 바꾸고 입력함의 본문도 command가 돌려준 값으로 바꾼다. 고친 본문에는 이미 있던 image block만 남길 수 있다(새 이미지는 `invalid_input`). 이미지 참조는 본문 참조와 따로라 고쳐도 남는다. 순서는 이웃과 맞바꿔 켤 때 입력함에 다시 넣는 순서까지 같게 한다. 가져간 뒤에는 본문과 순서가 trigger로 고정된다.
23. 다른 agent·program이 보낸 입력(call, 답, reaction, 알림)은 받은 turn의 입력에서도 뒤 turn의 이력에서도 같은 함수로 태그에 싼다. 그 turn이 끝나도 사람 글과 구별되어야 한다. 사람 메시지는 싸지 않는다.
    - 결과는 part 목록이다. 순서는 tag를 여는 글과 본문 글 줄, 그 뒤 image part를 block 차례대로, 마지막에 닫는 글이다. `resource_link`·`resource`는 본문과 같은 escape를 거쳐 글 줄이 된다.
    - image part는 blob hash만 갖고, 읽을 때 같은 reader가 bytes를 붙인다(reader는 agent 자격으로 파일 경로를 푼다). 읽지 못한 이미지는 두 길 모두 `[image unavailable]` 글이 되어 깨진 이미지 하나가 session을 막지 않는다.
    - 두 길이 같은 bytes를 만들도록 받은 메시지의 봉투가 call의 답 방식(`reply`), reaction이 알리는 사실 이름(`event`), 실패한 답의 이유(`fail_reason`)를 같이 저장한다. 이 중 하나라도 이력에서 빠지면 call·reaction을 받은 turn 다음 요청부터 그 자리의 prefix가 달라져 cache가 한 번 깨지고, 답 방식 줄이 빠지면 결과를 받는 call을 받은 agent가 답해야 한다는 것을 잊는다.
24. 이력은 받은 순서가 아니라 turn 순서다. 앞 turn들이 가져간 message를 turn 순서로 놓고 그 turn의 입력을 붙인다. 받은 순서로 자르면 아직 아무 turn도 가져가지 않은 call이 앞 turn의 prompt에 들어간다.
25. session이 자기 답으로 남긴 메시지(보낸 쪽이 그 session 자신)는 이력에서 assistant role의 본문 글 그대로 넣는다. 다른 session이 보낸 것이 아니므로 call 태그로 싸지 않는다. 글이 없는 답(카드뿐)은 넣지 않는다.

### 답 보내기

26. lophn runtime의 result 답은 받은 agent가 reply로 직접 보내야 call이 done이 된다. lophn session은 저절로 끝나지 않아 program이 끝을 모른다.
27. custom runtime(`architecture/agent-definition.md`)은 result call을 받은 turn이 끝날 때 마지막 응답 글이 답이다. 받은 call 글도 "마지막 응답이 답이다. `lophn call reply`로 먼저 답했으면 그것이 답이다"로 알린다(harness와 같은 글).
    - core wiring이 turn 끝을 구독해, outcome이 completed이고, turn 입력이 result call이고, 그 call이 아직 이 session이 받은 accepted이고, turn이 고정한 agent가 custom이고, 그 turn의 마지막 agent 메시지 글이 비지 않았을 때만 보낸다. 답은 redaction과 본문 준비를 거쳐 machine 명령으로 reply를 부르고, agent의 reply와 같은 규칙이다. unattended 표시는 그 turn의 mode를 따른다.
    - 그 밖(멈춤, 실패, 빈 글, conversation·none call)에는 보내지 않는다. 멈추거나 실패한 turn이 가져간 result call은 지키는 것 18대로 `receiver_ended`로 닫힌다. 빈 글로 끝난 turn의 call은 lophn에서 답하지 않은 때처럼 accepted로 남고 받은 session을 archive하거나 지울 때 `receiver_ended`로 닫힌다. turn 도중 custom이 `call.reply`로 이미 답했으면 call이 done이라 다시 보내지 않는다(자동 답은 답하지 않은 때만 가는 안전망이다).
    - runtime 쪽(turn을 닫기 전)이나 tx 안에서 하지 않는다. 멈춘 turn에 답이 나가면 안 되고 본문 blob은 tx 안에서 만들 수 없다. 마지막 응답 읽기는 run의 결과와 같은 규칙이고 글만 싣는다(`architecture/run.md`).
28. harness runtime session은 run-loop 입력함이 아니라 harness queue가 받는다(`architecture/coding-agent.md`). 설정 `extensions.harness.enabled`(Settings › System › Extensions)가 꺼져 있으면 그 session으로 가는 메시지·call·step은 `unavailable`이다. 답은 custom과 같다.
    - GUI 탭 팀원(`architecture/harness-gui.md` "팀원")은 그 설정과 상관없이 받는다. project의 GUI 탭이 그 팀원이다. project에서 부른 내장 coding agent(call, `team spawn`)도 팀원으로 열리지만 core가 탭을 스스로 열어야 하므로 설정이 켜졌을 때만이고, 꺼져 있으면 지금처럼 `unavailable`이다(열린 탭이 없을 때만 그렇다: 사람이 연 탭의 팀원은 session으로 부른다). 그 queue는 그 탭이 쉴 때 하나씩 그 탭의 새 turn으로 들어가고, result call의 답은 그 입력을 가져간 turn의 마지막 agent 글이다(`lophn call reply`로 먼저 답했으면 그것).
    - 묶인 탭이 없는 팀원에게 입력이 오면 설정이 켜졌을 때만 core가 그 project에 터미널을 열어 그 CLI session을 resume하거나 새로 띄우고 거기 넣는다(사람 없이 도는 turn, project마다 8개까지, 할 일이 끝나면 닫는다). 그 turn이 harness 자신의 승인 card에 닿으면 사람이 탭에서 답할 때까지 기다린다.
    - 팀원 session은 archive되지 않고 열린 채라 13의 `receiver_ended`가 저절로 오지 않는다. 그래서 result call을 가져간 turn이 답 글 없이 끝나거나(멈춤, 실패, 탭·handle 닫힘이나 restart 탭의 TUI 전환), 사람 메시지가 연 turn이 그 call을 가져갔거나, 30초 안에 turn이 열리지 않거나, 탭을 열 수 없으면(설정 꺼짐, 상한, 실패) core가 그 call 하나를 `receiver_ended`로 닫는다. 사람이 그 coding session을 Recent에서 지우면 팀원 session이 보관되어 받은 열린 call도 같이 닫힌다. 아직 가져가지 않은 call은 탭이 TUI를 보이는 동안 기다린다.

### 팀

29. 팀의 규칙은 넷이다.
    1. spawn은 늘 내 밑이다. 부모는 입력이 아니라 자격의 session이다. `--workspace`가 없으면 부모의 workspace다. spawn은 새 session을 여는 call의 길을 그대로 거쳐 받는 곳 풀기, call 정책, 팀 규칙, 명함 검사가 같다. spawn의 실패는 call의 실패가 아니라 오류로 돌려준다(팀이 가득 찬 `conflict`가 `closed`로 바뀌지 않게).
    2. `spawned_by`가 있는 session의 call은 부모, 형제(같은 부모), 자기 자손에게만 간다. call 정책 다음에 보고 아니면 `forbidden`이다. call 정책은 그 위에 그대로 겹친다. root(`spawned_by` 없음), 사람 메시지, program 입력, reply·cancel은 거르지 않는다. 팀 밖에서 팀원에게 오는 call도 지금 규칙 그대로다. member의 `session list`도 같은 집합만 보인다.
    3. 끝내기(`lophn team end <ses>`)는 자기 엄격한 자손만이다. 대상과 그 밑의 열린 session을 잎부터 archive처럼 닫는다(다른 컴퓨터에서 도는 팀원은 29a). 남의 자손이면 `forbidden`이다. 사람이 부모를 archive하거나 지워도 자식은 남는다. 끝난 session이 다른 session에게서 받은 browser 탭은 준 session에게(끝났으면 사람에게) 돌아간다(`architecture/workspace-layout.md` "agent가 연 탭"의 주기).
    4. session은 자기가 든 browser 탭을 자기 엄격한 자손에게 준다(`lophn tab give <tab> --to <ses>`, 되찾기는 `--back`). 자손이 아니면 `forbidden`이다. 팀의 시야(2)처럼 자식은 부모·형제의 탭을 가져오지 못한다.
29a. `team spawn --on <컴퓨터>`(`team/spawn_remote`)는 팀원을 사람의 다른 컴퓨터에 연다. 이 컴퓨터에는 부모 밑에 팀원의 자리(`sessions.runs_on`, 그 컴퓨터의 handle, 부모의 workspace)가 생기고 두 컴퓨터가 같은 session id를 쓴다. 자리는 이 컴퓨터의 팀 상한과 깊이에 세이고(30) 팀 규칙은 이 컴퓨터가 건다. 받는 곳(workspace) 풀기는 `call send --on`과 같고 workspace를 빼면 부모의 workspace다. 그 컴퓨터가 꺼져 있어도 바로 돌아오고 그 컴퓨터에서의 실패는 늦게 call의 실패로 온다(돌기 전의 실패면 자리도 닫힌다). 팀원은 어디에도 자식을 열지 못하는 잎이다. 자리는 이 컴퓨터의 queue로 입력을 받지 않는다: 이 컴퓨터 agent의 call은 call 정책과 팀 규칙(2)을 거친 뒤 그 컴퓨터로 가는 mail이고(`call send --on`으로 자리 id를 가리켜도 같다), 사람 메시지와 그 밖의 입력은 닫힌 session과 같다. 자리의 agent는 그 컴퓨터의 handle이라 call 정책은 workspace 규칙만 맞는다(agent 쌍 규칙은 맞지 않는다). 팀원이 그 컴퓨터에서 보낸 mail은 이 컴퓨터에서 자리가 보낸 것처럼 call 정책, 팀 규칙, 명함 검사를 거친다. 팀원의 `ask`는 이 컴퓨터의 부모에게 온다(33). 끝내기(3)와 사람의 보관은 자리를 이 컴퓨터에서 곧바로 닫고 그 컴퓨터에 그 session을 닫으라는 mail을 낸다. 부모가 끝나면(보관, 지움, 끝내기) 그 밑의 자리도 같이 닫힌다. 그 컴퓨터에서 session이 끝나면 자리도 닫힌다. 닫힌 자리는 팀원이 아니다(자리로 보낸 call은 `closed`). 자리가 끝나면 그 팀원의 열린 ask는 두 컴퓨터에서 닫힌다. 팀원은 자기를 연 컴퓨터로만 새 call을 보내고, 팀원이 아닌 다른 컴퓨터의 mail이 연 session은 어느 컴퓨터로도 새 call을 보내지 못한다(`architecture/machine-a2a.md` 지키는 것 7). 자리는 session 목록과 session read에 없고 `team read`와 session snapshot에 선다(`architecture/machine-a2a.md` "다른 컴퓨터에 연 팀원"). (agent, 2026-11-22)
30. 팀 상한은 설정 `lophn-agent.team`(기본 `max_members: 8`, `max_depth: 2`)이다. core는 desk를 모르므로 root session 아래 열린 자손 수와 새 자식의 깊이(root 0)로 센다. desk는 root가 있는 자리라 같은 뜻이다. 넘으면 `conflict`이고 tx가 되돌아가 session도 call 행도 남지 않는다. 거절 글은 "do the work yourself or ask your parent"로 끝나고 agent의 tool 결과에 그대로 실린다(`team spawn`의 conflict·forbidden은 이 컴퓨터의 core가 쓴 고정 글이라 싣는다. 그 글이 없으면 agent가 spawn을 되풀이한다). 설정은 call 정책처럼 data root 설정 file에서 spawn마다 읽는다.
31. 연락처는 prompt가 아니라 `lophn team read`(`team/read`)다. 부모, 형제, 자식의 handle·이름·description·runtime·상태와, caller가 그 팀원에게 보내고 아직 답을 받지 못한 call(`open_calls`)이다. 다른 컴퓨터에서 도는 팀원은 그 컴퓨터 이름(`computer`)과 spawn call의 배달로 읽은 상태(`pending`, `held`, `running`)이고 description과 runtime은 없다. lophn 자식이 `call reply`를 잊으면 부모가 깨지 않으므로 부모가 이것으로 알아챈다. 팀이 바뀌면 turn을 준비할 때 앞에 본 팀(부모·형제·자식의 session ID와 handle 줄)과 비교해 고정 글 notice `team_changed`를 대화 끝에 붙인다(`tools_changed`와 같은 길). 입력함에 입력으로 넣지 않으므로 쉬던 session을 깨우지 않고 그 session의 다음 turn에 닿는다. custom은 팀을 보지 않는다.
32. `team spawn`의 `--reply` 기본은 result이고 첫 call 본문 앞에 core가 고정 글을 붙인다. 직접 하라, 끝나면 `call reply`, 모르면 `ask`(부모에게 간다), spawn한 뒤 turn을 끝내고 poll하지 마라. 같은 말이 `team spawn` help와 skill `lophn-agent`에 있다. system prompt에는 넣지 않는다(prompt cache). 받은 메시지로 저장되어 이력 재생이 같은 bytes다.
33. 팀의 ask call. 자식의 질문과 shell 승인은 부모에게 가는 result call이다(`architecture/approval.md` "팀 자식의 물음"). core main thread가 machine 명령으로 자식 이름의 call을 연다. call 정책, 팀 규칙, 명함 검사를 그대로 거친다. 행의 `agent_calls.ask`(`question` | `approval`)가 표시다. call과 request·질문의 짝은 request처럼 main thread 메모리에 있다.
    - 답(`call reply`)은 자식의 입력함으로 배달하지 않는다. Router가 call을 done으로 두고 commit 뒤 topic `router.ask-answered`를 내면 main thread가 짝을 푼다. 승인 call의 답은 `decision`(`allow` | `reject`)이 있어야 하고 다른 call의 답은 `decision`을 싣지 못한다(`invalid_input`). 허락은 이번 한 번뿐이고 `always`는 없다. harness·custom 부모의 자동 답이 승인 call에 닿으면 `reject`다.
    - 자식 쪽이 먼저 끝나면 main thread가 취소하고 부모는 취소 알림을 받는다. 부모가 끝나 `receiver_ended`면 자식 입력함에 실패 알림을 넣지 않고 topic `router.ask-ended`로 기다리는 쪽을 거절로 푼다.
    - 재시작하면 짝이 메모리와 함께 사라진다. 그래서 켤 때 `lophn_restarted`로 닫는 call에 부모가 이미 가져간 ask call도 넣는다. 자식에게는 알리지 않는다(자식 turn은 같은 recover에서 interrupted로 닫힌다). 부모의 늦은 답은 `closed: true`다.
    - 다른 컴퓨터에서 도는 팀원(29a)의 ask는 그 컴퓨터의 사람이 아니라 연 컴퓨터의 부모에게 가는 call mail이다(부모가 그 컴퓨터에 없으면 연 기계로 낸다). 거름은 연 컴퓨터가 하고, 부모의 답과 결정은 reply mail로 돌아가 그 컴퓨터의 짝을 푼다. 답이 아닌 끝은 짝을 거절로 푼다. 그 컴퓨터가 다시 켜지면 위 규칙대로 그 ask call을 닫고 연 컴퓨터에 취소 mail을 낸다.
34. agent가 연 새 session은 모두 탭으로 열린다. call이 새 session을 열거나(agent 이름으로 보냈거나 `fallback` session이 닫혀 새로 열린 경우) spawn이 session을 열면, commit된 뒤 router wiring이 host queue에 탭 열기를 요청한다(한 session에 한 번: spawn은 아래 relation을 싣는 요청이 하나이고 Router는 spawn이 아닌 call만 따로 알린다). 탭은 그 session의 workspace에 열리고 주인은 연 session이다. 같은 workspace면 연 session이 source이고 자리를 고르지 않고 무엇인지(`relation`)만 싣는다. `team spawn --as peer|stage`가 그 값이고 없으면 peer다(peer는 같은 일을 나눠 하는 동료, stage는 다음 단계나 다른 일을 맡는 coordinator). 그냥 call이 연 session은 `stage`다(연 탭 바로 뒤의 plain 탭이고 split 칸을 만들지 않는다). 다른 workspace의 session은 source 없이 그 workspace의 Main desk 끝에 열린다. 자리는 renderer의 `openAt()`이 정한다(`architecture/workspace-layout.md` "agent가 연 탭"). 이미 열린 session으로 보낸 call과 같은 dedup의 다시 보내기는 탭을 열지 않는다. 앱이 보낸 call이 연 session(`opened_by_app`)은 앱 화면이 자리라 탭을 열지 않는다. GUI 탭 팀원으로 열린 session은 Agent 탭을 열지 않는다(그 터미널 탭은 입력을 넣을 때 core가 연다). layout은 보이는 방식일 뿐이라 사람이 탭을 옮겨도 팀은 바뀌지 않는다.

### 앱이 보낸 call

36. 앱은 call의 한쪽이다(view-first): 앱 **화면**(shell main이 앱을 정한다)이 `app_calls/send`로 agent나 보이는 session에 일을 맡긴다. 앱 process(handler, 시작 code)에는 이 길이 없다. 앱 code는 AI가 만든 코드일 수 있고, process가 사람이 지켜보지 않는 turn(unattended)으로 상한 없이 session과 model 호출을 만들 수 있어서다. 그래서 앱이 보낸 call은 모두 사람이 앱 화면에서 보낸 것이고 attended turn이다. 앱은 입력에서 자기를 말하지 않는다. shell main이 앱을 정해 싣고 core wiring가 core 안 machine 명령 `calls/app-send`로 Router에 넣는다. Router는 앱의 지금 slug로 보낸 쪽을 얼린다(`{kind: app, app, slug}`). 받은 message의 `from_ref`는 `<앱 id>|<slug>`이고 입력 tag는 `from="app:<slug>"`다. slug를 message에 얼려 이력 재생의 tag가 늘 같은 bytes다(앱 이름이 바뀌어도). 입력 끝의 고정 줄은 앱이 보냈다고 말하고("This was sent by an app …") agent가 보낸 call의 줄은 그대로다(prompt cache).
37. 앱이 닿는 곳은 그 앱 workspace에서 call 정책(시야 10)이 허락하는 workspace의 agent와 session이다. agent 쌍 규칙과 팀 규칙은 앱에 없다(앱은 agent가 아니다). 명함 검사(11)는 그대로다. workspace를 뺀 call은 그 앱 workspace에 열린다(앱 화면이 여는 session과 같다). 받는 곳의 workspace 이름은 agent의 call과 같은 모양이고 `{home: true}`로 Home을 밝혀 적을 수 있다(전역 agent를 Home에서 부른다. 같은 정책을 받는다). 앱이 불러 새로 열린 session에는 `sessions.opened_by_app`이 달리고, 그 앱은 그 session을 끝낼 수 있다. 그 표시는 앱 wiring이 machine 명령으로만 단다(사람 자격의 `OpenSession`은 표시를 받지 않는다).
38. 앱이 보내는 답 방식은 none과 result뿐이다(앱에는 대화를 이을 queue가 없다). 앱 call은 선택 `key`로 dedup한다: 같은 앱의 같은 key는 첫 call을 돌려준다(`agent_calls`의 `(from_app, dedup)` unique index, Router의 dedup 경로). SDK가 `send`마다 key를 만든다.
39. 앱에는 보낸 session 같은 입력함이 없어 답은 call 행에 글로 남는다(`result`, 글 block만, 이미지 등은 담기지 않는다). 끝남(답, 실패, 취소, 답 없는 call의 소비)은 commit 뒤 발행자 `lophn`의 `call.settled`(call, state, fail_reason) event로 그 앱에만 간다(`architecture/event.md`). 보낸 앱의 열린 화면이 듣는다. event는 저장되지 않고, 켤 때 닫힌 call(`lophn_restarted`)의 event는 가지 않으며 놓친 앱은 `app_calls/read`로 읽는다. 늦은 실패·취소를 보낸 쪽 입력으로 돌려주는 길(agent 보낸 쪽)은 앱에 없다.
40. 답 글은 받은 session의 기록과 같은 수명이다. 받은 session을 지우면(`DeleteSession`) 그 session이 받은 앱 call 행이 같이 지워지고, 앱을 지우면 그 앱이 보낸 call 행이 지워진다. agent가 보낸 행은 글이 없어 그대로다.

### 화면

35. 화면의 call 블록은 펼치지 않는다. 머리 줄이 답 방식에 맞는 말(none은 "Handoff to", result는 "Asked", conversation은 "Working with")과 받는 곳이고 오른쪽 끝 [Open conversation]이 받은 session을 연다. 끝나지 않은 call은 사람이 [Cancel]로 취소한다. 실패만 그 자리에 이유 한 줄로 보이고, 답과 늦게 안 실패는 이어지는 새 메시지다. 다른 컴퓨터로 보낸 call은 받는 곳 뒤에 컴퓨터 이름을 붙이고, 끝나지 않은 동안 배달 상태 한 줄(닿지 않음, 그 컴퓨터의 대기 목록에서 기다림, 그 컴퓨터에서 도는 중, 닿았는지 모름)을 보이며, [Open conversation]은 그 컴퓨터에서 받은 session을 알 때만 서서 그 컴퓨터의 session을 연다(`architecture/machine-a2a.md`).

## 경계와 계약

- boundary-catalog: `router`(사람 메시지, agent call, program의 반응을 받는 session에 넣는 단 하나의 입구).
- route(resource `calls`): command `calls/send`(`SendCall`: `to`, `reply`, `body`, `refs`, `dedup`), `calls/reply`(`ReplyCall`: `call`, `body`, `refs`, 선택 `decision`), `calls/cancel`(`CancelCall`), read `calls/sendable`(`ListSendableSessions`), `calls/read`(`ReadCall`). machine 명령으로 `calls/recover`(켤 때 정산, core 자격만), `calls/auto-reply`(custom의 자동 답), `calls/ask-open`, `calls/ask-withdraw`(팀의 ask call). 오류 코드는 공통 일곱 중 `invalid_input`, `forbidden`, `not_found`, `conflict`, `unavailable`, `unauthorized`다. `send`의 결과는 `{call, state, fail_reason}`, `reply`의 결과는 `{delivered, closed}`다.
- 팀 route(resource `team`): `team/spawn`(`SpawnTeamMember`: `agent`, `workspace?`, `reply`, `body`, `dedup`. 결과 `{session, call}`), `team/spawn_remote`(`--on`, `architecture/machine-a2a.md`), `team/end`(결과 `{ended}`), `team/read`(`ReadTeam`. 항목의 `computer`, 다른 컴퓨터의 팀원은 runtime null과 상태 `pending | held`).
- 다른 컴퓨터로 보내는 call: `calls/send_remote`(`SendRemoteCall`)와 mail 계약은 `architecture/machine-a2a.md`다.
- CLI·tool: `lophn call send|reply|cancel`(`--image <path>`, 승인 call의 답은 `--allow | --reject [--body]`), `lophn team spawn|read|end`, `lophn session list`, `lophn agent list`, `lophn agent card`. `call send`, `session list`, `agent list`, `agent card`는 `--on <컴퓨터>`로 사람의 다른 컴퓨터에 닿는다. 같은 일을 하는 lophn tool이 있다(`call.send`, `call.reply`, `session.list`).
- 저장: ledger 표 `agent_calls`(위 "모델")와 `sessions.spawned_by`, `sessions.runs_on`(다른 컴퓨터에서 도는 팀원의 자리), `sessions.called_from_kind`·`called_from_id`. 설정 `lophn-agent.call_policy`(`{private, workspaces, agents}`), `lophn-agent.team`(`{max_members, max_depth}`), `extensions.harness.enabled`. `private`이 없던 옛 call 정책 설정은 data step이 빈 목록으로 채운다.
- 앱이 보낸 call route(core 안 machine): `calls/app-send`(`SendAppCall`), `calls/app-cancel`(`CancelAppCall`). 앱 화면이 부르는 route(resource `app_calls`, actor user. shell main이 앱을 정해 싣는다): `send`(`to`, `reply`, `text`, 선택 `key`), `read`(이 앱이 보낸 것만), `cancel`, `list`(보이는 session이 받았거나 보낸 call 최대 50), 그리고 `app_agents/list`(앱 workspace에서 부를 수 있는 agent 명함. reader의 `agents/cards`를 쓴다). 앱 process에는 broker 길이 없다.
- 입력 봉투(`RoutedInput`): 종류(message, call, reply, reaction, step 등), from, call, reply_to, body, refs, delivery, 답 방식, 결과(outcome), event, notice, step, unattended.
- 내부 topic: `router.team-spawned`(spawn commit 뒤 탭 열기), `router.ask-answered`, `router.ask-ended`, `router.app-call-settled`(앱이 보낸 call이 끝남).
- 고정 글: 늦은 실패 알림(이유마다 하나), 취소 알림(글 없음, 알림 종류가 말한다), 팀 지시문, `team_changed`.
- 판정 규칙은 protocol에 있는 순수 함수라 core와 화면이 같은 규칙을 쓴다(call 정책, 팀 규칙).

## 결정

- **call 하나의 모양.** handoff, escalate, program 알림을 따로 만들면 실패 처리와 화면이 세 벌이 된다. 다른 것은 받는 곳(새 session, 열린 session)과 답 방식(none, result, conversation)뿐이다. 선례: A2A의 id 없음/taskId, Erlang의 cast/call.
- **동기 호출과 subagent는 버렸다.** turn이 분 단위라 보낸 turn이 결과를 기다리면 맞지 않는다(Erlang call 5초, Orleans의 turn 점유). 답은 Akka ask의 pipeToSelf처럼 보낸 session의 새 입력으로 온다. A2A의 polling, SSE, webhook도 쓰지 않는다.
- **Orleans식 "없으면 만든다"를 버렸다.** session을 여는 것이 token이라 보내는 쪽이 명시해야 한다.
- **dead letter를 버렸다.** 조용히 버리면 보낸 agent는 일이 진행 중인 줄 안다. Erlang monitor의 DOWN처럼 이유를 돌려준다.
- **상태는 accepted, done, failed, cancelled 넷이다. `sent`와 `declined`가 없다.** Router가 행 만들기와 입력 넣기를 한 번에 해서 sent로 머무는 때가 없다. declined와 done을 나눠도 program이 다르게 하는 일이 없고 "맡지 않겠다"는 글은 보낸 agent가 읽을 의미다. 그래서 맡지 않을 때도 reply로 이유를 보낸다. 봉투의 여는 방식 칸(tab, tui, headless)도 transport마다 값이 하나뿐이라 뺐다. 되살리고 싶어지면 이 이유를 먼저 본다.
- **주소는 session ID다.** 사람이 읽는 label은 표시용이다. 보이는 이름은 겹칠 수 있어 주소가 아니다(agent의 주소는 handle이다). 열린 session 목록은 prompt가 아니라 tool result(`session.list`)로만 주어 prompt cache를 깨지 않는다. workspace prompt의 "Agents you can call"은 session ID 없이 agent의 handle(이름이 다르면 함께)만 싣고(그 workspace에서 보이는 agent: 전역과 그 workspace의 범위 agent, 그 workspace의 lophn), session이 아직 없는 agent도 넣는다. call이 새 session을 열 수 있기 때문이다. 어느 workspace에서 열지는 보내는 쪽이 고른다.
- **call을 판정하지 않는다.** 예전에는 call tool이 turn 안에서 묻고 Router가 tx 안에서 한 번 더 판정해 둘을 `gate_allowed`로 이었다. 부르는 것을 막아도 받은 agent의 할당이 이미 일을 거르고, 사람이 workflow에서 "call 금지 같은 딱딱한 규칙을 두지 않는다"고 정했다(`project-docs/products/roadmap/approval.md`). 0.6.0에서 판정을 없앴다.
- **도는 turn에 끼우지 않는다.** 조사한 harness 대부분은 도는 turn을 끊지 않고 다음 model 요청 앞에 붙인다. lophn은 사람의 "그만"만 급하다고 보고 사람 메시지에만 steer를 열었다. 다른 agent의 입력까지 끼우면 입력 하나가 turn 하나라는 셈이 흐려진다.
- **넘길 것은 값(content block)으로 싣고 읽기 grant를 만들지 않는다.** call 동안 file을 읽게 해 주는 장치를 두면 grant의 범위와 끝을 따로 관리해야 한다. 값으로 실으면 부른 쪽이 봉투에 실은 것이 곧 불린 agent에게 여는 시야다. block 꼴을 MCP ContentBlock에서 빌린 것은 ACP와 MCP tool 결과가 같은 꼴이라 harness 쪽과 그대로 이어지기 때문이다.
- **원문 넘기기와 fuzzy 매칭을 버렸다.** OpenAI handoff의 history 전달은 맥락 비용과 오염이 크고, CrewAI식 비슷한 이름 짐작은 엉뚱한 agent에게 일을 맡긴다.
- **reply 명령을 모르는 runtime은 turn 끝의 마지막 응답이 답이다(agent, 2026-11-04).** custom은 처음에 고른 tool만 받아 `call.reply`를 고르는 것을 잊으면 result call이 영영 accepted로 남아 부른 쪽(workflow 포함)이 멈췄다. 지금은 custom도 `call.reply`를 늘 가지지만 `lophn call reply`를 잊는 model이 있어 자동 답을 안전망으로 남긴다. lophn은 reply 명령 그대로다. lophn은 한 turn에 답 말고도 할 말이 많아 마지막 응답을 답으로 보면 틀린다. 자동 답은 runtime 쪽이나 tx 안이 아니라 core wiring이 turn 끝을 보고 한다(agent): 멈춘 turn에 답이 나가지 않고 본문 blob은 tx 밖에서 만든다. 답하지 못한 call에 새 실패 길을 더하지 않았다.
- **바로 난 배달 실패는 call tool 결과에만 두고, 늦은 실패만 입력으로 돌린다(agent).** call tool 계약("If it fails, the result says why")을 바꾸지 않으려는 것이다. 같은 실패를 둘로 받으면 agent가 두 번 반응한다. 버린 안: agent는 입력 통지만 두기. 보낸 쪽마다 다른 꼴을 통일하는 것은 보낸 쪽이 늘 때로 미뤘다.
- **custom이 받은 call의 경계는 tag 이름과 메시지마다 붙는 고정 글이 알린다(agent).** 인터넷에서 온 것만 `<lophn-untrusted>` 한 줄로 알린다.
- **이력도 입력과 같은 함수로 싼다.** 처음에는 받은 turn의 입력만 싸고 이력은 원문이었다. 그러면 다른 agent(AI가 만든 글)의 지시가 다음 turn부터 사람의 글과 구별되지 않아 사람의 요청처럼 따라질 수 있다. 막는 것이 "AI가 만든 글"이라 남기는 쪽이다. 답 방식 같은 속성을 이력에 두려고 받은 메시지 봉투에 저장하는 쪽을 골랐다(받은 turn의 입력에서 속성을 빼는 안을 버렸다). 자기 답을 call로 싸던 오류는 assistant role로 바로잡았다.
- **call 정책의 시야는 사람이 workspace 정책으로 크게 정하고 기본은 모두 허용이다(사람, 2026-11-04).** workspace마다 agent가 열이면 agent 쌍을 하나하나 고르기엔 경우가 너무 많다. project → 앱의 lophn 같은 lophn 자신의 위임을 program이 고정 표로 막지 않는다. 먼저 있던 기본 거절 표는 agent의 추천이었고 lophn의 container 넘는 위임을 막아 되돌렸다.
- **private은 방향 없이 workspace를 통째로 떼어 놓는다(사람, 2026-11-05).** 들어오는 쪽·나가는 쪽을 나누면 경우가 너무 많아진다. 기본은 public이고 home은 private으로 고르지 않는다. home은 전역 agent가 어디서든 불리는 자리다(agent 추천을 사람이 받음). 쌍 규칙이 private보다 앞서 예외가 되고 agent 쌍 규칙은 모든 private workspace를 뚫는다(agent 추천을 사람이 받음).
- **Home의 lophn → private lophn의 `reply: none` call만 private의 고정 예외다(사람, 2026-11-07).** `app.sdk_decide`가 앱의 lophn에게 일을 넘기는 길이다. home을 통째로 열면 home의 전역 agent가 private에 일을 넣고 결과를 받아 가 private의 뜻이 없어진다. 그래서 답·결과가 나오지 않는 handoff만 연다.
- **archived 앱으로 가는 agent의 call은 `not_found`다(사람, 2026-11-07).** archived 앱은 agent에게 없는 앱이다. 사람과 program은 `conflict`로 닫힘을 안다.
- **불려서 열린 home session은 부른 workspace를 남기고 실어 보낸 것만 본다(사람, 2026-11-04, 추천대로).** 이미 열린 home session에 닿은 call과 사람이 연 home session은 좁히지 않는다.
- **model이 이미지를 못 받아도 거절하지 않고 명함이 알린다(agent).** 차이는 system prompt에 싣지 않고(cache) 명함과 한 줄 목적으로만 알린다.
- **lophn session의 waiting 구별.** 한때 reader가 허락 기다림을 못 본다고 waiting을 빼고 running으로 보이게 했다(구별이 필요해지면 turn 행에 적는 쪽). 지금은 도는 turn에 사람 동의를 기다리는 tool call이나 시작한 `ask`가 있으면 waiting으로 낸다. 보내는 쪽은 running이든 waiting이든 다음 turn 입력으로 같은 곳에 들어간다.
- **팀은 spawn tree이고 규칙은 세 줄이다(사람, 2026-11-08).** 일손을 늘리고 줄이는 것과 누가 누구에게 말할지를 연 관계 하나로 정한다. layout group을 팀으로 쓰면 사람이 탭을 옮길 때 팀이 바뀐다. 연락처를 prompt에 싣지 않는 것은 팀원이 늘고 줄 때마다 prompt cache가 깨지지 않게 하려는 것이다.
- **agent는 탭의 자리가 아니라 뜻을 말한다(사람, 2026-11-09).** 예전에는 `--place beside|group|float`로 자리를 골랐고 core가 팀 자식에 `group`을 박았다. 뜻을 아는 쪽이 없어 팀의 단계가 따로 group이 되지 않았고 browser-use 탭은 둘 곳이 없었다. 이제 agent는 `--as peer|stage|aside|work|glance`로 연 탭이 자기에게 무엇인지만 말하고, 자리는 renderer의 한 정책이 정한다. core는 자리를 고르지 않고 relation을 그대로 전한다. 말하지 않으면 null이고 target마다 기본을 renderer가 정한다.
- **팀 상한은 root session 아래 열린 자손 수로 센다(사람이 확인).** core는 desk를 모른다. 기본은 처음 `max_depth: 3`, `max_members: 16`이었다가 `max_depth: 2`, `max_members: 8`로 줄였다.
- **`team_changed`는 turn 준비 때 비교해 붙이고 입력함에 넣지 않는다(사람이 확인).** 쉬던 session을 깨우지 않는다.
- **host queue로 탭을 여는 요청은 harness queue를 일반화하지 않고 같은 꼴로 따로 둔다(사람이 확인).** harness queue는 session마다 turn 입력을 담아 요청 종류를 실을 자리가 없다.
- **팀 자식의 물음은 부모에게 가는 call이다(사람, 2026-11-08: "coordinator든 leader든 걔가 먼저 답하고 걔 판단으로 안 되겠음 걔가 사용자한테 올리고").** 자식의 물음이 모두 사람에게 오면 coordinator가 할 일을 사람이 한다. 올리는 장치를 따로 두지 않는다(agent): 부모가 자기 `ask`를 쓰면 같은 규칙이 사슬을 만들어 root에서 사람에게 닿는다. 부모의 승인 답은 글이 아니라 `call reply`의 구조 칸이다(agent): 새 명령을 두지 않았다. call과 request의 짝은 main thread 메모리에 두고 행에는 `ask` 표시만 둔다(agent). skip session의 shell ask는 부모에게 가지 않는다(agent). 팀 자식의 물음 event는 그대로 내고 표시로 거른다(agent).
- **팀 지시문은 system prompt에 넣지 않는다(agent).** prompt cache가 깨지지 않게 첫 call 본문 앞에 붙인다.

- **앱도 call의 보낸 쪽이다. 단 화면만 보낸다(app-sdk, 2026-11-10).** 앱을 agent와 같은 보낸 쪽으로 두면 시야·명함·실패·취소가 한 벌이다. 앱 process가 call을 보내고 답을 handler로 받는 길은 만들지 않았다(roadmap의 하지 않는 것): AI가 만든 앱 process가 상한 없이 unattended turn을 열 수 있다. 그래서 모든 앱 call은 attended이고 `unattended` 갈래가 앱에 없다. 버린 안: 앱 전용 입구(실패 처리와 화면이 둘). 앱의 답을 message로 두는 안은 앱에 session이 없어 버리고 call 행의 글(`result`)로 두었다: 가장 단순하고 읽는 길이 `app_calls/read` 하나다. 글이 아닌 block은 담지 않는다(알려진 한계). event는 `call.settled`만 내고 본문을 싣지 않는다(저장하지 않는 event에 본문을 두지 않으려고, 본문은 읽는다). 앱의 slug는 message에 얼린다(tag bytes 고정).

- **private은 컴퓨터 사이에도 선다.** 같은 규칙을 두 자리에서 보고(부르는 쪽 workspace, 받는 쪽 앱의 workspace) 쌍 규칙은 보지 않는다. 이유: 상대 컴퓨터의 설정을 읽을 길이 없고 쌍 규칙의 key는 컴퓨터마다 다른 id다. 대가: 쌍 규칙으로 연 예외는 컴퓨터를 건너지 못한다. (사람, 2026-11-17)

- **GUI 탭 팀원의 답 못 한 call은 받은 session을 끝내지 않고 그 call만 닫는다(agent, 2026-11-21).** 팀원은 사람이 쓰는 탭이라 session을 끝낼 수 없고, 닫지 않으면 보낸 쪽이 영영 기다린다. 이유는 `receiver_ended` 하나다(이유를 나누려면 `agent_calls`를 다시 짜야 한다).

## 열린 것

- 보낸 쪽마다 배달 실패의 꼴이 다르다(사람은 오류 코드, program은 `state: failed`, agent는 tool 결과 + 늦은 실패의 입력). 보낸 쪽이 늘 때 통일한다.
- 상태 `unknown`은 상태를 알아내는 길이 없는 곳에서만 난다. 지금 lophn session은 running, waiting, idle만 낸다.
- agent 쌍 규칙에 workspace 조건이 없어 한 workspace 안에서만 여는 agent 예외는 만들 수 없다.
- 진짜 Electron 창에서 agent의 탭 열기와 `team spawn` 탭은 사람이 아직 보지 않았다(TUI hold의 두 틈은 coding-agent 이슈).

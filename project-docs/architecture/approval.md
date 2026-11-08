# approval

agent가 하는 동작마다 "해도 되나"를 정하는 장치다. 원칙은 둘이다. 시킨 것이 승낙이고, 할당이 허락이다. 사람이 agent에게 맡긴 일과 준 tool은 다시 묻지 않는다. 실행 때 묻는 것은 shell 규칙이 `ask`인 명령뿐이고, 사람이 없는 turn은 묻지 않는다. 실수는 묻기가 아니라 rewind와 deny 규칙으로 줄인다. 이 문서는 판정(`judge`), 묻는 길 하나(turn 안 request), turn mode, shell 규칙, 할당과 앱 공유 요청을 다룬다. 앱의 자원 허락(activation 동의)은 `architecture/activation.md`의 일이다.

## 흐름

```
 runtime tool 실행 (work.ts)
   tool 정의의 gate가 GateCall을 낸다: app_tool | mcp_tool | shell
   gate 없는 tool(file, web, ask, call 등)은 이 길을 거치지 않는다
        │ memory route tool_gate/check (그 turn의 agent 자격만)
        ▼
 core approvals
   turn 행의 mode, session의 agent와 workspace, 할당, shell 규칙 층을 읽는다
   judge(call, assignment, shell, mode) ─┬ deny ─▶ 실행하지 않고 이유를 tool 결과로
   순수 함수                              ├ run  ─▶ 실행
                                          └ ask  ─▶ turn 안 request (메모리)
                                                    TurnRequestOpened ─▶ 대기 목록, 알림(toast·OS), 대화 카드
                                                    사람: once | always | reject (DecideTurnRequest, 사람 자격만)
                                                    TurnRequestClosed ─▶ turn이 이어 간다
 앱 호출 경로 (agent·앱·job·flow가 앱 tool을 부름): 묻지 않고 막기만 한다
   agent ─▶ judge로 할당을 본다      앱 ─▶ active 앱 grant의 app.call
   program(job의 tool run) ─▶ 막지 않는다. 사람이 그 job의 등록을 승인했다
   flow(instance의 tool run) ─▶ 그 project PM의 할당을 unattended로 judge + 비공개 거르기
 앱 공유 요청 (turn 안 request와 달리 turn이 끝나도 남는다. activation 동의, job 승인과 같은 꼴)
   앱 workspace의 agent ─ lophn app share ─▶ share_request.open ─▶ share_requests 표 + ShareRequestOpened ─▶ 대기 목록
   사람: approve | reject (share_request.decide, 사람 자격만, compare requested_at)
     (그 앱의 activation 동의가 대기 중이면 대기 목록이 요청을 동의 카드에 붙이고, 동의 허락(activation.consent + share_requested_at)이 같은 tx에서 이 approve를 같이 한다)
     approve ─▶ 같은 tx에서 받을 agent마다 할당 쓰기 길로 정의 파일 apps에 앱 slug를 더한다
              ─▶ commit 뒤 coding agent를 골랐으면 설정 coding-agent.shared_apps에 slug를 더한다
     ShareRequestClosed ─▶ 대기 목록에서 빠진다
```

- 할당은 사람이 agent에게 앱을 붙이고 그 앱에서 뺄 tool(command)을 적는 것이다. 정본은 그 agent 정의 파일(`<data root>/agents/<agt_id>.md`)의 `apps`(앱 slug)와 `permissions.deny`(`lophn(<app> <command>)`)다. 할당한 앱의 tool만 그 agent의 tool 목록에 뜨고, 그 앱의 public skill도 같이 받는다(`architecture/agent-definition.md`).
- MCP server는 설정한 층(전역, project, agent 정의)이 곧 할당이다. 끄기는 `mcp_off`다. 할당 줄이 없다.
- 효과(read, write, external)는 판정에 쓰지 않는다. 할당한 tool은 바깥 효과도 묻지 않는다(사람, 2026-10-21). 효과는 기록과 재시도에만 쓰인다.
- 사람이 앱 화면에서 누르는 것, 사람이 보내는 메시지, agent call, 지침 파일(`LOPHN.md`) 쓰기, file·web·pdf·image tool은 묻지 않는다. file tool은 workspace가 범위이고 쓰기는 rewind로 되돌린다.
- coding agent의 tool call은 harness의 일이다. lophn은 harness의 물음을 대기 목록에 비추기만 하고(`subject.kind: "harness"`) 답은 터미널에서 한다. runtime이 harness인 lophn agent도 같아서 tool call은 Gate를 거치지 않고, 정의의 deny는 harness의 권한 flag로 옮기거나 못 옮기면 띄우지 않는다(`architecture/coding-agent.md`의 "harness agent").

## 지키는 것

판정
- `judge`는 IO 없는 함수다(`packages/core/approvals/gate/judge.ts`). 시각, 상태, 전역을 읽지 않는다. 같은 입력은 같은 결과다.
- 할당하지 않은 앱의 tool은 `deny not_assigned`, 할당에서 뺀 tool은 `deny removed`다. 어느 mode에서나 막는다. tool 목록은 session 시작 때 고정하지만(`architecture/agent-definition.md`), 판정은 call 때 지금 할당을 읽어 session 도중 뺀 앱 tool도 바로 막는다. MCP tool은 `judge`가 늘 `run`을 내고(할당 줄이 없다), 연결 쪽 `call`(`packages/core/lophn-agent/extensions/mcp-toolkit.ts`)이 부를 때마다 전역·project 층 server 설정을 다시 읽어 꺼진 server(`mcp_off`)나 읽기 실패면 `unavailable`로 거절한다. 도는 turn 안에서 끈 server도 바로 막힌다. agent 정의 층의 `off`는 turn 시작 때 읽은 값이라 다음 turn부터 막힌다.
- `deny`는 어느 mode에서나 막는다. skip은 묻지 않는 것이지 금지를 푸는 것이 아니다.
- `ask`는 attended에서만 묻는다. unattended와 skip에서는 `run`이 된다.
- 사람의 결정은 사람 자격만 받는다(`DecideTurnRequest` actors `user`, handler도 한 번 더 본다). agent, 앱, MCP server가 스스로 허락하면 판정이 의미 없다.
- agent는 자기 할당을 넓히지 못한다. 할당 쓰기(`assignment.set`)는 사람만 하고 읽기(`assignment.get`)는 사람과 machine뿐이다. agent 정의를 만들고 고치는 tool(`agent.create`, `agent.update`)은 `mcp_servers`, `skip`, `apps`, `permissions`를 입력으로 받지 않는다. 앱 공유 요청도 agent가 여는 것은 요청뿐이고 `apps`를 더하는 것은 사람의 승인이다.
- 할당 저장은 revision을 비교한다. 다른 창이 먼저 저장했으면 `conflict`이고 화면이 다시 읽는다. revision은 정의 파일 값 `{apps, deny}`의 hash(sha256 앞 48 bit)에서 정한 값이고 할당이 비면 0이다. 정의 파일의 다른 칸(지침 본문, model)을 고쳐도 바뀌지 않는다.
- 판정이 읽는 할당은 call 때마다 정의 파일에서 읽는다(`AgentDirectory`를 거친 `agentAssignment`, `packages/core/apps/usage/users.ts`). 앱 호출 경로(`packages/core/apps/calls/gate.ts`)와 사용 관계(`apps/usage`)도 같은 읽기다. 없는 앱 slug와 active 선언에 없는 command는 읽을 때 빠진다.
- 선언(앱 선언의 효과, MCP `readOnlyHint`)은 믿는다.

묻는 길
- 묻는 길은 turn 안 request 하나다(`packages/core/approvals/turn-requests.ts`). 메모리에 있고, 물은 turn이 기다린다. 재시작하면 비고 기다리던 turn은 cancelled를 받는다.
- 침묵이나 카드 닫기는 결정이 아니고 기한도 없다. 원래 일이 끝나면 cancelled로 닫고 요청자는 거절과 구별해 받는다. 거절 이유는 agent에게 그대로 간다(tool 결과 `the person rejected this tool call: <이유>`, `packages/core/lophn-agent/tools/work.ts`).
- 물은 입력을 그대로 실행한다. 허락은 메모리에서 기다리는 같은 호출을 풀 뿐이고, 다시 판정하거나 입력을 비교하지 않는다. 바꿔치기할 틈이 없어 fingerprint를 두지 않는다.
- 선택지는 `once`, `always`, `reject`다. "이 session 동안" 허락은 없다.
- `always`는 request의 `always_patterns`를 allow 규칙으로 더한다. shell request에만 있고, 비면 `always`를 받지 않는다(`invalid_input`). 카드는 그 줄을 그대로 보여 사람이 무엇을 허락하는지 본다.
- 카드 내용은 program이 GateCall에서 만든다. agent가 쓴 설명은 싣지 않는다.

할당 저장
- 할당 route(`assignment.get`, `assignment.set`)는 `{agent, entries: [{app, removed_tools[]}]}` 꼴 그대로다. approvals는 정의 파일도 앱 표도 모르므로 읽고 쓰는 길은 조립이 tx와 snapshot마다 꽂는 port(`assignmentPorts`)다(`packages/core/main/daemon/wiring/assignment-file.ts`). 쓰기는 앱 id를 slug로, 뺀 command를 deny 규칙으로 바꿔 정의 파일의 `apps`와 `permissions.deny`만 다시 쓴다. 다른 칸과 본문은 그대로다. 이 할당이 다루는 deny 규칙은 옛 앱과 새 앱의 command 것뿐이고 그 밖의 deny 규칙은 지키며, 정의 파일이 없는 agent에는 쓰지 않는다(`not_found`).
- 옛 ledger 표 `agent_assignments`의 schema step(id `agent_assignments`)은 목록에 그대로 남는다. 이미 적용한 ledger가 id를 기록하고 있어 빼면 기동을 거절한다. 새 data root에는 data step이 돌지 않아 빈 표가 남고 쓰는 곳은 없다.
- 옛 표의 줄은 data step `approvals.assignment-file`이 옮긴다. 줄마다 그 agent 파일에 `apps`와 `permissions.deny`를 쓰고 표를 지운다. 앱이 없는 줄, active 선언에 없는 command, 정의 파일이 없거나 틀린 agent의 줄은 버린다(쓸 곳이 없다). 다시 돌아도 같은 결과다.
- data step은 ledger schema step 뒤에, 조립 목록(`packages/core/main/daemon/assembly.ts`의 `WIRINGS`) 순서로 돈다. `agents.skills-off`(agent 파일의 `skills` → `skills_off`)가 `approvals.assignment-file`보다 먼저 돈다: 앞의 step이 옛 `skills`를 옮겨야 뒤의 step이 엄격한 schema로 agent 파일을 읽고 쓴다. 순서를 바꾸면 옛 `skills`가 남은 파일은 schema가 거절해 할당이 버려진다.

앱 공유 요청
- 앱 workspace의 agent가 "이 앱을 agent A, B(와 coding agent)에게 할당"을 청한다(`lophn app share --agent <이름>... [--coding-agents] --reason <글>`, 앱 workspace 명령). 받을 agent도 coding agent도 없는 요청은 받지 않는다(`invalid_input`). 앱은 입력이 아니라 agent credential의 `conditions.app`이 고정하고, 앱 workspace가 아니면 `forbidden`이다. 이름은 명령이 `agent.list`로 id로 푼다.
- 요청은 `share_requests` 표(`approvals.share_requests`)에 앱마다 한 줄이다. 같은 앱의 열린 요청이 있으면 새 요청이 대신한다. 승인이나 거절이면 줄을 지운다. 그래서 turn이 끝나도, 재시작해도 남는다(메모리 request는 재시작하면 비는 것과 다르다).
- 결정은 사람 자격만 한다(`share_request.decide`, handler도 한 번 더 본다). compare `requested_at`이 열린 요청과 다르거나 요청이 없으면 `conflict`다: 그 사이 새 요청이 대신했거나 이미 정해졌다. 거절은 이유를 싣지 않는다. 카드는 앱 이름, 받을 agent, agent가 쓴 이유(200자까지), 받게 되는 것(지금 active 선언의 public skill 수와 public command 수)을 보인다. 이유는 agent가 쓴 글이라 참고일 뿐이고 수는 program이 선언에서 센다.
- 승인은 같은 tx에서 받을 agent마다 할당 쓰기 길(`assignmentPorts.set`)로 앱을 더한다. 이미 있는 줄과 그 줄에서 뺀 command는 건드리지 않는다. 정의 파일은 tx 밖이라 중간에 실패하면 먼저 쓴 agent의 파일은 되돌아가지 않고, 다시 승인하면 이미 있는 줄은 건너뛰어 같은 결과가 된다.
- coding agent를 골랐으면 commit 뒤(`afterCommit`)에 core가 설정 `coding-agent.shared_apps`에 앱 slug를 더한다(이미 있으면 더하지 않는다). 설정 store가 writer Worker 밖이라 commit 뒤에 쓴다. 쓰기가 실패해도 승인은 이미 확정이라 log(`shared_apps_not_saved`)만 남는다. 이 설정은 사람이 승인할 때만 더하고, 듣는 쪽은 `architecture/coding-agent.md`다.
- 그 앱의 activation 동의가 대기 중이면 사람은 한 번만 승인한다(사람, 2026-11-07: builder가 만들고 grant까지 알아서 해 주기를 바랐다). 대기 목록(renderer waiting store)이 그 앱의 공유 요청을 동의 항목에 붙여 보이고 따로 줄을 세우지 않는다(요청이 먼저 열렸든 동의가 먼저 열렸든 같다). 동의를 허락하면 `activation.consent`가 카드가 본 요청의 `requested_at`을 `share_requested_at`으로 실어 core가 같은 tx에서 `approveShareWithConsent`로 승인한다: 효과는 `share_request.decide`의 approve와 같고(할당, commit 뒤 coding agent 설정), `ShareRequestClosed {approve}`도 낸다. 그 사이 새 요청이 대신했거나 이미 정해졌으면 동의째 `conflict`라 사람이 보지 못한 내용은 승인되지 않고, 요청이 하나라도 실패하면 동의도 허락되지 않고 대기로 남는다(공유가 먼저 적용된다). 동의를 거절하면 공유 요청은 그대로라 대기 목록에 제 줄로 다시 보인다. 동의 대기가 없으면 위의 따로 승인과 같다. apps는 approvals를 import하지 않아 core/apps의 port `bundledShare`를 `wiring/share-requests.ts`가 꽂는다.
- 요청의 남지 않는 event는 `ShareRequestOpened`(새 요청이 대신해도 낸다)와 `ShareRequestClosed {outcome}`이고 commit 뒤 Bus로 나간다. 대기 목록은 `share_requests.list`를 읽고 이 event로 고친다.

turn mode
- turn은 시작할 때 mode를 정해 `turns.mode`에 남기고 그 turn 동안 바꾸지 않는다(`turns_started_immutable`). 도는 turn에 사람이 steer한 메시지도 그 turn의 mode를 따른다. Gate는 그 turn 행의 mode로 판정하고, 못 읽으면 판정하지 않는다.
- 정하는 순서는 unattended 입력, session skip, attended다(`packages/core/lophn-agent/run-loop/turn-mode.ts`). skip session이 받은 unattended call의 turn도 unattended다. skip이 먼저면 사슬 아래가 attended로 떨어져 사람 없이 멈춘다.
- unattended는 call 봉투에 실려 따라간다. unattended turn이 보낸 call과 답에 표시가 실리고, 그 call의 늦은 실패와 취소 알림도 call 행의 표시를 따른다(`architecture/agent-call.md`). 답의 표시는 답한 turn에서 온다. 사람이 끼어든 attended turn의 답은 attended다.
- reaction과 화면에서 사람이 보낸 메시지가 연 turn은 attended다. `SendMessage`에 `unattended: true`를 실어 넣은 사람 메시지(run 입력, `architecture/run.md`)가 연 turn은 unattended다. 사람 메시지의 이 표시는 run만 싣는다. workflow가 넣은 step 입력(`architecture/workflow.md`)도 unattended 표시를 싣는다. 사람이 instance를 시작한 것이 그 사슬을 맡긴 것이다. 표시는 할당을 넓히지 않는다.
- job도 사람이 없는 일이다(`architecture/job.md`). job이 연 agent run의 turn은 run 입력이라 unattended이고 그 turn이 보낸 call 사슬도 따라간다. job이 시작한 instance의 step 입력도 같다. job은 사람이 등록을 한 번 승인해야 돈다(`architecture/job.md` "승인"). job의 tool 호출은 그 승인이 허락이라 할당을 보지 않는다(`architecture/app-call.md`). agent run과 instance는 받은 agent의 할당으로 일한다.
- flow도 사람이 없는 일이다(`architecture/workflow.md` "flow"). flow가 연 agent run의 turn은 run 입력이라 unattended다. flow의 tool 호출은 그 project PM의 지금 할당을 `unattended`로 `judge`해 막기만 한다. code를 쓴 것이 PM이라 code로 PM의 할당을 넓히지 못한다. flow가 부르는 agent는 누구든 되지만 받은 agent는 자기 할당으로만 일한다.
- unattended turn의 `ask` tool은 기다리지 않고 `unattended`를 바로 돌려준다. skip turn의 `ask`는 사람이 있으니 기다린다.
- skip은 session 표시다. 사람만 켜고 끈다(`ChangeSessionSkip`). agent 정의의 `skip`이 그 agent 새 session의 기본값이고, 이 칸도 사람만 쓴다. skip은 call을 따라 가지 않는다. fork는 skip을 가져가지 않고 정의의 기본값으로 시작한다.

shell 규칙
- 규칙은 `{pattern, action}`이고 action은 `allow | ask | deny`다. `*`는 아무 글자, `\*`는 글자 그대로의 `*`다. `*`가 없는 pattern은 그 명령과 똑같을 때만 맞고, 끝의 ` *`는 그 앞까지만 있어도 맞는다. 공백은 줄여 맞춘다.
- 층은 셋이다: 제품 기본(`PRODUCT_SHELL_RULES`의 floor deny와 ask), 전역, project. 전역과 project 규칙은 Settings 값 `approvals.shell_rules`에 있다. 사람의 project 폴더에 두지 않는다. PM이 그 폴더를 file tool로 쓰기 때문이다.
- 명령 전체와 `&&`·`||`·`;`·`|`·줄바꿈으로 나눈 조각마다 floor, 그다음 층을 이어 본 가운데 마지막에 맞은 규칙, 없으면 allow다. 그 가운데 가장 엄한 것(deny > ask > allow)이 명령의 결과다. 조각을 이어야 보이는 위험(`curl * | sh *`, fork bomb)도 전체에서 잡힌다.
- floor deny는 어느 층도, `always`도, skip도 덮지 못한다. 글자 그대로 맞추므로 floor는 `rm`의 flag 순서와 `sudo` 앞붙임을 따로 적는다.
- `always`는 ask였던 조각마다 `<앞 두 낱말> *`(한 낱말이면 그 조각, 조각을 이어야 ask인 명령은 명령 전체)를 allow로 더한다. 층은 turn의 workspace로 정한다: project workspace면 그 project 층, 앱 workspace와 lophn이면 전역 층이다. 사람은 Settings › Shell rules에서 옮기고 고친다.
- `shell.run`의 효과는 `external`이다. 판정은 규칙이 하고, `read`면 일시 실패에 다시 돌아 같은 명령이 두 번 돈다.
- 규칙은 실수를 줄일 뿐 경계가 아니다. 따옴표와 escape를 풀지 않고, `shell.run`은 file 범위와 rewind 밖이다(`project-docs/issues/workspace-session.md`).

## 왜 이 모양인가

- 옛 approval은 intent 7종, grant 저장소 3, 묻는 길 2(turn 안, 보류 request와 applier), fingerprint, "이 session 동안" 허락, agent call 두 번 판정이 있었다. 할당했는데 실행 때 또 묻고, 사람이 없는 실행은 기한 없이 기다렸다. 다른 harness 다섯(Codex, OpenCode, Hermes, OpenClaw, oh-my-pi)은 모두 묻는 길이 기다리는 turn 하나이고 주 gate가 shell이다(`project-docs/products/roadmap/approval.md`).
- 보류 request 길을 지웠다. 쓰던 둘 가운데 reaction의 `ask`는 지웠고(그 reaction 설정이 없어졌다), activation 동의는 activation module이 자기 상태로 갖는다.
- 바깥 효과 tool도 묻지 않는다. "시킨 것이 승낙", "할당이 허락"을 그대로 따른 사람의 결정이다. 다시 묻기로 하면 `judge`의 `ASK_EXTERNAL_WHEN_ATTENDED` 한 줄을 켜고 할당 줄에 묻지 않을 tool 칸을 더한다.
- 공유 요청은 turn 안 request가 아니다. 요청한 agent의 turn이 끝난 뒤에도 사람이 승인할 수 있어야 하고(activation 동의, job 승인과 같은 꼴이다), agent가 할당을 직접 쓰는 길은 두지 않는다(지금과 같다). 앱이 다른 agent에게 줄 만한 기능은 앱을 지은 agent가 제안하고 사람이 한 번 승인하면 앱의 command(부르기)와 public skill(알기)이 한 할당으로 같이 간다(사람, 2026-11-02).
- agent call은 묻지도 막지도 않는다. 받은 agent는 자기 할당으로만 일한다(`products/AGENT.md` T5, T6). 누구를 부르는지는 지침과 workflow의 일이다.
- job은 agent가 만들고 정해진 때 사람 없이 돈다. 그래서 사람이 job 하나(주기와 할 일)를 보고 등록을 한 번 승인해야 돈다. agent가 혼자 정한 일이 사람 없이 되풀이되지 않게 하고, 허락의 범위를 그 job의 할 일 하나로 맞춘다. 승인 뒤 할 일은 바뀌지 않는다. job이 부르는 agent run과 instance는 unattended이고 받은 agent의 할당으로 일한다. 앱 tool 호출은 승인이 허락이다. flow는 PM이 쓴 code라 PM의 할당이 허락이다.
- workflow를 쓴다는 것은 바깥 효과까지 책임지겠다는 뜻이고 사람이 loop에서 자주 빠진다. 그래서 unattended는 묻지 않고, 시작한 사람이 그 사슬 전체를 시켰으니 call을 따라 간다. skip은 사람이 그 대화에 정한 것이라 따라 가지 않는다.
- shell 규칙은 prefix와 `*`, 마지막 일치다(OpenCode, Codex). regex 사전(Hermes)과 명령 parser(OpenCode의 tree-sitter)는 쓰지 않는다. 조각의 길이를 고르는 표 없이 `<앞 두 낱말> *`로 `always`의 줄을 만든다.
- LLM judge는 넣지 않았다. 판정은 program이 결정적으로 하고 결정은 사람이 한다.
- 대기 목록은 Inbox의 Now 탭 위쪽("답할 것")이다. 그 아래 휘발 알림과 따로 있는 History 탭(영구 기록)은 답할 것이 아니라 sidebar 배지에 세지 않는다(`architecture/app-notice.md`).
- timeout은 없다. attended에서는 대기 목록에 남고, unattended에서는 묻지 않는다.
- OS sandbox는 두지 않는다. 조사한 harness 가운데 기본으로 켜는 것은 Codex 하나다.
- 결과 본문을 믿는 문제는 판정과 따로다. web 검색과 읽기 결과만 바깥 글로 감싸고, 앱 tool과 외부 MCP 결과는 감싸지 않는다.
- 사람 결정 handle(보호 입력 창의 secret 입력 등에서 사람이 고른 결정을 core에 묶는 1회용 참조, `packages/core/server/identity/confirmation.ts`)은 shell capability로만 등록한다. capability는 control `connect {client: shell}`의 응답에만 실리고 shell main 메모리에만 있다(argv, env, file, renderer, log로 내지 않는다). shell main은 Gateway handshake의 `x-lophn-shell-capability`로 자기 수명을 묶고, core는 그 Gateway가 끝나면 capability와 미소비 handle을 버린다. HTTP user token, agent·worker credential, route, CLI(`client: cli`)에는 등록 길이 없다. HTTP token은 renderer와 앱 view, CLI를 쓰는 terminal agent까지 같은 값이 퍼지고 agent·worker credential은 agent의 것이라, 그 자격으로 등록하면 agent가 사람의 결정을 흉내 낼 수 있다. 그래서 사람만 쓰는 창을 가진 shell main에만 주는 다른 자격을 둔다. 경계는 control socket 자리(같은 사용자, 0700 폴더, named pipe)이고 OS peer 신원은 보지 않는다: 같은 사용자의 process는 이미 `secrets.json`을 읽을 수 있어(`architecture/layers.md`) peer 검증이 더 막는 것이 없고, 세 OS native addon이 든다. 경계 test는 `packages/core/server/control/handler_test.ts`다.

# workspace-session

agent와 하는 대화가 session이고, session은 workspace(없음=Home, project, 앱) 하나에서 일한다. 이 문서는 session의 정체, 열리고 끝나는 때, 끝날 때 call·turn·질문에 같이 일어나는 일, 복사(fork)와 되돌리기(rewind)가 가져가는 것과 두고 가는 것, workspace가 정하는 file 범위, 사람이 붙인 이미지가 session에 묶이는 방식을 정한다.

## 문제

session의 경계가 흐리면 사람이 대화에서 잃는 것이 생긴다. 끝난 session이 call을 붙잡아 보낸 쪽이 영원히 기다리고, 한 session에 올린 권한 단계가 다른 session으로 새고, 되돌린 대화에 낡은 요청이 남는다. 열린 session의 agent나 workspace가 바뀌면 이미 쌓인 대화가 다른 agent의 것이 된다. file 범위가 새면 agent가 엉뚱한 project나 앱의 폴더를 읽고 쓴다.

## 목표와 비목표

- 목표: session의 정체가 열 때 정해져 바뀌지 않는다. 끝은 한 번에 모든 영향과 함께 온다. fork와 rewind가 무엇을 가져가고 두고 가는지 정해져 있다. file 범위는 session의 workspace 종류에서 나온다.
- 비목표: archive한 session을 다시 여는 것(되살리기). 되살리면 대기 request가 돌아오지 않는 규칙을 따로 정해야 해서, 필요가 생길 때까지 닫힌 session은 새 session으로 이어 간다.
- 비목표: session이 저절로 끝나는 것. 끝은 사람의 archive나 지움뿐이다.
- 비목표: agent를 workspace에 묶는 것. agent는 전역이고(또는 workspace 하나에 범위가 있고) workspace는 session이 갖는다.
- 비목표: `shell.run`이 file 범위와 rewind 안에 드는 것(열린 것 참고).

## 모델

- agent는 둘이다. 내장 lophn과 사람이 만든 agent다(`architecture/agent-definition.md`). lophn은 workspace(Home, project, 앱)마다 하나이고(id `lophn_home`, `lophn_<project 또는 앱 id>`) 지우지 못한다. 앱을 지우면 그 앱의 lophn 정의 file도 지운다. 사람이 만든 agent(`agt_…`, 이름은 전역에 하나)는 사람이 만들고 지우며, 전역이거나 workspace 하나에 범위가 있다. project 등록과 앱 만들기는 agent를 만들지 않는다. 정의는 `<data>/agents/<id>.md`이고, 정의는 파일이라 DB tx에 묶을 수 없다. lophn 정의는 미리 만들지 않는다. 파일이 없으면 기본 정의이고 사람이 고치면 그때 생긴다.
- workspace는 일하는 그릇이다: project, 앱, 없으면 home. 앱은 project에 묶이지 않고 앱마다 app workspace가 있다. agent가 받는 지침, skill, 앱 command는 그 workspace의 것이다.
- session의 정체는 (agent id, workspace)다. session은 open인 채 오래 산다. 상태는 open과 archived이고, workspace를 보관하면 session은 open인 채 새 입력만 막힌다.

```
 session 열기 ◀── person | Router(call의 새 session, workflow step, program 알림) | run
    │ agent+workspace 고정
    ▼
  open ──── workspace 보관 ────▶ open인 채 새 입력만 막힘 (workspace를 꺼내면 이어서 받음)
    │
    └─ person: archive / 지움 ─▶ 한 tx에서 묶어 끝낸다
         · 도는 turn → interrupted        · 받은 열린 call → failed(receiver_ended)
         · 대기 request·질문 → cancelled   · queue 비움
         · SessionEnded 발행

 fork   : 이력만 복사한 새 session (같은 agent, 같은 workspace)
 rewind : 대화(+file tool이 바꾼 파일) ─ 사람이 앱을 고르면 ─▶ 앱 rewind (app-call)
```

- 지침 층은 workspace 종류마다 다르다. project는 전역, project의 `LOPHN.md`, agent 정의 본문이다. 앱은 project 지침이 없다. 전역, 앱 source의 `AGENTS.md`(source가 없으면 없다), agent 정의 본문이다. Home은 전역, `<data>/home/LOPHN.md`(없으면 `CLAUDE.md`), agent 정의 본문이다.
- file 범위(file tool이 읽고 쓸 수 있는 폴더)는 workspace 종류가 정한다.
  - project: 그 project의 폴더들(사람이 이은 것. 없을 수도 있다)과 그 project의 `workflows/`·`artifacts/`·`skills/`(`<data>/projects/<project>/…`)를 읽고 쓴다. session에 `worktree_id`가 묶여 있으면(열 때 고정, 불변) file 범위의 원래 `repo_root`를 해당 worktree 경로로 치환하고 shell cwd 및 `PROJECT_ROOT`/`WORKTREE_*` 환경 변수를 주입한다(`architecture/worktree.md`). `removing`·`removed`·`missing` 상태의 worktree에는 새 session을 열지 않는다(`conflict`).
  - 앱: 앱 source 폴더, 사람이 앱에 더 이은 폴더(`app.edit_folders`, App details의 Folders), 그 앱의 `artifacts/`·`skills/`(`<data>/apps/<app>/…`)를 읽고 쓴다.
  - home: 등록된 모든 project 폴더를 읽기만 하고, 자기 `skills/`(`<data>/home/skills/`)·`tools/`(`<data>/home/tools/`)와 전역 개인 skill 보관소(`<data>/skills/`)를 읽고 쓴다. workspace info는 Home에 `Skills folder`와 `Global skills folder`를 보인다.
  - 범위는 상대 경로를 푸는 기준 `base`를 싣는다. 그릇의 첫 폴더(project의 첫 폴더, 앱은 source가 있으면 source, 없으면 첫 더한 폴더)이고, 없으면 workspace의 data 폴더(`<data>/projects/<project>`, `<data>/apps/<app>`)다. `base`는 상대 경로를 푸는 기준일 뿐 허락을 넓히지 않는다.

## 지키는 것

1. session의 정체(agent, workspace)는 열 때 정해져 바뀌지 않는다. 저장소가 거절한다(`sessions` 표의 `agent`, `workspace_kind`, `workspace_id`는 고치지 못한다). agent 정의가 없는 agent, 없거나 보관된 workspace에는 열지 않는다. 어느 agent든 자기 범위 안의 어느 workspace에든 열 수 있다.
   - agent 정의, 할당, 지침, file 범위가 agent와 workspace에서 나온다. 열린 session의 것을 바꾸면 쌓인 대화가 다른 agent의 것이 된다.
2. session을 여는 길은 사람, Router, run이고 같은 연산으로 연다. Router는 call과 workflow step의 새 session(`architecture/workflow.md`)과 program 알림으로 연다. 열 때의 검사(agent 정의, workspace, 보관 여부)가 한 곳이라 어느 길로 열어도 같은 session이 된다.
3. run(`architecture/run.md`)이 연 session도 사람이 연 것과 같은 session이고 run이 끝나도 열린 채 남는다. 저절로 닫지 않는다. agent의 call이나 run이 연 새 session은 그 workspace의 Main desk에 Agent 탭으로 보인다(`architecture/workspace-layout.md` "agent가 연 탭"). run마다 새 session이라 탭이 쌓이고 닫는 것은 사람이다. 탭을 닫은 session은 Recent로 간다. Agent 탭은 저장하지 않아 앱을 다시 켜면 탭이 없고(session은 열린 채 core에 남는다) sidebar에서 다시 연다. 왼쪽 sidebar는 run의 session을 따로 묶지 않는다.
4. session은 저절로 끝나지 않는다. 끝은 사람의 archive나 지움뿐이다. lophn agent는 일이 끝났다고 program에게 알리지 않는다. 열려 있어야 call과 reaction을 받을 수 있다.
5. archive와 지움은 모든 영향을 한 tx에 묶는다. 일부만 적용된 끝이 없다.
   - 도는 turn은 interrupted(`session_ended`)로 닫는다. agent runtime child에도 `turn_stop`을 보내 진행 중인 model 요청을 끊는다.
   - 끝나는 session이 받은 열린 call은 `receiver_ended`로 닫혀 보낸 쪽이 안다. 보낸 call의 답은 취소하지 않는다(받은 session에만 남는다).
   - 팀의 ask call(`architecture/agent-call.md`)은 끝나는 쪽이 자식이면 취소되고, 부모면 자식의 승인은 거절·질문은 cancelled로 풀린다.
   - 대기 request와 질문은 cancelled로 풀리고, queue는 비워지고, `SessionEnded`가 난다.
6. workspace를 보관하면 그 workspace의 session은 open인 채 남지만 새 입력(사람 메시지, call, step, reaction)을 받지 않고 Router에는 closed로 보인다. 다시 꺼내면 이어서 받는다. 보관은 되돌릴 수 있는 일이라 session을 끝내면 안 된다.
7. lophn이 꺼졌다 켜져도 열린 session은 열린 채다. 메모리에 있던 것은 사라진다.
   - 돌던 turn은 interrupted, queue에 있던 call과 부모가 가져간 ask call은 `lophn_restarted`로 닫히고, 대기 request와 질문은 cancelled다.
   - queue에 있던 step 메시지는 다시 넣지 않고 workflow가 `lophn_restarted` 줄로 남긴다.
   - session의 권한 단계는 표(`sessions.permission_mode`)에 남는다(옛 `sessions.skip = 1`은 schema step `lophn-agent.session-permission-mode`가 `'full'`로, 기본은 `'workspace'`로 옮겼다). `SessionGrantStore`의 이번 대화 허락은 메모리에만 있어 재시작하면 비워진다.
8. 사람 메시지는 버리지 않는다. 켤 때 아직 turn이 가져가지 않은 사람 메시지를 받은 순서대로 queue에 다시 넣어 turn을 연다. 뺀다: fork 사본, rewind가 숨긴 구간, 보관한 session과 workspace의 것, run 입력(`messages.unattended`가 1인 사람 메시지). 그 run은 켤 때 `lophn_restarted`로 닫히는데, 다시 돌면 닫힌 run 뒤에 attended turn이 생겨 바깥 효과가 두 번 난다(`architecture/run.md`).
9. agent runtime child가 죽으면 그 child가 돌리던 turn은 interrupted(`restarted`)로 닫고 queue 표시와 기다리던 request를 푼다. 닫지 않으면 session이 새 입력을 모두 `conflict`로 막는다.
10. fork는 이력만 복사한다. 같은 agent, 같은 workspace의 새 session이고 고른 지점(`through_seq`)까지의 확정 메시지를 가져가며, rewind가 숨긴 구간은 복사하지 않는다.
    - 대기 request와 질문, 열린 call, rewind 기록, `SessionGrantStore`의 이번 대화 허락은 원래 session의 turn·메모리에 묶여 있어 가져가지 않는다. 같은 파일을 두 session이 되돌리면 부딪친다.
    - 권한 단계(`permission_mode`)도 가져가지 않는다. 새 session은 agent 정의의 `permission_mode`(비면 전역 기본 `approvals.default_mode`)로 시작한다.
    - 제목과 model 선택은 잇는다. 이미지 blob 참조는 복사본마다 새로 건다. 부른 workspace(`called_from_*`)는 옮긴다.
    - 팀 자식(`spawned_by`)으로 열리는 session의 권한 단계는 `min(부모 단계, 정의/전역 기본값)`으로 상한을 두어 부모보다 넓어지지 않는다.
11. checkpoint는 turn을 시작하는 입력(사람 메시지, call, 답, step)마다 생긴다. steer로 도는 turn에 들어간 메시지, fork 복사본, reaction, 알림은 아니다. 다음 turn으로 접수했다가 [Send now]로 올린 메시지는 model 요청에 실려 turn이 정해지는 같은 tx에서 checkpoint를 잃는다. 기록의 `delivery`는 접수 때 값이라 화면은 "turn을 연 입력이 아닌데 turn이 정해진 사람 메시지"를 steer로 본다.
12. session rewind는 도는 turn이 없을 때만 시작한다. 앱 data는 file까지 함께 되돌리는 선택(`restore_all`)에서, 사람이 고른 앱만 되돌린다. 안 고르면 그대로다(`messages_only`는 대화만).
    - 앱 rewind는 시점 단위라 그 사이 다른 쪽의 변경도 함께 사라진다. 그래서 session rewind가 저절로 하지 않고 사람에게 함께 되돌아갈 목록을 먼저 보인다.
    - 앱 rewind는 그 session의 첫 write invocation부터 요청한다. 앱 rewind가 거절되거나 취소돼도 대화와 파일은 되돌리지 않고 결과만 기록에 남긴다. 앱 쪽 순서와 충돌 판단은 앱이 정한다.
    - 숨기는 구간은 되돌린 지점부터 결과를 확정한 때의 session 마지막 메시지까지다. 그 뒤에 접수한 메시지는 숨기지 않는다. 숨김에 끝이 없으면 rewind 뒤의 대화가 모두 사라진다.
13. file tool은 허용 폴더 안에서 기본으로 읽고 쓴다. 등록 폴더 밖 경로는 `file_outside`로 Gate(`tool_gate/check`)에 `ask`(`once | session | reject`)를 묻고, 허락하면 그 호출 한 번(`once`) 또는 이번 대화 동안(`session`, `SessionGrantStore`) 해당 폴더를 연다. 이번 대화에 연 바깥 폴더 안 쓰기도 core가 직접 읽어 rewind 기록에 포함한다. 민감·자기 보호 경로(`~/.ssh`, `~/.aws`, `~/.gnupg`, `<data root>` 설정·권한·agent 정의·secret)는 계속 `scope`로 차단한다(`architecture/approval.md`). 쓰기 직전 파일 내용은 core가 직접 읽어 rewind용으로 둔다. agent runtime이 보낸 내용을 믿지 않는다(되돌릴 때 틀린 내용으로 사람 파일을 덮지 않게).
14. 다른 workspace(project, 앱)의 session이 부른 call로 열린 home session은 project 폴더를 읽지 않고 call에 실려 온 것만 본다. 열 때 부른 workspace를 `sessions.called_from_kind`·`called_from_id`에 남기고(바뀌지 않는다) 읽기 범위를 비운다. 이미 열린 home session에 닿은 call과 사람이 연 home session은 좁히지 않는다. home의 전역 agent(예: 이미지 생성)가 부른 쪽과 상관없는 project를 보지 않게 한다.
15. home의 session은 기획하고 call로 맡기며 project·앱을 직접 쓰지 않는다.
16. 앱의 data와 release 사본(`<data>/apps/<app>/` 아래 `data/`, `bundles/`, `staging/`, `preview/`)은 어느 workspace 종류의 범위에도 없다. 앱 data는 앱 tool로만 다루고 release 사본은 봉인된 것이다. agent 정의(`<data>/agents/`)도 열지 않는다.
    - 앱 source는 기본 자리(`<data>/apps/<app>/source`)이거나 사람이 이은 폴더다. 앱에 더 이은 폴더는 project 연결 폴더와 같은 모양(`{path, description}`)이고, 서로나 source와 겹치면 `invalid_input`이다. release에는 source만 봉인되고 더한 폴더는 들어가지 않는다.
17. 지침 file 중 file 범위 밖인 것이 있다. 사람의 폴더가 없는 project의 `LOPHN.md`(`<data>/projects/<project>/LOPHN.md`), Home의 `LOPHN.md`와 `extensions.json`(`<data>/home/`)은 사람이 editor로 고친다(Home에서 file tool 쓰기가 열리는 것은 `home/skills/`, `home/tools/`, 전역 개인 skill 보관소 `<data>/skills/`뿐). 앱 workspace의 지침은 source의 `AGENTS.md`이고 source 폴더가 범위라 agent가 직접 고칠 수 있다.
18. agent runtime child(kind `lophn-agent/runtime`)는 권한 flag 없이 뜬다. launch spec에는 권한 칸이 없다(kind, entry, policy, memory limit뿐). child 하나가 여러 session을 돌리므로 session마다 띄우지 않고, 폴더·provider·MCP·skill 목록이 바뀌어도 다시 띄우지 않는다. session마다의 file 범위는 file tool 쪽 검사가 지킨다.
19. 사람이 메시지에 붙인 이미지는 메시지 content의 image block이다(`architecture/agent-call.md`의 content block).
    - 화면이 먼저 `message-images/upload`로 올려 blob hash를 받고 `SendMessage.content`에 `{type: "image", mimeType, blob}`을 싣는다. 올림과 `SendMessage`는 같은 자격이어야 한다. 참조되지 않은 올림은 blob 준비의 수명(10분)이 지나면 사라진다.
    - 바이트는 blob store의 blob이다(png, jpeg, gif, webp. 사람은 5 MiB 이하, 내용의 첫 byte로 형식 확인). 메시지가 blob 참조(field `image`)를 갖고 이미지는 그 참조를 가진 메시지의 session에서만 읽힌다. 대기 메시지를 고쳐도 참조는 남는다.
    - runtime은 `message-images/path`(agent 전용 memory route)로 경로를 풀어 bytes를 읽고 model에 image part로 싣는다. core는 입력의 session이 credential의 session과 같고 그 session의 메시지가 blob을 참조할 때만 풀어서, 다른 session의 이미지는 `forbidden`이거나 `not_found`다. 사람 화면은 `message-images/read`(file route)로 다시 그린다.
    - 옛 메시지는 글 끝에 `Attached image: open with image.read path "attachment:<id>".` 줄을 가진다. 가져간 본문은 trigger가 고정해서 그 줄을 block으로 옮기지 않고 글 그대로 둔다. 그 바이트는 `<data>/message-images/<session>/<id>.<ext>`에 남고, `image.read`와 `message-images/path`·`read`가 `attachment:<id>`(`att_…`)를 같은 session 경계로 계속 연다.

## 경계와 계약

- boundary ID는 `agent-sessions`(열기·제목·archive·지움·fork·model·권한 단계), `run-loop`(turn), `agents`(정의), `storage`(지움)이다.
- route(사람만 부른다. 아니면 `forbidden`): `sessions/open`, `sessions/rename`, `sessions/archive`, `sessions/delete`, `sessions/fork`, `sessions/change-model`, `sessions/change-mode`(로컬·원격 기기 모두 4단계 선택 허용), `rewind/preview`와 rewind 시작, `message-images/upload`·`path`·`read`. 같은 id를 같은 내용으로 다시 부르면 처음 결과를 돌려주고(replay), 다른 내용이면 `conflict`다. 낡은 `state_seq`도 `conflict`다.
- 열 때의 오류: agent 정의 없음 또는 그 agent의 범위 밖 workspace는 `not_found`, workspace 없음·보관은 `conflict`, harness agent인데 harness 설정이 꺼져 있으면 `unavailable`이다.
- archive·지움은 receiver_ended 알림 글을 blob으로 미리 준비해야 한다(못 하면 `unavailable`). `sessions/archive`는 지금 도는 turn이 있으면 `stop_turn: true` 없이 `conflict`(`turn_running`)로 거절해 다른 기기에서 방금 시작한 turn이 확인 없이 끊기지 않게 한다. 받은 열린 call을 닫을 때 보낸 쪽이 살아 있는 agent session이면 그 queue에 그 call을 가리키는 program 알림 하나를 같은 tx로 넣는다(ask call이면 알림 대신 main thread에 알린다). 기다리던 request와 질문은 `SessionEnded`를 듣는 approvals 쪽이 cancelled(`session_closed`)로 푼다. 지움은 메시지 본문의 blob 영구 참조, rewind 기록과 checkpoint, 메시지와 turn·model call 기록, session 행을 지우고 되돌릴 수 없다. 응답에는 지운 내용을 싣지 않고 지운 시각만 돌려준다. archive한 session은 기록을 그대로 두고 읽기는 된다.
- fork 입력은 `through_seq`(고른 메시지의 `created_seq`까지 복사. agent 답에서 갈라도 그 답까지 들어간다)다. 출처의 확정 메시지가 아니면 `invalid_input`이다.
- event: `SessionStarted`, `SessionEnded`(reason `archived` | `deleted`). turn 끝은 `TurnEnded`. 이 agent event와 turn·요청·질문 event를 core가 `session.started|running|waiting|idle|ended`(발행자 `lophn`)로 바꿔 앱에 준다(아래 "session lifecycle"). supervision의 `turn_stop`(reason `user_stopped` | `session_ended`)이 agent runtime child에 간다.
- 저장: `sessions` 표(`agent`, `workspace_kind`, `workspace_id`, `permission_mode`, `called_from_kind`, `called_from_id`, `opened_by_machine`(다른 컴퓨터의 mail이 연 session의 보낸 기계, 바뀌지 않는다. `architecture/machine-a2a.md`), `state_seq`, model 선택). 이미지는 blob 참조(메시지의 `image`)와 옛 `<data>/message-images/<session>/`.
- 설정·표시: `app.edit_folders`(앱에 더 이은 폴더), agent 정의의 `permission_mode`(비면 전역 기본 `approvals.default_mode`).
- 앱 rewind와의 이음: session rewind가 사람이 고른 앱의 rewind를 요청한다(`architecture/app-call.md`).

### session lifecycle

앱이 "어떤 session이 있고 무슨 상태인가"를 읽고 멈춘다. lophn만 아는 것만 주고(git 정보, process 목록, process kill은 주지 않는다. 앱이 `LOPHN_SESSION_ID`·cwd·shell pid로 직접 한다) 새 permission이나 새 정책을 만들지 않는다.

- 상태(running·waiting·idle)는 한 곳(session 상태 파생)이 정한다: 도는 turn이 있으면 running, 사람의 동의나 질문 답을 기다리면 waiting(approval | question), 아니면 idle이다. 기다림을 메모리(대기 요청·질문)로 보는 곳(snapshot·목록·event)과 ledger의 tool call로 보는 곳(Router의 call 대상 상태, Worker라 메모리가 없다)은 같은 함수의 두 입력이다. ACP의 turn `phase`(화면 투영)와 shell의 터미널 tracker(hook으로 아는 터미널 CLI의 상태)는 따로 남는다.
- session 한 줄: id, kind(`lophn` | `harness` | `terminal`), agent(handle·이름·runtime, terminal은 없음), harness, workspace, 제목, 상태, waiting_for, 마지막 활동 시각, `spawned_by`, cwd와 폴더 목록, terminal이면 {harness, CLI session id, 탭, PTY shell pid}. event payload도 같은 한 줄이다.
- **process를 session에 잇는 법은 환경 표지가 먼저다.** `LOPHN_SESSION_ID`의 값은 목록 한 줄의 session id와 같다: lophn agent의 `shell.run`과 headless harness CLI(그 아래 process도)는 `ses_…`, 터미널 탭은 탭의 shell과 그 안에서 뜬 모든 process가 `term:<탭>`이다(core의 PTY host가 PTY를 열 때 넣는다. 바깥에서 물려받은 값은 `LOPHN_*`와 함께 지운다). GUI view(harness-gui)가 띄운 CLI는 탭의 shell이 아니라 core extension host의 자식이라 PTY shell pid로 찾을 수 없으므로 같은 값을 그 spawn에 실어 띄운다. `shell_pid`는 표지가 없는 때(표지를 넣기 전에 연 탭, env를 비우고 띄운 process)의 대안이다. core는 이 값을 읽지 않는다("agent session 안이다"는 `LOPHN_AGENT_SHELL`이 뜻한다).
- **GUI view의 탭도 목록에 든다.** 터미널 session은 core의 coding session 집합이고 tracker(foreground TUI와 hook)가 만든다. GUI view에서는 foreground에 TUI가 없고 hook이 닿지 않을 수 있어, GUI 탭이 있는 터미널은 handle이 아는 값(제목, CLI session id, turn 단계 working→running·waiting→waiting·그 밖 idle, session을 아직 모르면 unknown)으로 채운다. TUI view(shared handle이 남은 때)는 tracker가 정한다. GUI 탭이 바뀌면(turn 시작·끝, 승인·질문, 제목) 바로 다시 알린다.
- event(발행자 `lophn`, 앱은 `subscriptions`의 source `lophn`으로 듣는다): `session.started`, `session.running`, `session.waiting`, `session.idle`, `session.ended`. 상태가 바뀐 뒤(commit 뒤 agent event를 받아 다시 파생해 바뀐 때)에만 낸다. 앱 event와 같은 전달 길(구독을 선언한 켜진 앱의 handler 호출, 열린 앱 화면)을 쓴다.
- 보이는 범위는 call 정책이다: 앱은 그 앱 workspace에 사는 agent가 call로 닿을 수 있는 workspace의 session만 보고(private workspace는 안 보이고 같은 workspace는 늘 보인다) event도 그 session의 것만 받는다. agent 쌍 규칙과 팀 규칙은 agent가 없는 앱에 적용되지 않는다(`mayReachWorkspace`).
- 읽기: `app_sessions.list`(workspace·state·harness·kind로 거른다), `app_sessions.status`(`ReadSessionStatus`와 같은 값, lophn·harness session만). 멈추기: `app_sessions.stop`은 보이는 모든 session에 열려 있다(승인·rewind·fork·지움은 열지 않는다). lophn runtime은 도는 turn을 `StopTurn`으로 닫고(model 요청과 도는 `shell.run`을 process group째 끊는다), harness runtime은 turn이 닫히면 host가 CLI를 group째 끊고(SIGTERM, 남으면 SIGKILL), 터미널 탭은 그 harness의 끊기 key를 친다(key가 없는 harness는 `unavailable`). 친 뒤 shell의 터미널 tracker는 사람이 같은 key를 친 것과 같이 상태를 `unknown`으로 내린다(다음 hook까지, 목록이 running으로 남지 않는다). 앱이 멈춘 것은 사람이 볼 수 있게 program 기록(`session_stopped_by_app`, Inbox History와 앱 상세 Activity)으로 남는다.
- 열기와 끝내기(앱 화면만, 앱 process에는 없다): `app_sessions.open`은 agent(handle)의 새 session을 열고(machine 명령 `OpenAppSession`, 사람 자격의 `OpenSession`은 표시를 받지 않는다) `sessions.opened_by_app`(바뀌지 않는다)을 단다. workspace를 빼면 그 앱 workspace이고, 주면 그 앱이 call로 닿을 수 있는 workspace(call 정책)에만 열린다(아니면 `forbidden`). 앱이 call로 새 session을 열게 한 것(`architecture/agent-call.md`)도 같은 표시가 달린다. `app_sessions.end`는 그 앱이 연 session만 `ArchiveSession`과 같은 영향으로 끝낸다(도는 turn 중단, 받은 call 실패, 대기 요청 취소, queue 비움). 남이 연 session(사람 포함)은 `forbidden`, 이미 끝난 것은 `ended: false`다. 앱이 연 session은 turn 끝 알림을 내지 않는다(승인·질문은 낸다). 이 억제는 `opened_by_app`이 ledger에 있어 영구하다(전에는 shell 메모리라 shell을 다시 켜면 풀렸다). `app_sessions.list`는 `session` 한 건으로 묻는 길이 있다(앱 화면의 ACP 붙이기가 보이는지 본다).
- 앱 process는 broker(`/_lophn/broker/sessions/{list,status,stop}`), 앱 화면은 `lophnApp.sessions`(shell main이 sender view에서 앱을 정한다)로 목록·상태·멈추기·끝내기 route를 부른다. 부모 invocation이 돌고 있지 않아도 된다.

## 결정

- session이 일하는 그릇(home, project, app)을 workspace라 부른다. 이유: 전에는 place였다. 코드·protocol·화면·문서의 이름을 모두 바꿨다. 사람이 쓰던 data root는 schema step과 data step이 옮겼고, 이미 낸 step의 id와 SQL은 기록이라 옛 이름 그대로다. 전역 설정 층은 화면에서 "Workspace" 대신 "Global"로 부른다. workspace 하나와 헷갈리지 않게 한다. (사람, 2026-11-05)
- agent는 전역이고 workspace는 session이 갖는다. 이유: role(lophn, Project Manager, App Engineer, Operator)이 agent를 workspace에 묶었지만 workspace가 하는 일(file 범위, credential 조건, prompt, 주소)은 모두 "session이 어디서 일하나"의 일이다. Claude Code, Codex, OpenCode도 agent 설정은 전역이고 작업 폴더는 session마다다. 버린 안: 옛 assignment 상태 machine(누가 무엇을 맡았나). agent와 할당으로 대체했다. 맡기는 것은 call이고 허락은 할당이다. (사람, 2026-10-28)
- 앱 일은 그 앱 workspace의 session이 한다. 이유: 앱은 project에 묶이지 않는 그릇이라 앱 코드의 일(설계, 선언, 구현, release)은 그 앱 workspace에서 한다. 앱은 사람이 Home의 Workspaces panel에서 New app으로 직접 만들거나(그 앱 workspace의 lophn 새 session으로 시작한다), home의 lophn이 등록하고 그 앱 workspace의 lophn session에 call로 맡긴다. (agent)
- 앱 workspace에는 project 지침이 없고 앱 지침이 있다. 이유: 앱은 project에 묶이지 않는다. (agent)
- "이 대화 동안(`session`)" 허락은 core 메모리의 `SessionGrantStore`에 두고 session이 끝나거나 재시작하면 비워지며 fork로 복사하지 않는다(`architecture/approval.md`). session의 권한 단계(`permission_mode`)는 표(`sessions.permission_mode`)에 남기고, fork는 출처의 단계를 가져가지 않고 agent/전역 기본값으로 시작한다. 팀 자식은 `min(부모 단계, 정의/전역 기본값)`으로 상한을 둔다. (사람 2026-11-25 결정으로 2026-10-20의 `session` 허락 폐지 및 `skip` 2단계 결정을 대체)
- agent runtime child 하나가 여러 session을 돈다. 이유: 폴더·provider·MCP·skill 목록이 바뀌어도 다시 띄우지 않으려는 것이다. 권한 flag를 두지 않는 것은 사람이 정했다. 좁힌 권한은 경계가 아니었다(`shell.run`이 `/bin/sh`로 우회하고, 폴더 목록이 어긋나면 file tool만 `NotCapable`로 막혔다). file tool의 폴더 범위는 코드가 지킨다. 버린 안: Deno 권한 flag로 폴더 좁히기. 비교(2026-11-10, harness 여덟을 조사했다): session마다 process를 두는 쪽은 Claude Code·pi·omp(CLI가 먼저인 제품)이고, Codex·OpenCode·dsh·mixdog·Hermes는 server가 먼저라 session이 process 안의 task다(N:1). lophn은 뒤쪽이다. 어느 쪽도 process를 권한 경계로 쓰지 않고 sandbox는 명령마다 씌운다. session마다 process를 나눠 얻는 것(crash 격리, session별 kill)보다 치르는 것(기동 시간, memory, session마다 MCP)이 커서 나누지 않는다. session별 kill은 turn을 끊는 `turn_stop`(model 요청과 도는 `shell.run`을 process group째)이 하고 session별 pid는 없다. 여덟 곳 가운데 shell tool을 가진 곳은 child env에 session id를 넣는다(`CODEX_THREAD_ID`, `OPENCODE_SESSION_ID`, `CLAUDE_CODE_SESSION_ID` 등). lophn도 `shell.run`과 harness CLI의 env에 `LOPHN_SESSION_ID`를 넣는다. (사람, 2026-10-24. 비교와 `LOPHN_SESSION_ID`: 사람, 2026-11-10)
- 다른 workspace의 session이 부른 call로 열린 home session은 project 폴더를 읽지 않는다. 이유: home의 전역 agent가 부른 쪽과 상관없는 project를 읽는 것을 막는다. (사람, 2026-11-04)
- fork는 있는 그대로 복사하되 묶인 것은 놓고 간다. 이유: 권한 단계나 `SessionGrantStore` 허락을 가져가면 한 번의 사람 결정이 두 session에 쓰이고, call을 가져가면 한 call에 받는 session이 둘이다. (agent)
- checkpoint는 turn을 시작한 입력에만 둔다. 이유: steer로 도는 turn에 끼어든 메시지는 turn의 경계가 아니라서 돌아갈 시점이 아니다. Claude Code checkpointing도 turn 중 보낸 메시지는 checkpoint로 치지 않는다. (agent)
- session rewind와 앱 rewind를 묶지 않고 잇기만 한다. 이유: 하나로 합치면 대화를 되돌리다 다른 사람의 앱 변경까지 말없이 지운다. 고르게 하는 쪽이 Claude Code의 rewind 메뉴(코드와 대화를 따로 고름)와 같다. (agent)
- 쓰기 직전 파일 내용을 core가 직접 읽어 두고 허용 폴더 root별로 기록하는 무거운 장치를 남긴다. 이유: 데이터 보호 장치라 단순화 이득이 작다. agent runtime이 보낸 내용을 믿으면 되돌릴 때 틀린 내용으로 사람 파일을 덮을 수 있다. 한 단위에 허용 폴더가 둘 이상이거나 앞 기록의 after와 뒤 기록의 before가 어긋나면 그 쓰기는 되돌리지 않고 건너뛴다. (agent)
- rewind가 숨기는 구간의 끝은 되돌린 결과를 확정한 때의 session 마지막 메시지다. 이유: 숨김에 끝이 없으면 rewind 뒤의 대화가 모두 사라진다. (agent)
- archive를 풀어 다시 여는 것(되살리기)을 두지 않는다. 이유: 되살리면 대기 request가 돌아오지 않는 규칙을 따로 정해야 하고, 필요가 생길 때까지 닫힌 session은 새 session으로 이어 간다. 버린 안: handler 없이 남은 `unarchiveSession` 계약. 지웠다. (사람)
- 켤 때 사람 메시지는 다시 queue에 넣지만 call·step·run 입력은 다시 넣지 않는다. 이유: 사람 메시지는 잃으면 안 되고, run 입력을 다시 돌리면 바깥 효과가 두 번 난다. call은 보낸 쪽이 `lophn_restarted`로 알고, step은 workflow가 줄로 남긴다. (agent)
- 이미지는 blob이고 session 경계로만 읽는다. 이유: 이미지 바이트는 core의 content 한도에 들어가지 않고, 다른 session의 이미지가 읽히면 안 된다. 옛 첨부 줄은 block으로 옮기지 않고 글 그대로 둔다(가져간 본문이 trigger로 고정돼 있다). (agent)

- session 제목은 두 단계다. 첫 사람 요청을 접수하는 tx에서 앞 60자를 잘라 바로 제목으로 두고, 첫 turn이 첫 model call과 나란히 session model로 제목 call(`title_summary`, 첫 요청만 재료) 하나를 해 2–6단어 제목으로 바꾼다. call로 시작한 session은 그 call의 맡긴 글을 같은 규칙으로 잘라 둔다. 제목 call은 시작할 때 session의 지금 제목을 읽고, 바꾸는 command(`sessions/ai-title`)는 제목이 아직 그 읽은 제목일 때만 쓰므로 사람이 그 사이 rename한 제목은 덮지 않고, 출처 칸을 따로 두지 않는다. 자른 제목을 요청 글에서 다시 계산해 맞추지 않는다(이미지·file 표시가 든 제목과 어긋난다). 제목 call은 본 call과 같은 turn의 call로 기록하되 시도 번호는 각자 잡는다. call이 실패하거나 답이 제목 꼴이 아니면 자른 제목이 남는다. 이유: 조사한 harness 대부분(Claude Code, Codex, OpenCode, omp, dsh, hermes, mixdog)이 LLM 제목을 쓰고, hermes·dsh처럼 즉시 보이는 제목을 먼저 두면 제목 call을 기다리지 않는다. 작은 model 설정이 없어 session model을 쓴다(dsh·hermes 기본과 같다). (agent, 2026-11-10)
- session lifecycle을 SDK에 따로 짓지 않고 core가 event의 첫 발행자가 된다. 앱은 listener를 건다. 같은 일을 앱마다 다시 만들 필요가 없다. (사람, 2026-11-10)
- 터미널의 coding agent도 같은 목록과 event에 넣는다(kind `terminal`). session id가 없어 `term:<탭>`을 id로 쓴다. 상태는 core의 tracker가 알고(`terminal-agent.md`), 터미널 집합이 바뀔 때마다 core 안에서 지금 집합을 통째로 목록에 넘긴다. 메모리에만 두고 터미널이 끝나면 빠진다. 처음에는 tracker가 shell main에 있어 `/host-link`의 `coding_report` frame으로 알렸다. (사람이 session id·ppid를 물은 것에서, 2026-11-10. 통째로 알리기와 메모리: agent)
- `stop`은 시야 안 모든 session에 열고 archive·승인·rewind·fork·지움은 열지 않는다. stop은 잃는 것이 없고 사람의 예(한도에서 멈춤)가 남이 연 session을 멈추는 일이다. 멈춘 앱은 사람이 볼 수 있게 남긴다. (agent, 사람이 방향을 받음)
- 가시성은 mayCall을 그대로 쓰되 agent 쌍을 빼는 함수(`mayReachWorkspace`)를 떼어 앱이 쓴다. 가짜 agent를 앱 대신 세우면 agent 쌍 규칙에 걸린다. (agent)

## 열린 것

- `shell.run`이 OS sandbox와 rewind를 거치지 않는다. home·project·app workspace의 tool 목록에 있고 `/bin/sh`를 범위 폴더(home은 OS home 폴더)에서 띄운다. 2026-11-25 개편으로 내장 읽기 명령 외에는 기본 `ask`와 상태 기계 shell 스캐너·래퍼 해제·정규화 floor로 가드하고 판정 엔진에 `IsolationBackend = "none"` 슬롯을 두었지만, OS sandbox는 아직 없어 한 번 허락한 명령 안에서 일어나는 일은 OS 경계로 막지 못하며 rewind 기록은 `file.write`·`file.edit` 쓰기만 남긴다(이슈 `shell-run-bypasses-file-scope`).
- turn 끝 기록(FinishTurn)이 거절되면(예: 결과 blob이 한도 초과, ledger 오류) turn을 failed(`internal`)로 닫고 다음 turn이 시작된다. 그 닫는 기록마저 실패하면 core를 다시 켜 interrupted(`restarted`)로 닫을 때까지 turn이 running으로 남아 session이 멈춘 것으로 보인다.
- session을 지워도 이미지 blob과 옛 이미지 파일은 지우지 않는다(알려진 빈틈).

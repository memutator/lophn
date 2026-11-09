# workspace-session

agent와 하는 대화가 session이고, session은 workspace(없음=Home, project, 앱) 하나에서 일한다. 이 문서는 session의 정체, 열리고 끝나는 때, 끝날 때 call·turn·질문에 같이 일어나는 일, 복사(fork)와 되돌리기(rewind)가 가져가는 것과 두고 가는 것, workspace가 정하는 file 범위, 사람이 붙인 이미지가 session에 묶이는 방식을 정한다.

## 문제

session의 경계가 흐리면 사람이 대화에서 잃는 것이 생긴다. 끝난 session이 call을 붙잡아 보낸 쪽이 영원히 기다리고, 한 session에 켠 skip이 다른 session으로 새고, 되돌린 대화에 낡은 요청이 남는다. 열린 session의 agent나 workspace가 바뀌면 이미 쌓인 대화가 다른 agent의 것이 된다. file 범위가 새면 agent가 엉뚱한 project나 앱의 폴더를 읽고 쓴다.

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
  - project: 그 project의 폴더들(사람이 이은 것. 없을 수도 있다)과 그 project의 `workflows/`·`artifacts/`·`skills/`(`<data>/projects/<project>/…`)를 읽고 쓴다.
  - 앱: 앱 source 폴더, 사람이 앱에 더 이은 폴더(`app.edit_folders`, App details의 Folders), 그 앱의 `artifacts/`·`skills/`(`<data>/apps/<app>/…`)를 읽고 쓴다.
  - home: 등록된 모든 project 폴더를 읽기만 하고, 자기 `skills/`(`<data>/home/skills/`)를 읽고 쓴다.
  - 범위는 상대 경로를 푸는 기준 `base`를 싣는다. 그릇의 첫 폴더(project의 첫 폴더, 앱은 source가 있으면 source, 없으면 첫 더한 폴더)이고, 없으면 workspace의 data 폴더(`<data>/projects/<project>`, `<data>/apps/<app>`)다. `base`는 상대 경로를 푸는 기준일 뿐 허락을 넓히지 않는다.

## 지키는 것

1. session의 정체(agent, workspace)는 열 때 정해져 바뀌지 않는다. 저장소가 거절한다(`sessions` 표의 `agent`, `workspace_kind`, `workspace_id`는 고치지 못한다). agent 정의가 없는 agent, 없거나 보관된 workspace에는 열지 않는다. 어느 agent든 자기 범위 안의 어느 workspace에든 열 수 있다.
   - agent 정의, 할당, 지침, file 범위가 agent와 workspace에서 나온다. 열린 session의 것을 바꾸면 쌓인 대화가 다른 agent의 것이 된다.
2. session을 여는 길은 사람, Router, run이고 같은 연산으로 연다. Router는 call과 workflow step의 새 session(`architecture/workflow.md`)과 program 알림으로 연다. 열 때의 검사(agent 정의, workspace, 보관 여부)가 한 곳이라 어느 길로 열어도 같은 session이 된다.
3. run(`architecture/run.md`)이 연 session도 사람이 연 것과 같은 session이고 run이 끝나도 열린 채 남는다. 저절로 닫지 않는다. 화면은 sidebar에 그대로 두지 않고 그 session을 연 run 아래로 묶어 보인다(`--session`으로 이어 쓴 session은 원래 자리다).
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
   - session의 skip 표시는 표(`sessions.skip`)에 남는다.
8. 사람 메시지는 버리지 않는다. 켤 때 아직 turn이 가져가지 않은 사람 메시지를 받은 순서대로 queue에 다시 넣어 turn을 연다. 뺀다: fork 사본, rewind가 숨긴 구간, 보관한 session과 workspace의 것, run 입력(`messages.unattended`가 1인 사람 메시지). 그 run은 켤 때 `lophn_restarted`로 닫히는데, 다시 돌면 닫힌 run 뒤에 attended turn이 생겨 바깥 효과가 두 번 난다(`architecture/run.md`).
9. agent runtime child가 죽으면 그 child가 돌리던 turn은 interrupted(`restarted`)로 닫고 queue 표시와 기다리던 request를 푼다. 닫지 않으면 session이 새 입력을 모두 `conflict`로 막는다.
10. fork는 이력만 복사한다. 같은 agent, 같은 workspace의 새 session이고 고른 지점(`through_seq`)까지의 확정 메시지를 가져가며, rewind가 숨긴 구간은 복사하지 않는다.
    - 대기 request와 질문, 열린 call, rewind 기록은 원래 session의 turn에 묶여 있어 가져가지 않는다. 같은 파일을 두 session이 되돌리면 부딪친다.
    - skip도 가져가지 않는다. 새 session은 agent 정의의 `skip` 기본값으로 시작한다.
    - 제목과 model 선택은 잇는다. 이미지 blob 참조는 복사본마다 새로 건다. 부른 workspace(`called_from_*`)는 옮긴다.
11. checkpoint는 turn을 시작하는 입력(사람 메시지, call, 답, step)마다 생긴다. steer로 도는 turn에 들어간 메시지, fork 복사본, reaction, 알림은 아니다. 다음 turn으로 접수했다가 [Send now]로 올린 메시지는 model 요청에 실려 turn이 정해지는 같은 tx에서 checkpoint를 잃는다. 기록의 `delivery`는 접수 때 값이라 화면은 "turn을 연 입력이 아닌데 turn이 정해진 사람 메시지"를 steer로 본다.
12. session rewind는 도는 turn이 없을 때만 시작한다. 앱 data는 file까지 함께 되돌리는 선택(`restore_all`)에서, 사람이 고른 앱만 되돌린다. 안 고르면 그대로다(`messages_only`는 대화만).
    - 앱 rewind는 시점 단위라 그 사이 다른 쪽의 변경도 함께 사라진다. 그래서 session rewind가 저절로 하지 않고 사람에게 함께 되돌아갈 목록을 먼저 보인다.
    - 앱 rewind는 그 session의 첫 write invocation부터 요청한다. 앱 rewind가 거절되거나 취소돼도 대화와 파일은 되돌리지 않고 결과만 기록에 남긴다. 앱 쪽 순서와 충돌 판단은 앱이 정한다.
    - 숨기는 구간은 되돌린 지점부터 결과를 확정한 때의 session 마지막 메시지까지다. 그 뒤에 접수한 메시지는 숨기지 않는다. 숨김에 끝이 없으면 rewind 뒤의 대화가 모두 사라진다.
13. file tool은 허용 폴더 안에서만 읽고 쓴다. 범위 밖은 realpath를 보고 `forbidden`("path is outside the workspace")으로 거절한다. 쓰기 직전 파일 내용은 core가 허용 폴더 안에서 직접 읽어 rewind용으로 둔다. agent runtime이 보낸 내용을 믿지 않는다(되돌릴 때 틀린 내용으로 사람 파일을 덮지 않게).
14. 다른 workspace(project, 앱)의 session이 부른 call로 열린 home session은 project 폴더를 읽지 않고 call에 실려 온 것만 본다. 열 때 부른 workspace를 `sessions.called_from_kind`·`called_from_id`에 남기고(바뀌지 않는다) 읽기 범위를 비운다. 이미 열린 home session에 닿은 call과 사람이 연 home session은 좁히지 않는다. home의 전역 agent(예: 이미지 생성)가 부른 쪽과 상관없는 project를 보지 않게 한다.
15. home의 session은 기획하고 call로 맡기며 project·앱을 직접 쓰지 않는다.
16. 앱의 data와 release 사본(`<data>/apps/<app>/` 아래 `data/`, `bundles/`, `staging/`, `preview/`)은 어느 workspace 종류의 범위에도 없다. 앱 data는 앱 tool로만 다루고 release 사본은 봉인된 것이다. agent 정의(`<data>/agents/`)도 열지 않는다.
    - 앱 source는 기본 자리(`<data>/apps/<app>/source`)이거나 사람이 이은 폴더다. 앱에 더 이은 폴더는 project 연결 폴더와 같은 모양(`{path, description}`)이고, 서로나 source와 겹치면 `invalid_input`이다. release에는 source만 봉인되고 더한 폴더는 들어가지 않는다.
17. 지침 file 중 file 범위 밖인 것이 있다. 사람의 폴더가 없는 project의 `LOPHN.md`(`<data>/projects/<project>/LOPHN.md`), Home의 `LOPHN.md`와 `extensions.json`(`<data>/home/`)은 사람이 editor로 고친다(Home 그릇 자리에서 열리는 것은 `skills/`뿐). 앱 workspace의 지침은 source의 `AGENTS.md`이고 source 폴더가 범위라 agent가 직접 고칠 수 있다.
18. agent runtime child(kind `lophn-agent/runtime`)는 권한 flag 없이 뜬다. launch spec에는 권한 칸이 없다(kind, entry, policy, memory limit뿐). child 하나가 여러 session을 돌리므로 session마다 띄우지 않고, 폴더·provider·MCP·skill 목록이 바뀌어도 다시 띄우지 않는다. session마다의 file 범위는 file tool 쪽 검사가 지킨다.
19. 사람이 메시지에 붙인 이미지는 메시지 content의 image block이다(`architecture/agent-call.md`의 content block).
    - 화면이 먼저 `message-images/upload`로 올려 blob hash를 받고 `SendMessage.content`에 `{type: "image", mimeType, blob}`을 싣는다. 올림과 `SendMessage`는 같은 자격이어야 한다. 참조되지 않은 올림은 blob 준비의 수명(10분)이 지나면 사라진다.
    - 바이트는 blob store의 blob이다(png, jpeg, gif, webp. 사람은 5 MiB 이하, 내용의 첫 byte로 형식 확인). 메시지가 blob 참조(field `image`)를 갖고 이미지는 그 참조를 가진 메시지의 session에서만 읽힌다. 대기 메시지를 고쳐도 참조는 남는다.
    - runtime은 `message-images/path`(agent 전용 memory route)로 경로를 풀어 bytes를 읽고 model에 image part로 싣는다. core는 입력의 session이 credential의 session과 같고 그 session의 메시지가 blob을 참조할 때만 풀어서, 다른 session의 이미지는 `forbidden`이거나 `not_found`다. 사람 화면은 `message-images/read`(file route)로 다시 그린다.
    - 옛 메시지는 글 끝에 `Attached image: open with image.read path "attachment:<id>".` 줄을 가진다. 가져간 본문은 trigger가 고정해서 그 줄을 block으로 옮기지 않고 글 그대로 둔다. 그 바이트는 `<data>/message-images/<session>/<id>.<ext>`에 남고, `image.read`와 `message-images/path`·`read`가 `attachment:<id>`(`att_…`)를 같은 session 경계로 계속 연다.

## 경계와 계약

- boundary ID는 `agent-sessions`(열기·제목·archive·지움·fork·model·skip), `run-loop`(turn), `agents`(정의), `storage`(지움)이다.
- route(사람만 부른다. 아니면 `forbidden`): `sessions/open`, `sessions/rename`, `sessions/archive`, `sessions/delete`, `sessions/fork`, `sessions/change-model`, `sessions/change-skip`, `rewind/preview`와 rewind 시작, `message-images/upload`·`path`·`read`. 같은 id를 같은 내용으로 다시 부르면 처음 결과를 돌려주고(replay), 다른 내용이면 `conflict`다. 낡은 `state_seq`도 `conflict`다.
- 열 때의 오류: agent 정의 없음 또는 그 agent의 범위 밖 workspace는 `not_found`, workspace 없음·보관은 `conflict`, harness agent인데 harness 설정이 꺼져 있으면 `unavailable`이다.
- archive·지움은 receiver_ended 알림 글을 blob으로 미리 준비해야 한다(못 하면 `unavailable`). 받은 열린 call을 닫을 때 보낸 쪽이 살아 있는 agent session이면 그 queue에 그 call을 가리키는 program 알림 하나를 같은 tx로 넣는다(ask call이면 알림 대신 main thread에 알린다). 기다리던 request와 질문은 `SessionEnded`를 듣는 approvals 쪽이 cancelled(`session_closed`)로 푼다. 지움은 메시지 본문의 blob 영구 참조, rewind 기록과 checkpoint, 메시지와 turn·model call 기록, session 행을 지우고 되돌릴 수 없다. 응답에는 지운 내용을 싣지 않고 지운 시각만 돌려준다. archive한 session은 기록을 그대로 두고 읽기는 된다.
- fork 입력은 `through_seq`(고른 메시지의 `created_seq`까지 복사. agent 답에서 갈라도 그 답까지 들어간다)다. 출처의 확정 메시지가 아니면 `invalid_input`이다.
- event: `SessionStarted`, `SessionEnded`(reason `archived` | `deleted`). turn 끝은 `TurnEnded`. supervision의 `turn_stop`(reason `user_stopped` | `session_ended`)이 agent runtime child에 간다.
- 저장: `sessions` 표(`agent`, `workspace_kind`, `workspace_id`, `skip`, `called_from_kind`, `called_from_id`, `state_seq`, model 선택). 이미지는 blob 참조(메시지의 `image`)와 옛 `<data>/message-images/<session>/`.
- 설정·표시: `app.edit_folders`(앱에 더 이은 폴더), agent 정의의 `skip`(새 session의 skip 기본값).
- 앱 rewind와의 이음: session rewind가 사람이 고른 앱의 rewind를 요청한다(`architecture/app-call.md`).

## 결정

- session이 일하는 그릇(home, project, app)을 workspace라 부른다. 이유: 전에는 place였다. 코드·protocol·화면·문서의 이름을 모두 바꿨다. 사람이 쓰던 data root는 schema step과 data step이 옮겼고, 이미 낸 step의 id와 SQL은 기록이라 옛 이름 그대로다. 전역 설정 층은 화면에서 "Workspace" 대신 "Global"로 부른다. workspace 하나와 헷갈리지 않게 한다. (사람, 2026-11-05)
- agent는 전역이고 workspace는 session이 갖는다. 이유: role(lophn, Project Manager, App Engineer, Operator)이 agent를 workspace에 묶었지만 workspace가 하는 일(file 범위, credential 조건, prompt, 주소)은 모두 "session이 어디서 일하나"의 일이다. Claude Code, Codex, OpenCode도 agent 설정은 전역이고 작업 폴더는 session마다다. 버린 안: 옛 assignment 상태 machine(누가 무엇을 맡았나). agent와 할당으로 대체했다. 맡기는 것은 call이고 허락은 할당이다. (사람, 2026-10-28)
- 앱 일은 그 앱 workspace의 session이 한다. 이유: 앱은 project에 묶이지 않는 그릇이라 앱 코드의 일(설계, 선언, 구현, release)은 그 앱 workspace에서 한다. 앱은 사람이 Home의 Workspaces panel에서 New app으로 직접 만들거나(그 앱 workspace의 lophn 새 session으로 시작한다), home의 lophn이 등록하고 그 앱 workspace의 lophn session에 call로 맡긴다. (agent)
- 앱 workspace에는 project 지침이 없고 앱 지침이 있다. 이유: 앱은 project에 묶이지 않는다. (agent)
- "이 session 동안" 허락은 없다. 이유: 할당했으면 허락한 것이고 shell 규칙의 `ask`는 `always`로 규칙 줄을 더한다(`architecture/approval.md`). skip은 사람이 그 session에 켠 표시라 표에 남긴다. (agent)
- agent runtime child 하나가 여러 session을 돈다. 이유: 폴더·provider·MCP·skill 목록이 바뀌어도 다시 띄우지 않으려는 것이다. 권한 flag를 두지 않는 것은 사람이 정했다. 좁힌 권한은 경계가 아니었다(`shell.run`이 `/bin/sh`로 우회하고, 폴더 목록이 어긋나면 file tool만 `NotCapable`로 막혔다). file tool의 폴더 범위는 코드가 지킨다. 버린 안: Deno 권한 flag로 폴더 좁히기. (사람, 2026-10-24)
- 다른 workspace의 session이 부른 call로 열린 home session은 project 폴더를 읽지 않는다. 이유: home의 전역 agent가 부른 쪽과 상관없는 project를 읽는 것을 막는다. (사람, 2026-11-04)
- fork는 있는 그대로 복사하되 묶인 것은 놓고 간다. 이유: skip을 가져가면 한 번의 사람 결정이 두 session에 쓰이고, call을 가져가면 한 call에 받는 session이 둘이다. (agent)
- checkpoint는 turn을 시작한 입력에만 둔다. 이유: steer로 도는 turn에 끼어든 메시지는 turn의 경계가 아니라서 돌아갈 시점이 아니다. Claude Code checkpointing도 turn 중 보낸 메시지는 checkpoint로 치지 않는다. (agent)
- session rewind와 앱 rewind를 묶지 않고 잇기만 한다. 이유: 하나로 합치면 대화를 되돌리다 다른 사람의 앱 변경까지 말없이 지운다. 고르게 하는 쪽이 Claude Code의 rewind 메뉴(코드와 대화를 따로 고름)와 같다. (agent)
- 쓰기 직전 파일 내용을 core가 직접 읽어 두고 허용 폴더 root별로 기록하는 무거운 장치를 남긴다. 이유: 데이터 보호 장치라 단순화 이득이 작다. agent runtime이 보낸 내용을 믿으면 되돌릴 때 틀린 내용으로 사람 파일을 덮을 수 있다. 한 단위에 허용 폴더가 둘 이상이거나 앞 기록의 after와 뒤 기록의 before가 어긋나면 그 쓰기는 되돌리지 않고 건너뛴다. (agent)
- rewind가 숨기는 구간의 끝은 되돌린 결과를 확정한 때의 session 마지막 메시지다. 이유: 숨김에 끝이 없으면 rewind 뒤의 대화가 모두 사라진다. (agent)
- archive를 풀어 다시 여는 것(되살리기)을 두지 않는다. 이유: 되살리면 대기 request가 돌아오지 않는 규칙을 따로 정해야 하고, 필요가 생길 때까지 닫힌 session은 새 session으로 이어 간다. 버린 안: handler 없이 남은 `unarchiveSession` 계약. 지웠다. (사람)
- 켤 때 사람 메시지는 다시 queue에 넣지만 call·step·run 입력은 다시 넣지 않는다. 이유: 사람 메시지는 잃으면 안 되고, run 입력을 다시 돌리면 바깥 효과가 두 번 난다. call은 보낸 쪽이 `lophn_restarted`로 알고, step은 workflow가 줄로 남긴다. (agent)
- 이미지는 blob이고 session 경계로만 읽는다. 이유: 이미지 바이트는 core의 content 한도에 들어가지 않고, 다른 session의 이미지가 읽히면 안 된다. 옛 첨부 줄은 block으로 옮기지 않고 글 그대로 둔다(가져간 본문이 trigger로 고정돼 있다). (agent)

## 열린 것

- `shell.run`이 file 범위와 rewind를 거치지 않는다. project·app workspace의 tool 목록에 있고(home에는 없다) `/bin/sh`를 범위 폴더에서 띄우지만 OS sandbox가 없다. 규칙에 걸리지 않는 명령은 묻지 않고 돈다. rewind 기록은 file tool의 쓰기만 남긴다. agent가 shell로 범위 밖 파일을 읽고 쓰거나 지워도 막는 것이 없고, 그렇게 바뀐 파일은 session rewind로 돌아오지 않는다. 추천은 project workspace의 목록에서 `shell.run`을 빼는 것이고(app은 앱 test와 type 검사에 필요해 남긴다) 대안은 OS sandbox다. 일단 그대로 두기로 했다(사람, 2026-10-19). 이슈 `project-docs/issues/workspace-session.md`.
- 끝내는 기록이 실패한 turn이 running으로 남아 session이 막힌다. turn 끝 기록(FinishTurn)이 거절되면(예: 결과 blob이 한도 초과, ledger 오류) turn 행이 running인 채 남는다. 새 입력은 `conflict`가 나거나 도는 turn에 끼우는 것으로 보여 queue에만 들어가 아무도 읽지 않는다. core를 다시 켜 interrupted(`restarted`)로 닫을 때까지 session이 멈춘 것으로 보인다. 추천은 끝내기가 값으로 실패해도 failed(`internal`)로 닫는 것이다. 이슈 `project-docs/issues/workspace-session.md`.
- session을 지워도 이미지 blob과 옛 이미지 파일은 지우지 않는다(알려진 빈틈).

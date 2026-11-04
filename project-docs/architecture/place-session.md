# place-session

lophn의 agent는 lophn과 사람이 만든 agent이고 정의는 전역이다. agent와 하는 대화가 session이고, session이 place(없음·project·app)를 갖는다. 이 문서는 session의 정체가 무엇인지, session이 언제 열리고 언제 끝나는지, 끝날 때 다른 장치(call, turn 안 request, 질문)에 무엇이 같이 일어나는지, session을 복사(fork)하거나 되돌릴(rewind) 때 무엇을 가져가고 무엇을 두고 가는지를 정한다. 이 경계가 흐려지면 끝난 session이 call을 붙잡거나, 다른 session의 skip이 새거나, 되돌린 대화에 낡은 요청이 남는다.

## 흐름

```
 첫 기동      ──▶ lophn 정의 (고정 id lophn)             ┐ agents: <data>/agents/<id>.md
 사람이 만듦  ──▶ agent 정의 (agt_…, 이름은 전역에 하나)  ┘ project 등록·앱 만들기는 agent를 만들지 않는다

 session 열기 ◀── person | Router(call의 새 session, program 알림)
    │ agent+place 고정 (agent-sessions). place는 없음(home), project, app
    ▼
  open ──── place 보관 ────▶ open인 채 새 입력만 막힘 (place를 꺼내면 이어서 받음)
    │
    └─ person: archive / 지움 ─▶ 한 tx에서 묶어 끝낸다
         · 도는 turn → interrupted        · 받은 열린 call → failed(receiver_ended)
         · 대기 request·질문 → cancelled   · 입력함 비움
         · SessionEnded 발행

 fork   : 이력만 복사한 새 session (같은 agent, 같은 place)
 rewind : 대화(+file tool이 바꾼 파일) ─ 사람이 앱을 고르면 ─▶ 앱 rewind (app-call)
```

## 지키는 것

- session의 정체는 (agent id, place)이고 열 때 정해져 바뀌지 않는다(`sessions.agent`, `place_kind`, `place_id`와 trigger `sessions_identity_immutable`). 정의가 없는 agent, 없거나 보관된 place에는 열지 않는다. 어느 agent든 어느 place에 열 수 있다.
  - agent 정의, 할당, 지침, file 범위가 agent와 place에서 나온다. 열린 session의 agent나 place를 바꾸면 이미 쌓인 대화가 다른 agent의 것이 된다.
- session을 여는 길은 사람과 Router 둘이고 같은 연산으로 연다. Router는 call과 workflow step의 새 session(`architecture/workflow.md`)과 program 알림(`open_session_or_new`)으로 연다.
  - 열 때의 검사(agent 정의, place, 보관 여부)를 한 곳에 두어야 어느 길로 열어도 같은 session이 된다.
- agent는 lophn과 사람이 만든 agent뿐이다. lophn은 지우지 못하고, 사람이 만든 agent는 사람이 만들고 지운다.
  - place는 project 또는 app이고(`Place`) 없으면 home이다. 앱은 project에 묶이지 않고 앱마다 app place가 있다.
  - place는 그릇이고 경계도 그릇이다. agent가 받는 지침, skill, 앱 command는 그 place의 것이다.
  - 정의는 파일이라 DB tx에 묶을 수 없다. lophn 정의 만들기는 멱등이다(있으면 그대로).
- run(`architecture/run.md`)도 `OpenSession`으로 session을 연다. 사람이 연 것과 같은 session이고 run이 끝나도 열린 채 남는다. 저절로 닫지 않는다. 화면은 sidebar에 그대로 두지 않고 그 session을 연 run 아래로 묶어 보인다(`--session`으로 이어 쓴 session은 원래 자리다).
- session은 저절로 끝나지 않는다. 끝은 사람의 archive나 지움뿐이다.
  - lophn agent는 일이 끝났다고 program에게 알리지 않는다. 열려 있어야 call과 reaction을 받을 수 있다.
- archive와 지움은 모든 영향을 한 tx에 묶는다. 일부만 적용된 끝이 없어야 한다. 보낸 call의 답은 취소하지 않는다(받은 session에만 남는다).
  - 도는 turn은 interrupted(`session_ended`)로 닫고 진행한다. agent runtime child에도 `turn_stop`을 보내 진행 중인 model 요청을 끊는다. 끝나는 session이 받은 call은 receiver_ended로 닫혀 보낸 쪽이 안다.
- place를 보관하면 그 place의 session은 open인 채 남지만 새 입력(사람 메시지, call, step, reaction)을 받지 않고, Router에는 closed로 보인다. 다시 꺼내면 이어서 받는다.
  - 보관은 되돌릴 수 있는 일이라 session을 끝내면 안 된다.
- lophn이 꺼졌다 켜져도 열린 session은 열린 채다. 대신 메모리에 있던 것은 사라진다: 돌던 turn은 interrupted, 입력함(inbox)에 있던 call은 lophn_restarted로 닫힘, 대기 request와 질문은 cancelled다. 입력함에 있던 step 메시지는 다시 넣지 않고 workflow가 `lophn_restarted` 줄로 남긴다. session의 skip 표시는 표(`sessions.skip`)에 남는다.
  - 사람 메시지는 버리지 않는다. 켤 때 아직 turn이 가져가지 않은 사람 메시지를 받은 순서대로 입력함에 다시 넣어 turn을 연다. fork 사본, rewind가 숨긴 구간, 보관한 session과 place의 것은 뺀다. run 입력(`messages.unattended`가 1인 사람 메시지)도 뺀다. 그 run은 켤 때 `lophn_restarted`로 닫히는데, 다시 돌면 닫힌 run 뒤에 attended turn이 생겨 바깥 효과가 두 번 난다(`architecture/run.md`).
- agent runtime child가 죽으면 그 child가 돌리던 turn은 interrupted(`restarted`)로 닫고 입력함 표시와 기다리던 request를 푼다. 닫지 않으면 session이 새 입력을 모두 `conflict`로 막는다.
- fork는 이력만 복사한다. 같은 agent, 같은 place의 새 session이고 고른 지점까지의 확정 메시지를 가져간다. rewind가 숨긴 구간은 복사하지 않는다.
  - 대기 request와 질문, 열린 call, rewind 기록은 원래 session의 turn에 묶여 있어 가져가지 않는다. 같은 파일을 두 session이 되돌리면 부딪친다.
  - skip도 가져가지 않는다. 새 session은 agent 정의의 `skip` 기본값으로 시작한다.
- checkpoint는 turn을 시작하는 입력(사람 메시지, call, 답, step)마다 생긴다. steer로 도는 turn에 들어간 메시지, fork 복사본, reaction, 알림은 아니다. 다음 turn으로 접수했다가 [Send now]로 올린 메시지는 model 요청에 실려 turn이 정해지는 같은 tx(`takeSteering`)에서 checkpoint를 잃는다. 기록의 `delivery`는 접수 때 값이라 화면은 "turn을 연 입력이 아닌데 turn이 정해진 사람 메시지"를 steer로 본다.
  - Claude Code checkpointing도 turn 중 보낸 메시지는 checkpoint로 치지 않는다.
- session rewind는 도는 turn이 없을 때만 시작한다. 앱 data는 file까지 함께 되돌리는 선택(restore_all)에서, 사람이 고른 앱만 되돌린다. 안 고르면 그대로다.
  - 앱 rewind는 시점 단위라 그 사이 다른 쪽의 변경도 함께 사라진다. 그래서 session rewind가 저절로 하지 않고, 사람에게 함께 되돌아갈 목록을 먼저 보인다.
  - 앱 rewind는 그 session의 첫 write invocation부터 요청한다. 앱 rewind가 거절되거나 취소돼도 대화와 파일은 되돌리지 않고, 결과만 기록에 남긴다. 앱 쪽 순서와 충돌 판단은 앱이 정한다.
- file tool의 범위는 session의 place 종류가 정한다: project place는 그 project의 폴더들(사람이 이은 것. 없을 수도 있다), 그 project의 `workflows/`·`artifacts/`·`skills/`(`<data>/projects/<prj>/…`)를 읽고 쓴다. app place는 앱 source 폴더, 사람이 앱에 더 이은 폴더(`app.edit_folders`, App details의 Folders), 그 앱의 `artifacts/`·`skills/`(`<data>/apps/<app>/…`)를 읽고 쓴다. home은 등록된 모든 project 폴더를 읽기만 한다.
  - home의 session은 기획하고 call로 맡기며 직접 쓰지 않는다. 쓰기 직전 파일 내용은 core가 허용 폴더 안에서 직접 읽어 rewind용으로 둔다. agent runtime이 보낸 내용을 믿지 않는다.
  - 앱의 data와 release 사본(`<data>/apps/<app>/` 아래 `data/`, `bundles/`, `staging/`, `preview/`)은 어느 place 종류의 범위에도 없다. 앱 data는 앱 tool로만 다루고 release 사본은 봉인된 것이다. 앱 source는 기본 자리(`<data>/apps/<app>/source`)이거나 사람이 이은 폴더다. 앱에 더 이은 폴더는 project 연결 폴더와 같은 모양(`{path, description}`)이고, 서로나 source와 겹치면 `invalid_input`이다. release에는 source만 봉인되고 더한 폴더는 들어가지 않는다. agent 정의(`<data>/agents/`)도 열지 않는다.
  - 사람의 폴더가 없는 project의 `LOPHN.md`는 `<data>/projects/<prj>/LOPHN.md`이고 file 범위 밖이다. 사람이 editor로 고친다. 앱 place에는 `LOPHN.md`가 없다.
  - 범위는 상대 경로를 푸는 기준 `base`를 싣는다. 그릇의 첫 폴더(project의 첫 폴더, 앱 source가 있으면 source, 없으면 앱의 첫 더한 폴더)이고, 없으면 place의 data 폴더(`<data>/projects/<prj>`, `<data>/apps/<app>`)다. `base`는 상대 경로를 푸는 기준일 뿐 허락을 넓히지 않는다.
  - `placeScope`(`packages/core/agent-places/place/place-folders.ts`)가 place에서 이 범위를 만든다. turn의 file tool 범위와 rewind의 쓰기 폴더가 이것으로 만든다(`main/daemon/place-folders-glue.ts`). 범위 밖은 file tool이 `resolveInPlace`(`packages/core/lophn-agent/tools/file/scope.ts`)로 realpath를 보고 `forbidden` "path is outside the place"로 거절한다.
  - agent runtime child(`kind` `lophn-agent/runtime`)는 Electron의 Node로 뜨고 권한 flag가 없다(사람이 정했다). launch spec(`packages/core/supervision/security/launch-spec.ts`)에는 권한 칸이 없다(kind, entry, policy, memory limit만). child 하나가 여러 session을 돌리므로 session마다 띄우지 않고, 폴더·provider·MCP·skill 목록이 바뀌어도 child를 다시 띄우지 않는다.
- 사람이 메시지에 붙인 이미지는 메시지 content의 image block이다(`architecture/agent-call.md`의 content block). 화면이 먼저 `message-images/upload`로 올려 blob hash를 받고, `SendMessage.content`에 `{type: "image", mimeType, blob}`을 싣는다. 올림과 `SendMessage`는 같은 자격이어야 한다. 참조되지 않은 올림은 blob 준비의 수명(10분)이 지나면 사라진다.
  - 바이트는 blob store의 blob이다(png, jpeg, gif, webp, 사람은 5 MiB 이하, 내용의 첫 byte로 형식 확인). 메시지가 blob 참조(field `image`)를 갖고, 이미지는 그 참조를 가진 메시지의 session에서만 읽힌다. fork 사본은 참조를 같이 복사한다. 대기 메시지를 고쳐도 이미지 참조는 남는다.
  - runtime은 `message-images/path`(agent 전용 memory route)로 파일 경로를 풀어 bytes를 읽고 model에 image part로 싣는다. core는 입력의 session이 credential의 session과 같고 그 session의 메시지가 blob을 참조할 때만 풀어서, 다른 session의 이미지는 forbidden이거나 not_found다. 사람 화면은 `message-images/read`(file route)로 다시 그린다.
  - 옛 메시지는 글 끝에 `Attached image: open with image.read path "attachment:<id>".` 줄을 가진다. 가져간 메시지 본문은 trigger가 고정해서 그 줄을 block으로 옮기지 않고 글 그대로 둔다. 그 바이트는 `<data>/message-images/<session>/<id>.<ext>`에 남고, `image.read`와 `message-images/path`·`read`가 `attachment:<id>`(`att_…`)를 같은 session 경계로 계속 연다.
  - session을 지워도 이미지 blob과 옛 이미지 파일은 지우지 않는다(알려진 빈틈).

## 왜 이 모양인가

- **agent는 전역이고 place는 session이 갖는다(사람, 2026-10-28).** role(lophn, Project Manager, App Engineer, Operator)이 agent를 place에 묶었지만, place가 하는 일(file 범위, credential 조건, prompt, 주소)은 모두 "session이 어디서 일하나"의 일이다. Claude Code, Codex, OpenCode도 agent 설정은 전역이고 작업 폴더는 session마다다. 옛 assignment 상태 machine(누가 무엇을 맡았나)은 agent와 할당으로 대체했다. 상태를 따로 추적하지 않아도, 맡기는 것은 call이고 허락은 할당이다.
- **앱 일은 그 앱 place의 session이 한다.** 앱은 project에 묶이지 않는 그릇이라 앱 코드의 일(설계, 선언, 구현, release)은 그 앱 place에서 한다. 앱은 사람이 Home의 Places panel에서 New app으로 직접 만들거나(그 앱 place의 lophn 새 session으로 시작한다), home의 lophn이 등록하고 그 앱 place의 lophn session에 call로 맡긴다.
- **앱 place에는 project 지침이 없다.** 앱은 project에 묶이지 않으므로 앱 place의 session은 `LOPHN.md`를 받지 않는다. 지침 층은 전역과 agent 정의 본문이다.
- **"이 session 동안" 허락은 없다.** 할당했으면 허락한 것이고, shell 규칙의 `ask`는 `always`로 규칙 줄을 더한다(`architecture/approval.md`). skip은 사람이 그 session에 켠 표시라 표에 남긴다.
- **agent runtime child 하나가 여러 session을 돈다.** 폴더·provider·MCP·skill 목록이 바뀌어도 다시 띄우지 않는다. session마다의 file 범위는 `placeScope`가 코드로 지킨다.
- **fork는 있는 그대로 복사하되 묶인 것은 놓고 간다.** skip을 가져가면 한 번의 사람 결정이 두 session에 쓰이고, call을 가져가면 한 call에 받는 session이 둘이다.
- **checkpoint는 turn을 시작한 입력에만 둔다.** steer로 도는 turn에 끼어든 메시지는 turn의 경계가 아니라서 돌아갈 시점이 아니다.
- **session rewind와 앱 rewind를 묶지 않고 잇기만 한다.** 하나로 합치면 대화를 되돌리다 다른 사람의 앱 변경까지 말없이 지운다. 고르게 하는 쪽이 Claude Code의 rewind 메뉴(코드와 대화를 따로 고름)와 같다.
- **archive를 풀어 다시 여는 것(되살리기)은 없다.** 되살리면 대기 request가 돌아오지 않는 규칙을 따로 정해야 해서, 필요가 생길 때까지 닫힌 session은 새 session으로 이어 간다. handler 없이 남아 있던 `unarchiveSession` 계약도 지웠다.

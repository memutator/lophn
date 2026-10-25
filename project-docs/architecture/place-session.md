# place-session

lophn의 agent는 place(project 또는 app)에 놓이고, 그 agent와 하는 대화가 session이다. 이 문서는 어떤 agent가 어느 place에 몇 개 있는지, session이 언제 열리고 언제 끝나는지, 끝날 때 다른 장치(call, turn 안 request, 질문)에 무엇이 같이 일어나는지, session을 복사(fork)하거나 되돌릴(rewind) 때 무엇을 가져가고 무엇을 두고 가는지를 정한다. 이 경계가 흐려지면 끝난 session이 call을 붙잡거나, 다른 session의 skip이 새거나, 되돌린 대화에 낡은 요청이 남는다.

## 흐름

```
 project 등록 ──▶ Project Manager 정의 (project마다 하나)        ┐
 앱 만들기    ──▶ App Engineer 정의 (앱마다 하나)                 ├ agents: 정의는 project 폴더나 앱 source가
 첫 기동      ──▶ lophn 정의 (전체에 하나)                       │ 아니라 lophn data 안에 있는 파일
 사람이 만듦  ──▶ Operator 정의 (project나 앱에 여럿)            ┘

 session 열기 ◀── person | Router(call의 새 session, program 알림)
    │ role+place 고정 (agent-sessions)
    ▼
  open ──── place 보관 ────▶ open인 채 새 입력만 막힘 (place를 꺼내면 이어서 받음)
    │
    └─ person: archive / 지움 ─▶ 한 tx에서 묶어 끝낸다
         · 도는 turn → interrupted        · 받은 열린 call → failed(receiver_ended)
         · 대기 request·질문 → cancelled   · 입력함 비움
         · SessionEnded 발행

 fork   : 이력만 복사한 새 session (같은 agent)
 rewind : 대화(+file tool이 바꾼 파일) ─ 사람이 앱을 고르면 ─▶ 앱 rewind (app-call)
```

## 지키는 것

- role과 place는 session을 열 때 정해지고 바뀌지 않는다. role에 맞지 않는 place, 없거나 보관된 place에는 열지 않는다.
  - agent 정의, 할당, 지침, file 범위가 모두 role+place에서 나온다. 열린 session의 role이나 place를 바꾸면 이미 쌓인 대화가 다른 agent의 것이 된다.
- session을 여는 길은 사람과 Router 둘이고 같은 연산으로 연다. Router는 call과 workflow step의 새 session(`architecture/workflow.md`)과 program 알림(맡긴 coding session의 끝, `open_session_or_new`)으로 연다.
  - 열 때의 검사(role과 place, 보관 여부)를 한 곳에 두어야 어느 길로 열어도 같은 session이 된다.
- role은 넷이다. lophn은 전체에 하나, Project Manager는 project마다 하나, App Engineer는 앱마다 하나, Operator는 사람이 project나 앱에 만든 만큼이다. 앞의 셋은 더하거나 지우지 않고 Operator만 사람이 만들고 지운다.
  - place는 project 또는 app이다(`Place`). 앱은 project에 묶이지 않고 앱마다 app place가 있다. 앱의 일은 그 앱의 App Engineer가 맡는다. coding agent는 lophn 밖의 제품이고 coding session의 place는 그 앱이다.
  - place는 그릇이고 경계는 그 안의 domain이다. agent가 받는 지침, kind, skill, tool은 맡은 domain의 것이다(`architecture/domain.md`).
  - 정의는 파일이라 DB tx에 묶을 수 없다. 만들기는 멱등이다(있으면 그대로, 빈 파일). 등록과 파일 만들기 사이에 죽어도 다음 호출이 이어 만든다.
- run(`architecture/run.md`)도 `OpenSession`으로 session을 연다. 사람이 연 것과 같은 session이고 run이 끝나도 열린 채 남는다. 저절로 닫지 않는다. 화면은 sidebar에 그대로 두지 않고 그 session을 연 run 아래로 묶어 보인다(`--session`으로 이어 쓴 session은 원래 자리다).
- session은 저절로 끝나지 않는다. 끝은 사람의 archive나 지움뿐이다(coding agent session은 process로 끝난다).
  - lophn agent는 일이 끝났다고 program에게 알리지 않는다. 열려 있어야 call과 reaction을 받을 수 있다.
- archive와 지움은 모든 영향을 한 tx에 묶는다. 일부만 적용된 끝이 없어야 한다. 보낸 call의 답은 취소하지 않는다(받은 session에만 남는다).
  - 도는 turn은 interrupted(`session_ended`)로 닫고 진행한다. agent runtime child에도 `turn_stop`을 보내 진행 중인 model 요청을 끊는다. 끝나는 session이 받은 call은 receiver_ended로 닫혀 보낸 쪽이 안다.
- place를 보관하면 그 place의 session은 open인 채 남지만 새 입력(사람 메시지, call, step, reaction)을 받지 않고, Router에는 closed로 보인다. 다시 꺼내면 이어서 받는다.
  - 보관은 되돌릴 수 있는 일이라 session을 끝내면 안 된다.
- lophn이 꺼졌다 켜져도 열린 session은 열린 채다. 대신 메모리에 있던 것은 사라진다: 돌던 turn은 interrupted, 입력함(inbox)에 있던 call은 lophn_restarted로 닫힘, 대기 request와 질문은 cancelled다. 입력함에 있던 step 메시지는 다시 넣지 않고 workflow가 `lophn_restarted` 줄로 남긴다. session의 skip 표시는 표(`sessions.skip`)에 남는다.
  - 사람 메시지는 버리지 않는다. 켤 때 아직 turn이 가져가지 않은 사람 메시지를 받은 순서대로 입력함에 다시 넣어 turn을 연다. fork 사본, rewind가 숨긴 구간, 보관한 session과 place의 것은 뺀다. run 입력(`messages.unattended`가 1인 사람 메시지)도 뺀다. 그 run은 켤 때 `lophn_restarted`로 닫히는데, 다시 돌면 닫힌 run 뒤에 attended turn이 생겨 바깥 효과가 두 번 난다(`architecture/run.md`).
- agent runtime child가 죽거나 바뀌면 그 child가 돌리던 turn은 interrupted(`restarted`)로 닫고 입력함 표시와 기다리던 request를 푼다. 닫지 않으면 session이 새 입력을 모두 `conflict`로 막는다. project 폴더, provider, MCP, skill이 바뀌어 child를 바꿀 때는 도는 turn이 끝날 때까지 미룬다.
- fork는 이력만 복사한다. 같은 role, place, agent의 새 session이고 고른 지점까지의 확정 메시지를 가져간다. rewind가 숨긴 구간은 복사하지 않는다.
  - 대기 request와 질문, 열린 call, rewind 기록은 원래 session의 turn에 묶여 있어 가져가지 않는다. 같은 파일을 두 session이 되돌리면 부딪친다.
  - skip도 가져가지 않는다. 새 session은 Operator 정의의 기본값(Operator가 아니면 꺼짐)으로 시작한다.
- checkpoint는 turn을 시작하는 입력(사람 메시지, call, 답, step)마다 생긴다. steer로 도는 turn에 들어간 메시지, fork 복사본, reaction, 알림은 아니다.
  - Claude Code checkpointing도 turn 중 보낸 메시지는 checkpoint로 치지 않는다.
- session rewind는 도는 turn이 없을 때만 시작한다. 앱 data는 file까지 함께 되돌리는 선택(restore_all)에서, 사람이 고른 앱만 되돌린다. 안 고르면 그대로다.
  - 앱 rewind는 시점 단위라 그 사이 다른 쪽의 변경도 함께 사라진다. 그래서 session rewind가 저절로 하지 않고, 사람에게 함께 되돌아갈 목록을 먼저 보인다.
  - 앱 rewind는 그 session의 첫 write invocation부터 요청한다. 앱 rewind가 거절되거나 취소돼도 대화와 파일은 되돌리지 않고, 결과만 기록에 남긴다. 앱 쪽 순서와 충돌 판단은 앱이 정한다.
- file tool의 범위는 place가 정한다: Project Manager는 그 project의 폴더들(사람이 이은 것. 없을 수도 있다)과 그 project의 domain 폴더(`<data>/domains/<dom>/`), 그 project의 `workflows/`(`<data>/projects/<prj>/workflows/`)를 읽고 쓴다. `workflows/`는 PM에게만 열린다(`architecture/workflow.md`). App Engineer는 앱 source 폴더와 그 앱의 domain 폴더를 읽고 쓴다. Operator는 그릇 폴더(project의 폴더들, 앱 source)를 읽고, 고른 domain의 `artifacts/`를 쓴다. 앱 place의 Operator는 앱 source를 읽기만 한다(쓰기는 App Engineer의 일이다). lophn은 등록된 모든 project 폴더를 읽기만 한다.
  - lophn은 기획하고 call로 맡기며 직접 쓰지 않는다. 쓰기 직전 파일 내용은 core가 허용 폴더 안에서 직접 읽어 rewind용으로 둔다. agent runtime이 보낸 내용을 믿지 않는다.
  - 앱의 data와 release 사본(`<data>/apps/<app>/` 아래 `data/`, `bundles/`, `staging/`, `preview/`)은 어느 role의 범위에도 없다. 앱 data는 앱 tool로만 다루고 release 사본은 봉인된 것이다. 앱 source는 기본 자리(`<data>/apps/<app>/source`)이거나 사람이 이은 폴더이고, App Engineer의 범위는 그 source 폴더 하나다. 같은 `<data>/apps/<app>/`의 `agents/`(agent 정의)도 열지 않는다.
  - 사람의 폴더가 없는 project의 `LOPHN.md`는 `<data>/projects/<prj>/LOPHN.md`이고 PM의 범위 밖이다. 사람이 editor로 고친다. 앱 place에는 `LOPHN.md`가 없다.
  - 범위는 상대 경로를 푸는 기준 `base`를 싣는다. 그릇의 첫 폴더(project의 첫 폴더, 앱 source)이고, 없으면 place의 data 폴더(`<data>/projects/<prj>`, `<data>/apps/<app>`)다. `base`는 상대 경로를 푸는 기준일 뿐 허락을 넓히지 않는다.
  - `placeScope`(`packages/core/agent-roles/place/place-folders.ts`)가 role과 place와 맡은 domain에서 이 범위를 만든다. turn의 file tool 범위와 rewind의 쓰기 폴더가 이것으로 만든다. rewind는 sessions 표만 보고 폴더를 정하므로 Operator에게는 그릇의 domain 폴더 전부를 넉넉히 잡고, 실제 쓰기는 file tool이 `artifacts/`로 좁힌다(`main/daemon/place-folders-glue.ts`). agent runtime process의 Deno 권한은 session이 아니라 process 하나의 것이라 `placeScope`를 거치지 않고 같은 파일의 `runtimeFolders`가 만든다. 폴더 종류를 더하면 두 곳을 같이 고친다. 한쪽만 고치면 file tool은 열렸는데 child가 거절하거나 그 반대가 된다.
  - agent runtime process는 하나라 Deno 권한은 열린(active) project 폴더, 열린 앱의 source 폴더, 모든 active domain 폴더, active project의 `workflows/` 폴더 전체의 합(읽기와 쓰기)이다. session마다의 범위는 file tool이 지킨다. 폴더 목록이 바뀌면(project·앱 등록, 앱 source 연결, domain 만들기와 보관, project 보관) process를 다시 띄운다. 도는 turn이 있으면 끊지 않고 다음 주기(1초)에 다시 본다(`packages/core/lophn-agent/run-loop/runtime.ts`).
- 사람이 메시지에 붙인 이미지는 메시지 content(글뿐)에 넣지 않는다. 화면이 먼저 `message-images/upload`로 session에 올려 id(`att_...`)를 받고, 글 끝에 `Attached image: open with image.read path "attachment:<id>".` 줄을 적는다. agent는 `image.read`로 연다.
  - 바이트는 project 폴더 밖인 `<data>/message-images/<session>/<id>.<ext>`에 둔다(png, jpeg, gif, webp, 5 MiB 이하, 내용의 첫 byte로 형식 확인). agent의 file tool 범위 밖이고 `attachment:<id>`로만 열린다.
  - `image.read`는 `message-images/path`(agent 전용 memory route)로 경로를 푼다. core는 입력의 session이 credential의 session과 같을 때만 풀어서, 다른 session의 id는 forbidden이거나 not_found다. 사람 화면은 `message-images/read`(file route)로 다시 그린다.
  - session을 지워도 이미지 파일은 지우지 않는다(알려진 빈틈).

## 왜 이 모양인가

- **agent는 place에 놓이고 session은 그 agent의 대화다.** 옛 assignment 상태 machine(누가 무엇을 맡았나)은 place에 놓인 agent와 할당으로 대체했다. 상태를 따로 추적하지 않아도, 맡기는 것은 call이고 허락은 할당이다.
- **App Engineer는 앱마다 하나, session은 여럿이다.** Project Manager와 같은 모양이다. 앱은 project에 묶이지 않는 그릇이라 앱 코드의 일(설계, 선언, 구현, release)은 그 앱의 App Engineer가 맡고, Project Manager는 project의 domain과 Operator를 맡는다. 앱을 만드는 일의 기획은 lophn이 맡고(lophn이 앱을 등록하고 그 앱의 App Engineer에게 call로 맡긴다), 구현은 App Engineer가 직접 한다.
- **앱 place에는 project 지침이 없다.** 앱은 project에 묶이지 않으므로 App Engineer와 앱 place의 Operator는 `LOPHN.md`를 받지 않는다. 지침 층은 전역, 맡은 domain의 `DOMAIN.md`, agent 정의 본문이다.
- **"이 session 동안" 허락은 없다.** 할당했으면 허락한 것이고, shell 규칙의 `ask`는 `always`로 규칙 줄을 더한다(`architecture/approval.md`). skip은 사람이 그 session에 켠 표시라 표에 남긴다.
- **fork는 있는 그대로 복사하되 묶인 것은 놓고 간다.** skip을 가져가면 한 번의 사람 결정이 두 session에 쓰이고, call을 가져가면 한 call에 받는 session이 둘이다.
- **checkpoint는 turn을 시작한 입력에만 둔다.** steer로 도는 turn에 끼어든 메시지는 turn의 경계가 아니라서 돌아갈 시점이 아니다.
- **session rewind와 앱 rewind를 묶지 않고 잇기만 한다.** 하나로 합치면 대화를 되돌리다 다른 사람의 앱 변경까지 말없이 지운다. 고르게 하는 쪽이 Claude Code의 rewind 메뉴(코드와 대화를 따로 고름)와 같다.
- **archive를 풀어 다시 여는 것(되살리기)은 없다.** 되살리면 대기 request가 돌아오지 않는 규칙을 따로 정해야 해서, 필요가 생길 때까지 닫힌 session은 새 session으로 이어 간다. handler 없이 남아 있던 `unarchiveSession` 계약도 지웠다.

# place-session

lophn의 agent는 place(project 또는 앱)에 놓이고, 그 agent와 하는 대화가 session이다. 이 문서는 어떤 agent가 어느 place에 몇 개 있는지, session이 언제 열리고 언제 끝나는지, 끝날 때 다른 장치(call, 권한 request, 허락)에 무엇이 같이 일어나는지, session을 복사(fork)하거나 되돌릴(rewind) 때 무엇을 가져가고 무엇을 두고 가는지를 정한다. 이 경계가 흐려지면 끝난 session이 call을 붙잡거나, 다른 session의 허락이 새거나, 되돌린 대화에 낡은 요청이 남는다.

## 흐름

```
 project 등록 ──▶ Project Manager 정의 (project마다 하나)        ┐
 앱 만들기    ──▶ App Engineer 정의 (앱마다 하나)                 ├ agents: 정의는 project 폴더가 아니라
 첫 기동      ──▶ lophn 정의 (전체에 하나)                       │ lophn data 안에 있는 파일
 사람이 만듦  ──▶ Operator 정의 (project나 앱에 여럿)            ┘

 session 열기 ◀── person | Router(call: 새 session) | Reactor(reaction)
    │ role+place 고정 (agent-sessions)
    ▼
  open ──── place 보관 ────▶ open인 채 새 입력만 막힘 (place를 꺼내면 이어서 받음)
    │
    └─ person: archive / 지움 ─▶ 한 tx에서 묶어 끝낸다
         · 도는 turn → interrupted        · 받은 열린 call → failed(receiver_ended)
         · 대기 request·질문 → cancelled   · "이 session 동안" 허락 → 폐기
         · 입력함 비움                     · SessionEnded 발행

 fork   : 이력만 복사한 새 session (같은 agent)
 rewind : 대화(+file tool이 바꾼 파일) ─ 사람이 앱을 고르면 ─▶ 앱 rewind (app-call)
```

## 지키는 것

- role과 place는 session을 열 때 정해지고 바뀌지 않는다. role에 맞지 않는 place, 없거나 보관된 place에는 열지 않는다.
  - agent 정의, grant, 지침, file 범위가 모두 role+place에서 나온다. 열린 session의 role이나 place를 바꾸면 이미 쌓인 대화와 허락이 다른 agent의 것이 된다.
- session을 여는 길은 사람, Router(call의 새 session), Reactor(reaction)이고 모두 같은 연산으로 연다.
  - 열 때의 검사(role과 place, 보관 여부)를 한 곳에 두어야 어느 길로 열어도 같은 session이 된다.
- lophn은 전체에 하나, Project Manager는 project마다 하나, App Engineer는 앱마다 하나다. 더하거나 지우지 않는다. Operator만 사람이 만들고 지운다.
  - 정의는 파일이라 DB tx에 묶을 수 없다. 만들기는 멱등이다(있으면 그대로, 빈 파일). 등록과 파일 만들기 사이에 죽어도 다음 호출이 이어 만든다.
- session은 저절로 끝나지 않는다. 끝은 사람의 archive나 지움뿐이다(coding agent session은 process로 끝난다).
  - lophn agent는 일이 끝났다고 program에게 알리지 않는다. 열려 있어야 call과 reaction을 받을 수 있다.
- archive와 지움은 모든 영향을 한 tx에 묶는다. 일부만 적용된 끝이 없어야 한다. 보낸 call의 답은 취소하지 않는다(받은 session에만 남는다).
  - 도는 turn은 interrupted로 닫고 진행한다. 끝나는 session이 받은 call은 receiver_ended로 닫혀 보낸 쪽이 안다.
- place를 보관하면 그 place의 session은 open인 채 남지만 새 입력(사람 메시지, call, reaction)을 받지 않고, Router에는 closed로 보인다. 다시 꺼내면 이어서 받는다.
  - 보관은 되돌릴 수 있는 일이라 session을 끝내면 안 된다.
- lophn이 꺼졌다 켜져도 열린 session은 열린 채다. 대신 메모리에 있던 것은 사라진다: 돌던 turn은 interrupted, 입력함(inbox)에 있던 call은 lophn_restarted로 닫힘, 대기 request와 질문은 cancelled, "이 session 동안" 허락은 한 번 더 묻는다.
- fork는 이력만 복사한다. 같은 role, place, agent의 새 session이고 고른 지점까지의 확정 메시지를 가져간다. rewind가 숨긴 구간은 복사하지 않는다.
  - 허락, 대기 request와 질문, 열린 call, rewind 기록은 원래 session의 turn에 묶여 있어 가져가지 않는다. 같은 파일을 두 session이 되돌리면 부딪친다.
- checkpoint는 turn을 시작하는 입력(사람 메시지, call, 답)마다 생긴다. steer로 도는 turn에 들어간 메시지, fork 복사본, reaction, 알림은 아니다.
  - Claude Code checkpointing도 turn 중 보낸 메시지는 checkpoint로 치지 않는다.
- session rewind는 도는 turn이 없을 때만 시작한다. 앱 data는 file까지 함께 되돌리는 선택(restore_all)에서, 사람이 고른 앱만 되돌린다. 안 고르면 그대로다.
  - 앱 rewind는 시점 단위라 그 사이 다른 쪽의 변경도 함께 사라진다. 그래서 session rewind가 저절로 하지 않고, 사람에게 함께 되돌아갈 목록을 먼저 보인다.
  - 앱 rewind는 그 session의 첫 write invocation부터 요청한다. 앱 rewind가 거절되거나 취소돼도 대화와 파일은 되돌리지 않고, 결과만 기록에 남긴다. 앱 쪽 순서와 충돌 판단은 앱이 정한다.
- file tool의 범위는 place가 정한다: Project Manager는 그 project 폴더와 열어 둔 초안 폴더, App Engineer는 앱 source 폴더, project의 Operator는 그 폴더를 읽고 쓴다. 앱 place의 Operator는 앱 source 폴더를 읽기만 한다(쓰기는 App Engineer의 일이다). lophn은 등록된 모든 project 폴더를 읽기만 한다.
  - lophn은 기획하고 call로 맡기며 직접 쓰지 않는다. 쓰기 직전 파일 내용은 core가 허용 폴더 안에서 직접 읽어 rewind용으로 둔다. agent runtime이 보낸 내용을 믿지 않는다.
  - 이 표는 `packages/core/agent-roles/place/place-folders.ts`의 `placeScope` 하나다. turn의 file tool 범위, rewind의 쓰기 폴더, agent runtime process의 Deno 권한이 모두 이것으로 만든다. 목록이 둘이면 한쪽만 고쳐 어긋난다.
  - Project Manager가 같은 turn에 초안 폴더를 열면 그 자리에서 그 turn의 범위에 더한다. 열고 바로 쓴다.
  - agent runtime process는 하나라 Deno 권한은 열린(active) project 폴더와 앱 source 폴더 전체의 합이다. session마다의 범위는 file tool이 지킨다. 초안 폴더는 turn 중에 열리므로 `<data root>/projects` 상위째 쓰기를 연다. 폴더 목록이 바뀌면(project·앱 등록) process를 다시 띄우고 돌던 turn은 끊긴다.

## 왜 이 모양인가

- **agent는 place에 놓이고 session은 그 agent의 대화다.** 옛 assignment 상태 machine(누가 무엇을 맡았나)은 place에 놓인 agent와 agent grant로 대체했다. 상태를 따로 추적하지 않아도, 맡기는 것은 call이고 허락은 grant다.
- **App Engineer는 앱마다 하나, session은 여럿이다.** Project Manager와 같은 모양이다. 앱을 만드는 일의 기획은 lophn이 맡고(lophn이 앱을 등록하고 그 앱의 App Engineer에게 call로 맡긴다), 구현은 coding agent가 한다.
- **App Engineer의 project 지침은 앱 source가 등록 project 안에 있을 때만 읽는다.** source를 임의 위치에 둘 수 있어서, 없으면 project 지침 없이 돈다.
- **"이 session 동안" 허락은 메모리에 둔다.** Claude Code, Codex, Gemini CLI, Hermes가 모두 process 메모리에 두고 재시작이나 resume에서 되살리지 않는다. session 기록에 쓰는 harness는 없다(OpenCode, Goose, Cline은 session 범위가 아예 없다). 다시 묻는 것은 안전한 쪽 실패다. 세부는 approval.
- **fork는 있는 그대로 복사하되 묶인 것은 놓고 간다.** 허락을 가져가면 한 번의 사람 결정이 두 session에 쓰이고, call을 가져가면 한 call에 받는 session이 둘이다.
- **checkpoint는 turn을 시작한 입력에만 둔다.** steer로 도는 turn에 끼어든 메시지는 turn의 경계가 아니라서 돌아갈 시점이 아니다.
- **session rewind와 앱 rewind를 묶지 않고 잇기만 한다.** 하나로 합치면 대화를 되돌리다 다른 사람의 앱 변경까지 말없이 지운다. 고르게 하는 쪽이 Claude Code의 rewind 메뉴(코드와 대화를 따로 고름)와 같다.
- **archive를 풀어 다시 여는 것(되살리기)은 없다.** 되살리면 session 허락과 대기 request가 돌아오지 않는 규칙을 따로 정해야 해서, 필요가 생길 때까지 닫힌 session은 새 session으로 이어 간다. handler 없이 남아 있던 `unarchiveSession` 계약도 지웠다.

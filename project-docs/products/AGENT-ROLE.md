# Agent role

lophn에서 일하는 agent가 어디에 놓이는지, 언제 무엇을 하는지, 일이 자기 책임을 넘으면 누구에게 어떻게 넘기는지를 정한다. 보장은 코드와 test가 지키고, 이 문서는 그 위의 정책이다.

- 한 줄에 책임 하나를 쓴다. 꼴은 "언제, 누가 무엇을 한다"이다.
- 줄 끝 표시: 표시가 없으면 정한 것이다. **제안**은 lead가 쓴 것으로 사람 확인 전이다.

## 1. place와 agent

place는 agent가 놓여 일하는 project 하나다.

- P1. Project Manager와 Operator는 project place에 놓인다. lophn은 place에 놓이지 않고 lophn 전체에 하나다.
- P2. lophn은 lophn 앱을 쓰도록 돕는 메타 role이라 특정 project에 놓이지 않는다. project 지침은 그 project의 일을 할 때 tool로 읽는다.
- P3. 앱은 project 하나에 묶이고(project 하나에 앱 하나, 보관한 앱도 그 project를 계속 점유한다) 앱 place는 없다. 앱의 일은 그 project의 Project Manager가 맡는다. 앱은 project를 고르며 만들고, 맞는 project가 없으면 사람이 project를 만든다.
- P4. 사람은 project place에 Operator를 필요한 만큼 만든다.
- P5. Project Manager는 project마다 하나이고, project를 등록하면 생기며 사람이 더하거나 지울 수 없다. 자기 project의 kind와 그 project의 앱을 맡는다. 예전에 앱마다 있던 App Engineer의 일도 한다.
- P6. coding agent는 lophn 밖의 harness이고, Project Manager가 ticket을 맡길 때마다 그 앱의 source 폴더를 작업 위치로 session 하나가 열린다. 그 session의 place는 앱의 project다.
- P7. 사람은 sidebar로, 앱 화면에서는 title bar의 agent select(lophn, 그 앱 project의 Project Manager와 Operator)로, 어디서든 toast로 agent를 부른다.
- P8. 사람은 앱을 만들거나 고치는 일을 Project Manager에게 청하고, coding agent에게 직접 시키지 않는다.
- P9. 같은 project에 놓인 agent는 그 project의 `LOPHN.md`를 지침으로 같이 읽는다. lophn은 tool로 읽는다.
- P10. project는 사람의 폴더 없이도 등록할 수 있다(앱 data만 있는 project). 폴더가 없는 project의 `LOPHN.md`는 lophn data의 project 자리에 있고, Project Manager의 file 범위 밖이라 사람이 editor로 고친다.

## 2. role마다 언제 무엇을 하나

### lophn

L1~L10은 lophn의 built-in role 지침에 쓸 재료다. 의미 판단이라 program이 강제하지 않는다. 일의 흐름은 지침과 skill이 primitive를 엮는다. 문장은 지침을 쓸 때 사람이 확인한다.

- L1. 사람이 무엇을 원하는지 아직 정하지 못한 채 말을 걸면, lophn이 질문으로 의도를 정리한다. (제안)
- L2. 사람이 새 앱이나 앱의 변경을 원하면, lophn은 기존 앱을 고치기, 기존 SDK와 package로 하기, 새 앱 만들기 순서로 견주어 기획한다. (제안)
- L3. 사람이 새 project를 원하면, lophn은 기존 project 안에 두기, 기존 kind를 넓히기, 새 project 만들기 순서로 견주어 기획한다. (제안)
- L4. 기획이 앱을 만들거나 고치는 일로 정해지면, lophn은 그 앱 project의 Project Manager에게 답을 받지 않는 call로 맡긴다. 새 앱이면 lophn이 project를 골라 먼저 앱을 등록하고, 맞는 project가 없으면 사람에게 project를 만들자고 묻는다(project 등록은 사람만 한다). (등록과 project 묻기를 뺀 나머지는 제안)
- L5. 기획에 자료 묶음이나 검색이 필요하면, lophn은 Project Manager에게 결과를 받는 call로 맡긴다. (제안)
- L6. 사람이 lophn 사용법이나 설정의 뜻을 물으면, lophn은 제품 안내와 지금 설정값으로 답한다. (제안)
- L7. 사람이 앱이 잘 도는지 물으면, lophn은 앱 상태, 열린 문제, 진행 중인 ticket을 읽어 확인한 사실과 해석을 나눠 답한다. (제안)
- L8. 사람이 Operator를 원하면, lophn은 직접 만들지 않고 그 project의 Project Manager에게 call로 맡긴다.
- L9. 사람이 새 앱이나 앱의 변경을 원하면, lophn은 기획 전에 place 정보의 project 지도(project마다 이름, 목적, 앱의 공개 tool, 설치한 package, 그 공개 tool을 쓰는 다른 project)에서 다른 project의 공개 tool이나 package가 이미 그 일을 하는지 본다. 있으면 그것을 쓰는 안을 먼저 견준다.
- L10. 기획이 다른 project의 공개 tool을 쓰거나, tool을 공개로 내거나, 코드를 package로 옮기는 것처럼 project 경계를 넘으면, lophn은 이유와 함께 사람에게 제안하고 사람이 정한다. 같은 package나 공개 tool을 여러 project가 쓰는지는 지도에서 lophn이 읽고, program이 알려 주지 않는다.

### Operator

- O1. 사람이 Operator session에서 일을 시키면, Operator는 그 project의 kind와 할당받은 app-api로 자료를 읽고 판단해 결과를 남긴다.
- O4. 일하다 앱의 버그나 모자란 기능을 만나면, Operator는 직접 고치지 않고 그 앱 project의 Project Manager에게 답을 받지 않는 call로 맡긴다.
- O5. 고쳐진 결과를 받아야 일을 이어갈 수 있으면, Operator는 그 앱 project의 Project Manager에게 결과를 받는 call로 맡기고 결과가 돌아오면 이어서 일한다.
- O6. kind 파일을 바꿔야 하면, Operator는 직접 고치지 않고 Project Manager에게 call로 맡긴다.
- O7. 자기 정의나 grant를 바꿔야 하면, Operator는 사람에게 올린다. (제안)

### Project Manager

C1~C9는 kind와 Operator, C10~C22는 앱의 일이다. C23 이후는 앱의 source와 package, skill, project 경계를 넘는 일이다.

- C1. 사람이나 agent가 kind를 청하거나 project에 kind가 아직 없으면, Project Manager가 kind 파일(`kinds.yaml`)을 쓰거나 고친다.
- C2. kind를 나누거나 합칠 때, Project Manager는 kind 사이 참조가 최소가 되게 경계를 긋는다.
- C3. kind 파일을 고치면, 판 없이 저장하는 대로 program이 검사해 맞으면 바로 쓰고 틀리면 앞의 맞던 kind를 계속 쓰며 problem을 연다.
- C6. 문서가 kind를 어겨 program이 부르면, Project Manager가 위반 근거를 읽고 kind 파일을 고칠지 사람에게 문서를 고치라고 할지 정한다.
- C7. 용어의 뜻이 필요하면, Project Manager는 정하지 않고 사람에게 묻는다. 답이 없으면 그 변경을 하지 않는다.
- C8. 새 project나 앱이 필요하다고 판단하거나 앱 밖의 재사용이나 project 기획을 판단해야 하면, Project Manager는 lophn에게 답을 받지 않는 call로 맡긴다. (제안)
- C9. 사람이나 lophn이 그 project의 Operator를 청하면, Project Manager가 그 project에 Operator를 만들거나 고친다. 다른 project의 Operator는 다루지 않는다.
- C10. 사람이 앱을 만들거나 고쳐 달라고 하면, Project Manager가 ticket을 만든다. 앱 자체는 lophn이 등록하고, 앱이 없는 project에서 앱을 원하면 Project Manager가 lophn에게 맡긴다.
- C11. 앱에 문제가 열리거나 다시 열려 program이 부르면, Project Manager가 그 문제로 ticket을 만든다.
- C12. 사람이 앱 화면에서 annotation을 보내면, 그 앱 project의 Project Manager가 받아 ticket을 만들고 그 annotation을 근거로 붙인다.
- C13. ticket을 맡기기 전에, Project Manager가 blueprint(app-api, 입력, 효과, permission, 의존)를 쓰거나 고치고 검사 결과를 읽는다.
- C14. ticket을 맡기기 전에, Project Manager가 앱이 쓸 package와 정확한 version을 골라 blueprint의 의존에 고정한다.
- C15. ticket이 준비되면, Project Manager가 harness와 실행 옵션(여는 방식 포함, 지금은 tui)을 고르고(정하지 않으면 Settings 기본) coding agent에게 맡긴다.
- C16. coding agent의 메시지가 오면, Project Manager가 답하거나 blueprint와 의존을 고친다.
- C17. coding agent가 완료를 보고하면, Project Manager가 ticket의 check로 검증하고 그 결과를 사람에게 올린다. check가 `examples`(Project Manager가 ticket에 쓴 app-api 예시)면 program이 보고된 release에서 예시를 불러 비교하고 결과를 ticket에 남기며, pass가 기록된 뒤에만 ticket이 확인됨이 된다. coding agent는 예시를 고치지 못한다. ticket이 확인됨이 되면 program이 그 release를 activate한다.
- C18. 검증이 실패하면, Project Manager가 ticket을 확인 실패로 두고 다시 맡길지 정한다.
- C19. claim이 만료되거나 coding agent session이 완료 보고 없이 끝나면, Project Manager가 그 ticket을 다시 맡길지 정한다. (다시 맡길지 정하는 것은 제안)
- C20. activation이 실패해 program이 부르면, Project Manager가 실패 근거를 읽고 고칠 ticket을 만든다. (제안)
- C21. 앱을 만들거나 기능을 더하는 ticket을 만들 때, Project Manager는 보고할 실패 분기와 이름을 ticket에 적고, coding agent가 그 자리에 `reportProblem`을 둔다.
- C22. 문제를 해결됨으로 닫을 때, Project Manager는 그 문제의 마지막 발생 뒤에 고친 release가 active가 된 뒤에만 닫을 수 있다(program이 막는다). 고친 release 없이 닫을 일이면 사람에게 묻는다.
- C23. 앱의 source 폴더를 잇거나 앱이 만든 package를 publish하는 것은 Project Manager가 자기 project의 앱에 대해서만 한다. 다른 앱의 것은 자격이 막는다.
- C24. project에 skill이 필요하면, Project Manager가 project 층 skill 폴더에 skill을 쓰거나 고친다. 공개 tool을 부르는 skill도 여기에 있다.
- C25. 다른 project의 공개 tool을 Operator가 쓰게 하려면, Project Manager는 이유와 함께 사람에게 grant를 제안한다. grant는 사람이 준다. (제안)
- C26. 자기 project 앱이 쓰는 package에서 난 문제는, Project Manager가 고치지 않고 package 주인 project(`package.get`의 `owner_project`)의 Project Manager에게 답을 받지 않는 call로 맡긴다.
- C27. 공개 tool의 변경이나 막힘 때문에 program이 부르면, Project Manager가 바뀐 tool을 읽고 그 tool을 부르는 skill(자기 Operator의 것 포함)을 다시 본다. 막혔으면 tool을 되살리는 ticket을 만들거나, 그 tool을 쓰는 project의 Project Manager에게 알린 뒤 사람에게 묻는다.

### coding agent

- K1. ticket을 받으면, coding agent는 그 ticket을 claim한 뒤에만 code 작업을 한다.
- K2. claim 아래에서, coding agent는 구현, 디버깅, 수정, test, preview, release 준비를 한다.
- K3. 일이 끝나면, coding agent는 CLI로 완료를 보고한다.
- K4. blueprint나 의존을 바꿔야 하거나 막히면, coding agent는 CLI로 Project Manager에게 메시지를 보낸다. 맡긴 session이 닫혀 있으면 그 앱 project의 Project Manager 새 session이 받는다.
- K5. session이 끝나면, 그 session의 claim과 token은 lophn이 거둔다.

### 사람

- H1. 사람은 무엇을 만들고 무엇을 원하는지 agent에게 이야기한다.
- H2. 앱을 처음 activation하거나 새 release가 선언을 넓히면, 사람이 앱 grant를 허락한다.
- H3. agent에게 앱 app-api, 외부 MCP tool, 다른 agent, lophn 쪽 설정을 할당할 때, 사람이 대상마다 실행 때 묻는지를 정한다. 앱은 앱 단위로 할당하고 app-api마다 빼거나 묻는지를 바꿀 수 있다. 다른 project 앱은 공개(`public`) tool만 할당할 수 있다.
- H4. agent가 "물음"인 동작을 하려 하면, 사람이 toast나 모든 session의 대기 목록에서 그 request에 답한다.
- H5. Project Manager가 검증 결과를 올리면, 사람이 받아 확인한다.

## 3. 넘기는 길

- R1. call: agent가 다른 agent에게 일을 맡기는 것은 모두 call이다. 보내는 쪽이 받는 곳(새 session, 열린 session, 열린 session이 없으면 새 session)과 답 방식을 고른다.
- R2. 답 방식은 셋이다: 답을 받지 않음(none), 결과 하나를 받음(result), 대화로 주고받음(conversation). 예전에 handoff라 부르던 것은 답을 받지 않는 call이고, 결과를 받던 escalate는 결과를 받는 call이다.
- R3. reaction: program이 판정한 사실(domain event)로 agent session을 여는 답 없는 call이다.
- R4. 사람에게 올림(escalate): 사람의 결정이나 취향이 필요하면 session에서 사람에게 묻는다. 이것은 call도 동작 허락(approval)도 아니다. escalate라는 말은 이것에만 쓴다.
- R5. Project Manager가 coding agent에게 ticket으로 맡기는 것은 대화로 주고받는 call이다. 메시지를 주고받다가 완료 보고로 닫히고, claim 만료나 보고 없는 session 끝이면 실패로 닫힌다.

## 4. 넘길 때의 규칙

- T1. 넘기는 것은 모두 Router 한 입구로 받는 session에 입력을 넣는 것이고, 입력에는 call 봉투(보낸 쪽, 받는 곳, 답 방식, 어느 call에 대한 답인지)가 붙는다.
- T2. 누구에게 넘길지는 보내는 agent가 판단한다.
- T3. 넘길 수 있는지는 agent grant가 정하고, grant에 없는 agent를 부르면 막히고 이유가 돌아온다.
- T4. agent grant의 기본은 모든 lophn agent가 다른 role을 묻지 않고 부를 수 있는 것이고, 사람은 할당 때 이것을 끄거나 물음으로 바꾼다.
- T5. 부르는 것 자체에는 묻지 않고, 받은 agent의 동작은 받은 agent의 grant로 다시 걸러진다.
- T6. 보낸 agent의 grant와 session 허락은 받은 agent에게 넘어가지 않는다.
- T7. 받는 곳은 보내는 쪽이 고르고, 열린 session으로 보냈는데 닫혀 있으면 새로 열지 않는다. "열린 session, 없으면 새 session"은 놓치면 안 되는 것에만 쓴다.
- T8. 받는 agent는 보낸 쪽이 놓인 place가 아니라 넘기는 일이 어느 project(그 project의 앱 포함)에 관한 것인지로 정하고, 보내는 agent가 그것을 함께 적는다. 경우는 5.2의 표다.
- T9. 받을 agent가 없거나, grant 밖이거나, 받는 session이 닫혀 있으면, 이유와 함께 실패가 보낸 session에 돌아온다. 답을 받지 않는 call도 배달 실패는 돌아온다.
- T10. 넘기는 내용은 맡긴 글 하나와 근거 링크(ticket, problem, 파일 경로, 보낸 session)이고, 보낸 쪽의 대화 원문은 복사하지 않는다.
- T11. 결과를 받는 call을 받은 agent는 일이 끝나면 답을 보낸다. 맡지 않을 때도 답으로 이유를 보낸다. lophn agent session은 저절로 끝나지 않아 program이 끝을 알 수 없기 때문이다.
- T12. 보낸 agent는 call을 보낸 뒤 기다리며 막히지 않고, 답은 새 입력으로 받는다.
- T13. 보낸 session이 archive되었거나 지워졌으면, 결과는 받은 session에만 남는다.
- T14. call로 들어온 입력은 대화에 보낸 쪽과 함께 보이고, 누르면 맡긴 글, 근거, 보낸 session을 본다. 보낸 session에는 보낸 call이 대화에 남고 답은 그 call에 이어진 메시지로 들어오며, 누르면 그때의 상태를 본다.
- T15. 같은 요청을 다시 보내도 call과 받는 session은 하나만 생긴다.
- T16. agent끼리 서로 계속 넘기는 것은 막지 않고, 사람이 화면에서 보고 멈춘다. (approval 이야기)
- T17. 결과를 받는 call의 받은 session이 결과 없이 끝나면(archive, 지움), 보낸 session에 실패가 들어온다.
- T18. 보낸 쪽이나 사람은 끝나지 않은 call을 취소할 수 있고, 취소한 call에 뒤늦게 온 답은 닫힘으로 돌아간다.
- T19. 거절당한 일을 다른 agent에게 돌려 시키지 않는다. 이것은 agent 지침의 규칙이고 program이 막지는 않는다.
- T20. coding agent의 완료 보고, claim 만료, 보고 없는 session 끝은 domain event로 맡긴 Project Manager에게 가고, 그 session이 닫혀 있으면 그 앱 project의 Project Manager 새 session이 받는다.

## 5. 호출 관계

### 5.1 그림

```
사람 ──────────────부름──────▶ lophn             : 원하는 것을 말할 때, 사용법이나 앱 상태를 물을 때
     ──────────────부름──────▶ Project Manager   : kind를 청할 때, 앱을 만들거나 고쳐 달라고 할 때, annotation을 보낼 때
     ──────────────부름──────▶ Operator          : place의 일을 시킬 때

lophn ─────────call(none)────▶ Project Manager   : 기획이 앱을 만들거나 고치는 일로 정해졌을 때
      ───────call(result)────▶ Project Manager   : 기획에 자료 묶음이나 검색이 필요할 때

Project Manager ─call(대화)──▶ coding agent      : ticket이 준비됐을 때(ticket으로 맡김)
                ─call(none)──▶ lophn             : 새 project나 앱이 필요하거나 앱 밖 재사용을 판단해야 할 때
                ─call(none)──▶ Project Manager   : 다른 project의 일일 때(package 주인 project에 package 문제를 넘길 때 포함)
                ───결과──────▶ 사람              : 완료 보고를 검증했을 때

Operator ──────call(none)────▶ Project Manager   : 앱 버그나 모자란 기능을 만났을 때, kind 파일을 바꿔야 할 때
         ────call(result)────▶ Project Manager   : 고쳐진 결과가 있어야 일을 이어갈 수 있을 때

coding agent ─────보고───────▶ Project Manager   : 맡은 일을 끝냈을 때(대화를 닫음)
             ───메시지───────▶ Project Manager   : blueprint나 의존을 바꿔야 하거나 막혔을 때

program ────────reaction─────▶ Project Manager   : 문제 열림·다시 열림, 반복 종료, activation 실패(앱이 묶인 project)
        ────────reaction─────▶ Project Manager   : 문서의 kind 위반(위반이 생긴 project)
        ────────reaction─────▶ Project Manager   : 공개 tool 바뀜(앱의 project와 쓰는 project들), 막힘(앱의 project)
        ─────domain event────▶ 맡긴 Project Manager : 완료 보고, claim 만료, 보고 없는 coding agent session 끝(끌 수 없음)
        ──────────알림───────▶ 사람              : 반복 종료와 kind 위반(toast), 선언이 넓어진 release의 activation 허락, 물음(toast)

call(result) 받은 쪽 ────답─────▶ 보낸 쪽       : 맡은 일을 끝냈을 때, 맡지 않을 때
lophn agent 누구든 ─묻기(escalate)─▶ 사람      : 사람의 결정이나 취향이 필요할 때
```

- 위 선은 대표적인 것이다. lophn agent 사이에서는 agent grant가 허락하면 어느 방향으로든 넘길 수 있다.
- coding agent와 이어진 선은 Project Manager 하나뿐이다.
- program은 부르기만 하고 받지 않는다.

### 5.2 받는 agent 고르기

role 이름만으로는 받는 agent가 하나로 정해지지 않는다(Project Manager는 project마다, Operator는 여럿). 보내는 쪽과 받는 쪽의 짝마다 받는 agent 하나를 고르는 방법은 아래와 같다. 일의 내용과는 상관없다. (제안. coding agent 줄과 열, program 줄은 정함)

| 기호 | 고르는 방법 |
|---|---|
| 같음 | 보낸 쪽과 같은 place에 있는 그 role |
| prj | 보내는 쪽이 적은 project의 그 role. 일이 앱에 관한 것이면 그 앱이 묶인 project |
| 이름 | 보내는 쪽이 place와 이름으로 고른 Operator |
| 하나 | 하나뿐이라 고를 것이 없다(lophn) |
| × | 넘길 수 없다 |

이 표는 보내는 agent가 `to`에 무엇을 적는지의 지침이다. Router는 이 표를 코드로 갖지 않고, 적힌 role과 place(그리고 Operator 이름)가 정확히 맞는 agent만 고른다. 짐작하지 않는다.

| 보내는 쪽 ↓ / 받는 쪽 → | lophn | Operator | Project Manager | coding agent |
|---|---|---|---|---|
| lophn @전체 | — | 이름 | prj | × |
| Operator @project | 하나 | 이름 | 같음 / prj | × |
| Project Manager @project | 하나 | 이름 | prj | ticket |
| coding agent | × | × | 맡긴 Project Manager(닫혔으면 그 앱 project의 새 session) | × |
| program | × | × | 사실이 생긴 project(앱에 관한 사실이면 앱이 묶인 project) | × |

- 같은 role끼리도 넘길 수 있다. 예를 들어 한 project의 Project Manager가 다른 project의 Project Manager에게 넘긴다.
- "같음 / prj"는 같은 place의 일이면 같은 place의 그 role, 다른 project의 일이면 보내는 쪽이 적은 project의 그 role이다.
- 고른 agent가 없으면(그 project가 없거나 그 이름의 Operator가 없으면) 넘기기가 막히고 이유가 돌아온다(T9).
- 새 앱은 lophn이 project를 골라 먼저 등록하고, 그 project의 Project Manager에게 "prj" 방법으로 맡긴다.

## 6. program이 agent를 부르는 때

E4를 뺀 나머지는 reaction grant를 따르고, 기본은 묻지 않고 session을 연다. E4는 맡긴 call을 닫는 사실이라 끌 수 없다.

- E1. 앱에 문제가 열리거나 해결된 문제가 다시 열리면, program이 그 앱이 묶인 project의 Project Manager를 부른다.
- E2. 앱이 거듭 죽어 자동 재시작을 멈추면, program이 그 앱이 묶인 project의 Project Manager를 부르고 사람에게 toast로 알린다.
- E3. activation이 실패하면, program이 그 release의 앱이 묶인 project의 Project Manager를 부른다.
- E4. coding agent가 완료를 보고하거나, claim이 만료되거나, 보고 없이 session이 끝나면, program이 맡긴 Project Manager session에 알린다. 그 session이 닫혀 있으면 그 앱 project의 Project Manager 새 session이 받는다.
- E5. 문서가 kind를 어기면(위반이 새로 열리거나 다시 열리면), program이 위반이 생긴 project의 Project Manager를 부르고 사람에게 toast로 알린다.
- E6. ticket이 확인됨이 되어 그 release의 activation이 시작되고 선언이 넓어졌거나 data 손실 가능성이 있으면, program이 사람에게 activation 허락을 묻는다.
- E7. release가 active가 되어 공개 tool이 바뀌거나 지워지면, program이 그 앱 project의 Project Manager와 그 tool을 쓰는 다른 project의 Project Manager를 부른다(project마다 한 번).
- E8. 다른 project가 쓰는 공개 tool을 지운 release는 program이 activation을 막고 그 앱 project의 Project Manager를 부른다.

## 7. 하지 않는 것

- agent가 다른 agent를 자식(subagent)으로 띄워 결과를 기다리는 구조를 두지 않는다. 넘기는 것은 늘 다른 session이다.
- 누가 누구를 부를 수 있는지를 고정 표로 두지 않는다. grant가 정한다.
- 보낸 쪽의 대화를 복사하거나 권한을 물려주지 않는다.
- 보낸 쪽이 결과를 기다리며 막히는 동기 호출, 자동 재시도, 실패를 조용히 버리기.

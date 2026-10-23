# Agent role

lophn에서 일하는 agent가 어디에 놓이는지, 언제 무엇을 하는지, 일이 자기 책임을 넘으면 누구에게 어떻게 넘기는지를 정한다. 보장은 코드와 test가 지키고, 이 문서는 그 위의 정책이다.

- 한 줄에 책임 하나를 쓴다. 꼴은 "언제, 누가 무엇을 한다"이다.
- 줄 끝 표시: 표시가 없으면 정한 것이다. **제안**은 lead가 쓴 것으로 사람 확인 전이다.

## 1. place와 agent

place는 agent가 놓여 일하는 그릇 하나다. 그릇은 project(폴더 작업 공간) 또는 app(software 작업 공간)이다. domain은 그릇 안의 책임 경계다(`architecture/domain.md`).

- P1. Project Manager는 project place에, App Engineer는 app place에, Operator는 project나 app place에 놓인다. lophn은 place에 놓이지 않고 lophn 전체에 하나다.
- P2. lophn은 lophn 앱을 쓰도록 돕는 메타 role이라 특정 그릇에 놓이지 않는다. project 지침은 그 project의 일을 할 때 tool로 읽는다.
- P3. 앱은 project에 묶이지 않는다. 앱마다 app place가 있고 그 앱의 일은 App Engineer가 맡는다. 앱은 lophn이 등록한다.
- P4. 사람은 project place와 app place에 Operator를 필요한 만큼 만든다.
- P5. Project Manager는 project마다 하나이고 project를 등록하면 생긴다. 자기 project와 그 domain을 맡는다. App Engineer는 앱마다 하나이고 앱을 등록하면 생긴다. 앱 코드와 그 앱의 domain을 맡는다. 둘 다 사람이 더하거나 지울 수 없다.
- P6. coding agent는 lophn 밖의 harness다. App Engineer는 coding agent에게 일을 맡기지 않고 앱을 직접 짓는다. 연결 장치(그 앱의 source 폴더를 작업 위치로 여는 session 하나, place는 그 앱, terminal은 app space)는 남지만 여는 길이 없고, 얼마나 남길지는 보류다.
- P7. 사람은 sidebar로, 앱 화면에서는 title bar의 agent select(lophn, 그 앱의 App Engineer와 Operator)로, 어디서든 toast로 agent를 부른다.
- P8. 사람은 앱을 만들거나 고치는 일을 App Engineer에게 청하고, App Engineer가 직접 짓는다. 사람이 터미널 탭에서 자기 coding agent를 쓰는 것은 lophn agent의 일과 별개다.
- P9. 같은 project에 놓인 agent는 그 project의 `LOPHN.md`를 지침으로 같이 읽는다. app place에는 `LOPHN.md`가 없다. lophn은 tool로 읽는다.
- P10. project는 사람의 폴더 없이도 등록할 수 있다(폴더 0개 project). 폴더가 없는 project의 `LOPHN.md`는 lophn data의 project 자리에 있고, Project Manager의 file 범위 밖이라 사람이 editor로 고친다.
- P11. 그릇마다 domain이 있다. project는 0개여도 되고, 앱은 등록할 때 앱 이름의 domain이 하나 생겨 0개가 되지 않는다. domain은 그 그릇의 Project Manager나 App Engineer가 만들고, 사람도 만든다.
- P12. agent는 맡은 domain의 `DOMAIN.md`, kind, skill, tool만 받는다. Project Manager와 App Engineer는 그릇의 domain 전부를, Operator는 정의에서 고른 domain(고르지 않으면 그릇의 전부)을 맡는다. 다른 그릇의 domain은 할당받은 공개 tool로만 쓴다.

## 2. role마다 언제 무엇을 하나

### lophn

L1~L11은 lophn의 built-in role 지침에 쓸 재료다. 의미 판단이라 program이 강제하지 않는다. 일의 흐름은 지침과 skill이 primitive를 엮는다. 문장은 지침을 쓸 때 사람이 확인한다.

- L1. 사람이 무엇을 원하는지 아직 정하지 못한 채 말을 걸면, lophn이 질문으로 의도를 정리한다. (제안)
- L2. 사람이 새 앱이나 앱의 변경을 원하면, lophn은 기존 앱을 고치기, 기존 SDK와 package로 하기, 새 앱 만들기 순서로 견주어 기획한다. (제안)
- L3. 사람이 새 project를 원하면, lophn은 기존 project 안에 domain으로 두기, 기존 domain을 넓히기, 새 project 만들기 순서로 견주어 기획한다. (제안)
- L4. 기획이 앱을 만들거나 고치는 일로 정해지면, lophn은 그 앱의 App Engineer에게 답을 받지 않는 call로 맡기고 App Engineer가 설계하고 직접 짓는다. 새 앱이면 lophn이 먼저 앱을 등록한다(project를 고르지 않는다). 등록하면 앱의 source 폴더가 생긴다. (등록을 뺀 나머지는 제안)
- L5. 기획에 자료 묶음이나 검색이 필요하면, lophn은 그 project의 Project Manager에게 결과를 받는 call로 맡긴다. (제안)
- L6. 사람이 lophn 사용법이나 설정의 뜻을 물으면, lophn은 사용 안내 skill(`guide-*`)과 지금 설정값으로 답한다. (제안)
- L7. 사람이 앱이 잘 도는지 물으면, lophn은 앱 상태, 앱 log, 실패한 호출 기록을 읽어 확인한 사실과 해석을 나눠 답한다. 사람이 `/repair-app`으로 부르면 고치기는 그 앱의 App Engineer에게 call로 넘긴다. (제안)
- L8. 사람이 Operator를 원하면, lophn은 직접 만들지 않고 그 그릇의 Project Manager나 App Engineer에게 call로 맡긴다.
- L9. 사람이 새 앱이나 앱의 변경을 원하면, lophn은 기획 전에 place 정보의 domain 지도(domain마다 owner, 목적, 공개 tool, 그 공개 tool을 쓰는 다른 domain, 앱마다 그 앱이 주인인 package)에서 다른 domain의 공개 tool이나 package가 이미 그 일을 하는지 본다. 있으면 그것을 쓰는 안을 먼저 견준다.
- L10. 기획이 다른 domain의 공개 tool을 쓰거나, tool을 공개로 내거나, 코드를 package로 옮기는 것처럼 domain 경계를 넘으면, lophn은 이유와 함께 사람에게 제안하고 사람이 정한다. 같은 package나 공개 tool을 여러 domain이 쓰는지는 지도에서 lophn이 읽고, program이 알려 주지 않는다.
- L11. 새 domain, domain 나누기와 합치기, 재사용, package로 빼기는 lophn이 판단해 제안한다. domain을 만드는 것은 그 그릇의 Project Manager나 App Engineer이고, 경계를 자르는 결정은 사람이 한다. (제안)

### Operator

- O1. 사람이 Operator session에서 일을 시키면, Operator는 맡은 domain의 kind와 할당받은 tool로 자료를 읽고 판단해 결과를 남긴다.
- O4. 일하다 앱의 버그나 모자란 기능을 만나면, Operator는 직접 고치지 않고 그 앱의 App Engineer에게 답을 받지 않는 call로 맡긴다.
- O5. 고쳐진 결과를 받아야 일을 이어갈 수 있으면, Operator는 그 앱의 App Engineer에게 결과를 받는 call로 맡기고 결과가 돌아오면 이어서 일한다.
- O6. domain의 `DOMAIN.md`, kind 파일, skill을 바꿔야 하면, Operator는 직접 고치지 않고 그 그릇의 Project Manager나 App Engineer에게 call로 맡긴다. Operator가 쓰는 것은 고른 domain의 artifact뿐이다.
- O7. 자기 정의나 할당을 바꿔야 하면, Operator는 사람에게 올린다. (제안)

### App Engineer

A1~A15는 앱을 짓는 일이다(A16은 없앴다). A17 이후는 앱의 source와 package, domain, 공개 tool의 일이다.

- A1. 사람이 앱을 만들거나 고쳐 달라고 하면, App Engineer가 짓기 전에 설계(재사용, 모델, journey, 화면, tool, 실패 분기)를 앱 source의 `DESIGN.md`에 쓰거나 고친 뒤 직접 짓는다.
- A2. 사람이 앱이 이상하다고 하거나 앱이 잘못 도는 것 같으면, App Engineer가 앱 상태, 앱 log, 호출 기록을 읽어 읽은 것과 추정을 나눠 말한 뒤 원인을 고친다.
- A3. 사람이 앱 화면에서 annotation을 보내면, App Engineer가 받아 그 화면에 대한 사람의 요청으로 읽고 고친다.
- A4. 코드를 쓰기 전에, App Engineer가 선언(tool, 입력, 효과, domain, 공개 여부, permission, 의존)을 쓰거나 고치고 검사 결과를 읽는다.
- A5. 코드를 쓰기 전에, App Engineer가 앱이 쓸 package와 정확한 version을 골라 선언의 의존에 고정한다.
- A6. App Engineer가 앱 source에 코드를 쓰고, `shell.run`으로 앱 test와 type 검사를 돌린 뒤 commit한다.
- A7. App Engineer가 `release.prepare`로 지금 commit의 release를 준비한다. program이 그 자리에서 의존성, migration, 선언과 handler 일치를 검사하고, 떨어지면 단계와 이유를 돌려준다. App Engineer가 고치고 다시 준비한다.
- A8. App Engineer가 준비한 release를 `preview.start`로 fixture data에 띄우고 `preview.call`로 journey를 차례로 불러 확인한다. preview는 운영 data에 닿지 않고 기록을 남기지 않는다.
- A9. 확인한 release를 App Engineer가 `release.activate`로 올리고, 확인한 것과 확인하지 못한 것을 나눠 사람에게 알린다.
- A10. activation이 실패하면, App Engineer가 `release.activate`의 결과로 받은 실패 근거와 앱 log를 읽고 고친다. program이 App Engineer를 다시 부르지 않는다. (고치는 것은 제안)
- A11. 첫 activation이거나 선언이 넓어졌거나 data 손실 migration이면 `release.activate`가 동의 대기를 돌려준다. App Engineer는 사람에게 무엇을 묻는지 말하고, 동의 뒤의 결과는 사람이 화면에서 본다.
- A12. 앱 밖의 재사용이나 domain 경계를 넘는 기획을 판단해야 하면, App Engineer는 lophn에게 답을 받지 않는 call로 맡긴다. (제안)
- A13. 앱이 읽을 자료 묶음이 필요하면, App Engineer는 그 project의 Project Manager에게 결과를 받는 call로 맡긴다. (제안)
- A14. 사람이나 lophn이 그 앱의 Operator를 청하면, App Engineer가 그 앱에 Operator를 만들거나 고친다. 다른 앱의 Operator는 다루지 않는다.
- A15. 앱을 만들거나 기능을 더할 때, App Engineer는 보고할 실패 분기와 이름을 설계에 적고 그 자리에 `reportProblem`을 둔다. 그 호출은 앱 log에 error 한 줄을 쓰고, App Engineer가 `app.logs`로 읽는다.
- A17. 앱의 source 폴더를 잇거나 앱이 만든 package를 publish하는 것은 App Engineer가 자기 앱에 대해서만 한다. 다른 앱의 것은 자격이 막는다. publish한 앱이 그 package의 주인이 된다.
- A18. 앱에 domain이 더 필요하면, App Engineer가 `domain.create`로 그 앱에 만든다. tool을 선언할 때 `domain`은 그 tool이 다루는 객체의 domain이다.
- A19. 앱의 domain에 뜻이나 절차가 필요하면, App Engineer가 그 domain의 `DOMAIN.md`, kind 파일, skill을 쓰거나 고친다.
- A20. 자기 앱이 쓰는 package에서 난 문제는, App Engineer가 고치지 않고 package 주인 앱(`package.get`의 `owner_app`)의 App Engineer에게 답을 받지 않는 call로 맡긴다.
- A21. 공개 tool은 다른 domain이 기대는 약속이다. 다른 domain이 쓰는 공개 tool을 지우는 release는 program이 막지 않고 `release.prepare`의 결과에 그 tool과 쓰는 domain을 싣는다. 지우려면 App Engineer가 activate하기 전에 그 domain의 Project Manager나 App Engineer에게 답을 받지 않는 call로 알리고 사람에게 묻는다. 아니면 tool을 되살린다.

### Project Manager

C1~C9는 kind와 Operator, C24 이후는 domain의 skill과 artifact, domain 경계를 넘는 일, workflow 정의(C29)다. 앱의 일(예전 C10~C23)은 App Engineer가 맡는다.

- C1. 사람이나 agent가 kind를 청하거나 domain에 kind가 아직 없으면, Project Manager가 그 domain의 kind 파일(`kinds.yaml`)을 쓰거나 고친다.
- C2. kind를 나누거나 합칠 때, Project Manager는 kind 사이 참조가 최소가 되게 경계를 긋는다.
- C3. kind 파일을 고치면, 판 없이 저장하는 대로 program이 검사해 맞으면 바로 쓰고 틀리면 앞의 맞던 kind를 계속 쓴다.
- C6. 문서가 kind를 어겼다고 사람이 알리면, Project Manager가 위반 근거를 읽고 kind 파일을 고칠지 사람에게 문서를 고치라고 할지 정한다.
- C7. 용어의 뜻이 필요하면, Project Manager는 정하지 않고 사람에게 묻는다. 답이 없으면 그 변경을 하지 않는다.
- C8. 새 project나 앱이 필요하다고 판단하거나 domain 경계를 넘는 재사용이나 기획을 판단해야 하면, Project Manager는 lophn에게 답을 받지 않는 call로 맡긴다. (제안)
- C9. 사람이나 lophn이 그 project의 Operator를 청하면, Project Manager가 그 project에 Operator를 만들거나 고친다. 다른 project의 Operator는 다루지 않는다. Operator가 맡을 domain을 고른다.
- C10. 사람이나 agent가 앱을 만들거나 고쳐 달라고 하면, Project Manager는 직접 하지 않고 그 앱의 App Engineer에게 call로 맡긴다. 새 앱이면 lophn에게 맡긴다.
- C24. project에 새 업무가 생기면, Project Manager가 `domain.create`로 그 project에 domain을 만들고 그 domain의 `DOMAIN.md`와 skill을 쓰거나 고친다.
- C25. 다른 domain의 공개 tool을 Operator가 쓰게 하려면, Project Manager는 이유와 함께 사람에게 할당을 제안한다. 할당은 사람이 한다. (제안)
- C26. 자기 Operator가 쓰는 package에서 난 문제는, Project Manager가 package 주인 앱(`package.get`의 `owner_app`)의 App Engineer에게 답을 받지 않는 call로 맡긴다.
- C27. 자기 domain이 쓰는 공개 tool이 바뀌었다고 그 앱의 App Engineer가 알리면, Project Manager가 바뀐 tool을 읽고 그 tool을 부르는 skill(자기 Operator의 것 포함)을 다시 본다.
- C28. agent가 쓴 결과 문서가 필요하면, Project Manager나 그 domain을 고른 Operator가 domain의 artifact를 쓴다. node 그림(kind 지도, 상태 흐름)은 둘지 사람에게 묻고 정한다. workflow 그림(C29)과 같다.
- C29. 사람이 workflow를 청하거나 project의 일이 여러 참가자가 step을 넘기며 도는 모양이면, Project Manager가 그 project의 `workflows/<name>/`에 선언(`workflow.yaml`)과 `workflow.md`를 쓰거나 고친다. artifact(step 그림, instance 상태)는 둘지 사람에게 묻고 정한다. workflow 정의를 쓰는 것은 그 project의 Project Manager뿐이다(`architecture/workflow.md`). 결정적인 처리가 필요한 workflow는 `kind: flow`로 두고 같은 폴더에 code(`flow.ts`)를 쓴다. 쓴 뒤 `workflow.check`로 type check한다. flow가 부를 앱 tool은 Project Manager의 할당과 맡은 domain 안에서만 되므로, 그 앱이 할당에 없으면 사람에게 할당을 청한다.

### workflow 참가자

W1~W5는 어느 role이든 workflow instance의 step을 받은 agent의 규칙이다. lophn은 말한 대로 기록하고 전할 뿐 순서, 결과, 고칠 자격을 판정하지 않는다.

- W1. step 메시지(`<lophn-step>`)를 받으면, 받은 agent는 그 step의 prompt대로 일하고 `workflow.report`로 어떻게 됐는지 글과 다음 step(`next`, 후보 가운데 하나나 `end`)을 낸다. `next`가 없는 report는 진행 글이라 아무에게도 넘어가지 않는다. 긴 결과는 file에 두고 경로를 쓴다.
- W2. step 메시지 하나가 그 agent가 workflow에 대해 받는 전부다(그 step의 prompt, 받은 것, 낼 것, 다음 후보). `workflow.md`, 다른 step, 다른 참가자는 모른다. 더 알아야 하면 그 step의 prompt가 무엇을 읽으라고 말한다.
- W3. 예외가 생기면, 참가자가 `workflow.edit`로 instance를 고친다(step 더하기·고치기·지우기, 끝, 지금 넘기기). 누가 고칠지는 workflow가 정한다(coordinator 참가자를 둘 수 있다). 누가 고쳤는지 줄로 남는다.
- W4. step 메시지가 연 turn은 사람이 없는 turn(unattended)이다. 받은 agent는 그래도 자기 할당으로만 일한다(T5, T6).
- W5. lophn이 다시 켜져 넘긴 step이 `lophn_restarted`로 남았으면, 참가자나 사람이 확인하고 필요하면 `hand_now`로 다시 넘긴다. lophn은 다시 넣지 않는다.
- W6. flow workflow는 참가자 대신 code(`flow.ts`)가 step을 돈다. flow가 agent를 부르면 그것은 step 메시지가 아니라 run이다(R8). 받은 agent는 report를 내지 않고 답을 남긴다. report는 code가 낸다. lophn이 다시 켜지면 도는 flow는 다시 띄우지 않고 끝난 것으로 닫는다.

### job

J1~J6은 정해진 때 도는 일(job)을 만들고 job이 agent를 부를 때의 규칙이다. job은 주기와 할 일 하나(agent 호출, 앱 tool 호출, workflow instance 시작)와 놓친 차례 정책이다(`architecture/job.md`).

- J1. 사람이 정해진 때 도는 일을 청하면, lophn, Project Manager, App Engineer 가운데 그 일을 맡은 agent가 `job.create`로 job을 만든다. Operator는 job tool을 받지 않는다. 사람은 job을 직접 만들지 못하고 agent에게 청한다.
- J2. agent는 자기가 만든 job만 `job.update`, `job.delete`, `job.list`로 다룬다. 남이 만든 job은 보이지도 않고 고치지 못한다. 사람은 모든 job을 화면에서 고치고 끄고 지운다.
- J3. job의 차례가 오면 program이 job에 적힌 agent를 부른다. 부를 때마다 새 session이고 사람이 없는 turn(unattended)이다. 받은 agent는 그래도 자기 할당으로만 일한다(T5, T6). 답과 실패는 그 run에 남는다.
- J4. job이 앱 tool을 부르는 차례는 그 job을 만든 agent의 지금 할당과 맡은 domain 안에서만 된다. 밖이면 막히고 그 차례는 실패로 남는다.
- J5. job이 부른 agent도 job tool을 받아 job을 만들 수 있다. 막지 않는다. 사람이 모든 job을 화면에서 본다.
- J6. job의 차례가 실패해도 자동으로 다시 하지 않는다. 다시 하는 것은 사람이 정한다.

### coding agent

K1~K5는 coding agent 연결 장치가 남긴 규칙이다. 지금은 Router가 coding agent를 받지 않아 coding agent가 lophn에서 일을 맡지 않는다(P6).

- K1. 맡긴 글(call 본문)을 첫 prompt로 받으면, coding agent는 연결된 앱 source에서 일한다.
- K2. coding agent는 구현, 디버깅, 수정, 앱 test, preview를 한다. release 준비와 activation은 App Engineer의 일이다.
- K3. 일이 끝나면, coding agent는 CLI로 한 일과 남은 일을 App Engineer에게 메시지로 알린다. session의 끝은 터미널 process의 끝이다.
- K4. 맡은 일에 필요하면 coding agent가 선언(`lophn.ts`)을 코드보다 먼저 직접 고치고, `deno.json`의 import map도 같은 정확한 version으로 함께 고친다. 막혔을 때만 CLI로 App Engineer에게 메시지를 보낸다. 맡긴 session이 닫혀 있으면 그 앱의 App Engineer 새 session이 받는다.
- K5. session이 끝나면, 그 session의 token은 lophn이 거둔다.

### 사람

- H1. 사람은 무엇을 만들고 무엇을 원하는지 agent에게 이야기한다.
- H2. 앱을 처음 activation하거나 새 release가 선언을 넓히면, 사람이 앱 grant를 허락한다.
- H3. 사람이 agent에게 앱을 할당하고, 그 앱에서 뺄 tool을 고른다. 할당한 tool은 실행 때 묻지 않는다(할당이 허락이다). 외부 MCP server는 설정한 곳(Workspace, project, 그 Operator의 정의)이 할당이고 정의에서 끈다. Workspace와 project 층에서 끈 server는 도는 turn에서도 다음 호출부터 막힌다. agent가 맡지 않은 domain의 tool은 공개(`public`) tool만 쓸 수 있다.
- H4. agent가 shell 규칙이 `ask`인 명령을 돌리려 하면, 사람이 toast나 모든 session의 대기 목록, 대화의 카드에서 한 번 허락, 항상 허락(규칙 줄을 더한다), 거절로 답한다. 거절하며 적은 이유는 agent에게 그대로 간다. 사람이 없는 실행(unattended)과 사람이 skip을 켠 session은 묻지 않지만, deny 규칙은 어느 경우에도 막는다.
- H5. App Engineer가 확인한 것(앱 test, preview, release 준비, activation)과 확인하지 못한 것을 알리면, 사람이 받아 확인한다.
- H6. 사람은 project 창과 app space에서 그 그릇의 domain을 보고 만들고 보관하며, `DOMAIN.md`를 editor로 고친다. 경계를 자르는 결정(domain 나누기, 합치기)은 사람이 한다.
- H7. 사람은 workflow instance를 시작하고 멈춘다(화면, CLI). 정해진 때 시작하게 하려면 job을 agent에게 청한다(J1). 시작이 그 사슬을 agent에게 맡기는 것이다. 멈춘 instance에는 더 넘기지 않는다.
- H8. 사람 step이 오면, 사람은 `with` 참가자 agent의 session에서 그 agent와 논의하고 결과는 그 agent가 report한다. 사람은 승인 단추가 아니라 참가자다. 순서를 바꾸고 싶으면 그 agent에게 말한다.
- H9. 사람은 Settings › System › Scheduled jobs(모든 job)와 project 창의 Scheduled jobs panel(그 project와 걸린 job)에서 job을 보고 켜고 끄고 고치고 지운다. 놓친 차례를 `hold`로 둔 job은 대기 목록의 card에서 [Start now]나 [Skip]을 고른다. lophn이 꺼진 사이 놓친 차례와, 켜진 채라도 컴퓨터가 잠들어 차례 시각보다 10분 넘게 늦은 차례가 놓친 차례다.
- H10. 앱이 선언한 secret은 사람이 앱 Access 탭에서 넣는다. OAuth secret이면 사람이 그 서비스에 만든 client의 id와 secret을 넣고 [Sign in]한다. agent는 값을 대화로 묻지 않고 무엇을 넣을지 알린다. sign-in이 끊기면 앱이 다시 sign-in하라고 알린다.

## 3. 넘기는 길

- R1. call: agent가 다른 agent에게 일을 맡기는 것은 모두 call이다. 보내는 쪽이 받는 곳(새 session, 열린 session, 열린 session이 없으면 새 session)과 답 방식을 고른다.
- R2. 답 방식은 셋이다: 답을 받지 않음(none), 결과 하나를 받음(result), 대화로 주고받음(conversation). 예전에 handoff라 부르던 것은 답을 받지 않는 call이고, 결과를 받던 escalate는 결과를 받는 call이다.
- R3. reaction: program이 보내는 답 없는 알림이다. 지금은 맡긴 coding session의 끝 하나이고, coding session을 여는 길이 없어 쓰이지 않는다.
- R4. 사람에게 올림(escalate): 사람의 결정이나 취향이 필요하면 session에서 사람에게 묻는다. 이것은 call도 동작 허락(approval)도 아니다. escalate라는 말은 이것에만 쓴다.
- R5. App Engineer는 coding agent에게 맡기지 않는다. 받는 곳이 coding agent로 풀리는 call은 Router가 거절한다. 연결 장치가 연 coding session과 주고받는 것은 대화로 주고받는 call이고, session이 끝나면 닫힌다.
- R6. step 메시지: 사람이 시작한 workflow instance에서 참가자의 report나 고치기가 말한 step의 담당에게 program이 넣는 입력이다. call이 아니다(call 행과 답 방식이 없다). 답 대신 report를 낸다(W1).
- R7. job의 run: job의 차례마다 program이 연 run의 입력이다. 받는 agent는 job에 적힌 agent이고 call이 아니다(call 행과 답 방식이 없다). 입력은 사람이 없는 입력(unattended)이고 답은 run 기록에 남는다(J3).
- R8. flow의 run: flow code가 `agent(...)`로 연 run의 입력이다. 받는 agent는 code가 고른 누구든 되고 call이 아니다. 입력은 unattended이고, 받은 agent는 자기 할당으로만 일한다(T5, T6). 답은 run 기록에 남고 code가 받는다.

## 4. 넘길 때의 규칙

- T1. 넘기는 것은 모두 Router 한 입구로 받는 session에 입력을 넣는 것이고, 입력에는 call 봉투(보낸 쪽, 받는 곳, 답 방식, 어느 call에 대한 답인지)가 붙는다.
- T2. 누구에게 넘길지는 보내는 agent가 판단한다.
- T3. 넘기는 것은 묻지도 막지도 않는다. 누구에게 넘길지는 지침과 workflow가 정한다.
- T4. 사람이 없는 turn(unattended)이 보낸 call로 열린 turn은 unattended이고, 그 답과 실패·취소 알림도 따라간다. 사람이 있는 turn이 보낸 call은 사람이 있는 turn(attended)으로 열린다. skip은 call을 따라 가지 않는다.
- T5. 부르는 것 자체에는 묻지 않고, 받은 agent의 동작은 받은 agent의 할당으로 다시 걸러진다.
- T6. 보낸 agent의 할당과 skip은 받은 agent에게 넘어가지 않는다.
- T7. 받는 곳은 보내는 쪽이 고르고, 열린 session으로 보냈는데 닫혀 있으면 새로 열지 않는다. "열린 session, 없으면 새 session"은 놓치면 안 되는 것에만 쓴다.
- T8. 받는 agent는 보낸 쪽이 놓인 place가 아니라 넘기는 일이 어느 그릇(project나 app)과 domain에 관한 것인지로 정하고, 보내는 agent가 그것을 함께 적는다. 경우는 5.2의 표다.
- T9. 받을 agent가 없거나 받는 session이 닫혀 있으면, 이유와 함께 실패가 보낸 session에 돌아온다. 답을 받지 않는 call도 배달 실패는 돌아온다.
- T10. 넘기는 내용은 맡긴 글 하나와 근거 링크(annotation, 파일 경로, 보낸 session)이고, 보낸 쪽의 대화 원문은 복사하지 않는다.
- T11. 결과를 받는 call을 받은 agent는 일이 끝나면 답을 보낸다. 맡지 않을 때도 답으로 이유를 보낸다. lophn agent session은 저절로 끝나지 않아 program이 끝을 알 수 없기 때문이다.
- T12. 보낸 agent는 call을 보낸 뒤 기다리며 막히지 않고, 답은 새 입력으로 받는다.
- T13. 보낸 session이 archive되었거나 지워졌으면, 결과는 받은 session에만 남는다.
- T14. call로 들어온 입력은 대화에 보낸 쪽과 함께 보이고, 누르면 맡긴 글, 근거, 보낸 session을 본다. 보낸 session에는 보낸 call이 대화에 남고 답은 그 call에 이어진 메시지로 들어오며, 누르면 그때의 상태를 본다.
- T15. 같은 요청을 다시 보내도 call과 받는 session은 하나만 생긴다.
- T16. agent끼리 서로 계속 넘기는 것은 막지 않고, 사람이 화면에서 보고 멈춘다. (approval 이야기)
- T17. 결과를 받는 call의 받은 session이 결과 없이 끝나면(archive, 지움), 보낸 session에 실패가 들어온다.
- T18. 보낸 쪽이나 사람은 끝나지 않은 call을 취소할 수 있고, 취소한 call에 뒤늦게 온 답은 닫힘으로 돌아간다.
- T19. 거절당한 일을 다른 agent에게 돌려 시키지 않는다. 이것은 agent 지침의 규칙이고 program이 막지는 않는다.
- T20. 맡긴 coding session이 끝나면 그 끝을 아는 command가 call을 닫고 맡긴 App Engineer에게 한 번 알린다. 그 session이 닫혀 있으면 그 앱의 App Engineer 새 session이 받는다.

## 5. 호출 관계

### 5.1 그림

```
사람 ──────────────부름──────▶ lophn             : 원하는 것을 말할 때, 사용법이나 앱 상태를 물을 때
     ──────────────부름──────▶ Project Manager   : kind나 domain을 청할 때
     ──────────────부름──────▶ App Engineer      : 앱을 만들거나 고쳐 달라고 할 때, 앱 화면 annotation을 보낼 때
     ──────────────부름──────▶ Operator          : place의 일을 시킬 때

lophn ─────────call(none)────▶ App Engineer      : 기획이 앱을 만들거나 고치는 일로 정해졌을 때
      ───────call(result)────▶ Project Manager   : 기획에 자료 묶음이나 검색이 필요할 때

App Engineer ──call(none)────▶ lophn             : 앱 밖 재사용이나 domain 경계를 넘는 기획을 판단해야 할 때
             ──call(none)────▶ App Engineer      : package 문제를 package 주인 앱에 넘길 때
             ──call(result)──▶ Project Manager   : 앱이 읽을 자료 묶음이 필요할 때
             ───결과─────────▶ 사람              : release를 올렸을 때(확인한 것과 못 한 것), 동의가 필요할 때

Project Manager ─call(none)──▶ App Engineer      : 앱 일일 때(package 문제를 package 주인 앱에 넘길 때 포함)
                ─call(none)──▶ lophn             : 새 project나 앱이 필요하거나 domain 경계를 넘는 판단이 필요할 때

Operator ──────call(none)────▶ App Engineer      : 앱 버그나 모자란 기능을 만났을 때
         ────call(result)────▶ App Engineer      : 고쳐진 결과가 있어야 일을 이어갈 수 있을 때
         ──────call(none)────▶ Project Manager | App Engineer : domain의 DOMAIN.md, kind 파일, skill을 바꿔야 할 때(그 그릇의 쪽)

program ──────────알림───────▶ 사람              : 앱의 반복 종료와 새 kind 위반(toast), activation 동의(첫 activation, 넓어진 선언, data 손실), shell 물음(toast)
workflow ───step 메시지───────▶ 참가자 agent      : 사람의 시작, report의 next, 고치기의 지금 넘기기가 그 step을 말했을 때
job ─────────run─────────────▶ job에 적힌 agent   : 정해진 때 (사람이 청한 job의 차례, 새 session, unattended). 앱 tool 호출이나 workflow instance 시작도 한다
flow ────────run─────────────▶ code가 고른 agent  : flow instance의 code가 agent(...)를 부를 때 (새 session, unattended). 앱 tool 호출과 report도 한다
참가자 agent ──report·고치기──▶ workflow          : step을 끝냈거나 진행을 알리거나 예외를 다룰 때

call(result) 받은 쪽 ────답─────▶ 보낸 쪽       : 맡은 일을 끝냈을 때, 맡지 않을 때
lophn agent 누구든 ─묻기(escalate)─▶ 사람      : 사람의 결정이나 취향이 필요할 때
```

- 위 선은 대표적인 것이다. lophn agent 사이에서는 어느 방향으로든 넘길 수 있다.
- coding agent에게 가는 선은 없다. App Engineer가 앱을 직접 짓는다. 연결 장치는 남고, 연결된 coding session이 있다면 그 선은 App Engineer 하나뿐이다.
- program은 스스로 정해 agent를 부르지 않는다. 정해진 때 job이 agent를 부르는 것은 사람이 시킨 일이다(E10). flow가 agent를 부르는 것은 Project Manager가 쓴 code를 사람이나 job이 시작한 것이다(E11). activation 실패는 `release.activate`의 결과로 돌아간다. workflow의 step 메시지는 사람과 참가자가 말한 대로 전하는 것이다(E9).

### 5.2 받는 agent 고르기

role 이름만으로는 받는 agent가 하나로 정해지지 않는다(Project Manager는 project마다, App Engineer는 앱마다, Operator는 여럿). 보내는 쪽과 받는 쪽의 짝마다 받는 agent 하나를 고르는 방법은 아래와 같다. 일의 내용과는 상관없다. (제안. coding agent 줄과 열, program 줄은 정함)

| 기호 | 고르는 방법 |
|---|---|
| 같음 | 보낸 쪽과 같은 place에 있는 그 role |
| prj | 보내는 쪽이 적은 project의 Project Manager |
| app | 보내는 쪽이 적은 앱의 App Engineer |
| 이름 | 보내는 쪽이 place와 이름으로 고른 Operator |
| 하나 | 하나뿐이라 고를 것이 없다(lophn) |
| × | 넘길 수 없다 |

이 표는 보내는 agent가 `to`에 무엇을 적는지의 지침이다. Router는 이 표를 코드로 갖지 않고, 적힌 role과 place(그리고 Operator 이름)가 정확히 맞는 agent만 고른다. 짐작하지 않는다.

| 보내는 쪽 ↓ / 받는 쪽 → | lophn | Operator | Project Manager | App Engineer | coding agent |
|---|---|---|---|---|---|
| lophn @전체 | — | 이름 | prj | app | × |
| Operator @project·app | 하나 | 이름 | 같음 / prj | 같음 / app | × |
| Project Manager @project | 하나 | 이름 | prj | app | × |
| App Engineer @app | 하나 | 이름 | prj | app | × |
| coding agent | × | × | × | 맡긴 App Engineer(닫혔으면 그 앱의 새 session) | × |
| program | × | × | × | 맡긴 coding session의 끝(맡긴 App Engineer) | × |
| workflow step | 하나 | 이름(place가 없으면 instance의 project) | 선언의 project, 없으면 instance의 project | 선언의 app(꼭 있다) | × |

- 같은 role끼리도 넘길 수 있다. 예를 들어 한 앱의 App Engineer가 package 주인 앱의 App Engineer에게 넘긴다.
- "같음 / prj"와 "같음 / app"은 같은 place의 일이면 같은 place의 그 role, 다른 그릇의 일이면 보내는 쪽이 적은 그릇의 그 role이다.
- 고른 agent가 없으면(그 그릇이 없거나 그 이름의 Operator가 없으면) 넘기기가 막히고 이유가 돌아온다(T9).
- 새 앱은 lophn이 먼저 등록하고, 그 앱의 App Engineer에게 "app" 방법으로 맡긴다.

## 6. program이 agent를 부르거나 사람에게 알리는 때

program은 스스로 정해 agent를 부르지 않는다. 앱 오류와 문서의 kind 위반은 사람에게 toast로 알리고(E2, E5), activation 실패는 `release.activate`를 부른 App Engineer에게 결과로 돌아간다(E3). agent는 앱 상태와 앱 log, `kind.check`로 지금 상태를 직접 읽는다. 정기적으로 앱을 살피게 하고 싶으면 사람이 시킨다. 남은 예외는 맡긴 call을 닫는 사실인 E4 하나이고 끌 수 없다. 정해진 때 job이 agent를 부르는 것은 예외가 아니라 사람이 시킨 일의 실행이다(E10).

- E2. 앱이 거듭 죽어 자동 재시작을 멈추면, program이 사람에게 toast로 알린다. agent는 부르지 않는다. App Engineer는 사람이 청하면 `app.status`와 `app.logs`(`process_exit crash_loop` 줄)로 읽는다.
- E3. activation이 실패하면, program이 실패 기록을 남기고 `release.activate`의 결과로 돌려준다. 동의 뒤에 시작한 시도의 결과는 사람이 화면에서 본다. App Engineer를 부르지 않는다.
- E4. 맡긴 coding session이 끝나면, program이 그 call을 닫고 맡긴 App Engineer session에 한 번 알린다. 그 session이 닫혀 있으면 그 앱의 App Engineer 새 session이 받는다. 지금은 coding session을 여는 길이 없다.
- E5. 문서가 kind를 어기면(위반이 새로 생기면), program이 사람에게 toast로 알린다. agent는 부르지 않는다. Project Manager나 App Engineer는 사람이 청하면 `kind.check`로 검사한다.
- E6. App Engineer가 `release.activate`한 release가 첫 activation이거나 선언이 넓어졌거나 data 손실 가능성이 있으면, program이 activation 동의를 대기 목록에 올린다. 사람이 동의해야 activation이 이어진다.
- E8. 다른 domain이 쓰는 공개 tool을 지운 release는 program이 막지 않는다. `release.prepare`의 결과에 그 tool과 쓰는 domain을 싣는다.
- E9. workflow instance에서 사람의 시작, 참가자의 report `next`, 고치기의 `hand_now`가 step을 말하면, program이 그 step의 담당(사람 step이면 `with` agent)에게 step 메시지를 넣는다. 담당을 풀 수 없으면 넣지 않고 그 사실을 instance의 줄로 남긴다. 무엇을 넘길지 program이 정하지 않는다.
- E10. 정해진 때 job의 차례가 오면, program이 job에 적힌 일을 한다: agent를 run으로 부르거나, 만든 agent의 할당 안에서 앱 tool을 부르거나, workflow instance를 시작한다. 이것은 사람이 agent에게 시킨 일(J1)의 실행이고 program이 스스로 정한 반응이 아니다. lophn이 꺼진 사이나 컴퓨터가 잠든 사이 놓친 차례(차례 시각보다 10분 넘게 늦은 차례)를 `hold`로 둔 job은 program이 대기 목록에 card를 올리고 사람이 [Start now]나 [Skip]을 고른다. 자동 재시도는 없다.
- E11. 사람이나 job이 flow instance를 시작하면, program이 그 workflow 폴더의 `flow.ts`를 sandbox 안 process 하나로 띄우고 code의 요청(agent run, 앱 tool 호출, report)을 그대로 한다. 앱 tool은 그 project Project Manager의 할당 안에서만 된다. code가 끝나면 끝 code와 stderr 끝 줄을 남기고 instance를 닫는다. 성공인지 판정하지 않고 다시 띄우지 않는다.

## 7. 하지 않는 것

- agent가 다른 agent를 자식(subagent)으로 띄워 결과를 기다리는 구조를 두지 않는다. 넘기는 것은 늘 다른 session이다.
- 누가 누구를 부를 수 있는지를 고정 표로 두지 않는다. 부르기는 막지 않고 지침이 정한다.
- 보낸 쪽의 대화를 복사하거나 권한을 물려주지 않는다.
- 보낸 쪽이 결과를 기다리며 막히는 동기 호출, 자동 재시도, 실패를 조용히 버리기.

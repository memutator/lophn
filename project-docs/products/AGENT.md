# Agent

lophn에서 일하는 agent가 누구이고, session이 어디(workspace)에서 언제 무엇을 하는지, 일이 그 workspace를 넘으면 누구에게 어떻게 넘기는지를 정한다. 보장은 코드와 test가 지키고, 이 문서는 그 위의 정책이다.

- 한 줄에 책임 하나를 쓴다. 꼴은 "언제, 누가 무엇을 한다"이다.
- 줄 끝 표시: 표시가 없으면 정한 것이다. **제안**은 agent가 쓴 것으로 사람 확인 전이다.
- 줄 ID(F, P, L, G, A, C, W, J, H, R, T, E)는 다른 문서가 가리킨다. 줄을 지워도 남은 줄의 ID는 바꾸지 않는다.

## 0. 사람의 몫과 agent의 몫

PRODUCT.md §3, §4 축 1을 agent의 일로 옮긴 것이다. 아래 모든 줄은 이것을 따른다.

- F1. lophn agent는 사람의 FDE다. 사람의 software를 짓고 다루고 관리하는 일 전부를 맡는다. 사람은 자기 domain에 대해서만 책임진다.
- F2. 사람에게 묻는 것은 domain 결정(무엇을 누구를 위해 하는지, 업무 규칙, 용어의 뜻, 취향)과 그것을 정리하는 인터뷰뿐이다. software 공학의 결정(구조, 재사용, 공개 command, package, 의존, release, migration, artifact의 모양)은 agent가 정하고 이유를 기록(`DESIGN.md`, memory)한다.
- F3. 사람이 직접 하는 허락은 셋이다: grant(activation과 넓어진 선언, 할당, job 등록), data 손실 동의, secret 입력. 청할 때는 무엇이 되고 무엇이 걸렸는지를 domain 말로 말한다.
- F4. 사람에게 하는 보고는 상사에게 하듯 결과로 한다: 무엇이 되었고 사람 쪽에서 무엇이 달라졌는지, 정해 줄 것이 있으면 그것. log, 판 번호, command 이름, test 결과 같은 raw data는 사람이 물을 때만 보인다. 확인한 것과 추정을 가르는 것은 agent 자신의 판단과 agent 사이의 call에 쓴다.
- F5. 결과를 화면(artifact)으로 보일 때도 같다. 무엇을 보일지와 모양은 agent가 정하고, 사람이 판단할 결과를 요약해 보이며 raw data를 펼치지 않는다.
- F6. 실수는 묻는 것으로 막지 않는다. agent가 낸 쓰기는 기록되어 사람이 rewind로 되돌린다.

## 1. agent, session, workspace

agent는 lophn과 사람이 만든 agent 둘이다. 사람이 만든 agent는 workspace에 놓이지 않는다(범위를 고르면 그 workspace에서만 보인다). session이 workspace를 갖는다(`architecture/workspace-session.md`, `architecture/agent-definition.md`).

- P1. lophn은 workspace마다 하나인 내장 agent다. handle `lophn`은 예약이고 id는 workspace에서 나온다(`lophn_home`, `lophn_<prj id>`, `lophn_<app id>`. `lophnIdOf`). 한 lophn은 (handle `lophn`, workspace) 짝으로 가리킨다. handle과 profile은 바꾸지 못하고 지우지 못한다. 나머지 칸(name, model, skill, 지침 본문)은 다른 agent처럼 그 workspace의 lophn 것이다. 정의 file이 없으면 기본 정의다.
- P2. 사람이 만든 agent의 정의는 전역이거나 workspace 하나에 범위가 있다. handle은 전역에서 겹치지 않고 `lophn`은 쓰지 못한다. 정의에 권한 칸은 없다.
- P3. session은 열 때 agent 하나와 workspace 하나를 정하고 바꾸지 않는다. workspace는 home(workspace 없음), project, app 셋 가운데 하나다. 창에서 열면 그 창의 workspace다.
- P4. 같은 workspace 종류의 lophn runtime session은 agent가 누구든 같은 tool 목록, 지침, 내장 skill, credential 상한, file 범위를 받는다. 좁히는 것은 정의의 `skills_off`와 사람의 할당이다. 정의가 `runtime: custom`인 agent는 제품 규칙, workspace 지침, 전역·workspace 지침, skill 없이 정의 본문과 정의 `tools`가 고른 tool만 받는다. 고를 수 있는 것은 그 workspace 종류 목록 안의 tool과 명령, 할당한 앱 command, 설정한 MCP tool이고, credential 상한과 file 범위는 workspace 종류 그대로다. result call은 turn이 끝날 때 마지막 응답이 답이다(`architecture/agent-definition.md`, `architecture/agent-call.md`).
- P5. 앱은 project에 묶이지 않는다. 앱마다 app workspace가 있고 앱은 home에서 등록한다. 등록할 때 agent를 만들지 않는다. project도 마찬가지다.
- P6. coding agent는 lophn 밖의 harness다. 사람이 터미널 탭에서 자기 coding agent를 쓰는 것은 lophn agent의 일과 별개이고, lophn은 그 탭의 상태(icon, 점, 알림)만 보인다(`architecture/terminal-agent.md`). 사람이 harness(Claude Code, Codex, OpenCode)를 정의의 runtime으로 두면 그 agent는 lophn A2A로 일을 받고, lophn이 그 harness의 headless CLI 명령으로 실행한다. 켜기는 설정 `extensions.harness.enabled`(Settings › System › Extensions)다(`architecture/coding-agent.md`).
- P7. 사람은 왼쪽 sidebar의 New session(▾로 agent 고르기. Home, project, 앱 workspace 어디서나), toast로 agent를 부른다. 고르면 그 workspace의 session이 열린다.
- P8. Home, project, 앱은 같은 층을 갖는다: 지침, 외부 MCP server와 `mcp_off`, `skills_off`, model. session은 자기 workspace의 지침을 같이 읽는다. project는 `LOPHN.md`, Home은 `<data>/home/LOPHN.md`, 앱은 앱 source의 `AGENTS.md`다(source를 잇지 않은 앱은 없다). 사람은 각 workspace의 Agents 탭에서 이 층을 고친다.
- P10. project는 사람의 폴더 없이도 등록할 수 있다(폴더 0개 project). 폴더가 없는 project의 `LOPHN.md`는 lophn data의 project 자리에 있고, project workspace session의 file 범위 밖이라 사람이 editor로 고친다.
- P12. 경계는 그릇(project, app)이다. session은 그 workspace 그릇의 지침, skill, 앱 command를 받는다. 앱의 비공개 command는 그 앱 workspace의 session만 보고, 다른 곳은 할당받은 공개 command로만 쓴다.
- P13. Home memory(`<data>/home/memory.md`)는 global memory다. Home lophn만 쓰고 모든 workspace의 모든 agent가 읽기만 한다. project·앱 workspace memory는 그 workspace 그릇 자리의 `memory.md`이고 그 workspace의 lophn만 쓰며 그 workspace의 모든 agent가 받는다. 사람이 만든 agent는 자기 agent memory를 따로 갖고 자기만 쓰고 받는다. 둘 다 `agent.memory` tool로만 쓰고 8 KiB까지이며 session 첫 turn에 고정되어 다음 session부터 바뀐 글을 본다. 담는 것은 사람이 정한 것, 계산할 수 없는 의도, 어디에 물으면 되는지 pointer다(`architecture/agent-definition.md`).

## 2. workspace마다 언제 무엇을 하나

### home

L1~L11은 home 지침(`packages/core/agent-workspaces/prompts/home.md`)에 쓰는 재료다. 의미 판단이라 program이 강제하지 않는다. 일의 흐름은 지침과 skill이 primitive를 엮는다.

- L1. 사람이 무엇을 원하는지 아직 정하지 못한 채 말을 걸면, home의 session이 질문으로 의도를 정리한다. (제안)
- L2. 사람이 새 앱이나 앱의 변경을 원하면, home의 session은 기존 앱을 고치기, 기존 SDK와 package로 하기, 새 앱 만들기 순서로 견주어 기획한다. (제안)
- L3. 사람이 새 project를 원하면, home의 session은 기존 project에 넣기, 새 project 만들기 순서로 견주어 기획한다. (제안)
- L4. 기획이 앱을 만들거나 고치는 일로 정해지면, home의 session은 그 앱 workspace의 lophn에게 답을 받지 않는 call로 맡기고 그 session이 설계하고 직접 짓는다. 새 앱이면 home의 session이 먼저 앱을 등록한다(project를 고르지 않는다). 등록하면 앱의 source 폴더가 생긴다. (등록을 뺀 나머지는 제안)
- L5. 기획에 자료 묶음이나 검색이 필요하면, home의 session은 그 project workspace의 lophn에게 결과를 받는 call로 맡긴다. (제안)
- L6. 사람이 설정의 뜻을 물으면, home의 session은 지금 설정값과 그 정의(`settings.get`)로 답한다. (제안)
- L7. 사람이 앱이 잘 도는지 물으면, home의 session은 앱 상태, 앱 log, 실패한 호출 기록을 읽고 무엇이 안 되고 누가 고치는지를 domain 말로 답한다(F4). 사람이 `/repair-app`으로 부르면 고치기는 그 앱 workspace의 lophn에게 call로 넘긴다. (제안)
- L9. 사람이 새 앱이나 앱의 변경을 원하면, home의 session은 기획 전에 workspace 정보의 앱 지도(앱마다 공개 command, 그 command를 쓰는 다른 앱·project, 그 앱이 주인인 package)에서 다른 앱의 공개 command나 package가 이미 그 일을 하는지 본다. 있으면 그것을 쓰는 안을 먼저 견준다.
- L10. 기획이 다른 앱의 공개 command를 쓰거나, command를 공개로 내거나, 코드를 package로 옮기는 것처럼 그릇 경계를 넘으면, home의 session이 정하고 이유를 기록한다(F2). 같은 package나 공개 command를 여러 곳이 쓰는지는 지도에서 읽고, program이 알려 주지 않는다.
- L11. 재사용과 package로 빼기는 home의 session이 판단해 정한다. 사람에게는 그 결과 무엇이 달라지는지만 말한다. (제안)
- L12. 앱의 data를 사람의 다른 컴퓨터로 보내야 하면(선언 `sync_to`), 이 기계의 destination(설정 `folder.destinations`)을 청하는 것은 home의 session뿐이다. 먼저 어느 앱의 무엇이 어느 폴더로 가고 어느 바깥 도구가 어디로 옮기는지, 암호화되는지를 말하고, 사람이 승인 카드에서 그 한 번을 허락한다. 사람이 없는 turn과 팀 자식은 청하지 못한다. 폴더를 옮기는 바깥 도구는 lophn 기능이 아니고 session이 지침대로 사람의 기계에 붙인다(`architecture/folder-sync.md`).

### 어느 workspace든

- G1. 사람이 새 agent를 원하거나 agent를 고쳐 달라고 하면, 어느 workspace의 session이든 `agent.create`·`agent.update`로 만들거나 고친다. 정의가 전역이라 어느 workspace에서 만들어도 같다. 할당, 정의 층 MCP server, skip은 주지 못하고 사람이 정한다.
- G2. 자기 정의나 할당을 바꿔야 하면, session은 사람에게 올린다.
- G3. 일하다 다른 그릇의 일(앱의 버그, 다른 project의 문서)을 만나면, session은 그 그릇 workspace의 lophn에게 call로 맡긴다. 결과가 있어야 이어갈 수 있으면 결과를 받는 call로 맡긴다. 같은 그릇의 일이면 직접 고친다.
- G4. 같은 일을 나눠 병렬로 돌려야 하면, session은 `lophn team spawn`으로 팀원 session을 열어 call로 맡긴다(팀 상한 안에서, 기본 답은 결과). 팀원은 부모의 spawn tree에 남고(`spawned_by`) 서로의 연락처는 `lophn team read`로 읽으며, 끝낼 수 있는 것은 자기 자손뿐이다(`team end`). 사람이나 보는 이에게 보여야 하면 `lophn tab open`으로 같은 workspace의 session이나 url을 탭으로 열고, 자기가 연 browser 탭과 앱 preview 탭은 `lophn browser`(`snapshot`, `act`, `screenshot` 등)로 보고 다룬다. page에서 온 글은 `<lophn-untrusted>`로 감싸 data로만 읽는다.

### app

A1~A15는 앱을 짓는 일이다(A16은 없앴다). A17 이후는 앱의 source와 package, 공개 command의 일이다. 지침은 `packages/core/agent-workspaces/prompts/app.md`다.

- A1. 사람이 앱을 만들거나 고쳐 달라고 하면, 앱 workspace의 session이 짓기 전에 설계(재사용, 모델, journey, 화면, tool, 실패 분기)를 앱 source의 `DESIGN.md`에 쓰거나 고친 뒤 직접 짓는다.
- A2. 사람이 앱이 이상하다고 하거나 앱이 잘못 도는 것 같으면, 앱 workspace의 session이 앱 상태, 앱 log, 호출 기록을 읽어 원인을 고치고, 사람에게는 무엇이 안 됐고 이제 어떻게 되는지를 말한다(F4).
- A3. 사람이 앱 화면에서 annotation을 보내면, title bar agent select가 고른 agent의 그 앱 workspace session이 받아 그 화면에 대한 사람의 요청으로 읽고 고친다.
- A4. 코드를 쓰기 전에, 앱 workspace의 session이 선언(command, 입력, 효과, 공개 여부, permission, 의존)을 쓰거나 고치고 검사 결과를 읽는다.
- A5. 코드를 쓰기 전에, 앱 workspace의 session이 앱이 쓸 package와 정확한 version을 골라 선언의 의존에 고정한다.
- A6. 앱 workspace의 session이 앱 source에 코드를 쓰고, `shell.run`으로 앱 test와 type 검사를 돌린 뒤 commit한다.
- A7. 앱 workspace의 session이 `release.prepare`로 지금 commit의 release를 준비한다. program이 그 자리에서 의존성, migration, 선언과 handler 일치를 검사하고, 떨어지면 단계와 이유를 돌려준다. session이 고치고 다시 준비한다.
- A8. 앱 workspace의 session이 준비한 release를 `preview.start`로 fixture data에 띄우고 `preview.call`로 journey를 차례로 불러 확인한다. preview 탭이 열리고 화면은 `lophn browser`로 본다. preview는 운영 data에 닿지 않고 기록을 남기지 않는다.
- A9. 확인한 release를 앱 workspace의 session이 `release.activate`로 올리고, 사람에게 그 앱에서 무엇이 달라졌는지를 domain 말로 알린다. 확인하지 못해 사람이 써 보며 봐야 할 것이 있으면 그것도 domain 말로 말한다(F4).
- A10. activation이 실패하면, 앱 workspace의 session이 `release.activate`의 결과로 받은 실패 근거와 앱 log를 읽고 고친다. program이 다시 부르지 않는다. (고치는 것은 제안)
- A11. 첫 activation이거나 선언이 넓어졌거나 data 손실 migration이면 `release.activate`가 동의 대기를 돌려준다. session은 사람에게 무엇을 허락하는지 domain 말로 말하고(F3), 동의 뒤의 결과는 사람이 화면에서 본다.
- A12. 앱 밖의 재사용이나 그릇 경계를 넘는 기획을 판단해야 하면, 앱 workspace의 session은 home의 lophn에게 답을 받지 않는 call로 맡긴다. (제안)
- A13. 앱이 읽을 자료 묶음이 필요하면, 앱 workspace의 session은 그 project workspace의 lophn에게 결과를 받는 call로 맡긴다. (제안)
- A15. 앱을 만들거나 기능을 더할 때, 앱 workspace의 session은 보고할 실패 분기와 이름을 설계에 적고 그 자리에 `reportProblem`을 둔다. 그 호출은 앱 log에 error 한 줄을 쓰고, session이 `app.logs`로 읽는다.
- A17. 앱의 source 폴더를 잇거나 앱이 만든 package를 publish하는 것은 그 앱 workspace의 session만 한다. 다른 앱의 것은 자격이 막는다. publish한 앱이 그 package의 주인이 된다.
- A20. 자기 앱이 쓰는 package에서 난 문제는, 앱 workspace의 session이 고치지 않고 package 주인 앱(`package.get`의 `owner_app`) workspace의 lophn에게 답을 받지 않는 call로 맡긴다.
- A21. 공개 command는 다른 앱·project가 기대는 약속이다. 다른 곳이 쓰는 공개 command를 지우는 release는 program이 막지 않고 `release.prepare`의 결과에 그 command를 싣는다. 지우려면 앱 workspace의 session이 activate하기 전에 쓰는 그릇 workspace의 lophn에게 결과를 받는 call로 알린다. 쓰는 쪽이 옮길 수 없다고 하면 tool을 되살린다. 사람에게는 묻지 않는다(F2).
- A22. 앱 화면이 agent에게 일을 시켜야 하면(사람이 쓴 것 검토, 결과 설명), 앱 workspace의 session은 그 앱 범위의 전용 agent(`runtime: custom`)를 만들고 화면 code에서 `@lophn/agent`로 그 agent의 앱 workspace session에 보낸다. 내장 lophn은 쓰지 않는다. 화면의 context는 `contextBlock`으로 싸고, 값이 필요하면 답 꼴(`reply`)을 붙이고 꼴에 맞지 않는 답의 화면(다시 보내기)을 둔다. agent에게 닿으려고 operation이나 command를 더하지 않는다. 그 session은 그 앱을 쓰는 사람의 session이라 sidebar에 보이고 승인은 채팅 탭에서 한다. (제안)

### project

C7~C9는 용어와 그릇 밖의 일, C24 이후는 그릇의 skill과 artifact, 경계를 넘는 일, workflow 정의(C29)다. 앱의 일은 앱 workspace의 session이 맡는다. 지침은 `packages/core/agent-workspaces/prompts/project.md`다.

- C7. 용어의 뜻이 필요하면, session은 정하지 않고 사람에게 묻는다. 답이 없으면 그 변경을 하지 않는다.
- C8. 새 project나 앱이 필요하다고 판단하거나 그릇 경계를 넘는 재사용이나 기획을 판단해야 하면, project workspace의 session은 home의 lophn에게 답을 받지 않는 call로 맡긴다. (제안)
- C10. 사람이나 agent가 앱을 만들거나 고쳐 달라고 하면, project workspace의 session은 직접 하지 않고 그 앱 workspace의 lophn에게 call로 맡긴다. 새 앱이면 home의 lophn에게 맡긴다.
- C24. project의 일에 절차가 필요하면, project workspace의 session이 그 project의 skill(`<data>/projects/<prj>/skills/`)을 쓰거나 고친다.
- C25. 다른 앱의 공개 command를 어떤 agent가 쓰게 하려면, session은 사람에게 할당을 청한다. 할당은 grant라 사람이 한다(F3). 청할 때는 그 agent가 무엇을 할 수 있게 되는지 domain 말로 말한다. (제안)
- C26. 그 project가 쓰는 package에서 난 문제는, project workspace의 session이 package 주인 앱 workspace의 lophn에게 답을 받지 않는 call로 맡긴다.
- C27. 그 project가 쓰는 공개 command가 바뀌었다고 알림이 오면, project workspace의 session이 바뀐 command를 읽고 그 command를 부르는 skill을 다시 본다.
- C28. agent가 쓴 결과 문서가 필요하면, 그 그릇 workspace의 session이 그릇의 artifact를 쓴다. node 그림(상태 흐름 같은 것)을 둘지와 모양은 session이 정한다(F5). workflow 그림(C29)과 같다.
- C29. 사람이 workflow를 청하거나 project의 일이 여러 참가자가 step을 넘기며 도는 모양이면, project workspace의 session이 그 project의 `workflows/<name>/`에 선언(`workflow.yaml`)과 `workflow.md`를 쓰거나 고친다. artifact(step 그림, instance 상태)를 둘지는 session이 정한다(F5). workflow 정의를 쓰는 것은 그 project workspace의 session뿐이다(`architecture/workflow.md`). 결정적인 처리가 필요한 workflow는 `kind: flow`로 두고 같은 폴더에 code(`flow.ts`)를 쓴다. 쓴 뒤 `workflow.check`로 type check한다. flow가 부를 앱 tool은 `workflow.yaml`의 `agent`(없으면 lophn)에게 할당한 공개 command만 되므로, 그 앱이 할당에 없으면 사람에게 할당을 청한다(F3).
- C30. project가 다른 기계에서도 같은 project여야 하면, session이 `lophn project share`로 저장소 안 id file을 만들고 그 file의 commit은 session이나 사람이 한다(lophn은 git 쓰기를 하지 않는다). 이 기계에 없는 project가 필요하면 `lophn project clone`으로 받는다. 처음이면 project를 둘 폴더를 사람에게 한 번 묻는다. git 자격이 없다는 실패가 오면 돌려받은 명령을 사람에게 알린다. 나누기([Separate project])는 사람만 한다(`architecture/project-identity.md`).

### workflow 참가자

W1~W6은 어느 workspace든 workflow instance의 step을 받은 session의 규칙이다. lophn은 말한 대로 기록하고 전할 뿐 순서, 결과, 고칠 자격을 판정하지 않는다. 참가자는 `{agent, workspace?}`(workspace가 없으면 instance의 project), `human`(`with`), `harness`다.

- W1. step 메시지(`<lophn-step>`)를 받으면, 받은 session은 그 step의 prompt대로 일하고 `workflow.report`로 어떻게 됐는지 글과 다음 step(`next`, 후보 가운데 하나나 `end`)을 낸다. `next`가 없는 report는 진행 글이라 아무에게도 넘어가지 않는다. 긴 결과는 file에 두고 경로를 쓴다.
- W2. step 메시지 하나가 그 session이 workflow에 대해 받는 전부다(그 step의 prompt, 받은 것, 낼 것, 다음 후보). `workflow.md`, 다른 step, 다른 참가자는 모른다. 더 알아야 하면 그 step의 prompt가 무엇을 읽으라고 말한다.
- W3. 예외가 생기면, 참가자가 `workflow.edit`로 instance를 고친다(step 더하기·고치기·지우기, 끝, 지금 넘기기). 누가 고칠지는 workflow가 정한다(coordinator 참가자를 둘 수 있다). 누가 고쳤는지 줄로 남는다.
- W4. step 메시지가 연 turn은 사람이 없는 turn(unattended)이다. 받은 session은 그래도 자기 할당으로만 일한다(T5, T6).
- W5. lophn이 다시 켜져 넘긴 step이 `lophn_restarted`로 남았으면, 참가자나 사람이 확인하고 필요하면 `hand_now`로 다시 넘긴다. lophn은 다시 넣지 않는다.
- W6. flow workflow는 참가자 대신 code(`flow.ts`)가 step을 돈다. flow가 agent를 부르면 그것은 step 메시지가 아니라 run이다(R8). 받은 session은 report를 내지 않고 답을 남긴다. report는 code가 낸다. lophn이 다시 켜지면 도는 flow는 다시 띄우지 않고 끝난 것으로 닫는다.

### job

J1~J6은 정해진 때 도는 일(job)을 만들고 job이 agent를 부를 때의 규칙이다. job은 주기와 할 일 하나(agent 호출, 앱 tool 호출, workflow instance 시작)와 놓친 차례 정책이다(`architecture/job.md`).

- J1. 사람이 정해진 때 도는 일을 청하면, 그 일을 맡은 session이 `job.create`로 job을 만든다. 세 workspace 종류 모두 job tool을 받는다. 사람은 job을 직접 만들지 못하고 agent에게 청한다. 만든 job은 사람이 대기 목록에서 등록을 한 번 승인해야 돈다(F3, `architecture/job.md`).
- J2. job을 만든 쪽은 그 session의 (agent, workspace)다. agent는 같은 agent, 같은 workspace가 만든 job만 `job.update`, `job.delete`, `job.list`로 다룬다. 남이 만든 job은 보이지도 않고 고치지 못한다. 사람은 모든 job을 화면에서 고치고 끄고 지운다.
- J3. job의 차례가 오면 program이 job에 적힌 agent를 그 workspace에서 부른다. 부를 때마다 새 session이고 사람이 없는 turn(unattended)이다. 받은 session은 그래도 자기 할당으로만 일한다(T5, T6). 답과 실패는 그 run에 남는다.
- J4. job이 앱 tool을 부르는 차례는 그 job을 만든 agent의 지금 할당 안에서만 된다. 밖이면 막히고 그 차례는 실패로 남는다.
- J5. job이 부른 session도 job tool을 받아 job을 만들 수 있다. 막지 않는다. 사람이 모든 job을 화면에서 본다.
- J6. job의 차례가 실패해도 자동으로 다시 하지 않는다. 다시 하는 것은 사람이 정한다.
- J7. job은 만든 기계에서만 돈다. 다른 기계의 job(복사한 data root에서 온 것)은 멈춘 채 보이고, 이 기계로 옮기는 것은 사람의 [Run on this computer]뿐이다. agent는 job을 기계 사이로 옮기지 않는다(`architecture/job.md` "주인 기계").

### 사람

- H1. 사람은 무엇을 만들고 무엇을 원하는지 agent에게 이야기한다.
- H2. 앱을 처음 activation하거나 새 release가 선언을 넓히면, 사람이 앱 grant를 허락한다.
- H3. 사람이 agent에게 앱을 할당하고, 그 앱에서 뺄 tool을 고른다. 할당한 tool은 실행 때 묻지 않는다(할당이 허락이다). 설치되고 켜진 shell extension이 내는 tool도 정의의 `extensions`로 할당한 agent에게만 실리고, 할당이 허락이라 묻지 않는다. 외부 MCP server는 설정한 곳(전역, Home·project·앱 중 session의 workspace, 그 agent의 정의)이 할당이고 정의에서 끈다. 전역과 workspace 층에서 끈 server는 도는 turn에서도 다음 호출부터 막힌다. 다른 앱의 command는 공개(`public`) command만 쓸 수 있다(비공개는 그 앱 workspace의 session만, P12).
- H4. agent가 shell 규칙이 `ask`인 명령을 돌리려 하면, 사람이 toast나 모든 session의 대기 목록, 대화의 카드에서 한 번 허락, 항상 허락(규칙 줄을 더한다), 거절로 답한다. 거절하며 적은 이유는 agent에게 그대로 간다. 사람이 없는 실행(unattended)과 사람이 skip을 켠 session은 묻지 않지만, deny 규칙은 어느 경우에도 막는다. 팀으로 spawn된 session(skip 꺼짐)의 승인은 사람이 아니라 부모가 `lophn call reply --allow | --reject`로 답한다.
- H5. 앱 workspace의 session이 앱에서 달라진 것을 알리면, 사람이 받아 써 본다. 확인 근거(앱 test, preview, release 준비, activation)는 사람이 물을 때 본다.
- H7. 사람은 workflow instance를 시작하고 멈춘다(화면, CLI). 정해진 때 시작하게 하려면 job을 agent에게 청한다(J1). 시작이 그 사슬을 agent에게 맡기는 것이다. 멈춘 instance에는 더 넘기지 않는다.
- H8. 사람 step이 오면, 사람은 `with` 참가자 agent의 session에서 그 agent와 논의하고 결과는 그 agent가 report한다. 사람은 승인 단추가 아니라 참가자다. 순서를 바꾸고 싶으면 그 agent에게 말한다.
- H9. 사람은 Jobs 탭과 왼쪽 sidebar의 Jobs overlay(모든 job)와 project 창 오른쪽 sidebar의 Jobs panel(그 project와 걸린 job)에서 job을 보고 켜고 끄고 고치고 지운다. 놓친 차례를 `hold`로 둔 job은 대기 목록의 card에서 [Start now]나 [Skip]을 고른다. lophn이 꺼진 사이 놓친 차례와, 켜진 채라도 컴퓨터가 잠들어 차례 시각보다 10분 넘게 늦은 차례가 놓친 차례다.
- H10. 앱이 선언한 secret은 사람이 앱 Access 탭에서 넣는다. OAuth secret이면 사람이 그 서비스에 만든 client의 id와 secret을 넣고 [Sign in]한다. agent는 값을 대화로 묻지 않고 무엇을 넣을지 알린다. sign-in이 끊기면 앱이 다시 sign-in하라고 알린다.
- H11. 사람은 Agents 탭에서 agent를 만들고 고치고 지운다. Agents 탭은 Home, project, 앱 어디서나 열린다. 목록은 그 workspace의 lophn(첫 줄)과 전역 agent, 그 workspace 범위 agent다. 새 agent의 범위는 만들 때 고르고(기본은 화면을 연 workspace) 뒤에 바꾸지 못한다. lophn은 handle과 profile이 잠기고 name만 바꾸며 지우기가 없다. Settings › Agents에는 lophn이 없다. 탭은 그 workspace의 층(지침, workspace memory, model, skill 켜고 끄기, MCP server)도 보이고 고친다.

## 3. 넘기는 길

- R1. call: agent가 다른 session에 일을 맡기는 것은 모두 call이다. 보내는 쪽이 받는 곳(새 session, 열린 session, 열린 session이 없으면 새 session)과 답 방식을 고른다.
- R2. 답 방식은 셋이다: 답을 받지 않음(none), 결과 하나를 받음(result), 대화로 주고받음(conversation). 답을 받지 않는 call을 화면에서는 handoff라 부르고, 사람은 그 블록의 [Open conversation]으로 받은 session에 가서 일을 잇는다. 결과를 받던 escalate는 결과를 받는 call이다.
- R4. 사람에게 올림(escalate): 사람의 결정이나 취향이 필요하면 session에서 사람에게 묻는다. 이것은 call도 동작 허락(approval)도 아니다. escalate라는 말은 이것에만 쓴다. 팀으로 spawn된 session의 `ask`는 사람이 아니라 부모에게 가는 call이고, 부모가 판단할 수 없으면 자기 `ask`로 위에 올려 root에서 사람에게 닿는다.
- R6. step 메시지: 사람이 시작한 workflow instance에서 참가자의 report나 고치기가 말한 step의 담당에게 program이 넣는 입력이다. call이 아니다(call 행과 답 방식이 없다). 답 대신 report를 낸다(W1).
- R7. job의 run: job의 차례마다 program이 연 run의 입력이다. 받는 agent와 workspace는 job에 적힌 것이고 call이 아니다(call 행과 답 방식이 없다). 입력은 사람이 없는 입력(unattended)이고 `<lophn-run>`으로 감싸 보낸 쪽(job)을 밝힌다. 답은 turn의 마지막 응답이고 run 기록에 남는다(J3).
- R8. flow의 run: flow code가 `agent(...)`로 연 run의 입력이다. 받는 agent는 code가 고른 누구든 되고(workspace가 없으면 instance의 project) call이 아니다. 입력은 unattended이고 `<lophn-run>`으로 감싸 보낸 쪽(flow instance)을 밝힌다. 받은 session은 자기 할당으로만 일한다(T5, T6). 답은 run 기록에 남고 code가 받는다.

## 4. 넘길 때의 규칙

- T1. 넘기는 것은 모두 Router 한 입구로 받는 session에 입력을 넣는 것이고, 입력에는 call 봉투(보낸 쪽, 받는 곳, 답 방식, 어느 call에 대한 답인지)가 붙는다.
- T2. 누구에게 넘길지는 보내는 session이 판단한다.
- T3. 넘기는 것은 묻지도 막지도 않는다. 누구에게 넘길지는 지침과 workflow가 정한다.
- T4. 사람이 없는 turn(unattended)이 보낸 call로 열린 turn은 unattended이고, 그 답과 실패·취소 알림도 따라간다. 사람이 있는 turn이 보낸 call은 사람이 있는 turn(attended)으로 열린다. skip은 call을 따라 가지 않는다.
- T5. 부르는 것 자체에는 묻지 않고, 받은 session의 동작은 받은 agent의 할당으로 다시 걸러진다.
- T6. 보낸 agent의 할당과 skip은 받은 쪽에 넘어가지 않는다.
- T7. 받는 곳은 보내는 쪽이 고르고, 열린 session으로 보냈는데 닫혀 있으면 새로 열지 않는다. "열린 session, 없으면 새 session"은 놓치면 안 되는 것에만 쓴다.
- T8. 받는 workspace는 보낸 쪽이 있는 workspace가 아니라 넘기는 일이 어느 그릇(project나 app)에 관한 것인지로 정하고, 보내는 session이 그것을 함께 적는다. 경우는 5.2다.
- T9. 받을 agent나 workspace가 없거나 받는 session이 닫혀 있으면, 이유와 함께 실패가 보낸 session에 돌아온다. 답을 받지 않는 call도 배달 실패는 돌아온다.
- T10. 넘기는 내용은 맡긴 글 하나와 근거 링크(annotation, 파일 경로, 보낸 session)이고, 보낸 쪽의 대화 원문은 복사하지 않는다.
- T11. 결과를 받는 call을 받은 session은 일이 끝나면 답을 보낸다. 맡지 않을 때도 답으로 이유를 보낸다. lophn agent session은 저절로 끝나지 않아 program이 끝을 알 수 없기 때문이다.
- T12. 보낸 session은 call을 보낸 뒤 기다리며 막히지 않고, 답은 새 입력으로 받는다.
- T13. 보낸 session이 archive되었거나 지워졌으면, 결과는 받은 session에만 남는다.
- T14. call로 들어온 입력은 대화에 보낸 쪽과 함께 보이고, 누르면 맡긴 글, 근거, 보낸 session을 본다. 보낸 session에는 보낸 call이 대화에 남고 답은 그 call에 이어진 메시지로 들어오며, 누르면 그때의 상태를 본다.
- T15. 같은 요청을 다시 보내도 call과 받는 session은 하나만 생긴다.
- T16. session끼리 서로 계속 넘기는 것은 막지 않고, 사람이 화면에서 보고 멈춘다. (approval 이야기)
- T17. 결과를 받는 call의 받은 session이 결과 없이 끝나면(archive, 지움), 보낸 session에 실패가 들어온다.
- T18. 보낸 쪽이나 사람은 끝나지 않은 call을 취소할 수 있고, 취소한 call에 뒤늦게 온 답은 닫힘으로 돌아간다.
- T19. 거절당한 일을 다른 agent에게 돌려 시키지 않는다. 이것은 agent 지침의 규칙이고 program이 막지는 않는다.

## 5. 호출 관계

### 5.1 그림

```
사람 ──────────부름──────▶ home의 session     : 원하는 것을 말할 때, 사용법이나 앱 상태를 물을 때
     ──────────부름──────▶ project workspace의 session : skill이나 workflow를 청할 때, 그 project의 일을 시킬 때
     ──────────부름──────▶ app workspace의 session : 앱을 만들거나 고쳐 달라고 할 때, 앱 화면 annotation을 보낼 때

home ─────call(none)────▶ lophn `app          : 기획이 앱을 만들거나 고치는 일로 정해졌을 때
     ───call(result)────▶ lophn `project      : 기획에 자료 묶음이나 검색이 필요할 때

app ──────call(none)────▶ lophn `home         : 앱 밖 재사용이나 그릇 경계를 넘는 기획을 판단해야 할 때
    ──────call(none)────▶ lophn `다른 app      : package 문제를 package 주인 앱에 넘길 때
    ────call(result)────▶ lophn `project      : 앱이 읽을 자료 묶음이 필요할 때
    ───결과─────────────▶ 사람                : release를 올렸을 때(앱에서 달라진 것), 허락이 필요할 때

project ──call(none)────▶ lophn `app          : 앱 일일 때(package 문제를 package 주인 앱에 넘길 때 포함)
        ──call(none)────▶ lophn `home         : 새 project나 앱이 필요하거나 그릇 경계를 넘는 판단이 필요할 때

program ──────알림──────▶ 사람                : 앱의 반복 종료(toast), activation 동의(첫 activation, 넓어진 선언, data 손실), shell 물음(toast)
workflow ──step 메시지──▶ 참가자 session       : 사람의 시작, report의 next, 고치기의 지금 넘기기가 그 step을 말했을 때
job ──────────run───────▶ job에 적힌 agent `workspace : 정해진 때 (사람이 청한 job의 차례, 새 session, unattended). 앱 tool 호출이나 workflow instance 시작도 한다
flow ─────────run───────▶ code가 고른 agent `workspace : flow instance의 code가 agent(...)를 부를 때 (새 session, unattended). 앱 tool 호출과 report도 한다
참가자 session ─report·고치기─▶ workflow          : step을 끝냈거나 진행을 알리거나 예외를 다룰 때

call(result) 받은 쪽 ──답──▶ 보낸 쪽          : 맡은 일을 끝냈을 때, 맡지 않을 때
어느 session이든 ─묻기(escalate)─▶ 사람        : 사람의 결정이나 취향이 필요할 때
```

- 위 선은 대표적인 것이다. session 사이에서는 어느 방향으로든 넘길 수 있다. 받는 쪽은 그 workspace의 lophn이 기본이고, 사람이 만든 agent도 이름으로 받을 수 있다.
- coding agent에게 가는 선은 없다. 앱 workspace의 session이 앱을 직접 짓는다.
- program은 스스로 정해 agent를 부르지 않는다. 정해진 때 job이 agent를 부르는 것은 사람이 시킨 일이다(E10). flow가 agent를 부르는 것은 project workspace의 session이 쓴 code를 사람이나 job이 시작한 것이다(E11). activation 실패는 `release.activate`의 결과로 돌아간다. workflow의 step 메시지는 사람과 참가자가 말한 대로 전하는 것이다(E9).

### 5.2 받는 쪽 고르기

call의 `to`는 `{session}`이나 `{agent, workspace?}`(+ 열린 session이 닫혔을 때 열 `fallback`)다. `agent`는 agent handle이고 workspace가 없으면 home이다. handle `lophn`은 (handle, workspace) 짝으로 그 workspace의 lophn을 가리킨다. Router는 적힌 handle과 workspace가 정확히 맞는 것만 고르고 짐작하지 않는다(`architecture/agent-call.md`).

- 받는 workspace는 일이 관한 그릇이다: 앱 일은 그 앱(`{app: "<앱 이름>"}`), project 일은 그 project(`{project: "<project 이름>"}`), 그릇을 넘는 기획과 새 앱·project 등록은 home(workspace 없음)이다.
- 받는 agent는 기본이 lophn이다. lophn은 늘 있는 agent라 받을 agent가 없어 실패하는 일이 없다. 사람이 만든 agent에게 맡기려면 그 이름을 적는다.
- 그릇 일(skill, package 문제, 공개 command 바뀜 알림)과 마지막으로 쓴 session이 없는 artifact annotation은 그 그릇 workspace의 lophn session이 받는다.
- 앱 화면 annotation은 앱 title bar agent select가 고른 agent의 그 앱 workspace session이 받는다. project 파일에 단 annotation은 그 project workspace의 lophn session이 받는다.
- workflow 참가자와 flow의 `agent(...)`는 workspace가 없으면 instance의 project다.
- 고른 agent나 workspace가 없으면 넘기기가 막히고 이유가 돌아온다(T9).
- 새 앱은 home의 session이 먼저 등록하고, 그 앱 workspace의 lophn에게 맡긴다.

## 6. program이 agent를 부르거나 사람에게 알리는 때

program은 스스로 정해 agent를 부르지 않는다. 앱 오류는 사람에게 toast로 알리고(E2), activation 실패는 `release.activate`를 부른 session에 결과로 돌아간다(E3). agent는 앱 상태와 앱 log로 지금 상태를 직접 읽는다. 정기적으로 앱을 살피게 하고 싶으면 사람이 시킨다. 정해진 때 job이 agent를 부르는 것은 예외가 아니라 사람이 시킨 일의 실행이다(E10).

- E2. 앱이 거듭 죽어 자동 재시작을 멈추면, program이 사람에게 toast로 알린다. agent는 부르지 않는다. 앱 workspace의 session은 사람이 청하면 `app.status`와 `app.logs`(`process_exit crash_loop` 줄)로 읽는다.
- E3. activation이 실패하면, program이 실패 기록을 남기고 `release.activate`의 결과로 돌려준다. 동의 뒤에 시작한 시도의 결과는 사람이 화면에서 본다. session을 부르지 않는다.
- E6. 앱 workspace의 session이 `release.activate`한 release가 첫 activation이거나 선언이 넓어졌거나 data 손실 가능성이 있으면, program이 activation 동의를 대기 목록에 올린다. 사람이 동의해야 activation이 이어진다.
- E8. 다른 곳이 쓰는 공개 command를 지운 release는 program이 막지 않는다. `release.prepare`의 결과에 그 command를 싣는다.
- E9. workflow instance에서 사람의 시작, 참가자의 report `next`, 고치기의 `hand_now`가 step을 말하면, program이 그 step의 담당(사람 step이면 `with` agent)에게 step 메시지를 넣는다. 담당을 풀 수 없으면 넣지 않고 그 사실을 instance의 줄로 남긴다. 무엇을 넘길지 program이 정하지 않는다.
- E10. 사람이 등록을 승인한 job의 차례가 오면, program이 job에 적힌 일을 한다: agent를 run으로 부르거나, 만든 agent의 할당 안에서 앱 tool을 부르거나, workflow instance를 시작한다. 이것은 사람이 agent에게 시킨 일(J1)의 실행이고 program이 스스로 정한 반응이 아니다. lophn이 꺼진 사이나 컴퓨터가 잠든 사이 놓친 차례(차례 시각보다 10분 넘게 늦은 차례)를 `hold`로 둔 job은 program이 대기 목록에 card를 올리고 사람이 [Start now]나 [Skip]을 고른다. 자동 재시도는 없다.
- E11. 사람이나 job이 flow instance를 시작하면, program이 그 workflow 폴더의 `flow.ts`를 process 하나로 띄우고 code의 요청(agent run, 앱 tool 호출, report)을 그대로 한다. 앱 tool은 `workflow.yaml`의 `agent`(없으면 lophn)의 할당 안에서만 된다. code가 끝나면 끝 code와 stderr 끝 줄을 남기고 instance를 닫는다. 성공인지 판정하지 않고 다시 띄우지 않는다.

## 7. 하지 않는 것

- 사람에게 software 공학의 결정을 묻거나 raw data로 보고하기(F2, F4).
- agent가 다른 agent를 자식(subagent)으로 띄워 결과를 기다리는 구조를 두지 않는다. 넘기는 것은 늘 다른 session이다.
- 누가 누구를 부를 수 있는지를 고정 표로 두지 않는다. program은 기본으로 부르기를 막지 않고, 사람이 private workspace와 workspace 쌍·agent 쌍 call 정책으로 좁힌다. 다만 `team spawn`으로 열린 팀원의 call은 부모·형제·자기 자손으로만 간다. 누구를 부를지는 지침이 정한다.
- 보낸 쪽의 대화를 복사하거나 권한을 물려주지 않는다.
- 보낸 쪽이 결과를 기다리며 막히는 동기 호출, 자동 재시도, 실패를 조용히 버리기.
- agent 정의의 권한 칸(짓기 가능). 차이는 session의 workspace 종류와 정의의 skills_off, 할당이 만든다.
- role. agent는 lophn과 사람이 만든 agent이고, 하는 일은 session의 workspace 종류가 정한다.


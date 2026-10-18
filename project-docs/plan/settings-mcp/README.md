# settings-mcp: 설정 화면을 고치고 반쯤 만든 MCP 길을 정리한다

- 목표:
  - 설정 화면에서 provider 연결과 기본 model 바꾸기가 다시 되게 한다. renderer가 command 봉투를 만드는 helper를 하나로 모은다.
  - 반쯤 만든 MCP 길 둘을 정리한다. 설정 통로의 죽은 MCP 함수는 지우고, Operator 정의의 MCP server 층은 살려 runtime이 쓰게 한다.
  - 보낸 chip이 대화에 남게 한다.
- 재료:
  - `project-docs/issues/shell.md`
    - "설정 화면의 command가 compare를 빼서 provider 연결과 기본 model 바꾸기가 모두 거절된다"
    - "일반 설정 통로의 MCP 함수를 화면이 부르지 않는다"
    - "보낸 chip이 대화에 남지 않고 다시 보내기가 chip을 빼고 보낸다"
  - `project-docs/issues/agent-definition.md`: "agent 정의의 MCP server 층이 type과 정의 file에만 있다"
  - `project-docs/architecture/agent-definition.md`, `project-docs/architecture/approval.md`
- 범위 밖:
  - ChatGPT 계정 model 목록. 계획 `chatgpt-subscription`이 한다.
  - 새 화면. wireframe을 바꾸지 않는다.
- 돌리는 방식: **worker를 쓰지 않는다.** lead가 lead worktree에서 task를 차례로 직접 고친다. 일마다 작고, renderer file이 서로 겹치기 때문이다(봉투 helper가 conversation과 settings의 11곳을 고치고, chip도 conversation을 고친다). 사람이 정한 대로, 패치가 좁은 계획은 lead 혼자 한다. orchestrate skill의 "lead는 기능 코드를 직접 짜지 않는다"는 이 계획에 적용하지 않는다.
- 단위: `tasks/*.md`의 "단위"가 정한다. task id는 `sm-`로 시작한다.
- 순서: 봉투 helper가 먼저다. 지금 사람이 화면에서 provider를 하나도 붙이지 못하기 때문이다. 나머지는 그 뒤에 소유가 겹치지 않는 차례로 한다.
- 시작 조건: 없음.

## 정한 것

- 봉투: 대화의 `CommandBody`처럼 protocol route를 받아 input과 compare type을 route에서 꺼내는 helper 하나를 renderer에 둔다. 손으로 짠 봉투 11곳이 모두 그것만 쓴다. guard는 그 helper가 만든 봉투가 `commandRequestSchema`를 통과하는지 보는 test 하나다. process를 띄우지 않는다(이슈의 정한 것).
- 설정 통로의 MCP 함수와 그것만 쓰는 type, 구현, fake를 지운다(이슈의 정한 것).
- Operator 정의의 `mcp_servers` 층을 살린다(사람: Operator에게도 자기 MCP server가 필요하다).
  - runtime이 turn 준비 때 그 층을 읽는다(`loadMcp`가 agent를 넘기고 `serversOf`의 agent 층을 쓴다).
  - runtime의 Deno 권한(`mcp-snapshot`)과 Grants 목록(`agent-mcp-tools/list`)이 그 층을 안다.
  - 정의가 바뀌면 runtime child를 다시 띄운다.
  - server를 넣는 길은 사람의 Operator 편집 화면뿐이다. agent의 `operator.create`·`operator.update`는 실행 명령을 정하는 입력이라 계속 받지 않는다.
  - 권한과 승인은 project 층의 server와 같은 규칙을 쓴다. 새 규칙을 만들지 않는다.
- chip: `attachedFields`에 optional `context`를 더하고, `sendText`가 chip마다 `attached` part를 본문에 쓴다. `retryTurn`은 본문의 `attached` part로 `SendMessage.attached`를 다시 만든다(이슈의 정한 것).

## 사람이 정할 것

없음.

## lead가 할 일

- task마다 `deno task check`. 끝내기 전에 `deno task check:full`과 renderer build(`deno run -A packages/shell/renderer/build.ts`)를 돌린다. check:full은 renderer build를 보지 않는다.
- 봉투 task가 끝나면 손으로 확인한다. `deno task dev`(fake provider)로 설정 화면을 열어 custom provider 연결과 기본 model 바꾸기가 되는지 본다. 진짜 provider key는 쓰지 않는다.
- 끝나면 다음을 한다.
  - 닫은 이슈 넷을 `project-docs/issues/archived/`로 옮긴다.
  - `project-docs/products/change-log/0.3.0.md`에 항목 하나를 덧붙인다.
  - `project-docs/architecture/agent-definition.md`에서 MCP 층 설명을 맞춘다.
  - `land.sh`로 main에 올린다.

# agent-definition

agent 정의와 turn 조립(지침, tool, skill, place 정보, cache)에 걸린 열린 이슈. 흐름과 불변 조건은 `project-docs/architecture/agent-definition.md`.

## 파일 읽기가 pdf와 이미지 말고 docx 같은 형식을 못 읽는다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: `packages/core/lophn-agent/tools/file/read.ts`는 UTF-8 텍스트만 읽고, 아니면 pdf/이미지는 각 tool을 안내하고 나머지는 `not a UTF-8 text file`로 거절한다. pdf는 `packages/core/lophn-agent/tools/file/pdf.ts`(`unpdf`), 이미지는 `packages/core/lophn-agent/tools/file/image.ts`뿐이다. docx, xlsx 등의 reader는 없다.

영향: 사람이 place 폴더에 둔 docx 문서를 agent가 읽지 못한다. 사람이 텍스트로 바꿔 줘야 한다.

고치려면: 필요한 형식마다 reader를 더한다(`unpdf`처럼 의존성 하나를 판 고정으로 들이고 쓸 때만 불러온다). 형식을 하나씩 늘리는 것은 비용이 작지만 의존성이 는다. 추천: 쓰는 형식(docx)부터 하나만.

정한 것: 필요해지는 형식 하나씩만 더한다.

## agent 정의의 MCP server 층이 type과 정의 file에만 있다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/agent-roles, packages/protocol, packages/shell/renderer]
```

지금: Operator 정의의 `mcp_servers`가 protocol(`packages/protocol/lophn-agent/operators.ts`의 `operatorDefinitionSchema`), 정의 file 키, renderer type(`packages/shell/renderer/workspace/agents/source.ts`)에 있다. `packages/core/lophn-agent/extensions/mcp-toolkit.ts`의 `serversOf(place, agent)`도 agent 층을 겹친다. 그러나 붙이는 길이 없다. 화면의 draft(`packages/shell/renderer/workspace/agents/core-source.ts`)는 `mcp_off`만 보내고, 화면 목록(같은 폴더 `core-extensions.ts`)은 전역과 project 층만 그리고, `packages/core/agent-roles/tools/operator.ts`는 실행 파일을 정하는 입력이라 `mcp_servers`를 일부러 받지 않는다. 쓰는 쪽도 없다. turn 준비(`run-loop/prepare.ts`의 `loadMcp`)는 `agent`를 넘기지 않고 runtime의 Deno 권한(`extensions/mcp-snapshot.ts`)과 Grants 목록(`agent-mcp-tools/list`)도 이 층을 모른다.

영향: 사람이 정의 file을 손으로 고쳐 서버를 넣으면 그 서버는 조용히 안 쓰인다. 화면과 tool로는 넣을 수 없다. Operator마다 MCP server를 다르게 주는 기능은 지금 없다.

고치려면:
- 살린다(중간): resolved agent에 `mcp_servers`를 싣고 `loadMcp`가 넘긴다. Deno `--allow-net`·`--allow-run`에 정의 층을 더하고 정의가 바뀌면 child를 다시 띄운다. 화면 입력을 열고, 실행 파일을 정하는 입력이라 승인 경계를 다시 정한다.
- 지운다(작음): protocol 칸, 정의 file 키, `serversOf`의 agent 층, renderer type을 지운다. 잃는 것은 지금도 못 쓰는 Operator별 MCP다.
- 추천: 지운다. 필요해지면 그때 화면·승인과 같이 짠다.

정할 것: Operator별 MCP server를 제품 기능으로 살릴지 지울지.

## Project Manager 지침이 경계와 계약 위반 판단을 정하라고도 하고 물으라고도 한다

```yaml
kind: bug
modules: [packages/core/agent-roles]
```

지금:
- `packages/core/agent-roles/roles/project-manager/prompt.md`의 "What you do"는 두 가지를 PM의 일로 쓴다.
  - "When a person or an agent asks for a context, draw the boundary first."
  - 계약 위반 때 "decide whether the contract should change or the document is wrong."
- 같은 file의 "What you do not do"는 반대로 말한다: "Do not decide what only the person can decide: a boundary, what a term means, whether the contract or the document should change. Ask with `ask`…"
- `project-docs/products/AGENT-ROLE.md`의 C2는 PM이 경계를 긋는다고 하고, C6은 PM이 정한다고 한다(정하는 내용은 제안).

영향:
- context 요청이나 계약 위반 reaction(AGENT-ROLE E5)을 받은 PM은 같은 지침에서 "정하라"와 "정하지 말고 물어라"를 같이 받는다.
- 어느 쪽을 따르느냐에 따라, 사람에게 묻지 않고 계약을 바꾸거나, 위반마다 사람의 답을 기다리며 아무것도 submit하지 않는다.
- 사람은 PM이 어떻게 굴지 알 수 없다.

고치려면:
- PM이 정한다(작음): "What you do not do"에서 경계와 계약·문서 판단을 빼고, 용어의 뜻만 남긴다. 무엇을 왜 정했는지는 대답에 남긴다. AGENT-ROLE C2·C6과 맞는다.
- 사람에게 묻는다(작음): "What you do"를 "안을 만들고 `ask`로 묻는다"로 바꾸고, AGENT-ROLE C2·C6을 고친다. 위반과 경계마다 사람의 답을 기다린다.
- 추천: PM이 정한다. 통과한 초안은 사람 승인 없이 적용한다는 C3과 같은 쪽이다.

정한 것: PM이 정한다(사람). "What you do not do"에는 용어의 뜻만 남기고, 경계와 계약·문서 판단은 PM이 정해 이유를 대답에 남긴다.

## role 지침 세 곳이 코드에 없는 것을 말한다

```yaml
kind: bug
modules: [packages/core/agent-roles]
```

지금:
- lophn을 다른 agent에게 소개하는 줄이 project도 등록한다고 한다.
  - `packages/core/agent-roles/place/place-data.ts`의 `ROLE_LINE.lophn`: "Plans work, registers projects and apps, and hands work to others."
  - lophn의 쓰기 tool은 `app.create`뿐이고, project를 등록하는 tool은 없다(`packages/core/agent-roles/tool-lists.ts`).
- App Engineer 지침(`packages/core/agent-roles/roles/app-engineer/prompt.md`)은 ticket의 "acceptance checks"(복수)라고 쓴다. 그런데 `ticket.create`의 `check`는 하나다(`packages/protocol/coding-agent/ticket/values.ts`).
- 같은 지침은 reaction으로 "a repeating problem closed"를 든다. 실제 reaction은 앱이 거듭 죽어 자동 재시작을 멈춘 것이다(`AppRestartHalted`, `packages/core/events/reactor/session-opening.ts`).

영향:
- 다른 agent가 이 줄을 보고 lophn에게 project 등록을 맡기면, lophn은 할 수 없어 일이 돌아온다.
- App Engineer가 check를 여럿 넣으려 하면 `invalid_input`으로 막혀 turn을 쓴다.
- 재시작이 멈춘 reaction을 받은 App Engineer는 지침에서 그 경우를 찾지 못한다.

고치려면: 세 문장을 코드에 맞게 고친다(작음).
- lophn 줄: "Plans work, registers apps, and hands work to others."
- App Engineer 지침: "the acceptance check", "the app stopped restarting after repeated crashes".

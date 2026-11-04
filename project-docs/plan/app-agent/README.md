# app-agent: 앱 화면이 ACP로 agent와 이야기한다 (단계 5)

- 목표: 앱 화면이 SDK `@lophn/agent`로 agent session을 열고, 앱 context를 자기가 정한 꼴로 content block에 담아 보내고, agent 답을 ACP로 받아 자기 식으로 그린다. 예: 코딩 테스트 앱이 attempt와 textarea 코드를 코치 agent에게 보내고, 답을 받아 줄마다 주석을 단다.
- 재료: `project-docs/products/roadmap/agent-platform.md` 단계 5(사람의 원문 2026-11-02 1번, 2026-11-04 "agent도 client는 그냥 빼자"), `project-docs/architecture/acp.md`, `app-call.md`, `annotation.md`.
- 지금: 앱 화면이 lophn에 닿는 것은 `lophnApp`의 넷(operation 호출, 외부 link, 탭 머리 둘)뿐이다. 앱에서 agent로 가는 길도, agent 답이 앱으로 오는 길도 없다(조사 2026-11-04).
- 범위 밖: agent가 앱 화면을 읽거나 조작하기(사람이 뺐다), 앱 안에 lophn 채팅 component 끼우기, annotation 고치기.

## 정한 것

1. 앱이 연 session은 그 앱 place의 보통 lophn session이다. sidebar에 보이고 채팅 탭으로도 열린다. 앱은 자기 place의 session만 열고 읽고 보낸다. (agent)
2. 앱 화면에서 보낸 것은 그 앱을 쓰는 사람의 메시지다. operation처럼 사람 자격으로 간다. 따로 허락 단계를 두지 않는다. (사람, 2026-11-04)
3. 앱과 session 사이는 ACP 그대로다: 여는 것은 `OpenSession`, 읽는 것은 `AcpSnapshot`과 `AcpUpdated`, 보내는 것은 `AcpSend`(send, stop, 질문 답, 승인). 앱 bridge가 이 넷만 그 앱 place로 묶어 넘긴다. (agent)
4. prompt 조립은 앱 code다. SDK는 앱 context를 `resource` block으로 싸는 helper를 준다(이름, mime, 본문). (agent)
5. 꼴이 있는 답(줄 주석 같은)이 필요하면 앱이 보낼 때 답 꼴(JSON schema)을 붙인다. SDK가 그 꼴을 글로 알리는 block을 더하고, agent의 답 글에서 JSON을 꺼내 꼴을 검사해 앱에 넘긴다. 맞지 않으면 오류로 넘긴다. core는 꼴을 모른다. (agent)

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `app-agent-bridge` | `lophnApp`에 session 열기·snapshot·update·보내기, shell main이 그 앱 place로 묶어 core에 넘긴다 |
| 2 | `app-agent-sdk` | `@lophn/agent` package(hook, context helper, 답 꼴), 앱 빌드와 template, design-app skill, wireframe |

## lead가 할 일

- merge마다: `architecture/acp.md`(앱 화면도 ACP 화면이다), `app-call.md`(앱 bridge), `products/AGENT.md`(앱을 짓는 agent가 SDK를 쓰는 규칙이 바뀌면)를 고친다.
- 다 끝나면: `agent-platform.md` 단계 5, change-log 열린 판, 계획 폴더 지우기. 사람에게 sample 앱 하나로 화면을 봐 달라고 한다.

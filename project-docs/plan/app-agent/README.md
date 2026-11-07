# app-agent: 앱 안 agent, agent 주소와 범위, 앱 session lifecycle, webview 살리기

- 목표: builder(앱 workspace의 lophn)가 lophn 구현을 모르는 사람 대신 앱 안 agent를 만들고 SDK로 쓰게 한다. agent를 handle로 부르고 workspace 범위를 두며, 앱이 연 session의 제목·다시 붙기·알림을 앱이 맡고, 떠난 workspace의 page를 필요할 때만 살린다.
- 재료: 오목 앱 점검(2026-11-07 대화). `project-docs/architecture/app-call.md`, `agent-definition.md`, `agent-call.md`, `acp.md`, `workspace-layout.md`, `browser-tab.md`, `artifact.md`. changelog `0.18.0`·`0.19.0`.
- 범위 밖: 앱 workspace의 지침·MCP·model 층(project와 맞추기). 앱 선언에 agent 정의 싣기(범위 있는 agent로 푼다). 앱·project를 지울 때 그 범위 agent 지우기(열 곳이 없어 남아도 쓰이지 않는다). desk float ↔ 전역 float 사이 다시 load.

## 정한 것

1. 앱 view bridge의 `agent.send`는 ACP 입력 `send`, `stop`, `answer`, `rename`만 받고 나머지(`decide`, `rewind`, `fork` …)는 `forbidden`이다. 승인은 사람이 채팅 탭에서만 한다는 경계다(사람, 2026-11-07).
2. `@lophn/agent` 다음 minor: `useAgentSession({agent, title?, session?})`, `rename(title)`, `reset()`. `agent`는 handle이다. `title`은 열 때 session 제목, `session`은 그 앱 workspace의 기존 session에 다시 붙기, `reset()`은 다음 `send`에서 새 session. (사람, 2026-11-07)
3. SDK 설치 사본의 ACP type shim은 `export type *`로 `acp-types.ts`를 다시 내고, `acp-types.ts`는 `reduce.ts`가 쓰는 type(`AcpEntry`, `AcpChildState`, `AcpChildUpdate`)을 모두 낸다. (agent)
4. 앱 화면이 연(또는 다시 붙은) session: turn 끝(완료·실패)은 알리지 않고 못 본 점도 찍지 않는다. 승인·질문은 그 session을 가진 앱 화면이 focus 창에 보이지 않을 때만 알린다. (사람, 2026-11-07)
5. agent 주소는 `handle`이다: 만들 때 정하고 바뀌지 않으며 전역에 하나(대소문자 무시)다. `name`은 보이는 이름이고 바꿀 수 있다. lophn은 handle `lophn` 고정, name은 사람이 바꾼다(profile은 그대로 고정). `agt_` id는 안(저장, 설정, session 행)에만 둔다. call `to.agent`, `agent run --agent`, `agent card|update`, `workflow.yaml`의 `agent`, SDK `agent`가 handle을 쓴다. 옮기기: 기존 정의는 handle = 지금 name. (사람, 2026-11-07)
6. agent 정의에 workspace 범위가 있다. 없으면 전역. `lophn agent create`는 부른 session의 workspace를 범위로 한다(home이면 전역). 범위 agent는 그 workspace에서만 목록·명함·열기·call 대상이 되고, 밖에서는 `{agent, workspace}`로 그 workspace에 여는 call만 call 정책(private 포함)을 거쳐 된다. (사람, 2026-11-07)
7. 앱 범위 agent는 자기 앱의 command(비공개 포함)를 할당 없이 쓴다. bare면 `tools`에서 골라야 보인다. 다른 앱의 command는 지금처럼 사람의 할당이다. (사람, 2026-11-07: "grant까지 agent가 알아서")
8. builder가 낸 `lophn app share` 요청은 그 앱의 activation 동의와 한 번에 승인된다. 동의 화면이 그 요청을 같이 보인다. (사람이 추천을 받음, 2026-11-07)
9. call용 session 목록(`ListSendableSessions`)이 session 제목과 마지막 활동 시각을 싣고, 승인·질문을 기다리는 session은 `waiting`이다. (agent)
10. webview: 떠난 workspace의 page는 기본은 놓고(다시 load), page가 "살려 둬" 신호를 켠 동안은 창 단위 그릇에 숨겨 살린다. 앱 화면은 `@lophn/app-ui`의 `useKeepAlive(active)`, `@lophn/agent`는 turn이 도는 동안 스스로 켠다. browser 탭은 소리 남·다운로드 중이거나 사람이 탭의 "Keep alive"를 켰을 때 살린다. 살린 page는 창마다 최근 6개까지이고 넘치면 오래 안 본 것부터 놓는다. (사람이 추천을 받음, 2026-11-07)
11. builder 안내: `design-app` skill에 "앱 안 agent" 절(bare로 만들기, 지침 쓰기, tool은 필요한 것만, 답 schema, 판마다 session과 제목, 알림, keep-alive), template `AGENTS.md`(판·말·차트 같은 domain 그림은 고정 색 허용), SDK guide. (사람, 2026-11-07: "사용자는 lophn 구현을 모른다")

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | aa-bridge-sdk | 정한 것 1·2·3·4: bridge 허용 목록, `@lophn/agent` lifecycle, vendor shim, 앱 session 알림 |
| 1 | aa-agent-identity | 정한 것 5·6·7·9: handle/name, workspace 범위, 앱 범위 agent의 자기 command, session 목록, `agent card lophn` not_found |
| 1 | aa-webview-keep | 정한 것 10의 shell 쪽과 `useKeepAlive` |
| 1 | aa-stuck-tools | 끝난 turn에 `started`로 남는 tool call 원인과 고침 |
| 2 | aa-share-activation | 정한 것 8 |
| 2 | aa-builder-guide | 정한 것 11, `@lophn/agent`가 turn 동안 keep-alive를 켜기 |

## lead가 할 일

- task마다 worktree를 `plan/app-agent`에서 열고, 끝나면 review하고 이 branch로 merge한다.
- 다 끝나면 changelog `0.19.0`에 항목을 쓰고 이 폴더를 지운 뒤 main에 올린다.

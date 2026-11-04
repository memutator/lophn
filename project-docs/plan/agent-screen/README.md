# agent-screen: agent가 열린 앱 화면의 client가 된다

- 목표: 앱 화면이 `@lophn/agent` SDK로 context와 화면 action을 내놓고, 그 앱 place의 agent가 화면이 열린 동안 `lophn screen context`로 읽고 `lophn screen act`로 부른다(예: textarea의 한 줄에 주석 달기). 대화는 지금의 Agent 탭이다.
- 재료: `project-docs/products/roadmap/agent-platform.md` 단계 5(정한 것 23~25, 겹침 1, 2, 16, 19, 27). 코드 사실과 path는 task brief에 있다.
- 범위 밖: 앱 안 chat component, agent에게 operation 열기, 화면 결과의 image block(화면이 blob hash를 만들 수 없다), annotation과 합치기.

## 정한 것

1. 길은 `lophn` 명령 `screen.context`, `screen.act`이고 app place에서만 열린다(`places:["app"]`). credential의 `conditions.app`이 그 앱이라 그 앱 place의 session만 client가 된다. bare는 `tools`로 고른다. (agent)
2. core는 shell을 부를 수 없으므로 `ask`(`core/lophn-agent/tools/questions/wait.ts`)처럼 core가 대기 요청을 두고 transient event를 내고, shell main이 그 앱의 열린 화면들에 보내고, 답을 shell 내부 route로 돌려준다. 열린 화면이 없거나 10초 안에 답이 없으면 `unavailable`. 답 상한은 24 KiB. (agent)
3. 같은 앱 화면이 여럿 열렸으면 `screen.context`는 화면마다(live, preview 표시, 화면 id) context와 action 목록을 돌려주고, `screen.act`는 화면 id로 고른다(하나뿐이면 생략). (agent)
4. 결과는 글과 resource block이다. context는 화면 code의 hook(`useAgentContext`)이 정하고 선언에 두지 않는다. action 목록(name, description, inputSchema)도 hook이 등록한 것이다. (agent)
5. 화면 action에는 Gate가 없다(사용자 앱은 공격자가 아니다). 사람 없는 turn에서도 된다(화면이 열려 있어야 한다). 사람은 대화의 tool 호출 줄로 본다. (agent)
6. SDK는 새 package `@lophn/agent`다. bridge type은 `@lophn/app-ui`처럼 package 안에 복사해 두고 protocol을 import하지 않는다. core가 import하지 않으므로 `packages/core/package.json`에는 올리지 않는다(roadmap 정한 것 23을 고친다). (agent)

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `screen-core` | protocol route와 event, core 대기 표, `lophn screen` 명령 |
| 2 | `screen-sdk` | `@lophn/agent`, preload bridge, shell main이 열린 화면에 보내고 답 받기, pin과 template |

## lead가 할 일

- merge마다: `architecture/app-call.md`(화면 action과 command의 차이), `annotation.md`("agent가 화면을 조작하는 selector tool은 없다"를 "화면이 등록한 action만"으로), `ui-kit.md`(새 SDK)를 고친다.
- `screen-sdk` 뒤: `npm run dev`의 fake로 코딩 테스트 코치 같은 작은 화면 하나에서 context 읽기와 주석 action을 손으로 확인한다. 새 E2E·Electron test는 만들기 전에 사람에게 묻는다.
- 다 끝나면: `agent-platform.md` 단계 5를 끝남으로 적고, change-log 열린 판에 적고, 계획 폴더를 지운다.

# screen-core

core 쪽: agent가 `lophn screen context|act`로 열린 앱 화면에 요청하고, core가 대기 요청을 두고 transient event를 내고, shell이 돌려준 답으로 끝낸다.

- 단위: screen (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - 새 `packages/protocol/apps/agent-screen.ts`, `packages/protocol/apps/mod.ts`, `packages/protocol/events/transient.ts`
  - 새 `packages/core/apps/agent-screen/**`, `packages/core/main/daemon/wiring/apps.ts`
  - 새 `packages/cli/commands/screen.ts`, `packages/cli/commands/mod.ts`
  - `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`(새 module)
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`, `project-docs/architecture/event.md`(transient)
  - 선례: `packages/core/lophn-agent/tools/questions/wait.ts`(대기와 timeout), `packages/cli/commands/preview.ts`(`places:["app"]` 명령)
  - 제품 결정: 계획 README 정한 것 1~5
- 계약:
  - 쓰는 것: credential `conditions.app`(`core/agent-places/credentials.ts`)
  - 내놓는 것: transient event `ScreenRequested {request, app, kind: "context"|"act", view?, action?, input?}`, shell 내부 답 route `ScreenAnswer {request, view, result | error}`, 명령 결과 꼴(정한 것 3, 4)

## 할 일

1. protocol: route `ScreenContext`, `ScreenAct`(입력에 app 없음, credential의 app을 쓴다), 답 route, transient event.
2. core: 대기 표(request id, app, 시작 시각). 같은 request는 한 번만 끝난다. 모르는 id나 다른 app의 답은 버린다. 10초면 `unavailable`. 답 24 KiB 상한.
3. 명령 `screen.context`, `screen.act`(`defineCommand`, `places:["app"]`). 결과는 글과 resource block(`packages/protocol/lophn-agent/content-block.ts`). `ToolResult.content`가 JSON뿐이면 resource text로 싣는 가장 작은 길을 쓰고 보고한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "대기 표는 credential의 app 답만 받고 한 번만 끝나며 모르는 id는 버리고 timeout은 `unavailable`이다"
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. shell이 아직 답하지 않으므로 이 task 뒤 명령은 늘 `unavailable`이다(알려진 미완 동작이 아니라 다음 task의 일).

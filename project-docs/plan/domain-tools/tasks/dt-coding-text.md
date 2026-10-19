# dt-coding-text

coding agent가 읽는 글을 새 이름에 맞춘다: lophn CLI `app` 명령의 설명과 전역 skill 둘(`lophn-build-app`, `lophn-repair`). 선언은 `tools`, 호출은 `tool`, 화면은 `lophnApp.callTool`, SDK는 `tool`·`ToolRejection`·`ToolButton`·`useTool`이다. `@lophn/cap-project`는 없어졌다. 글만 고친다. 절차와 순서는 바꾸지 않는다.

- 단위: domain-tools (wave 2)
- 선행: dt-call-route
- 소유(이 task만 고친다):
  - `packages/coding-agent/cli/commands/app.ts`
  - `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`
  - `packages/coding-agent/guides/skills/lophn-repair/SKILL.md`
- 읽을 것:
  - architecture: `project-docs/architecture/coding-agent.md`("전역 skill은 얇고 절차는 `lophn guide <name>`이 낸다", examples 절)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `coding-agent-cli-interface`, `project-docs/module-catalog.yaml`의 `packages/coding-agent`
  - 계획: `project-docs/plan/domain-tools/README.md`의 "같이 도는 계획" 표(`domain-place`가 같은 skill에서 App Engineer 문구를 PM으로 바꾼다. 이 task는 tool 이름만 고친다)
  - 이름: `dt-sdk` brief의 "계약 모양"(SDK 이름), `dt-shell-bridge` brief(`lophnApp.callTool`), `dt-decl` brief(선언 칸)
- 계약:
  - 쓰는 것: 위 이름들(코드를 import하지 않는다)
  - 내놓는 것: 없음

## 할 일

1. `cli/commands/app.ts`: `app blueprint`("현재 blueprint의 tool 선언을 읽는다"), `app invocations`("tool 호출 이력을 읽는다")의 설명을 바꾼다. 명령 이름은 그대로.
2. `lophn-build-app/SKILL.md`: 아래 곳을 새 이름으로 바꾼다. 절차 번호와 구조는 그대로다.
   - 1번: 예시는 "tool과 입력, 기대 결과"로 읽는다.
   - 3번: "선언된 app api(blueprint의 `app_api`)"를 "선언된 tool(blueprint의 `tools`)"로.
   - 4번: 내장 SDK 목록에서 `@lophn/cap-project`를 뺀다. `AppApiButton, useAppApi, AppErrorBoundary`를 `ToolButton, useTool, AppErrorBoundary`로.
   - 6번: "화면과 app api(`src/app-api.ts`의 handler, 화면에서는 `lophnApp.call(api, input)`)"를 "화면과 tool(`src/app-api.ts`의 `tool(name, handler)` 등록, 화면에서는 `lophnApp.callTool(tool, input)`)"로.
   - 8번·9번: "예시의 api"→"예시의 tool", "화면과 app api를 확인한"→"화면과 tool을 확인한".
3. `lophn-repair/SKILL.md`: 1번, 7번의 "api와 입력"·"예시의 api"를 tool로 바꾼다.
4. 두 SKILL 모두 `grep -n "app api\|app-api\|app_api\|lophnApp.call\b\|cap-project"`가 0줄이어야 한다(설명 문맥에서 일반 단어로 필요한 곳은 "tool"로 쓴다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 — 안내 글이다.
- 남지 않음: `grep -rnE "app api|app-api|app_api|lophnApp\.call\b|cap-project|AppApiButton|useAppApi" packages/coding-agent`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

# app-layers

앱 선언의 `tools[]`를 두 층으로 나눈다: 앱 내부 operation(`operations[]`)과 바깥 명령(`commands[]`). 화면은 operation만 부르고, agent·다른 앱·job·flow는 바깥 명령만 부른다.

- 단위: apps (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/**`
  - `packages/protocol/shell/app-bridge-types.ts`
  - `packages/core/apps/**`
  - `packages/sdk/**`
  - `packages/core/lophn-agent/tools/{app-tools.ts,app-toolkit.ts,app-public.ts,app-public_test.ts}`
  - `packages/core/lophn-agent/tools/app-tool/**`
  - `packages/core/agent-places/place/**`
  - `packages/core/agent-places/skills/design-app/SKILL.md`
  - `packages/core/agent-places/prompts/app.md`
  - `packages/core/approvals/**`
  - `packages/core/runs/**`
  - `packages/core/jobs/commands.ts`
  - `packages/core/main/flow-host/**`
  - `packages/shell/main/app-frame/**`
  - `packages/shell/preload/app-tool.ts`
  - `packages/shell/ipc/app.ts`
  - `packages/shell/renderer/workspace/agents/editor/{grants-model.ts,grants-model_test.ts,grants-panel.tsx,grants-panel.module.css}`
  - `packages/shell/renderer/app-frame/app-detail/**`
  - `tests/support/app/**`
  - `tests/e2e/{app-call_test.ts,app-data-rewind_test.ts}`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/command-surface.md`의 "정한 것" 10~13, 16과 "지금 코드 › 앱 tool은 한 층이다"
  - architecture: `project-docs/architecture/app-call.md`, `project-docs/architecture/domain.md`, `project-docs/architecture/activation.md`
  - 선언: `packages/protocol/apps/declaration/`(`types.ts`, `tools.ts`, `value.ts`)
  - 호출 경로: `packages/core/apps/calls/`(`service.ts`, `caller.ts`, `gate.ts`), `packages/core/apps/invocations/`
  - 화면 길: `packages/shell/main/app-frame/app-call.ts`, `declaration-source.ts`, `packages/sdk/app-ui/`
- 계약:
  - 쓰는 것: 없음(이 task가 앱 선언과 앱 호출 계약의 주인이다).
  - 내놓는 것: 새 선언 모양, 호출 대상(operation과 command), 바깥 명령 목록 읽기. wave 2 task(`lophn <domain> <command>`, 화면 큰 결과)가 쓴다. 실제 이름을 보고에 적는다.

## 정한 것 (roadmap에서)

- operation은 `{name, title, effect}`다. command는 `{name, description, inputSchema, effect, public, domain}`다.
  - 이름 규칙은 지금의 tool 이름과 같다.
  - 두 목록을 합쳐 이름이 하나여야 한다. handler는 이름 하나로 등록한다.
  - `outputSchema`, `toMcpTool`, `toolAnnotations`, MCP annotation은 지운다.
  - agent tool 이름이 겹치는지 보는 검사는 command에만 건다.
- 사람 data root의 앱은 나중에 worker가 손으로 옮긴다(roadmap 16). 그래서 옛 bundle을 살릴 장치(옛 이름 읽기, 옛 SDK 이름)를 두지 않는다.
  - SDK와 화면 bridge의 이름은 새 뜻(operation, command)에 맞게 고른다. "tool"이라는 이름을 앱 쪽 새 API에 남기지 않는다.
  - API가 바뀐 SDK package는 major 판을 올리고, template의 고정 판도 맞춘다.
- 화면의 bridge는 operation만 부른다. shell main의 허용 목록도 operations다.
- core 호출 경로에서 호출 대상은 operation이거나 command다.
  - operation은 사람(화면)이 부르거나, 그 앱 place의 session이 preview에서 부를 때만 간다. agent·다른 앱·job(program)·flow가 부르면 handler에 보내기 전에 `denied`다.
  - command의 판정은 지금 tool과 같다(할당, public, domain).
  - write·external은 operation이든 command든 지금처럼 core의 줄, 기록, changeset을 거친다.
  - invocation 기록은 operation인지 command인지를 남긴다.
- 다른 앱이 부르는 것(`app_connections`와 연결 client)은 command만이다.
- job, flow, CLI의 `tool call`은 command만 부른다. run 종류와 flow SDK 함수의 이름 바꾸기는 이 task에서 하지 않는다.
- agent에게 보이는 것: `buildAppTools`는 command로만 만든다(임시다. wave 2가 `lophn <domain> <command>`로 바꾼다).
  - `app.tools`는 command를 보인다.
  - 할당의 `removed_tools`는 저장된 칸 이름을 그대로 두고, 그 안에 command 이름을 넣는다.
  - Grants 화면과 App details는 command를 보인다.
- `preview.call`은 자기 앱 preview의 operation과 command를 부른다.
- 화면 operation의 큰 결과(bytes frame)는 이 task에서 하지 않는다(wave 2).
- ledger에 저장된 모양(release facts 등)이 바뀌면 새 ledger schema step을 더한다(AGENTS.md "호환성"). 이미 낸 step의 SQL은 고치지 않는다.
- `design-app` skill:
  - "6. Tools"를 둘로 나눈다. Operations는 화면과 model에서 나온다. Commands는 agent와 다른 앱이 물을 것이고, 의미 단위이며 결과가 작다.
  - Mahas 예처럼 "모든 세션 목록"은 operation이고, "harness와 session id로 그 세션의 token 소모량"은 command다.
- app template(`packages/core/apps/packages/template/`): `lophn.ts.tmpl`, `src/tools.ts.tmpl`, `AGENTS.md.tmpl`, `tests/declaration_test.ts.tmpl`를 새 모양에 맞춘다. SDK guide도 같다.
- `packages/core/agent-places/prompts/app.md`에서 앱 선언의 tool을 말하는 줄을 operation과 command로 고친다. 내장 tool 이름(`release.prepare` 같은 것)은 고치지 않는다(wave 3).

## 할 일

1. 선언 모양, 검사, 읽기(`packages/protocol/apps/declaration/`, `packages/core/apps/declaration/`)
2. release 준비, 봉인, activation, preview의 선언=handler 대조. release facts가 바뀌면 schema step을 둔다.
3. SDK(`cap-tool`, `app-ui`, `declaration`, `flow`)와 앱 process entrypoint(`packages/core/apps/runtime/entrypoint/`)
4. 호출 경로(대상 종류, operation 막기, invocation 기록)와 broker의 앱→앱 호출
5. 화면 길(shell main allow-list, preload bridge)
6. job·flow·run의 tool run이 command를 찾게 한다.
7. agent 쪽(`buildAppTools`, `app.tools`, place 정보의 tool 이름)과 Grants·App details 화면
8. template, `design-app`, `prompts/app.md`, SDK guide
9. 앱 선언을 담은 test fixture(`tests/support/app/**`)

## 끝남

- `npm run check:full`이 통과하고 `boot.sh`가 두 번 `exit 0`이고 `node packages/shell/renderer/build.ts`가 된다.
- 위험 test: "agent·다른 앱·job·flow caller가 operation을 부르면 core가 handler에 보내기 전에 `denied`로 막는다"
- 위험 test: "선언한 operation·command 이름과 등록한 handler 이름이 다르면 release 준비와 activation이 거절한다"(지금 있는 test를 새 모양으로 옮긴다)
- 남지 않음: `grep -rn "toMcpTool\|toolAnnotations\|outputSchema" packages tests`가 0줄이다. `grep -rn "\.tools\b" packages/core/apps packages/shell/main/app-frame`에 선언의 옛 `tools`가 남지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 새 선언·호출 계약의 실제 이름(wave 2가 쓴다)
- 등록할 것
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

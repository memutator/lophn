# cmd-apps

앱 관리 tool 열을 명령으로 옮긴다: `app.read`, `app.tools`, `app.create`, `app.link_source`, `declaration.check`, `app.status`, `app.logs`, `app.invocations`, `package.read`, `package.publish`.

- 단위: cli (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/agent-tools/{app.ts,app_test.ts,runtime.ts,runtime_test.ts,package.ts,package_test.ts,app-card.ts}`
  - `packages/core/apps/declaration/**`
  - `packages/cli/commands/{app.ts,app_test.ts,package.ts,package_test.ts}`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/command-surface.md`의 "정한 것" 2~9
  - 본보기: `packages/cli/commands/`의 job 명령(cs-foundation이 옮긴 것)과 그 등록
  - architecture: `project-docs/architecture/domain.md`(다른 domain의 비공개 tool을 숨기는 규칙)
- 계약:
  - 쓰는 것: cs-foundation의 명령 모양, app-layers의 선언(command) 모양

## 할 일

1. 열 tool을 `packages/cli/commands/`의 명령으로 옮기고 agent-tools 쪽 정의를 지운다. place 종류는 지금 `packages/core/agent-places/tool-lists.ts`에서 그 tool이 든 목록을 그대로 옮긴다.
2. 부른 쪽에 따라 하던 판단을 core route로 옮긴다. 같은 명령을 binary가 user token으로도 부르기 때문이다.
   - `app.tools`가 `ctx.domains`로 다른 domain의 비공개 command를 숨기는 것은 `appToolIndex` route가 부른 쪽 credential로 거른다. agent의 맡은 domain 셈은 `packages/core/main/daemon/agent-domains.ts`에 이미 있다. 사람(user)은 다 본다.
   - `app.link_source`의 상대 path는 명령 context의 기준 폴더로 푼다. binary는 cwd이고, `lophn` tool은 place의 첫 폴더다. 기준 폴더가 context에 없으면 lead에게 계약 바꾸기 요청을 낸다.
3. 명령 help(description)는 영어이고, 지금 tool 설명의 다른 tool 이름(`app_tools` 같은 것)은 명령 꼴(`lophn app tools`)로 쓴다.

## 끝남

- `npm run check:full`이 통과하고 `boot.sh`가 두 번 `exit 0`이다.
- 위험 test: "agent가 `app tools`를 부르면 다른 domain의 비공개 command가 결과에 없다"(지금 `app_test.ts`가 보는 것을 route 쪽으로 옮긴다)
- 남지 않음: 옮긴 tool 이름이 `packages/core/apps/agent-tools/`에 정의로 남지 않는다.

## 보고

- 바꾼 file, 통과한 check
- 등록할 것: 명령 등록 목록, `TOOL_ORDER`·place 목록에서 뺄 이름, `packages/core/apps/agent-tools/mod.ts`에서 뺄 것
- 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

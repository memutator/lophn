# app-commands

앱이 내놓은 바깥 명령을 `lophn <domain> <command>`로 부르게 한다. 앱 command마다 provider tool을 만들던 `buildAppTools`를 지운다.

- 단위: apps (wave 2)
- 선행: defer-remove. 둘 다 session의 tool 목록을 고정하는 곳(`prepare.ts`, `product-driver.ts`)을 바꾼다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/{app-tools.ts,app-toolkit.ts,app-public.ts,app-public_test.ts}`
  - `packages/core/lophn-agent/tools/app-tool/**`
  - `packages/core/lophn-agent/tools/lophn/**`
  - `packages/core/lophn-agent/run-loop/{prepare.ts,prepare_test.ts}`
  - `packages/core/main/agent-runtime/**`
  - `packages/core/agent-places/place/**`
  - `packages/protocol/apps/declaration/types.ts`
  - `packages/cli/commands/{app-command.ts,app-command_test.ts}`
  - binary의 `tool call` 명령 file(cs-foundation이 옮긴 곳)
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/command-surface.md`의 "정한 것" 1~10
  - architecture: `project-docs/architecture/app-call.md`("agent에게는 앱 tool이 그대로 tool로 보인다"는 이 task로 바뀐다), `project-docs/architecture/domain.md`
- 계약:
  - 쓰는 것: cs-foundation의 명령 모양과 `lophn` tool, app-layers의 선언(command)과 호출 대상

## 할 일

1. 명령 이름 `<domain>.<command>`, argv는 `lophn <domain> <command 낱말>`이다. 해석은 부를 때 한다: 지금 할당, 활성 release의 command 선언, domain 규칙(맡은 domain이면 전부, 아니면 public만)으로 찾는다. 그래서 앱 command는 session 시작 때 고정하지 않고 `tools_changed` notice도 내지 않는다(MCP만 남는다).
2. effect는 선언에서, 기록 이름은 `<domain>.<command>`, gate는 지금 앱 tool의 판정(core 호출 경로)이다.
3. `lophn` tool의 설명에는 앱 command를 넣지 않는다(설명은 place 종류마다 같은 bytes). 앱 command 이름은 place 정보의 domain 지도(`packages/core/agent-places/place/`)에 싣고, `lophn <domain> --help`가 command의 description과 입력을 보인다.
4. binary(사람)의 `lophn <domain> <command>`는 지금 `tool call`처럼 run(`runs.start kind:tool`)으로 부르고 결과를 기다린다. `tool call` 명령은 지운다.
5. 내장 명령 묶음 이름(`app`, `release`, `preview`, `package`, `declaration`, `job`, `workflow`, `domain`, `kind`, `settings`, `agent`, `call`, `session`, `run`, `help` 등 실제 등록 목록의 첫 낱말)은 모두 domain 이름으로 쓰지 못하게 `RESERVED_DOMAIN_NAMES`에 둔다. 등록 목록과 그 집합을 대조하는 test를 하나 둔다(지금 `tool-names_test.ts`의 역할을 옮긴다).
6. `buildAppTools`, app toolkit, `app-public`의 provider tool 만들기를 지운다. 맡은 domain과 public 거르기 규칙은 1의 해석에 남긴다.

## 끝남

- `npm run check:full`이 통과하고 `boot.sh`가 두 번 `exit 0`이다.
- 위험 test: "할당되지 않은 앱이나 뺀 command, 다른 domain의 비공개 command는 `lophn <domain> <command>`로 실행되지 않는다"
- 위험 test: "내장 명령 묶음 이름은 모두 domain 이름으로 쓸 수 없다"
- 남지 않음: `grep -rn "buildAppTools\|appToolName" packages`가 0줄이다.

## 보고

- 바꾼 file, 통과한 check
- 등록할 것
- 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

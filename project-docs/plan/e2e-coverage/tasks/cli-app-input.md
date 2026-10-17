# cli-app-input

coding agent CLI의 token 명령에서 `app` 칸은 "선택"으로 보이지만(`withCommon`이 `appIdSchema.optional()`로 바꾼다), 비우면 CLI client가 route 입력 schema(`app` 필수)로 먼저 검사해 `invalid_input`으로 끝난다. coding agent가 받는 env는 `LOPHN_CODING_TOKEN` 하나라 CLI는 앱 id를 스스로 모른다. guide(`lophn-build-app`)는 `app`을 넣으라고 쓰지 않는다. 그래서 guide대로 하는 coding agent는 `app show`, `release status` 등에서 막힌다. `app-cli-finish` worker가 찾았다.

- 단위: fix (wave 3)
- 선행: test-app
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/cli-commands.ts`
  - `packages/coding-agent/cli/`
  - `packages/coding-agent/connection/client/core.ts`
  - `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`
  - `packages/coding-agent/guides/skills/lophn-repair/SKILL.md`
- 읽을 것:
  - `project-docs/architecture/coding-agent.md`, `packages/core/server/identity/coding-token.ts`(token이 정하는 범위)
  - `withCommon`의 주석("route 쪽 검사는 core가 다시 한다")과 core가 coding token 요청에서 `app`을 채우는지(`packages/core/server/`의 coding token 처리, route handler)
- 계약:
  - 쓰는 것: `CODING_CLI_COMMANDS`, coding token 범위.
  - 내놓는 것: 없음(CLI 동작).

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 정한 것

- 먼저 코드로 가린다: core가 coding token 요청의 `app`을 token에서 채우는가.
  - 채우면: CLI client가 `app`이 빈 token 명령을 route schema로 미리 막지 않게 한다(core가 다시 검사한다는 주석대로). guide는 그대로 둔다.
  - 안 채우면: "선택"을 지운다. `withCommon`이 `app`을 optional로 바꾸지 않고, guide에 `app`을 어디서 얻는지(`ticket claim`의 출력 등 코드로 확인한 곳) 한 줄 적는다.
  - 어느 쪽인지와 근거를 보고의 "정한 것"에 적는다. 둘 다 아니면 멈추고 보고한다.
- 같이 고친다: `packages/coding-agent/cli/commands/types.ts`의 `READ_WORDS`에 `result`가 없어 `app test result`가 help에서 "변경"으로 분류된다. 더한다.

## 할 일

1. 위 가르기. 2. 고친다. 3. `packages/coding-agent/cli/main_test.ts`에 `app` 없이 부른 token 명령이 정한 동작(보내짐 또는 필수 오류)을 하는 행 하나를 더한다(고치기 전 실패를 보고에 적는다).

## 끝남

- `deno task check:full`이 통과한다. `deno task e2e`의 앱 flow(`tests/e2e/app-*`)가 통과한다.
- 남지 않음: `grep -n "optional" packages/protocol/coding-agent/cli-commands.ts`의 `app` 줄이 정한 쪽과 맞다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

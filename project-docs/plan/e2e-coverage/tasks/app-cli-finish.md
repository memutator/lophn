# app-cli-finish

coding agent의 CLI에는 release 준비를 끝내고 `ticket report`로 가는 길이 빠져 있다(코드로 읽음, 돌려 확인하지 않음). 준비 확정은 `releases/preparation`을 읽을 때만 일어나는데 그 route가 CLI 표에도 coding token 범위에도 없다. 이 task는 그 길을 CLI에 연다. 앱 E2E 전부가 이 위에 선다.

**사람이 "앱 길의 CLI를 이렇게 연다"(README의 사람에게 물을 것 1)를 정하기 전에는 띄우지 않는다. 이 brief는 추천안이다. 사람이 다른 모양을 정하면 "내놓는 것"만 바꾸고 나머지는 그대로 둔다. `test-app`과 앱 flow 다섯은 이 task가 merge되어야 시작한다.**

- 단위: app-cli-finish (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/cli-commands.ts`
  - `packages/protocol/apps/releases.ts`
  - `packages/core/apps/control.ts`
  - `packages/core/main/daemon/wiring/apps.ts`
  - `packages/coding-agent/cli/commands/release.ts`
  - `packages/coding-agent/cli/commands/app.ts`
  - `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`
  - `project-docs/architecture/coding-agent.md`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/README.md` "정한 것" 8(제품 동작을 새로 정해야 하면 사람에게 묻는다)과 아래 "찾은 것"
  - architecture: `project-docs/architecture/coding-agent.md`, `project-docs/architecture/activation.md`(계기는 `TicketVerified`), boundary `coding-agent-cli-interface`, `app-releases`, `app-tickets`, `problems`
  - 코드: `packages/core/apps/control.ts`(`releasePrepareBundleHandler`, `releasePreparationHandler`: `finalizer.observe`가 불리는 유일한 곳), `packages/core/apps/releases/finalizer.ts`(같은 bundle hash로 통과한 app test가 ledger에 있어야 `release.prepare`를 낸다), `packages/core/server/identity/coding-token.ts`(token 범위 = CLI 표에서 `auth: coding_token`인 route의 이름), `packages/protocol/coding-agent/cli-commands.ts`, `packages/coding-agent/connection/ticket-ops.ts`(`ticket report`는 `release` id를 입력으로 받는다), `packages/core/problems/tests/{commands,request-ports}.ts`, `packages/core/problems/tests/app-test/frozen.ts`(`deriveAppTest`), `packages/core/problems/tests/work/runner-service.ts`(요청의 `test` hash가 봉인 bundle에서 만든 것과 다르면 "요청의 고정 시험 hash가 ...다르다"로 실행하지 않는다)
- 계약:
  - 쓰는 것: `packages/protocol/apps/releases.ts`의 `releasePreparation`·`releasePrepareBundle`, `packages/protocol/problems/tests.ts`의 `requestTest`·`getTestRequest`·`getVerification`, `deriveAppTest`(core 안 함수. core/apps가 core/problems를 직접 import하지 못하면 wiring이 주입한다. `core/main/daemon/wiring/apps.ts`가 이미 `findPassedAppTest`를 그렇게 넘긴다).
  - 내놓는 것: 아래 "내놓는 것" 절

## 내놓는 것

CLI 표(`CODING_CLI_COMMANDS`)에 아래 명령(추천 이름)이 더해지고, coding token의 범위가 표에서 저절로 따라온다.

| 명령 | route | 하는 일 |
|---|---|---|
| `release status` | `release.preparation` | request_key로 준비 진행을 읽는다. 끝났고 통과한 app test가 있으면 core가 release를 확정하고 `release`(id)를 돌려준다. 준비가 끝나면 `test`(고정 시험 hash)도 돌려준다 |
| `app test status` | `GetTestRequest` | `app test`로 접수한 request_key의 접수·`result_ref`를 읽는다 |
| `app test result` | `GetVerification` | `result_ref`로 통과·실패와 이유를 읽는다 |

`releasePreparationOutputSchema`에 `test: sha256 | null`이 더해진다(준비가 `completed`일 때만 채운다). 이름이 다르게 정해지면 이 brief를 고치고 `test-app`·`coding-role`의 읽을 것을 맞춘다.

## 할 일

**먼저 한다(30분 안)**: 위 "찾은 것" 네 가지가 실제로 막히는지 임시 script(commit하지 않음)로 확인한다. 막히지 않으면(어딘가에 이미 다른 길이 있으면) 이 task를 접고 보고한다.

찾은 것(코드로 읽음):
1. `release prepare` CLI는 `release.prepare_bundle`을 접수만 한다. 준비를 확정하는 `finalizer.observe`는 `releasePreparationHandler`(`release.preparation`)에서만 불리는데 이 route는 CLI 표에 없어 coding token 범위 밖이다(user token도 actor가 아니다). 그래서 누구도 확정을 일으키지 못한다.
2. 확정은 "같은 bundle hash로 통과한 app test"를 요구한다. coding agent는 `app test`(`RequestTest`)를 부를 수 있지만 입력의 `test`(고정 시험 hash)를 만들 수단이 없다(runner가 봉인 bundle 사본에서 `deriveAppTest`로 만든 값과 다르면 실행하지 않는다).
3. test 결과를 읽는 CLI 명령이 없다(`GetTestRequest`, `GetVerification`이 표에 없다).
4. `ticket report`는 확정된 `release` id를 입력으로 받는데 CLI로 그 id를 얻을 길이 없다.

할 일:
1. 위 "내놓는 것"을 만든다. 표 줄 하나와 `packages/coding-agent/cli/commands/`의 `entryOf` 한 줄씩이 기본이다. `release status`가 `finalizer.observe`를 거치게 하는 것은 이미 `releasePreparationHandler`가 한다. `test` hash는 준비가 `completed`인 응답에 core가 `deriveAppTest(<data root>/apps/<app>/bundles/<bundle_hash>, bundle_hash)`로 채운다(주입으로).
2. `lophn-build-app` skill의 순서(7~10)를 새 명령 이름에 맞춘다: `release prepare` → `release status`로 `bundle_hash`·`test`를 읽음 → `app test` → `app test status`/`result`로 통과 확인 → `release status`로 `release` id → `ticket report`. 지금 skill은 "테스트가 통과한 같은 commit에서 `release prepare`"라고 쓰는데 test가 bundle hash를 요구하므로 순서가 맞지 않는다. `project-docs/architecture/coding-agent.md`의 CLI 설명도 같은 변경에서 고친다.
3. `packages/coding-agent/cli/main_test.ts`에 새 명령이 표대로 route에 닿는 것을 한 줄 더한다(이미 있는 방식으로). 새 test file을 만들지 않는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `coding-agent-cli-interface`(coding agent가 core에 닿는 길은 CLI 하나), `app-releases`·`app-tickets`(준비 → 확정 → 완료 보고 → 검증 → activation 순서가 CLI로 끝까지 가야 한다).
- 현실적 회귀: CLI 표와 route 목록이 어긋나 coding agent가 한 단계를 못 가는 것. 이번에도 어긋나 있다.
- 왜 지금 test가 못 잡나: CLI test는 가짜 fetch로 명령 하나씩만 본다. 준비부터 report까지 한 길로 가는 test가 없고, `test-app`의 앱 E2E가 처음 한다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- 새 명령 세 개가 CLI help와 `CODING_CLI_COMMANDS`에 있고 coding token 범위에 들어간다(`packages/core/server/identity/coding-token.ts`의 목록이 표에서 계산되므로 따로 고칠 것이 없는지 확인한다).
- 위험 test: 없음(CLI 표 줄 추가. 끝까지 가는지는 `test-app`의 E2E가 본다)
- 남지 않음: `grep -rn "테스트가 통과한 같은 commit에서" packages`가 0줄이다.

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

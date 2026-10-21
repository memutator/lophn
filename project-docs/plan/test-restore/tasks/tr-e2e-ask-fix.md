# tr-e2e-ask-fix

turn request를 기다리는 동안의 동작을 보는 e2e 여섯을 지금 설계로 고친다. 묻게 하던 `file_write LOPHN.md`(지금은 묻지 않는다)를 `shellAsk`로, `"allow"`를 `"once"`로, `permission_requests`·`PermissionRequested`·`approvalsDecideTurn`을 새 이름으로 바꾼다. 재는 것은 그대로다.

- 단위: e2e (wave 2)
- 선행: tr-e2e-approval.
- 소유(이 task만 고친다):
  - `tests/e2e/{gateway,restart,rewind,steer,stop,turn-fate}_test.ts`
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md`의 "정한 것" "허락을 묻게 하는 e2e는 file 쓰기 대신 shell 규칙에 걸리는 명령을 쓴다" 줄. `project-docs/plan/test-restore/survey-e2e.md` §0 approval 줄, §1 15행(gateway), 24행(restart), 25행(rewind), 28행(steer), 29행(stop), 30행(turn-fate), §2 "Shared ask-trigger helper"
  - 계약: `project-docs/plan/test-restore/tasks/tr-e2e-approval.md`의 "내놓는 것"(`ShellAsk`, `shellAsk(folder, name?)`)
  - architecture: `project-docs/architecture/approval.md`의 "묻는 길"(43-49. 물음은 메모리이고 재시작하면 비며, turn이 끝나면 cancelled로 닫는다), `project-docs/architecture/event.md` 23·27(`TurnRequestOpened`·`TurnRequestClosed`, snapshot의 `turn_requests`), `project-docs/architecture/testing.md`의 "case 고르는 규칙"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `approvals`, `event-stream`, `run-loop`, `agent-sessions`; `project-docs/module-catalog.yaml`의 `tests`
  - 코드: `tests/support/core/shell-ask.ts`(tr-e2e-approval이 만든다), `tests/support/core/human.ts`(`waitPermission`은 이름 그대로이고 `snapshot.turn_requests`를 읽는다, `decide`는 `"once" | "always" | "reject"`), `packages/protocol/approvals/turn-request.ts`(`turnRequestDecide`, choice `{ kind: "once" }`), `packages/protocol/events/agent.ts` 106·111(`TurnRequestOpened`, `TurnRequestClosed`), `tests/support/gateway/mod.ts`(`connectGateway`)
- 계약:
  - 쓰는 것: tr-e2e-approval의 `tests/support/core/shell-ask.ts`(`shellAsk`, `ShellAsk`)와 옮긴 이름, `tests/support/core/human.ts`(`waitPermission`, `decide(…, "once" | "always" | "reject")`), `tests/support/gateway/mod.ts`(`connectGateway`), `packages/protocol/events/agent.ts`(`TurnRequestOpened`)
  - 내놓는 것: 없음

## 할 일

근거는 README "정한 것"의 묻게 하는 helper 줄과 `architecture/approval.md` "묻는 길"이다. 지금 file들은 `file_write LOPHN.md`가 묻지 않아 runtime에서 turn이 묻지 않고 끝나 기다림이 실패한다(`deno check` 오류는 이름 바꾸기 몫뿐이다). 행마다 묻는 trigger를 `const ask = await shellAsk(<project 폴더>)`와 `{ reply: ask.reply("<id>") }` step으로 바꾸고, 그 행의 disk 단정을 `LOPHN.md` 대신 `ask.exists()`로 바꾼다. 재는 것과 단정 수는 그대로다. `shellAsk`는 project 폴더를 만든 뒤(`Deno.mkdir(folder)` 다음) 부른다. 각 file에 `import { shellAsk } from "../support/core/shell-ask.ts";`를 더한다.

1. `tests/e2e/gateway_test.ts`
   - 34-46의 `file_write` 대답을 `ask.reply("t1")`로 바꾼다.
   - 53, 72의 `"PermissionRequested"`를 `"TurnRequestOpened"`로 바꾼다. 70의 `permissionEvents` 이름은 `requestEvents`로 바꿔도 된다.
   - 63, 78의 `permission_requests`를 `turn_requests`로, 64의 `"allow"`를 `"once"`로 바꾼다.
   - 82-83 disk 단정을 "폴더가 없다"(`assertEquals(await ask.exists(), false)`)로 바꾼다.
   - 머리 주석 3의 "허락 요청"은 "turn request"로 맞춘다.
2. `tests/e2e/restart_test.ts`(첫 행 39-104)
   - 46-58의 대답을 `[{ reply: ask.reply("t1") }, text "back"]`으로 바꾼다.
   - 73-77의 `permission_requests`를 `turn_requests`로 바꾼다(주석 "permission request"도).
   - 93-97 disk 단정을 "폴더가 그대로 있다"(`assertEquals(await ask.exists(), true)`)로 바꾼다. 재시작으로 끊긴 물음의 명령은 돌지 않는다.
   - 머리 주석 2·4의 "permission request"를 "turn request"로 맞춘다. 나머지 두 행(106-207)은 묻지 않으므로 그대로다.
3. `tests/e2e/rewind_test.ts`(`rewind-needs-idle`, 239-276)
   - 241-253의 `file_write LOPHN.md` 대답을 `ask.reply("t1")`로 바꾼다(`shellAsk(folder)`, `folder`는 161의 project 폴더).
   - 272의 `"allow"`를 `"once"`로 바꾼다.
   - 33-58 `writeFiles`의 `file_write`는 묻기가 아니라 되돌릴 쓰기이므로 그대로다.
4. `tests/e2e/steer_test.ts`
   - 39-51의 대답을 `[{ reply: ask.reply("t1") }, text "done"]`으로, 69의 `"allow"`를 `"once"`로 바꾼다. 단정 셋(72-99)은 그대로다.
5. `tests/e2e/stop_test.ts`
   - 17 import를 `turnRequestDecide`로 바꾼다.
   - "허락을 기다리는 중 멈추면 늦게 온 허락이 쓰기를 일으키지 못한다"(219-269): 221-230의 대답을 `[{ reply: ask.reply("w1") }]`로, 239-243을 `core.tryCall(turnRequestDecide, { session, request, choice: { kind: "once" } })`로, 250을 `turn_requests`로, 261-265 disk 단정을 `assertEquals(await ask.exists(), true)`로 바꾼다. test 이름의 "쓰기"는 "명령"으로 맞춘다.
   - 머리 주석 6의 "멈춘 뒤 도착한 `allow`가 쓰기를 일으키는 것"을 "`once`가 명령을 돌리는 것"으로 맞춘다.
   - 첫 행(65-118)의 `file_write`는 stall로 끝나지 않는 tool call이라(실행되지 않는다) 그대로다.
6. `tests/e2e/turn-fate_test.ts`(row b `folderAddedMidTurn`, 85-138)
   - 93-107의 첫 대답을 `ask.reply("t1")`로 바꾼다(`shellAsk(folder)`).
   - 120의 `"allow"`를 `"once"`로 바꾼다.
   - 132-133 disk 단정을 `assertEquals(await ask.exists(), false)`로 바꾼다.
   - row a(37-83)와 c의 `file_write`는 stall partial이라 그대로다.
7. file마다 `deno test --allow-all --no-check tests/e2e/<file>`로 돌린다. 앱을 띄우지 않으므로 `deno task e2e:deps`는 필요 없다. 실패하면 `shellAsk` 쪽 모양이 맞는지 먼저 보고, 계약을 바꿔야 하면 보고에 적는다.

## 끝남

- `deno task check`가 통과한다. `tests/e2e`는 아직 `NOT_CHECKED`라 type check를 따로 돈다: `deno check tests/e2e/gateway_test.ts tests/e2e/restart_test.ts tests/e2e/rewind_test.ts tests/e2e/steer_test.ts tests/e2e/stop_test.ts tests/e2e/turn-fate_test.ts`가 오류 0이다.
- 여섯 file이 `deno test --allow-all --no-check tests/e2e/<file>`로 각각 통과하고, 끝난 뒤 `/tmp/lophn-e2e-*`와 core process가 남지 않는다.
- 위험 test: 없음(새 test가 없다. 고친 file들이 지금 재는 것을 그대로 잰다)
- 남지 않음: `grep -n "LOPHN.md\|\"allow\"\|kind: \"allow\"\|permission_requests\|PermissionRequested\|approvalsDecideTurn" tests/e2e/{gateway,restart,rewind,steer,stop,turn-fate}_test.ts`가 0줄이다(`waitPermission`은 helper 이름이라 남는다).

## 보고

- 바꾼 file
- 통과한 check(e2e는 file마다 걸린 시간)
- 등록할 것: 없음이면 "없음"
- 안 쓰게 된 export: 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: `ShellAsk`로 안 되는 행이 있으면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

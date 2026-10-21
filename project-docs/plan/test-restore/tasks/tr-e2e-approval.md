# tr-e2e-approval

허락을 묻게 하는 shell helper 하나(`shell_run "rm -r <미리 만든 폴더>"`)를 두고, `approval_test.ts`를 그 helper와 `once`·`reject`로 고친다(`allow-once-consumed`는 지운다). shell 규칙 e2e `shell-rule_test.ts`를 새로 쓴다.

- 단위: e2e (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/support/core/shell-ask.ts` (새 file)
  - `tests/e2e/approval_test.ts`
  - `tests/e2e/shell-rule_test.ts` (새 file)
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md`의 "정한 것" 표 `(새) shell-rule` 줄과 "허락을 묻게 하는 e2e는 file 쓰기 대신 shell 규칙에 걸리는 명령을 쓴다" 줄. `project-docs/plan/test-restore/survey-e2e.md` §0 approval 줄, §1 9행(`approval_test.ts`), §2 `core/human.ts` 줄과 그 아래 "Shared ask-trigger helper", §5 1
  - architecture: `project-docs/architecture/approval.md`의 "흐름", "지키는 것"의 "묻는 길"(43-49), "turn mode"(51-57), "shell 규칙"(59-66). `project-docs/architecture/testing.md`의 "`tests/support`"(35-54), "E2E 실행 폴더"(67-79), "case 고르는 규칙"(91-101)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `approvals`, `agent-tools`, `config`; `project-docs/module-catalog.yaml`의 `tests`
  - 쓰는 법: `.claude/skills/write-test/SKILL.md`(E2E 모양, 표로 돌리기, 단정은 바깥 결과)
  - 코드
    - 판정: `packages/core/approvals/gate/judge.ts` 26-39(명령 전체와 조각, deny가 먼저이고 ask는 attended에서만 묻는다), `packages/core/approvals/gate/shell-match.ts` 35-42(`shellRuleMatches`, 끝 ` *`), 61-81(`alwaysPatterns`: `rm -r victim` → `rm -r *`)
    - 규칙 층과 always: `packages/protocol/approvals/shell-rules.ts` 47-73(`PRODUCT_SHELL_RULES`의 floor `rm -rf ~`와 ask `rm -r*`), 75-87(`SHELL_RULES_SETTING_KEY`, `{global, projects}`); `packages/core/approvals/shell-rules/always.ts`(project place면 `projects[<prj>]`에 allow 줄을 끝에 더한다); `packages/core/approvals/shell-rules/layers.ts`(제품 ask, 전역, project 순, 마지막 일치); `packages/core/main/daemon/wiring/approvals.ts` 123-152(판정마다 Settings를 읽고, `always`가 `settingsUpdate`로 쓴다)
    - 물음: `packages/core/approvals/turn-requests.ts` 55-84(`always_patterns`), 96-147(`always`는 규칙을 쓴 뒤에 닫는다); `packages/protocol/approvals/turn-request.ts`
    - 실행 쪽: `packages/core/lophn-agent/tools/work.ts` 163-216(`askGate`: deny → `{kind: "not_executed", code: "denied"}`, 거절 → `{kind: "not_executed", code: "rejected"}`, 이유 글은 싣지 않는다), `packages/core/lophn-agent/tools/bundles/shell.ts`(place 첫 폴더에서 `/bin/sh`), `packages/core/lophn-agent/tools/shell/env.ts`(HOME을 넘긴다)
    - `~`가 가리키는 곳: `tests/support/core/process.ts` 31(`FIXED_ENV`), 49-75(core의 HOME은 `<run>/user-home`, 호출한 쪽이 덮지 못한다), `packages/core/main/daemon/wiring/supervision.ts` 16-23(runtime child가 core의 HOME을 받는다)
    - skip: `packages/protocol/lophn-agent/sessions.ts` 338-351(`changeSessionSkip`, compare `{state_seq}`), `packages/protocol/lophn-agent/turn-values.ts` 119-121(turn 행의 `mode`)
    - 지금 test: `tests/e2e/approval_test.ts`(52-87 `writeAndDecide`, 89-132 묻는 쓰기 행, 226-270 `allow-once-consumed`), `tests/e2e/restart_test.ts` 39-104(core를 죽였다 다시 띄우는 꼴), `tests/support/core/human.ts`(`waitPermission`, `decide`, `settle`), `tests/support/fake-server/types.ts`(`Reply`)
- 계약:
  - 쓰는 것:
    - `packages/protocol/approvals/shell-rules.ts`의 `PRODUCT_SHELL_RULES`(ask `rm -r*`, floor deny `rm -rf ~`)와 `SHELL_RULES_SETTING_KEY`(`approvals.shell_rules`)
    - `packages/protocol/approvals/turn-request.ts`의 `turnRequestDecide`(choice `once | always | reject`)와 turn request의 `always_patterns`
    - `packages/protocol/events/mod.ts`의 `sessionSnapshotsList`(`turn_requests`), `packages/protocol/config/file.ts`의 `SettingsList`, `packages/protocol/lophn-agent/sessions.ts`의 `changeSessionSkip`
    - `tests/support/core/human.ts`(`waitPermission`, `decide`), `tests/support/fake-server/mod.ts`의 `Reply`
    - tool `shell.run`(wire `shell_run`. place의 첫 폴더에서 돈다)
  - 내놓는 것(e2e 고치기 task가 이 이름과 모양에 기댄다. 이 task만 바꾼다):

    ```ts
    // tests/support/core/shell-ask.ts
    export type ShellAsk = {
      dir: string; // 미리 만든 폴더의 절대 path
      command: string; // `rm -r <name>`. place 첫 폴더 기준 상대 path
      reply(id: string): Reply; // fake 대답: `shell_run {command}` tool call 하나
      exists(): Promise<boolean>; // 폴더가 아직 있나
    };
    // folder는 place의 첫 폴더(PM이면 project 폴더), name 기본 "victim"
    export async function shellAsk(folder: string, name?: string): Promise<ShellAsk>;
    ```

    - attended session에서 이 명령은 turn request 하나를 연다. `once` 뒤에는 폴더가 없고 `reject`나 stop 뒤에는 남는다.
    - 다른 e2e가 같이 옮기는 이름: `"allow"` → `"once"`, `permission_requests` → `turn_requests`, `PermissionRequested` → `TurnRequestOpened`, `approvalsDecideTurn` → `turnRequestDecide`.
    - 자세히: `shellAsk`는 `<folder>/<name>`을 `recursive: true`로 만든다(이미 있어도 된다. 같은 이름으로 다시 부르면 지운 폴더를 되살린다). `reply(id)`는 `{ kind: "tool", calls: [{ id, name: "shell_run", arguments: JSON.stringify({ command }) }] }`이다. 다른 대답(끝 text)은 부르는 test가 step으로 붙인다.

## 할 일

근거는 README "정한 것"의 shell-rule 줄과 묻게 하는 helper 줄, `architecture/approval.md` "묻는 길"과 "shell 규칙"이다. file 쓰기(`LOPHN.md` 포함)는 이제 묻지 않는다. attended에서 묻는 것은 shell 규칙이 ask인 명령뿐이다.

1. `tests/support/core/shell-ask.ts`(새 file): 위 계약 그대로 만든다. import는 `../fake-server/mod.ts`의 `Reply` type 하나다. `exists()`는 `Deno.stat`이 `NotFound`면 false, 그 밖 오류는 던진다(`approval_test.ts` 29-37의 `exists`와 같다). 머리 주석에 "왜"를 한 줄 둔다: 제품 기본 ask 규칙 `rm -r*`에 걸리는 명령이라 attended turn에서 늘 묻고, 미리 만든 폴더라 실행 여부가 disk에 남는다.
2. `tests/e2e/approval_test.ts`
   1. 52-87 `writeAndDecide`를 `askAndDecide(core, fake, project, folder, name, choice: "once" | "reject")`로 바꾼다: `shellAsk(folder, name)` → `fake.script([{ reply: ask.reply("t1") }, text "done"])` → PM session에 `say` → `waitPermission` → 결정 전 `ask.exists()` → `decide` → `waitTurnEnd` → `toolCallList`. `{ ask, before, calls, result: toolResultOf(fake, "t1") }`를 돌려준다.
   2. 89-132 행은 이름을 "묻는 shell 명령은 허락 전에 실행되지 않고, once면 실행되며 거절하면 실행되지 않고 거절이 agent에게 간다"로 바꾸고 폴더 `a`(once)와 `b`(reject)로 돈다. 단정: once 행은 `before === true`와 결정 뒤 `exists() === false`(disk), outcome `success`(ledger). reject 행은 결정 뒤 `exists() === true`(disk), outcome `{ kind: "not_executed", code: "rejected" }`(ledger), `result`가 once 행의 결과와 다르다(fake가 받은 요청). 하위 폴더 `a`·`b`를 미리 만들던 98-99는 `await Deno.mkdir(folder)` 하나로 바꾼다(`openProject` 전에 project 폴더가 있어야 한다. 하위 폴더는 `shellAsk`가 만든다).
   3. 134-224 `ask` 행은 그대로 둔다.
   4. 226-270 `allow-once-consumed`를 지운다(fingerprint와 함께 없어졌다. 허락은 기다리는 그 호출을 풀 뿐이다, `approval.md` 46).
   5. 머리 주석(1-4)의 세 질문을 지금 계약으로 고친다: contract `approvals`(묻는 shell 명령은 사람의 결정 전에 실행되지 않고, `once`는 기다리던 그 호출을 풀고, 거절은 tool 결과로 agent에게 간다), 회귀(Gate를 건너뛰어 결정 전에 명령이 도는 것, 거절했는데 도는 것, 결정 뒤 turn이 이어 가지 못하는 것), 왜 지금 test로 못 잡나(judge_test는 순수 판정만 본다. child의 `tool_gate/check` → core 메모리 request → 사람 route → child가 이어 가는 왕복은 process를 건너야 보인다). allow-once 언급을 지운다.
   - 정한 것: 거절 이유 글은 단정하지 않는다. 이유: `work.ts` 197-203이 거절 결과에 이유를 싣지 않는다(`architecture/approval.md` 45 "거절 이유는 agent에게 그대로 간다"와 다르다). 이 task는 `work.ts`를 고치지 않고 보고의 "알려진 미완 동작"에 적는다.
3. `tests/e2e/shell-rule_test.ts`(새 file): core 하나, project 하나(`<run.work>/proj`), PM session 하나를 쓰고 행을 차례로 돈다(`approval_test.ts`의 준비 꼴과 `restart_test.ts` 39-104의 재시작 꼴). 머리 주석에 세 질문을 적는다: contract `approvals`(`always`는 `always_patterns`를 turn place의 층에 allow로 더해 Settings `approvals.shell_rules`에 남기고, 다음 판정과 재시작 뒤 판정이 그 규칙을 읽는다. floor deny는 어느 층도, `always`도, skip도 덮지 못한다)와 `config`(Settings file이 재시작에 남는다), 회귀(`always`가 request만 닫고 규칙을 안 쓰거나 다른 층에 써서 같은 명령을 또 묻는 것, 규칙이 메모리에만 있어 재시작 뒤 다시 묻는 것, skip turn에서 floor deny가 run이 되어 `rm -rf ~`가 도는 것), 왜 지금 test로 못 잡나(`judge_test`는 순수 함수이고 `approvals_test`는 자격만 본다. 사람의 결정 → `settingsUpdate` → `settings.json` → 다음 turn의 child `tool_gate/check`와 core 재기동이 이어져야 보인다).
   1. always: `shellAsk(folder)` → 대답 `[ask.reply("s1"), text]` → `say` → `waitPermission` → `sessionSnapshotsList`의 그 request `always_patterns`가 `["rm -r *"]`인지 본다 → `decide(…, "always")` → `waitTurnEnd(…, 0)`. 단정: 폴더가 없다(disk). `core.call(settingsList, { keys: [SHELL_RULES_SETTING_KEY] })`의 `chosen.projects[project]`가 `[{ pattern: "rm -r *", action: "allow" }]`이다(route).
   2. 다시 묻지 않음: 같은 이름으로 `shellAsk(folder)`를 다시 불러 폴더를 되살리고 `[ask.reply("s2"), text]` → `say` → `waitTurnEnd(…, 1)`. 단정: 폴더가 없다(disk), 그 call의 outcome이 `success`다(ledger). 다시 물었다면 turn이 끝나지 않아 `waitTurnEnd`가 실패한다.
   3. 재시작 뒤: `core.kill()` → `core = await bootCore(run)` → `settle(core)` → 2와 같은 행(`s3`, `waitTurnEnd(…, 2)`). 단정은 2와 같다. 이 행이 Settings가 file에 남는 것을 본다.
   4. skip이어도 floor deny: `agentSessionRead`의 `state_seq`로 `changeSessionSkip { session, skip: true }` → `<run.dir>/user-home/keep` 표지 file을 쓴다 → 대답 `[shell_run { command: "rm -rf ~" }, text]` → `say` → `waitTurnEnd(…, 3)`. 단정: 그 turn의 `mode`가 `skip`이다(ledger), 그 call의 outcome이 `{ kind: "not_executed", code: "denied" }`다(ledger), 표지 file이 그대로 있다(disk).
   - 안전: floor 판정은 child가 `/bin/sh`를 띄우기 전에 core의 `tool_gate/check`에서 한다(`work.ts` 163-216). 판정이 틀려도 `~`는 core의 HOME `<run.dir>/user-home`이다(`process.ts`의 `FIXED_ENV`가 HOME을 고정하고 `wiring/supervision.ts`가 runtime child에, `shell/env.ts`가 shell에 넘긴다). 그래서 사람의 홈은 닿지 않고 지워지더라도 run 폴더 안이다. 표지 file이 그것을 본다. 명령은 floor 줄과 글자 그대로 같은 `rm -rf ~`만 쓴다(`rm -rf /` 같은 다른 floor 줄을 쓰지 않는다). `bootCore`에 HOME을 바꾸는 env를 주지 않는다.
   - 정한 것: 규칙은 project 층(PM place) 하나만 본다. 전역 층(lophn·앱 place)은 같은 `withAlwaysRules`의 갈래라 따로 행을 두지 않는다. 이유: README 줄은 "규칙이 남아 다시 묻지 않는다"이고, 층 고르기는 순수 함수다.
   - 정한 것: 2와 3을 둘 다 둔다. 2는 core가 판정마다 Settings를 다시 읽는 길(`wiring/approvals.ts` 123-129), 3은 `settings.json`에서 읽는 길이다. 행마다 fake 대답 2, 단정 3 이하다.
   - 사람의 허락: README "정한 것"(사람, 2026-10-22)이 이 새 e2e file을 정했다. 다른 새 e2e file은 만들지 않는다.
4. 바꾼 두 e2e file을 돌린다: `deno test --allow-all --no-check tests/e2e/approval_test.ts tests/e2e/shell-rule_test.ts`. 새 file은 세 번 연속 통과를 본다(lead가 merge 전에 열 번 돌린다, `testing.md` 99). 앱을 띄우지 않으므로 `deno task e2e:deps`는 필요 없다.

## 끝남

- `deno task check`가 통과한다. `tests/e2e`는 아직 `NOT_CHECKED`라 type check를 따로 돈다: `deno check tests/e2e/approval_test.ts tests/e2e/shell-rule_test.ts tests/support/core/shell-ask.ts`가 오류 0이다(`shell-ask.ts`는 `deno task check`도 본다).
- `deno test --allow-all --no-check tests/e2e/approval_test.ts tests/e2e/shell-rule_test.ts`가 통과하고, 끝난 뒤 `/tmp/lophn-e2e-*`와 core process가 남지 않는다.
- 위험 test: "shell 물음에 `always`로 답하면 규칙이 Settings `approvals.shell_rules`의 project 층에 남아 같은 명령을 재시작 뒤에도 다시 묻지 않고, skip turn에서도 floor deny `rm -rf ~`는 실행되지 않는다"(`tests/e2e/shell-rule_test.ts`). "묻는 shell 명령은 결정 전에 실행되지 않고 거절하면 실행되지 않는다"(`tests/e2e/approval_test.ts`, 고친 행)
- 남지 않음: `grep -n "file_write\|\"allow\"\|allow-once\|LOPHN.md" tests/e2e/approval_test.ts tests/e2e/shell-rule_test.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check(e2e는 돌린 횟수와 걸린 시간)
- 등록할 것: 없음이면 "없음"
- 안 쓰게 된 export: 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것" 셋 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: `ShellAsk` 모양을 바꿔야 하면 고치지 말고 여기 적는다(tr-e2e-ask-fix, tr-e2e-call-fix가 기댄다)
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 거절 이유가 agent에게 가지 않는 것(`packages/core/lophn-agent/tools/work.ts` 197-203이 `result.reason`을 버린다. 화면은 이유를 보낸다 `packages/shell/renderer/desktop/connection/waiting/decide.ts` 36-37)을 적는다. lead가 이슈로 올린다

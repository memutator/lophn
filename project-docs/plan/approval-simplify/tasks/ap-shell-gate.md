# ap-shell-gate

`shell.run`을 shell 규칙으로 판정한다. 제품 기본, 전역, project 세 층을 Settings 값(`approvals.shell_rules`)과 함께 모아 `judge`에 넘기고, `always`는 그 turn의 place로 고른 층에 request의 `always_patterns`(ask였던 조각마다 `<앞 두 낱말> *`)를 allow 줄로 더한다. `shell.run`의 효과는 `external`로 둔다. coding harness 물음의 자동 답은 만들지 않는다(README 범위 밖).

- 단위: shell (wave 3)
- 선행: ap-mode-turn
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/wiring/config.ts`
  - `packages/core/lophn-agent/tools/bundles/shell_test.ts (새 file)`
  - `packages/core/lophn-agent/tools/bundles/shell.ts`
  - `packages/core/approvals/{approvals.ts,ports.ts,turn-requests.ts,approvals_test.ts}`
  - `packages/core/approvals/shell-rules/`(새 폴더)
  - `packages/core/main/daemon/wiring/{approvals.ts,setting-declarations.ts,context.ts}`
- 읽을 것:
  - 계획: `project-docs/plan/approval-simplify/README.md`의 "정한 것"(shell 규칙은 제품 기본, 전역, project 세 층이고 Settings에 둔다), "뼈대 검토에서 정한 것"(shell 규칙의 pattern, `always`의 줄, `shell.run`의 효과는 `external`), "범위 밖"(coding harness 물음의 자동 답)
  - roadmap: `project-docs/products/roadmap/approval.md`의 "shell 규칙"(층, 전역과 project 규칙은 lophn data에, `always`는 project place면 그 project 층·앱 place면 전역 층, shell의 효과 칸을 지운다, 규칙은 경계가 아니다), "정한 것(agent)"(전역과 project 규칙은 lophn data에, `always`의 층은 place로)
  - architecture: `project-docs/architecture/approval.md`(결정은 사람만 한다), `project-docs/architecture/agent-call.md`(dedup: run-loop는 일시 실패한 read tool을 한 번 더 부른다), `project-docs/architecture/layers.md`(core 층: approvals는 바닥, lophn-agent는 harness)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `approvals`, `config`, `agent-tools`, `project-docs/module-catalog.yaml`의 `packages/core/approvals`, `packages/core/config`, `packages/core/main`
  - 계약: `project-docs/plan/approval-simplify/tasks/ap-contract.md`의 `shell-rules.ts`(`PRODUCT_SHELL_RULES`, `SHELL_RULES_SETTING_KEY`, `shellRulesSettingSchema`), `turn-request.ts`(`always_patterns`). `ap-gate.md`(`judge`, `alwaysPatterns`), `ap-ask-turn.md`(`Approvals`의 `shellRules` dep, `remember(kind, effect)`, `AlwaysEffect = (request, place) => …`), `ap-mode-turn.md`(tool gate가 turn의 mode로 판정한다)
  - 코드
    - `packages/core/lophn-agent/tools/bundles/shell.ts`(지금 `effect: "read"`, gate 없음), `packages/core/lophn-agent/run-loop/retry.ts`(read만 다시 부른다), `packages/core/lophn-agent/run-loop/tool-batch.ts`(read만 나란히 돌고, read 아닌 tool이 실패하면 뒤 호출을 멈춘다), `packages/core/lophn-agent/run-loop/turn.ts`의 `record`(read 아닌 성공은 바뀐 것으로 센다)
    - 설정: `packages/protocol/config/declaration.ts`(`declareSetting`, `SettingsReader`), `packages/core/config/store.ts`(`SettingsStore.update`), `packages/core/main/daemon/wiring/config.ts`(store를 만들고 `settings` 읽기 칸만 낸다), `packages/core/main/daemon/wiring/setting-declarations.ts`(선언을 모은다. config보다 앞이다), `packages/core/apps/tickets/coding/settings.ts`(`declareSetting` 본보기)
    - `packages/core/main/daemon/wiring/approvals.ts`(ap-ask-turn·ap-mode-turn 뒤의 `createApprovals` 조립, `shellRules`가 제품 기본만 내는 자리)
- 계약:
  - 쓰는 것: `PRODUCT_SHELL_RULES`, `SHELL_RULES_SETTING_KEY`, `shellRulesSettingSchema`(ap-contract), `judge`, `alwaysPatterns`(ap-gate), `Approvals`의 `shellRules` dep와 `remember`(ap-ask-turn), turn mode(ap-mode-turn)
  - 내놓는 것: 설정 선언 `approvals.shell_rules`(Settings의 `settings/list`·`settings/update`로 읽고 쓴다). `shell.run`의 gate `{kind: "shell", command}`와 효과 `external`. `always`는 place가 project면 `projects[<prj>]`에, 앱 place와 place 없는 lophn이면 `global`에, request의 `always_patterns`마다 `{pattern, action: "allow"}`를 끝에 더한다(같은 줄이 이미 있으면 더하지 않는다). floor deny는 이 줄로 덮이지 않는다. 사람의 결정(`DecideTurnRequest`, 사람 자격만)에서만 쓰고 agent는 이 설정을 쓰지 못한다(`settings/update`는 사람 자격만).

## 할 일

근거는 README "뼈대 검토에서 정한 것"과 roadmap "shell 규칙"이다. 나누기·맞추기·`always` pattern 만들기는 ap-gate가, 묻고 기다리기는 ap-ask-turn이 만들었다. 이 task는 층을 모으고, 줄을 쓰고, `shell.run`에 gate를 단다. approvals는 바닥 module이라 `packages/core/lophn-agent`를 import하지 않는다.

1. `packages/core/approvals/shell-rules/settings.ts`: `shellRulesSetting = declareSetting({key: SHELL_RULES_SETTING_KEY, type: shellRulesSettingSchema, default: {global: [], projects: {}}})`.
2. `packages/core/approvals/shell-rules/layers.ts`: `shellRuleLayers(value: ShellRulesSetting, place: Place | null): ShellRuleLayers` = `{floor: PRODUCT_SHELL_RULES.floor, layers: [PRODUCT_SHELL_RULES.ask, value.global, place?.kind === "project" ? value.projects[place.id] ?? [] : []]}`. 순수 함수다.
   - 정한 것: 앱 place의 turn은 project 층이 없다(제품 기본과 전역만). 이유: roadmap의 층은 셋이고 앱 층은 없다. `always`도 앱 place면 전역에 쓴다(roadmap "shell 규칙").
3. `packages/core/approvals/shell-rules/always.ts`: `withAlwaysRules(value: ShellRulesSetting, place: Place | null, patterns: readonly string[]): ShellRulesSetting`. place가 project면 `projects[place.id]`, 아니면 `global`의 끝에 `{pattern, action: "allow"}`를 더한다. 그 층에 같은 pattern의 allow 줄이 이미 있으면 건너뛴다. 새 값을 돌려주는 순수 함수다(받은 값을 고치지 않는다).
4. `packages/core/approvals/shell-rules/mod.ts`: `shellRulesSetting`, `shellRuleLayers`, `withAlwaysRules`를 낸다.
5. `packages/core/main/daemon/wiring/setting-declarations.ts`: 목록에 `shellRulesSetting`을 더한다(`../../../approvals/shell-rules/mod.ts`에서 바로 import한다. `packages/core/approvals/mod.ts`는 이 task의 소유가 아니다).
6. 설정 쓰기 길
   - `packages/core/main/daemon/wiring/context.ts`: `Late`에 `settingsUpdate: SettingsStore["update"]`(type은 `packages/core/config/mod.ts`)를 더하고 `LATE_KEYS`에 넣는다. 주석: config가 낸다. 사람의 결정이 Settings 값을 고칠 때만 쓴다.
   - `packages/core/main/daemon/wiring/config.ts`(소유 밖): build에서 `ctx.provide("settingsUpdate", (changes) => store.update(changes))` 한 줄. 지금 core 안에서 Settings를 쓰는 길이 없다(`settings` 칸은 읽기만). 이 한 줄만 고치고 보고의 "넘길 줄"에 적는다(planner에게 소유에 더하기를 요청했다).
   - 정한 것: route를 거치지 않고 store의 `update`를 직접 부른다. 이유: `settings/update`는 memory route라 core 안에서 부를 입구가 없고, 이 쓰기는 사람 자격만 받는 결정 handler 안에서만 일어난다.
7. `packages/core/main/daemon/wiring/approvals.ts`
   - `createApprovals`의 `shellRules`를 `(place) => shellRuleLayers(settings.get(shellRulesSetting) ?? {global: [], projects: {}}, place)`로 바꾼다. `settings`는 `ctx.peek.settings`(config가 approvals보다 먼저 build한다. `packages/core/main/daemon/assembly.ts`의 `WIRINGS` 순서)다. 판정마다 읽어 사람이 Settings에서 고친 값이 다음 호출부터 쓰인다.
   - `service.remember("shell", async (request, place) => …)`: 지금 값을 읽어 `withAlwaysRules(value, place, request.always_patterns)`를 만들고 `ctx.settingsUpdate([{key: SHELL_RULES_SETTING_KEY, action: "set", value: next}])`를 부른다. err이거나 `rejected`가 비어 있지 않으면 `internal` 오류로 돌려준다(그러면 ap-ask-turn의 `decide`가 request를 다시 연다).
8. `packages/core/approvals/{approvals.ts,ports.ts,turn-requests.ts}`: ap-ask-turn이 만든 `shellRules`·`remember`·`always_patterns`로 충분하면 고치지 않는다. 고쳐야 하면 무엇을 왜 고쳤는지 보고한다.
9. `packages/core/lophn-agent/tools/bundles/shell.ts`
   - `effect: "external"`. 정한 것(README "뼈대 검토에서 정한 것"): 판정은 효과가 아니라 shell 규칙으로 하고, 효과는 기록과 재시도에만 쓰인다. `read`면 일시 실패에 한 번 다시 돌아 같은 명령이 두 번 돈다(`packages/core/lophn-agent/run-loop/retry.ts`).
   - `gate: (input) => ({kind: "shell", command: input.command})`.
   - 위 주석 "OS sandbox도 묻기도 없다(Gate를 거치지 않는다)"를 "OS sandbox는 없다. shell 규칙으로 판정한다"로 고친다. model에 보이는 `description`은 고치지 않는다.
   - 효과를 바꾸면 따라오는 것(고치지 않고 보고에 적는다): read와 나란히 돌지 않는다, 시간 초과(`failure`)면 같은 batch의 뒤 호출을 멈춘다, 성공이 turn의 바뀐 것으로 센다, 정의 hash가 바뀐다.
10. 위험 test(새 file `packages/core/lophn-agent/tools/bundles/shell_test.ts`): 아래 한 문장. 메모리뿐이다(process를 띄우지 않는다).
    - `createApprovals`(fake `assignmentOf`, `shellRules`는 `shellRuleLayers({global: [], projects: {}}, null)`, `manualClock`, `createIdSource`)와 `createToolGate`(`packages/core/lophn-agent/tool-judgment/mod.ts`)로 tool gate를 만든다.
    - 정의는 `{...SHELL_TOOLS[0], handler: 부른 것을 세는 fake}`다. 진짜 gate 함수와 효과를 쓰고 `/bin/sh`는 띄우지 않는다.
    - `ToolContext`는 `registry_test.ts` 꼴로 만들고 `gate.check`가 `toolGate.check({..., agent: {role: "lophn"}, place: null, mode: "attended"})`를 부른다. `executeToolCall(ctx, "shell_run", {command: "rm -r build"})`를 시작한 뒤 `approvals.turnRequests(session)`에 request가 열릴 때까지 microtask를 넘긴다(실제 시간을 기다리지 않는다). 그때 handler는 0번이다. `reject`면 결과가 `not_executed`/`rejected`이고 handler는 0번, 다시 열어 `once`면 handler가 1번이다.
    - 이 file은 위 소유 목록에 없다. planner에게 소유에 더하기를 요청했다. 바닥 module인 `packages/core/approvals/approvals_test.ts`는 lophn-agent(`createToolGate`, `SHELL_TOOLS`)를 import하지 못해 여기에 둔다(`tools/check-deps.ts` core 층 규칙).
11. `packages/core/approvals/approvals_test.ts`: ap-ask-turn의 test가 `createApprovals` deps가 바뀌어 깨질 때만 준비를 맞춘다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`packages/core/lophn-agent/tools/bundles/shell_test.ts`): "attended turn에서 ask 규칙에 걸린 shell 명령은 사람이 허락하기 전에 실행되지 않는다". floor deny와 사람 deny가 unattended·skip에서도 막히는 것과 project allow가 floor를 덮지 못하는 것은 ap-gate의 `judge_test.ts`가 본다.
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 찍는다(설정 선언 key가 겹치지 않고 `settingsUpdate` 칸이 찬다).
- 남지 않음: `grep -n "effect: \"read\"" packages/core/lophn-agent/tools/bundles/shell.ts`가 0줄이다. `grep -n "묻기도 없다" packages/core/lophn-agent/tools/bundles/shell.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 6의 `packages/core/main/daemon/wiring/config.ts`, 10의 새 test file
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 9의 효과를 바꾸며 따라온 것을 적는다

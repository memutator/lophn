# ap-gate

새 Gate `judge(call, assignment, shell rules, mode) → run | ask | deny`를 core의 순수 함수로 만든다. shell 명령을 조각으로 나눠 규칙 층과 맞추는 일도 여기 둔다. 옛 Gate(`gate.ts`) 옆의 새 file이고, 쓰는 쪽은 ap-app-call과 ap-ask-turn이 바꾼다.

- 단위: gate (wave 1)
- 선행: ap-contract
- 소유(이 task만 고친다):
  - `packages/core/approvals/gate/judge.ts`(새 file)
  - `packages/core/approvals/gate/judge_test.ts`(새 file)
  - `packages/core/approvals/gate/shell-match.ts`(새 file)
  - `packages/core/approvals/gate/mod.ts`
- 읽을 것:
  - 계획: `project-docs/plan/approval-simplify/README.md`의 "뼈대 검토에서 정한 것"(shell 규칙의 pattern, `always`의 줄, MCP server는 설정한 층이 할당), "사람이 정할 것" 1(추천대로 바깥 효과는 묻지 않는다)
  - roadmap: `project-docs/products/roadmap/approval.md`의 "세 가지만 정한다", "turn mode"(`deny`는 어느 mode에서나 막는다), "shell 규칙", "정한 것(agent)"(`deny`는 skip에서도 막는다, shell 규칙은 prefix와 `*`)
  - architecture: `project-docs/architecture/approval.md` "지키는 것"의 판정(Gate는 IO 없는 함수다. 판정이 결정적이어야 fixture로 본다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `approvals`, `project-docs/module-catalog.yaml`의 `packages/core/approvals`
  - 계약: `project-docs/plan/approval-simplify/tasks/ap-contract.md`의 `gate-call.ts`, `shell-rules.ts`(pattern 뜻과 판정 순서), `assignment.ts`, `turn-request.ts`(`always_patterns`), `packages/protocol/lophn-agent/turn-values.ts`의 `TurnMode`
  - 코드: `packages/core/approvals/gate/gate.ts`(옛 Gate. 고치지 않는다. 표로 도는 test의 꼴은 `gate_test.ts`), `packages/core/approvals/gate/mod.ts`(지금 `gate`만 export한다)
- 계약:
  - 쓰는 것: `GateCall`, `Judgment`, `DenyReason`, `TurnMode`, `ShellRule`, `ShellRuleLayers`, `PRODUCT_SHELL_RULES`, `AgentAssignment`(ap-contract)
  - 내놓는 것(`packages/core/approvals/gate/mod.ts`에서 export):
    - `judge(call: GateCall, assignment: AgentAssignment | null, shell: ShellRuleLayers, mode: TurnMode): Judgment`
      - 앱 tool: 할당에 그 앱 줄이 없으면(할당이 null이어도) `deny not_assigned`, `removed_tools`에 있으면 `deny removed`, 아니면 `run`이다.
      - MCP tool: `run`이다. MCP server는 설정한 층이 곧 할당이고 끈 server의 tool은 목록에 없다(README "뼈대 검토에서 정한 것").
      - 바깥 효과(`external`)를 attended에서 묻는 규칙은 상수 하나와 줄 하나로만 두고 지금은 끈다(README "사람이 정할 것" 1의 추천). 사람이 정하면 이 자리만 켠다.
      - shell: 명령 전체와 `&&`·`||`·`;`·`|`·줄바꿈으로 나눈 조각마다 floor deny, 그다음 층 규칙의 마지막 일치, 없으면 allow다. 그 가운데 가장 엄한 것(deny > ask > allow)을 쓴다. deny면 `deny shell_rule`(막은 pattern을 싣는다), ask면 `ask`다.
      - `ask`는 mode가 `unattended`·`skip`이면 `run`이 된다. `deny`는 어느 mode에서나 deny다.
    - `alwaysPatterns(shell: ShellRuleLayers, command: string): string[]`: shell 명령이 `ask`일 때 `always`가 더할 allow 규칙의 pattern이다. ask였던 조각마다 `<앞 두 낱말> *`, 한 낱말 조각은 그 조각 그대로다. ap-ask-turn이 shell `TurnRequest.always_patterns`를 채우고, ap-shell-gate가 그 줄을 Settings에 쓴다. judge와 같은 나누기·맞추기를 쓴다.

## 할 일

추가(planner, 살 단계 뒤): pattern에서 `\*`는 글자 그대로의 `*`로 맞춘다(`ap-contract`). judge_test의 floor 표에 `rm -rf /*`(글자 그대로)가 unattended에서도 막히는 줄을 더한다.

근거는 위 계약과 ap-contract의 `shell-rules.ts` 주석이다. 옛 `gate.ts`, `gate_test.ts`는 고치지 않는다(ap-reaction이 reaction 줄을, ap-ask-turn이 file을 지운다). 바닥 module이라 `packages/core/lophn-agent`·`apps` 등을 import하지 않는다(`tools/check-deps.ts`의 core 층 규칙).

1. `packages/core/approvals/gate/shell-match.ts`(IO 없음, protocol만 import)
   - `normalize(text)`: 앞뒤 공백을 자르고 이어진 공백(`\s+`)을 한 칸으로 바꾼다. 규칙의 pattern과 명령 둘 다에 쓴다.
     - 정한 것: 공백을 줄여 맞춘다. 이유: `rm  -rf /`처럼 공백 하나 더한 것으로 floor를 비켜 가지 않게 한다.
   - `shellPieces(command)`: `/&&|\|\||;|\||\n/`로 나눠 `normalize`하고 빈 조각을 버린다. 따옴표와 escape를 풀지 않는다(roadmap "하지 않는 것": 명령 parser 없음).
     - 정한 것: 줄바꿈도 조각을 나눈다. 이유: shell에서 줄바꿈은 `;`와 같다. 빼면 두 줄로 쓴 명령의 둘째 줄이 조각으로 보이지 않는다. 한 개 `&`(background)는 나누지 않는다(`2>&1`이 쪼개진다).
   - `shellRuleMatches(pattern, text)`: 둘을 `normalize`하고 pattern을 정규식으로 바꿔 전체 일치(`^…$`)로 본다. `*` 밖의 글자는 모두 escape한다. `*`는 `.*`다. pattern이 ` *`로 끝나면 그 두 글자를 `( .*)?`로 바꾼다.
     - 정한 것: 끝의 ` *`는 없어도 맞는다(`git status *`는 `git status`에도 맞는다). 이유: ap-shell-gate의 `always`가 두 낱말 명령 `git status`에 `git status *`를 더하는데, 그 줄이 그 명령 자신에 맞아야 다시 묻지 않는다.
   - `shellVerdict(shell, text)`: `shell.floor`에서 맞는 줄이 있으면 `{action: "deny", pattern}`. 아니면 `shell.layers`를 차례로 이어 본 가운데 마지막에 맞은 줄의 `{action, pattern}`. 없으면 `{action: "allow", pattern: null}`. floor 줄은 모두 deny로 본다(계약: floor는 deny 목록이다).
   - `alwaysPatterns(shell, command)`: `shellPieces`의 조각 가운데 `shellVerdict`가 ask인 것마다, 낱말(한 칸으로 나눈 것)이 하나면 그 조각, 둘 이상이면 `<첫 낱말> <둘째 낱말> *`. 겹치면 하나만, 처음 나온 순서로 둔다. 명령이 조각 둘 이상이고 명령 전체가 ask이면 `normalize(command)`(`*`가 없으면 그 명령에만 맞는다)도 더한다.
     - 정한 것: 명령 전체가 ask인 경우(`curl * | sh *`처럼 조각을 이어야 맞는 규칙)에는 그 명령 전체를 줄로 더한다. 이유: 조각 줄만 더하면 전체 규칙이 남아 같은 명령을 다시 묻는다. 두 낱말로 줄이지 않는 것은 `curl -fsSL *`가 다른 주소의 `| sh`까지 열기 때문이다.
     - 명령 안에 `*`가 있으면(`rm -r *.log`) 만든 pattern도 그 `*`를 wildcard로 읽는다. 규칙은 실수를 줄일 뿐 경계가 아니다(roadmap "shell 규칙"). 보고의 "알려진 미완 동작"에 적는다.
2. `packages/core/approvals/gate/judge.ts`
   - `const ASK_EXTERNAL_WHEN_ATTENDED = false;` 와, 앱 tool·MCP tool에서 `ASK_EXTERNAL_WHEN_ATTENDED && call.effect === "external"`이면 `askIn(mode)`를 내는 줄 하나. 주석은 "사람이 정할 것" 1을 가리키는 한 줄이다.
   - 앱 tool: `assignment?.entries.find((entry) => entry.app === call.app)`. 없으면 `{kind: "deny", reason: "not_assigned", pattern: null}`, `removed_tools.includes(call.tool)`면 `reason: "removed"`, 아니면 위 줄, 그다음 `run`.
   - MCP tool: 위 줄, 그다음 `run`. 할당을 보지 않는다.
   - shell: 후보는 `normalize(command)`와 `shellPieces(command)`(겹치면 하나). 후보마다 `shellVerdict`. deny가 하나라도 있으면 그 첫 deny의 pattern으로 `{kind: "deny", reason: "shell_rule", pattern}`, 아니면 ask가 있으면 `askIn(mode)`, 아니면 `run`.
   - `askIn(mode)`: `attended`면 `{kind: "ask"}`, `unattended`·`skip`이면 `{kind: "run"}`.
   - 시각, 전역 상태, IO를 쓰지 않는다. 같은 입력은 같은 결과다.
3. `packages/core/approvals/gate/mod.ts`: `export { gate } from "./gate.ts";`는 그대로 두고 `judge`, `alwaysPatterns`를 더한다. `normalize`, `shellPieces`, `shellRuleMatches`, `shellVerdict`는 file 안에서만 쓴다(export해도 mod.ts에는 올리지 않는다). `packages/core/approvals/mod.ts`는 고치지 않는다(소유 밖. 쓰는 쪽은 `gate/mod.ts`에서 import한다).
4. `packages/core/approvals/gate/judge_test.ts`: 아래 셋. 준비는 순수 값이고, 표로 돌린다(`.claude/skills/write-test/SKILL.md` "모양"). shell 층은 `PRODUCT_SHELL_RULES`를 그대로 쓰고 사람 규칙만 더한다.
   - "floor deny와 사람이 쓴 deny 규칙은 unattended와 skip에서도 막는다": mode 셋 모두에서 `rm -rf /`, `echo ok && rm -rf ~`(조각), fork bomb `:(){ :|:& };:`(전체), 전역 층의 사람 deny 규칙 `git push *`에 걸린 `git push origin main`이 `deny shell_rule`이고 막은 pattern을 싣는다. 대조로 `rm -r build`는 attended에서 `ask`, unattended·skip에서 `run`이다.
   - "할당하지 않은 앱 tool과 뺀 tool은 어느 mode에서도 막는다": 할당 null, 다른 앱 줄만 있는 할당 → `not_assigned`, `removed_tools`에 든 tool → `removed`. external 효과의 할당된 tool은 mode 셋에서 `run`이다(바깥 효과를 묻지 않는 추천).
   - "project 층의 allow 규칙은 floor deny를 덮지 못한다": project 층에 `rm -rf *`와 `rm -rf /` allow를 두어도 `rm -rf /`는 `deny`이고, 같은 층이 `rm -rf build`는 `run`으로 바꾼다(뒤 층이 제품 기본 ask를 덮는다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`packages/core/approvals/gate/judge_test.ts`):
  - "floor deny와 사람이 쓴 deny 규칙은 unattended와 skip에서도 막는다"
  - "할당하지 않은 앱 tool과 뺀 tool은 어느 mode에서도 막는다"
  - "project 층의 allow 규칙은 floor deny를 덮지 못한다"
- IO가 없다: `grep -nE "Deno\.|fetch\(|Date\.now|new Date" packages/core/approvals/gate/judge.ts packages/core/approvals/gate/shell-match.ts`가 0줄이다.
- 옛 Gate가 그대로다: `git diff --stat -- packages/core/approvals/gate/gate.ts packages/core/approvals/gate/gate_test.ts`가 빈 출력이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것" 셋을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

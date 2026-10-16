# agent-tools-work

lophn 상태를 다루는 domain tool을 S4 4장 표대로 새로 짓는다: ticket, 문제, 앱, blueprint, package, release, 안내, 앱 카드, 지침 읽기, Operator 만들기·고치기. 옛 tool(`ticket.make_ready`, `problem.set_interpretation`, `snapshot.read`, `visual.prepare_document` 등)은 지운다.

- 단위: agent-tools (wave 3)
- 선행: agent-tools-registry (`ToolDefinition`, `defineBuiltin`, `ToolContext`, 껍데기 `bundles/*.ts`)
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/bundles/ticket.ts`, `problem.ts`, `app.ts`, `package.ts`, `release.ts`, `guide.ts`, `operator.ts`, `visual.ts`, `instructions.ts`
  - `packages/core/lophn-agent/tools/domain/` (새 폴더: 위 묶음이 나눠 쓰는 순수 함수. 예: `operator-place.ts`, `app-card.ts`)
- 읽을 것:
  - inventory(lead가 맞추며 더함): `I2.12#2`
  - spec: S4 4장(자원별 tool, role이 갖는 tool), 9장, 11장 18 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - inventory: `I1.4#7`, `I1.4#8`, `I1.4#9`, `I1.12#1`, `I2.4#15`, `I2.4#16`, `I2.4#17`, `I2.4#18`, `I2.4#19`, `I2.4#22`(tool 쪽만. 안내 본문 `roles/lophn/guides`는 agent-definition-roles), `I3.4#13`, `I3.4#14`, `I3.4#15`, `I3.4#16`, `I3.4#17`, `I3.4#18`, `I3.4#20`(tool 쪽), `I3.4#31`
  - 결정: `../README.md` 3장 #3, #41
  - 옛 구현은 이 task가 시작할 때 이미 껍데기다. 읽을 때는 git에서 본다: `git log --oneline -- packages/core/lophn-agent/tools/bundles/ticket.ts`로 껍데기 직전 commit을 찾아 `git show <commit>:<path>`.
- 계약:
  - 쓰는 것: `protocol/lophn-agent/tool-catalog.ts`의 `TOOL_INPUTS`(contract-agent-tools-catalog). 부르는 소유 route는 각 contract에서 찾는다.
    - ticket: contract-coding의 `protocol/coding-agent/ticket-routes.ts`
    - 문제: contract-releases-problems의 `protocol/problems`
    - 앱, release, package, blueprint 검사: contract-app-calls와 contract-releases-problems의 `protocol/apps`
    - Operator: contract-calls-places의 `operator.create`·`operator.update` route
    - 지침 읽기: contract-agent-tools-config의 `instructionsGet`
  - 내놓는 것: 아홉 묶음의 `*_TOOLS` export.

## 할 일

각 묶음은 `defineBuiltin`으로 정의하고, 입력 schema는 `TOOL_INPUTS[이름]`을 쓴다. 효과는 표의 값이다. route 호출은 `ToolContext.core`(agent 자격)로 한다.

| 묶음 | tool (효과) | 비고 |
|---|---|---|
| `ticket.ts` | `ticket.list`(read), `ticket.get`(read), `ticket.create`(write), `ticket.update`(write), `ticket.verify`(write), `ticket.cancel`(write) | `ticket.create`는 목표, acceptance check 하나, 근거 링크로 연다. `ticket.get`은 claim, 완료 보고, check 결과를 싣는다. `ticket.verify`는 `result`를 route에 그대로 넘기고 확인됨이면 activation은 program이 한다. `ticket.make_ready`, `needs`, `adoption_questions`, `missingForReady`, `TICKET_EXTRA_NEEDS_MAX`는 지운다 (`I1.4#9`) |
| `problem.ts` | `problem.list`(read), `problem.get`(read), `problem.set_state`(write) | `problem.get`은 발생, stack, log, release, 제보를 한 번에 준다. `snapshot.read`, `verification.read`, `repair.read`, `report.read`는 `problem.get`에 합치고 `problem.set_interpretation`과 `LinkProblemInterpretation` 연결은 지운다 (`I1.4#7`, `I1.4#8`) |
| `app.ts` | `app.list`(read), `app.get`(read), `app.create`(write), `app.link_source`(write), `blueprint.check`(read) | `app.get`은 상태, 활성 release, 열린 문제 수, source. `app.read`, `app.read_purpose`, `app.blueprint`, `app.commands`, `app.health`, `app.invocations`는 지운다 |
| `package.ts` | `package.list`(read), `package.get`(read), `package.publish`(write) | 옛 `sdk.list`, `sdk.contract`, `sdk.examples`를 대신한다 |
| `release.ts` | `release.list`(read), `release.get`(read) | 준비 결과, test 결과, activation 결과와 실패 근거 |
| `guide.ts` | `guide.read`(read), `settings.get`(read) | 옛 `lophn.guide`, `setting.read`. 안내 본문은 `roles/lophn/guides`(agent-definition-roles)에서 읽는다. 문서 판이 없으니 "새 version 요청"은 뺀다 |
| `visual.ts` | `visual.show`(read) | 대화에 앱 카드만 보인다. `view`가 그 앱 blueprint 화면이고 `card` 크기를 선언했는지 검사하고, 아니면 같은 거절로 돌려준다. 표·차트·도표 블록, `visual.prepare_document`, `visual.read`는 지운다 (`I1.12#1`). 카드는 `app_card` message part(`protocol/lophn-agent/message-content.ts`)로 올린다 |
| `instructions.ts` | `instructions.read`(read) | lophn만 갖는다. 고른 project의 `LOPHN.md`를 `instructionsGet`(layer `project`, `project` 칸)로 읽어 돌려준다. 결과는 data가 아니라 지침으로 표시한다. 읽는 길은 `instructions/files.ts`를 재사용하지 않고 route로만 한다 |
| `operator.ts` | `operator.create`(설정 고치기), `operator.update`(설정 고치기) | Project Manager는 자기 project의 Operator만, App Engineer는 자기 앱의 Operator만 만들고 고친다. 다른 place의 Operator면 거절한다. grant와 앱 Operator의 project 폴더는 입력에 없고 사람이 정한다 (S4 11장 18). 효과가 설정 고치기라 `executeTool`이 실행 전에 Gate에 묻는다 |

1. 묶음 아홉 개를 위 표대로 짓는다. 옛 file 내용에서 쓸 만한 handler(결과를 `limitJson`으로 자르고 이어 읽기를 안내하는 방식)는 새 이름에 맞게 옮긴다.
2. `domain/operator-place.ts`: `operatorPlaceAllowed(role, ownPlace, target)` 순수 함수. `ownPlace`는 `ToolContext.place`다.
3. 지워지는 것의 사용처가 남지 않게 한다: `grep -rn "ticket.make_ready\|problem.set_interpretation\|snapshot.read\|verification.read\|repair.read\|visual.prepare_document\|app.screen_context" packages tools`.
4. `visual.show`는 `tools/visuals/`(wave 1 remove-app-extras가 지움)에 의존하지 않는다. 필요한 검사는 `domain/app-card.ts`에 새로 쓴다.
5. (lead가 맞추며 더함 (`I2.12#2`)) 시각 블록 출처 `document`(문서 id, 판 id, section)를 새 문서 모델에 맞추기

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "Project Manager는 다른 project의 Operator를 만들거나 고치지 못하고, App Engineer는 다른 앱의 Operator를 만들거나 고치지 못한다" — `domain/operator-place_test.ts`가 role과 place의 조합을 표로 돌린다.
- 남지 않음: 3번의 grep이 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: tool별 route 이름 대응(어느 contract의 어느 route를 불렀는지), `app.create` 입력 칸(`name`, `purpose`), 카드를 올리는 방식
- 계약 바꾸기 요청: route가 없는 tool이 있으면 그 이름(예: `blueprint.check`의 검사 route, 앱 source 연결 route)

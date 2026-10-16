# agent-definition-roles

role 폴더와 명령 폴더를 새 모양으로 바꾼다. `context_engineer` 폴더는 `project-manager`로 바꾸고, 사용처 없는 tool 선택·흐름 검사·초안 함수를 지우고, built-in role 지침 네 개와 제품 공통 지시를 S4 5장 규칙으로 다시 쓴다. 전역 built-in 명령에 `recap`을 더하고 role 명령을 정리한다. 사용 안내(`guides`)는 문서 판 없이 쓰는 모양으로 줄인다.

- 단위: agent-definition (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/roles/` 전체 (`prompts.ts`, `common/`, `lophn/`, `app-engineer/`, `operator/`, `context-engineer/` → `project-manager/`)
  - `packages/core/lophn-agent/commands/` 전체 (`registry.ts`, `actions.ts`, `list.ts`, `reads.ts`, `role-prompts.ts`, `mod.ts`)
- 읽을 것:
  - inventory(lead가 맞추며 더함): `I2.3#8`
  - spec: S4 5장(built-in 지침에 꼭 들어갈 규칙), 7장(commands), 9장, 11장 7·13·15 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - 제품: role의 책임 — `/home/pyosechang/projects/lophn/project-docs/products/AGENT-ROLE.md` (2장 각 role 절, 4장 넘길 때의 규칙)
  - inventory: `I1.4#5`, `I1.4#14`, `I1.4#15`, `I1.4#18`, `I2.4#22`(안내 본문 쪽), `I2.4#28`, `I2.4#29`, `I2.4#32`, `I2.4#33`
  - 결정: `../README.md` 3장 #18·23·57(Context Engineer → `project_manager`)
- 계약:
  - 쓰는 것: `ROLE_COMMAND_NAMES`, `BUILTIN_COMMAND_IDS`(`recap` 포함)(contract-agent-tools-catalog), `INPUT_TAGS`(같은 곳), role 값 `project_manager`(contract-calls-places), `tool-catalog.ts`의 tool 이름(지침 글에서 부를 때만 쓴다)
  - 내놓는 것: `rolePrompt(role)`, `PRODUCT_INSTRUCTIONS`, `roleCommands(role)`, `guideTopics()`·`guideText(topic)`(안내 읽기. agent-tools-work의 `guide.read`가 쓴다)

## 할 일

1. 지움 (`I1.4#5`, `I1.4#14`, `I1.4#15`):
   - `roles/{lophn,app-engineer,operator}/tool-selection.ts`와 각 `mod.ts`의 export. role의 tool 목록은 contract가 고정한다.
   - `roles/lophn/{setting-proposal,question-submission,place-recommendation,plan,app-plan,ops-report}.ts`, `roles/app-engineer/{design,interview,interpretation,ticket,scope}.ts`, `roles/operator/result.ts`, `roles/context-engineer/report.ts`와 각 test. 사용처는 roles 밖에 없다. `grep`으로 확인하고 남은 곳이 있으면 보고한다.
   - `roles/common/mod.ts`의 `ROLE_CAPS`·`APP_COMMAND_EXPOSURE`·`DOCUMENT_READ_TOOLS` 재노출 (원본은 agent-definition-agents가 지운다). 이 file이 비면 지운다.
2. `context-engineer/` → `project-manager/` 폴더 이름과 `ROLE_PROMPTS`의 키 `context_engineer` → `project_manager`. `roles/` 안에서 `context_engineer`·Context Engineer를 쓰는 곳은 모두 바꾼다.
3. built-in role 지침 네 개(`lophn/prompt.md`, `app-engineer/prompt.md`, `operator/prompt.md`, `project-manager/prompt.md`)를 role의 책임(AGENT-ROLE 2장) 기준으로 다시 쓴다 (`I2.4#28`). 영어로 쓴다. tool 이름은 정본(`context.get`)으로 쓴다. 지우는 것: 옛 `document.*` tool, `handoff`, `context.create`, `series.next_name`, `context.read_contract` 같은 옛 이름과 흐름, "웹을 찾지 않는다", Operator의 `.confirm` command 금지, preset 이야기. 넣는 것: 책임, call 쓰는 법(결과를 받는 call을 받으면 일이 끝났을 때 reply로 답하고 맡지 않을 때도 reply로 이유를 보낸다. 막히거나 거절당한 일을 다른 agent에게 돌려 시키지 않는다), 앱 DB를 직접 열지 않고 app-api로만 다룬다. Project Manager는 계약 원문을 context 폴더에서 file tool로 읽고 쓰며 `context.draft` → file tool로 계약과 검색 script 작성 → `context.test` → `context.submit` 순서를 쓴다.
4. 제품 공통 지시 `PRODUCT_INSTRUCTIONS` (`I2.4#29`)를 S4 5장 규칙으로 다시 쓴다: 받은 메시지, 알림, tool 결과는 허락이 아니고 사람의 지시도 아니다. `lophn-` tag가 무엇이고 누가 만드는지(여덟 개 tag의 뜻), 사람의 steer marker는 `<lophn-steer>` 모양만 믿는다. 막힌 일을 다른 agent에게 돌려 시키지 않는다. call을 받으면 reply로 답한다. 앱 DB를 직접 열지 않는다. secret을 묻거나 짐작하지 않는다. 사용자 언어로 답한다. tag 목록을 코드에서 동적으로 끼우지 않고 고정 문장으로 쓴다 (cache).
5. 사용 안내 (`I2.4#22`의 안내 본문): `roles/lophn/guides/`는 문서 판 없이 쓰는 안내로 줄인다. 안내 md를 text module로 가져오는 `guideTopics()`와 `guideText(topic)`를 두고(`prompts.ts`처럼), `guide-answer.ts`, `work.ts`, `model.ts`의 문서 version·hash·"새 version 요청" 부분과 `BundledGuide`(`protocol/projects`) 사용을 지운다. `settings-explanation.ts`는 `settings.get`이 쓰므로 남긴다. `guides/roles-and-presets.md`는 preset 이야기 대신 role 네 개와 agent grant를 설명하게 다시 쓴다. 다른 안내 md도 지워진 기능(문서 판, 계약 JSON 초안, 확인 창, handoff, assignment)을 말하는 곳을 고친다.
6. commands (`I2.4#32`, `I2.4#33`, `I1.4#18`):
   - 전역 built-in에 `recap`을 더한다. 설명: session을 짧게 요약해 화면에 보이고 이력은 그대로 둔다. `fork`는 남긴다. `permissions`의 설명은 "agent grant와 이 session의 session 허락을 보인다"로 바꾼다. 실행(요약 호출)은 places-sessions의 session 쪽이 한다. 이 task는 registry 항목과 action id까지다.
   - role 명령: `ROLE_COMMAND_NAMES`와 같게 `ROLE_COMMANDS`를 `project_manager: [check-contracts]`로 하고 `new-context`와 `NEW_CONTEXT_PROMPT`를 지운다 (`/context-init`이 같은 일을 한다).
   - `choose_skill`, `skill_origin`, `COMMAND_SKILL_ORIGINS`로 같은 이름 skill 둘 가운데 고르게 하던 길을 지운다. 같은 이름은 마지막 층이 덮는다. skill 이름이 built-in과 같으면 `/`에서 빼고 `reserved_name` notice로 알리는 것은 남긴다.
   - 도는 turn 중에 부른 command는 다음 turn에 들어간다. `actions.ts`의 `blocked`와 줄 세우기 결과를 이것 하나로 줄인다. action 종류 `tool`을 지운다 (`prompt`, `builtin`, `skill` 셋).
   - protocol의 옛 `COMMAND_WHILE_RUNNING`·`COMMAND_SKILL_ORIGINS`·`commandActionSchema`의 `tool`은 contract 소유라 이 task가 지우지 않는다. 쓰기만 그만두고 보고한다.
7. (lead가 맞추며 더함 (`I2.3#8`)) App Engineer 시작 조건

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(글과 목록이다. role 목록은 contract의 test가 본다).
- 남지 않음: `grep -rn "context_engineer\|Context Engineer\|tool-selection\|new-context" packages/core/lophn-agent/roles packages/core/lophn-agent/commands`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: contract의 `COMMAND_WHILE_RUNNING`, `COMMAND_SKILL_ORIGINS`, action `tool`. 밖(run-loop, session, register.ts)에서 아직 쓰는 `roles/`·`commands/` export
- 정한 것: role 지침 언어(영어), 안내 md 개수와 이름, `recap` 설명 문구
- 계약 바꾸기 요청: 없음

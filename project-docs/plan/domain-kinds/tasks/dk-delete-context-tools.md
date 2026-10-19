# dk-delete-context-tools

agent가 보던 context 쪽을 지운다: tool 일곱과 `glossary.set`(`context.list/get/search/draft/test/submit/violations`), 그 tool을 돕는 file, role의 tool 목록, agent credential의 context route, 옛 prompt의 context 글(`<lophn-context>`)과 그 type. 새 tool(`kind.list`·`kind.check`·`file.outline`)과 kind 글은 건드리지 않는다.

코드 이름은 아직 `project_manager`다.

- 단위: cleanup (wave 3)
- 선행: dk-operator-contexts
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/tools/context.ts`
  - `packages/core/agent-roles/tools/context/`
  - `packages/core/agent-roles/tools/mod.ts`
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/core/agent-roles/credentials.ts`
  - `packages/core/agent-roles/place/active-contexts.ts`
  - `packages/core/lophn-agent/run-loop/runtime-access.ts`
  - `packages/core/lophn-agent/ports.ts`
  - `packages/core/lophn-agent/prompt-assembly/context-text.ts`
  - `packages/core/lophn-agent/prompt-assembly/context-text_test.ts`
  - `packages/core/lophn-agent/prompt-assembly/mod.ts`
  - `packages/protocol/lophn-agent/context-text.ts`
  - `packages/protocol/lophn-agent/mod.ts`
  - `packages/protocol/lophn-agent/tool-catalog.ts`
  - `tools/check-deps.ts`
  - `tests/eval/versions/files.ts`
- 읽을 것:
  - plan: `project-docs/plan/domain-kinds/README.md`("정한 것"), roadmap `project-docs/products/roadmap/domain.md`의 "context에서 무엇이 어디로 가나"(`context.*` tool, 화면은 지운다)
  - architecture: `project-docs/architecture/agent-definition.md`(tool 목록, prompt 조립), `project-docs/architecture/layers.md`와 `tools/check-deps.ts`(`HARNESS_LEFTOVERS`: 위반을 다 없앤 file은 목록에서 빼라고 검사가 알려 준다)
  - 고칠 곳(확인된 위치):
    - `agent-roles/tool-lists.ts`: `READ_TOOLS`의 `context.list/get/search/test/violations`(≈:38~42), `ROLE_WRITE_TOOLS.project_manager`의 `context.draft`·`context.submit`·`glossary.set`(≈:69~71. `operator.create`·`operator.update`는 남긴다), `TOOL_ORDER`의 같은 이름들(≈:128~135, `glossary.set` 포함). 이 file은 `domain-tools`·`domain-place`·`dk-agent-tools`도 고친다. 지우는 줄만 건드린다.
    - `agent-roles/credentials.ts`: `PLACE_READS`의 `contextListRoute/contextGetRoute/contextContractRoute/glossaryListRoute`와 그 import
    - `lophn-agent/run-loop/runtime-access.ts`: import(≈:2~6)와 `RUNTIME_MACHINE_ROUTES`의 `contextListRoute/contextGetRoute/contextContractRoute`(≈:123~127)와 그 앞 주석
    - `lophn-agent/ports.ts:34`: `ProjectDirectory.contextsOf`(아무도 구현·사용하지 않는다)
    - `lophn-agent/prompt-assembly/mod.ts`: `buildContextText`·`ContextRead`·`renderContextText`(옛 export 줄). `FolderRead`는 `kind-text.ts`가 내므로 import 하는 쪽이 이미 옮겨졌는지 확인한다
    - `protocol/lophn-agent/mod.ts:38`: `export * from "./context-text.ts"`
    - `protocol/lophn-agent/tool-catalog.ts:11`: 주석의 예 `context.get`→`context_get`을 다른 tool(예 `kind.list`→`kind_list`)로
    - `tools/check-deps.ts`: ≈:67 주석(contexts/ledger/deps.ts를 projects → apps 예외의 이유로 든 줄)과 `HARNESS_LEFTOVERS`의 `runtime-access.ts` 이유 글("projects·apps protocol의 route 값" → apps만 남았는지 확인하고 글을 맞춘다. projects protocol import가 모두 사라졌으면 `HARNESS_DOMAIN_PROTOCOLS`는 그대로 두고 이유 글만 고친다)
    - `tests/eval/versions/files.ts`: `TOOL_FILES`의 `packages/core/agent-roles/tools/context.ts` 줄
  - 테스트 규칙: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음(지우기만)

## 할 일

1. `rg -n "tools/context|CONTEXT_TOOLS|renderContextText|buildContextText|ContextRead|ContextText|CONTEXT_TEXT_TAG|contextTextSchema|contextGetOutputSchema|activeContextsOf|glossary\\.set|context\\.(list|get|search|draft|test|submit|violations)" packages tools tests --glob '!tests/eval/runs/**' --glob '!tests/eval/scorecards/**' --glob '!tests/eval/registry/**'`로 쓰는 곳을 모두 본다. 이 task 소유 밖에서 쓰는 곳이 남아 있으면 지우지 말고 보고한다.
2. 위 위치를 지운다. file 삭제: `agent-roles/tools/context.ts`, `tools/context/{draft,search,visible,visible_test}.ts`, `place/active-contexts.ts`, `prompt-assembly/context-text.ts`, `context-text_test.ts`, `protocol/lophn-agent/context-text.ts`.
3. `tool-lists_test.ts`가 있으면(wire 이름 충돌 검사) 그대로 통과해야 한다.
4. `deno task check`를 돌려 type 오류를 따라간다.

## 정한 것

- `tests/eval/registry/tool/context.*.json`은 `dk-delete-eval`이 지운다. 이 task는 `tests/eval/versions/files.ts`의 `TOOL_FILES` 한 줄만 고친다.
- `visible_test.ts`(옛 context 가시성 규칙의 test)는 지운다. 새 규칙(project place 밖에서 kind tool을 못 쓴다)은 `kind_test.ts`가 본다(`dk-agent-tools`).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 지우는 `visible_test.ts`가 지키던 "Operator가 붙지 않은 context를 못 읽는다"는 경계는 이제 읽는 project가 place 하나로 정해져 사라졌다(`kind_test.ts`가 place 밖을 거절한다).
- 남지 않음: 위 1번의 `rg`가 0줄이다(소유 밖 file의 이유 있는 남음은 보고). `rg -n "contexts_changed|lophn-context" packages`가 0줄이다.
- core 기동: `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 찍는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것
- 넘길 줄: `tool-lists.ts`는 다른 계획도 고친다(지운 줄만)
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

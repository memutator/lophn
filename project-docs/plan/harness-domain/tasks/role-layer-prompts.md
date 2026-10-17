# role-layer-prompts

role마다의 prompt 내용과 place 정보를 role 층(`packages/core/agent-roles`)으로 옮긴다: `roles/`(role prompt 넷, guide 여덟, `PRODUCT_INSTRUCTIONS`), `prompt-assembly/place-info.ts`(role별 place 글, 보이는 context), `run-loop/place-data.ts`(role별로 place 재료와 file 범위를 core 읽기로 모으는 일). harness의 `turn-prompt.ts`와 `prepare.ts`는 role을 모르고, role 층이 만든 글과 재료를 받는다.

- 단위: role-layer (wave 2)
- 선행: role-layer-tools
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/`
  - `packages/core/lophn-agent/roles/`
  - `packages/core/lophn-agent/prompt-assembly/{place-info.ts,place-info_test.ts,turn-prompt.ts,basis.ts,model.ts,mod.ts}`
  - `packages/core/lophn-agent/run-loop/{place-data.ts,place-data_test.ts,prepare.ts,mod.ts}`
  - `packages/core/main/agent-runtime/product-driver.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`("흐름", "같은 재료는 같은 bytes다", "place 정보에는 잘 안 바뀌는 목록만 넣는다", "context 글은 program이 적용된 판에서 결정적으로 조립한다"), `project-docs/architecture/layers.md`("harness와 lophn domain")
  - roadmap: `project-docs/products/roadmap/harness-domain-split.md`("harness 안에 있는 domain 지식", "단계" 3번)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `run-loop`
- 계약:
  - 쓰는 것: `role-layer-tools`가 만든 `packages/core/agent-roles/`와 `PreparerDeps.roleTools`. 이미 있는 `PreparerDeps.rolePrompt(role)`.
  - 내놓는 것:
    - `rolePrompt(role)`(`agent-roles/roles/prompts.ts`)가 `${PRODUCT_INSTRUCTIONS}\n\n${role prompt}`를 돌려준다. 지금 `turn-prompt.ts`가 이어 붙이는 바로 그 bytes다.
    - `TurnPromptInput`(`prompt-assembly/turn-prompt.ts`)에서 `role`, `place: PlaceData`, `context_budget`이 없어지고 `place: { text: string; contexts: readonly PlaceContext[]; agents: readonly PlaceAgent[]; show_project: boolean }`이 생긴다. `text`는 지금 `placeInfo(...)`가 만드는 "place" system block 글, `contexts`는 `visibleContexts`가 거른 것, `show_project`는 `place.project === null`을 뜻하는 notice 옵션(`renderContextText(…, { project })`)이다.
    - `PlaceContext`, `PlaceAgent` type은 harness(`prompt-assembly/model.ts`)에 남는다(`basis.ts`와 `turn-prompt.ts`의 notice가 쓴다). `PlaceData`, `PlaceProject`, `placeInfo`, `visibleContexts`, `ROLE_LABEL`, `readPlaceData`, `appSourceScope`, `readContext`는 role 층으로 간다.
    - `PreparerDeps`에 `placeData(call, resolved)`를 더한다: `Promise<Result<{ place: TurnPromptInput["place"]; scope: { read: string[]; write: string[] } }>>`. `main/agent-runtime/product-driver.ts`가 role 층의 구현을 꽂는다.

## 할 일

근거: README `role-layer` 단위, roadmap "harness 안에 있는 domain 지식", "단계" 3번. `context-text.ts`는 role 규칙이 없다(role 문자열 없음, `toWireToolName`만 쓴다). 그대로 harness에 둔다.

1. snapshot을 뜬다: role 4개 각각의 (a) `rolePrompt` 결과 대신 옛 `${PRODUCT_INSTRUCTIONS}\n\n${rolePrompt(role)}` 글, (b) `assembleTurnPrompt`의 `system` block 글 네 장(role, instructions, skills, place)을 고정 fixture 입력으로 만든 결과. `packages/core/.tmp-probe/`에 script를 두고 끝낼 때 지운다. 끝에 byte가 같아야 한다. fixture는 `place-info_test.ts`가 쓰는 `PlaceData`를 가져다 쓴다.
2. `tools/move-files.ts`로 옮긴다.
   - `lophn-agent/roles/` 전체(`prompts.ts`, `guides.ts`, md 12개) → `agent-roles/roles/`
   - `lophn-agent/prompt-assembly/place-info.ts`와 `place-info_test.ts` → `agent-roles/place/`
   - `lophn-agent/run-loop/place-data.ts`와 `place-data_test.ts` → `agent-roles/place/`
3. `agent-roles/roles/prompts.ts`의 `rolePrompt`가 `PRODUCT_INSTRUCTIONS`를 앞에 붙여 돌려주게 한다. `turn-prompt.ts`는 `["role", input.role_prompt]`로 쓰고 `PRODUCT_INSTRUCTIONS` import를 지운다. `role_prompt`의 주석을 "제품 고정 규칙을 포함한 role 지침 글"로 고친다.
4. `PlaceContext`, `PlaceAgent`를 `prompt-assembly/model.ts`로 옮기고(`ContextText`, `Role` type만 쓴다) `basis.ts`, `mod.ts`를 맞춘다. `place-info.ts`는 `PlaceData`(`project`, `app`, `agents`, `contexts`, `release`)를 role 층에서 계속 정의한다.
5. `turn-prompt.ts`: `role`·`place: PlaceData`·`context_budget`을 위 `place` 값으로 바꾼다. `placeInfo(...)` 호출은 `input.place.text`, `visibleContexts(...)` 두 곳(notice, `basisOf`)은 `input.place.contexts`, `input.place.project === null`은 `show_project`, `agents`는 `input.place.agents`. `Role`·`toWireToolName` 말고 role 이름을 쓰지 않는다.
6. `run-loop/prepare.ts`: `readPlaceData(agentCall, resolved)` 호출을 `deps.placeData(agentCall, resolved)`로 바꾼다. `CONTEXT_TEXT_BUDGET`(12000) 상수는 role 층의 place 구현으로 옮긴다. `scope.read.push(...)`·`scope.write.push(...)`는 그대로 반환값에서 받는다. prompt의 `role` 칸을 지운다(`resolved.role`을 prompt 입력에 넘기지 않는다). `run-loop/mod.ts`가 place-data를 내보내면 지운다.
7. `agent-roles/place/`에서 `placeData(call, resolved)` 구현을 만든다: 옛 `readPlaceData` 결과로 `placeInfo(role, data, CONTEXT_TEXT_BUDGET)`, `visibleContexts(role, data)`, `agents`, `show_project`를 계산해 위 모양으로 돌려준다. `agent-roles/tools/context.ts`의 `readContext` import가 새 위치를 가리키는지 본다(`move-files.ts`가 고친다).
8. `agent-roles/credentials.ts`의 `PLACE_READS`(`role-layer-tools`가 옮겨 둔 것)에 "place-data가 읽는 route와 같아야 한다"는 주석이 맞게 남아 있는지 본다. route를 더하거나 빼지 않는다.
9. `main/agent-runtime/product-driver.ts`가 `rolePrompt`, `placeData`를 `agent-roles`에서 꽂는다.

## 끝남

- `deno task check`가 통과한다.
- 동작 비교: 1번의 글 전후가 byte까지 같다. `agent-roles/place/place-info_test.ts`, `place-data_test.ts`가 통과한다. `tools/registry_test.ts`, `main/agent-tools_test.ts`가 통과한다.
- 위험 test: 없음 (옮기기와 인자로 바꾸기뿐이다. prompt bytes는 위 snapshot 대조가 지킨다)
- 남지 않음:
  - `ls packages/core/lophn-agent/roles packages/core/lophn-agent/run-loop/place-data.ts packages/core/lophn-agent/prompt-assembly/place-info.ts`가 모두 없다고 나온다.
  - `grep -rnE "agent-roles|PRODUCT_INSTRUCTIONS|visibleContexts|placeInfo\(" packages/core/lophn-agent --include=*.ts`가 0줄이다.
  - `grep -nE "project_manager|app_engineer|\"operator\"|\"lophn\"" packages/core/lophn-agent/prompt-assembly/*.ts packages/core/lophn-agent/run-loop/prepare.ts`가 0줄이다(`_test.ts` 제외).
  - `packages/core/.tmp-probe/`가 없다.

## 지켜야 할 것(계획 README)

- 동작을 바꾸지 않는다. agent가 보는 tool 목록과 입력이 role마다 나누기 전과 같아야 한다(`tools/registry_test.ts`가 role별 목록을 본다).
- tool 정의 file은 agent runtime child에서 실린다. domain의 store나 DB 코드를 import하지 않는다(`layers.md` "실행 때 import가 뜻하는 것").
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: `place` 값의 모양을 다르게 정했다면 이유, `PlaceContext`·`PlaceAgent`를 harness에 둔 이유
- 넘길 줄: 없음이 기본
- 계약 바꾸기 요청: 없음이 기본
- **무겁게 짠 것**: 없음이 기본. 있으면 `무엇 / 왜 / 줄인다면 / 어디`
- **알려진 미완 동작**: `commands/role-prompts.ts`와 `commands/registry.ts`의 `ROLE_COMMANDS`는 reader Worker가 `register.ts`를 직접 import해 조립하므로 이 task에서 옮기지 못했다(`role-ports`가 푼다)

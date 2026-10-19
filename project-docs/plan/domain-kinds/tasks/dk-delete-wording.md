# dk-delete-wording

wording catalog에서 context 문구를 지운다: 영역 file `contexts.ts`(150여 key)와 다른 영역 file에 흩어진 context key. 코드가 이미 모두 지워진 뒤에 하므로 이 task는 key와 생성물만 정리한다. (이 계획의 wording catalog 정리는 이 task 하나가 맡는다. 다른 task가 더하고 지운 key는 `dk-event`가 더한 `waiting.label.event-kind-violation`, `dk-chips-reactions`가 바꾼 toast·설정 key, `dk-operator-contexts`가 고친 `agent-counts-operator`다.)

- 단위: wording (wave 3)
- 선행: dk-shell-workspace, dk-chips-reactions, dk-operator-contexts, dk-wireframes
- 소유(이 task만 고친다):
  - `packages/design/wording/catalog/contexts.ts`
  - `packages/design/wording/catalog/contexts.placeholders.ts`
  - `packages/design/wording/en.ts`
  - `packages/design/wording/placeholders.ts`
  - `packages/design/wording/catalog/common.ts`
  - `packages/design/wording/catalog/common.placeholders.ts`
  - `packages/design/wording/catalog/conversation.ts`
  - `packages/design/wording/catalog/conversation.placeholders.ts`
  - `packages/design/wording/catalog/agents.ts`
  - `packages/design/wording/catalog/agents.placeholders.ts`
  - `packages/design/wording/catalog/project.ts`
  - `packages/design/wording/catalog/project.placeholders.ts`
- 읽을 것:
  - 규칙: `.claude/skills/wording/SKILL.md`(key 규칙, `deno task wording`, `check-wording`), `AGENTS.md`의 "문서"·"말"
  - 구조: `packages/design/wording/en.ts`(영역 목록 `AREAS`와 spread. "영역을 더하려면 import 한 줄, AREAS 한 칸, en의 spread 한 칸, placeholders.ts에도 한 칸"이므로 지울 때도 같은 네 곳이다), `packages/design/wording/generate.ts`·`check.ts`(검사: 코드가 쓰는 key가 catalog에 있는지. 쓰지 않는 key를 잡는 규칙은 없다 — 그래서 손으로 모아야 한다)
  - 지울 후보(확인된 위치. 지울 때는 `rg -n '"<key>"' packages tools`로 쓰는 곳이 없는 것을 하나씩 확인한다):
    - 영역 file 전체: `catalog/contexts.ts`·`contexts.placeholders.ts`
    - `catalog/common.ts`: `common.heading.palette-contexts`(≈:34), `contexts.empty.tab-none`(≈:89), `contexts.label.frame-chip`, `contexts.label.rail-contexts`, `contexts.label.rail-search`(≈:90~92. 이름이 `contexts.`인 key. `contexts.label.rail-search`처럼 지금도 쓰는 것이 있으면 `rg`로 확인하고 쓰는 것은 남기되 이름이 맞는지 보고)
    - `catalog/conversation.ts`: `conversation.button.remove-context`(≈:35)
    - `catalog/agents.ts`: `project-workspace.button.agent-editor-add-context`, `project-workspace.empty.agent-editor-no-contexts`, `project-workspace.heading.agent-editor-contexts`, `project-workspace.label.agent-editor-remove-context`(≈:174~215), 오류 message ICU(≈:240)의 `archivedReference {This context is archived, so pick an active one}`과 코드가 지워진 `missingReference`는 가지째 뺀다. **지우지 않는 것**: `project-workspace.label.avatar-icon-contexts`(PM profile icon 이름. 코드가 쓴다)
    - `catalog/project.ts`: `document.label.contexts`(≈:52), `project-workspace.label.menu-context`, `rail-contexts`, `rail-saved`(rail에서 빠졌다), `sidebar-tab-context`(≈:165~180), `project-workspace.label.menu-search` 등 Search는 남는다
    - `rg -n -i "context|saved view|saved-view|violation|glossary" packages/design/wording/catalog --glob '!*.placeholders.ts'`로 남은 것을 본다. **모델의 context 한도·window를 뜻하는 key**(`conversation.label.model-input-limit-default` "Same as context" 등)와 `catalog/data.ts`·`workspace-settings.ts`의 새 `kind-violation` key는 지우지 않는다.
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음(지우기)

## 할 일

1. 위 후보를 하나씩 `rg`로 쓰는 곳이 없음을 확인하고 지운다. 쓰는 곳이 남아 있으면(앞 task가 못 지운 코드) 지우지 말고 보고한다.
2. `catalog/contexts.ts`와 `.placeholders.ts`를 지우고 `en.ts`(import, `AREAS`, spread)와 `placeholders.ts`(한 칸)에서 `contexts` 영역을 뺀다. 이 등록 줄 제거는 lead 규칙의 예외다.
3. 다른 영역 file에서 key를 지우고 `deno task wording`으로 `*.placeholders.ts`를 다시 만든다(손으로 고치지 않는다. placeholders를 손으로 고치다 괄호를 깨뜨린 적이 있다).
4. `deno task check`(wording 생성물 검사 포함)가 통과한다.

## 정한 것

- key 이름이 `contexts.`인 것 가운데 지금도 쓰이는 것이 있으면 이름을 바꾸지 않고 둔다(이름 바꾸기는 `domain-rename`의 일이다). 보고에 목록을 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(문구).
- 남지 않음: `rg -n -i "context" packages/design/wording/catalog --glob '!*.placeholders.ts'`에서 모델 context 한도 key, `avatar-icon-contexts`, 보고에 적은 예외를 뺀 줄이 0이다. `rg -n "contexts\.(button|label|heading|empty|notice|info|error|title|field|violation|glossary)" packages tools`가 0줄이다.
- 화면: 해당 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 남긴 `contexts.` key와 이유
- 넘길 줄: 없음
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

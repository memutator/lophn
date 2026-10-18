# uf-agents-scroll

project의 Agents 탭(목록과 Operator 편집)이 잘리고 scroll이 안 되는 것을 고친다.

- 단위: uf-agents-scroll (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/kinds/agents.tsx`
  - `tools/wireframes/pages/screens/project-app.tsx`
- 읽을 것: README의 "찾은 것", `packages/shell/renderer/workspace/panes/padded-tab.tsx`, `packages/shell/renderer/workspace/panes/panes.tsx`, `packages/shell/renderer/workspace/kinds/context.tsx`(PaddedTab을 쓰는 본보기), `.claude/skills/ui-design/SKILL.md`
- 계약: 없음

## 할 일

1. `kinds/agents.tsx`의 `render()`가 `AgentsPage`를 `PaddedTab`으로 감싼다. 안쪽 page가 padding을 두 번 받으면 page 쪽 padding을 맞추되 그 css는 이 task가 소유하지 않으니 PaddedTab 쪽에서 해결하거나 보고한다.
2. wireframe의 `FLUSH` 처리를 실제와 맞춘다(Agents와 Operator kind가 실제처럼 그려지게).

## 끝남

- `deno task check`, `deno run -A packages/shell/renderer/build.ts`, `deno task wireframes`가 통과한다.
- 위험 test: 없음(화면).

## 보고

- 바꾼 file, 통과한 check
- **무겁게 짠 것** / **알려진 미완 동작**: 없으면 "없음"

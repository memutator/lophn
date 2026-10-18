# uf-model-field

model 선택 칸의 두 가지를 고친다. 하나는 고르지 않았을 때의 "No options for this model"이고, 다른 하나는 catalog에 model이 없는 provider(custom provider)에서 model 이름을 직접 적어 고르는 길이다. custom provider 대화창의 key 안내도 local URL에 맞게 고친다.

- 단위: uf-model-field (wave 2)
- 선행: uf-catalog-read. 목록이 보여야 확인할 수 있다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/agents/editor/model-field.tsx`
  - `packages/shell/renderer/workspace/agents/model-picker-data.ts`
  - `packages/shell/renderer/conversation/model-picker/**`
  - `packages/shell/renderer/desktop/settings/providers/connect-dialog.tsx`
  - `packages/design/wording/catalog/{agents,conversation,workspace-settings}.ts`와 placeholders(문구 key만)
  - turn이 catalog에 없는 model로도 돌게 하는 데 필요하면 `packages/core/lophn-agent/models/resolve.ts`
- 읽을 것: README의 "찾은 것"과 "정한 것", `.claude/skills/wording/SKILL.md`, `packages/core/lophn-agent/models/resolve.ts`(catalog에 없는 model을 거절하는 곳), `packages/core/lophn-agent/models/commands.ts`(`checkChoice`)
- 계약:
  - 쓰는 것: `modelDefaultChange`, `changeSessionModel`
  - 내놓는 것: 없음

## 할 일

1. `DefaultModelField`와 Operator 편집의 Model 칸은 model을 골랐고 목록을 읽었을 때만 `OptionAxes`를 그린다.
2. 고른 provider의 model이 catalog에 하나도 없으면, picker에 model 이름을 직접 적는 입력을 둔다. 적은 이름으로 기본 model이나 session model을 저장한다.
3. 그 model로 turn이 실제로 도는지 본다. `resolve.ts`가 catalog에 없는 model을 거절하면, catalog 정보가 없는 model에 쓸 기본 한도(context, output, tool 지원)를 두는 가장 작은 길로 고친다. 이 경우 위험 test 하나: "catalog에 없는 model을 고른 custom provider로 turn을 준비할 수 있다."
4. custom provider 대화창: local http URL이면 key 안내를 보이지 않거나 "이 컴퓨터의 서비스는 key 없이 붙는다"로 바꾼다(wording skill대로).

## 끝남

- `deno task check`, `deno run -A packages/shell/renderer/build.ts`, wording 생성이 통과한다.
- 손 확인: core에 local custom provider(auth none)를 붙이고, 적은 model 이름으로 기본 model 저장이 되고, turn 준비가 거절되지 않는다.

## 보고

- 바꾼 file, 통과한 check, turn이 도는지 확인한 방법
- **무겁게 짠 것** / **알려진 미완 동작**: 없으면 "없음"

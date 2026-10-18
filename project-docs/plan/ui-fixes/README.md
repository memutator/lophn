# ui-fixes: 사람이 화면을 눌러 보며 찾은 bug를 고친다

- 목표: `deno task dev`로 설정과 Agents 화면을 쓸 때 막히는 것 넷을 고친다.
  - 모든 model 선택 칸이 비어 있다.
  - Agents 탭이 잘리고 scroll이 안 된다.
  - 고른 model이 없을 때도 "No options for this model"이 뜬다.
  - custom provider를 붙여도 그 model을 고를 수 없다.
- 재료: 사람이 화면에서 본 것, 조사 결과(아래 "찾은 것"), `project-docs/architecture/agent-definition.md`, `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
- 범위 밖: 새 화면, provider 연결 흐름 자체(계획 `settings-mcp`가 고쳤다).
- 돌리는 방식: **worker를 쓰지 않는다.** lead가 lead worktree에서 직접 고친다(패치가 좁다).
- 단위: `tasks/*.md`. task id는 `uf-`로 시작한다.
- 순서: `uf-catalog-read`가 먼저다. 그것이 없으면 다른 화면 고침을 확인할 수 없다.
- 시작 조건: 없음. 계획 `reuse-diagnose`와 같이 돌아도 소유가 겹치지 않는다(그 계획은 renderer를 고치지 않는다).

## 찾은 것

- model catalog 읽기 `agent-model-catalog/read`가 늘 `unavailable`("catalog read 파일 reader가 없다")이다.
  - `packages/core/lophn-agent/models/reads.ts`가 `createCatalogRead()`를 file reader 없이 만든다.
  - `packages/core/lophn-agent/register.ts`의 주석은 "조립이 reader를 끼운다"고 하지만 아무 데서도 끼우지 않는다.
  - 그래서 Settings → Agents의 기본 model, Operator 편집의 Model, 대화의 model picker가 모두 비어 있다.
  - fallback 갈래(`packages/core/lophn-agent/models/work.ts`)는 snapshot으로 catalog를 채워도 `state`를 비워 둔다.
- Agents 탭 몸통은 `packages/shell/renderer/workspace/panes/panes.tsx`가 `.flush`(`overflow: hidden`)로 두는 자리에 그려진다. 그런데 `packages/shell/renderer/workspace/kinds/agents.tsx`는 scroll하는 `PaddedTab`으로 감싸지 않는다. wireframe(`tools/wireframes/pages/screens/project-app.tsx`의 `FLUSH`)은 scroll해서 둘이 어긋났다.
- `DefaultModelField`(`packages/shell/renderer/workspace/agents/editor/model-field.tsx`)는 model을 고르지 않았거나 목록을 못 읽었을 때도 `OptionAxes`를 그려 "No options for this model"을 낸다.
- custom provider:
  - 정의 key가 사람이 정한 Provider ID라 catalog에 그 model이 없다. model picker(`modelsOf`, `packages/shell/renderer/workspace/agents/model-picker-data.ts`)에 고를 것이 없다.
  - core의 `modelDefaultChange`는 catalog에 없는 이름도 custom provider에는 받는다(조사에서 확인했다).
  - local http URL로 붙일 때는 key prompt가 없는데, 대화창의 key 안내는 prompt가 뜬다고 말한다.

## 정한 것

- catalog 읽기는 derived catalog file을 읽고, 없거나 깨졌으면 동봉 snapshot으로 답한다. 이 둘이 같은 결과 꼴이다. file reader를 core module graph 밖에서 끼워야 하면 그 길을 쓴다. 끼울 수 없으면 snapshot만 쓴다(agent).
- Agents 탭은 다른 scroll하는 kind와 같이 `PaddedTab`으로 감싼다. wireframe의 `FLUSH`도 실제와 맞춘다(agent).
- `OptionAxes`는 model을 골랐고 목록을 읽었을 때만 그린다(agent).
- custom provider처럼 catalog에 model이 없는 provider는, model picker에서 model 이름을 직접 적어 고를 수 있게 한다. 그 model은 catalog 정보가 없으므로, turn이 기본 한도로 돌게 한다(agent).

## 사람이 정할 것

없음.

## lead가 할 일

- task마다 `deno task check`, renderer를 고치면 `deno run -A packages/shell/renderer/build.ts`, 끝내기 전에 `deno task check:full`.
- 끝나면 `project-docs/products/change-log/0.3.0.md`에 항목을 덧붙이고 `land.sh`로 올린다. 사람에게 다시 눌러 볼 것을 알린다.

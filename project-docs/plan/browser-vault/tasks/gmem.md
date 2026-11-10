# gmem

Home memory(`<data>/home/memory.md`)를 모든 workspace의 agent가 `global memory`로 받게 하고, prompt·Agents 탭 문구·문서를 맞춘다.

- 단위: gmem (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-workspaces/hooks.ts`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/lophn-agent/run-loop/prepare_test.ts`
  - `packages/core/lophn-agent/prompt-assembly/turn-prompt.ts`
  - `packages/core/agent-workspaces/prompts/{home,project,app}.md`
  - `packages/design/i18n/catalog/agents.ts`
  - `project-docs/architecture/agent-definition.md`
  - `project-docs/products/AGENT.md`
  - `project-docs/flows/areas/turns.yaml`, `project-docs/flows/tests/lophn-agent.yaml`
  - `sdk-note` skill이 정하는 `migrate-sdk` 메모 file
- 읽을 것:
  - 계획 README "정한 것 › 전역 memory"
  - architecture: `project-docs/architecture/agent-definition.md` memory 절, `project-docs/architecture/agent-call.md` model 절
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: `readMemoryTexts`가 `{global, workspace, agent}`를 돌려준다

## 할 일

1. `hooks.ts` `readMemoryTexts`: `global`은 `workspaceMemoryFile(root, null)`. Home session(`workspace === null`)이면 `workspace`는 `""`이다(같은 파일을 두 번 싣지 않는다).
2. `prepare.ts`: `MemoryTexts` type에 `global`. custom filter(지금 `{...texts, workspace: ""}`)가 `global`도 비운다. `createFixedMemory`의 고정·Compact 뒤 다시 읽기는 그대로.
3. `turn-prompt.ts` `memoryBlock`: 출처 순서 `global memory` → `workspace memory` → `agent memory`. 빈 것은 뺀다.
4. prompt:
   - `home.md` "## Memory": 이 memory는 모든 workspace의 모든 agent가 본다. 그래서 workspace를 건너는 사실(사람의 계정·선호, workspace 지도, 앱 결정)만 담는다.
   - `project.md`·`app.md`의 memory 절: global memory는 읽기 전용이고 Home이 쓴다. `project.md:58`·`app.md:127`의 "Home lophn에 물어라(`to: {agent: "lophn"}`)" 줄은 지금 자기 workspace lophn으로 간다. 이 줄을 "workspace를 건너는 사실은 global memory에 있다. 없으면 사람에게 묻는다"로 바꾼다.
   - 세 prompt 모두에 한 줄: login 목록은 `lophn login list`로 보므로 memory에 옮기지 않는다. "이 일에는 이 login"이라는 선택만 적는다.
5. `app.md`는 앱 agent가 읽는 지침이다. `sdk-note` skill대로 메모와 Instruction diff를 쓴다.
6. `agents.ts`: Home의 memory 안내 문구를 "모든 workspace의 모든 agent가 읽는다"로 바꾼다. project·app의 문구는 global memory도 받는다는 것을 한 구절 더한다.
7. 문서:
   - `agent-definition.md` memory 절(규칙, prompt 그림, custom)
   - `AGENT.md` P13
   - `flows/areas/turns.yaml`의 `memory-fixed` outcome

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음. 기존 `prepare_test.ts`의 memory 고정 test는 새 모양에 맞춘다.
- 남지 않음: `grep -rn 'to: {agent: "lophn"}' packages/core/agent-workspaces/prompts`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴.

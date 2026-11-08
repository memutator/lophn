# ascope-ui

Agents 화면이 agent 정의의 workspace 범위를 보이고 고르게 한다. 명함 runtime 줄 bug를 고치고, 범위·call 문서를 지금 코드에 맞춘다.

- 단위: ascope (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/agents/`
  - `packages/design/i18n/catalog/agents.ts`
  - `project-docs/architecture/agent-definition.md`
  - `project-docs/architecture/agent-call.md`
- 읽을 것:
  - 계획: `project-docs/plan/agent-scope/README.md`의 "정한 것"
  - 조사: `/home/pyosechang/projects/lophn/reports/agent-definition-workspace-and-call-paths.md`(사람이 둔 file. 읽기만 한다)
  - architecture: `project-docs/architecture/agent-definition.md`, `project-docs/architecture/agent-call.md`
  - change-log: `project-docs/products/change-log/0.20.0.md`(범위 고르기 없음), `project-docs/products/change-log/0.22.0.md`(앱 삭제가 범위 agent를 지움)
  - core: `packages/core/lophn-agent/agents/commands.ts`(만들 때 workspace, 바꾸면 `not_allowed`), `packages/core/lophn-agent/agents/reads.ts`, `packages/core/main/daemon/wiring/apps-delete.ts:65-84`
- 계약:
  - 쓰는 것: `agentDefinitionSchema`(`packages/protocol/lophn-agent/agent-values.ts`)의 `workspace` 칸(`{kind: "project"|"app", id}`, 없으면 전역). core user actor는 이미 받는다. core와 protocol은 고치지 않는다.
  - 내놓는 것: 없음

## 할 일

1. workspace Agents 탭 목록은 전역 agent와 그 workspace 범위 agent만 보인다. home에서는 전역만 보인다.
2. 목록 카드, 명함, 편집기에 범위를 표시한다: 전역 / `<name> · project` / `<name> · app`. i18n `agents.label.workspace*`가 이미 있다.
3. 새 agent의 범위는 편집기에서 고른다. 기본값은 화면을 연 workspace이고 home이면 전역이다. 저장할 때 `definition.workspace`에 싣는다. 이미 있는 agent를 고칠 때는 범위를 바꾸는 길이 화면에 없다(읽기 전용 표시).
4. 명함 runtime 줄(`agent-card.tsx` `CardFacts`)은 harness 값(`claude-code`, `codex`, `opencode`)을 그대로 보인다. 지금은 `bare`가 아니면 모두 `lophn`으로 보인다.
5. `dev:mock` fake source(`fake-source.ts`, `fake-data.ts`)에 project 범위·app 범위 agent를 넣어 거르기와 표시가 보이게 한다.
6. 문서를 코드에 맞춘다:
   - `agent-definition.md:85`: 앱 삭제(`app.delete`)는 그 앱 범위 정의를 같은 Tx에서 지운다. project는 삭제가 없고 archive만 있다.
   - `agent-definition.md:30`·`:69`: 앱 command는 `tools[]`의 앱 tool이 아니라 `lophn` 명령으로 부른다. 코드를 열어 확인하고 고친다.
   - `agent-call.md:18`: `coding_agent` 대상은 없다. 그 줄을 지우고 지금 `to` 셋(`{session}`, `{agent, workspace?}`, `{session, fallback: "new"}`)과 맞춘다.
   - 편집기에서 범위를 고른다는 것을 agent-definition.md에 적는다.

## 끝남

- `npm run check:full`이 통과한다. `node packages/shell/renderer/build.ts`가 된다.
- 위험 test: 없음(화면 작업. 새 test를 붙이지 않는다)
- 남지 않음: `grep -n "coding_agent" project-docs/architecture/agent-call.md`가 0줄이다. `runtime-lophn`을 harness runtime에 쓰는 곳이 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

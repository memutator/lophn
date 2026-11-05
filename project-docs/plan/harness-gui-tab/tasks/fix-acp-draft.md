# fix-acp-draft

새 session 화면(첫 메시지 전, session id가 아직 없음)이 model 고르기·mode·`/` 명령 목록을 그리도록 core가 "session 전 정보"를 ACP로 낸다. 지금(`acp-screen`)은 같은 agent의 가장 최근 session에서 빌려 와서, 이전 session이 없는 agent는 model 단추와 `/` 목록이 아예 없다. lophn agent에서 되던 것이 사라진 회귀다(README 정한 것 5: lophn agent의 동작은 그대로).

- 단위: fix (wave 3)
- 선행: acp-screen
- 소유(이 task만 고친다):
  - `packages/protocol/acp/routes.ts`
  - `packages/core/main/daemon/wiring/acp.ts`
  - `packages/core/main/daemon/wiring/acp-build.ts`
  - `packages/core/main/daemon/wiring/acp-build_test.ts`
  - `packages/shell/renderer/conversation/agent-tab-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-fake-source.ts`
  - `packages/shell/renderer/conversation/agent-view.tsx`
  - `packages/shell/renderer/conversation/agent-tab-gui-source.ts`
  - `packages/shell/renderer/conversation/` 안에서 아래 할 일 6이 지우는 칸을 쓰던 file(그 줄만)
  - `tools/wireframes/mock/agents-data.ts`, `tools/wireframes/pages/screens/conversation.tsx`(옛 `StatusView`를 쓰던 줄만)
- 읽을 것:
  - `project-docs/architecture/acp.md`(대화 밖 session 기능, core가 하는 것)
  - `packages/core/main/daemon/wiring/acp-build.ts`의 `readSessionMeta`(session meta를 읽는 법)
  - `packages/shell/renderer/conversation/agent-view.tsx`의 `useBorrowedMeta`와 pending model 상태(`acp-screen`이 둔 것)
  - `packages/protocol/lophn-agent/workspaces.ts`(`agentIdSchema`, `workspaceSchema`), `agent-sessions.ts`(`OpenSession` 입력)
- 계약(lead가 정함):
  - 내놓는 것: `packages/protocol/acp/routes.ts`에 read route `acpDraft`(`resource: "acp"`, `method: "draft"`, `name: "AcpDraft"`, input `{agent: agentIdSchema, workspace: workspaceSchema.nullable()}`, output `acpSessionMetaSchema`, actors `["user"]`, errors `invalid_input`·`unauthorized`·`forbidden`·`not_found`). 출력은 그 agent와 workspace로 지금 session을 열면 받을 값이다. `title`·`usage`·`cli_session`은 null이고 `model`은 그 agent의 기본값(층 표시 포함)이다.
  - `AgentTabSource`에 optional `draft(agent, workspace)`(core source만 채운다. harness source는 session이 늘 있어 두지 않는다).

## 할 일

1. `routes.ts`에 위 `acpDraft`를 더한다. 주석에 "첫 메시지 전 새 session 화면용, harness는 쓰지 않는다"를 적는다.
2. core: `acp-build.ts`에 session 없이 agent와 workspace로 meta를 읽는 함수를 둔다. `readSessionMeta`와 같은 읽기(model 묶음과 축, 명령, mode, capability)를 쓰고 사본을 만들지 않는다(같은 함수를 session·draft 둘이 부르게 나눈다). 권한은 부른 사람의 자격이다(`readSessionMeta`와 같게). `acp.ts`에 route를 등록한다.
3. 화면: `agent-view.tsx`의 `useBorrowedMeta`와 "가장 최근 session에서 빌리기"를 지우고, session이 없을 때 `source.draft(agent, workspace)`로 그린다. 새 session에서 고른 model을 `openSession` 뒤 `set_model`로 보내는 지금 흐름은 그대로 둔다. `/` 메뉴를 열 때 다시 읽는 규칙은 draft에도 같다.
4. core source가 `draft`를 `acpDraft` route로 채운다. fake source는 lophn meta 하나를 돌려준다.
5. 지운 이름(`useBorrowedMeta` 등)을 grep해 주석에 남은 것을 고친다.
6. (lead가 더함) wave 2가 남긴 옛 `AgentTabSource` 칸을 지운다. 화면은 이제 ACP의 `session`과 `act`로 그려서 쓰는 곳이 없다: `external`, `model`, `chooseModel`, `setModelOption`, `commands`, `runCommand`, `status`, `renameSession`, `changeSkip`, `forkSession`, `compactSession`, `rewind`, `decidePermission`. core·fake·gui source의 구현과, 쓰는 곳이 없어진 lophn 꼴 view type(`ModelView`, `SlashGroupView`, `StatusView` 등. `RewindChoice`·`SlashEntryView`처럼 아직 쓰는 것은 남긴다)도 지운다. 지울 때마다 `grep -rn "\.<칸>(\|<칸>:" packages/shell/renderer tools/wireframes`로 쓰는 곳이 없는지 본다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: `acp-build_test.ts`에 "draft meta는 같은 agent·workspace로 연 session의 snapshot meta에서 title·usage·cli_session을 뺀 것과 같다" 한 case.
- 남지 않음: `grep -rn "useBorrowedMeta\|borrowed" packages/shell/renderer/conversation`이 0줄. 할 일 6의 칸 이름이 `AgentTabSource`와 source 셋에 0줄.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로.

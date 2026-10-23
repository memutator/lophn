# bs-attach-remove

대화 입력창의 아무 일도 하지 않는 붙이기(+) 단추와 그 줄기(`onAttach`, host의 `attach`, wording key `conversation.button.attach`, 아이콘)를 지우고 wireframe을 맞춘다. 붙이기 기능은 만들 때 다시 더한다.

- 단위: shell (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/composer/agent-composer.tsx`
  - `packages/shell/renderer/conversation/agent-view.tsx`
  - `packages/shell/renderer/workspace/kinds/agent.tsx`
  - `packages/shell/renderer/app-frame/side-panel.tsx`
  - `packages/shell/renderer/icons/conversation.ts`
  - `tools/wireframes/pages/screens/conversation.tsx`
  - `tools/wireframes/pages/screens/agent-chat.tsx`
  - `packages/design/wording/catalog/conversation.ts`
  - `packages/design/wording/catalog/conversation.placeholders.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/shell.md` 첫 항목("지금", "고치려면")
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/shell/renderer`(boundary `shell`), `packages/design`(boundary `design`)
  - skill: `.claude/skills/wording/SKILL.md`(key를 지울 때), `.claude/skills/ui-design/SKILL.md`(wireframe)
  - 본보기(화면): `tools/wireframes/pages/screens/conversation.tsx`, `tools/wireframes/pages/screens/agent-chat.tsx`
- 계약:
  - 쓰는 것: 없음.
  - 내놓는 것: `AgentComposer`의 props에서 `onAttach`가, `AgentViewHost`에서 `attach`가 없어진다. 다른 task가 기대는 것은 없다.

이슈와 코드가 어긋난 곳: 없다. 단추(`agent-composer.tsx`의 `IconButton`), `onAttach`, host의 `attach: () => {}`(`workspace/kinds/agent.tsx`, `app-frame/side-panel.tsx`), key `conversation.button.attach`가 이슈 설명 그대로다. 이슈에 없는 것: `AgentViewHost.attach`(`conversation/agent-view.tsx`, 주석 "composer의 [+]"), 아이콘 `conversationIcons.attach`(`renderer/icons/conversation.ts`, `Plus`), wireframe 둘이 (`screens/conversation.tsx`의 `attach: () => {}`, `screens/agent-chat.tsx`의 `onAttach={() => {}}`)이다.

## 할 일

1. `agent-composer.tsx`: 붙이기 `IconButton`과 props의 `onAttach`를 지운다. 줄(`data-composer-row`)의 `<span className={styles.spacer} />`는 모델 선택을 오른쪽으로 미는 것이라 둔다.
2. `agent-view.tsx`: `AgentViewHost.attach`(와 주석)를 지우고 `<AgentComposer onAttach={host.attach} />` 줄을 지운다.
3. 두 host(`workspace/kinds/agent.tsx`, `app-frame/side-panel.tsx`)에서 `attach: () => {}`를 지운다. 곁의 주석 중 "첨부 통로는 아직 이 칸에 없다"는 말이 붙이기를 가리키면 `showUsage`만 남도록 고친다.
4. `renderer/icons/conversation.ts`: `attach: Plus`와 안 쓰게 된 `Plus` import를 지운다(다른 곳에서 `conversationIcons.attach`를 쓰지 않는다. `grep -rn "conversationIcons.attach" packages tools`로 확인한다).
5. wireframe 둘에서 `attach: () => {}`, `onAttach={() => {}}`를 지운다. 화면 그림은 그 단추만 사라진다.
6. wording: `packages/design/wording/catalog/conversation.ts`에서 `"conversation.button.attach"`를 지우고, `conversation.placeholders.ts`는 손으로 고치지 않고 생성한다: `deno run --allow-read --allow-write packages/design/wording/generate.ts`. 생성 결과가 그 key 한 줄만 지웠는지 `git diff`로 본다. 이 두 file은 다른 task도 key를 더하는 공유 file이라(`briefs.py`의 `shared`) 겹치면 lead가 rebase에서 둘 다 남긴다.
7. renderer build는 `check:full`이 보지 않는다: `deno run -A packages/shell/renderer/build.ts`를 한 번 돌려 통과를 확인한다(`packages/shell/renderer/dist`는 git에 없는 build 산출물이다).

## 끝남

- `deno task check`가 통과한다(wording 생성 최신 검사 포함).
- `deno run -A packages/shell/renderer/build.ts`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "onAttach\|conversation.button.attach\|conversationIcons.attach" packages tools --include=*.ts --include=*.tsx`가 `dist`를 뺀 곳에서 0줄이다. 호스트 `attach:` 줄은 `grep -rn "attach: () =>" packages/shell/renderer tools/wireframes/pages`가 0줄이다(`editor/sessions.ts`의 `attach`는 다른 것이라 남는다).
- `deno task wireframes`가 되고, gallery의 conversation·agent-chat 화면에 + 단추가 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성 결과(lead가 merge 뒤 다시 돌린다)
- 안 쓰게 된 export (없으면 "없음")
- 무겁게 짠 것 / 알려진 미완 동작 (없으면 "없음")

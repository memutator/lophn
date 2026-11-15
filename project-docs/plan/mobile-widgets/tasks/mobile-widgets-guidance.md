# mobile-widgets-guidance

앱 agent가 위젯과 폰 위치를 쓸 줄 알게 지침을 맞춘다: `design-app` skill에 "Widgets"와 "Phone location" 절, app agent prompt의 두 줄, SDK guide 셋(declaration, cap-notify, cap-phone)을 한 지침으로 맞추기, 이번 판 메모 셋의 `## Instruction diff`. 지침이 실제 동작(앞 task들이 지은 것)과 같아야 하므로 마지막에 한다.

- 단위: widgets (wave 10)
- 선행: mobile-widget-core, mobile-widgets-decl, mobile-cap-phone, mobile-phone-use-grant, mobile-widget-native. `mobile-user-apps` land 뒤의 `design-app`·prompt 위에 쓴다(그 계획의 `mobile-agent-guidance`가 같은 file을 고쳤다)
- 소유(이 task만 고친다):
  - `packages/core/agent-workspaces/skills/design-app/SKILL.md`
  - `packages/core/agent-workspaces/prompts/app.md`
  - `packages/sdk/declaration/guide.md`
  - `packages/sdk/cap-notify/guide.md`
  - `packages/sdk/cap-phone/guide.md`
  - `packages/core/agent-workspaces/skills/migrate-sdk/declaration-4.7.0.md`(`## Instruction diff`만. 이 판은 계획이 land되기 전이라 아직 어느 앱에도 가지 않았다)
  - `packages/core/agent-workspaces/skills/migrate-sdk/cap-notify-1.3.0.md`(같다)
  - `packages/core/agent-workspaces/skills/migrate-sdk/cap-phone-1.0.0.md`(같다)
- 읽을 것:
  - skill `.claude/skills/sdk-note/SKILL.md`("Instruction diff"는 git diff로 뽑는다. 손으로 다시 쓰지 않는다)
  - 지금 지침: `design-app/SKILL.md`의 "Where screens open"(`tray`와 `phone` 자리의 꼴), `prompts/app.md`의 `notify.send` 줄, 세 guide
  - 실제 동작: `packages/protocol/apps/widget.ts`(node 넷과 한도), 선언의 `widgets`와 `phone.use`, `@lophn/cap-notify`의 `setWidget`·`clearWidget`, `@lophn/cap-phone`의 `getLocation`과 오류, 계획 `README.md`의 "정한 것"(best effort, 시각 꼬리, 앞에 있을 때만, 동의 한 번, banner 없음, stand-in)
  - 각 task의 보고(앱 코드 예)
- 계약:
  - 쓰는 것: 위 SDK의 공개 API
  - 내놓는 것: 앱 agent가 이 저장소를 모른 채 읽고 따라 할 수 있는 지침(영어, 명령형, 짧게. SDK guide는 지금 쓰인 말을 따른다)

## 할 일

1. `design-app/SKILL.md`에 "Widgets" 절: 언제 둔다(사람이 폰을 열지 않고 한눈에 볼 값 하나나 짧은 목록. 화면을 대신하지 않는다), 선언(`widgets`의 key·label·`screen`), 값(`setWidget` node 넷, 4 KiB, 시작 코드와 값이 바뀔 때 다시 낸다, 값이 메모리에만 있다), 폰이 늘 새로 하지 못한다는 것(가져온 시각이 보인다. 초 단위 값을 위젯에 두지 않는다), 누르면 `screen`의 폰 화면이 열린다. "Phone location" 절: `phone.use`와 `reason`, `getLocation`은 폰 앱이 앞에 떠 있을 때만 답한다, `unavailable`이면 사람에게 다음 일을 보이고 되풀이해 부르지 않는다, preview에서는 stand-in 위치가 온다.
2. `prompts/app.md`: `notify.send` 줄 옆에 두 줄(폰 홈 화면에 한눈에 볼 값 → `widgets`와 `@lophn/cap-notify` guide, 사람의 폰 위치 → `phone.use`와 `@lophn/cap-phone` guide).
3. 세 guide를 위 절과 같은 말로 맞춘다(같은 규칙을 다르게 쓰지 않는다).
4. 메모 셋의 `## Instruction diff`: 이 task와 앞 task가 바꾼 지침 file의 git diff(판을 낸 task의 commit 앞과 지금 사이)에서 바뀐 hunk만. diff 위에 앱 agent가 할 일 한두 줄.

## 끝남

- `npm run check`가 통과한다. 특히 `node tools/check-sdk-notes.ts`와 `node tools/check-skills.ts`.
- 위험 test: 없음(지침)
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 새 절 둘의 글, 메모마다 넣은 diff의 file 목록.

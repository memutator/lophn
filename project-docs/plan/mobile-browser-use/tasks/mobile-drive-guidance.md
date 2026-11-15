# mobile-drive-guidance

앱 agent가 자기 폰 화면을 사람의 폰에서 확인하는 길을 지침에 쓴다: 언제 쓰나(desktop `--preview --screen`은 web 에뮬레이션이라 입력·keyboard·scroll·글꼴이 다르다), 어떻게 하나(`lophn preview start`, 사람에게 폰에서 Preview from lophn을 열어 달라고 부탁, `lophn tab open --phone`, `lophn browser …`), 한계(preview data, 앱이 앞에 있어야 한다, system UI·Back 없음, 사람이 take control할 수 있다). 지침이 바뀌므로 `@lophn/ui-native` 0.2.0 메모에 Instruction diff를 더한다.

- 단위: drive-agent (wave 4)
- 선행: mobile-drive-cli, mobile-drive-kit, mobile-drive-phone. **`mobile-app`, `mobile-user-apps`, `mobile-widgets` 계획이 main에 land된 뒤에 띄운다**(고칠 지침 file은 `mobile-user-apps`의 `mobile-agent-guidance`가 썼다)
- 소유(이 task만 고친다):
  - `packages/core/agent-workspaces/skills/design-app/SKILL.md`
  - `packages/core/agent-workspaces/prompts/app.md`
  - `packages/design/native/guide.md`
  - `packages/core/agent-workspaces/skills/migrate-sdk/ui-native-0.2.0.md`(`## Instruction diff` 절을 더하는 만큼)
- 읽을 것:
  - skill: `.claude/skills/sdk-note/SKILL.md`(Instruction diff는 git diff로 뽑는다. 손으로 다시 쓰지 않는다)
  - 지금 지침: `design-app/SKILL.md`의 "Phone screens"(`mobile-agent-guidance`가 썼다), `prompts/app.md`, `packages/design/native/guide.md`의 desktop preview 문단("마지막 확인은 사람이 폰에서 한다")
  - 도구 글: `packages/cli/commands/tab.ts`와 `browser.ts`의 설명, `packages/coding-agent/skills/lophn-agent.ts`(`mobile-drive-cli`가 쓴 글. 같은 말을 쓴다), `packages/protocol/phone/drive.ts`의 `PHONE_TAB_TEXT`
  - 결정: 계획 `README.md`의 "정한 것"
- 계약:
  - 쓰는 것: 위 도구 글
  - 내놓는 것: 지침 file 셋과 메모의 Instruction diff

## 할 일

1. `design-app/SKILL.md`의 "Phone screens"에 짧은 절: desktop preview로 먼저 고치고, 입력·keyboard·scroll·실제 폰 크기가 걸린 것은 사람의 폰에서 본다. 길: `lophn preview start` → 사람에게 폰의 lophn 앱에서 이 앱의 Preview from lophn을 열고 앱을 앞에 두어 달라고 부탁 → `lophn tab open --phone <app> [--screen <key>]` → `browser snapshot|screenshot|act|wait`. `unavailable`이면 그 문장대로 사람에게 부탁하고 되풀이하지 않는다. 한계 한 줄씩(preview data, Back과 system dialog 없음, 사람이 take control하면 act가 `conflict`). 입력 칸은 `Field` label로 이름을 준다(snapshot의 이름이 된다).
2. `prompts/app.md`: 위를 가리키는 한 줄(폰 화면을 고쳤으면 사람이 있을 때 폰에서 한 번 확인한다).
3. `packages/design/native/guide.md`: "마지막 확인은 사람이 폰에서 한다" 문단을 `--phone` 길로 바꾸고, `Field` label이 accessibility 이름이 된다는 한 줄.
4. 메모 `ui-native-0.2.0.md`에 `## Instruction diff` 절: 무엇을 하라(앱 `AGENTS.md`의 lophn 관리 부분을 맞추고, 폰 화면을 고친 뒤 폰에서 확인하는 습관) + 위 세 file의 git diff(바뀐 hunk만).
5. flows catalog: 내장 skill의 글만 바뀌면 고칠 줄이 없다. 바뀌면 이 task가 project-docs/flows 에서 자기 줄만 고친다(꼴은 .claude/skills/flows/SKILL.md).

## 끝남

- `npm run check`(특히 `node tools/check-sdk-notes.ts`)가 통과한다.
- 위험 test: 없음(지침 글).
- 남지 않음: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 바꾼 지침의 전문, Instruction diff를 뽑은 명령.

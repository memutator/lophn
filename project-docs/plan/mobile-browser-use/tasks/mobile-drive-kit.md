# mobile-drive-kit

폰 kit의 `Input`이 accessibility label을 갖게 한다: `Field` 안이면 그 label, 아니면 placeholder. 지금은 이름이 placeholder(Android hint)라 agent의 snapshot에 `textbox "type here"`처럼 보인다. 누르는 조각의 role은 그대로 지키고 testID에 기대지 않는다. kit이 SDK part(`@lophn/ui-native`)라 판을 올리고 `sdk-note` 메모를 쓴다.

- 단위: drive-kit (wave 1)
- 선행: 없음. **`mobile-app`, `mobile-user-apps`, `mobile-widgets` 계획이 main에 land된 뒤에 띄운다**(`mobile-sdk-kit`이 kit을 SDK part 0.1.0으로 올렸다)
- 소유(이 task만 고친다):
  - `packages/design/native/input/input.tsx`
  - `packages/design/native/package.json`
  - `packages/core/agent-workspaces/skills/migrate-sdk/ui-native-0.2.0.md`(새 file)
  - `packages/sdk/app-ui-native/package.json`과 그 part의 새 판 메모(migrate-sdk 폴더의 새 file). `@lophn/app-ui-native`가 kit을 정확한 판으로 의존할 때만(sdk-note "같이 움직이는 package")
- 읽을 것:
  - skill: `.claude/skills/sdk-note/SKILL.md`(판, pin, 메모 꼴, `supported_from`). 본보기 메모: `packages/core/agent-workspaces/skills/migrate-sdk/ui-native-0.1.0.md`, minor 본보기 `app-ui-2.5.0.md`
  - kit: `packages/design/native/input/input.tsx`(`Input`, `Field`), `packages/design/native/mod.ts`, `packages/design/native/guide.md`
  - 왜: spike `/home/pyosechang/projects/lophn/reports/mobile-program/drive-spike.md`의 "What the kit must change"(Input만 이 task가 한다. Icon·Switch·ListItem·SegmentedControl의 제안은 하지 않는다: 계획 "정한 것"이 Input만 정했다)
  - 폰 화면 호환: `packages/protocol/apps/phone-screen.ts`(`phoneCanRun`이 kit 판을 어떻게 견주는가. 0.2.0으로 지은 화면이 0.1.0 base의 폰 앱에서 거절되는지 알고 메모에 적는다)
- 계약:
  - 쓰는 것: 지금 kit의 API(바꾸지 않는다)
  - 내놓는 것: `@lophn/ui-native` 0.2.0(minor. 같은 판에 `mobile-drive-guidance`가 지침 변경의 Instruction diff를 더한다), `lophn.supported_from` 0.1.0 그대로, 메모 `ui-native-0.2.0.md`(`Previous: 0.1.0`, `Breaking: no`)

## 할 일

1. `input.tsx`: `Field`가 자기 label을 context로 내리고 `Input`이 `accessibilityLabel`을 그 label로, context가 없으면 `placeholder`로 둔다. `Input`이 이미 `accessibilityLabel` prop을 받으면 그것이 먼저다. secure 입력도 같다(값이 아니라 label이다).
2. 누르는 조각의 role 확인: `grep -rn "accessibilityRole" packages/design/native`로 Button, IconButton, Checkbox, Switch, 누를 수 있는 ListItem, SegmentedControl의 tab에 role이 있는지 보고, 빠진 것만 더한다(없으면 고치지 않는다). testID를 더하지 않는다.
3. 판: `packages/design/native/package.json` 0.2.0. sdk-note 2의 grep으로 pin을 찾아 고친다(`packages/sdk/app-ui-native/package.json`이 kit을 정확한 판으로 의존하면 그 part도 판을 올리고 그 메모를 쓴다. 폰 앱의 base bundle이 kit 판을 읽는 곳이 `package.json`이 아닌 상수면 보고한다). `package-lock.json`은 lead가 다시 만든다.
4. 메모 `ui-native-0.2.0.md`(영어): Input이 Field label이나 placeholder를 accessibility label로 갖는다, 폰 화면에서 입력 칸에 `Field`로 label을 주면 lophn이 폰에서 화면을 다룰 때 그 이름으로 찾는다, "Nothing is required of an existing app", 새 판으로 지은 화면이 옛 lophn 폰 앱에서 열리는지(`phoneCanRun`). `## Instruction diff` 절은 쓰지 않는다(`mobile-drive-guidance`가 같은 메모에 더한다).
5. flows catalog: SDK export가 바뀌지 않으면 고칠 줄이 없다. 바뀌면 이 task가 project-docs/flows 에서 자기 줄만 고친다(꼴은 .claude/skills/flows/SKILL.md).

## 끝남

- `npm run check`(특히 `node tools/check-sdk-notes.ts`)가 통과한다. 폰 앱은 kit을 alias로 읽으니 `cd packages/mobile && npm run typecheck && npm test`도 통과한다.
- 위험 test: 없음(화면 조각의 label. 결과는 `mobile-drive-native`의 emulator snapshot이 본다)
- 남지 않음: `grep -rn '"@lophn/ui-native": "0.1.0"\|ui-native/0.1.0' packages tools tests`가 메모와 하한 말고는 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 고친 pin 목록, 같이 올린 part와 판, `phoneCanRun`이 판을 견주는 법(lead가 dev build를 다시 지을 때 알아야 한다).

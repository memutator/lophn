# mobile-drive-cli

agent와 사람이 phone 탭을 여는 CLI를 더하고 글을 맞춘다: `lophn tab open --phone <app> [--screen <key>]`, browser 명령 설명에 phone 탭에서 되는 것과 안 되는 것, JPEG screenshot을 `.jpg`로 쓰기, harness agent가 읽는 내장 skill `lophn-agent`의 "Open and drive a browser tab" 절. lophn agent의 tool은 같은 `defineCommand`에서 나오므로 같이 바뀐다.

- 단위: drive-agent (wave 2)
- 선행: mobile-drive-contract. **`mobile-app`, `mobile-user-apps`, `mobile-widgets` 계획이 main에 land된 뒤에 띄운다**(`--screen`은 `mobile-user-apps`의 `mobile-preview-phone`이 `tab.ts`에 더했다)
- 소유(이 task만 고친다):
  - `packages/cli/commands/tab.ts`
  - `packages/cli/commands/tab_test.ts`
  - `packages/cli/commands/browser.ts`
  - `packages/cli/commands/browser_test.ts`
  - `packages/cli/main.ts`(screenshot을 file로 쓰는 `saveImage`의 확장자만)
  - `packages/coding-agent/skills/lophn-agent.ts`
- 읽을 것:
  - 계약: `packages/protocol/lophn-agent/host-queue.ts`(`tabsOpen`의 `phone` target과 주석, `browserScreenshot`의 `media_type`), `packages/protocol/phone/drive.ts`(`PHONE_TAB_TEXT`: CLI 글이 같은 말을 해야 한다)
  - 지금 글: `packages/cli/commands/tab.ts`(`--preview`, `--device`, `--screen`의 검사와 설명), `packages/cli/commands/browser.ts`(`wrapUntrusted`, `screenshot`의 설명 "PNG"), `packages/cli/main.ts`의 `saveImage`(`.png` 고정), `packages/coding-agent/skills/lophn-agent.ts`의 "Open and drive a browser tab"
  - 결정: 계획 `README.md`의 "정한 것"(preview만, 사람이 Preview from lophn을 연다, 앞에 있어야 한다, take control)
- 계약:
  - 쓰는 것: 위 route. core의 동작은 `mobile-drive-core`가 짓는다(이 task는 core를 고치지 않는다)
  - 내놓는 것: CLI `lophn tab open --phone <app id> [--screen <key>] [--as …]`

## 할 일

1. `tab.ts`: `--phone <app id>`를 더한다(`--session|--url|--preview|--artifact|--coding|--phone` 가운데 정확히 하나). `--screen`은 `--preview`나 `--phone`과만, `--device`는 `--preview`와만(phone 탭은 실제 폰이다). target은 `{phone: {app, screen: screen ?? null}}`. 명령 설명(agent가 읽는 글)에 한 문단: phone 탭은 사람의 폰에 뜬 그 앱의 preview 화면이다, 그 앱 workspace의 session과 사람만 연다, 사람이 폰의 lophn 앱에서 그 앱의 Preview from lophn을 열고 앱을 앞에 두어야 하고 아니면 `unavailable`이 그 이유와 할 일을 말한다(사람에게 부탁한다), preview가 돌지 않으면 `conflict`(preview start 먼저), 앱마다 phone 탭은 하나다, `--screen`은 그 폰 화면이 보일 때만 열린다, 데이터는 preview의 버리는 data다.
2. `browser.ts`: 각 명령 설명에 phone 탭 한 줄씩(snapshot의 첫 줄 `screen <key> <w>x<h>dp`와 `[offscreen]` 같은 flag, act는 click·type·fill·press Enter·scroll만, wait는 `--text`만, navigate·evaluate·logs와 다른 act는 `invalid_input`, take control은 사람이 폰에서 한다). screenshot의 summary와 설명은 "PNG" 대신 "image(PNG, or JPEG on a phone tab)". page 글을 `wrapUntrusted`로 싸는 것은 그대로 둔다(phone 탭 글도 같은 길로 간다).
3. `main.ts`의 `saveImage`: `media_type`이 `image/jpeg`면 `.jpg`. `--out`을 준 경우는 그대로.
4. `lophn-agent.ts`: 예 줄 `lophn tab open --phone <app id> [--screen <key>]`를 더하고, 위 규칙을 짧은 bullet 하나로(언제 쓰나: 자기 앱의 폰 화면을 사람의 폰에서 확인할 때. desktop `--preview --screen`은 web 에뮬레이션이다). 실패하면 다른 길(adb, 다른 browser)을 찾지 말고 사람에게 부탁한다는 기존 끝 bullet에 phone을 넣는다. 이 skill이 내장 skill이면 판·메모 규칙(`sdk-note`)이 걸리는지 보고 걸리면 보고한다(앱 agent 지침이 아니라 harness agent 지침이라 보통 걸리지 않는다).
5. test: `tab_test.ts`에 `--phone`의 인자 검사(`--device`와 같이 주면 `invalid_input`, `--screen`이 `--phone`과 되는 것) 정도만. 글은 test하지 않는다.
6. flows catalog: 바뀐 CLI 입구(`cli:tab.open`의 `--phone`)와 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음(인자 모양과 글. 권한은 core가 본다)
- 남지 않음: `grep -rn "Take a PNG screenshot" packages`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 바꾼 설명 글 전문(lead가 `mobile-drive-guidance`와 말을 맞춘다).

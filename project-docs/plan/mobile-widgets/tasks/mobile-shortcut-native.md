# mobile-shortcut-native

**opus high.** 사람의 앱 하나를 폰 홈 화면의 아이콘(Android pinned shortcut)으로 둔다. 앱 menu의 "Add to Home screen"이 그 앱의 아이콘과 이름으로 놓기를 청하고, 누르면 그 앱 화면(`lophn://open?...&kind=app`)이 열린다. 앱이 보관·삭제되거나 컴퓨터를 지우면 그 아이콘을 disable한다. 얇은 자체 Expo module `lophn-shortcuts`(Kotlin)와 TS 쪽 규칙을 짓는다.

**사람이 `mobile-widget-wireframes`를 승인한 뒤, spike 판정(S5 아이콘 그림, S6 pinned shortcut)으로 lead가 이 brief를 다시 본 뒤에 띄운다.**

- 단위: shortcuts (wave 7)
- 선행: mobile-widget-screens, mobile-open-target, mobile-widget-spike, mobile-widget-wireframes. 앱 menu file을 `mobile-widget-screens` 뒤에 고치고, native build file을 `mobile-widget-native` 뒤에 고친다
- 소유(이 task만 고친다):
  - `packages/mobile/modules/lophn-shortcuts`(새 폴더 전체: `expo-module.config.json`, `index.ts`, `android/`)
  - `packages/mobile/src/shortcuts`(새 폴더: 놓기, 아이콘 그림, 맞추기)
  - `packages/mobile/app.json`
  - `packages/mobile/package.json`
  - `packages/mobile/package-lock.json`
  - `packages/design/i18n/catalog/mobile-widgets.ts`
- 한 줄씩 허락(보고의 "넘길 줄"에 적는다): 앱 화면의 ⋯ menu file(`packages/mobile/src/screens/apps` 안. "Add to Home screen" 줄이 이 task의 함수를 부르게), `packages/mobile/src/data`(컴퓨터에 붙었을 때와 컴퓨터를 지울 때 맞추기를 부르는 줄. 공개 hook이 있으면 그것을 쓰고 없으면 한 줄)
- 읽을 것:
  - 판정: `/home/pyosechang/projects/lophn/reports/mobile-program/widget-spike.md`(S5, S6)
  - 기준: `tools/wireframes/drafts/phone/widgets.tsx`(launcher 확인, 놓인 아이콘, disable된 아이콘의 글), `apps.tsx`의 `AppMenu`와 `kit.tsx`의 `Mark`(아이콘이 없을 때의 머리글자 판)
  - 폰 앱: `packages/mobile/src/open/target.ts`(`openUrl`), `packages/mobile/src/data/mod.ts`(앱 목록과 상태, 컴퓨터 목록, 지우기), `app.icon` route(`packages/protocol/apps/declaration/read.ts`의 `appIcon`: png·webp·svg base64나 `{lucide}`), `packages/mobile/src/parts`(lucide·svg를 그리는 곳)
  - 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/widgets-survey.md`의 2.2, 계획 `README.md`의 "정한 것"
- 계약:
  - 쓰는 것: `appIcon`, 앱 목록(`apps/list`의 상태), `openUrl({kind: "app", host, app})`
  - 내놓는 것:
    - module: `pin({id, label, iconPng: base64, url}): Promise<void>`, `pinnedIds(): Promise<string[]>`(`getShortcuts(FLAG_MATCH_PINNED)`), `disable(ids, message)`, `enable(ids)`, `isPinSupported(): boolean`
    - shortcut id는 `lophn:<computer key>:<app id>`로 고정한다(Android가 id로 놓인 것을 되살린다). 폰에 따로 목록 file을 두지 않고 `pinnedIds()`를 읽는다
    - `addToHomeScreen(host, app)`: 아이콘 PNG(판정 S5의 길. 실패하면 머리글자 판)와 이름으로 `pin`
    - `reconcileShortcuts(host, apps)`: 그 컴퓨터의 놓인 id 가운데 앱이 없거나 보관된 것은 `disable(…, "This app was removed from <computer>")`, 다시 있는 것은 `enable`. 컴퓨터를 지우면 그 컴퓨터의 id를 모두 disable한다. 다른 컴퓨터의 id는 건드리지 않는다

## 할 일

1. module(Kotlin, `ShortcutManagerCompat`)과 그 `index.ts`. 판정 S6이 적은 launcher 동작(같은 id로 다시 부를 때, disable 뒤 누름)에 맞춘다.
2. `src/shortcuts/`: 아이콘 PNG 만들기(판정 S5), `addToHomeScreen`, `reconcileShortcuts`.
3. 앱 menu의 "Add to Home screen" 줄을 잇는다(`isPinSupported()`가 아니면 줄을 숨긴다). data 층에 붙을 때·지울 때 맞추기를 부른다. disable 글은 `t()`(`mobile.shortcut.*`).
4. dev build를 다시 짓고 emulator(port 5612, Metro 8252)에서 확인한다: `-read-only -memory 2048 -port 5612`, 모든 adb 명령에 `-s emulator-5612`, 끝나면 `adb -s emulator-5612 emu kill`, gradle은 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process`, 사람의 실제 폰(serial `R3CT90K6G2X`)에는 아무 명령도 보내지 않는다. 개발 core(`tools/remote-dev.ts`)와 아이콘 모양이 다른 앱 셋(png, svg, lucide)으로: 놓기와 launcher 확인, 누르면 앱 화면, `am force-stop` 뒤 누름, 앱 보관 뒤 연결하면 disable과 그 글, 되살리면 enable, 컴퓨터를 지우면 disable. 그림은 `.dev-data/mobile-shortcut-native/shots/`.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check`가 통과한다. dev build가 지어진다.
- 위험 test: 없음(잘못 disable해도 다음 연결에서 enable되고 data를 잃지 않는다. emulator에서 손으로 본다)
- 남지 않음: 없음

- flows catalog: 이 task가 더하거나 지우는 입구와 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 아이콘 그림 길과 세 모양의 결과, 더한 의존성과 판, launcher마다 다를 수 있는 동작(본 것과 못 본 것), 그림 목록.

## lead가 더함 (spike 판정 `reports/mobile-program/widget-spike.md`, 2026-11-16)

가정은 맞고 다섯 곳이 바뀐다. 보고서의 "Different from the assumptions", "Changes for the four native briefs", "Kotlin worth moving"를 먼저 읽는다. 이 brief의 본문과 다르면 아래가 맞다. spike의 코드는 `/home/pyosechang/projects/lophn-worktrees/spike-widgets`(branch `spike/widgets`)에 있다(읽기만).

- 아이콘은 화면 밖에 mount한 `<Svg>`의 `toDataURL` 192 px로 만든다(svg는 `parse`, lucide는 `import * as Lucide`와 `G` translate, png·webp는 그대로). 그 뒤 `createWithAdaptiveBitmap`(108/72 여백)으로 launcher 모양을 채운다. mount된 RN tree가 필요하니 앱이 앞에 있을 때 한다.
- 이미 pin된 id로 다시 부르면 창 없이 바로 true가 온다. `pinnedIds()`를 먼저 보고 "Add to Home screen" 줄을 감추거나 이미 있다고 말한다.
- disable한 아이콘을 누를 때의 글은 launcher가 정한다(Pixel Launcher는 우리 글이 아니라 "Shortcut isn't available"을 보인다). 글을 test하지 않고 본 것을 보고한다.
- 둘째 Kotlin module을 만들지 않고 `lophn-widgets` module에 넣는다(`mobile-widget-native`가 자리를 만든다).

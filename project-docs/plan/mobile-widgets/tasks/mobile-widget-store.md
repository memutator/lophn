# mobile-widget-store

폰 쪽 위젯 data를 짓는다: 놓인 위젯마다 어느 컴퓨터·앱·key인지(binding), 컴퓨터에서 받은 마지막 값과 시각(cache), 그것을 native가 JS 없이 그대로 그릴 수 있는 모양으로 적는 일, 그리고 언제 새로 하는가(`refreshWidgets()`). 위젯에 보이는 글은 여기서 `t()`로 만들어 cache에 적는다. native 위젯(`mobile-widget-native`)은 이 cache만 읽는다. 폰 allowlist에 `app_widgets/list`를 연다.

**spike 판정 뒤에 lead가 이 brief를 다시 본다**(계획 `README.md` "돌리기 전에"). 아래는 가정(headless JS로 새로 하기, cache file을 native가 읽는다)이다.

- 단위: widgets (wave 4)
- 선행: mobile-widget-core, mobile-open-target, mobile-widget-spike. `mobile-app`, `mobile-user-apps`, `mobile-push` land 뒤다(선행이 그 뒤라서). lead가 `packages/design/i18n/catalog/mobile-widgets.ts`를 빈 file로 만들어 `en.ts`에 올린 뒤에 띄운다
- 소유(이 task만 고친다):
  - `packages/mobile/src/widgets`(새 폴더: `store.ts`, `cache.ts`, `native.ts`, `cache.test.ts`)
  - `packages/protocol/remote/allowlist.ts`(`appWidgetsList` 한 줄)
  - `packages/design/i18n/catalog/mobile-widgets.ts`(위젯에 보이는 글의 key. 공유 catalog file이다)
- 한 줄씩 허락(필요할 때만. 보고의 "넘길 줄"에 적는다): `packages/mobile/src/data`에 "컴퓨터 하나에 붙어 route 하나를 부르고 닫는다"는 공개 함수가 없으면 그 함수 하나와 내보내기 한 줄
- 읽을 것:
  - 판정: `/home/pyosechang/projects/lophn/reports/mobile-program/widget-spike.md`(S1 그림 길, S3 앱이 죽은 채 새로 하기)
  - 계약: `packages/protocol/apps/widget.ts`(`appWidgetsList`, `WidgetValue`), `packages/mobile/src/open/target.ts`(`openUrl`)
  - 폰 앱: `packages/mobile/src/data/mod.ts`(컴퓨터 store, 연결, route 부르기, `StateChanged` 구독), `packages/mobile/src/connection/connection.ts`, `packages/mobile/README.md`
  - wireframe `tools/wireframes/drafts/phone/widgets.tsx`(사람이 승인한 위젯의 글과 상태)
  - 계획 `README.md`의 "정한 것"(best effort, 시각 꼬리, "Offline", 위젯 머리는 앱 이름과 label, 글은 TS가 만든다), 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/widgets-survey.md`의 2.1("Stale and unreachable", "Tap")과 3(폰 file)
- 계약:
  - 쓰는 것: `app_widgets/list`(컴퓨터마다), `StateChanged`의 `widgets`·`apps`·`releases`
  - 내놓는 것:
    - `native.ts`: `type WidgetNative = {readText(name): Promise<string | null>; writeText(name, text): Promise<void>; placedIds(): Promise<number[]>; redraw(ids?: number[]): Promise<void>}`와 메모리 fake. `mobile-widget-native`가 실제 module로 바꾼다
    - binding file `widgets/bindings.json` = `{v: 1, widgets: {[appWidgetId]: {host, app, key}}}`. `bindWidget(id, {host, app, key})`, `unbindMissing()`(launcher에 없는 id를 지운다)
    - cache file `widgets/cache.json` = `{v: 1, strings: {tap_to_choose, gone, computer_removed}, widgets: {[appWidgetId]: {state: "ok" | "gone" | "computer_removed", title, footer, stale: boolean, open_url, rows: WidgetNode[] | null, tone?}}}`. `title`은 "<앱 이름> · <위젯 label>", `footer`는 "Updated 14:05"나 "Offline 14:05"(마지막으로 받은 시각, 폰의 시간대와 시계 꼴), `stale`은 마지막 시도가 실패했는가, `open_url`은 `openUrl({kind: "app", host, app, screen?})`. binding이 없는 id는 cache에 없다(native가 "Tap to choose"를 그린다)
    - `refreshWidgets(reason)`: binding이 있는 컴퓨터마다 붙어 `app_widgets/list`를 부르고 닫고, 받은 것으로 cache를 다시 쓰고 `redraw()`. 실패한 컴퓨터의 위젯은 옛 rows를 두고 `stale`. 앱이나 key가 목록에 없으면 `gone`, 컴퓨터가 pairing 목록에 없으면 `computer_removed`이고 rows를 지운다
    - 부르는 때: 앱이 앞으로 올 때, 연결된 동안 `StateChanged`의 `widgets`·`apps`·`releases`, background 진입(`refreshWidgetsInBackground()`. headless task 이름 `LophnWidgetRefresh`. 등록은 `mobile-widget-native`가 한다), 컴퓨터를 지울 때

## 할 일

1. `cache.ts`: binding과 받은 목록과 지금 시각으로 cache 모양을 만드는 순수 함수(React Native를 import하지 않는다). 글은 `@lophn/i18n`의 `t()`로, 새 key는 `mobile.widget.*`.
2. `store.ts`: file 읽기·쓰기(`WidgetNative`로), `refreshWidgets`, 부르는 때를 다는 hook(`useWidgetRefresh()`. 앱 root에 다는 줄은 `mobile-widget-native`가 한다), `bindWidget`.
3. `allowlist.ts`에 `appWidgetsList`(사람 자격 읽기다. 폰이 위젯을 그리려면 읽어야 한다).
4. `cache.test.ts`: 위험 test 하나.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check`가 통과한다.
- 위험 test: "pairing 목록에서 지운 컴퓨터에 묶인 위젯은 다음 cache에서 rows가 지워지고 `computer_removed`가 된다. 다른 컴퓨터의 값이 그 자리에 들어가지 않는다"(`cache.test.ts`. 폰을 넘긴 뒤에도 지운 컴퓨터의 data가 홈 화면에 남지 않게)
- 남지 않음: 없음(더하기만)

- flows catalog: 이 task가 더하거나 지우는 route 허용과 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: cache file 예 하나(ok, stale, gone 세 위젯), `WidgetNative`의 모양(native task가 그대로 구현한다), 더한 i18n key 목록.

## lead가 더함 (spike 판정 `reports/mobile-program/widget-spike.md`, 2026-11-16)

가정은 맞고 다섯 곳이 바뀐다. 보고서의 "Different from the assumptions", "Changes for the four native briefs", "Kotlin worth moving"를 먼저 읽는다. 이 brief의 본문과 다르면 아래가 맞다. spike의 코드는 `/home/pyosechang/projects/lophn-worktrees/spike-widgets`(branch `spike/widgets`)에 있다(읽기만).

- 배경 새로 하기 함수는 끝나면 native에 끝났다고 알리고(task의 promise가 풀린다), 겹친 호출을 하나로 합치고, 앱이 떠 있으면 살아 있는 연결을 쓰고 아니면 한 번 붙어 한 번 부르고 닫는다(주소 중복을 걷고 컴퓨터마다 8초쯤). React tree가 필요한 것을 import하지 않는다(SecureStore는 headless에서 된다). 꼬리의 시각은 마지막으로 가져온 시각이다. 죽은 process에서 약 1초가 걸리고 그 가운데 0.7초가 Noise handshake다.

# bt-settings-clear

Settings에 Browser pane을 더하고 [Clear browsing data]를 넣는다. 확인 dialog를 띄운 뒤 main이 `persist:lophn-browser`의 cookie, site data, cache를 지우고 열린 browser 탭을 다시 load한다(main 쪽은 `bt-view`가 이미 연 `BROWSER_CLEAR_DATA_CHANNEL`이다). bookmark 목록은 `bt-settings-bookmarks`가 같은 pane에 더한다.

- 단위: bt-settings (wave 2)
- 선행: bt-tab-page
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/browser/source.ts`
  - `packages/shell/renderer/desktop/settings/browser/window-source.ts`
  - `packages/shell/renderer/desktop/settings/browser/browser-panel.tsx`
  - `packages/shell/renderer/desktop/settings/browser/testdata/fake-source.ts`
  - `packages/shell/renderer/desktop/settings/model.ts`
  - `packages/shell/renderer/desktop/settings/settings-screen.tsx`
  - `packages/shell/renderer/icons/settings.ts`
  - `packages/shell/renderer/desktop/entry.tsx`
  - `packages/shell/renderer/desktop/dev-mock/admin.ts`
  - `packages/design/wording/catalog/browser.ts`
  - `packages/design/wording/catalog/browser.placeholders.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-tab/README.md`
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 4(Settings에 Browser pane, Clear browsing data)와 "정한 것"의 지우기 단추 이유
  - skill: `.claude/skills/ui-design/SKILL.md`("모든 화면의 규칙": 행동 단추는 줄 오른쪽 끝 고정 열, 탭 안 알림은 `Toast`), `.claude/skills/wording/SKILL.md`
  - 본보기(pane): `packages/shell/renderer/desktop/settings/reactions/`(`reactions-panel.tsx`, `source.ts`, `core-source.ts`, `testdata/`), `appearance/`, `settings-screen.tsx`(`SettingsPanels`, `bodyOf`), `model.ts`(`SETTINGS_GROUPS`), `dev-mock/admin.ts`의 `mockSettingsPanels`
  - 본보기(dialog): `packages/shell/renderer/desktop/settings/providers/available-list.tsx`의 `Dialog`
  - 이 task가 쓰는 것: bt-contract(`window.lophnBrowser.clearData`), bt-tab-page(wording 영역 file `catalog/browser.ts`와 `BrowserApiProvider`가 놓인 `entry.tsx`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
- 계약:
  - 쓰는 것: `LophnBrowserApi.clearData(): Promise<void>`(`window.lophnBrowser`).
  - 내놓는 것: `settings/browser/source.ts`의 `BrowserSettingsSource { clearData(): Promise<SourceResult<null>> }`(`bt-settings-bookmarks`가 bookmark 메서드를 옆에 더한다), `SettingsPane`의 `"browser"`, `SettingsPanels`의 `browser`.

## 할 일

1. `settings/model.ts`: `SettingsPane`에 `"browser"`, `SETTINGS_GROUPS`의 `general` 묶음(General, Appearance 다음)에 `{ id: "browser", label: "settings.label.tab-browser", icon: settingsIcons.browser }`. `icons/settings.ts`에 `browser: Globe`.
2. `settings/browser/source.ts`, `window-source.ts`(`window.lophnBrowser`를 `BrowserSettingsSource`로 잇는다. 없으면 `unavailable`로 답한다. 거절은 `{ ok: false, code }`), `testdata/fake-source.ts`(`fakeBrowserSettings()`로 `{ source, calls }`. 지우기가 거절되는 code를 고를 수 있다).
3. `settings/browser/browser-panel.tsx`: 머리와 "Browsing data" 구역. 설명 한 줄, 행 오른쪽 끝 고정 열의 [Clear browsing data] 단추. 누르면 `Dialog`(제목·본문·[Cancel]·[Clear])가 열린다. [Clear]가 `source.clearData()`를 부르고, 성공이면 `Toast`("Browsing data cleared."), 실패면 error `Toast`. 설정 pane의 다른 panel(`reactions-panel.tsx`)의 간격·기둥을 따른다.
4. `settings-screen.tsx`: `SettingsPanels`에 `"browser"`를 더하고 `props.browser`, `bodyOf`의 `case "browser"`(`browser && <BrowserPanel source={browser} />`, 다른 pane처럼 `styles.panel`로 감싼다).
5. 조립: `entry.tsx`의 `settingsPanels`에 `browser: windowBrowserSettings()`(`mock?.settingsPanels` 갈래는 `dev-mock/admin.ts`의 `mockSettingsPanels()`에 `browser: fakeBrowserSettings().source`).
6. wording: `catalog/browser.ts`에 key를 더한다. `settings.label.tab-browser`("Browser"), 구역 제목, 설명("Signs you out of sites and removes cookies, site data, and cached files for the Browser tab."), 단추 이름, dialog 제목과 본문("This signs you out of every site in Browser tabs and reloads the open ones."), 확인 단추, 성공·실패 알림. `deno task wording`.

## 정한 것

- Browser pane은 `general` 묶음에 둔다(General, Appearance 옆). roadmap이 자리를 정하지 않았다.
- 지우기 종류를 고르지 않고 한 묶음으로 지운다(roadmap "정한 것": history를 모으지 않는다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(화면이다. 지우는 일은 Electron session 호출뿐이다).
- 남지 않음: 없음.
- `deno run -A packages/shell/renderer/build.ts`가 서고, `deno task dev:mock`에서 Settings의 Browser 항목이 열린다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성(`deno task wording`을 돌렸다)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

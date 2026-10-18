# bb-settings

Settings의 Browser pane에 "Links" 구역을 더한다. web link와 local link를 각각 열 곳(`Browser tab` | `System browser`)을 Select로 고른다. 값은 core의 선언 설정(`shell.browser.web_links`, `shell.browser.local_links`)이고, main의 bridge가 요청마다 읽는다(`bb-server`). 화면은 Appearance pane처럼 선언 설정을 읽고 쓰는 길을 쓴다.

- 단위: bb-settings (wave 2)
- 선행: bb-policy
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/browser/browser-panel.tsx`
  - `packages/shell/renderer/desktop/settings/browser/link-rows.tsx`
  - `packages/shell/renderer/desktop/settings/browser/model.ts`
  - `packages/shell/renderer/desktop/settings/browser/source.ts`
  - `packages/shell/renderer/desktop/settings/browser/window-source.ts`
  - `packages/shell/renderer/desktop/settings/browser/testdata/fake-source.ts`
  - `packages/design/wording/catalog/browser.ts`
  - `packages/design/wording/catalog/browser.placeholders.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-bridge/README.md`("정한 것": 설정을 main이 읽는다)
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 4
  - 본보기(화면): `packages/shell/renderer/desktop/settings/appearance/appearance-panel.tsx`(줄 하나: `NamedControl`, `Select`, 저장 실패 시 되돌리기), `appearance/model.ts`의 `APPEARANCE_ROWS`, `appearance/core-source.ts`(`readEffective`, `chooseSetting`), `desktop/settings/declared.ts`
  - 본보기(자리): `browser/browser-panel.tsx`의 section 모양(`styles.groupTitle`, `styles.lines`, `styles.line`), `browser/window-source.ts`
  - 본보기(wording): `packages/design/wording/catalog/browser.ts`의 `settings.heading.*`·`settings.note.*`. skill은 `wording`(`.claude/skills/wording/SKILL.md`)을 먼저 읽는다.
  - 이 task가 쓰는 것: bb-policy가 core에 선언한 두 key(`shell.browser.web_links`, `shell.browser.local_links`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`
- 계약:
  - 쓰는 것: core 선언 설정 두 key(값 `browser_tab` | `system_browser`). General pane은 `shell.` prefix를 이미 숨긴다(`general/model.ts`의 `SHOWN_ELSEWHERE`).
  - 내놓는 것: `BrowserSettingsSource`의 새 member 둘: `links(): Promise<SourceResult<LinkValues>>`, `chooseLink(id: LinkId, value: LinkWhere): Promise<SourceResult<null>>`. `LinkId = "web_links" | "local_links"`, `LinkWhere = "browser_tab" | "system_browser"`, `LinkValues = Readonly<Record<LinkId, LinkWhere>>`. gallery가 `fakeBrowserSettings()`로 이 member를 채운다.

## 할 일

1. `source.ts`: 위 type과 member를 더한다.
2. `window-source.ts`: `windowBrowserSettings(core: CoreSource = windowCoreSource())`가 `links`·`chooseLink`를 선언 설정 읽기·쓰기(`../declared.ts`의 `readEffective`, `chooseSetting`)로 만든다. 값이 `browser_tab`·`system_browser`가 아니면 그 줄은 기본값 `browser_tab`이다. `entry.tsx`를 고치지 않으려고 기본 인자로 core 통로를 얻는다(계획 `workspace-detach`가 `entry.tsx`를 고친다).
3. `model.ts`: 줄 목록 `LINK_ROWS`(`id`, `settingKey`, `name`·`help`의 wording key, 선택지 둘)만 둔다. `APPEARANCE_ROWS`와 같은 꼴이다.
4. `link-rows.tsx`와 `browser-panel.tsx`: Bookmarks 구역과 Browsing data 구역 사이에 "Links" 구역을 둔다. 줄 둘은 이름과 설명이 왼쪽, Select가 오른쪽 끝 고정 열이다(Appearance 줄과 같은 `NamedControl`·`styles`). 고르면 바로 저장하고, 저장하지 못하면 앞의 값으로 되돌리고 `settings.error.value-not-saved`를 쓴다. 읽기에 실패하면 이 구역만 숨기지 않고 오류 문장을 보인다(Bookmarks 구역의 실패 처리 꼴).
5. `testdata/fake-source.ts`: `fakeBrowserSettings`가 `links`·`chooseLink`를 메모리로 채운다(옵션으로 처음 값을 받고, 부른 일을 `calls`에 둔다). `chooseLink`가 거절하는 옵션도 하나 둔다.
6. wording: `catalog/browser.ts`와 `browser.placeholders.ts`에 구역 제목(Links), 줄 이름·설명 둘, 선택지 이름 둘(Browser tab, System browser)을 더한다. 설명은 web은 "공개 web 주소", local은 "localhost, 같은 네트워크 주소(`.local`, 사설 IP)", 둘 다 "terminal에서 연 주소와 Ctrl/Cmd-click한 link"가 열릴 곳이다. 영어 문구는 `wording` skill 규칙대로 쓰고 `deno task wording`을 돌린다.
7. test는 쓰지 않는다(화면과 문구다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음.
- 남지 않음: 없음(새 줄).
- 화면: `deno task wireframes`가 깨지지 않는다(gallery page는 `bb-gallery`가 더한다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성(`deno task wording`)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

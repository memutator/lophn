# kit-gallery-split

`tools/wireframes`를 `pages/kit/<분류>/`, `pages/screens/`, `mock/`, `drafts/`로 나눈다. 옛 `frames/` 폴더는 없어진다. design 쪽 page(components·sdk) 21개는 분류마다 page 하나(`Kit · <분류>`)로 합친다. wireframe 전용 코드는 승인된 것이 없어서(renderer·design으로 옮길 코드 0) 폴더만 나눈다.

- 단위: kit-gallery (wave 2)
- 선행: kit-gallery-copies
- 소유(이 task만 고친다):
  - `tools/wireframes`
- 읽을 것:
  - 계획: `project-docs/plan/ui-kit/README.md`의 `kit-gallery`, "gallery index"(이 task 다음 `gallery-index`가 page 목록을 다시 짠다), `classification.md` 4절 전체와 5절 9·10번
  - 요구: `project-docs/products/roadmap/ui-kit-single-source.md`의 "바꿀 모양" 트리와 check 1·2
  - 이동 도구: `tools/move-files.ts` 머리 주석
  - skill: `.claude/skills/ui-design/SKILL.md`
- 계약:
  - 쓰는 것: `kit-sdk-move`가 놓은 예제(`tools/wireframes/pages/kit/<분류>/`, `pages/kit/app-ui/`, `pages/kit/tokens/chart-colors.ts`), 분류 `mod.ts`
  - 내놓는 것: 아래 폴더 모양과, 분류마다 `tools/wireframes/pages/kit/<분류>/page.tsx`가 `Kit<이름>()`(`KitPrimitives`, `KitInput`, `KitLayout`, `KitNavigation`, `KitData`, `KitFeedback`, `KitOverlay`, `KitReading`)을 내보낸다. `pages/kit/app-ui/page.tsx`는 `KitAppUi()`, `pages/kit/tokens/`는 `TokensColors` 등 기존 이름 그대로. 다음 task들(`kit-gallery-*`)은 자기 분류 폴더만 고친다.

## 폴더 모양

```
tools/wireframes/
  build.ts main.tsx gallery.tsx gallery.module.css index.html css-modules.d.ts deno.json pages.ts   # 그대로(내용만 고침)
  screens.tsx                 # 옛 frames/screens.tsx. SCREENS 표. gallery-index가 없앤다
  pages/kit/kit.tsx kit.module.css   # 옛 frames/design/kit.{tsx,module.css}. gallery의 틀. CSS 예외는 이 두 파일(gallery.module.css 포함)뿐
  pages/kit/<분류>/           # primitives input layout navigation data feedback overlay reading, 각 page.tsx + 예제 + 쪼갠 section
  pages/kit/tokens/           # 옛 frames/design/tokens-pages.tsx, 예제 chart-colors.ts
  pages/kit/app-ui/           # order-actions 예제와 page.tsx
  pages/screens/              # 옛 frames/compositions의 화면 file(하위 폴더 이름 그대로)
  mock/                       # fake data, 고정 도구, mock desktop, 가짜 터미널·창 통로
  drafts/                     # 승인 전 실험. CSS는 여기서만 허용
```

## 할 일

근거: `classification.md` 4절(4A·4B·4C 표의 "제안" 열), 5절 10번. 정한 것 셋.
- 폴더 이름은 `pages/screens/` 아래에 지금의 하위 폴더(`agent-setup/`, `agent-tab/`, `app-space/`, `contexts/`, `project-files/`, `waiting/`, `workspace/`)를 그대로 둔다. 제품 영역별 묶음은 `gallery-index`가 한다.
- 분류 page는 분류마다 하나(`page.tsx`)로 한다(README: "Kit의 page는 분류마다 하나").
- gallery의 `part`(`design/now/new`)와 badge는 이 task에서 건드리지 않는다. `gallery-index`가 한다.

1. mapping 파일을 worktree 밖 임시 경로에 쓰고(commit하지 않는다) `tools/move-files.ts`로 옮긴다. 먼저 `--dry-run --report`로 본다. 파일은 `git ls-files tools/wireframes`로 센다. 규칙:
   - `frames/design/kit.tsx`·`kit.module.css` → `pages/kit/`
   - `frames/design/tokens-pages.tsx` → `pages/kit/tokens/tokens-pages.tsx`
   - `frames/design/components-pages.tsx`, `frames/design/sdk-pages.tsx` → 3번에서 쪼갠 뒤 지운다(옮길 file이 아니다. 옮기기 전에 import 경로만 맞춘다)
   - `frames/screens.tsx` → `screens.tsx`, `frames/mock-desktop.tsx`·`frames/fake-terminal.ts` → `mock/`, `frames/chrome/window-api.ts` → `mock/window-api.ts`
   - `frames/compositions/` 안:
     - drafts: `ways-page.tsx`, `link.tsx`, `ways.ts`(ways-page만 쓰면. 다른 곳이 쓰면 mock), `compose.module.css`(남은 `.ways*`·`.link`), `waiting/waiting.module.css`, `workspace/workspace.module.css`, `app-space/app-space.module.css`의 annotate 표식 부분을 `drafts/app-space/annotate-marks.module.css`로 나눠 간 것, `contexts/contexts.module.css`(규칙 넷뿐이다. renderer class나 token inline으로 지울 수 있으면 지우고 못 지우면 drafts. 지울 때 쓰는 곳 `pm-session.tsx`, `contexts-list.tsx`를 같이 고친다)
     - mock: `agents-data.ts`, `phroner-data.ts`, `model-options.ts`, `models-data.ts`, `demo-steps.ts`, `driven.tsx`, `project-files/file-data.ts`, `contexts/{contexts-data.ts,glossary.tsx,host.tsx,clicks.ts,open-tab.ts}`, `app-space/{data.ts,coding-terminal.ts,drive.ts,orders-view.tsx}`, `agent-setup/drive.ts`, `workspace/{drive.ts,register-panel.tsx}`. `model-picker.tsx`(10줄, renderer picker를 re-export)는 지우고 import하던 곳이 renderer의 `conversation/model-picker/model-picker.tsx`를 직접 import한다
     - 나머지 전부(`agent-chat.tsx`, `agent-pages.tsx`, `agent-setup/agent-setup-pages.tsx`, `agent-tab/scenes.tsx`, `agents-tab.tsx`, `app-space/{pages.tsx,space.tsx}`, `bodies.tsx`, `context-body.tsx`, `contexts/{context-pages.tsx,contexts-list.tsx,declared-search.tsx,pm-session.tsx}`, `conversation.tsx`, `documents.tsx`, `project-app.tsx`, `project-files/{file-search.tsx,notices.tsx,pages.tsx,viewers.tsx}`, `project-pages.tsx`, `project-window.tsx`, `waiting/waiting-pages.tsx`, `workspace-page.tsx`, `workspace/{launcher-pages.tsx,pages.tsx,start-failure-page.tsx}`): `pages/screens/` 아래 같은 하위 경로
   - `mock/`이 `drafts/`의 css를 import하는 곳이 생기면(orders-view의 annotate 표식) 그대로 둔다. 이유: 그 표식은 shell preload가 앱 view에 주입하는 UI의 look-alike라서 승인 전 drafts다.
   - `frames/` 폴더가 비어 없어졌는지 본다.
2. `drafts/`에 둘 page는 `pages.ts`에 지금 올라 있는 그대로 둔다(`new-ways-to-open`). `drafts/` 폴더가 만들어졌고 그 안 CSS가 `drafts/` 밖에서 import되지 않게(위 mock의 예외 하나만) 한다.
3. design page를 분류로 쪼갠다. `components-pages.tsx`와 `sdk-pages.tsx`(241줄, 예제 10개를 `Page`/`Section`에 넣어 그리는 page)의 section을 코드 그대로 옮긴다(다시 그리지 않는다).

   | 옛 section | 새 자리 |
   |---|---|
   | Components · buttons의 Button, IconButton, Kbd, CopyButton | `pages/kit/primitives/page.tsx` |
   | Components · form controls | `pages/kit/input/page.tsx` + `control-sizes`·`orders-filters` 예제 section |
   | Components · navigation의 Tabs | `pages/kit/navigation/page.tsx` |
   | Components · navigation의 Tree, List / Components · table / Components · cards의 StatTile·StatRow | `pages/kit/data/page.tsx` + `orders-table`·`orders-summary`·`sales-dashboard` 예제 section |
   | Components · cards의 Card / Components · frames | `pages/kit/layout/page.tsx` + `orders-app` 예제 section |
   | Components · states의 EmptyState, ErrorState, Skeleton, StaleNote, StatusMark | `pages/kit/feedback/page.tsx` + `orders-status` 예제 section |
   | Components · states의 DiffMark | `pages/kit/reading/page.tsx` + `weekly-report` 예제 section |
   | Components · menus, dialogs & sheet & palette, toast | `pages/kit/overlay/page.tsx` + `overlays` 예제 section |
   | SDK · actions | `pages/kit/app-ui/page.tsx` |
   | SDK · tokens(chart colors) | `pages/kit/tokens/` 에 page 하나(`tokens-chart`) |

   section은 분류 폴더 안 파일 여럿으로 나눠도 되고 `page.tsx` 하나에 둬도 된다(분류 폴더 안에서만). 이 task는 menu·dialog·sheet·palette의 look-alike(css module import)를 바꾸지 않는다(`kit-gallery-overlay`).
4. `pages.ts`와 `screens.tsx`를 맞춘다: 옛 `components-*`·`sdk-*` page 21개를 빼고 `kit-primitives`, `kit-input`, `kit-layout`, `kit-navigation`, `kit-data`, `kit-feedback`, `kit-overlay`, `kit-reading`, `kit-app-ui`(제목 `Kit · <분류>`, 한국어 description 한두 문장: 그 분류가 무엇을 그리는지)와 `tokens-chart`(제목 `Tokens · chart colors`)를 올린다. part는 `design`이다. `ScreenId`·`SCREENS`·`pages.ts`의 머리 주석 "page 하나를 더하는 법"을 새 경로(`pages/kit/...`, `pages/screens/...`)로 고친다. 다른 page(`now`, `new`)의 id는 그대로 둔다.
5. 같은 일을 하는 hook 5개(`useDemo`(`demo-steps.ts`), `useDrive` 둘(`agent-setup/drive.ts`, `app-space/drive.ts`), `useWorkspaceDrive`(`workspace/drive.ts`), `useClicks`(`contexts/clicks.ts`))를 `mock/drive.ts` 하나로 합친다(`classification.md` 4B 표: "이동 때 같이 할 일"). 모양이 달라 합치면 코드가 늘어나는 것만 그대로 두고 보고한다.
6. `build.ts`·`gallery.tsx`·`main.tsx`의 import 경로가 맞는지 본다. 문서(ui-design skill의 "어디를 고치나" 표 등)는 lead가 고친다.

## 끝남

- `deno task check`가 통과한다.
- `deno task wireframes`가 되고, gallery의 모든 page(`#/<id>`)가 열린다. 옛 `now`·`new` page의 id와 화면이 그대로다. 새 `kit-*` page 9개와 `tokens-chart`가 그려진다.
- 위험 test: 없음
- 남지 않음:
  - `ls tools/wireframes/frames`가 없다.
  - `git ls-files tools/wireframes | grep "\.css$"`이 `tools/wireframes/gallery.module.css`, `tools/wireframes/pages/kit/kit.module.css`, `tools/wireframes/drafts/**`, 그리고 `kit-sdk-move`가 옮긴 예제 css 5개(`pages/kit/{input,layout,overlay,reading,app-ui}/*.module.css`)와 look-alike를 위해 import하는 renderer·design css(이건 파일이 `tools/` 밖이다)뿐이다. `tools/wireframes/pages/screens/`와 `mock/` 안에 CSS가 없다.
  - `grep -rn "frames/" tools/wireframes --include=*.ts --include=*.tsx | grep -v dist`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 (`pages.ts`·`screens.tsx`는 이 task 소유다)
- 안 쓰게 된 export: 없음
- 정한 것: 폴더 모양, hook 합친 범위, contexts.module.css를 어떻게 했는지, `ways.ts`를 어디에 둔 건지
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없음
- 무겁게 짠 것: 없음이 기본
- 알려진 미완 동작: 예제 `.module.css` 5개와 menu·dialog·sheet·palette look-alike는 `kit-gallery-*`가 없앤다. 분류 page의 export 빠짐도 그 task들이 채운다

## lead가 더함

- (lead가 더함) `kit-gallery-copies`가 Orders tile은 design `StatTile`·`StatRow`로 바꿨지만, Orders 표는 바꾸지 못했다. design `Table`에 단추 칸(`Mark shipped`)과 annotate 표식으로 감싸는 칸이 없다. design `Table`은 고치지 않는다. Orders view는 사용자 앱이 그리는 view의 가짜 그림이라 lophn kit 부품이 아니다. 그래서 `frames/compositions/app-space/app-space.module.css`를 나누지 않고 통째로 `drafts/app-space/orders-view.module.css`로 옮긴다. 남은 class는 앱 틀(`.muted .appView .appHead .appTitle`), 표 그림(`.orders* .num`), annotate 표식이다. `orders-view.tsx`는 계획대로 `mock/app-space/`로 가고 이 drafts css를 import한다. 이 import가 1번이 말한 예외 하나다. `app-space/space.tsx`나 `pages.tsx`가 이 css를 쓰면 그 file도 같은 css를 import한 채 둔다. 보고에 그 file 이름을 적는다.
- (lead가 더함) 임시 file(mapping, script 출력)은 worktree 안 `.dev-data/kit-gallery-split/`에 둔다. tool의 folder mapping은 from·to 끝에 `/`를 붙인다. tool은 working tree가 더러우면 막힌다.

# annotation-page

앱 view의 preload에 들어가는 고르기 script를 짓는다: annotate mode 동안 클릭과 끌기를 가로채 요소나 영역을 고르고, 가리킨 요소의 윤곽과 이름표, 번호 표지, 메모 칸을 앱 화면 위 층에 그리고, 목록을 main에 보낸다. 보낼 때 main이 부르면 그 annotation의 윤곽과 표지만 그려 자를 범위를 알려 준다.

- 단위: annotation (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/preload/annotate/` (새 폴더. ownership.md상 packages/shell/preload/는 contract-shell 몫이라 보고의 "소유 바꾸기"에 적혀 있다)
- 읽을 것:
  - spec: S9 3~6장, 12장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/annotation.md`
  - 참고 노트(ChatGPT browser comment를 거꾸로 따라간 것): `/home/pyosechang/projects/lophn/project-docs/tmp/browser-anottation/chatgpt-browser-annotation.md`
  - inventory: 이 단위는 assignment.md에 줄이 없다. 이 task가 받는 줄은 `I3.9#1`의 페이지 쪽(요소·영역 고르기, 화면 위치 얻기. `/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`)이다. `I3.12#1`(SDK component가 요소에 단 `data-lophn-component`)은 ui-chrome가 이미 했다
  - 화면 모양(옮기지 않고 모양을 따른다. 이 층은 React가 아니라 shadow DOM이다): `tools/wireframes/frames/compositions/app-space/orders-view.tsx`(고른 요소의 윤곽, 이름표, 번호 표지, 메모 칸이 앱 화면 위에 붙는 모양)와 같은 폴더의 `app-space.module.css`(색, 두께). 모은 목록 panel(`annotate.tsx`)은 screens-app-space 몫이다. 화면 문구는 preload가 `packages/design/wording`을 읽지 못하므로 이 폴더의 `labels.ts` 한 곳에 모은다(보고)
  - 지금 코드: `packages/shell/preload/app-api.ts`(`watchMainWorldErrors`: 페이지 world에서 도는 함수 넘기는 법, DOM 타입 없이 쓰는 법), `packages/shell/preload/app.ts`(preload 진입)
- 계약:
  - 쓰는 것: `shell/ipc/annotation.ts`의 `ANNOTATE_PAGE_*` 채널 여섯과 `pickedItemSchema`의 모양. 요소의 `data-lophn-component` 속성(ui-chrome). 선택: 요소의 `data-lophn-at="<file>:<line>:<column>"` 속성이 있으면 `bundle_position`으로 읽는다(앱 build가 SDK component 사용 지점의 bundle 위치를 싣는 일은 아직 소유가 없다. 없으면 null)
  - 내놓는 것: `installAnnotate(transport)`(`preload/annotate/mod.ts`). `preload/app.ts`가 부르는 한 줄은 lead가 더한다(보고)

## 할 일

모두 `packages/shell/preload/annotate/` 안의 새 file이다. 순수 계산과 DOM 그리기를 file로 나눈다. tsconfig(`packages/shell/main/tsconfig.json`)의 `lib`는 ES2023뿐이라 DOM 타입이 없다. 가장 작은 길을 고른다: 맨 위 `/// <reference lib="dom" />`가 lint를 통과하면 그것을, 막히면 쓰는 DOM 요소의 최소 interface를 이 폴더에 선언한다(`app-api.ts`가 `ErrorTarget`을 쓰는 방식). 고른 쪽을 보고에 적는다.

1. `mod.ts` — `installAnnotate(transport)`. `transport`는 `{send(channel, payload), on(channel, listener)}`다(`preload/app.ts`의 `ipcRenderer`를 감싼다). `annotate:set-mode`, `annotate:remove`, `annotate:prepare-capture`, `annotate:clear-capture`를 듣는다. mode가 꺼져 있으면 DOM에 아무것도 달지 않고 앱의 이벤트도 가로채지 않는다.
2. `overlay.ts` — 앱 view 위 층 (S9 4장 1~4)
   - 페이지 DOM에 host 요소 하나를 `documentElement`에 붙이고 closed shadow root 안에 그린다. 앱 CSS와 섞이지 않게 모든 스타일은 shadow 안에 둔다. `position: fixed; inset: 0`, 가장 높은 z-index.
   - mode가 켜지면 capture phase에서 `pointerdown`·`pointermove`·`pointerup`·`click`·`keydown`을 가로채고 `preventDefault`·`stopPropagation`한다(앱에 닿지 않는다). 끄면 모두 뗀다. Esc는 `annotate:exit`를 main에 보낸다.
3. `pick.ts` — 고르기 (S9 4장 3·4)
   - 가리키면: 점 아래 요소(`document.elementsFromPoint`에서 host를 뺀 첫 요소)에서 위로 올라가 처음 만나는 `data-lophn-component` 요소를 대상으로 한다. 없으면 가리킨 요소 그대로. 대상에 윤곽 사각형과 이름표를 그린다: 이름표는 component 이름, SDK component가 아니면 `role "접근 이름"`.
   - 클릭하면 `element` 한 개를 만든다. 끌면(이동 4px 이상) 사각형 `region` 한 개를 만든다. 둘 다 번호 표지와 메모 입력 칸(textarea, 2000자 이하)이 붙는다. 메모를 바꿀 때마다 목록을 다시 보낸다.
   - 한 번 고른 것은 같은 대상을 다시 클릭해도 중복으로 만들지 않고 그 메모 칸으로 focus한다.
4. `describe.ts` — 순수 함수들 (test 없이도 읽기 쉽게 DOM 객체를 인자로 받는다)
   - `roleOf(el)`: `role` 속성, 없으면 태그별 기본 role(button, link, heading, textbox, checkbox, img, row, cell, listitem 등 흔한 것만).
   - `nameOf(el)`: `aria-label`, `aria-labelledby`, `alt`, 연결된 `<label>`, `title`, 보이는 글 순서로. 120자로 자른다.
   - `textOf(el)`: 보이는 글(가까운 글 포함) 200자 이하. 줄바꿈은 공백으로.
   - `bundlePositionOf(el)`: `data-lophn-at`을 `{file, line, column}`으로. 모양이 다르면 null.
5. `geometry.ts` — 위치 계산 (S9 4장 6)
   - 고른 순간의 viewport 크기와 scroll 값으로 `rect = {x_ratio, width_ratio, y_px, height_px, scroll_x, scroll_y}`를 만든다(`x_ratio`는 viewport 너비에 대한 비율, `y_px`는 viewport 위에서의 px). 요소를 고른 것이면 그 요소의 `WeakRef`도 쥔다.
   - 다시 그릴 때(resize, scroll, 목록 변경): 요소가 아직 연결돼 있으면 그 요소의 현재 사각형을 쓰고, 사라졌으면 적어 둔 사각형을 현재 viewport와 scroll 값으로 옮겨 쓴다. 보낸 뒤에는 앱 화면에 남기지 않는다(mode를 끄면 층을 걷는다).
   - 자를 범위 `cropOf(item)`: 고른 사각형과 번호 표지를 합친 것에 둘레 16px 여백을 더하고 viewport 안으로 자른다.
6. 목록 보내기: 고른 것이 생기거나 지워지거나 메모가 바뀔 때마다 `annotate:items {items}`로 전체 목록을 보낸다. 각 item은 `pickedItemSchema` 모양이다: `{n, kind, note, component, bundle_position, element: {role, name, text}, rect, path: location.pathname + location.hash(512자 이하)}`. 번호 `n`은 1부터 이 폴더가 매기고 지워도 다시 매기지 않는다. `annotate:remove {n | "all"}`를 받으면 그 표지를 걷고 목록을 다시 보낸다.
7. capture 준비 (S9 6장 2): `annotate:prepare-capture {n}`을 받으면 가리키기 윤곽·이름표·메모 칸·다른 annotation의 표지를 숨기고 그 annotation의 윤곽과 번호 표지만 그린 뒤, 두 번 `requestAnimationFrame`을 기다려 `annotate:capture-ready {n, crop}`을 보낸다. `annotate:clear-capture`를 받으면 원래 층 상태로 되돌린다.
8. 화면 문구(`Annotate is on` 같은 toast는 renderer 몫이고 여기엔 메모 칸 placeholder 정도)는 `labels.ts` 한 곳에 모은다.

## 끝남

- `deno task check`가 통과한다. shell main의 type check(`tsc`, `packages/shell/main/package.json`의 check)도 통과한다.
- 위험 test: 없음. 화면과 DOM 세부는 test하지 않는다(`/home/pyosechang/projects/lophn/project-docs/dev/testing.md`). 손으로 확인할 흐름은 보고에 적는다.
- 남지 않음: 해당 없음(새 폴더).

## 보고

- 바꾼 file
- 등록할 것: `packages/shell/preload/app.ts`에서 `installAnnotate`를 부르는 한 줄(lead. 이미 있는 `contextBridge`·`ipcRenderer` transport를 넘긴다). DOM 타입을 쓰는 방식이 tsconfig 변경을 요구하면 그 요청(check 단위)
- 안 쓰게 된 export: 없음
- 정한 것: DOM 타입을 얻은 방식, 메모 길이, 윤곽 색과 표지 모양(wireframe을 따른 곳과 못 따른 곳), 끌기 임계값 4px
- 계약 바꾸기 요청(wave 3): `pickedItemSchema`나 채널에서 모자란 칸. `data-lophn-at`을 다는 쪽(SDK jsx runtime 또는 build)이 없어 `bundle_position`이 항상 null인 것

- (lead가 더함, annotation-shell이 넘긴 것. 추가 소유, lead 승인: `annotatePageCaptureReadySchema`) crop을 PNG px로 바꾸려면 viewport 크기가 필요하다. 계약 `annotatePageCaptureReadySchema`에 `viewport: {width, height}`(CSS px)를 더하고, 앱 view 페이지가 `capture-ready`에 `viewport: {width: innerWidth, height: innerHeight}`를 같이 보낸다. 그 뒤 `shell/main/app-frame/capture.ts`의 local 확장 `captureReadySchema`를 걷는다. 안 보내면 모든 annotation이 screenshot 없이 간다. 번호는 페이지가 쥐고, 보낼 때 main이 1..N으로 메운다.

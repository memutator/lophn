# bt-menu-overlay

browser 탭 toolbar의 overflow menu(Inspect)와 bookmark menu를 overlay view(`kind: "menu"`)로 띄운다. 지금은 DOM `Menu`가 native page view 밑에 깔려서, 열려 있는 동안 page view를 통째로 숨긴다. 사람이 손으로 보니 menu를 여는 순간 page가 빈 화면이 된다. overlay는 native view 위에 그려지므로 page를 숨기지 않아도 된다.

- 단위: bt-menu-overlay (wave 2)
- 선행: bt-bookmark-ui
- 소유(이 task만 고친다):
  - `packages/shell/renderer/browser/browser-toolbar.tsx`
  - `packages/shell/renderer/browser/bookmark-menu.tsx`
  - `packages/shell/renderer/browser/browser-tab.tsx`
  - `packages/shell/renderer/browser/browser-api.tsx`
  - `packages/shell/renderer/browser/overlay-menu.ts`(새로)
  - `packages/shell/renderer/desktop/entry.tsx`
  - `packages/shell/renderer/browser/testdata/fake-browser-api.ts`
- 읽을 것:
  - 본보기(overlay 열기): `packages/shell/renderer/overlay/consumer.ts`(`overlayConsumer`), `packages/shell/renderer/terminal/deps.ts`의 `overlayCloseConfirm`(dialog를 열고 `selected`의 `choiceId`로 답을 받는다), `packages/shell/renderer/app-frame/annotate/use-view-toast.ts`(hook 안에서 consumer를 만들고 버리는 꼴, overlay가 없을 때 DOM으로 그리기)
  - overlay 계약: `packages/shell/ipc/overlay.ts`(`overlayOpenSchema`: `kind`, `anchorRect`, `model.label`, `model.choices[{id,label,disabled}]`, 64개까지), `packages/shell/renderer/overlay/surfaces/surface.tsx`의 menu 그리기
  - overlay api가 renderer에 오는 길: `packages/shell/renderer/desktop/entry.tsx`의 `bridges.lophnShell`(`overlay: bridges.lophnShell`로 palette에 넘긴다)
  - 지금 코드: `browser-toolbar.tsx`(`onMenuOpenChange`), `bookmark-menu.tsx`, `browser-tab.tsx`(`menuOpen`이 `useViewBounds`의 `shown`을 끈다), `bookmark-star.tsx`(popover. 이 task에서 바꾸지 않는다)
  - skill: `.claude/skills/ui-design/SKILL.md`

## 할 일

1. `overlay-menu.ts`: `OverlayApi`로 menu 하나를 여는 작은 helper. trigger 요소의 화면 사각형(`getBoundingClientRect`)을 `anchorRect`로, 항목을 `choices`로 보내고, `selected`면 그 `choiceId`, 닫히면 null로 끝나는 promise. consumer는 탭(또는 toolbar)마다 하나를 만들고 unmount 때 버린다.
2. `browser-api.tsx`(또는 같은 자리): overlay api를 browser 화면에 넘기는 context를 더한다. `entry.tsx`에서 `bridges.lophnShell`을 그 provider에 준다(`BrowserApiProvider` 옆). dev mock·gallery처럼 overlay가 없으면 null이다.
3. `browser-toolbar.tsx`와 `bookmark-menu.tsx`: overlay가 있으면 trigger `IconButton`을 누를 때 overlay menu를 열고, 고른 id로 지금 하는 일(Inspect, 그 bookmark로 navigate)을 한다. 비활성 항목(빈 목록, corrupt, 읽기 실패)은 `disabled` choice 하나로 보낸다. overlay가 없으면 지금의 DOM `Menu`와 view 숨기기를 그대로 쓴다.
4. overlay menu가 열린 동안에는 page view를 숨기지 않는다. `menuOpen`(view 숨기기)은 DOM 길에서만 켠다. star popover(`bookmark-star.tsx`, title 입력 칸이 있다)는 지금처럼 DOM popover와 view 숨기기를 쓴다.
5. bookmark 항목이 64개를 넘으면 overlay `choices` 한도에 걸린다. 앞의 64개만 보내고(목록 순서), 나머지는 palette와 새 탭 목록으로 연다.

## 정한 것

- star popover는 overlay로 옮기지 않는다. overlay `model`에는 글 입력 칸이 없다. title 고치기는 짧은 순간이고 Settings 목록에서도 고칠 수 있다.
- overlay 계약(`ipc/overlay.ts`)은 바꾸지 않는다. menu는 이미 있는 `kind: "menu"`와 `choices`로 충분하다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(화면이다).
- 남지 않음: overlay가 있는 창에서 overflow menu와 bookmark menu를 여는 길에 `setMenuOpen(true)`가 불리지 않는다.
- `deno run -A packages/shell/renderer/build.ts`가 선다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `renderer/desktop/entry.tsx`(provider 한 줄)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

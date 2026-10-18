# wf-panel

옮기고 크기를 바꾸는 패널 껍데기 design component `FloatPanel`을 만든다. 위 bar(icon, 제목, 오른쪽 끝의 행동 단추 자리), 본문, 가장자리 여덟 군데 resize 손잡이를 그린다. 끌기 논리는 갖지 않는다. 호출하는 쪽(`wf-floated-layer`)이 pointer 처리를 넘긴다.

- 단위: wf-panel (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/design/components/overlay/float-panel/float-panel.tsx` (새 file)
  - `packages/design/components/overlay/float-panel/float-panel.module.css` (새 file)
  - `packages/design/components/overlay/mod.ts`
  - `tools/wireframes/pages/kit/overlay/page.tsx`
  - `tools/wireframes/pages/kit/overlay/index.tsx`
  - `packages/design/wording/catalog/project.ts` (key 셋만 더한다)
  - `packages/design/wording/catalog/project.placeholders.ts` (`deno task wording`이 만든다)
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "무엇을 만드나" 2(패널)
  - 규칙: `.claude/skills/ui-design/SKILL.md`("모든 화면의 규칙", "새 화면 만들기" 1, "확인")
  - architecture: `project-docs/architecture/ui-kit.md`
  - 본보기(component): `packages/design/components/overlay/sheet/sheet.tsx`와 `sheet.module.css`(`componentMark`, `cx`, token 쓰기), `overlay/popover/popover.module.css`(`--floating-surface`, `--shadow-popover`)
  - 본보기(kit page): `tools/wireframes/pages/kit/overlay/page.tsx`의 Sheet 절
  - 이어서 쓰는 task: `project-docs/plan/workspace-float/tasks/wf-floated-layer.md`(이 component를 어떻게 부르는지)
- 계약:
  - 쓰는 것: 없음. `packages/design`은 shell을 import하지 않는다.
  - 내놓는 것: `@lophn/ui/overlay`의 `FloatPanel`, `FloatPanelProps`, `FloatEdge`. `wf-floated-layer`가 기댄다.

```ts
export type FloatEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";   // renderer model.ts의 FloatEdge와 같은 글자
export interface FloatPanelProps {
  title: string;
  icon?: ReactNode;                 // 제목 앞
  actions?: ReactNode;              // 위 bar 오른쪽 끝. IconButton 몇 개를 호출자가 넣는다
  children?: ReactNode;             // 본문
  /** 부모(position: relative)의 왼쪽 위 기준 CSS px. */
  x: number; y: number; width: number; height: number;
  /** 맨 위 패널. 테두리를 강조한다. */
  active?: boolean;
  /** true면 그리지 않되 mount는 유지한다(`hidden` 속성). 접힌 keep 탭이 쓴다. */
  hidden?: boolean;
  /** 패널 어디든 pointer가 눌리거나 focus가 들어오면 부른다. */
  onRaise?: () => void;
  /** 위 bar에서 pointer가 눌렸다. 행동 단추 위는 제외한다. */
  onMoveStart?: (event: PointerEvent<HTMLElement>) => void;
  onResizeStart?: (edge: FloatEdge, event: PointerEvent<HTMLElement>) => void;
  ref?: Ref<HTMLElement>;           // 호출자가 cover 등록(`useViewCover`)에 쓴다. root 요소
}
export function FloatPanel(props: FloatPanelProps): ReactElement;
```

## 할 일

1. `float-panel/float-panel.tsx`, `float-panel.module.css`: 위 props를 그린다.
   - root는 `position: absolute`에 `left/top/width/height`를 inline style로 준다(CSSOM style prop은 CSP에서 된다. `ui-design` "함정"). 부모가 `position: relative`다. `data-float-panel`, `data-active`, `componentMark("FloatPanel")`을 단다.
   - 위 bar: 높이는 기존 token에서 고른다(탭 줄 높이와 같은 계열), icon · 제목(한 줄, 넘치면 말줄임) · `actions`는 오른쪽 끝에 고정한다(`ui-design`의 "행동 단추는 줄 오른쪽 끝"). bar의 빈 자리와 제목이 `onMoveStart`를 받고 `actions` 안은 받지 않는다(`target.closest("button")`이면 부르지 않는다). 커서는 grab 모양이 아니라 기본으로 두고 끌기 중에만 호출자가 `data-dragging`을 단다.
   - 본문: 남은 높이를 채우고 `overflow: hidden`, 배경은 탭 본문과 같은 `--color-surface-base`다(`ui-design` "고른 탭과 탭 본문은 배경이 같다"). 본문이 scroll하는지는 안에 넣는 kind가 정한다.
   - 테두리와 그림자는 기존 floating token(`--floating-surface`, `--shadow-popover`, `--color-border-base`, `--radius-md`)을 쓴다. 새 token이 꼭 필요하면 만들지 말고 보고의 "계약 바꾸기 요청"에 적는다. `active`면 테두리만 `--color-focus` 계열로 바꾼다.
   - resize 손잡이: 네 변은 6px, 네 모서리는 12px 정사각형을 투명한 요소로 가장자리에 겹쳐 둔다. 각 요소는 `data-float-edge="<edge>"`와 알맞은 `cursor`(`ns-resize`, `ew-resize`, `nesw-resize`, `nwse-resize`)를 갖고 pointerdown에 `onResizeStart(edge, event)`를 부른다. 손잡이 모서리가 본문 위에 겹치므로 `z-index`는 root 안의 상대값이다.
   - `onPointerDownCapture`와 `onFocusCapture`가 `onRaise`를 부른다.
   - 문구는 쓰지 않는다. 단추 이름은 호출자가 `actions`로 넣는다.
2. `overlay/mod.ts`에 export를 더한다. 윗줄에 `//` 한 줄로 "언제 쓰나"를 쓴다(예: "부모 안에서 옮기고 크기를 바꾸는 패널의 껍데기. 위치는 부모가 정하고 끌기 논리는 갖지 않는다. 뒤 화면을 막는 면은 Dialog나 Sheet다.").
3. `tools/wireframes/pages/kit/overlay/page.tsx`에 FloatPanel 절을 더한다. 아이콘은 다른 kit page처럼 `lucide-react`에서 바로 가져와도 된다(`pages/kit/navigation/page.tsx`). 한 무대(`position: relative`, 고정 크기)에 패널 둘을 겹쳐 둔다: 위쪽은 `active`에 icon·제목·`IconButton` 셋(Minimize, Dock, Close)을 `actions`로, 아래쪽은 inactive. 단추 이름은 wording key로 쓴다. `project.ts`에 `project-workspace.button.float-minimize`("Minimize"), `project-workspace.button.float-dock`("Dock"), `project-workspace.button.float-close`("Close") 셋을 더하고 `deno task wording`을 돌린다(`wording` skill). 이 key는 `wf-floated-layer`가 패널 단추에 그대로 쓴다. `index.tsx`의 description에 FloatPanel을 더한다.
4. 화면을 눈으로 본다: `deno task wireframes`, `python3 -m http.server`로 `kit-overlay`를 연다(`ui-design` "확인").

## 끝남

- `deno task check`가 통과한다(`kit` step이 FloatPanel이 `pages/kit/`에 나오는지 본다).
- 위험 test: 없음. 화면 component다.
- 남지 않음: `grep -rn "FloatPanel" packages/design tools/wireframes`에서 `mod.ts` 윗줄 설명이 빠진 export가 없다.
- (화면) `deno task wireframes`가 되고, gallery의 `kit-overlay`가 `FloatPanel`로 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 더한 wording key(`wording` 생성은 이 task가 돌렸다)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것(bar 높이, 손잡이 크기)
- 넘길 줄: 없으면 "없음"
- 계약 바꾸기 요청: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

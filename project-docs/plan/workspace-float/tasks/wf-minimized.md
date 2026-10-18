# wf-minimized

접은 floated 탭을 상단 bar의 breadcrumbs 뒤, `.trailing` 앞에 `[icon 제목]` span으로 둔다. 누르면 접기 전의 위치와 크기로 돌아오고, bar의 빈 자리를 넘는 span은 `+N` button 하나로 묶어 Menu로 고른다. span의 right-click menu에는 Restore, Dock, Close가 있다.

- 단위: wf-minimized (wave 2)
- 선행: wf-floated-layer
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/workspace/workspace.module.css`
  - `packages/shell/renderer/workspace/minimized/minimized-bar.tsx` (새 file)
  - `packages/shell/renderer/workspace/minimized/minimized-bar.module.css` (새 file)
  - `packages/shell/renderer/icons/workspace.ts`
  - `packages/design/wording/catalog/project.ts` (key만 더한다)
  - `packages/design/wording/catalog/project.placeholders.ts` (`deno task wording`이 만든다)
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "무엇을 만드나" 3(minimized)
  - 규칙: `.claude/skills/ui-design/SKILL.md`("함정"의 상단 바 끌기 영역), `.claude/skills/wording/SKILL.md`
  - 앞 task: `wf-layout-model.md`(`minimizeFloat`, `restoreFloat`, `dockTab`, `closeFloat`), `wf-floated-wire.md`(`close(null, key)`), `wf-floated-layer.md`(workspace.tsx에서 `Floats`를 단 자리, 아이콘 `workspaceIcons.minimize`·`dock`)
  - 지금 코드: `renderer/desktop/top-bar/top-bar.tsx`와 `top-bar.module.css`(`.bar :is(button, a, input, [role="button"], [tabindex]) { app-region: no-drag }`, `.leading { flex: 1 }`, bar 높이 36px), `workspace.tsx`의 `<TopBar leading={<span className={styles.leading}>…<Breadcrumbs/></span>} trailing=…>`, `workspace.module.css`의 `.leading`, `panes/panes.tsx`의 탭 menu(`Menu`의 `menuAnchor`로 좌표에 연다), `renderer/workspace/top-path/breadcrumbs.tsx`
  - design: `@lophn/ui/overlay`의 `Menu`, `MenuIcon`, `Tooltip`, `@lophn/ui/shared`의 `useObservedSize`
- 계약:
  - 쓰는 것: 위 앞 task들의 export.
  - 내놓는 것: `minimized/minimized-bar.tsx`의 `MinimizedBar` component. `wf-gallery`가 `workspace.tsx`를 거쳐 만난다.

```ts
interface MinimizedBarProps {
  /** 접힌 항목만. floats 순서(아래가 먼저). */
  items: readonly FloatItem[];
  stripTab: (tab: TabItem) => StripTab;        // 아이콘
  onRestore(key: string): void;
  onDock(key: string): void;
  onClose(key: string): void;
}
export function MinimizedBar(props: MinimizedBarProps): ReactElement | null;   // items가 비면 null
```

## 할 일

1. `minimized/minimized-bar.tsx`, `minimized-bar.module.css`:
   - span 줄 root는 breadcrumbs 뒤에서 남는 폭을 채운다(`flex: 1; min-width: 0; overflow: hidden`). 이 root 자체는 끌기 영역이고(button이 아니다), span과 `+N`은 `button`이라 `top-bar.module.css`의 규칙으로 no-drag가 된다. `aria-label`은 `project-workspace.label.minimized`.
   - span은 고정 폭 한 칸이다(`140px`, 제목은 말줄임, 전체 제목은 Tooltip). 몇 개가 들어가는지는 `useObservedSize(root)`의 폭으로 계산한다: `+N` 단추 한 칸(`40px`)을 남겨 두고 나머지를 span이 나눈다. 모두 들어가면 `+N`은 없다. 들어가지 않는 것들은 `+N`(N은 남은 개수)로 묶고, 누르면 `Menu`로 목록(아이콘 + 제목)을 보이고 하나를 고르면 `onRestore`다.
   - span 누르기 → `onRestore(key)`. 우클릭 → `Menu`(Restore, Dock, Close). 좌표에 여는 방법은 `panes.tsx` 탭 menu의 `menuAnchor`와 같다. 항목에는 아이콘을 붙인다(`MenuIcon`, `ui-design` 규칙).
2. `workspace.tsx`: `Breadcrumbs` 뒤, 같은 `leading` span 안에 `<MinimizedBar items={view.floats.filter(minimized)} …/>`를 둔다. 콜백: `onRestore` → `restoreFloat`, `onDock` → `dockTab`, `onClose` → `close(null, key)`. `workspace.module.css`의 `.leading`이 남는 폭을 차지하게 한다(`flex: 1; min-width: 0`) — 그래야 `MinimizedBar`가 폭을 잴 수 있다.
3. `icons/workspace.ts`에 `restore` 아이콘을 더한다(lucide에서 고른다).
4. wording(`project.ts`, 그 뒤 `deno task wording`): `project-workspace.label.minimized`("Minimized panels"), `project-workspace.button.float-restore`("Restore"), `project-workspace.button.minimized-more`(`+N` 단추의 tooltip과 aria-label. ICU plural로 "{count, plural, one {# more minimized panel} other {# more minimized panels}}"). `+N` 단추의 보이는 글자는 `project-workspace.button.minimized-count`("+{count}")다. Dock과 Close는 `float-dock`, `float-close`를 쓴다.

## 정한 것

- span 폭은 고정이다(agent). 실제 글자 폭을 재서 넘침을 계산하려면 숨은 측정 요소가 필요하다. 가장 단순한 고정 칸으로 개수를 정한다.
- 접힌 탭의 mount는 `wf-floated-layer`가 이미 정했다(keep kind는 mount한 채 숨김, 나머지 unmount). 이 task는 건드리지 않는다.
- 접힌 span이 더해져도 breadcrumbs는 줄지 않는다(agent). span 줄이 남는 폭만 쓰므로 breadcrumbs가 먼저 자리를 차지한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음.
- 남지 않음: 없음(더하는 것뿐이다).
- (화면) `deno run -A packages/shell/renderer/build.ts`로 renderer bundle이 선다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성을 돌렸으면 "돌림"
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없으면 "없음"
- 계약 바꾸기 요청: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

# shell-taskbar

workspace 창 맨 아래에 작업 표시줄을 둔다. 왼쪽은 float chip(전역 float, 지금 desk float)이고 오른쪽은 tray 자리(wave 4가 채운다)다. 설정 `shell.taskbar`(기본 켬)로 켜고 끈다. 끄면 지금 모양이다.

- 단위: shell (wave 2)
- 선행: shell-global-float
- 소유(이 task만 고친다):
  - `packages/shell/renderer/shell/shell-frame.tsx`, `packages/shell/renderer/shell/shell-frame.module.css`
  - `packages/shell/renderer/shell/taskbar/**` (새로)
  - `packages/shell/renderer/shell/tab-strip.tsx`, `packages/shell/renderer/shell/tab-strip.module.css`
  - `packages/shell/renderer/shell/float-layer.tsx`
  - `packages/shell/renderer/shell/global-floats/**`
  - `packages/shell/renderer/workspace/workspace-window.tsx`
  - 추가 소유: `packages/shell/renderer/workspace/kinds/app-panel.tsx`의 `newKey`를 export하는 줄만
  - `packages/shell/renderer/desktop/settings/quick-launch/{source.ts,core-source.ts,store.tsx}`
  - `packages/shell/renderer/desktop/settings/appearance/**`
  - `packages/core/config/shell-settings.ts` (`shell.taskbar` 선언만)
  - `packages/design/i18n/catalog/shell.ts`, `packages/design/i18n/catalog/workspace-settings.ts`
  - `tools/wireframes/pages/screens/shell.tsx`, `tools/wireframes/pages/screens/shell/**`, `tools/wireframes/mock/**`
- 읽을 것:
  - 계획: `project-docs/plan/app-place/README.md`의 정한 것 9
  - roadmap: `project-docs/products/roadmap/app-place.md`의 "3. 전역 float, 작업 표시줄, tray"
  - architecture: `project-docs/architecture/workspace-layout.md`의 shell 틀, floats 절
  - 지금 꼴:
    - `shell-frame.tsx`·`shell-frame.module.css`: `.shell`은 flex column이고 그 아래 `.titlebar`, `.body`, `.stage`가 있다. `.stage`의 `padding-block-end: var(--space-6)`이 지금 아래 여백이다. float 층의 기준 상자는 `.body`다.
    - `tab-strip.tsx`의 chip 묶음(`data-float-chips`, `MINIMIZED_SHOWN`). `workspace-window.tsx`는 desk의 모든 float를 `minimized`로, 펼친 것을 `floating`으로 넘긴다.
    - `float-layer.tsx`의 `NOT_OUTSIDE`(chip 묶음을 바깥 누름에서 뺀다).
    - wave 1이 만든 `renderer/shell/global-floats/`(`useGlobalFloats`). 전역 float 층의 아래 끝은 작업 표시줄 위여야 한다.
    - 설정 읽기: `renderer/desktop/settings/quick-launch/store.tsx`(`QuickPrefs`, focus 때 다시 읽기, 먼저 반영하는 쓰기). `core-source.ts`의 `KEYS`.
    - Settings › General은 `shell.*`를 보이지 않는다(`renderer/desktop/settings/general/model.ts`의 `SHOWN_ELSEWHERE`). Switch 본보기는 `renderer/workspace/project-settings/quick-launch-editor.tsx`다.
  - 화면 규칙: `.claude/skills/ui-design/SKILL.md`
- 계약:
  - 쓰는 것: `useGlobalFloats()`(wave 1), 설정 `declareSetting`
  - 내놓는 것: `ShellFrame`의 `taskbar` slot. 작업 표시줄 component는 오른쪽 `tray` slot(ReactNode)을 받는다. wave 4 `tray`가 그 slot을 채운다.

## 할 일

1. **설정**
   - `packages/core/config/shell-settings.ts`에 `shell.taskbar`(boolean, 기본 true)를 선언한다.
   - renderer `QuickPrefs`에 `taskbar`를 더해 같은 store로 읽고 쓴다.
   - Settings › Appearance pane에 Switch 줄 하나를 둔다("Taskbar"와 도움말). 토글은 줄 오른쪽 끝이다.
2. **틀**
   - `ShellFrame`에 `taskbar` slot을 더한다. 있으면 `.body` 아래 `.shell`의 마지막 줄로 그리고 `.stage`의 아래 여백을 없앤다. 그래서 desk float가 작업 표시줄을 덮지 않는다.
   - 높이는 token으로 정한다.
   - 전역 float 층의 아래 끝도 작업 표시줄 위로 맞춘다.
3. **작업 표시줄** (`renderer/shell/taskbar/`)
   - 왼쪽은 float chip이다. 전역 float chip이 먼저이고, 그 뒤가 지금 desk의 float chip이다. chip 하나는 아이콘과 이름이다. 펼친 것은 눌린 표시이고, 누르면 펼치기·접기다.
   - chip 묶음에 `data-float-chips`를 달아 바깥 누름에서 빠지게 한다.
   - chip이 많으면 넘치는 것은 "+N" menu로 묶는다(지금 tab 줄 규칙과 같다).
   - 오른쪽은 `tray` slot이다. 이 task에서는 비어 있다.
4. **켜고 끄기**: `shell.taskbar`가 켜져 있으면 tab 줄 끝 chip 묶음을 그리지 않고 작업 표시줄에 그린다. 꺼져 있으면 작업 표시줄이 없고 chip은 지금처럼 tab 줄 끝에 있다.
5. **gallery**: `shell` 영역에 작업 표시줄이 있는 page(id `shell-taskbar`)를 더한다. 전역 float chip 하나, desk float chip 둘, 빈 tray다. 기존 page는 설정 기본값(켬)으로 그려지므로 모양이 바뀌는 것을 확인한다.
6. 문구는 `shell.ts`(작업 표시줄)와 `workspace-settings.ts`(설정 줄)에 둔다.
7. **(lead가 더함) 오른쪽 sidebar 열림을 workspace마다 기억한다**(사람, 2026-11-07).
   - 지금 `shell-frame.tsx`의 `useSidebarOpen`은 localStorage `lophn.shell.sidebar-open.<side>`에 쪽마다 값 하나를 두어 모든 workspace가 같이 쓴다.
   - 오른쪽은 workspace key마다 따로 둔다: `lophn.shell.sidebar-open.right.<workspace key>`. `WorkspaceWindow`가 자기 workspace key를 넘긴다. 저장한 값이 없으면 지금처럼 창 폭 기본값이다.
   - 왼쪽 열림과 양쪽 폭은 지금처럼 쪽마다 하나다. Settings와 home gate는 왼쪽만 쓰므로 그대로다.
   - 옛 key `lophn.shell.sidebar-open.right`는 읽지 않는다(배치 값이라 data가 아니다).
8. **(lead가 더함) 앱 panel 탭 key 생성기 하나로**: wave 1이 `workspace-window.tsx`의 `globalToFloat`에 `app-panel-…-g<n>` key를 만드는 지역 생성기를 두었다(`deskFloatCount`). `kinds/app-panel.tsx`의 `newKey`를 export하고 그것을 쓰게 바꾼 뒤 지역 생성기를 지운다.

## 끝남

- `npm run check:full`이 통과한다. `node packages/shell/renderer/build.ts`와 `npm run wireframes`가 된다.
- 위험 test: 없음(화면이다).
- 남지 않음: 작업 표시줄이 켜졌을 때 tab 줄 끝 chip 묶음이 두 번 그려지지 않는다. `grep -rn "sidebar-open\.right\b\|sidebar-open.\${side}" packages/shell/renderer`로 오른쪽이 workspace key 없이 저장되는 곳이 없다.
- `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`.

## 보고

brief-template의 보고 꼴. gallery page id와 그 page에서 확인한 것을 적는다.

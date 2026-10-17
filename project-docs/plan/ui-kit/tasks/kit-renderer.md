# kit-renderer

design 안의 lophn 전용 부품 Avatar, VendorIcon, TabStrip을 renderer로 옮기고, 쓰는 곳이 gallery뿐인 LauncherFrame, OverviewFrame, Chip, AuthorMark와 `folderOpenIcon`을 지운다. 분류 폴더(`kit-layout-move`)를 만들기 전에 kit에 들어갈 수 없는 것부터 덜어낸다.

- 단위: kit-renderer (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/design/components`
  - `packages/design/wording`
  - `packages/shell/renderer`
  - `tools/wireframes`
- 읽을 것:
  - 계획: `project-docs/plan/ui-kit/README.md`, `project-docs/plan/ui-kit/classification.md`의 2절 표(Avatar, VendorIcon, TabStrip, LauncherFrame, OverviewFrame, Chip, AuthorMark, Icon 행)와 5절 1·3·4·5번
  - boundary: `project-docs/boundary-catalog.yaml`의 `design`, `shell`
  - 이동 도구: `tools/move-files.ts` 머리 주석
- 계약:
  - 쓰는 것: `@lophn/design/components`(지금의 barrel `packages/design/components/mod.ts`)의 `Icon`, `iconPixels`, `componentMark`, `tokens`(`@lophn/design` root)
  - 내놓는 것: renderer가 `packages/shell/renderer/parts/{avatar,vendor-icon,tab-strip}/`에서 Avatar·AvatarProfile·VendorIcon·vendorOf·TabStrip·TabItem·TabDot·AVATAR_ICONS를 내보낸다. design `components/mod.ts`에는 이 이름들이 없고 Chip·AuthorMark·LauncherFrame·OverviewFrame·`folderOpenIcon`도 없다.

## 할 일

근거: `classification.md` 5절 1·3·4·5번, README의 `kit-renderer` 단위. 정한 것: renderer에 `parts/`라는 새 폴더를 쓴다(renderer 안에 여러 화면이 같이 쓰는 부품을 둘 자리가 없고, 이름이 `icons/`처럼 얕다).

1. mapping 파일을 worktree 밖 임시 경로에 써서 `tools/move-files.ts`로 옮긴다(mapping은 commit하지 않는다). 먼저 `--dry-run --report`로 본다.
   - `packages/design/components/avatar/` → `packages/shell/renderer/parts/avatar/` (`avatar.tsx`, `avatar-icons.ts`, `avatar.module.css`)
   - `packages/design/components/vendor-icon/` → `packages/shell/renderer/parts/vendor-icon/` (svg 15개, `LICENSE`, `vendor-icon.tsx`, css 포함)
   - `packages/design/components/tab-strip/` → `packages/shell/renderer/parts/tab-strip/`
2. 옮긴 파일 안의 design 쪽 상대 import(`../icon.tsx`, `../shared.ts`, `../../tokens.ts`)는 tool이 "내보내는 export 없음"으로 보고한다. 손으로 고친다.
   - `Icon`, `iconPixels`, `componentMark`은 `@lophn/design/components`에서, `tokens`는 `@lophn/design`에서 import한다.
   - `avatar.tsx`의 `pixels(tokens.space[9])`는 `Number.parseFloat(tokens.space[9])`로 바꾼다(`pixels`는 design이 내보내지 않는다. 이 task는 design에 export를 더하지 않는다).
3. design `components/mod.ts`에서 Avatar, AvatarProfile, AvatarProps, AvatarSize, VendorIcon, vendorOf, Vendor, TabStrip, TabItem, TabDot export를 지운다.
4. 이 이름을 쓰던 곳의 import를 옮긴 자리로 고친다. barrel 심볼 import는 tool이 못 옮긴다. 손으로(또는 한 번 쓰고 버리는 script로) 고치고 `deno fmt`를 돌린다. renderer 상대 경로로 쓴다.
   - renderer: `conversation/header/session-popover.tsx`, `conversation/model-picker/model-picker.tsx`, `conversation/message-list/agent-turn.tsx`, `conversation/thread/sender-chip.tsx`, `workspace/workspace.tsx`, `workspace/add-tab-menu.tsx`, `workspace/sidebar/{agent-panel.tsx,panel-sessions.ts,sidebar-agent.ts,project-sidebar.tsx}`, `workspace/panes/panes.tsx`, `workspace/kinds/{kind.ts,host.ts,agent.tsx,terminal.tsx}`, `workspace/agents/{agents-tab.tsx,sidebar-agents.ts}`, `workspace/agents/editor/{agent-editor.tsx,model-field.tsx,parts.tsx}`(`parts.tsx`에는 `design/components/avatar/avatar-icons.ts` 상대 import도 있다), `app-frame/{app-agents.ts,agent-select.tsx,agent-pane.tsx}`, `desktop/connection/waiting/cards/head.tsx`, `desktop/lophn-space/settings/{connections/connections-panel.tsx,providers/provider-name.tsx,agents/agents-panel.tsx}` (모두 `packages/shell/renderer/` 아래)
   - wireframe: `tools/wireframes/frames/compositions/project-app.tsx`(TabStrip), `tools/wireframes/frames/compositions/project-window.tsx`(AvatarProfile, TabDot, TabItem)
   - 위 목록은 `grep`으로 낸 것이다. `deno task check`의 type 오류가 빠진 곳을 잡는다.
5. 지운다(근거 5절 4·5번).
   - `packages/design/components/chip/`, `packages/design/components/author-mark/`와 mod.ts export
   - `page-frames/frames.tsx`의 `LauncherFrame`, `OverviewFrame`과 mod.ts export, `page-frames.module.css`의 `.column[data-frame="launcher"]`·`"overview"` 규칙, `page-frames/model.ts`의 `ColumnFrame` 안 `"launcher" | "overview"`. `tokens.ts`의 `page.launcher`·`page.overview`는 renderer가 `--page-launcher`·`--page-overview`로 쓰니 건드리지 않는다.
   - `components/icon.tsx`의 `folderOpenIcon`과 mod.ts export (`classification.md` 2절 Icon 행: wireframe tokens-pages만 쓴다)
   - gallery: `tools/wireframes/frames/design/components-pages.tsx`에서 Chip·AuthorMark·LauncherFrame·OverviewFrame을 그리는 section과 import, `tokens-pages.tsx`의 `folderOpenIcon` 항목과 import, `tools/wireframes/pages.ts`에서 Chip·AuthorMark를 말하는 description 두 곳(`components-toast`, `components-states`)과 Launcher·Overview 틀을 말하는 곳
6. 쓰는 곳이 없어지는 wording key `common.author.label`, `common.label.more-waiting`: `wording` skill대로 key 앞부분(`common.author.`, `common.label.more-`)으로 `packages`와 `tools`를 grep해 template literal 호출이 없는지 보고, 없으면 `packages/design/wording/catalog/common.ts`에서 지우고 `deno task wording`으로 생성물을 다시 만든다. 손으로 `*.placeholders.ts`를 고치지 않는다.
7. 문서·skill(`ui-design`, architecture, registry)은 lead가 고친다. 이 task에서 project-docs와 `.claude`를 고치지 않는다.

## 끝남

- `deno task check`가 통과한다.
- `deno task wireframes`가 되고, `deno run -A packages/shell/renderer/build.ts`가 선다(check:full이 renderer build를 못 본다).
- 위험 test: 없음 (옮기기와 지우기뿐이다)
- 남지 않음:
  - `grep -rnE "components/(avatar|vendor-icon|tab-strip|chip|author-mark)" packages tools --include=*.ts --include=*.tsx --include=*.css`가 0줄이다.
  - `grep -rnE "\b(AuthorMark|Chip|ChipItem|LauncherFrame|OverviewFrame|folderOpenIcon)\b" packages tools --include=*.ts --include=*.tsx`가 0줄이다.
- (화면) gallery의 Components · states, Components · toast, Components · frames, Tokens · icons가 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 (등록 file은 안 고친다)
- 안 쓰게 된 export: 없음 (지운 것은 쓰는 곳이 없다)
- 정한 것: `parts/` 폴더, 그 밖에 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없음
- 무겁게 짠 것: 없음이 기본. 있으면 `무엇 / 왜 / 줄인다면 / 어디`
- 알려진 미완 동작: 없음이 기본

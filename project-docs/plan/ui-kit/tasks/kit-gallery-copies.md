# kit-gallery-copies

wireframe 안에서 실제 component를 흉내 낸 복사본(look-alike)을 지우고 실제 component를 import한다: Avatar 복사본, project 창 틀(`compose.module.css`의 틀 부분), 경로 팔레트 look-alike(`files.module.css`), Orders 앱 그림의 표·tile.

- 단위: kit-gallery (wave 2)
- 선행: kit-sdk-move
- 소유(이 task만 고친다):
  - `tools/wireframes/frames/compositions`
- 읽을 것:
  - 계획: `project-docs/plan/ui-kit/README.md`의 `kit-gallery`, `classification.md` 4B 표와 5절 3·10번
  - 요구: `project-docs/products/roadmap/ui-kit-single-source.md`의 요구 1
  - 본보기: `packages/shell/renderer/parts/avatar/avatar.tsx`(`kit-renderer`가 옮긴 실제 Avatar), `packages/shell/renderer/workspace/workspace.module.css`, `packages/shell/renderer/workspace/panes/panes.module.css`, `packages/design/components/overlay/palette/palette.tsx`, `packages/design/components/data/table/table.tsx`, `packages/design/components/data/stat-tile/stat-tile.tsx`
  - skill: `.claude/skills/ui-design/SKILL.md`(gallery는 실제 component를 import만 한다)
- 계약:
  - 쓰는 것: renderer의 Avatar, renderer의 CSS Module(이미 `agent-chat.tsx`가 `turns.module.css`, `agent-view.module.css`를 이 방식으로 쓴다), design `Palette`·`Table`·`StatTile`
  - 내놓는 것: 이 폴더에서 다음이 사라진다: `agent-avatar.tsx`, `agents.module.css`, `compose.module.css`의 틀 class, `project-files/files.module.css` 전체. 남는 CSS는 `compose.module.css`의 `.ways*`·`.link`(`kit-gallery-split`이 drafts로 옮긴다), `contexts.module.css`, `waiting.module.css`, `workspace.module.css`, `app-space.module.css`의 annotate 표식 부분이다.

## 할 일

근거: `classification.md` 4B(복사본이 22파일에 숨어 있다)와 5절 3·10번: "실제 component의 사본은 지우고 실제 component를 import한다."

1. Avatar 복사본: `agent-avatar.tsx`와 `agents.module.css`를 지운다. `project-window.tsx`가 import하던 `Avatar({agent, size})`는 `profileOf(agent)`(`agents-data.ts`)로 profile을 만들어 renderer `Avatar`에 넘기는 얇은 호출로 바꾼다(호출하는 쪽에서 직접 쓰거나, `project-window.tsx` 안 작은 함수 하나). renderer `Avatar`의 props가 wireframe의 `AgentProfile`과 모양이 다르면(`image`, icon 이름) `agents-data.ts` 쪽 data를 `AvatarProfile`에 맞춘다. 사용자 이미지 모양은 `AvatarProfile`이 받는 값으로 그린다. renderer Avatar가 그 모양을 못 그리면 data의 그 항목을 icon으로 바꾸고 "알려진 미완 동작"에 적는다(renderer는 이 task 소유가 아니다).
2. project 창 틀: `project-app.tsx`의 `styles.window/main/topBar/leading/titleEnd/panes/pane/body/flush`(`compose.module.css`)를 renderer의 `workspace/workspace.module.css`(`.workspace .main .topBar .leading .trailing`)와 `workspace/panes/panes.module.css`(`.panes .pane .body .flush`)의 같은 class로 바꾼다(상대 경로로 import). 모양이 다른 곳(예: `.titleEnd`의 오른쪽 여백)은 renderer class를 따른다. gallery에서 사람이 보는 모양이 renderer 실제 모양과 같아지는 것이 목적이다. 새 CSS를 쓰지 않는다.
3. `compose.module.css`의 나머지 class를 쓰는 곳을 본다. 쓰는 곳은 `agent-chat.tsx`(`.chat`), `bodies.tsx`(`.docTab`), `ways-page.tsx`, `link.tsx`뿐이다(`grep compose.module.css`).
   - `.chat`, `.docTab`(+`.viewPath`), `.mark`, `.muted`, `.mono`, `.menuHead`, `.menuStatic`, `.searchTitle`, `.flush`: 쓰는 곳이 없으면 지우고, 쓰면 renderer의 같은 용도 class로 바꾼다. 같은 용도가 없으면 `style={{ ... }}`에 token 변수(`var(--space-4)` 등)로 쓴다(그 줄이 한두 개일 때). 몇 줄 넘게 필요한 class는 만들지 말고 보고한다.
   - `.waysPage .ways .way* .searchTitle`과 `.link`는 ways·link(drafts)가 쓴다. 그대로 둔다.
4. `project-files/files.module.css`: `.palette*`는 `pages.tsx:119` 근처의 look-alike(`<div className={fileStyles.paletteBackdrop}>…`)가 쓴다. design `Palette`(`open`, `onOpenChange`, `items`, `title`)를 `container` 없이 열어 둔 채 그린다(gallery frame은 iframe이라 page가 잠겨도 된다. 이유: 이 page는 screens). 입력한 경로 글자와 항목(`Open`, `Outside project`)을 `items`·`query`로 채운다. `.compare`는 쓰는 곳이 없다(`grep compare`). 지운다. 그러면 `files.module.css`가 비니 파일을 지운다.
5. `app-space/orders-view.tsx`: `.orders*`, `.num`, `.tile*`, `.tiles`, `.appView`, `.appHead`, `.appTitle`을 design `Table`(칸 모양)과 `StatTile`/`StatRow`로 바꾼다. 앱 view 안의 그림이라 폭·밀도 조건이 맞는지 gallery로 본다. annotate 표식(`.target .hover .picked .badge .hoverLabel .area .areaSolid .memo .memoRight`)은 그대로 둔다(`kit-gallery-split`이 `drafts/`로 옮긴다. shell preload가 앱 view에 주입하는 UI의 look-alike라서).
6. 지운 CSS가 가리키던 wording·상수·import가 안 쓰이면 같이 지운다. 문서(ui-design skill 등)는 lead가 고친다.

## 끝남

- `deno task check`가 통과한다.
- `deno task wireframes`가 되고, gallery에서 다음 page가 이전과 같은 상태를 그린다: project window 계열(Project · …), Agents tab, 파일 경로 palette(`new-file-open-path`, `new-file-outside`), Orders 앱 annotate page(`new-app-annotate`, `new-app-annotate-list`). 확인은 `tools/wireframes/dist/index.html#/<page id>`.
- 위험 test: 없음
- 남지 않음:
  - `ls tools/wireframes/frames/compositions/agent-avatar.tsx tools/wireframes/frames/compositions/agents.module.css tools/wireframes/frames/compositions/project-files/files.module.css`가 모두 없다.
  - `grep -n "^\." tools/wireframes/frames/compositions/compose.module.css`가 `.way*`·`.waysPage`·`.ways`·`.searchTitle`·`.link`와 그 hover/자식 규칙만 보인다.
  - `grep -rn "palette\|Palette" tools/wireframes/frames/compositions/project-files/pages.tsx`에 `fileStyles`가 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: renderer class로 못 바꿔 token inline으로 쓴 곳, 그 밖에 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: renderer Avatar가 wireframe의 모양을 못 그릴 때 요청으로 적는다
- 무겁게 짠 것: 없음이 기본
- 알려진 미완 동작: 위 1번에서 icon으로 바꾼 항목

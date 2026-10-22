# wf-kit-graph

kit의 `GraphDiagram`에 node 상태와 짧은 글을 더하고 gallery page를 고친다. component는 상태 값의 뜻을 모른다. 넘겨받은 이름과 글을 보일 뿐이다.

- 단위: kit (wave 2)
- 선행: wf-contract
- 소유(이 task만 고친다):
  - `packages/design/components/data/chart/graph-diagram.tsx`
  - `packages/design/components/data/chart/graph-layout.ts`
  - `packages/design/components/data/chart/types.ts`
  - `packages/design/components/data/chart/validate.ts`
  - `packages/design/components/data/chart/chart.module.css`
  - `packages/design/components/data/chart/marks.tsx`(`Tooltip`. 긴 note 때문이다. 다른 task는 이 file을 소유하지 않는다)
  - `packages/design/components/data/mod.ts`
  - `tools/wireframes/pages/kit/data/page.tsx`
  - `tools/wireframes/pages/kit/data/sales-dashboard.tsx`
- 읽을 것:
  - architecture: `project-docs/architecture/ui-kit.md`("무엇을 어디에 두나", "import 방향", "gallery가 정본이다", "지키는 check")
  - skill: `.claude/skills/ui-design/SKILL.md`("새 화면(page) 만들기" 1, "확인"의 `kit` step)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `design`, `project-docs/module-catalog.yaml`의 `packages/design`
  - 코드:
    - `packages/design/components/data/chart/graph-diagram.tsx`, `graph-layout.ts`(결정적 배치, `NODE_HEIGHT`, `shorten`), `types.ts`(`GraphNode`), `validate.ts`(`checkGraph`, `everyDense`)
    - `chart.module.css`의 `.node`, `.nodeLabel`, `.edge`, `.arrow`
    - `geometry.ts`(`GEOMETRY`, `textWidth`), `marks.tsx`의 `Tooltip`(긴 note를 그리도록 이 task가 고친다. bar·line·scatter·distribution이 같이 쓴다)
    - `packages/design/components/feedback/status-mark/status-mark.tsx`(`STATUS_ICONS`)와 `status-mark.module.css`(tone 색은 `--status-<tone>-marker`)
    - `packages/design/tokens.ts`(`tokens.status`, `StatusTone`)
    - `packages/design/components/data/mod.ts`(각 export 윗줄의 "언제 쓰나")
    - 본보기 gallery: `tools/wireframes/pages/kit/data/page.tsx`의 `GraphDiagram` 절(`Section`·`Row`·`Wide`)
- 계약:
  - 쓰는 것: `architecture/ui-kit.md`, `ui-design` skill(kit page와 `mod.ts`의 "언제 쓰나" 줄)
  - 내놓는 것(`wf-kit-build`, 화면, PM의 artifact가 기대는 props):
    - `GraphNode`에 선택 칸: `status?: { label: string; tone: StatusTone }`(`StatusTone`은 `tokens.ts`의 `good | warning | serious | critical | neutral`), `note?: string`(짧은 글. 길면 줄여 보이고 전체는 tooltip). 다른 칸은 그대로다(`id`, `label`).
    - `GraphDiagramProps`는 그대로다(`nodes`, `edges`, 상태·locale 칸). 새 prop이 없고 node 칸으로만 넘긴다.
    - 상태 표시는 색만이 아니라 `label` 글과 `StatusMark`와 같은 아이콘으로도 구별된다(색에 기대지 않는다).
    - 배치(`layoutGraph`)는 결정적인 채로 두고, node 높이가 `note`가 있을 때 늘어나는 규칙을 순수 함수 안에서 정한다.
    - gallery: `pages/kit/data/page.tsx`의 `GraphDiagram` 절에 상태·글이 있는 견본(workflow step 예: spec → run → report, 상태 종류별)과 없는 견본을 둔다.

## 정한 것

- **`status`도 `note`도 없는 node는 지금과 똑같이 그린다.** 높이 `NODE_HEIGHT`, 가운데 한 줄 label. 기존 견본(`STEPS`)과 sales dashboard는 모양이 바뀌지 않는다.
- **`status`나 `note`가 있는 node는 줄이 늘어난다.** 첫 줄 label(지금 자리 그대로), 그 아래 `status`가 있으면 아이콘과 `status.label` 한 줄, 그 아래 `note`가 있으면 한 줄. 모두 가운데 정렬이다. 줄마다 `GEOMETRY.caption`(caption 줄 높이)만큼 높이가 늘고, 맨 아래 여백은 한 번만 더한다. 정확한 수는 gallery에서 보고 정한다. 근거: 순수 함수 `nodeHeight(node)` 하나가 높이를 정하고 배치·그리기가 같은 값을 쓴다.
- **`note`는 `NOTE_LIMIT`(40자)에서 `…`로 줄여 보이고 전체는 tooltip이다.** 줄이는 규칙은 `label`과 같다(`shorten`에 한도를 넘긴다). 근거: node 폭이 글에 따라 늘어나므로 한도 없이 두면 report 글 전체가 도표를 밀어낸다.
- **node 폭은 label, 상태 줄(아이콘+글), note 가운데 가장 넓은 것에 맞춘다.** 글 폭은 지금처럼 `textWidth`의 어림값이다.
- **`status.tone`이 `tokens.status`의 키가 아니면 도표가 "그릴 수 없음"(invalid) 상태가 된다.** `checkGraph`가 본다. 근거: 이 data는 artifact의 `LophnKit.renderGraph`로 AI가 쓴 page에서 온다(`wf-kit-build`). 타입을 믿지 않는 것이 이 파일의 원칙이다(`validate.ts` 머리 주석).
- **tone 색은 아이콘에만 쓴다.** 글은 지금 label 색 계열(`--color-text-secondary`)이다. 근거: `StatusMark`와 같다(색에만 기대지 않는 표시).
- **긴 note가 tooltip에서 읽히도록 `Tooltip`(`marks.tsx`)을 고친다.** 전체 note를 tooltip에 싣는데 지금 `Tooltip`은 한 줄 name·value 짝이라 긴 글이 잘리거나 넘칠 수 있다. 근거: 줄여 보이는 note의 전체가 tooltip뿐인데 읽을 수 없으면 줄이는 뜻이 없다. 다른 chart(bar·line·scatter·distribution)의 tooltip은 모양이 바뀌지 않아야 한다(긴 글만 줄바꿈되게 하고 짧은 글은 지금과 같게).

## 할 일

1. `packages/design/components/data/chart/types.ts`
   - `NodeStatus { readonly label: string; readonly tone: StatusTone }`를 더하고(`StatusTone`은 `../../../tokens.ts`의 type), `GraphNode`에 `status?: NodeStatus`, `note?: string`을 더한다. 주석에 "상태 값의 뜻은 component가 모른다"를 쓴다.
2. `packages/design/components/data/chart/validate.ts`
   - `checkGraph`의 node 조건에 더한다: `status`는 없거나 `{ label: 글, tone: Object.keys(tokens.status) 가운데 하나 }`, `note`는 없거나 글. `tokens`는 `../../../tokens.ts`.
   - 이유: 위 "정한 것"의 invalid 처리.
3. `packages/design/components/data/chart/graph-layout.ts`
   - `nodeHeight(node)`와 `NOTE_LIMIT`을 더하고, `PlacedNode`에 `height`(그리고 그리기에 필요한 줄 위치 값)를 싣는다. 칸 폭 계산에 상태 줄(`아이콘 크기 + 간격 + textWidth(shorten(status.label))`)과 줄인 note를 넣는다.
   - 열마다 `span`을 node 높이의 합과 `ROW_GAP`으로, `y`를 앞 node 높이를 더해 가며 구하고, 전체 `height`는 가장 높은 열이다. edge의 시작·끝 y는 `node.y + node.height / 2`다(지금의 `NODE_HEIGHT / 2`와 같은 자리를 node 높이로 일반화).
   - 순수 함수이고 결정적이어야 한다. `status`·`note`가 없으면 출력 숫자가 지금과 같아야 한다(`NODE_HEIGHT`, `NODE_HEIGHT / 2`).
   - 이유: 계약의 "node 높이가 `note`가 있을 때 늘어나는 규칙을 순수 함수 안에서 정한다".
4. `packages/design/components/data/chart/graph-diagram.tsx`
   - `rect`의 `height`를 `node.height`로 바꾼다. label은 지금 자리(첫 줄 가운데). `status`가 있으면 `<g data-tone>` 안에 `Icon`(`../../primitives/icon/icon.tsx`)과 `STATUS_ICONS[tone]`(`../../feedback/status-mark/status-mark.tsx`), `status.label` 글을 그린다. `note`가 있으면 줄인 글을 그린다.
   - tooltip: 지금처럼 hover·키보드로 고른 node의 `label`을 title로 쓰고, `note`가 있으면 전체 글을 row에 넣는다(`rows`의 `name`). 긴 글이 어떻게 그려지는지 gallery에서 보고 `marks.tsx`의 `Tooltip`과 `chart.module.css`의 tooltip class를 긴 글이 줄바꿈되어 읽히게 고친다(foreignObject 높이 안에서, 다른 chart의 tooltip 모양은 그대로).
   - 이유: 색 없이도 `label` 글과 아이콘 모양으로 구별된다. design 안 file끼리는 상대 경로로 직접 import한다(`ui-kit.md` "import 방향").
5. `packages/design/components/data/chart/chart.module.css`
   - `.nodeStatus`(`[data-tone="good"]` 등 다섯에 `color: var(--status-<tone>-marker)`, 아이콘 stroke는 `currentColor`), `.nodeStatusLabel`, `.nodeNote`를 더한다. token 변수만 쓴다(`check-style`).
6. `packages/design/components/data/mod.ts`
   - `GraphDiagram` 윗줄 "언제 쓰나"에 node마다 상태(label, tone)와 짧은 글을 넘길 수 있다는 것과 상태 값의 뜻은 component가 모른다는 것을 한 줄로 더한다. `NodeStatus` type을 export한다.
7. `tools/wireframes/pages/kit/data/page.tsx`
   - `GraphDiagram` 절에 row를 더한다: 상태가 있는 견본(workflow step: spec → run → report와 report → spec 되돌아가는 edge, 다섯 tone이 모두 한 번은 나오게), 상태와 긴 글이 있는 견본(줄여 보임). 기존 `values`·`empty`·`error` row는 그대로 둔다. 견본 data는 이 file 위쪽에 둔다. 절의 `note`도 고친다.
   - `sales-dashboard.tsx`는 `STEPS`가 상태 없는 견본으로 그대로 남는다. 고칠 일이 없으면 건드리지 않는다.
   - 이유: `ui-design` skill: kit component를 바꾸면 gallery kit page를 같이 고친다. `kit` check는 새 export 이름이 아니라 component가 page에 나오는지를 본다.
8. 눈으로 본다(`ui-design` skill "확인"). 다른 chart 절(`Tooltip`을 쓰는 bar·line·scatter·distribution)의 tooltip 모양이 그대로인지도 본다: `deno task wireframes` 뒤 `python3 -m http.server <port> -d tools/wireframes`로 띄우고 `#/kit-data`의 `GraphDiagram` 절을 light·dark로 본다. 아이콘이 tone마다 다른 모양인지, 긴 note가 줄고 tooltip에 전체가 나오는지, 되돌아가는 edge가 늘어난 node 옆면에 붙는지 본다.

## 끝남

- `deno task check`가 통과한다(`kit`, `style`, `deno check`의 tools 포함).
- `deno task wireframes`가 되고, gallery의 `kit-data`가 새 node 칸으로 그려진다. `status`·`note`가 없는 견본은 이 task 전과 같은 모양이다.
- `deno run -A packages/shell/renderer/build.ts`가 선다(design을 바꿨다. `check:full`은 renderer build를 보지 않는다).
- 위험 test: 없음(화면과 배치다).
- 남지 않음: `grep -n "height={NODE_HEIGHT}" packages/design/components/data/chart/graph-diagram.tsx`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(예상). 있으면 적는다.
- 안 쓰게 된 export: 없음(예상)
- 정한 것: 줄 높이·여백·`NOTE_LIMIT` 같은 수, tooltip에 note를 싣는 방식
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다.
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

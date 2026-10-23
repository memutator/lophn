# bs-graph-back-edge

GraphDiagram에서 되돌아가는 edge가 사이 node 뒤로 지나가 어느 node로 가는지 가를 수 없는 것을, node 줄 위 여백으로 돌려 그리게 고친다.

- 단위: design (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/design/components/data/chart/graph-layout.ts`
  - `packages/design/components/data/chart/graph-diagram.tsx`
- 읽을 것:
  - architecture: `project-docs/architecture/ui-kit.md`(GraphDiagram)
  - 이슈: `project-docs/issues/ui-kit.md`("지금", "고치려면"의 추천안)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/design`(boundary `design`)
  - skill: `.claude/skills/ui-design/SKILL.md`
  - 본보기(화면): `tools/wireframes/pages/kit/data/page.tsx`의 GraphDiagram `status` 줄(`STEP_STATUS_NODES`·`STEP_STATUS_EDGES`, `report → spec`이 되돌아가는 edge다)
- 계약:
  - 쓰는 것: `GraphNode`·`GraphEdge`(`packages/design/components/data/chart/types.ts`). 바꾸지 않는다.
  - 내놓는 것: `layoutGraph`가 돌려주는 `GraphLayout`(`nodes`, `edges`의 `path`·`labelX`·`labelY`, `width`, `height`)의 모양은 그대로다. 되돌아가는 edge의 `path`와 label 자리, `height`와 node의 `y`가 달라진다.

이슈와 코드가 어긋난 곳: 없다. `layoutGraph`가 되돌아가는 edge(`to.layer <= from.layer`. 코드는 `forward = to.layer > from.layer`의 반대)를 `linkHorizontal` bezier 하나로 출발 node 왼쪽 면에서 도착 node 오른쪽 면으로 잇는다. 이슈의 `report → spec`은 gallery `status` 줄에 그대로 있다. 이슈 제목은 "층 둘 이상을 되돌아가는"이지만 추천안은 되돌아가는 edge 전부를 위쪽으로 돌려 그리는 것이다(한 층 되돌아가는 edge도 같은 규칙으로 그려 규칙을 하나로 둔다. 이 선택은 보고의 "정한 것"에 적는다).

## 할 일

1. `graph-layout.ts`의 `layoutGraph`: 되돌아가는 edge가 하나라도 있으면 도표 위에 여백 한 줄(예: `ROW_GAP` 또는 `PAD`급 한 칸, 되돌아가는 edge 수에 따라 겹치지 않게 줄마다 조금씩)을 더한다. node의 `y`는 그 여백만큼 아래로 민다. `height`에는 그 여백을 포함한다(`graph-diagram.tsx`가 `layout.height + pad * 2`를 svg 높이로 쓴다).
2. 되돌아가는 edge의 `path`: 출발 node **위쪽 면 가운데**에서 위로 나가 여백을 가로질러 도착 node **위쪽 면 가운데**로 들어간다(모서리를 둥글린 직교 경로 또는 단순한 cubic bezier. 가장 단순한 것). 화살표는 도착 node 위에서 아래로 들어간다. `graph-diagram.tsx`의 marker는 `orient="auto"`라 방향을 따라간다.
3. 되돌아가는 edge의 label 자리(`labelX`·`labelY`)를 위쪽 가로 구간의 가운데로 다시 정한다. 앞으로 가는 edge와 label 폭 계산(`edgeRoom`, `gap`)은 그대로다.
4. `graph-diagram.tsx`는 layout이 여백을 `height`와 node의 `y`에 이미 담으면 고칠 것이 없다. 고칠 필요가 있을 때만 고친다.
5. 확인: `deno task wireframes`로 gallery를 만들고 `kit/data`의 GraphDiagram `status` 줄에서 `report → spec`이 `Run`·`Review` 위 여백을 지나 `Spec` 위로 들어가는지 본다(스크린샷이나 브라우저가 없으면 svg `path` 값으로 확인한다). 되돌아가는 edge가 없는 도표(`values`, `long note`)의 높이는 그대로여야 한다.
6. 문서(`ui-kit.md`)는 lead가 고친다.

## 끝남

- `deno task check`가 통과한다(`check-kit`·style 포함).
- `deno task wireframes`가 되고, gallery의 `kit/data` 페이지 GraphDiagram `status` 줄이 위 여백으로 돌아가는 edge로 그려진다.
- 위험 test: 없음(화면 모양은 test하지 않는다).
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 정한 것: 여백 크기, 한 층 되돌아가는 edge도 같은 규칙인지
- 무겁게 짠 것 / 알려진 미완 동작 (예: 되돌아가는 edge 여럿의 겹침. 없으면 "없음")

# @lophn/ui-table

## 목적

정렬·페이지·열 선택·숫자 정렬·가상 scroll을 갖춘 표다. 칸 모양은
@lophn/design의 Table이 그린다. 임의 script 실행 없이 loading·empty·error 표시를
제공한다.

## 공개 API와 type

```tsx
import { DataState, DataTable } from "@lophn/ui-table";
```

- `DataTable({columns, rows, ...})` — 정렬·페이지·열 선택·가상 scroll 표다.
- Columns 메뉴는 Columns 버튼에 붙어 뜨는 popover다. 도구 줄 흐름을 밀지 않고
  바깥 click·Escape로 닫힌다.
- `DataState({state, ...})` — loading·empty·error·freshness 상태 표시다.
- `sortRows(rows, state)` — 숫자 정렬을 포함한 행 정렬이다.
- `toggleColumn(columns, key)` — 열 선택을 바꾼다.
- `pageSlice(rows, page)` — 페이지 slice다.
- type: `DataTableProps`, `DataStateProps`, `EmptySpec`, `SortState`,
  `SortDirection`, `PageSlice`, `Density`, `TableColumn`

## 링크 칸

도메인 객체(예: `exp-008`, `F-009`)를 여는 열은 `kind: "link"`로 정의한다.
`value`는 칸 글을, `onOpen`은 누른 행을 받는다. 칸은 링크 색의 버튼이며 click과
Enter에 `onOpen(row)`를 부른다. 값이 없으면 버튼 없는 빈 칸이다. 무엇을 여는지는
`onOpen`을 준 쪽(shell 등)이 정한다. 정렬은 글 열과 같다.

```tsx
const columns: TableColumn<Hit>[] = [{
  id: "ref",
  header: "Object",
  kind: "link",
  value: (hit) => hit.ref,
  onOpen: (hit) => openDocument(hit.ref),
}];
```

## 요구 permission

없다. 그리기는 React의 일이다.

## peer 의존

정확한 peer다. 범위가 아니라 정확한 판을 쓴다.

| peer           | version |
| -------------- | ------- |
| `react`        | 19.3.0  |
| `lucide-react` | 1.51.0  |

## 예제

```tsx
import { DataTable } from "@lophn/ui-table";

<DataTable
  columns={[{ key: "title", label: "제목" }]}
  rows={[{ title: "메모" }]}
/>;
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 component·prop 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.

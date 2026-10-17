# kit-table-custom

design `Table`에 사용자 정의 칸(`kind: "custom"`)을 더해, 앱이 표 행 안에 단추 같은 것을 그릴 수 있게 한다. gallery `Kit · data` page에 그 견본을 둔다.

- 단위: kit-fix (wave 4)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/design/components/data/table`
  - `packages/design/components/data/data-table`
  - `packages/design/components/data/mod.ts`
  - `tools/wireframes/pages/kit/data`
- 읽을 것:
  - architecture: `project-docs/architecture/ui-kit.md`(무엇을 어디에 두나, 지키는 check)
  - boundary: `project-docs/boundary-catalog.yaml`의 `design`, `design-api`
  - 지금 코드: `packages/design/components/data/table/table.tsx`(`TableColumn`, `cell()`, 머리 `th`의 `data-kind`), `table/cells.tsx`, `data-table/model.ts`(`ColumnKind`, `ColumnShape`, `sortable`, `sortRows`, `visibleColumns`, `toggleColumn`), `data-table/data-table.tsx`, `data-table/toolbar.tsx`
- 계약:
  - 쓰는 것: 없음(design 안의 일이다)
  - 내놓는 것: `TableColumn<Row>`에 `ColumnBase & { kind: "custom"; render: (row: Row) => ReactNode }`가 더해진다. 칸은 `<td data-kind="custom">` 안에 `render(row)`를 그린다. `DataTable`에서 custom 칸은 정렬되지 않는다(정렬 고르기에 나오지 않는다). 열 고르기로 숨기고 보이는 것은 다른 칸과 같다.

## 할 일

근거: 사람이 정했다. gallery의 Orders 앱 그림이 행 안 `Mark shipped` 단추 칸을 `Table`로 못 그린 것에서 나왔다. 사용자 앱도 표 행 안에 단추를 넣을 수 있게 kit API를 넓힌다. Orders 앱 그림(`tools/wireframes/mock/app-space/orders-view.tsx`와 `drafts/app-space/orders-view.module.css`)은 mock이라 바꾸지 않는다.

1. `table/table.tsx`: `TableColumn`에 위 custom 칸을 더하고 `cell()`에 그리는 경우를 더한다. 칸 모양은 text 칸과 같은 여백·정렬을 쓰되, 글 말줄임(`title`)은 하지 않는다. 필요하면 `table.module.css`에 `.custom` 한 규칙을 token 변수로 더한다. 머리는 `styles.head`다.
2. `data-table/model.ts`: `ColumnKind`에 `"custom"`을 더한다. `ColumnShape`의 `value`는 custom이 갖지 않으니 type을 맞춘다(예: `value?`로 두고 `sortable`이 `kind !== "id" && kind !== "custom"`이면 `sortRows`는 정렬하지 않는다). 가장 단순한 모양을 고르고 정한 것을 보고에 적는다.
3. `data-table/data-table.tsx`, `toolbar.tsx`: custom 칸이 정렬 고르기에 나오지 않고, 열 고르기에는 나오는지 본다. type이 맞게 최소로 고친다.
4. `data/mod.ts`: `Table` export 윗줄의 "언제 쓰나" 한 줄이 칸 종류를 말하면 custom을 반영한다. export 이름과 문 모양은 바꾸지 않는다.
5. `tools/wireframes/pages/kit/data/page.tsx`: Table section과 DataTable section에 custom 칸이 든 Row를 하나씩 더한다(예: 행마다 design `Button` 하나, `Mark shipped`). 새 CSS file을 만들지 않는다. `orders-rows.ts`의 있는 이름과 모양은 바꾸지 않는다(더하는 것은 된다).
6. 문서(architecture, changelog)는 lead가 고친다.

## 끝남

- `deno task check`가 통과한다(step `kit` 포함).
- `deno task wireframes`가 되고, `deno run -A packages/shell/renderer/build.ts`가 선다(renderer의 `search-results.tsx`가 `TableColumn`을 쓴다).
- 위험 test: 없음(화면 모양이다. `sortRows`가 custom을 건너뛰는 것은 type과 `sortable` 한 줄이다)
- 남지 않음: `grep -n '"custom"' packages/design/components/data/table/table.tsx packages/design/components/data/data-table/model.ts`가 둘 다 나온다.
- (화면) gallery `Kit · data`의 Table·DataTable section에 단추가 든 칸이 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: `ColumnShape`의 type을 어떻게 맞췄는지, custom 칸의 CSS
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없음
- 무겁게 짠 것: 없음이 기본. 있으면 `무엇 / 왜 / 줄인다면 / 어디`
- 알려진 미완 동작: 없음이 기본

# wf-layout-schema

`layout.json` schema에 `floats`를 더하고 `LAYOUT_SCHEMA_VERSION`을 2로 올린다. renderer의 저장 꼴 변환(`layout-map.ts`)과 main의 저장 IPC(`layout-ipc.ts`)가 `floats`를 오가게 하고, `transient` 탭은 파일에 남기지 않는다.

- 단위: wf-layout (wave 1)
- 선행: wf-layout-model
- 소유(이 task만 고친다):
  - `packages/shell/main/workspace/schema.ts`
  - `packages/shell/main/workspace/layout.ts`
  - `packages/shell/main/desktop/core/layout-ipc.ts`
  - `packages/shell/renderer/workspace/layout-map.ts`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "무엇을 만드나" 1, "정한 것"
  - 계획: `project-docs/plan/workspace-float/README.md`의 "정한 것"(`detached`는 더하지 않는다, `LAYOUT_SCHEMA_VERSION` 2, `transient`)
  - 앞 task: `project-docs/plan/workspace-float/tasks/wf-layout-model.md`(`FloatItem`, `storableView`가 이 task의 입력이다)
  - 지금 코드: `main/workspace/schema.ts`(`layoutPaneSchema`, `windowBounds`, `workspaceLayoutSchema`), `layout.ts`(`parseLayoutFile`, `skipUnregisteredTabs`), `layout-ipc.ts`(`saveInput`, `LAYOUT_SAVE_CHANNEL` 핸들러), `renderer/workspace/layout-map.ts`
  - module: `project-docs/module-catalog.yaml`의 `packages/shell/main`, `packages/shell/renderer`
- 계약:
  - 쓰는 것: `wf-layout-model`의 `FloatItem`, `FloatRect`, `storableView`, `WorkspaceView.floats`(`renderer/workspace/model.ts`).
  - 내놓는 것: 저장 파일의 `layout`에 필수 칸 `floats`가 생긴다. wave 2는 이 모양을 `toStoredLayout`·`viewFromStored`로만 만난다.

```ts
// main/workspace/schema.ts
export const LAYOUT_SCHEMA_VERSION = 2;
// workspaceLayoutSchema에 더하는 칸 (필수, 빈 배열 가능)
floats: z.array(z.strictObject({
  tab: layoutTabSchema,                 // panes[].tabs[]와 같은 탭 값
  rect: windowBounds와 같은 모양,         // x,y 정수 ±32768, width,height 정수 1..32768
  minimized: z.boolean(),
  origin_pane: z.number().int().min(0).max(1),
})).max(20)
```

## 할 일

1. `schema.ts`: `LAYOUT_SCHEMA_VERSION = 2`. 주석 "파일 계약 첫 판"을 지금 판에 맞게 고친다. `windowBounds`와 같은 모양을 `floatRect`로 이름 붙여 쓰거나 같은 schema를 재사용한다(사본을 만들지 않는다). `floats`를 위 모양으로 `workspaceLayoutSchema`에 더하고 "승인·credential·앱 업무 상태·preview는 schema에 없다" 주석에 transient를 더한다.
2. `layout.ts`: `skipUnregisteredTabs`가 `floats[].tab`도 본다. 등록되지 않은 kind의 floated 탭은 그 항목째 건너뛴다(pane 탭과 같은 규칙. placeholder 없음). 옛 판(1)을 읽는 길은 만들지 않는다. 지금 `parseLayoutFile`이 이미 `unsupported_schema`로 돌려준다.
3. `layout-ipc.ts`: `saveInput`에 `floats: z.array(z.unknown()).max(20)`을 더하고 `validateLayout`에 넘기는 객체에 `floats: parsed.value.floats`를 더한다. 상세 검증은 schema가 한다(`panes`와 같은 방식).
4. `layout-map.ts`:
   - `toStoredLayout`은 `storableView(input.view)`를 먼저 거치고, `floats`를 `{ tab, rect, minimized, origin_pane }`로 내보낸다. 탭 변환은 `toStoredTab`을 쓰고 null이면 그 항목을 뺀다. `floats`는 최대 20개로 자른다. 반환 type에 `floats`를 더한다.
   - `viewFromStored`는 `floats`를 읽는다. 항목의 `tab`은 `tabFromStored`로 읽고 null이면 뺀다. `rect`는 정수 네 값이면 쓰고 아니면 그 항목을 뺀다. `originPane`은 0·1로 가둔다. `floats`가 배열이 아니면 `[]`다(fake source의 layout이 칸을 안 줄 수 있다. 파일은 main이 이미 검증했다).
   - `wf-layout-model`이 넣은 `floats: []` 임시 줄을 지운다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. "transient 탭은 저장되지 않는다"는 `wf-layout-model`의 `storableView` test가 본다. 이 task의 변환은 그 함수를 거칠 뿐이다.
- 남지 않음: `grep -n "파일 계약 첫 판" packages/shell/main/workspace/schema.ts`가 0줄이다.
- 개발 데이터: `layout.json`이 판 1이면 읽히지 않고 새로 만들어진다. 확인은 `.dev-data/<id>/` 안에서만 한다. 사람의 `~/.lophn`은 건드리지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

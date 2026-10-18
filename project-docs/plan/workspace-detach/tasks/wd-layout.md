# wd-layout

layout model(`WorkspaceView`)에 detached 탭을 둔다. 탭 하나가 pane, floats, detached 중 한 곳에만 있도록 순수 함수(`detachTab`, `openDetachedTab`, `attachDetached`, `closeDetached`)로 바꾸고, `layout.json`에 `detached`(항목 `{tab, bounds}`)를 더해 판을 3으로 올린다. 이 task가 내놓는 type과 함수가 wave 2 전부가 기대는 계약이다.

- 단위: wd-layout (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/model.ts`
  - `packages/shell/renderer/workspace/model_test.ts`
  - `packages/shell/renderer/workspace/layout-map.ts`
  - `packages/shell/renderer/workspace/workspace.tsx` (`freshView()` 한 곳에 `detached: []`만 더한다)
  - `packages/shell/main/workspace/schema.ts`
  - `packages/shell/main/workspace/layout.ts`
  - `packages/shell/main/desktop/core/layout-ipc.ts`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "무엇을 만드나" 1, "정한 것"(탭 하나는 한 곳에만, 옛 layout 파일은 옮겨 읽지 않는다)
  - 계획: `project-docs/plan/workspace-detach/README.md`의 "정한 것"
  - architecture: `project-docs/architecture/workspace-layout.md`("지키는 것"의 첫째·둘째·다섯째 항목: 한 곳에만 있다, `findTab`·`allTabs`·`mapTabs`, transient)
  - 규칙: `.claude/skills/write-test/SKILL.md`
  - 지금 코드(main `5361104e8` 기준): `renderer/workspace/model.ts`(`WorkspaceView`, `FloatItem`, `floatTab`, `dockTab`, `openFloat(view, tab, area, size?)`, `openTabIn(view, tab, isUnsaved, after?)`, `reopenTab`, `closeTab`, `dropEmptyPane`, `holderOf`, `allTabs`, `mapTabs`, `storableView`), `model_test.ts`(float 위험 test와 `transient` test), `main/workspace/schema.ts`(`layoutFloatSchema`, `windowBounds`, `workspaceLayoutSchema`), `main/workspace/layout.ts`(`skipUnregisteredTabs`), `main/desktop/core/layout-ipc.ts`(`saveInput`, `validateLayout` 호출), `renderer/workspace/layout-map.ts`(`floatFromStored`, `viewFromStored`, `toStoredLayout`)
  - module: `project-docs/module-catalog.yaml`의 `packages/shell/main`, `packages/shell/renderer`
- 계약:
  - 쓰는 것: 없음. 이 task가 계약을 정한다.
  - 내놓는 것: 아래 모양이 곧 계약이다. 이름과 칸을 바꾸지 않는다. 모두 `model.ts`에서 export한다(순수 함수, 입력을 바꾸지 않고 새 view를 돌려준다. 할 일이 없으면 받은 `view` 그대로 돌려준다).

```ts
/** 창 bounds. OS 화면 좌표 정수 사각형이다. FloatRect와 모양은 같지만 기준이 `.content`가 아니라 화면이다. */
export interface DetachedBounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
/** detached 창 하나가 가진 탭. 배열 순서는 뗀 순서다. */
export interface DetachedItem { readonly tab: TabItem; readonly bounds: DetachedBounds }
export interface WorkspaceView { /* 지금 칸 */ readonly detached: readonly DetachedItem[] }   // 필수 칸

/** pane이나 floats의 탭을 detached로(배열 끝). preview 표시를 지운다(transient는 그대로 둔다. attach할 때 지운다). pane에서 빠진 칸 정리는 closeTab과 같다. 이미 detached이거나 없으면 그대로. */
export function detachTab(view: WorkspaceView, key: string, bounds: DetachedBounds): WorkspaceView;
/** 새 탭을 곧바로 detached로 연다(detached 창 안에서 열린 popup). 같은 key가 이미 있으면(`findTab`) 그대로다. */
export function openDetachedTab(view: WorkspaceView, tab: TabItem, bounds: DetachedBounds): WorkspaceView;
/** detached 탭을 focus pane 끝에 넣고 고른다(focus도 그 pane). preview·transient 표시를 지운다. tab을 주면 그 값(detached 창에서 바뀐 탭)으로 바꿔 붙인다. */
export function attachDetached(view: WorkspaceView, key: string, tab?: TabItem): WorkspaceView;
/** detached 항목을 버린다(탭을 닫는다). */
export function closeDetached(view: WorkspaceView, key: string): WorkspaceView;
export function isDetached(view: WorkspaceView, key: string): boolean;
```

  - 저장 파일: `layout.json`의 `layout`에 필수 칸 `detached`가 생기고 `schema_version`은 3이다. wave 2는 이 모양을 `toStoredLayout`·`viewFromStored`로만 만난다.

```ts
// main/workspace/schema.ts
export const LAYOUT_SCHEMA_VERSION = 3;
// workspaceLayoutSchema에 더하는 칸 (필수, 빈 배열 가능)
detached: z.array(z.strictObject({
  tab: layoutTabSchema,        // panes[].tabs[]와 같은 탭 값
  bounds: windowBounds,        // 창 bounds. 화면 좌표 정수
})).max(20)
```

## 할 일

1. `model.ts`: 위 type과 함수. 근거: roadmap "무엇을 만드나" 1, architecture "지키는 것".
   - `detachTab`: pane에 있으면 `holderOf`로 찾아 `closeTab`과 같은 정리(칸이 비면 접기)를 하고, floats에 있으면 그 항목을 뺀다. 둘 다 아니거나 이미 detached면 view 그대로다. minimized 항목도 떼어진다(호출하는 쪽이 minimized에는 단추를 두지 않는다).
   - `openDetachedTab`: `openFloat`처럼 `findTab`으로 중복을 막고 `detached` 끝에 붙인다.
   - `allTabs`는 panes → floats → detached 순이고, `mapTabs`와 `findTab`이 detached도 본다. `isFloated`는 그대로 두고 `isDetached`를 더한다.
   - `storableView`는 transient detached 탭도 뺀다(`allTabs`가 detached를 보므로 조건은 이미 맞는다. 필터만 더한다).
   - `openTabIn`은 detached 탭이면(`after` 인자와 상관없이) 새로 붙이지 않고 view 그대로 돌려준다(Workspace가 그 창을 앞으로 가져온다. 그 호출은 `wd-project-side`가 한다). `openFloat`는 `findTab`이 이미 detached까지 보므로 같은 key를 새로 띄우지 않는다. `reopenTab`은 `findTab`을 쓰므로 detached 탭을 다시 붙이지 않는다.
   - `closeFloat`, `dockTab`은 floats만 본다. 바꾸지 않는다.
2. `model_test.ts`: 새 test를 만들지 않는다. 기존 "float, dock, minimize, restore, raise, close를 이어서 해도 탭이 사라지거나 둘이 되지 않는다" test의 `start`와 steps에 detach, open detached tab, attach, close detached를 섞어 넣고 이름을 "… detach, attach …"로 고친다(pane의 탭, floated 탭, minimized 탭을 떼고, 떼어 둔 탭에 `openTabIn`·`reopenTab`·`floatTab`을 해 보고, `attachDetached`로 돌리고, `closeDetached`로 닫는다). 모든 step 뒤에 같은 불변을 본다: key마다 정확히 한 곳. 이 test에는 `openFloat` 크기 step이 이미 있다. 그 옆에 둔다. 모든 `WorkspaceView` fixture(`viewOf` 등)에 `detached: []`를 더한다.
3. `schema.ts`: 위 모양. `LAYOUT_SCHEMA_VERSION = 3`, 파일 머리 주석의 "판 2부터 떠 있는 탭" 문장을 "판 3부터 detached 탭(OS 창)이 있다"를 더해 고치고, `windowBounds`의 주석에 detached 창 bounds도 쓴다고 쓴다. 사본을 만들지 않고 `windowBounds`를 재사용한다. 끝 주석 "preview·transient 탭은 schema에 없다"는 그대로 맞다.
4. `layout.ts`: `skipUnregisteredTabs`가 `detached[].tab`도 본다. 등록되지 않은 kind의 detached 탭은 그 항목째 건너뛴다(floats와 같은 규칙). 함수 위 주석에 detached를 더한다. 옛 판(2)을 읽는 길은 만들지 않는다. `parseLayoutFile`이 이미 `unsupported_schema`로 돌려준다.
5. `layout-ipc.ts`: `saveInput`에 `detached: z.array(z.strictObject({ tab: z.unknown(), bounds: z.unknown() })).max(20)`을 더하고 `validateLayout`에 넘기는 객체에 `detached: parsed.value.detached`를 더한다. 상세 검증은 schema가 한다. 이 task에서 main이 bounds를 채우지 않는다(`wd-restore`가 한다).
6. `layout-map.ts`:
   - `toStoredLayout`은 `storableView(input.view)` 뒤 `detached`를 `{ tab, bounds }`로 내보낸다. 탭 변환은 `toStoredTab`이고 null이면 그 항목을 뺀다. 최대 20개로 자른다. 반환 type에 `detached`를 더한다.
   - `viewFromStored`는 `detached`를 읽는다. 항목의 `tab`은 `tabFromStored`로 읽고 null이면 뺀다. `bounds`는 정수 네 값이 아니면 그 항목을 뺀다. `detached`가 배열이 아니면 `[]`다(fake source의 layout이 칸을 안 줄 수 있다).
7. `workspace.tsx`: `freshView()`에 `detached: []`만 더한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "detach, attach, float, dock을 섞어도 탭이 사라지거나 둘이 되지 않는다"(`model_test.ts` 기존 test에 붙인다. 새 test 없음).
- 남지 않음: `grep -rn "LAYOUT_SCHEMA_VERSION = 2" packages`가 0줄이고 `grep -n "판 2" packages/shell/main/workspace/schema.ts`가 0줄이다.
- 개발 데이터: 판 2인 `layout.json`은 읽히지 않고 새로 만들어진다. 확인은 `.dev-data/<id>/` 안에서만 한다. 사람의 `~/.lophn`은 건드리지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

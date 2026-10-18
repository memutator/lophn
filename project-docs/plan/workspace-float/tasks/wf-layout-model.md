# wf-layout-model

layout model(`WorkspaceView`)에 floated와 minimized 탭을 둔다. 탭 하나가 pane, floats 중 한 곳에만 있도록 순수 함수로 바꾼다(`floatTab`, `dockTab`, `minimizeFloat`, `restoreFloat`, `raiseFloat`, `closeFloat`, `setFloatRect`). 이 task가 내놓는 type과 함수가 wave 2 전부와 `wf-layout-schema`가 기대는 계약이다.

- 단위: wf-layout (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/model.ts`
  - `packages/shell/renderer/workspace/model_test.ts`
  - `packages/shell/renderer/workspace/workspace.tsx` (`freshView()` 한 곳에 `floats: []`만 더한다)
  - `packages/shell/renderer/workspace/layout-map.ts` (`viewFromStored`가 `floats: []`를 내게 하는 한 줄만. 나머지는 `wf-layout-schema`가 한다)
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "상태", "무엇을 만드나" 1·2, "정한 것"
  - 계획: `project-docs/plan/workspace-float/README.md`의 "정한 것"
  - 규칙: `.claude/skills/write-test/SKILL.md`
  - 지금 코드: `packages/shell/renderer/workspace/model.ts`(`holderOf`, `moveTab`, `openTabIn`, `reopenTab`, `closeTab`, `dropEmptyPane`, `normalizePane`), `model_test.ts`(test 모양)
  - module: `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
- 계약:
  - 쓰는 것: 없음. 이 task가 계약을 정한다.
  - 내놓는 것: 아래 모양이 곧 계약이다. 이름과 칸을 바꾸지 않는다. 모두 `model.ts`에서 export한다(순수 함수, 입력을 바꾸지 않고 새 view를 돌려준다. 할 일이 없으면 받은 `view` 그대로 돌려준다).

```ts
// 탭 하나에 칸 하나가 늘어난다. popup 같은 잠깐 떴다 사라지는 탭이 쓴다. 저장하지 않는다.
interface TabItem { /* 지금 칸 */ readonly transient?: boolean }

/** workspace `.content` 왼쪽 위를 (0,0)으로 한 CSS px 정수 사각형. */
export interface FloatRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
/** floats 층이 차지하는 칸. `.content`의 크기다. */
export interface FloatArea { readonly width: number; readonly height: number }
/** 배열 순서가 위아래 순서다. 마지막이 맨 위. */
export interface FloatItem {
  readonly tab: TabItem;
  readonly rect: FloatRect;        // minimized여도 접기 전 rect를 지킨다
  readonly minimized: boolean;
  readonly originPane: number;     // 떠나 온 pane 번호. dockTab이 쓴다
}
export interface WorkspaceView { /* 지금 칸 */ readonly floats: readonly FloatItem[] }   // 필수 칸

export const FLOAT_MIN: FloatArea;   // { width: 320, height: 200 }
export type FloatEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** 새 탭을 곧바로 floated로 연다(popup용). rect는 area 가운데, 너비·높이 60%. 맨 위. */
export function openFloat(view: WorkspaceView, tab: TabItem, area: FloatArea): WorkspaceView;
/** pane의 탭을 floated로. preview 표시를 지운다. pane에 없으면 그대로. originPane은 떠나 온 pane. */
export function floatTab(view: WorkspaceView, key: string, area: FloatArea): WorkspaceView;
/** floated 탭을 originPane 끝에 넣고 고른다. 그 pane이 없으면 focus pane. transient를 지운다. focus는 그 pane. */
export function dockTab(view: WorkspaceView, key: string): WorkspaceView;
export function minimizeFloat(view: WorkspaceView, key: string): WorkspaceView;
/** minimized를 풀고 맨 위로 올린다. */
export function restoreFloat(view: WorkspaceView, key: string): WorkspaceView;
export function raiseFloat(view: WorkspaceView, key: string): WorkspaceView;     // 이미 맨 위면 그대로(같은 참조)
export function closeFloat(view: WorkspaceView, key: string): WorkspaceView;
export function setFloatRect(view: WorkspaceView, key: string, rect: FloatRect, area: FloatArea): WorkspaceView;  // clampFloatRect를 거친다

/** area 안으로 당긴다. 크기는 FLOAT_MIN 이상(area가 더 작으면 area), 위치는 area 안. 정수로 반올림. */
export function clampFloatRect(rect: FloatRect, area: FloatArea): FloatRect;
/** 패널 이동. start에서 (dx,dy)만큼 옮긴 사각형을 area 안으로 가둔다. */
export function movedRect(start: FloatRect, dx: number, dy: number, area: FloatArea): FloatRect;
/** 가장자리·모서리 resize. 반대쪽 가장자리를 고정하고 FLOAT_MIN과 area 안으로 가둔다. */
export function resizedRect(start: FloatRect, edge: FloatEdge, dx: number, dy: number, area: FloatArea): FloatRect;

// 탭 찾기. pane과 floats를 모두 본다.
export function findTab(view: WorkspaceView, key: string): TabItem | undefined;
export function isFloated(view: WorkspaceView, key: string): boolean;
export function allTabs(view: WorkspaceView): TabItem[];                    // panes 순서, 그 뒤 floats 순서
export function mapTabs(view: WorkspaceView, change: (tab: TabItem) => TabItem): WorkspaceView;  // panes와 floats 모두. 바뀐 것이 없으면 그대로
/** 저장할 view. transient 탭을 panes와 floats에서 뺀다(pane의 selected가 빠진 탭이면 normalizePane). */
export function storableView(view: WorkspaceView): WorkspaceView;
```

  - 지금 함수가 floats를 아는 것(바꾸는 것): `openTabIn`은 key가 floats에 있으면 새로 붙이지 않고 `restoreFloat`로 올려 돌려준다(preview 탭 규칙은 pane 탭에만). `reopenTab`은 key가 floats에 있으면 그대로다(`holderOf` 대신 `findTab`으로 본다). `moveTab`, `moveTabBy`, `shiftTab`, `pinTab`, `closeTab`은 floats 탭을 건드리지 않고 pane 탭만 본다.

## 할 일

1. `model.ts`에 위 type과 함수를 더한다. 근거: roadmap "무엇을 만드나" 1.
   - `TabItem`에 `transient?: boolean`을 더하고 주석에 "저장하지 않는다. dockTab이 지운다"를 쓴다. `WorkspaceView`에 `floats`를 더한다. `FloatItem`, `FloatRect`, `FloatArea`, `FloatEdge`, `FLOAT_MIN`.
   - `floatTab`: 탭을 pane에서 빼는 일은 `closeTab`과 같다(고른 탭이면 이웃 탭을 고른다). pane이 비어 둘 중 하나가 사라지면 `dropEmptyPane`을 거친다. 새 `FloatItem`은 `originPane`에 떠나 온 pane 번호를 담고, rect는 `openFloat`와 같고 `minimized: false`다.
   - `openFloat`: 같은 key가 이미 pane이나 floats에 있으면 그대로(탭 하나는 한 곳에만). 첫 rect는 area 가운데, 너비·높이 area의 60%를 `clampFloatRect`로 거른다.
   - `dockTab`: `originPane`이 지금 pane 수 안이면 그 pane, 아니면 `focusedPane`. 끝에 붙이고 고르고 `focusedPane`을 그 pane으로. `preview: false`, `transient`는 지운다.
   - `resizedRect`: edge 글자에 `n`이 있으면 위쪽 가장자리, `s`면 아래쪽, `e`·`w`면 오른쪽·왼쪽 가장자리가 dx·dy를 따른다. 최소 크기에 닿으면 반대쪽 가장자리를 고정한 채 멈춘다. 결과를 `clampFloatRect`로 한 번 더 거른다.
   - 이동·resize·clamp는 모두 정수를 낸다(`Math.round`). 이유: 저장 schema가 정수다(`wf-layout-schema`).
2. `model.ts`의 `holderOf`는 export하지 않고 pane 전용으로 둔다. `openTabIn`·`reopenTab`의 "이미 열려 있음" 검사는 `findTab`을 쓴다.
3. 호출하는 곳을 맞춘다: `workspace.tsx`의 `freshView()`에 `floats: []`, `layout-map.ts`의 `viewFromStored` 반환에 `floats: []`. `deno task check`의 type check가 막는 곳이 이 둘 말고 더 있으면 그 줄만 맞추고 보고의 "넘길 줄"에 적는다.
4. `model_test.ts`에 위험 test를 더한다(아래 "끝남"). 기존 test는 `viewOf`가 `floats: []`를 갖게만 고친다.

## 정한 것

- `originPane`은 번호다(agent). roadmap이 `origin_pane`이라고만 적었다. pane은 둘이 최대라 번호면 된다. pane이 사라져 번호가 어긋나면 `dockTab`이 focus pane으로 보낸다.
- floats는 최대 20이다(agent, schema도 20). 넘는 일은 model이 막지 않는다. 사람이 20개를 띄울 일이 없고, 막을 곳은 저장 schema 하나면 된다.
- 새 패널 rect는 겹쳐 둔다(agent). cascade(조금씩 비껴 놓기)는 roadmap에 없다.
- `dockTab`이 `transient`를 지운다(agent). popup이 뜬 패널을 사람이 Dock하면 고른 것이니 저장해도 된다.
- `openFloat`를 더한다(agent). roadmap은 "popup은 floated로 태어남"이라 했고 `browser-tab`의 popup task가 쓴다. `floatTab`도 같은 rect 규칙을 쓰므로 함수 하나로 모은다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`model_test.ts`, 합쳐 둘):
  - "float, dock, minimize, restore, raise, close를 이어서 해도 탭이 사라지거나 둘이 되지 않는다": pane 둘과 floats가 섞인 view에서 연산 열을 표로 돌리며 매 단계 `allTabs(view)`의 key 집합이 (닫은 것을 뺀) 처음 집합과 같고 중복이 없는지 본다. `openTabIn`·`reopenTab`으로 floated 탭을 다시 열어도 둘이 되지 않는 경우를 한 줄 넣는다.
  - "transient 탭은 저장할 view에 없다": `storableView`가 panes와 floats에서 transient 탭을 뺀다.
- 남지 않음: `grep -rn "holderOf" packages/shell/renderer/workspace --include=*.ts --include=*.tsx`가 `model.ts` 안만 가리킨다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `workspace.tsx`, `layout-map.ts`에서 맞춘 줄
- 계약 바꾸기 요청: 위 모양을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

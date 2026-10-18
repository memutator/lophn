# wd-contract

detached 창의 경계를 고정한다: project 창 ↔ main ↔ detached 창의 IPC channel과 입력·응답·push의 모양(`ipc/detached.ts`), preload 통로(`preload/detached-api.ts`)와 `window.lophnDetached` 노출, 그리고 탭 kind가 창 사이로 살아 있는 상태를 옮기는 `TabKindDef.transfer`/`receive`와 `TabHost.keeps`. 구현(main handler, detached 창 화면, project 창 연결, kind별 transfer)은 wave 2의 다른 task가 한다.

- 단위: wd-contract (wave 1)
- 선행: wd-layout. 둘 다 `workspace.tsx`를 고친다. 이 task는 그 파일에 두 줄만 더한다.
- 소유(이 task만 고친다):
  - `packages/shell/ipc/detached.ts`
  - `packages/shell/preload/detached-api.ts`
  - `packages/shell/preload/shell.ts`
  - `packages/shell/renderer/workspace/kinds/kind.ts`
  - `packages/shell/renderer/workspace/kinds/host.ts`
  - `packages/shell/renderer/workspace/workspace.tsx` (`WorkspaceProps`에 `detached?` 한 줄, `host` 객체에 `keeps` 한 줄)
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "무엇을 만드나" 4(누가 layout을 갖나, 창을 닫을 때, 탭 옮기기)
  - 계획: `project-docs/plan/workspace-detach/README.md`의 "정한 것"
  - 본보기(꼴): `packages/shell/ipc/app-frame.ts`(channel 상수, strict zod schema, `ViewReply`), `packages/shell/preload/views-api.ts`(`call`, push 구독을 schema로 거르기), `packages/shell/ipc/window-controls.ts`
  - 노출 자리: `packages/shell/preload/shell.ts`의 `role === "shell"` 갈래(`lophnLayout`이 놓인 곳)
  - 지금 코드: `renderer/workspace/kinds/kind.ts`(`TabKindDef`), `host.ts`(`TabHost`), `workspace.tsx`(`WorkspaceProps`, `host` 객체), `renderer/app-frame/view-keeps.ts`(`ViewKeeps` type)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/ipc`, `packages/shell/preload`, `packages/shell/renderer`
- 계약:
  - 쓰는 것: `wd-layout`의 `DetachedBounds` 모양(`{x, y, width, height}` 정수. `ipc/detached.ts`는 renderer를 import하지 않으므로 같은 모양을 zod로 따로 쓴다).
  - 내놓는 것(다른 task가 이 모양에 기댄다. 이 모양은 이 task만 바꾼다):
    - 이 file은 main·preload·renderer가 함께 부르므로 import는 `zod`와 type뿐이다.

```ts
// ipc/detached.ts
// project 창 → main. 보낸 창이 project 창(detached 창이 아닌 desktop 창)이어야 한다.
export const DETACHED_OPEN_CHANNEL = "shell:detached-open";
export const DETACHED_FOCUS_CHANNEL = "shell:detached-focus";
export const DETACHED_CLOSE_CHANNEL = "shell:detached-close";
// detached 창 → main. 보낸 창이 detached 창이어야 한다.
export const DETACHED_TAKE_CHANNEL = "shell:detached-take";
export const DETACHED_DOCK_CHANNEL = "shell:detached-dock";
export const DETACHED_CHANGED_CHANNEL = "shell:detached-changed";
export const DETACHED_OPEN_TAB_CHANNEL = "shell:detached-open-tab";
export const DETACHED_REMOVE_CHANNEL = "shell:detached-remove";
// main → renderer push. payload는 DetachedEvent.
export const DETACHED_EVENT_CHANNEL = "shell:detached-event";

/** 탭 값. renderer의 TabItem이 그대로 지난다. main은 key와 kind만 본다. */
export const detachedTabSchema = z.looseObject({ key: z.string().min(1).max(4096), kind: z.string().min(1).max(64) });
/** 창 사이로 옮기는 살아 있는 상태. value는 kind가 정하는 JSON이고, views는 같이 옮길 앱 view의 view_session이다(main이 받는 창으로 옮긴다). */
export const tabTransferSchema = z.strictObject({ value: z.json(), views: z.array(viewSession).max(8) });
export type TabTransfer = { value: unknown; views: string[] };

// 입력(모두 strict. 한 번에 64KiB를 넘으면 ipc-guard가 거절한다)
export const detachedOpenSchema = z.strictObject({ project: projectId, tab: detachedTabSchema, transfer: tabTransferSchema.nullable(), bounds: boundsSchema.nullable() });
export const detachedFocusSchema = z.strictObject({ key: tabKey });
export const detachedCloseSchema = z.strictObject({ key: tabKey.nullable() });   // null이면 이 project 창의 detached 창 전부
export const detachedDockSchema = z.strictObject({ tab: detachedTabSchema, transfer: tabTransferSchema });
export const detachedTabInputSchema = z.strictObject({ tab: detachedTabSchema }); // changed, open-tab
// take, remove는 입력이 없다.

export interface DetachedTaken { project: string; tab: DetachedTab; transfer: TabTransfer | null }

export type DetachedEvent =
  // → project 창
  | { kind: "docked"; key: string; tab: DetachedTab; transfer: TabTransfer | null } // detached 창이 돌아왔다. transfer가 null이면 저장된 값으로만 돌아온다(창이 갑자기 닫힘).
  | { kind: "changed"; key: string; tab: DetachedTab }   // detached 창에서 탭 값이 바뀌었다(patchTab)
  | { kind: "open-tab"; tab: DetachedTab }               // detached 창이 project 창에 탭을 열라고 한다
  | { kind: "closed"; key: string }                       // detached 창이 탭을 닫았다(removeTab)
  | { kind: "moved" }                                     // detached 창을 옮기거나 크기를 바꿨다(layout을 다시 저장하라. wd-restore가 보낸다)
  // → detached 창
  | { kind: "dock-request" };                              // 창 닫기(×)가 눌렸다. [Dock]과 같게 하라

export type DetachedReply<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: "invalid_input" | "forbidden" | "not_found" | "conflict" | "unavailable"; message: string } };

/** window.lophnDetached. 거절은 code만 실은 Error다. 두 방향 모두 이 하나다. 보낸 창이 맞는 쪽이 아니면 main이 forbidden으로 거절한다. */
export interface LophnDetachedApi {
  // project 창
  open(input: z.infer<typeof detachedOpenSchema>): Promise<{ bounds: DetachedBounds }>;   // 만든 창의 bounds
  focus(input: { key: string }): Promise<void>;
  close(input: { key: string | null }): Promise<void>;
  // detached 창
  take(): Promise<DetachedTaken>;
  dock(input: z.infer<typeof detachedDockSchema>): Promise<void>;
  changed(input: { tab: DetachedTab }): Promise<void>;
  openTab(input: { tab: DetachedTab }): Promise<void>;
  remove(): Promise<void>;
  // 양쪽
  subscribe(listener: (event: DetachedEvent) => void): () => void;
}
```

    - `open`의 오류: 같은 (project, key)의 detached 창이 이미 있으면 `conflict`(main이 그 창을 앞으로 가져온다), `transfer.views`에 보낸 창의 것이 아닌 view가 있으면 `invalid_input`, 창을 못 만들면 `unavailable`.
    - kind 계약(`kinds/kind.ts`의 `TabKindDef`에 옆으로 더한다. 옛 칸은 그대로다):

```ts
/**
 * 탭을 다른 창으로 옮기기 전에 살아 있는 상태를 꺼낸다(`toStored` 값만으로는 옮겨지지 않는 것).
 * 보내는 창에서 돈다. null이면 옮기지 않는다(탭은 그대로 둔다). 선언하지 않은 kind는 `{ value: null, views: [] }`로 본다.
 * value는 JSON이고 main을 거쳐 같은 project의 창에만 간다.
 */
transfer?(tab: TabItem, host: TabHost): Promise<TabTransfer | null>;
/** 받는 창이 탭을 그리기 전에 부른다. transfer가 낸 값이 온다. 값 없이 되살린 탭(저장된 값만)에는 부르지 않는다. */
receive?(tab: TabItem, transfer: TabTransfer, host: TabHost): void;
```

    - host 계약(`kinds/host.ts`의 `TabHost`): `readonly keeps: ViewKeeps;` — 창마다 하나인 native view 보관소. app view를 옮기는 kind가 `transfer`·`receive`에서 쓴다(모양은 `wd-native-move`가 넓힌다).
    - `WorkspaceProps.detached?: LophnDetachedApi` — 없으면 Detach 항목과 단추를 두지 않는다(terminal·editor 통로와 같은 규칙).

## 할 일

1. `ipc/detached.ts`: 위 channel 상수, schema, type, `DetachedReply`, `LophnDetachedApi`를 쓴다. `viewSession`은 `ipc/app-frame.ts`의 규칙(1자 이상, 제어 문자 없음)과 같게 따로 쓴다. `projectId`는 `ipc/app-frame.ts`의 `prj_<ULID>` 규칙, `boundsSchema`는 x·y 정수 ±32768, width·height 정수 1..32768(`main/workspace/schema.ts`의 `windowBounds`와 같다). `DetachedTab`은 `detachedTabSchema`의 type이다. zod는 4.6.5(`z.looseObject`, `z.json`)이다.
2. `preload/detached-api.ts`: `createDetachedApi(transport)`. `views-api.ts`의 `call`과 같은 규칙으로 invoke 실패를 `unavailable`로 바꾸고 응답 `ok: false`는 code만 실은 `Error`로 거절한다. `subscribe`는 `DETACHED_EVENT_CHANNEL`을 schema로 거른 것만 listener에 넘기고 해제 함수를 돌려준다. 어떤 invoke 실패에도 던지지 않고 거절만 한다. 구현 task가 없는 channel은 handler가 없어 `unavailable`로 거절된다.
3. `preload/shell.ts`: `role === "shell"` 갈래에 `contextBridge.exposeInMainWorld("lophnDetached", createDetachedApi(ipcRenderer))`를 더한다. overlay에는 열지 않는다.
4. `kinds/kind.ts`, `kinds/host.ts`: 위 칸을 더한다. `TabTransfer`는 `ipc/detached.ts`에서 import한다.
5. `workspace.tsx`: `WorkspaceProps`에 `detached?: LophnDetachedApi`(주석 한 줄), `host` 객체에 `keeps,` 한 줄. 그 밖은 고치지 않는다.

## 정한 것

- 두 방향(project 창, detached 창)을 한 API로 묶었다(agent). 같은 renderer bundle과 preload를 쓰는 창이고, main이 보낸 창으로 역할을 가려 `forbidden`을 돌려준다. 통로를 둘로 가르면 preload·노출·type이 두 벌이 된다.
- `transfer`는 `Promise<TabTransfer | null>`이다(agent). editor의 flush가 비동기이고, 실패하면 null로 "옮기지 않음"을 말해야 해서다.
- `moved`는 이 계약에 처음부터 있다(agent). `wd-restore`가 보내기 전에는 아무도 받지 않는다. 그 사이 contract를 바꾸지 않으려는 것이다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 입력 검사는 zod schema가 한다(write-test: schema가 보장하는 것은 test하지 않는다).
- 남지 않음: 없음(새 file과 한 줄 더하기뿐이다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `workspace.tsx` 두 줄
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

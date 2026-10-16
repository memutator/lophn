# screens-data-toast

반응 층이 낸 toast를 창 위 overlay `notification` 표면으로 띄운다. 권한 요청, 허락 요청, 질문, 앱 재시작 멈춤, 계약 위반 다섯 가지다. launcher, Lophn Workspace, project 창, 앱 공간(native view 위 포함) 어디서나 뜨고 layout을 차지하지 않는다. toast 문구 key도 여기서 만든다.

- 단위: screens-data (wave 3)
- 선행: screens-data-events (`reactionsOf`, `useEventClient`), screens-data-waiting (`waiting-pages.tsx`, `waiting.module.css`를 같이 고친다. 겹침을 피하려고 순서를 건다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/overlay/` (`surfaces/surface.tsx`의 `notification` 갈래, `registry.ts`, `consumer.ts`)
  - `packages/shell/renderer/desktop/connection/toasts/` (새로)
  - `packages/design/wording/catalog/workspace.ts`·`catalog/common.ts`의 Workspace 단추 이름 key 값(`U2.1#7`. 값만 바꾼다. 추가 소유, lead 승인 2026-10-16)
  - `tools/wireframes/frames/compositions/waiting/waiting-toast.tsx`(지운다), `waiting-pages.tsx`의 `WaitingToasts`, `waiting.module.css`의 toast 규칙
  - `packages/design/wording/catalog/data.ts`와 `catalog/data.placeholders.ts`의 toast key(wording-split이 만든 영역 file. 추가 소유, lead 승인 2026-10-16. `screens-data-waiting`이 같은 file을 고치므로 선행으로 순서를 걸었다)
- 읽을 것:
  - spec: S1 8장(반응 표, 놓친 toast는 다시 띄우지 않는다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - inventory: `U2.1#4`, `U3.1#9`(문구 key 부분. 아래 정한 것 참고), `U2.1#7`(Workspace로 들어가는 단추 이름. screens-workspace가 이 task에 기대고 있다)
  - 결정: `../README.md` 3장 #17(앱 view를 다시 그리는 신호는 toast가 아니다)
  - 지금 코드: `packages/shell/renderer/overlay/surfaces/surface.tsx`(`notification` 갈래: design `Toast`를 그린다), `overlay/consumer.ts`(`overlayConsumer`), `packages/shell/renderer/editor/leave-dialog.ts`(overlay를 여는 쪽의 본보기), `packages/shell/ipc/overlay.ts`(모델: `label`, `text`, `choices`)
  - 본보기(화면): `tools/wireframes/frames/compositions/waiting/waiting-toast.tsx`, `waiting-data.ts`의 `TOASTS`, `waiting-pages.tsx`의 `WaitingToasts`
- 계약:
  - 쓰는 것:
    - `Reaction`, `reactionsOf`, `useEventClient` (screens-data-events)
    - `packages/shell/ipc/overlay.ts`의 `OverlayApi`와 `notification` 표면(contract-shell이 고정한 모양). toast 하나는 `label`(제목), `text`(본문), `choices`(행동 앞의 셋까지), `tone`(`neutral | error`)으로 나타낸다.
    - `@lophn/design/components`의 `Toast`, `ToastStack`(ui-chrome이 행동 단추를 오른쪽 끝에 두고 단추 최대 셋과 어조를 받도록 고쳤다)
  - 내놓는 것:
    - `desktop/connection/toasts/toast-host.tsx`: `ToastHost({ overlay: OverlayApi })`. 창마다 한 번 마운트한다. event client를 듣고 `reactionsOf`가 낸 toast를 overlay에 연다. 사람이 행동 단추를 누르면 등록된 처리기에 `{ kind: "waiting" } | { kind: "session"; session: string | null; app?: string } | { kind: "project-manager"; project; context; check }`을 넘긴다.
    - `desktop/connection/toasts/toast-actions.ts`: `registerToastActionHandler(handler: (action: ToastAction) => boolean): () => void`. 처리기를 나중에 등록한 것부터 불러 `true`를 돌려주는 첫 처리기가 처리한다. 지금 보이는 화면(project 창, 앱 공간, Workspace)이 마운트되는 동안 자기 처리기를 등록한다. 어느 처리기도 처리하지 못하면 아무 일도 하지 않는다. 기본 처리(다른 화면으로 가서 여는 일)는 `desktop/main.tsx`(screens-workspace)가 등록한다.
    - wording key(영역 `waiting`, 파일 `catalog/data.ts`): `waiting.toast-permission`, `waiting.toast-approval`, `waiting.toast-question`, `waiting.toast-restart-halted`, `waiting.toast-violation`(제목과 본문과 행동 이름을 `title`, `body`, `action` 꼴로)

## 할 일

1. `toasts/toast-host.tsx`를 짠다. `overlayConsumer`로 `notification` 표면을 열고(요청 id는 reaction id로), 행동이 눌리면 `toast-actions`의 처리기를 부르고 표면을 닫는다. 같은 reaction id의 toast는 한 번만 연다. 연결이 끊긴 사이 놓친 toast는 다시 띄우지 않는다(events가 `origin: "snapshot"`이면 반응을 만들지 않는다. 호스트는 그것을 믿는다). 근거: S1 8장, `U2.1#4`.
2. `toasts/toast-actions.ts`를 짠다. 처리기 목록과 등록·해제만 둔다(순수).
3. `overlay/surfaces/surface.tsx`의 `notification` 갈래를 점검한다. 행동이 최대 셋이고(앞의 세 choice), 오른쪽 끝에 놓이는 design `Toast` 모양을 그대로 쓰는지 본다. 지금 코드는 `choices` 앞 둘을 행동으로 쓰므로 셋으로 넓히고 `tone`을 `Toast`에 넘긴다. 필요한 칸이 모델에 모자라면 고치지 말고 "계약 바꾸기 요청"에 적는다.
4. toast 문구를 만든다. 영역 `waiting`의 key를 위 이름으로 `catalog/data.ts`에 더하고 `generate.ts`를 돌려 `catalog/data.placeholders.ts`를 갱신한다. "Operator needs permission", "Orders release 7 needs approval", "lophn has a question", "App restart halted"처럼 wireframe의 `TOASTS` 문구를 key로 옮긴다. 계약 위반 toast는 `waiting.toast-violation`("{title}: {count} documents don't match" 꼴. 본문과 행동 [View]·[Ask Project Manager]는 `contexts.title.toast-violations`를 쓰던 옛 key를 이 영역으로 옮긴다)이다. 근거: `U3.1#9`.
5. gallery `WaitingToasts`를 고친다. `waiting-toast.tsx`(design `Toast`의 look-alike)를 지우고 `waiting-pages.tsx`의 `WaitingToasts`가 design `Toast`와 `ToastStack`을 직접 쓰되 문구는 위 wording key와 `reactionsOf`가 fake event에서 낸 값으로 그린다. 정적 화면이라 overlay 창은 쓰지 않는다.
6. Workspace로 들어가는 단추 이름을 바꾼다(`U2.1#7`, req-0058). 글만 바꾸고 key 이름은 바꾸지 않는다: `launcher.button.lophn`, `common.button.palette-lophn`, `common.title.palette-lophn`, `common.label.tray-open`의 "Open lophn"·"lophn" 계열 문구를 "Lophn Workspace"로 한다. key가 어느 영역 file(`catalog/workspace.ts` 또는 `catalog/common.ts`)에 있는지는 `grep`으로 찾는다. 쓰는 코드는 screens-workspace 단위가 맞춘다.
7. 탭 안 알림(탭 위쪽에 붙는 toast)은 이 task의 것이 아니다. 각 화면이 design `Toast`를 직접 쓴다(`ui-inventory.md` 6.1). gallery의 `app-space/toast.tsx`, `contexts/tab-toast.tsx`, `workspace/top-toast.tsx`, `project-files/notices.tsx`의 look-alike를 합치는 일은 각 화면 단위가 한다.

- (lead가 더함, screens-data-waiting이 넘긴 것) `desktop/connection/events/`를 같은 단위가 고친다.
  - `waiting-store.ts`의 `replaceTurnRequests`와 `sessions-store.ts`의 `replace`가 snapshot의 `agent`·`place`를 쓰게 한다. 지금은 `SessionStarted`를 받은 session만 coding을 구별한다.
  - `typed.ts`(event type 우회)를 지우고 `BusEvent`를 바로 쓴다(lead가 계약을 좁혔다, `1ad72974`).
  - `ApprovalDecided`는 `decision: allow|reject`와 `applied`(적용 결과)를 싣는다(`79dfb078`). 대기 목록의 "Allowed, applying" 줄이 이것으로 applied·failed로 바뀐다(`waiting/settled.ts`).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (화면과 overlay 모양. 반응 규칙은 screens-data-events의 test가 본다)
- 남지 않음: `grep -rn "WaitingToast\|waiting-toast" packages tools/wireframes`가 0줄이다.
- (화면) `deno task wireframes`가 되고, gallery의 `new-waiting-toasts`가 design `Toast`로 그려진다.

## 보고

- 바꾼 file
- 등록할 것: 창마다 `ToastHost`를 한 번 마운트하고 기본 처리기(다른 화면으로 가서 여는 일)를 등록한다(`desktop/main.tsx`·`entry.tsx`는 screens-workspace 소유다. lead가 screens-workspace brief와 맞춘다). `contexts.title.toast-violations`를 쓰던 `workspace/contexts/violation-toast.tsx`는 screens-contexts가 지운다. `catalog/data.ts`의 toast key.
- 안 쓰게 된 export: `contexts.title.toast-violations`(옛 key)
- 정한 것: `U3.1#9`는 screens-project 줄이다. toast 문구 key는 여기서 만들고, "눌러야만 Project Manager session으로 간다"는 호스트 처리는 `screens-project-reactions`가 맡는다. `ToastHost`가 처리기에 넘기는 action 모양은 위와 같다. 처리기 등록은 보이는 화면이 한다.
- 계약 바꾸기 요청(wave 3): overlay `notification` 모델에 본문 줄 수나 행동 수가 모자라면 여기 적는다

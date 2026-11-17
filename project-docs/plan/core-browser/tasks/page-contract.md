# page-contract

멀리서 page를 보고 다루는 길과 화면 없는 page host의 계약을 protocol에 고정한다: core가 host에 시키는 요청(frame 켜고 끄기, 읽음, 입력, 잡기), host가 미는 frame, `page_view/*` route, event, page host를 띄우는 intent. 계약 아래 동작은 짓지 않고 route는 등록하지 않는다. `architecture/browser-tab.md`에 새 모델의 초안을 쓴다.

- 단위: page (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/page-view.ts`(새 file)
  - `packages/protocol/lophn-agent/host-queue.ts`
  - `packages/protocol/host-link/frames.ts`
  - `packages/protocol/events/transient.ts`, `packages/protocol/events/changes.ts`
  - `packages/core/host-queue/queue.ts`(`LINK_CALL_MS` 항목만)
  - `project-docs/flows/areas/harness.yaml`
  - `project-docs/architecture/browser-tab.md`
  - `project-docs/boundary-catalog.yaml`(`host-queue-interface` 설명만)
- 읽을 것:
  - 계획 README "정한 것" 전부
  - architecture: `project-docs/architecture/browser-tab.md`("agent가 다루는 탭" 34~43, "경계와 계약"), `terminal-agent.md` 모델의 터미널 보기(본보기), `remote.md` "desktop에서 다른 기계 보기"
  - 본보기 code: `packages/protocol/coding-agent/terminal-view.ts`(route 모양), `packages/protocol/host-link/frames.ts`의 `terminal_screen`, `packages/core/terminal-view/view.ts`
  - spike: `reports/multi-device/spike-headless-browser.md` 4절(screencast)과 5절(그리지 않는 창)
  - boundary: `project-docs/boundary-catalog.yaml`의 `host-queue-interface`
- 계약:
  - 쓰는 것: `hostRequestSchema`, `LINK_REQUEST_KINDS`, `hostFrameSchema`, `defineRead`·`defineMemory`, `transientEventSchema`, `CHANGE_NAMES`
  - 내놓는 것(뒤 task가 이 이름으로 짓는다):
    - `page-view.ts`
      - 상수 `PAGE_VIEW_LEASE_MS = 30_000`, `PAGE_VIEW_RENEW_MS = 10_000`, `PAGE_FRAME_MAX_BYTES = 2 * 1024 * 1024`(JPEG 한 장, base64 전).
      - `pageInputSchema`(type `PageInput`), discriminated on `type`. 좌표는 보는 쪽이 본 frame의 page CSS px다(0~100_000 수).
        `{type:"pointer", phase:"down"|"move"|"up", x, y}`(왼쪽 단추 하나), `{type:"scroll", x, y, dx, dy}`(정수 px, ±100_000),
        `{type:"text", text}`(1~1000자), `{type:"key", key}`(1~64자, `packages/shell/main/browser/agent/keys.ts`가 아는 이름: "Enter", "Control+a"),
        `{type:"navigate", url}`(1~8192자), `{type:"back"}`, `{type:"reload"}`.
      - `pageFrameSchema`: `{media_type: "image/jpeg", data_base64, width, height}`. width·height는 그 frame이 보이는 viewport의 CSS px(정수 ≥1). data_base64 길이는 `PAGE_FRAME_MAX_BYTES`의 base64 길이까지.
      - route(모두 `actors: ["user"]`, errors는 terminal-view와 같은 여섯):
        - `page_view/list`(read) `{}` → `{pages: [{tab, url, title, loading, by}]}`. by는 연 agent의 이름, 사람이 연 탭은 null.
        - `page_view/snapshot`(read) `{tab}` → `{tab, seq, frame: PageFrame | null, painting, agent, held, url, title, loading, by, control}`. seq는 core가 그 탭의 frame이나 상태가 바뀔 때마다 올리는 수, painting은 host가 그 page를 그리는가, agent·held는 take control 상태, control은 부른 principal이 다룰 수 있는가.
        - `page_view/watch`(memory) `{tab, on}` → `{}`. lease `PAGE_VIEW_LEASE_MS`, 보는 쪽이 `PAGE_VIEW_RENEW_MS`마다 갱신한다.
        - `page_view/input`(memory) `{tab, key, input: PageInput}` → `{}`. key(1~200자)는 다시 보낸 것을 알아보는 값(terminal_view/input과 같다).
        - `page_view/control`(memory) `{tab, held}` → `{}`.
        - `page_view/open`(memory) `{url, key}` → `{tab}`. 사람이 그 기계에 browser 탭을 연다(http·https).
        - 목록 `PAGE_VIEW_ROUTES`.
    - `host-queue.ts`의 새 연결 요청(모두 `LINK_REQUEST_KINDS`에 든다):
      `page_stream {tab, on}`, `page_read {tab, seq}`(core가 그 frame을 보는 쪽에 내주었다), `page_input {tab, input: PageInput}`, `page_control {tab, held}`. 그리고 상수 `PAGE_HOST_INTENT = "--page-host"`(`AGENT_WINDOW_INTENT` 옆).
    - `frames.ts`의 새 host frame:
      `page_frame {tab, seq, frame: PageFrame}`(seq는 host가 탭마다 process가 사는 동안 올리는 수, 다시 0으로 돌아가지 않는다),
      `page_state {tab, painting, agent, held}`.
    - event `PageViewChanged {tab, seq}`, subject `page:<tab>`, 내용 없음(transient). `CHANGE_NAMES`에 `"browser_pages"`(core가 아는 browser 탭 목록이나 그 url·title이 바뀜).
    - 기기 목록(`packages/protocol/remote/allowlist.ts`)에 더할 것: `REMOTE_ALLOWED_ROUTES`에 `PAGE_VIEW_ROUTES` 여섯, `REMOTE_ALLOWED_EVENTS`에 `PageViewChanged`. route가 등록되는 `page-view-core`의 merge 때 lead가 더한다(지금 더하면 등록 안 된 route가 목록에 선다).

## 할 일

1. `page-view.ts`를 위 모양으로 쓴다. `terminal-view.ts`처럼 머리 주석에 흐름(lease, 최신 frame 하나, 내용 없는 event, 읽어 간 만큼만 다음 frame)을 적는다. host-queue.ts를 import하지 않는다(host-queue.ts가 이 file의 `pageInputSchema`를 import한다).
2. `host-queue.ts`에 네 요청 schema와 `LINK_REQUEST_KINDS` 항목, `PAGE_HOST_INTENT`를 더한다. 주석에 back-pressure를 적는다: host는 core에 보낸 frame의 `page_read`가 오기 전에는 다음 frame을 보내지 않고 CDP ack도 미룬다.
3. `frames.ts`에 두 frame을 더한다. frame은 JSON 글이다(host-link는 binary frame을 닫는다). host→core frame 상한은 `HOST_LINK_FRAME_MAX_BYTES`(16 MiB)이고 `HOST_LINK_BUFFER_LIMIT`(1 MiB)은 core→host 쓰기에만 걸린다(`packages/core/server/host-link.ts`의 `write`). frame 상한 2 MiB가 이 안에 든다는 것을 주석에 적는다.
4. `transient.ts`에 `PageViewChanged`, `changes.ts`에 `"browser_pages"`를 더한다.
5. `packages/core/host-queue/queue.ts`의 `LINK_CALL_MS`에 새 kind 기한을 더한다(type이 모든 kind를 요구한다): `page_stream` 5_000, `page_read` 5_000, `page_input` 10_000, `page_control` 5_000. 그 밖은 고치지 않는다.
6. flows(`flows` skill): route 여섯이 entry가 되므로 `harness.yaml`에 flow를 쓴다(`page-view-list`, `page-view-snapshot`, `page-view-watch`, `page-view-input`, `page-view-control`, `page-view-open`). steps와 outcome(성공, `forbidden`, `not_found`, `conflict` 갈래)은 README "정한 것"대로 쓰고 code에는 지금 있는 path(protocol file)만 둔다. `page-view-core`가 code를 더하고 갈래를 맞춘다. `PageViewChanged`가 어느 outcome의 observe에 오게 한다.
7. `browser-tab.md` 초안: 모델에 "page host"와 "멀리서 보기"를 더하고, "지키는 것"에 절 둘(`### 화면 없는 기계의 page`, `### 멀리서 보기`)을 62번부터 더한다(README의 결정 하나가 한 항목). 37·40·41과 "열린 것"의 "화면이 없는 Linux는 browser를 쓸 수 없다"를 새 결정에 맞게 고치고, "경계와 계약"에 이 route·요청·frame·event를 적는다. code path는 적지 않는다. `boundary-catalog.yaml`의 `host-queue-interface` 설명에 새 요청·frame·route를 더한다.

정한 것:
- 사람이 연 탭을 닫는 route는 두지 않는다: README "멀리서 하는 것"에 없다.
- 보는 쪽의 pointer는 왼쪽 단추 하나의 down·move·up이다: 폰의 손가락과 desktop의 click·끌기를 같은 모양으로 받는 가장 작은 꼴이다. hover는 없다.
- frame과 상태를 한 snapshot route로 읽고 event 하나로 알린다: 터미널 보기와 같은 꼴이다.

## 끝남

- `npm run check`가 통과한다(flows 단계 포함).
- 위험 test: 없음(schema만이다).
- 남지 않음: 없음(지우는 것이 없다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 이 task는 `packages/protocol/lophn-agent/mod.ts`에 `page-view.ts`의 export를 적는다. allowlist는 위 "기기 목록에 더할 것"대로 `page-view-core` merge 때다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

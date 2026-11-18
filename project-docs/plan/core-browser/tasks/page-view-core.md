# page-view-core

core 쪽 멀리서 보기를 짓는다: 보는 쪽의 lease, 탭마다 마지막 frame 하나, `page_view/*` route 여섯, `PageViewChanged`와 `StateChanged{browser_pages}`, 입력 자격, 사람이 그 기계에 browser 탭을 여는 길. host가 화면을 밀던 때의 터미널 보기(`git show 11cda18f9^:packages/core/terminal-view/view.ts`)와 같은 꼴이다.

- 단위: page (wave 2)
- 선행: page-contract. `core-terminals`의 `coding-core`가 merge된 뒤에 띄운다(README "lead가 할 일").
- 소유(이 task만 고친다):
  - `packages/core/host-queue/page-view.ts`(새 file), `packages/core/host-queue/page-view_test.ts`(새 file)
  - `packages/core/host-queue/queue.ts`
  - `packages/core/main/daemon/wiring/host-queue.ts`
  - `packages/protocol/registry.ts`(`ROUTES`에 `...PAGE_VIEW_ROUTES` 한 줄)
  - `project-docs/flows/areas/harness.yaml`, `project-docs/flows/tests/core-rest.yaml`
  - `project-docs/module-catalog.yaml`(host-queue module의 notes만)
- 읽을 것:
  - 계획 README "정한 것 › 멀리서 보기"
  - architecture: `project-docs/architecture/browser-tab.md`(page-contract가 쓴 "멀리서 보기" 절), `terminal-agent.md` 모델의 터미널 보기와 지키는 것 18, `remote.md` 지키는 것 1
  - 본보기: host가 화면을 밀던 때의 터미널 보기 `git show 11cda18f9^:packages/core/terminal-view/view.ts`와 `view_test.ts`(lease, `sync`·`wanted`·`flying`·`sent`, 입력 key). 지금의 `packages/core/terminal-view/view.ts`(`PASSED_CODES`, `expire`·`pruned`)와 `packages/core/main/daemon/wiring/terminal-view.ts`(`reads` 꼴, `closeWork`). 같은 key 한 번은 `packages/core/terminals/routes.ts`의 `once`. 입력 허락 test는 `packages/core/main/daemon/wiring/terminals_test.ts`
  - boundary·module: `host-queue-interface`, `project-docs/module-catalog.yaml`의 `packages/core/host-queue`
- 계약:
  - 쓰는 것: queue의 `callLink`, core host-link의 `onFrame`·`onOpen`(page-contract가 되살렸다), `packages/protocol/lophn-agent/page-view.ts`(`PAGE_VIEW_ROUTES`, `PageInput`, `PageFrame`, `PAGE_VIEW_LEASE_MS`), 연결 요청 `page_stream`·`page_read`·`page_input`·`page_control`, host frame `page_frame`·`page_state`, event `PageViewChanged`, change 이름 `browser_pages`
  - 내놓는 것: route 여섯의 동작. 폰과 desktop 화면 task가 이것을 부른다.

시작 전에 다시 볼 것(lead가 2026-11-18 main 0.23.84에 대 보았다): `core-terminals`가 터미널을 core로 옮겨 터미널 보기는 이제 core가 PTY host의 화면을 읽고(host가 밀지 않는다), 입력과 열기는 `terminals/input|open`으로 갔다. 그래서 본보기는 옛 판이다("읽을 것"). 연결 요청을 보내는 함수는 page-contract가 되살린 `callLink`다(옛 이름 `callCoding`). 입력 자격 칸 `ctx.peek.terminalInputGrant`는 `device-roster`가 land된 뒤에도 그대로다(명단의 기기 `terminal_input`). `core-setup`이 아직 열려 있어 그 칸을 옮겼으면 옮긴 이름을 쓴다.

## 할 일

1. `queue.ts`: browser 탭(kind `browser`)의 목록을 내는 `pages()`(`{tab, owner, state}`)를 더하고, `createHostQueue`의 deps에 선택 `changed?(): void`를 더해 browser 탭이 생기거나 빠지거나 `report`로 상태가 바뀔 때 부른다. 다른 kind는 부르지 않는다.
2. `page-view.ts`: `createPageView(deps)`. deps는 `clock`, `publish`, `call(LinkRequest)`(연결 요청), `page(tab)`(core 표의 browser 탭, 없으면 null), `mayControl(principal)`, `open(who, url)`(탭 열기), `redact(text)`(null이면 아직 모름). 함수는 부른 자격 `who`(`principal`, `actor`)를 받는다.
   - actor가 `user`가 아니면 모든 함수가 `forbidden`이다(route의 actors와 같은 선을 여기서도 지킨다: frame은 사람이 로그인한 page의 그림이다).
   - `watch`: 옛 terminal view(`11cda18f9^`)의 `watch`·`sync`·`wanted`·`flying`·`sent`를 그대로 옮긴다. lease 키는 `<principal>\n<tab>`, 기한 `PAGE_VIEW_LEASE_MS`. lease가 하나라도 있으면 `page_stream {on:true}`, 마지막 lease가 끝나면 `{on:false}`. 모르는 탭은 `not_found`(browser read와 같은 `NO_SUCH_TAB` 뜻의 문장).
   - `frame(page_frame)`: lease가 없거나 모르는 탭이면 버린다. 아니면 그 탭의 마지막 frame을 바꾸고 host seq를 기억하고 view seq를 올려 `PageViewChanged {tab, seq}`를 낸다. `state(page_state)`도 같은 규칙으로 painting·agent·held를 바꾸고 알린다.
   - `snapshot`: page-contract의 모양으로 낸다. url·title은 `redact`를 거친다(null이면 `unavailable`, browser read와 같은 문장). 그림은 가리지 않는다(`browser-tab.md` 50, screenshot과 같다). 내준 frame의 host seq가 이미 `page_read`로 알린 것보다 크면 `page_read {tab, seq}`를 보낸다(실패는 버린다). 이것이 host가 다음 frame을 보내도 되는 신호다. frame이 아직 없으면 `frame: null`, host 상태를 아직 못 받았으면 painting true, agent·held false다.
   - `list`: core 표의 browser 탭 전부. by는 `agentName`(이미 wiring에 있다), 사람이 연 탭은 null.
   - `input`: `mayControl`이 아니면 `forbidden`이고 host에 아무것도 보내지 않는다. 그 principal의 lease가 없으면 `conflict`(본 frame 없이 좌표를 보낼 수 없다). 같은 key는 탭마다 200개를 기억해 한 번만 보낸다(`terminals/routes.ts`의 `once`와 같다). host 오류는 `PASSED_CODES`처럼 넘긴다.
   - `control`: `mayControl`이 아니면 `forbidden`. `page_control {tab, held}`를 보낸다.
   - `open`: `mayControl`이 아니면 `forbidden`. 같은 key는 한 번만 연다(`terminals/routes.ts`의 `once`와 같다). `deps.open`이 `{tab}`을 준다.
   - `expire`, `pruned`(표에서 빠진 탭의 lease·frame·key를 지운다), `closed`, `opened`: 옛 terminal view와 같다.
3. `wiring/host-queue.ts`: build에서 `createPageView`를 만든다. `call`은 queue의 `callLink`, `mayControl`은 `ctx.peek.terminalInputGrant?.(principal) ?? false`(terminal-view wiring과 같다), `open`은 `handlers.open(who, {target: {browser: {url}}})`의 결과에서 tab을 꺼낸다(사람 token처럼 주인 "person", home workspace, shell이나 page host가 없으면 띄운다). `ctx.hostLink.onFrame("page_frame"|"page_state")`, `onOpen`·`onClose`, 5초마다 `expire`를 붙이고, queue의 `changed`에서 `pruned()`와 `publishStateChanged`(`packages/protocol/events/changes.ts`, `packages/core/terminal-agents/service.ts`가 쓰는 꼴)로 `[{name: "browser_pages", id: null}]`를 부른다. memory에 watch·input·control·open, `reads`에 list·snapshot을 단다(terminal-view wiring의 `reads` 꼴). `closeWork`에서 timer를 멈춘다.
4. `packages/protocol/registry.ts`의 `ROUTES`에 `...PAGE_VIEW_ROUTES`를 더한다(memory route는 handler와 같은 변경에 등록해야 core가 뜬다: `core.ts`의 `memoryRouteMismatch`).
5. flows(`flows` skill): page-contract가 쓴 `page-view-*` flow에 code(`packages/core/host-queue/page-view.ts`, wiring)와 outcome을 채우고, frame·state를 받는 `system:` flow 하나를 더한다(지금 `terminal-view-*` flow의 꼴). 새 test file을 `tests/core-rest.yaml`에 적는다. module-catalog의 host-queue notes에 "멀리서 보기(lease와 마지막 frame)"를 더한다.

정한 것:
- 모듈을 새로 만들지 않고 `packages/core/host-queue/page-view.ts`에 둔다: 탭 표와 연결 요청을 이미 가진 module이라 catalog·deps 규칙을 늘리지 않는다.
- route는 host-queue wiring이 단다: 탭 열기 handler와 launcher를 같은 곳에서 쓰고 새 ctx 칸과 조립 줄이 필요 없다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`page-view_test.ts`, 가짜 `call`과 수동 clock. 서버·subprocess를 띄우지 않는다):
  - "agent 자격과 터미널 입력 허락이 없는 기기는 page에 입력하지 못하고 host에 아무 요청도 가지 않는다"(input·control·open 셋을 표로)
  - "agent 자격은 어느 탭의 frame도 읽지 못한다(다른 session이 연 탭 포함)"(snapshot·list·watch가 `forbidden`)
  - "마지막 lease가 끝나거나 기한이 지나면 host에 `page_stream {on:false}`가 가고, lease가 없을 때 온 frame은 남지 않는다"
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 이 task가 merge될 때 lead가 `packages/protocol/remote/allowlist.ts`에 `PAGE_VIEW_ROUTES` 여섯과 `PageViewChanged`를 더한다(page-contract "기기 목록에 더할 것")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

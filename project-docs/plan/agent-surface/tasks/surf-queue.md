# surf-queue

core 메모리에 host queue를 두고 shell main이 가져가 그 workspace를 보이는 창에 push한다. 그 위에 agent 명령 `tab open`(agent session, browser), `tab close`, `browser read`를 더한다.

- 단위: surf (wave 1)
- 선행: 없음. 계획 `standalone-core`가 main에 land한 뒤 lead가 연다.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/host-queue.ts`(새 file)
  - `packages/protocol/base/ids.ts`(prefix `tab`, `hrq` 두 줄)
  - `packages/core/host-queue/`(새 폴더)
  - `packages/core/main/daemon/wiring/host-queue.ts`(새 file)
  - `packages/cli/commands/{tab,browser}.ts`(새 file)
  - `packages/shell/ipc/surface.ts`(새 file), `packages/shell/preload/surface-api.ts`(새 file)
  - `packages/shell/main/desktop/wiring/surface.ts`(새 file)
  - `packages/shell/renderer/workspace/{open-policy.ts,open-policy_test.ts,workspace-window.tsx,use-surface-requests.ts}`
  - `packages/shell/renderer/workspace/kinds/{host.ts,agent.tsx,browser.tsx}`
  - `packages/shell/renderer/shell/{desk-model.ts,desk-model_test.ts}`
- 읽을 것:
  - `project-docs/plan/agent-surface/README.md`, `project-docs/products/roadmap/agent-surface.md`("탭 열기", "host queue", 정한 것 4)
  - architecture: `project-docs/architecture/{workspace-layout,browser-tab,agent-call,extension}.md`
  - boundary: `project-docs/boundary-catalog.yaml`의 `harness-host-interface`(본보기), module: `project-docs/module-catalog.yaml`의 `packages/shell/main`, `packages/core/main`
  - 본보기(core 메모리 요청 + take/done): `packages/core/lophn-agent/issuer-requests.ts`, `packages/protocol/lophn-agent/issuer-requests.ts`
  - 본보기(memory route 등록): `packages/protocol/lophn-agent/harness-host.ts`(`HARNESS_HOST_MEMORY_ROUTES`), `packages/core/main/daemon/wiring/harness.ts`(`memory: [[key(route), handler]]`, `gate()`), `packages/core/lophn-agent/register.ts`의 `memoryRoutes`
  - 본보기(push·ack): `packages/shell/main/browser-bridge/bridge.ts`(`ACK_TIMEOUT_MS`), `packages/shell/ipc/terminal.ts`(`TERMINAL_BRIDGE_*`), `packages/shell/preload/terminal-api.ts`, `packages/shell/renderer/terminal/use-bridge-open-requests.ts`
  - 본보기(agent 자격의 caller session): `packages/core/main/daemon/wiring/approvals.ts`의 `who.conditions.session`
  - shell → core: `packages/shell/main/desktop/wiring/context.ts`의 `coreInternal`(core가 없으면 `unavailable`, 다시 붙으면 저절로 이어진다)
  - 배치: `packages/shell/renderer/workspace/open-policy.ts`(`openAt`, `showAfter`), `packages/shell/renderer/shell/desk-model.ts`(`openBeside`, `groupOf`, `openFloatTab`, `OpenOptions.select`), `workspace-window.tsx`의 `host.openTab`(select:false가 `after`·`beside`를 버린다), `openSessionTab`
  - browser 상태: `packages/shell/ipc/browser.ts`(state), `packages/shell/main/browser/registry.ts`, `renderer/app-frame/webview-host.tsx`(`keyOf`)
  - 명령: `packages/cli/commands/{session,types}.ts`, `packages/core/agent-workspaces/credentials.ts`(명령의 `routes`가 agent 자격 상한이 된다)
- 계약:
  - 쓰는 것: `packages/base`의 Result와 오류 코드 일곱, Clock, IdSource. shell main의 `coreInternal`.
  - 내놓는 것(모양 고정. 바꾸려면 lead에게 요청):
    - protocol `packages/protocol/lophn-agent/host-queue.ts`
      - 요청 꼴 `HostRequest = {id: Id<"hrq">, kind: "tab_open" | "tab_close", workspace: WorkspaceRef, payload}`. `tab_open` payload는 `{tab: Id<"tab">, target: {session: Id<"ses">} | {browser: {url}}, place: "beside" | "group" | "float" | null, source: Id<"ses"> | null}`, `tab_close` payload는 `{tab}`. 뒤 task가 kind(`tool_call`)와 target(`tui`)을 더한다.
      - shell main용 memory route(actors `user`): `host/take {workspaces: WorkspaceRef[]} → {request: HostRequest | null}`(그 workspace들의 가장 오래된, 빌려 가지 않은 요청 하나를 빌려 준다), `host/done {id, result: "done" | "retry"}`(`retry`면 다시 대기), `host/report {tab, state: {url, title, loading} | "closed"}`.
      - agent용 memory route(actors `agent`): `tabs/open`, `tabs/close`, `browser/read`.
    - 명령: `lophn tab open (--session <ses> | --url <url>) [--place beside|group|float]` → `{tab, status: "accepted"}`. `lophn tab close <tab>` → `{tab, status: "accepted"}`. `lophn browser read <tab>` → `{url, title, loading}`.
    - core 안 port(뒤 task가 쓴다): `HostQueue = {enqueue(request), openTab({opener: Id<"ses"> | null, workspace, target, place, source}) → Id<"tab">, attached(): boolean}`. `attached`는 마지막 `host/take`가 3초 안이면 true다. surf-team이 자식 탭을 열 때, ext-tools가 tool 호출을 넣을 때 쓴다. wiring이 이 port를 `ctx.provide`로 내놓는다.
    - renderer: 열린 탭의 key는 `host:<tab id>`다. IPC는 `shell:surface-request`(main → renderer, `{request, …}`), `shell:surface-ack`(renderer → main), `shell:surface-workspace`(renderer → main, 그 창이 보이는 workspace), `shell:surface-report`(renderer → main, host 탭의 browser 상태와 닫힘).

## 할 일

1. **host queue(core).** `packages/core/host-queue/`에 메모리 queue 하나와 탭 표(`tab → {opener session, workspace, kind}`, browser면 마지막 상태)를 둔다. 꺼지면 사라진다. 시각과 id는 인자로 받는다. harness turn 입력 queue(`run-loop/queue.ts`의 두 번째 instance, `harness/*` route)는 건드리지 않는다. 이름은 "harness queue를 일반화"지만 그 queue는 session별 turn 입력 queue라 요청 종류를 실을 자리가 아니다. 일반화한 것은 "core 메모리 + shell main이 1초마다 take" 꼴이다(planner에게 보고한 것. 답이 다르면 lead가 brief를 고친다).
2. **route(protocol + core wiring).** 위 "내놓는 것"의 route를 `host-queue.ts`에 `defineMemory`로 정의하고, `packages/core/main/daemon/wiring/host-queue.ts`가 handler를 붙인다. agent route는 caller session을 `who.conditions.session`에서 읽는다(입력으로 받지 않는다). 
   - `tabs/open`: `session` target은 같은 workspace의 열린 session만(아니면 `not_found`), `browser` target은 http·https url만(아니면 `invalid_input`). 요청을 넣고 바로 `accepted`를 답한다. 그 session의 탭이 이미 그 창에 있으면 renderer가 새로 열지 않고 done한다.
   - `tabs/close`: 그 탭을 연 session이 아니면 `forbidden`, 없는 탭이면 `not_found`.
   - `browser/read`: 자기가 연 browser 탭만. 아니거나 상태가 아직 없으면 `not_found`.
   - `host/*`는 user 자격만(renderer allowlist에 넣지 않는다. shell main만 부른다).
3. **명령.** `packages/cli/commands/{tab,browser}.ts`에 `tab.open`, `tab.close`, `browser.read`를 `defineCommand`로 만든다(`workspaces: WORKSPACE_KINDS`, `routes`에 위 agent route). `routes`가 agent 자격 상한이 되므로 credentials file은 고치지 않는다. help 글은 "agent가 연 탭은 focus를 뺏지 않는다", "자기가 연 탭만 닫는다", "browser read는 url·title·loading만"을 적는다.
4. **shell main poller.** `packages/shell/main/desktop/wiring/surface.ts`가 core ready 동안 1초마다 `host/take {workspaces}`를 null이 올 때까지 부른다. `workspaces`는 창마다 renderer가 `shell:surface-workspace`로 알려 온 것이다(main은 지금 창 → workspace를 모른다). 요청은 그 workspace를 보이는 창에만 `shell:surface-request`로 보내고, 1.5초 안에 ack가 오면 `done`, 아니면 `retry`. 창을 `show()`·`focus()`하지 않는다(toast `reveal()`과 다르다). host 탭의 browser 상태와 닫힘은 renderer가 `shell:surface-report`로 알리면 main이 `host/report`로 넘긴다. preload는 `surface-api.ts`(`on`/`ack`/`workspace`/`report`)다.
5. **renderer 배치.** `use-surface-requests.ts`가 요청을 받아 연다.
   - source는 그 창에서 `source` session(agent가 연 요청이면 opener)을 보이는 agent 탭이다. 없으면 선택된 desk 끝에 연다.
   - `beside`: source와 split(`openBeside`). `group`: source의 group에 더하고(4칸이 차면 group 바로 뒤 탭), group이 아니면 `beside`와 같다. `float`: `openFloatTab`. null: source 뒤 탭.
   - 모두 `select: false`다. 지금 `openTab`은 select:false면 `after`·`beside`를 버리므로 `desk-model.ts`·`host.openTab`을 고쳐 선택 없이도 자리를 지키게 한다. `openAt()`에 hint를 받는 갈래를 더한다.
   - agent 탭은 `openAgent`에 select·자리 option을 넘길 수 있게 한다(`openSessionTab`이 session·agent 목록을 아직 못 읽었으면 ack하지 않아 `retry`가 된다).
   - browser 탭의 상태 push(`subscribeState` → `webviews.keyOf`)에서 key가 `host:`로 시작하는 탭만 report한다. 사람이 그 탭을 닫으면 `"closed"`를 report한다.
6. 바뀐 이름·route를 문자열로도 grep한다(화면이 resource·method 문자열로 부른다).

## 끝남

- `npm run check`가 통과한다. renderer build(`node packages/shell/renderer/build.ts`)가 된다.
- 위험 test: "다른 session이 연 탭을 `tabs/close`·`browser/read`하면 `forbidden`·`not_found`이다"(core host-queue unit). 배치는 `open-policy_test.ts`·`desk-model_test.ts`에 select:false 자리 유지 한두 개만. 화면 test는 붙이지 않는다.
- 남지 않음: `grep -rn "core-request coding terminal" packages`(`kinds/host.ts`의 옛 주석)가 0줄이다.
- 사람에게 물을 것: 진짜 Electron 창에서 탭이 열리는지 보는 확인. worker는 하지 않고 보고에 "진짜 Electron에서 안 돌림"으로 적는다. lead가 merge 전에 본다.

## 보고

brief-template의 보고 꼴. 등록할 것(`packages/protocol/lophn-agent/{mod,registry}.ts`의 route 목록, `packages/core/main/daemon/assembly.ts`의 `WIRINGS`, core registration의 `memoryRoutes`, `packages/shell/main/desktop/main.ts`의 wiring 줄, `packages/shell/preload/shell.ts`, i18n key)을 적는다.

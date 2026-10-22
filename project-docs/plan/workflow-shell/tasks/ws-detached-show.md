# ws-detached-show

자리를 바꿀 때 떠나는 자리의 detached 창을 닫지 않고 숨기고, 가는 자리의 detached 창을 다시 보이게 하는 main 쪽 IPC를 만든다. project 창이 "이 key들의 창만 보이게 하라"고 한 번 부르면 main이 그 project 창의 detached 창을 숨기거나 보이고, 창이 아직 없는 key를 돌려준다.

- 단위: detached (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/ipc/detached.ts`
  - `packages/shell/preload/detached-api.ts`
  - `packages/shell/main/desktop/detached/ipc.ts`
  - `packages/shell/main/desktop/detached/registry.ts`
  - `packages/shell/main/desktop/detached/ipc_test.ts`
  - `packages/shell/main/desktop/wiring/detached.ts`
  - `tools/wireframes/mock/mock-desktop.tsx`
- 읽을 것:
  - 계획: `project-docs/plan/workflow-shell/README.md`의 "정한 것"(떠난 자리의 detached 창은 닫지 않고 숨긴다. 돌아오면 다시 보인다)
  - architecture: `project-docs/architecture/workspace-layout.md`의 "지키는 것" 중 "project 창 renderer가 detached 항목까지 layout 전체를 갖고 저장한다"(main은 탭 값을 열어 보지 않고 같은 project 창에만 중계하며 보낸 창으로 역할을 가려 `forbidden`으로 막는다), "detached 창의 ×는 dock이다"(숨은 창이 예기치 않게 사라지면 저장된 값으로 `docked`를 보낸다)
  - 코드: `packages/shell/ipc/detached.ts`(채널 상수, `detachedFocusSchema`·`detachedCloseSchema`, `LophnDetachedApi`), `main/desktop/detached/ipc.ts`(`createDetachedIpc`의 `guard`, `focus`, `close`, `open`의 `conflict`), `registry.ts`(`DetachedEntry`, `byParentKey`, `childrenOf`), `main/desktop/wiring/detached.ts`(`live`, `focusWindow`의 `reveal`, `ctx.headless`), `main/desktop/headless.ts`(`reveal`), `preload/detached-api.ts`(`call`), 본보기 test `main/desktop/detached/ipc_test.ts`(`setup()`, `node:test`)
  - skill: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `createDetachedIpc`의 `guard`(role `project`), `DetachedRegistry.childrenOf`, `byParentKey`, wiring의 `live(ref)`, `reveal`(`headless.ts`. 창을 보이며 앞으로 가져온다), `ctx.headless`.
  - 내놓는 것(wiring task가 `window.lophnDetached`로 부른다)
    - 채널 `DETACHED_SHOW_CHANNEL = "shell:detached-show"`
    - 입력 `detachedShowSchema = z.strictObject({ keys: z.array(tabKey).max(20) })`, 호출은 project 창만 한다(detached 창이 보내면 `forbidden`).
    - API `showOnly(input: { keys: string[] }): Promise<{ missing: string[] }>`을 `LophnDetachedApi`에 더한다.
    - 동작: 보낸 project 창의 detached 창 가운데 `keys`에 있는 것은 보이고(focus는 가져오지 않는다), 없는 것은 숨긴다(닫지 않는다. PTY와 앱 view가 그대로 산다). `keys` 가운데 그 project 창에 창이 없는 key는 `missing`에 돌려준다(renderer가 `open`으로 연다). 다른 project 창의 detached 창은 건드리지 않는다.
    - `DetachedEntry`에 `hidden: boolean`을 더한다(처음 만든 창은 false). `focus`와, 이미 창이 있는 key의 `open`(conflict)은 `reveal`이 창을 보이게 하므로 `hidden`을 false로 맞춘다(registry가 사실과 어긋나지 않게).
    - 숨은 창의 `dock-request`·`moved`는 사용자가 못 누르는 창이라 생기지 않는다. 숨은 창이 예기치 않게 사라지면 지금처럼 저장된 값으로 `docked`(transfer 없음)를 보낸다. 그 event를 어느 자리 것으로 받을지는 renderer(ws-wire-state)가 정한다.
    - headless 모드(`ctx.headless.headless`)에서는 창을 보이지 않는다(`reveal`과 같다). 숨기기만 한다.
  - `tools/wireframes/mock/mock-desktop.tsx`의 `fakeDetached`에 `showOnly: (input) => Promise.resolve({ missing: input.keys })`를 더한다(`LophnDetachedApi`를 구현하는 곳이 이것과 preload뿐이다).

## 정한 것

1. **창 하나씩 hide/show가 아니라 "보일 key 목록" 하나로 정한다.** 근거: 자리를 바꿀 때 renderer가 필요한 것은 목록 하나이고, 창마다 부르면 중간에 일부만 바뀐 채 남을 수 있다. 같은 목록으로 다시 불러도 같은 결과다.
2. **창이 없는 key는 `missing`으로 돌려주고 main이 열지 않는다.** 근거: 창을 여는 데는 탭 값과 bounds가 필요한데 그것은 renderer가 가진 layout이다(`open`의 입력). 그리고 `open`을 이미 있는 창에 부르면 conflict와 함께 그 창을 앞으로 가져와 자리를 바꿀 때마다 focus를 뺏는다.
3. **숨기기는 `BrowserWindow.hide()`, 보이기는 focus 없이 `showInactive()`다.** project 창에서 자리를 바꾸는 사람의 focus를 그 창에 둔다.
4. **main 쪽 창 조작은 `DetachedIpc` 의존 하나(`setHidden(ref, hidden)`)로 받는다.** 근거: 이 file은 Electron을 모르게 둔다(`ipc.ts` 머리 주석, `closeWindow`·`focusWindow`와 같은 방식). 창 조작은 wiring이 한다.

## 할 일

지금: `ipc.ts`는 채널 여덟 개를 `createDetachedIpc`가 만들고, 창 조작은 `openWindow`·`closeWindow`·`focusWindow` 등 인자로 받는다. registry 항목에는 창이 보이는지 여부가 없다.

1. `ipc/detached.ts`
   - `DETACHED_SHOW_CHANNEL`을 "project 창 → main" 묶음에 더하고 `detachedShowSchema`를 만든다(`tabKey`는 이 file의 `tabKey`).
   - `LophnDetachedApi`의 "project 창" 묶음에 `showOnly`를 더한다. 주석: 입력 목록의 창만 보이고 나머지는 숨긴다. 없는 key는 `missing`.
2. `registry.ts`: `DetachedEntry`에 `hidden: boolean`을 더한다("떠난 자리라 숨긴 창"). `setHidden(ref, hidden)` 메서드를 `setTab`처럼 더한다.
3. `ipc.ts`
   - `DetachedIpcDeps`에 `setHidden(ref: string, hidden: boolean): void`를 더한다.
   - `open`의 `entries.add`에 `hidden: false`를 넣는다. 이미 창이 있는 key의 conflict 갈래(`focusWindow(existing.ref)` 뒤)와 `focus` 핸들러가 `entries.setHidden(ref, false)`도 부른다(`reveal`이 창을 보이므로).
   - `showOnly` 핸들러를 만든다: `guard(event, detachedShowSchema, input, "project")` → `entries.childrenOf(sender.ref)`를 돌며 `hidden = !keys.has(entry.key)`가 지금 값과 다를 때만 `deps.setHidden(entry.ref, hidden)`과 `entries.setHidden`을 부른다 → `missing = keys.filter(key => entries.byParentKey(sender.ref, key) === undefined)`를 `{ ok: true, value: { missing } }`로 돌려준다. 반환 배열 끝의 `[DETACHED_SHOW_CHANNEL, showOnly]`도 더한다.
4. `wiring/detached.ts`: `createDetachedIpc`에 `setHidden`을 넘긴다. `live(ref)`가 없으면 아무것도 안 한다. hidden이면 `window.hide()`, 아니면 `ctx.headless.headless`가 아닐 때만 `window.showInactive()`다.
5. `preload/detached-api.ts`: `showOnly`를 `call<{ missing: string[] }>(transport, DETACHED_SHOW_CHANNEL, input)`로 더한다.
6. `tools/wireframes/mock/mock-desktop.tsx`의 `fakeDetached`에 계약대로 `showOnly`를 더한다.
7. `ipc_test.ts`: `setup()`의 `createDetachedIpc` 인자에 `setHidden`을 더해 ref별 숨김 상태를 map에 적게 한다(마지막 상태만 본다. 호출 횟수를 세지 않는다). 위험 test 한 개를 더한다(아래 "끝남").

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "`showOnly`는 보낸 project 창의 detached 창만 숨기고 보이며 다른 project 창의 것은 건드리지 않고, detached 창이 보내면 `forbidden`이고, 창이 없는 key는 `missing`이다."
  - `ipc_test.ts`에 `test` 한 개. 준비: project 창 둘(`project-1`, `project-2`)과 각각의 detached 창(project-1에 두 개, project-2에 한 개)을 `open`으로 만든다. project-1이 `showOnly`로 한 창의 key와 없는 key를 보낸다. 판정: 한 창은 숨김이 아니고 다른 창은 숨김, project-2의 창은 처음 상태 그대로, `missing`이 없는 key, detached 창이 같은 호출을 하면 `forbidden`이고 상태 그대로.
  - 근거: 권한·창 소유 경계다(`write-test` "권한, secret, sandbox 경계"). 다른 project 창의 detached 창을 숨길 수 있으면 사람의 탭이 보이지 않게 된다. 화면과 Electron은 test하지 않는다.
- 남지 않음: `grep -rn "LophnDetachedApi" packages tools`에서 `showOnly`를 구현하지 않은 곳이 0곳이다(type check가 잡는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 예상
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 최소화된 창이 `showInactive()`로 펴지는지 등 실제 Electron에서 확인하지 못한 것을 적는다.

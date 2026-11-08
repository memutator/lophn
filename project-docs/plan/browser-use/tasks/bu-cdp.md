# bu-cdp

shell main이 `browser_call`을 받아 그 탭의 guest(`<webview>`)나 preview 앱 view에 Electron `webContents.debugger`로 붙어 실행한다. accessibility snapshot과 ref, CDP `Input.*`, screenshot, evaluate, console, wait, dialog 자동 닫기, focus emulation을 하고, DevTools가 열려 있으면 `conflict`다. 사람이 탭을 가져오는 take control을 탭 머리와 main에 둔다.

- 단위: bu-cdp (wave 3)
- 선행: bu-call. 그 task가 낸 `BrowserDriver` port와 `browser_call` 꼴을 채운다.
- 소유(이 task만 고친다):
  - `packages/shell/main/browser/agent/`
  - `packages/shell/main/browser/{devtools,browser-ipc}.ts`(DevTools 열림을 driver가 알게 하는 곳만)
  - `packages/shell/ipc/surface.ts`, `packages/shell/preload/surface-api.ts`
  - `packages/shell/main/desktop/wiring/surface.ts`
  - `packages/shell/renderer/workspace/use-surface-requests.ts`
  - `packages/shell/renderer/browser/{browser-chrome.tsx,browser-tab.tsx,browser-tab.module.css}`
  - `packages/shell/renderer/workspace/{app-preview-tab.tsx,app-preview-tab.module.css}`(take control 줄만)
  - `packages/design/i18n/catalog/browser.ts`
  - `tools/wireframes/pages/screens/browser/`
- 읽을 것:
  - 계획: `project-docs/plan/browser-use/README.md`, `project-docs/plan/browser-use/tasks/bu-call.md`("고정한 꼴" 전체가 이 task의 계약), `project-docs/products/roadmap/browser-use.md`("무엇을 만드나" 3·4, "정한 것" 3·5·6·11·12)
  - architecture: `project-docs/architecture/{browser-tab,workspace-layout}.md`
  - 비교(구현 참고): `../harness-lab/_report/browser-use/`의 `gooey-pi.md` §3·§5·§7(`sendInputEvent`는 webview guest에 닿지 않는다, CDP Input), `paseo.md` §3·§7(dialog), `t3code.md` §3·§6·§7(focus emulation, take control, `preview_act`)
  - 본보기: `packages/shell/main/browser/registry.ts`(guest `wv-<id>`, `webContents.fromId`), `packages/shell/main/browser/navigation.ts`(main frame 이동 규칙), `packages/shell/main/app-frame/registry.ts`(앱 view의 webContents)
  - skill: `ui-design`, `write-test`, `run`
- 계약:
  - 쓰는 것: `packages/protocol/lophn-agent/host-queue.ts`의 `browser_call`·`BrowserAction`·`hostToolOutputSchema`, `packages/shell/main/browser/agent/driver.ts`의 `BrowserDriver`(꼴은 고정. 바꿀 것은 보고에 요청)
  - 내놓는 것:
    - `surfaceReportSchema`에 `{ bind: { tab: TabId, view_session: string } }`를 더한다. renderer가 host 탭(browser, preview)의 view session을 알 때와 바뀔 때 알린다. 닫힘은 지금 `state: "closed"`가 푼다.
    - take control IPC(`surface.ts`의 새 channel): main → renderer `{tab, agent: boolean, held: boolean}` push, renderer → main `take(tab)`·`release(tab)`.

## 할 일

1. 탭 → webContents: main이 `bind`로 `tab → view_session`을 들고, browser는 browser registry, preview는 앱 view registry에서 webContents를 찾는다. 짝이 없거나 webContents가 부서졌으면 `unavailable`("the tab is not open in a window"). `view`(browser|preview)와 찾은 view의 종류가 다르면 `unavailable`. 앱 live view(`mode: "live"`)는 어떤 경우에도 고르지 않는다.
2. debugger: 그 탭의 첫 호출에서 `webContents.debugger.attach("1.3")`하고 탭이 닫힐 때까지 둔다. 붙을 때 `Page`·`Runtime`·`Log`·`DOM`·`Accessibility`를 켜고 `Emulation.setFocusEmulationEnabled({enabled: true})`를 건다. DevTools가 열려 있으면 붙지 않고 `conflict`("DevTools is open on this tab")다. 붙은 뒤 사람이 DevTools를 열면 detach하고 그 동안의 호출은 `conflict`다. 앞서 붙은 다른 debugger 때문에 attach가 실패해도 `conflict`다.
3. snapshot과 ref: `Accessibility.getFullAXTree`로 의미 있는 node(이름이나 역할이 있는 것, 무시된 node 제외)를 `- <role> "<name>" [ref=eN]` 줄로 쓴다. 상한 60_000자. ref 번호는 탭마다 늘어나는 하나의 counter에서 나온다(snapshot 1이 e1~e40이면 snapshot 2는 e41부터). 탭은 마지막 snapshot의 `ref → backendDOMNodeId`만 든다. main frame이 이동하면 비운다. 표에 없는 ref는 `conflict`("stale ref eN: run browser snapshot again")다. 그래서 옛 ref가 새 node를 잘못 가리키지 않는다.
4. act: 대상 node를 `DOM.scrollIntoViewIfNeeded` 뒤 `DOM.getBoxModel` 가운데를 `Input.dispatchMouseEvent`로 누른다(click·hover). type은 focus 뒤 `Input.insertText`, fill은 focus·전체 선택·지우기 뒤 `Input.insertText`, press는 `Input.dispatchKeyEvent`(`Control+a`꼴 조합), select는 그 `<select>`에 `Runtime.callFunctionOn`으로 값을 고르고 `input`·`change`를 보낸다, scroll은 ref면 보이게 하고 아니면 `Input.dispatchMouseEvent` `mouseWheel`의 dy. `sendInputEvent`는 쓰지 않는다(webview guest에 닿지 않는다).
5. navigate: browser 탭만(preview는 `invalid_input`). `navigation.ts`의 main frame 규칙(http(s)·`about:blank`)을 그대로 쓰고 load가 끝나거나 기한까지 기다린다.
6. screenshot은 `Page.captureScreenshot`(png, 보이는 영역). 뒤에 숨은 탭에서도 되는지 진짜 Electron에서 본다. evaluate는 `Runtime.evaluate({returnByValue: true, awaitPromise: true, timeout})`. logs는 attach 뒤 `Runtime.consoleAPICalled`·`Runtime.exceptionThrown`·`Log.entryAdded`를 탭마다 최근 200줄 ring에 담는다. wait는 200ms마다 url이나 `document.body.innerText`를 보다 `timeout_ms`가 지나면 `unavailable`.
7. dialog: `Page.javascriptDialogOpening`이면 바로 `Page.handleJavaScriptDialog`(alert·beforeunload는 accept, confirm·prompt는 dismiss)하고 그 호출의 결과에 `dialog: {type, message}`를 싣는다. agent가 다루지 않는 동안 뜬 dialog도 붙어 있으면 같이 닫는다.
8. take control:
   - agent가 그 탭을 다루는 동안(첫 호출부터 탭이 닫히거나 사람이 가져올 때까지) browser 탭 머리와 preview 탭 안내 줄 옆에 "agent 조작 중"과 [가져오기]를 둔다.
   - 사람이 가져오면 그 탭의 agent 쓰기(act, navigate, evaluate)는 `conflict`("the person took control of this tab")이고 읽기(snapshot, screenshot, logs, wait, read)는 된다. [돌려주기]로 푼다.
   - 상태는 shell main 메모리에 탭마다 둔다. core는 모른다.
   - gallery `tools/wireframes/pages/screens/browser/`에 두 상태를 더하고 renderer가 같은 component를 쓴다.
9. driver의 `unavailable("browser control is not ready")`를 지운다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(순수 module로 떼어 test한다. Electron·브라우저를 띄우는 test는 만들지 않는다):
  - "새 snapshot 뒤 옛 ref와 main frame 이동 뒤 ref는 `conflict`이고, 옛 ref가 새 node를 가리키지 않는다"
  - "take control 중 act·navigate·evaluate는 `conflict`이고 snapshot·screenshot·logs는 된다"
  - "`bind`가 앱 live view의 view session을 가리켜도 driver는 그 webContents를 고르지 않는다"
- 남지 않음: `grep -rn "browser control is not ready" packages`가 0줄. `grep -rn "sendInputEvent" packages/shell/main/browser/agent`가 0줄.
- (화면) `npm run wireframes`가 되고 gallery의 browser page가 "agent 조작 중"·가져온 상태를 renderer와 같은 component로 그린다.
- 진짜 Electron 확인(보고에 명령과 결과를 붙인다): dev(`npm run dev`, fake provider)로 띄우고 사람 token CLI로 `tab open --url <로컬 test page>` → `browser snapshot` → `act <tab> click --ref …` → `act <tab> fill --ref … --text …` → `screenshot`(file이 열린다) → `evaluate 'document.title'` → `logs` → `alert()`을 부르는 버튼 click이 dialog를 닫고 결과에 적는다 → 그 탭에 DevTools를 열고 `snapshot`이 `conflict` → [가져오기] 뒤 `act`가 `conflict`, `snapshot`은 된다 → 다른 탭으로 가린 뒤 `screenshot`이 된다. preview 탭에도 `snapshot`·`act`를 한 번. 앱 live 화면 탭에는 닿을 길이 없음을 확인한다. 못 돌린 단계는 "확인 못 함"에 적는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 확인 못 함: 진짜 Electron에서 못 본 단계
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

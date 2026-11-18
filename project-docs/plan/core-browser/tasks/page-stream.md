# page-stream

desktop 앱(host) 쪽에서 agent page를 멀리서 보이게 한다: 보는 쪽이 있는 동안 page의 CDP screencast를 켜고 frame을 core로 밀되 core가 읽어 간 만큼만 보내고, 멀리서 온 입력을 page에 넣고, 멀리서 잡기를 지금의 take control에 잇고, 그리지 않는 page를 상태로 알린다. 화면 없는 page host(`page-host`)도 이 module을 그대로 쓴다.

- 단위: page (wave 2)
- 선행: page-contract
- 소유(이 task만 고친다):
  - `packages/shell/main/browser/agent/stream.ts`(새 file), `packages/shell/main/browser/agent/stream_test.ts`(새 file)
  - `packages/shell/main/browser/agent/page.ts`
  - `packages/shell/main/desktop/wiring/surface.ts`
  - `project-docs/flows/areas/shell-workspace.yaml`, `project-docs/flows/tests/shell.yaml`
- 읽을 것:
  - 계획 README "정한 것 › 멀리서 보기"
  - architecture: `project-docs/architecture/browser-tab.md` 37·40·41과 page-contract가 쓴 "멀리서 보기" 절
  - spike: `reports/multi-device/spike-headless-browser.md` 4(b)(screencast, ack, 첫 frame), 5(최소화·숨김이면 frame이 없고 `win.show()`로 돌아온다, Wayland에서 `restore()`는 돌아오지 않는다), 6(10 fps에 core 하나의 약 16%)
  - 본보기: `git show 9e6394f3f^:packages/shell/main/terminal/terminal-view.ts`(host가 보는 동안만 밀기. 지금은 지워진 옛 판), `packages/shell/main/browser/agent/driver.ts`(`attach`, `key`, `charEvents`, `mouse`), `agent/control.ts`, `agent/keys.ts`
- 계약:
  - 쓰는 것: 연결 요청 `page_stream`·`page_read`·`page_input`·`page_control`, host frame `page_frame`·`page_state`, `PageInput`·`PageFrame`(`packages/protocol/lophn-agent/page-view.ts`), `Page` port(`agent/page.ts`), `TabControl`
  - 내놓는 것(`page-host`가 쓴다): `createPageStream(deps)`. deps는 `page(tab): Page | undefined`, `control: TabControl`, `send(frame)`(host-link `send`), `nowMs()`, `schedule(run, ms): cancel`. 돌려주는 것은 네 요청의 handler(`stream`, `read`, `input`, `control`. 결과는 `HostToolOutput`)와 `controlChanged(tab, state)`, `blank(tab)`, `wake(tab)`, `forget(tab)`, `reset()`.

시작 전에 다시 볼 것(lead가 2026-11-18 main 0.23.84에 대 보았다): `core-terminals`가 land되어 `surface.ts`에는 터미널·coding·tool 줄이 없고 host link 요청은 `tab_open|tab_close|tab_show|browser_call`만 단다. shell host link(`packages/shell/main/desktop/core/host-link.ts`)의 `onRequest`·`onOpen`·`send`는 그대로다. 터미널을 host가 밀던 본보기는 지워져 옛 판을 읽는다("읽을 것"). `core-setup`이 아직 열려 있다.

## 할 일

1. `page.ts`: `DebuggerOwner`에 `"stream"`을 더한다. webContents 하나에 debugger 하나라 driver·emulation과 같이 쓴다(`electron-page.ts`의 owner 세기는 그대로 맞는다).
2. `stream.ts`(Electron을 import하지 않는다):
   - `stream {tab, on:true}`: page가 없으면 `not_found`(고정 문장). `attach("stream")`, `Page.enable`, `Page.startScreencast {format: "jpeg", quality: 60, maxWidth: 1280, maxHeight: 800}`. 켜자마자 `page_state`를 보낸다. `on:false`면 `Page.stopScreencast`, `detach("stream")`, 그 탭의 상태를 지운다.
   - `Page.screencastFrame`: `page_frame {tab, seq, frame: {media_type: "image/jpeg", data_base64: data, width: metadata.deviceWidth, height: metadata.deviceHeight}}`(CSS px, 반올림). seq는 탭마다 이 process가 사는 동안 오른다. back-pressure: core가 앞 frame을 읽었다고(`page_read`의 seq ≥ 보낸 seq) 알리기 전에는 보내지 않고 마지막 frame 하나만 들고 있는다. CDP `Page.screencastFrameAck`는 받을 때가 아니라 core로 보낼 때 보낸다(들고 있는 동안 받은 frame의 ack도 모아 같이 보낸다. 빠뜨리면 Chromium의 in-flight가 차서 stream이 선다). 보내기는 앞 보내기에서 100 ms(`FRAME_MIN_MS`, 10 fps) 뒤에만 한다. 그래서 느린 보는 쪽에서는 Chromium이 다음 frame을 만들지 않는다.
   - painting: 켠 뒤나 `wake` 뒤 2초(`PAINT_WAIT_MS`) 안에 frame이 없으면 false, frame이 오면 true. 바뀔 때 `page_state`를 보낸다. `blank(tab)`은 바로 false, `wake(tab)`은 screencast를 껐다 켜서 첫 frame을 다시 받는다(spike: screencast는 켤 때 첫 frame을 낸다).
   - `input {tab, input}`: 켜지 않은 탭이면 `conflict`. pointer는 `Input.dispatchMouseEvent`(down `mousePressed`, move `mouseMoved`, up `mouseReleased`, 왼쪽 단추, clickCount 1), scroll은 `mouseWheel`, text는 글자마다 driver의 `charEvents`와 같은 keyDown·keyUp, key는 `parseKey`(`keys.ts`, 모르면 `invalid_input`)로 driver의 `key`와 같은 순서, navigate는 `decideNavigation`(`../navigation.ts`)을 지난 뒤 `Page.navigate`, back은 `Page.getNavigationHistory`의 앞 항목으로 `Page.navigateToHistoryEntry`, reload는 `Page.reload`. 사람의 입력이라 take control을 보지 않는다(지금 사람의 손 입력과 같다).
   - `control {tab, held}`: `control.take(tab)`·`release(tab)`. agent가 다룬 적 없는 탭은 그대로다(`control.ts`의 규칙).
   - `controlChanged`: 켠 탭이면 `page_state`를 보낸다. `forget`: 탭이 닫혔다. `reset`: 연결이 다시 열렸다(core가 살아 있는 lease마다 다시 켠다). 모든 screencast를 끄고 상태를 지운다.
3. `surface.ts`:
   - `createPageStream`을 만든다. page는 `bound`의 view session으로 `pageOf(lookup, "browser", …)`를 찾는다(host browser 탭만. preview·artifact는 범위 밖). `send`는 `ctx.hostLink.send`.
   - `createTabControl`의 push에서 지금의 `pushControl` 뒤에 `stream.controlChanged`를 부른다. 창이 잡혀 있음을 보이는 길은 지금 그대로다(`AgentControlBar`). 그 기계의 사람은 [Hand back]으로 멀리서 잡은 것도 푼다.
   - 네 요청을 `ctx.hostLink.onRequest`로 단다. `ctx.hostLink.onOpen`에서 `reset`.
   - `ctx.windowHooks.created`에서 창의 `minimize`·`hide`에 그 창에 bind된 탭마다 `blank`, `restore`·`show`에 `wake`를 부른다. 탭을 잊는 곳(`forgetTab`, 창 닫힘, report closed)에서 `forget`.
4. flows(`flows` skill): `shell-workspace.yaml`에 host 쪽 flow 하나(`system:` entry, outcome: 켬, 읽기를 기다림, 그리지 않음, 입력, 잡기)를 쓰고 `browser-tab-control`의 steps에 멀리서 잡기를 더한다. 새 test를 `tests/shell.yaml`에 적는다.

정한 것:
- 그리지 않음은 "켠 뒤 2초 안에 frame이 없다"와 창의 최소화·숨김 event 둘로 안다: Wayland에서 `restore()` 뒤 창은 보인다고 답하면서 그리지 않는 것을 spike가 봤다. 창 상태만 믿지 않는다.
- 멀리서의 입력은 잡지 않아도 들어간다: 그 기계 사람의 손 입력이 지금 그렇다. 잡기는 agent를 멈추는 단추다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`stream_test.ts`, 가짜 `Page`. browser·Electron을 띄우지 않는다. 띄우고 싶으면 먼저 사람에게 묻는다): "멀리서 잡은 동안(`page_control {held:true}`) agent의 act·navigate·evaluate가 `conflict`이고 놓으면 다시 된다". 실제 `createTabControl`과 `createBrowserDriver`를 가짜 page로 이어 요청부터 driver까지 본다.
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

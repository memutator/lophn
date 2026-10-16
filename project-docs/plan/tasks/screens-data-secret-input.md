# screens-data-secret-input

옛 확인 창(별도 modal)을 통째로 지우고 secret 보호 입력 창 하나만 남긴다. 앱 secret, provider key, MCP server credential의 값을 받는 작은 창이다. 값은 보호 입력칸에서 shell main을 거쳐 core의 `secrets/put` upload로만 가고, renderer 상태와 대화에 남지 않는다. approval은 대기 목록 카드(screens-data-waiting)가, 그 밖의 사람 결정은 각 화면 안이 받으므로 확인 창의 다른 kind는 모두 없어진다. 폴더와 entry 이름은 `confirmation`에서 `secret-input`으로 바꾼다.

- 단위: screens-data (wave 3)
- 선행: 없음 (contract-shell이 보호 입력 IPC를, contract-platform이 `secrets/put` route를 고정했다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/confirmation/` (지운다) → `packages/shell/renderer/secret-input/` (새로)
  - `packages/shell/main/confirmation/` (지운다) → `packages/shell/main/secret-input/` (새로)
  - `packages/shell/main/desktop/wiring/confirmation.ts` (shell-wiring이 쪼갠 file. 지우고 `wiring/secret-input.ts`로 바꾼다. screens-data 몫이다)
  - `packages/shell/renderer/build.ts`, `packages/shell/main/build.ts`의 보호 창 entry와 preload 번들 줄(추가 소유, lead 승인 2026-10-16: 어느 단위에도 적혀 있지 않은 file이다. ui-chrome-components가 `renderer/build.ts`에 svg loader 한 줄을 더하므로 그 줄은 건드리지 않는다)
  - `tools/wireframes/frames/compositions/waiting/secret-input.tsx`, `waiting.module.css`의 secret 규칙
  - `packages/design/wording/catalog/data.ts`와 `catalog/data.placeholders.ts` (wording-split이 만든 영역 file. 추가 소유, lead 승인 2026-10-16)
- 읽을 것:
  - inventory(lead가 맞추며 더함): `U1.1#6`
  - spec: S2 8장(approval 밖의 사람 결정, secret 값 입력은 renderer 밖이 띄우는 보호 입력에서만) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - inventory: `I1.9#1`, `I2.9#4`, `U1.1#5`, `U2.1#5`, `U2.2#11`(session rewind 화면은 확인 창에서 대화 안 panel로 바뀐다. 이 task는 옛 `kinds/rewind`를 지우는 쪽이고, 새 panel은 screens-conversation-sessions가 짓는다)
  - inventory(참고, 다른 단위 몫): `I1.9#3`(질문 묶음을 확인 창 없이 접수하는 길 — platform 줄이지만 그 file `main/confirmation/windowless-confirmation.ts`가 이 폴더에 있어 이 task가 지운다. `main.ts`의 등록 줄은 `wiring/confirmation.ts`에 있으므로 같이 걷힌다), `U5#4`, `I6#21`
  - 결정: `../README.md` 3장 #9(secret 파일은 core가 직접 읽고 쓴다)
  - 계약 file(읽는다): `packages/shell/ipc/secret-input.ts`(`SECRET_INPUT_OPEN_CHANNEL`, `secretInputOpenSchema {name, purpose: "app" | "provider" | "mcp", subject}`, 보호 창 채널 `SECRET_INPUT_DISPLAY_CHANNEL`·`SECRET_INPUT_SUBMIT_CHANNEL`·`SECRET_INPUT_CANCEL_CHANNEL`), `packages/shell/preload/secret-input.ts`(보호 창 `lophnSecretInput`), `preload/secret-input-open.ts`(일반 창의 `openSecretInput`), `packages/protocol/secrets/secret-file.ts`(`secretPut`: `defineUpload`, `secrets/put`, 입력 `{name, bytes}`, 본문은 값의 byte, `SECRET_INPUT_MAX_BYTES`)
  - 지금 코드(옮기거나 지운다): `renderer/confirmation/{main.tsx, entry.tsx, entry.module.css, index.html, screen.tsx, display.ts, frame/, layout/, before-after/, details/, kinds/}`, `main/confirmation/{coordinator, handle, canonical, check, decide, choice, submit, types, window, ipc, windowless-confirmation}.ts`, `main/confirmation/kinds/*`, `renderer/confirmation/kinds/secret-input/secret-input.tsx`
  - 본보기(화면): `tools/wireframes/frames/compositions/waiting/secret-input.tsx`(82줄: 앱 secret, provider key, MCP credential 세 가지. 값은 점으로만 보인다)
- 계약:
  - 쓰는 것: 위 계약 file. 채널 이름과 payload는 그대로 따른다.
  - 내놓는 것:
    - renderer: 보호 창 화면 `SecretInputApp`(`renderer/secret-input/main.tsx`)과 component `SecretInput({ purpose: "app" | "provider" | "mcp", subject, name, configured })`(gallery가 쓴다)
    - main: `registerSecretInput(ctx)`(`wiring/secret-input.ts`)가 `SECRET_INPUT_OPEN_CHANNEL` handler와 보호 창 채널 handler를 등록한다. 일반 창이 `openSecretInput({name, purpose, subject})`를 부르면 요청한 창의 child modal이 뜨고, 제출 뒤 `stored | cancelled`를 돌려준다.

## 할 일

1. renderer를 새 폴더로 옮겨 줄인다.
   - 만든다: `renderer/secret-input/` 에 `entry.tsx`, `main.tsx`(`SecretInputApp`: 보호 preload의 `lophnSecretInput.getDisplay()`로 `{name, purpose, subject, configured}`를 읽어 그린다), `entry.module.css`, `index.html`, `secret-input.tsx`. `secret-input.tsx`는 wireframe의 `SecretInput`을 옮긴다(제목 "Enter provider key / MCP server credential / app secret", "Provider: OpenAI" 줄(`subject`), `Field`+`Input type=password`, 도움말 "값은 lophn으로 바로 가고 앱이나 대화에 보이지 않는다. 이름과 설정 여부만 남는다", [Cancel]·[Save]). 이미 설정된 이름이면 "Already set. Saving replaces the value."를 보인다. 값은 칸에서 main으로 한 번 가고 화면 상태에 남기지 않는다(보내기 전에 칸을 비운다). [Save]·[Cancel] 단추는 오른쪽 끝이고 주 행동이 맨 오른쪽이다. 근거: `U1.1#5`, `U2.1#5`.
   - 지운다: `renderer/confirmation/` 전체(`kinds/`의 approval, automation, confirm-command, connection-revoke, grant, option-action, owner-decision, problem-decision, release-activation, rewind, secret-input, `before-after/`, `details/`, `display.ts`, `layout/`, `frame/`, `screen.tsx`).
2. main을 새 폴더로 옮겨 줄인다.
   - 만든다: `main/secret-input/window.ts`(요청한 창의 child modal 보호 창. 지금 `main/confirmation/window.ts`에서 옮기고 줄인다. 앱·문서 native view의 입력을 막는 기존 동작과 `lophn-shell://secret-input/index.html`만 연다는 partition 규칙은 그대로다), `main/secret-input/ipc.ts`(`SECRET_INPUT_OPEN_CHANNEL`은 일반 shell 창만, display·submit·cancel은 그 보호 창만 부른다. 부모는 IPC를 보낸 창이다. 이미 열린 보호 창이 있으면 `conflict`), `main/secret-input/submit.ts`(제출: 값을 UTF-8 byte로 만들어 core `secrets/put` upload로 올리고 끝나면 byte를 0으로 덮는다. 결과는 `{ ok: true }` 또는 고정 오류 `invalid_input | unavailable`만. 값, core 오류 원문, OS 오류 원문은 log·오류·IPC 결과 어디에도 넣지 않는다).
   - 지운다: `main/confirmation/` 전체(`coordinator.ts`, `handle.ts`, `canonical.ts`, `check.ts`, `decide.ts`, `choice.ts`, `submit.ts`, `types.ts`, `ipc.ts`, `window.ts`, `windowless-confirmation.ts`, `kinds/*`). 교체 확인 binding, OAuth code 붙여넣기 입력, provider 끊기 확인은 새 모양에 없다. 단 사람 결정 handle 발급(`handle.ts`, `canonical.ts`, `decide.ts`의 발급 부분)은 지우지 않는다. S2 8장대로 확인 창 없이 contract-approvals가 고정한 결정 handle IPC로 발급하게 `main/secret-input/` 옆 `main/decision-handle/`로 옮긴다(끊기는 Settings › Providers 화면의 `Dialog`가 묻는다. screens-agents-settings 몫).
   - provider 연결·앱 secret 쓰기의 command(`providers.register`, `secrets.set`)는 이 창이 보내지 않는다. 호출한 화면이 `stored`를 받은 뒤에 그 이름을 가리키는 command를 보낸다. 근거: `I2.9#4`, `I1.9#1`.
3. `wiring/confirmation.ts`를 `wiring/secret-input.ts`로 바꾼다. 확인 창 `createCoordinator`·`createKinds`·`registerConfirmationIpc`·`confirmationHost`·`confirmWithoutWindow`·`WINDOWLESS_CONFIRMATION_CHANNEL` 등록을 걷고 `registerSecretInput(ctx)` 하나로 대신한다. `main.ts`의 조립 목록(lead 소유)에서 `confirmation` 한 줄을 `secret-input`으로 바꾸는 것은 보고의 등록할 것이다. `main/build.ts`의 preload 번들에는 `preload/secret-input.ts`(`preload-secret-input`)를 더하고 `preload/confirmation.ts`를 걷는다. `renderer/build.ts`의 entry 목록 두 곳에서 `confirmation`을 `secret-input`으로 바꾼다.
4. wording을 옮긴다. `confirmation-window.secret*`, `confirmation-window.label.secret-*`, `confirmation-window.button.save`·`cancel`을 영역 `secret-input`의 key로 옮겨 `catalog/data.ts`에 쓴다(`secret-input.title.app`·`provider`·`mcp`, `secret-input.label.*`, `secret-input.help.*`, `secret-input.button.*`). `confirmation-window.*`의 나머지 key(approval, grant, release-activation, confirm, automation, account, rewind, secret-disconnect 등)는 쓰는 곳이 없어지므로 지운다. `generate.ts`를 돌려 `catalog/data.placeholders.ts`를 갱신한다. 근거: `U1.1#5`.
5. gallery: `waiting/secret-input.tsx`는 지우고, `waiting-pages.tsx`의 `SecretInputProvider`·`SecretInputApp`·`SecretInputMcp`가 renderer `SecretInput`을 `purpose`·`configured`·채운 값만 바꿔 그리게 한다.
6. (lead가 맞추며 더함 (`U1.1#6`)) 확인 창 wording. 확인 창 renderer를 지울 때 그 key도 지운다
7. (lead가 맞추며 더함) S2 8장: 사람 결정 handle 발급을 창 없이 남긴다. contract-approvals의 결정 handle IPC handler를 shell main에 두고, 기능 화면(문제, 앱 rewind, 파일 지움, provider 연결, 질문 선택지)이 그 IPC로 handle을 받아 route를 부르게 한다. 위험 test: "화면을 누르지 않은 결정 요청은 handle을 받지 못한다".

## 끝남

- `deno task check`가 통과한다. (shell main은 `packages/shell/main`의 check script도 본다.)
- 위험 test: "secret 제출이 실패해도 오류와 IPC 결과에 입력한 값이 들어 있지 않고, 올린 byte 배열은 끝난 뒤 0으로 덮인다" — `main/secret-input/submit_test.ts`(가짜 core 통로, 실패 code 표 하나).
- 남지 않음: `grep -rn "confirmation-window\.\|createCoordinator\|confirmWithoutWindow\|packages/shell/main/confirmation\|renderer/confirmation" packages tools`가 0줄이다. 옛 `ipc/confirmation*.ts`·`preload/confirmation*.ts` 이름 자체는 contract 단위 file이므로 이 grep 밖이다.
- (화면) `deno task wireframes`가 되고, gallery의 `new-secret-input`, `new-secret-input-app`, `new-secret-input-mcp`가 옮긴 component로 그려진다.

## 보고

- 바꾼 file
- 등록할 것: `main.ts`의 조립 목록에서 `confirmation` → `secret-input` 한 줄(lead). `ownership.md`의 `packages/shell/renderer/confirmation/`·`packages/shell/main/confirmation/`를 `secret-input/`로 옮기는 것, `renderer/build.ts`·`main/build.ts`를 이 task에 준 것. `catalog/data.ts`의 새 key와 지운 key(`confirmation-window.*`).
- 안 쓰게 된 export: `packages/shell/ipc/confirmation.ts`, `ipc/confirmation-channels.ts`, `ipc/windowless-confirmation.ts`, `preload/confirmation.ts`·`confirmation-open.ts`·`confirmation-ended.ts`, `protocol/shell/confirmation.ts`(contract 단위 file이라 지우지 않는다. cleanup이 지운다), `things-to-confirm` 쪽이 쓰던 확인 창 열기
- 정한 것: 폴더 이름을 `confirmation`에서 `secret-input`으로 바꾼 것(contract-shell이 새 채널과 preload 이름을 `secret-input`으로 고정했고 확인 창의 의미가 사라졌다). `I1.9#3`(windowless-confirmation)은 platform 줄이나 file이 이 폴더 안이라 여기서 지웠다. OAuth code 붙여넣기는 contract-shell이 이 창에서 뺀 대로 받지 않는다.
- 계약 바꾸기 요청(wave 3): 보호 입력 IPC나 `secrets/put`에 모자란 칸이 있으면 여기 적는다

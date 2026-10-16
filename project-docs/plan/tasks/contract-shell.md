# contract-shell

다른 계약 단위가 갖지 않은 shell IPC와 preload를 새 모양으로 고정한다. 셋이 핵심이다. (1) 편집기의 file 읽고 쓰기를 shell main이 직접 하는 IPC, (2) secret 보호 입력 창의 IPC, (3) 폴더·overlay 같은 기존 IPC의 바뀌는 부분. 구현(main 쪽 handler, renderer 쪽 사용)은 하지 않는다. type, schema, channel 이름, API interface, 얇은 preload bridge만 둔다. 옛 IPC는 지우지 않고 옆에 새것을 더한다.

- 단위: contract-shell (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/ipc/files.ts` (새 file)
  - `packages/shell/ipc/secret-input.ts` (새 file)
  - `packages/shell/ipc/folder-picker.ts`
  - `packages/shell/ipc/overlay.ts`
  - `packages/shell/preload/files-api.ts` (새 file)
  - `packages/shell/preload/secret-input.ts` (새 file, 보호 창 전용 preload)
  - `packages/shell/preload/secret-input-open.ts` (새 file, 일반 창에서 보호 창 열기)
  - `packages/shell/preload/folder-api.ts` (새 file)
  - `packages/shell/preload/shell.ts` (새 API 노출 줄만 더한다)
- 읽을 것:
  - spec: 없음(IPC는 spec이 아니라 이 brief가 정한다). 근거는 아래 inventory와 결정이다.
  - inventory: `I1.6#25`, `I1.9#2`, `U3.5#3`
    - 근거로 같이 볼 줄(다른 단위 몫): `I2.10#8`, `I2.10#16`, `I2.10#17`, `U2.3#6`, `U2.3#7`, `U2.3#10`, `U2.3#11`, `U2.3#12`, `U3.3#6`, `U3.3#7`(편집기), `I2.9#4`, `U2.1#5`(secret 보호 입력), `U2.1#4`(overlay notification), `I2.9#5`
  - 결정: `../README.md` 3장 #93(편집기의 파일 읽고 쓰기는 shell main이 직접 한다. 충돌은 내용 hash로 안다), `../../tmp/inventory/00-decisions.md`의 94(밖에서 바뀐 파일은 watch해 다시 읽고, 편집 중이면 충돌을 알리고 고르게 한다)
  - 본보기(화면): `tools/wireframes/frames/compositions/project-files/notices.tsx`(밖에서 바뀜·충돌 toast), `project-files/pages.tsx`(Rename·Delete 메뉴와 지우기 확인 modal), `project-files/viewers.tsx`(이미지·pdf 보기)
  - 지금 코드: `packages/shell/ipc/editor.ts`(옛 편집기 IPC), `ipc/confirmation.ts`·`ipc/confirmation-channels.ts`·`preload/confirmation*.ts`(옛 보호 창), `ipc/folder-picker.ts`, `ipc/overlay.ts`, `preload/shell.ts`
- 계약:
  - 쓰는 것: `packages/protocol/secrets/secret-file.ts`의 `secretPut`(contract-platform, 보호 입력 창이 값을 보내는 core route 이름과 `SECRET_INPUT_MAX_BYTES`)
  - 내놓는 것: 아래 channel 이름, schema, API interface. screens-project(편집기·tree), screens-data(보호 입력 창), screens-workspace(폴더 고르기), platform-desktop(shell main handler)이 이 모양으로 짓는다.

## 할 일

이 file들은 main·preload·renderer가 함께 부르므로 지금 `ipc/*.ts`처럼 zod 말고는 import하지 않는다.

### 1. 파일 IPC (`ipc/files.ts`) — #93, `U2.3#6`, `U2.3#7`, `U2.3#10~#12`, `U3.3#6`, `U3.3#7`

경로 하나가 문서다. 문서 id, 판, base hash 기준 version 준비, working copy, tracking은 없다. renderer는 절대 경로 문자열만 보내고, 읽기·쓰기·watch는 shell main이 디스크에서 직접 한다(core `files.*` route를 거치지 않는다).

channel(모두 renderer → main invoke. `FILE_CHANGED`와 `FILE_CLOSE_REQUEST`만 main → renderer):

| 이름 | channel | 입력 | 성공 값 |
|---|---|---|---|
| `FILE_LIST_CHANNEL` | `shell:file-list` | `{ path }` 폴더 | `{ entries: { name, kind: "file" \| "folder" }[] }` (한 단계, 이름순) |
| `FILE_READ_CHANNEL` | `shell:file-read` | `{ path }` | `{ text, hash }` — UTF-8 글. `FILE_TEXT_MAX_BYTES`(8MiB)를 넘으면 `too_large`, 글이 아니면 `unsupported` |
| `FILE_READ_BYTES_CHANNEL` | `shell:file-read-bytes` | `{ path }` | `{ bytes: Uint8Array, content_type }` — 이미지·pdf 보기용. `FILE_VIEW_MAX_BYTES`(64MiB) 상한. content type은 main이 확장자로 정한다 |
| `FILE_WRITE_CHANNEL` | `shell:file-write` | `{ path, base_hash: hash \| null, text }` | `{ hash }` — `base_hash`가 지금 디스크 내용의 hash와 다르면 `conflict`(디스크는 그대로). `null`이면 새 파일이고 이미 있으면 `conflict`. 임시 파일에 쓰고 rename한다 |
| `FILE_RENAME_CHANNEL` | `shell:file-rename` | `{ from, to }` | `{}` — `to`가 이미 있으면 `conflict` |
| `FILE_DELETE_CHANNEL` | `shell:file-delete` | `{ path }` | `{}` — 디스크에서 지운다(확인 modal은 화면이 이미 했다) |
| `FILE_WATCH_CHANNEL` | `shell:file-watch` | `{ paths: path[] }` | `{}` — 이 창이 보는 파일 전체 목록을 통째로 바꾼다(빈 목록이면 watch를 끈다) |
| `FILE_CHANGED_CHANNEL` | `shell:file-changed` | (main → renderer) | `{ path, hash: hash \| null }` — 밖(다른 편집기, git)에서 바뀌었다. 지워졌으면 `null` |
| `FILE_COUNTS_CHANNEL` | `shell:file-counts` | `{ unsettled, open }`(renderer → main send) | 창 닫기 guard가 읽는다. 옛 `EDITOR_COUNTS_CHANNEL`과 뜻이 같고 `unsettled`는 디스크 저장이 끝나지 않은 파일 수(쓰는 중, 실패, 불명, 충돌)다 |
| `FILE_CLOSE_REQUEST_CHANNEL`, `FILE_CLOSE_ANSWER_CHANNEL` | `shell:file-close-request`, `shell:file-close-answer` | 옛 `EDITOR_CLOSE_*`와 같다 | 창을 닫으려 할 때 main이 묻고 renderer가 `allow`·`stay`·`asking`으로 답한다 |

- 지금 `ipc/editor.ts`의 규칙을 옮긴다: reply는 `{ ok: true, value } | { ok: false, code }`, `code`는 `invalid_input`, `forbidden`, `not_found`, `conflict`, `unavailable`, `unsupported`, `too_large` 일곱이다. 경로와 OS 오류 원문은 싣지 않는다.
- `path`는 절대 경로 문자열(`^(/|[A-Za-z]:[\\/])`, 최대 4096자)이다. 정규화, 폴더 밖 판정, 데이터 root의 `secrets.json`(secret 파일)을 거절하는 일(`forbidden`)은 main handler의 몫이다. schema는 모양만 본다.
- hash는 내용의 sha256 hex 64자다(`^[0-9a-f]{64}$`). 읽을 때 준 `hash`가 쓸 때의 `base_hash`다.
- `FilesApi` interface(preload가 renderer에 여는 모양)를 `list`, `read`, `readBytes`, `write`, `rename`, `delete`, `watch`, `onChanged(listener) => 해제`, `counts`, `onCloseRequest(listener) => 해제`, `answerClose`로 둔다.
- 옛 `ipc/editor.ts`는 건드리지 않는다. 그 안의 restore·create·place·version 준비 부분(`I2.10#16`)은 쓰는 곳이 screens-project의 wave 3 작업으로 사라지고 cleanup이 file을 지운다.

`preload/files-api.ts`는 `preload/editor-api.ts`와 같은 꼴(transport를 받아 `Object.freeze`한 API를 돌려준다. 실패는 `{ ok: false, code: "unavailable" }`)로 `createFilesApi(transport)`를 둔다. `preload/shell.ts`에 `contextBridge.exposeInMainWorld("lophnFiles", createFilesApi(ipcRenderer))`를 desktop renderer(`role === "shell"`)에만 더한다.

### 2. secret 보호 입력 창 (`ipc/secret-input.ts`) — `I1.9#2`, `U2.1#5`, `I2.9#4`

확인 창(`confirmation`)의 한 kind였던 보호 입력을 따로 떼어, shell main이 띄우는 작은 modal 창 하나로 둔다. 값은 보호 창과 main 메모리, 그리고 core로 가는 upload 본문에만 있다. 일반 renderer와 agent 대화에는 가지 않는다. 확인 handle, canonical 비교, 결정 모델은 쓰지 않는다. provider 연결, MCP server credential, 앱 secret이 쓴다.

- 일반 창 → main (`SECRET_INPUT_OPEN_CHANNEL = "shell:secret-input-open"`):
  - 입력 `secretInputOpenSchema = { name: secretName, purpose: "app" | "provider" | "mcp", subject: 한 줄 글 1~80자 }`. `name`은 저장할 secret 이름(contract-platform의 `secretNameSchema`와 같은 규칙 `^[A-Za-z0-9_.:-]+$`)이고 `subject`는 창에 보일 대상 이름(앱, provider, MCP server 이름)이다. 창은 `subject`를 글로만 그린다. 부모 창은 main이 IPC를 보낸 창으로 정한다.
  - 답 `{ ok: true, result: "stored" | "cancelled" } | { ok: false, code: "invalid_input" | "forbidden" | "conflict" | "unavailable" }`. `conflict`는 이미 열린 보호 창이 있을 때다. 값은 답에 없다. 호출한 화면은 `stored`를 받은 뒤에야 그 이름을 가리키는 command(provider 등록 등)를 보낸다.
- 보호 창 ↔ main (보호 preload 전용):
  - `SECRET_INPUT_DISPLAY_CHANNEL = "secret-input:display"`: 입력 없음, 답 `{ name, purpose, subject, configured: boolean }`.
  - `SECRET_INPUT_SUBMIT_CHANNEL = "secret-input:submit"`: 입력 `{ value: string }`(UTF-8로 1바이트 이상 `SECRET_INPUT_MAX_BYTES` 이하). main이 값을 core `secrets/put` upload로 보내고 값 byte를 0으로 덮는다. 답 `{ ok: true } | { ok: false, code: "invalid_input" | "unavailable" }`. core 오류와 OS 오류 원문은 싣지 않는다.
  - `SECRET_INPUT_CANCEL_CHANNEL = "secret-input:cancel"`: 답 `{}`.
- 이 창은 OAuth 코드 붙여넣기를 받지 않는다(저장하는 값이 아니다). 아래 보고의 걱정에 있다.
- `SecretInputOpenApi`(`open(input) => Promise<reply>`)와 보호 창 API(`getDisplay`, `submit`, `cancel`)를 interface로 둔다.
- `preload/secret-input-open.ts`: `preload/confirmation-open.ts`와 같은 꼴로 `createSecretInputOpener(transport)`. 통로 실패는 고정 오류 `{ ok: false, code: "unavailable" }`로 바꾼다. `preload/shell.ts`의 `lophnShell`에 `openSecretInput`으로 더한다(desktop renderer만).
- `preload/secret-input.ts`: `preload/confirmation.ts`처럼 보호 창에 `lophnSecretInput`(`getDisplay`, `submit`, `cancel`)만 연다. 일반 shell API, 앱 호출, file 접근은 없다.
- 옛 `ipc/confirmation*.ts`, `preload/confirmation*.ts`, `ipc/windowless-confirmation.ts`는 건드리지 않는다. screens-data가 확인 창을 지울 때 쓰는 곳이 사라지고 cleanup이 지운다. 보호 창을 만드는 BrowserWindow 코드와 preload 번들 목록(`packages/shell/main/build.ts`)은 screens-data와 lead의 몫이다.

### 3. 폴더·파일 고르기 (`ipc/folder-picker.ts`, `preload/folder-api.ts`) — `U3.5#3`, `U3.3#7`

등록한 폴더가 사라지면 "찾을 수 없음"이 보이고 사람이 새 위치를 골라야 이어진다. project 밖 파일도 OS dialog로 골라 문서 탭으로 연다.

- `FOLDER_PICK_CHANNEL`의 입력을 `{ purpose?: "register" | "relocate" }`로 넓힌다(없으면 `register`). main이 dialog 제목을 purpose로 정한다. 답은 지금 `FolderPickReply`와 같다.
- 새 channel `FILE_PICK_CHANNEL = "shell:file-pick"`: 입력 `{}`, 답 `{ ok: true, path: string \| null } | { ok: false, code: ... }`(`FolderPickReply`와 같은 모양, 한 파일의 절대 경로).
- `FolderPickerApi`를 `pick(input?)`와 `pickFile()`로 넓힌다.
- 지금 `preload/shell.ts`에 인라인으로 있는 `lophnFolders` 노출을 `preload/folder-api.ts`의 `createFolderApi(ipcRenderer)`로 옮기고 `shell.ts`는 그것을 부른다.

### 4. overlay (`ipc/overlay.ts`) — `U2.1#4`

`notification` 표면이 반응 층의 toast를 그린다(launcher, Lophn Workspace, project, 앱 공간 어디서나). design `Toast`가 단추 최대 셋과 어조(neutral, error)를 받게 된다(ui-chrome-components).

- `overlayModelSchema`에 `tone: z.enum(["neutral", "error"]).optional()`을 더한다. `notification`만 쓴다.
- `choices`의 상한 64는 그대로 둔다. `notification`은 앞의 세 choice를 단추로 쓴다는 규칙을 주석 한 줄로 적는다.
- `PALETTE_ICONS`와 나머지 schema는 바꾸지 않는다.

### 5. 바꾸지 않는 것 (이유와 함께 보고에 적는다)

- `ipc/window-controls.ts`: 창 단추 API(`state`, `minimize`, `toggleMaximize`, `close`, `subscribe`)가 wireframe(`frames/chrome/window-api.ts`)와 같다. 바꾸지 않는다.
- `ipc/workspace.ts`의 layout 저장·읽기(`LAYOUT_SAVE_CHANNEL`, `LAYOUT_READ_CHANNEL`)는 그대로다. layout 값의 모양은 main이 검사하고(`main/workspace/schema.ts`, screens-project) 이 file은 값을 `unknown`으로 둔다. 현재 보기 hint(`VIEW_HINT_CHANNEL`, `I1.9#7`)는 쓰는 곳이 wave 3에 사라지고 cleanup이 지운다.
- `ipc/shortcuts.ts`: 창 안 shortcut(`WINDOW_SHORTCUTS`)은 그대로다. ticket 링크 intent(`CodingTargetIntent`, `CODING_TARGET`, `I1.6#25`)와 `things-to-confirm` intent(`DESKTOP_INTENTS`, `ConfirmTargetIntent`)는 이 task에서 지우지 않는다. `renderer/desktop/intents.tsx`와 `main/desktop/open-intent.ts`가 `intent.kind === "coding"` 같은 가지를 쓰고 있어 지우면 type check가 깨진다. platform-desktop(main 쪽)과 screens-workspace(renderer 쪽)가 쓰는 곳을 걷은 뒤 cleanup이 union에서 지운다. `app-issue` intent는 남긴다.
- `protocol/shell/launch.ts`, `workspace.ts`, `screen-test.ts`, `ipc/screen-test.ts`, `ipc/open-external.ts`: 바꾸지 않는다.

## 끝남

- `deno task check`가 통과한다. (shell main/preload는 `deno.json` exclude이므로 `packages/shell/main`의 check script가 preload와 ipc를 type check하는지 확인하고, 안 보면 보고에 적는다.)
- 위험 test: 없음(schema, channel 이름, bridge만 둔다. 파일 쓰기 충돌과 secret 값 처리의 test는 구현 단위가 쓴다.)
- 남지 않음: 해당 없음(옛 IPC는 지우지 않는다). 새 file에 `document`·`version`·`sealed_ref`·`confirmation` 낱말이 없다: `grep -n "document\|version\|sealed_ref\|confirmation" packages/shell/ipc/files.ts packages/shell/ipc/secret-input.ts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것
  - `packages/shell/main/build.ts`의 preload 번들 목록에 `preload/secret-input.ts` 더하기, shell main `desktop/main.ts`의 IPC 등록(platform-desktop이 한다)
  - `preload/shell.ts`는 다른 계약 단위도 노출 줄을 더하므로 merge 때 lead가 푼다
- 안 쓰게 된 export: `ipc/editor.ts` 전부, `ipc/confirmation*.ts`, `ipc/windowless-confirmation.ts`, `preload/editor-api.ts`, `preload/confirmation*.ts`
- 정한 것: 문서에 답이 없어 정한 것(파일 IPC의 channel 이름, 일곱 오류 code, 상한 8MiB·64MiB, 보호 창 입력의 `purpose` 셋과 `subject`, `tone`)
- 걱정
  - contract-calls-places가 `protocol/projects/files.ts`에 사람 파일 통로 `files.*`(`I2.10#8`)를 새로 만들면 #93과 겹친다. 편집기는 이 IPC를 쓰므로 core `files.*` 사람 통로는 필요 없다.
  - provider OAuth 로그인에서 사람이 붙여넣는 코드(`entry: "code"`)는 저장하는 secret이 아니라서 이 창이 받지 않는다. contract-agent-tools가 OAuth 완료 입력을 어디서 받을지 정해야 한다.
  - Explorer tree의 목록(`FILE_LIST_CHANNEL`)을 core project 읽기가 아니라 main이 디스크에서 직접 읽는다고 가정했다. 연결 폴더 밖 목록을 막는 규칙은 main handler가 연결 폴더 목록을 알아야 한다.

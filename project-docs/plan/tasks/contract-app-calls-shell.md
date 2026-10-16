# contract-app-calls-shell

앱 view 경계의 계약을 고친다: 앱 view를 열 때와 열린 view에 project를 싣고, 앱 페이지의 `lophnApp.call`이 command 대신 app-api 이름을 보낸다. 모두 옛 file을 그 file에서 고치는 더하기·이름 바꾸기이고, 이 task는 main 쪽 구현을 고치지 않는다.

- 단위: contract-app-calls (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/shell/app-frame.ts`
  - `packages/protocol/shell/app-bridge.ts`
  - `packages/protocol/shell/app-bridge-types.ts`
  - `packages/shell/ipc/app-frame.ts`
  - `packages/shell/ipc/app-window.ts`
  - `packages/shell/ipc/app.ts`
  - `packages/shell/preload/app-api.ts`
  - `packages/shell/preload/views-api.ts`
- 읽을 것:
  - spec: S5 4장 표(앱 화면) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - inventory: `I2.12#3` (`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`). 문맥으로 `U2.4#11`, `U2.4#12`, `U3.4#5`(`/home/pyosechang/projects/lophn/project-docs/tmp/ui-inventory.md`, screens-app-space 몫)
  - 결정: `/home/pyosechang/projects/lophn/project-docs/plan/README.md` 3장 #18
  - 지금 코드: 위 소유 file. 본보기 `packages/shell/preload/shell.ts`(preload가 API를 어떻게 모으는지)
- 계약:
  - 쓰는 것: `protocol/projects/values.ts`의 `projectIdSchema`
  - 내놓는 것: 앱 view의 project 칸과 `setViewProject`(screens-app-space의 앱 place project 고르기가 부른다), 페이지가 보내는 `{api, input}`(app-calls-shell이 main 쪽을 맞춘다)

## 할 일

1. project를 싣는다 (`I2.12#3`, S5 4장 표 첫 줄)
   - `protocol/shell/app-frame.ts`: `appFrameOpenSchema`(`openFields`)와 `appViewOpenSchema`에 `project: projectIdSchema.optional()`을 더한다. `viewStateFields`와 `appFrameViewStateSchema`에 `project: projectIdSchema.nullable().optional()`을 더한다. 필수로 하지 않는 이유: main이 만드는 state 객체(`shell/main/app-frame/view-model.ts`)가 wave 3에서 채울 때까지 type check가 깨지면 안 된다. 채워진 뒤 필수로 바꾸는 것은 계약 바꾸기 요청으로 보고한다.
   - `shell/ipc/app-frame.ts`: 같은 칸을 `appViewOpenSchema`, `appFrameViewStateSchema`에 똑같이 더한다(이 file은 main이 쓰는 사본이다).
   - 앱 place에서 연 앱 화면은 화면 안에서 project를 고르고 main에 알린다(채널이 필요하다고 inventory가 적었다). 양쪽 file에 더한다.
     - 채널 `VIEW_PROJECT_CHANNEL = "shell:view-project"` (`protocol/shell/app-frame.ts`의 `APP_FRAME_IPC` 키 `"shell:view-project"`)
     - `viewProjectRequestSchema` = `{view_session, project: projectIdSchema | null}` (strict)
     - `LophnShellViewsApi`(ipc)와 `LophnShellViews`(protocol)에 `setViewProject(input): Promise<AppFrameViewState>`를 더한다. 같은 view_session의 view가 그 project로 묶이고 state가 push된다. main 구현은 wave 3의 app-calls-shell 몫이다.
   - `shell/preload/views-api.ts`: `createViewsApi`에 `setViewProject` 한 항목을 더한다(`VIEW_PROJECT_CHANNEL`로 `call`).
   - `shell/ipc/app-window.ts`: `appWindowRequestSchema`에 `project: projectIdSchema.optional()`을 더한다(새 창으로 열어도 project를 이어 간다). 이 file은 자체 `ULID` 정규식으로 ID를 검사하므로 project ID도 `^prj_${ULID}$`로 쓴다.
   - zod 규칙: `ipc/*.ts`는 main이 protocol을 import하지 못해 만든 사본이다. 두 file의 모양을 글자 그대로 맞춘다.
2. 페이지의 호출 이름 (결정 #18)
   - `protocol/shell/app-bridge.ts`: `appCallSchema`의 `command` 칸을 `api`로 바꾼다(`{api: appApiKey, input}`). `appApiKey`는 `protocol/apps/calls`가 아직 없을 수 있으니 이 file의 `commandKeySchema` import를 그대로 쓰고 이름만 `apiKey` 지역 상수로 한다. type 이름 `AppCall`은 그대로. `LophnApp.call(command, input)`의 인자 이름을 `api`로.
   - `protocol/shell/app-bridge-types.ts`: 같은 인자 이름.
   - `shell/preload/app-api.ts`: `call: (api, input) => request(transport, APP_CALL_CHANNEL, { api, input })`.
   - `shell/ipc/app.ts`: 머리 주석에서 command 낱말을 app-api로. 채널 이름(`app:call`)은 그대로 둔다.
   - main의 `shell/main/app-frame/app-call.ts`는 아직 `command`를 읽는다. 이 task가 고치지 않는다. wave 3의 app-calls-shell이 맞춘다. 보고에 적는다.
3. 문서 view(`documentViewOpenSchema`, `lophn-document` scheme, `documentPartition`)는 문서 쪽 task가 지우는 것이라 건드리지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음.
- 남지 않음: `grep -rn "command" packages/protocol/shell/app-bridge.ts packages/protocol/shell/app-bridge-types.ts packages/shell/preload/app-api.ts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음 (`protocol/shell/mod.ts`가 이미 `app-frame`·`app-bridge`를 내보내므로 새 이름이 있으면 export 줄만 lead가 맞춘다. 있으면 적는다)
- 안 쓰게 된 export: 없음
- 정한 것: `project` 칸을 optional로 둔 것, 채널 이름, 새 창에도 `project`를 싣게 한 것
- 계약 바꾸기 요청: 위 `project` 필수화 시점, main 쪽이 `command`를 아직 읽는다는 것

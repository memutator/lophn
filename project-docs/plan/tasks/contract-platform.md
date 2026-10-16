# contract-platform

platform(config, secrets, diagnostics, 시작 실패)의 새 계약을 `protocol`에 고정한다. type, schema, 상수, route 선언, type-only port만 둔다. 구현과 core 쪽 변경은 하지 않는다. 옛 계약은 지우지 않고 옆에 새것을 더한다(옛것은 platform 단위가 쓰는 곳을 걷은 뒤 cleanup이 지운다).

- 단위: contract-platform (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/config/` (새 file `declaration.ts`, `file.ts`. `mod.ts`에 export 더하기만)
  - `packages/protocol/secrets/` (새 file `secret-file.ts`. `mod.ts`에 export 더하기만)
  - `packages/protocol/diagnostics/` (`diagnostics.ts`에 더하기만)
  - `packages/protocol/supervision/supervision.ts` (시작 실패 frame 하나를 더하고 `coreToMainMessageSchema`에 넣기만)
- 읽을 것:
  - spec: S1 7장 "남지 않는 event"(SettingsChanged가 여기 속한다), S2 5장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`, `approval.md`
  - inventory: 이 단위에 배정된 줄은 없다(`../assignment.md`의 contract-platform은 0줄). 아래는 계약 모양의 근거다.
    - `I2.11#1`, `I2.11#3`, `I2.11#4`, `I3.11#2`, `I3.11#3`, `I3.11#4`(설정), `I1.11#4`, `I1.11#5`, `I1.11#6`(지우는 설정 기능)
    - `I2.11#6`, `I2.11#7`, `I2.11#8`, `I3.11#1`, `I1.11#8`(secret)
    - `I2.11#13`(시작 실패), `I2.11#16`, `I3.11#5`, `I1.11#10`(진단)
    - `U2.1#5`(secret 보호 입력), wireframe `workspace/general-pane.tsx`, `workspace/diagnostics-pane.tsx`
  - 결정: `../README.md` 3장 #9(secret 파일은 core가 직접), #117·118(설정 파일 `<data root>/settings.json`, core가 파일을 보고 바뀌면 `SettingsChanged`, 화면 이름과 설명은 설정 key로 정한 wording key)
  - 본보기(화면): `tools/wireframes/frames/compositions/workspace/general-pane.tsx`(설정 type: boolean, 숫자 범위, 선택지, 목록), `diagnostics-pane.tsx`
  - 지금 코드: `packages/protocol/config/settings.ts`(옛 선언 `defineSetting`과 route 다섯), `packages/protocol/secrets/secrets.ts`, `packages/protocol/diagnostics/diagnostics.ts`, `packages/protocol/base/route.ts`(`defineMemory`, `defineUpload`)
- 계약:
  - 쓰는 것: `protocol/base/route.ts`의 `defineMemory`·`defineUpload`, `protocol/base/envelope.ts`의 `withReadCommon`. `SettingsChanged`의 이름과 payload는 contract-events가 `protocol/events`에 둔다(S1). 이 task는 정의하지 않는다.
  - 내놓는 것: 아래 "할 일"의 모양 전부. platform 단위와, 설정·secret·진단을 쓰는 다른 단위(agent-definition, approvals, app-calls, releases-problems, screens-workspace, screens-data)가 이 모양으로 짓는다.

## 할 일

### 1. 설정 선언 (`protocol/config/declaration.ts`, 새 file) — `I2.11#1`, `I3.11#2`

쓰는 요소가 자기 이름 아래 type과 기본값만 선언한다. 메타 field(설명 key, 위험, 층, 적용 시점 등)는 없다.

```ts
export const SETTING_KEY = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/; // 예: "shell.reading_width", "agents.run_turn_limit"
export interface SettingDeclaration<S extends z.ZodType = z.ZodType> {
  readonly key: string;
  readonly type: S;
  /** 없으면 사람이 골라야 하는 필수 설정이다. 비어 있으면 그 설정을 쓰는 기능만 시작하지 않는다. */
  readonly default?: z.input<S>;
}
export function declareSetting<S extends z.ZodType>(d: SettingDeclaration<S>): SettingDeclaration<S>;
export interface SettingsReader {
  /** 기본값이 있으면 값이다. 기본값이 없고 사람이 고르지 않았으면 undefined다. */
  get<S extends z.ZodType>(setting: SettingDeclaration<S>): z.output<S> | undefined;
}
```

- `declareSetting`은 key가 `SETTING_KEY`에 맞는지, `default`가 `type`을 통과하는지 확인하고 아니면 throw한다. 지금 `defineSetting`처럼 모든 메타를 요구하는 검사는 만들지 않는다.
- 첫 구간(`shell.`, `agents.`, `server.` 같은 요소 이름)이 owner다. 따로 owner field를 두지 않는다.
- 화면 이름과 설명은 선언에 없다. wording key를 key에서 정한다: `settings.<key의 .을 -로 바꾼 것>.name`과 `.help`(예: `settings.shell-reading_width.name`). 이 규칙을 `settingWordingKey(key, "name" | "help")` 함수로 둔다(`../../dev/code.md`의 wording key 모양 `screen.noun.verb`를 지킨다).
- 옛 `defineSetting`, `SettingDefinition`, `settingDefinitionSchema`는 건드리지 않는다. 이름이 겹치지 않게 새 이름만 쓴다.

### 2. 설정 파일과 route (`protocol/config/file.ts`, 새 file) — `I3.11#2`, `I3.11#3`, `I2.11#3`

- 파일: `<data root>/settings.json`. `export const SETTINGS_FILE_NAME = "settings.json"`.
- 모양: key 전체 이름을 그대로 쓰는 평평한 JSON 객체 하나. 사람이 명시한 선택만 담는다(기본값과 합친 값은 쓰지 않는다).
  ```json
  { "shell.theme": "dark", "agents.run_turn_limit": 40 }
  ```
  `export const settingsFileSchema = z.record(z.string().regex(SETTING_KEY), z.json())`.
- 거절 규칙(구현은 platform-config): 선언에 없는 key, 선언한 type을 못 지나는 값은 모두 `SettingRejection`이고, 하나라도 있으면 아무것도 적용하지 않는다(전체 거절).
  ```ts
  export const SETTING_REJECTION_REASONS = ["unknown_key", "wrong_type", "out_of_range", "invalid_value"] as const;
  export const settingRejectionSchema = z.strictObject({ key: z.string(), reason: z.enum(SETTING_REJECTION_REASONS) });
  ```
  값은 거절 결과에 싣지 않는다.
- route 둘. 둘 다 `defineMemory`(ledger를 거치지 않고 core 메모리에서 파일을 읽고 쓴다). 이름은 옛 route(`settings/definitions`, `get`, `history`, `apply`, `reload`)와 겹치지 않게 한다.
  - `settingsList`: `resource: "settings"`, `method: "list"`, `name: "SettingsList"`. 입력 `{ keys?: string[] }`. 출력 `{ settings: { key, type: JSON Schema 객체, default?: json, chosen?: json }[] }`. `type`은 core가 선언의 zod type에서 `z.toJSONSchema`로 만든 것이다. `chosen`은 파일에 있을 때만 있다(기본값과 나눠 보이려는 것이다). 기본값이 없고 `chosen`도 없으면 필수 설정이 빈 것이다. actors `user`, `agent`, `app`, `machine`, errors `invalid_input`, `unauthorized`, `forbidden`, `unavailable`.
  - `settingsUpdate`: `method: "update"`, `name: "SettingsUpdate"`. 입력 `{ changes: ({ key, action: "set", value: json } | { key, action: "unset" })[] }`(key 중복 거절). 출력 `{ changed: string[], rejected: SettingRejection[] }`: `rejected`가 비어 있지 않으면 아무것도 쓰지 않은 것이다. actors `user`. errors `invalid_input`, `unauthorized`, `forbidden`, `unavailable`.
- revision, 이력, 충돌 검사(compare), question 근거(evidence), TOML 가져오기·내보내기, `apply_at` 같은 것은 새 모양에 두지 않는다(`I1.11#4~#7`).
- `export const SETTINGS_FILE_ROUTES = [settingsList, settingsUpdate] as const;`(lead가 `ALL_ROUTES`에 넣는다).
- `SettingsChanged` event는 파일이 바뀌면 core가 낸다. 이름과 payload(`{ keys: string[] }`, subject `null`)는 contract-events가 `protocol/events`의 남지 않는 event로 둔다. 이 task는 정의하지 않는다.

### 3. secret 파일과 route (`protocol/secrets/secret-file.ts`, 새 file) — `I2.11#6~#8`, `I3.11#1`

core가 `<data root>/secrets.json`(0600)을 직접 읽고 쓴다. 이름이 곧 key이고 값은 문자열이다. `sealed_ref`, `revision`, 준비 증거(`SecretPreparation`), purpose, I/O worker pipe op(`secret.prepare`, `secret.send`, `secret.store-refresh`)는 새 모양에 없다.

- `export const SECRET_FILE_NAME = "secrets.json"`. 이름 규칙은 지금 `secretNameSchema`를 그대로 쓴다. 값 상한은 지금 `SECRET_INPUT_MAX_BYTES`(64KiB)를 쓴다.
- 상태: `secretFileStatusSchema = { name, configured: boolean }`(값과 revision 없음).
- route 셋. 이름은 옛 `secrets/list`, `set`, `remove`, `cleanup`, `input`과 겹치지 않게 한다.
  - `secretStatus`: `defineMemory`, `secrets/status`, 입력 `{ names?: string[] }`, 출력 `{ secrets: SecretFileStatus[] }`. actors는 옛 `listSecrets`와 같다(`user`, `agent`, `app`, `machine`). 권한 밖 이름과 없는 이름이 구별되지 않는 응답 규칙은 그대로다.
  - `secretPut`: `defineUpload`, `secrets/put`, 입력 `{ name, bytes }`(header), body는 값의 byte, 출력 `SecretFileStatus`. actors `user`. 사람 token을 가진 shell main이 secret 보호 입력 창(contract-shell)의 제출을 받아서만 부른다. renderer의 core 호출 통로(`ipc/core.ts`의 `coreCallSchema`)에는 upload kind가 없다. 값이 renderer 일반 통로를 지나지 않는다는 보장이 이것이다.
  - `secretDelete`: `defineMemory`, `secrets/delete`, 입력 `{ name }`, 출력 `SecretFileStatus`(`configured: false`). actors `user`. 확인 handle(`confirmation`)은 쓰지 않는다. 지우기 확인은 화면의 modal이다.
- 전송 부착(값을 요청에 붙이는 일) port. core 안에서 부른다(pipe 아님). 앱 broker(`apps/permissions/broker/net-fetch`)와 provider·MCP 호출이 이 모양으로 부른다.
  ```ts
  export const secretFileUseSchema = z.strictObject({ name: secretNameSchema, destination: secretDestinationSchema }); // destination은 지금 것 그대로
  export const secretFileSendInputSchema = z.strictObject({ context: secretAdapterContextSchema, use: secretFileUseSchema, operation: z.string().min(1), body: z.json() });
  export interface SecretAttachPort {
    /** 값은 transmit 인자로만 간다. 결과에는 전송 여부뿐이다. */
    send(input: SecretFileSendInput, transmit: (value: SecretValue) => Promise<Result<SecretSendOutput>>): Promise<Result<SecretSendOutput>>;
  }
  ```
  허용 목적지 규칙(redirect로 목적지가 바뀌면 인증을 따라가지 않음, 값은 호출자에게 돌려주지 않음)은 지금 `core/secrets/model.ts`의 것을 그대로 쓴다.
- 값을 바꾸는 쪽이 core 안의 owner concern일 때(OAuth token 갱신 등)의 port. `secretPut` route와 같은 파일에 쓴다.
  ```ts
  export interface SecretStorePort {
    /** 파일 전체를 임시 파일에 쓰고 rename으로 바꾼다. 실패하면 이전 값이 그대로다. 값은 결과에 없다. */
    put(name: string, value: SecretValue): Promise<Result<SecretFileStatus>>;
  }
  ```
- `export const SECRET_FILE_ROUTES = [secretStatus, secretPut, secretDelete] as const;`
- 다른 단위가 secret을 가리키는 방법은 이름뿐이다(provider·MCP 등록 입력의 `credential`은 `{ secret: name }`). 그 입력은 contract-agent-tools가 정한다(보고의 걱정에 있다).

### 4. 진단 상태 (`protocol/diagnostics/diagnostics.ts`에 더하기) — `I2.11#16`, `I3.11#5`

Settings › Diagnostics 화면은 사람이 [Run checks]를 누를 때만 구성 요소마다 점검한다(wireframe `diagnostics-pane.tsx`). 보안 점검(doctor)은 없다.

- `export const DIAGNOSTIC_COMPONENTS = ["core", "ledger", "events", "app-runtime", "sandbox", "agent-runtime"] as const;`(core가 점검하는 것만. 터미널은 shell main이 안다)
- `diagnosticsStatus`: `defineMemory`, `diagnostics/status`, `name: "DiagnosticsStatus"`. 입력 `{}`. 출력 `{ checked_at: at, components: { component: DIAGNOSTIC_COMPONENTS의 값, available: boolean, reason?: string, checked_at: at }[] }`. 호출할 때마다 지금 점검한다. `available: false`면 `reason`이 있어야 하고 경로·key·값을 담지 않는다(`healthObservationSchema`와 같은 규칙). actors는 `ACTOR_KINDS` 전부, errors `invalid_input`, `unauthorized`, `forbidden`, `unavailable`.
- `diagnosticsList`(기록 목록)는 그대로 둔다. 옛 `diagnosticsCheck`와 `DIAGNOSTIC_CHECKS`(doctor)는 건드리지 않는다. platform-diagnostics가 등록하지 않고 cleanup이 지운다.
- `platform/status`·`platform/health`는 `protocol/server/routes.ts`(contract-events 소유)에 있고 core 기동 감시(`main/daemon/parent.ts`)가 쓴다. 모양을 바꾸지 않는다.
- `export const DIAGNOSTIC_ROUTES`는 건드리지 않는다. 새 route는 `DIAGNOSTIC_STATUS_ROUTES = [diagnosticsStatus] as const`로 따로 낸다.

### 5. 시작 실패 frame (`protocol/supervision/supervision.ts`에 더하기) — `I2.11#13`

core가 migration 앞에서 시작하지 못할 때 shell main이 `failed-schema`로 세우고 `ConnectionState.schemaFailure`(contract-events의 `newer_schema`, `history_mismatch`, `damaged_original`)를 채울 수 있게, 높은 schema, hash가 다른 이력, 손상된 원본을 구별되는 값으로 알린다. 값 이름을 그 칸과 같게 맞춘다.

- `export const START_FAILURE_REASONS = ["newer_schema", "history_mismatch", "damaged_original", "other"] as const;`
- `startFailedSchema = z.strictObject({ type: z.literal("start_failed"), reason: z.enum(START_FAILURE_REASONS) })`. 문장과 경로는 싣지 않는다. `coreToMainMessageSchema`의 union에 이 frame을 더한다.

### 6. export 정리

- 세 폴더의 `mod.ts`에 새 file의 export를 더한다(다른 줄은 바꾸지 않는다). 이름이 옛 export와 겹치면 새 이름을 바꾼다.
- 옛 export를 하나도 지우지 않는다. 옛 `defineSetting`을 쓰는 열세 곳(`core/config/shell-settings.ts`, `core/lophn-agent/register.ts`, `core/problems/register.ts`, `protocol/coding-agent/harnesses.ts`, `protocol/lophn-agent/{mcp-settings,skill-settings}.ts` 등)은 각 단위가 wave 3에 `declareSetting`으로 옮긴다.
1. (lead가 맞추며 더함) launch spec(`protocol/supervision/supervision.ts`)에 `net_any?: boolean`을 더한다. agent runtime의 `web.fetch`가 아무 host로 나갈 수 있게 한다(agent-tools-shell-web 요청). 구현은 platform-runtime이 한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(type, schema, 상수만 둔다)
- 남지 않음: 해당 없음(옛 계약은 지우지 않는다). 대신 `grep -rn "sealed_ref\|SettingDefinition" packages/protocol/config/declaration.ts packages/protocol/config/file.ts packages/protocol/secrets/secret-file.ts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `SETTINGS_FILE_ROUTES`, `SECRET_FILE_ROUTES`, `DIAGNOSTIC_STATUS_ROUTES`를 `ALL_ROUTES`에 더하기(lead). renderer가 부르는 memory route(`settings/list`, `settings/update`, `secrets/status`, `secrets/delete`, `diagnostics/status`)를 `packages/shell/main/desktop/core/allowlist.ts`의 `RENDERER_MEMORY_ROUTES`에 더하기(platform-desktop이 한다)
- 안 쓰게 된 export: 옛 `defineSetting`·`SettingDefinition`·settings route 다섯·`SETTINGS_EXCHANGE_*`, `secrets.ts`의 `listSecrets`·`setSecret`·`removeSecret`·`secretCleanup`·`secretInput`·`secretPrepare`·`secretSend`·`secretStoreRefresh`·`SECRET_EXCHANGE_FORMAT`·`SecretRefSource`, `diagnosticsCheck`·`DIAGNOSTIC_CHECKS`
- 정한 것: 문서에 답이 없어 정한 것(설정 파일 평평한 key, `settings.json`·`secrets.json` 이름, 거절 reason 넷, wording key 규칙, memory route 사용)
- 걱정
  - provider·MCP 등록 입력의 `credential`이 `{ secret: name }` 같은 이름 참조여야 한다(contract-agent-tools). 옛 `credential: { kind, preparation }`(준비 증거)는 새 모양에 없다.
  - 이 단위가 고정한 secret 흐름은 "값 → secret 보호 입력 창 → `secrets/put` upload" 하나다. screens-data-secret-input의 옛 흐름(`/v1/secrets/input` 준비 증거 → 소유 command)과 다르다.

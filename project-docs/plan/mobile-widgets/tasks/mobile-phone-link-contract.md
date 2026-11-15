# mobile-phone-link-contract

core에서 폰으로 가는 요청 길의 계약을 고정한다: remote channel에 더할 `request`/`response` frame(아직 channel에 넣지 않은 독립 module), 폰이 답하는 kind의 목록과 첫 kind `location.get`, `unavailable`의 이유, 앱 backend가 부르는 core route `app_phone.request`와 broker body. core link(`mobile-phone-link`), 폰의 답(`mobile-phone-location`), SDK(`mobile-cap-phone`), grant와 broker(`mobile-phone-use-grant`)가 이것 하나에 기댄다.

- 단위: phone-link (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/phone`(새 폴더 전체: `link.ts`, `kinds.ts`, `mod.ts`)
  - `packages/protocol/apps/phone-request.ts`(새 file)
- 읽을 것:
  - 지금 channel: `packages/protocol/remote/frames.ts`(`hello.capabilities`, `call`/`result`의 ok로 가르는 모양, `frameIdSchema`), `packages/protocol/remote/channel.ts`(`REMOTE_FRAME_MAX_BYTES` 16 MiB), `packages/core/remote/host.ts`(모르는 frame을 받으면 연결을 닫는다), `packages/core/remote/call.ts`(file bytes를 base64로 싣는 상한 주석)
  - 본보기(앱 route와 broker body): `packages/protocol/apps/tray.ts`
  - 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/widgets-survey.md`의 2.3과 3, 계획 `README.md`의 "정한 것"(frame 칸 이름은 `kind`, 앱 쪽 이름은 `capability`, bytes는 base64, 폰을 깨우지 않는다, banner 없음)
  - 단계 10이 같은 길에 얹을 것: `/home/pyosechang/projects/lophn/reports/mobile-program/browser-use-survey.md` 4절(screenshot bytes, 30초 deadline)
- 계약:
  - 쓰는 것: `packages/protocol/base/errors.ts`의 `errorBodySchema`(오류 code 일곱), `packages/protocol/base/route.ts`의 `defineMemory`, `channel-values.ts`의 `processNonceSchema`·`runtimeModeSchema`
  - 내놓는 것:
    - `packages/protocol/phone/link.ts`:
      - `PHONE_KIND_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/`(예 `location.get`, 단계 10의 `drive.snapshot`), 64자까지
      - `phoneRequestFrameSchema` = `{type: "request", id: 1..64자, kind, input: unknown, deadline_ms: int 1000..60000}`(core → 폰)
      - `phoneResponseFrameSchema` = `{type: "response", id, ok: true, value: unknown}` | `{type: "response", id, ok: false, error: {code, message, details?}}`(폰 → core. `error`는 `errorBodySchema.shape.error`)
      - `PHONE_RESPONSE_BYTES_MAX = 8 MiB`: 응답이 bytes를 실으면 `value` 안의 `*_base64` 문자열 칸에 싣고 원래 bytes는 이 상한 안이다(base64가 되어도 frame 하나 16 MiB 안). kind 정의가 자기 상한을 이것 이하로 적는다. 단계 10은 frame을 바꾸지 않고 kind만 더한다
      - 규칙(주석): 폰은 답할 수 있는 kind를 `hello.capabilities`에 적는다. core는 거기 없는 kind를 묻지 않는다(그래서 옛 폰은 `request`를 받지 않고 `REMOTE_PROTOCOL_VERSION`이 그대로다). 폰은 받은 `request`마다 같은 `id`의 `response` 하나를 보낸다. deadline이 지난 답과 모르는 `id`의 답은 core가 버린다
    - `packages/protocol/phone/kinds.ts`:
      - `locationGetInputSchema` = `{accuracy?: "low"|"balanced"|"high"(기본 balanced), max_age_ms?: int 0..300000(기본 0)}`
      - `locationSchema` = `{lat: number -90..90, lon: number -180..180, accuracy_m: number >= 0, at: atSchema}`
      - `PHONE_KINDS = {"location.get": {input: locationGetInputSchema, output: locationSchema, deadline_ms: 20_000}}`, type `PhoneKind = keyof typeof PHONE_KINDS`
      - `phoneUnavailableReasonSchema` = `"no_phone" | "phone_unreachable" | "unsupported" | "phone_in_background" | "location_off" | "timeout"`(뜻은 조사 2.3의 표). `unavailable` 오류의 `details.reason`이다
      - 폰이 거절할 때: `forbidden`, `details.reason: "os_permission_denied"`. core가 grant 없음으로 거절할 때: `forbidden`, `details: {permission: "phone.use", scope: {capability}}`(폰에 묻지 않는다)
    - `packages/protocol/phone/mod.ts`: 위를 내보낸다
    - `packages/protocol/apps/phone-request.ts`:
      - `phoneCapabilitySchema` = `z.enum(["location.get"])`(앱이 grant로 받는 기능. `PHONE_KINDS`의 key 가운데 앱에 연 것)
      - `appPhoneRequest` = `defineMemory({resource: "app_phone", method: "request", name: "app_phone.request", input: {capability, input: unknown}, output: {value: unknown}, actors: ["app"], errors: ["invalid_input", "forbidden", "not_found", "conflict", "unavailable"]})`. 앱 자식 credential만 부른다(broker가 grant를 본 뒤). 대상은 그 사람의 기준 폰(`devices.is_primary`)이다
      - `brokerPhoneInputSchema` = 위 입력에 `process_nonce`, `mode`를 더한 것. `PHONE_REQUEST_BROKER_PATH = "/_lophn/broker/phone/request"`

## 할 일

1. 위 셋을 쓴다. `link.ts`의 frame은 아직 `remoteClientFrameSchema`·`remoteServerFrameSchema`에 넣지 않는다(`packages/protocol/remote/**`는 다른 계획이 고치는 중이다. 넣는 것은 `mobile-phone-link`).
2. route 등록(`packages/protocol/apps/{mod,registry}.ts`)은 handler를 붙이는 `mobile-phone-use-grant`가 한다. 등록 없이 check가 안 돌면 그 줄만 더하고 "넘길 줄"에 적는다.
3. 파일 머리 주석에 왜 frame 칸이 `kind`인가(폰 기능은 한 갈래이고 단계 10이 `drive.*`를 같은 길에 얹는다)와 bytes 규칙을 적는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음(모양만. 주소·deadline·grant의 위험 test는 `mobile-phone-link`와 `mobile-phone-use-grant`가 쓴다)
- 남지 않음: 없음(더하기만)

- flows catalog: 이 task가 더하거나 지우는 route, CLI 명령, IPC channel, test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `request`/`response` frame 예 하나씩과 `unavailable` 응답 예 하나.

# mobile-cap-phone

새 SDK part `@lophn/cap-phone` 1.0.0을 짓는다. 앱 process(command, operation, flow, 시작 코드)가 사람의 기준 폰에서 위치를 한 번 읽는다: `getLocation()` → broker `POST /_lophn/broker/phone/request`. broker와 grant는 `mobile-phone-use-grant`가 짓는다. 이 task는 SDK 쪽만 짓고 fake host로 확인한다.

- 단위: phone-use (wave 2)
- 선행: mobile-phone-link-contract. 다른 계획의 land를 기다리지 않는다(새 폴더뿐이다)
- 소유(이 task만 고친다):
  - `packages/sdk/cap-phone`(새 폴더 전체: `package.json`, `mod.ts`, `phone.ts`, `host.ts`, `errors.ts`, `declaration.ts`, `guide.md`)
  - `packages/core/agent-workspaces/skills/migrate-sdk/cap-phone-1.0.0.md`(새 file)
- 한 줄씩 허락(공유 file. 한 줄만 더하고 보고의 "넘길 줄"에 적는다): `package-lock.json`(새 workspace 항목. `npm install --package-lock-only --offline`을 해 보고 안 되면 `packages/sdk/cap-phone` 항목만 손으로 더한다), `project-docs/flows/`의 `areas/sdk.yaml` 줄
- 읽을 것:
  - 본보기(같은 꼴의 SDK part): `packages/sdk/cap-notify/`(`notify.ts`의 client와 non-live stand-in, `host.ts`의 `CAP_HOST` port, `errors.ts`의 `CapabilityError`·`fromBroker`, `declaration.ts`의 `REQUIRED_PERMISSIONS`·`checkDeclaration`, `guide.md`의 절 순서)
  - 계약: `packages/protocol/phone/kinds.ts`(`locationGetInputSchema`, `locationSchema`, `unavailable`의 이유), `packages/protocol/apps/phone-request.ts`(`PHONE_REQUEST_BROKER_PATH`, broker body)
  - 계획 `README.md`의 "정한 것"(live가 아니면 stand-in, banner 없음, 폰을 깨우지 않는다), skill `.claude/skills/sdk-note/SKILL.md`(첫 판 메모)
  - SDK는 자기 폴더 밖을 import하지 않는다(설치 사본이 자기 완결이어야 한다. `packages/core/apps/packages/vendor.ts` 머리 주석). 그래서 protocol의 zod 정본을 import하지 않고 같은 모양을 TS type과 손 검사로 다시 쓴다
- 계약:
  - 쓰는 것: broker body `{capability: "location.get", input: {accuracy?, max_age_ms?}}`(host가 `process_nonce`·`mode`를 붙인다), 답 `{value: {lat, lon, accuracy_m, at}}`
  - 내놓는 것(`@lophn/cap-phone`):
    - `getLocation(options?: {accuracy?: "low" | "balanced" | "high"; maxAgeMs?: number}): Promise<PhoneLocation>`, `PhoneLocation = {lat: number; lon: number; accuracyM: number; at: string; standIn?: true}`
    - `createPhoneClient({host?})`(시험과 preview에서 host를 바꿔 끼운다)
    - 거절은 `CapabilityError`: grant가 없으면 `forbidden`(`permission: "phone.use"`), 폰이 위치 권한을 거절하면 `forbidden`(`reason: "os_permission_denied"`), 폰이 없거나 닿지 않거나 앞에 없으면 `unavailable`(`reason`은 계약의 여섯 가운데 하나), 입력이 틀리면 `invalid_input`
    - live가 아닌 mode(`preview`, `test`)에서는 broker를 부르지 않고 고정 stand-in 위치(서울시청, `accuracyM: 50`, `at`은 지금)에 `standIn: true`를 돌려준다
    - `REQUIRED_PERMISSIONS = [["phone.use"]]`, `checkDeclaration(declaration)`
    - `CAP_HOST`와 `CapHost` type(cap-notify와 같은 symbol과 모양. `host.ts`는 cap-notify의 것을 그대로 옮긴다)

## 할 일

1. `packages/sdk/cap-phone/`를 cap-notify의 꼴로 짓는다. `package.json`은 `"version": "1.0.0"`, `"lophn": {"supported_from": "1.0.0"}`, 의존 없음.
2. `phone.ts`: 입력 검사(accuracy 셋 가운데 하나, `maxAgeMs` 0..300000 정수), snake_case 답을 camelCase로 바꾸기, broker 오류를 `CapabilityError`로(`details.reason`을 `reason`으로 올린다), non-live stand-in.
3. `guide.md`(cap-notify guide의 절 순서와 한국어): 목적(앱 backend가 사람의 폰 위치를 한 번 읽는다. 폰 앱이 앞에 떠 있을 때만 답하고 background·연속 위치는 없다), 공개 API, 요구 permission(`phone.use`, scope `{capability: "location.get"}`, `reason`을 쓰고 activation 때 사람이 한 번 허락한다. 처음 부를 때 폰이 OS 위치 권한을 따로 묻는다), 실패를 다루는 법(`unavailable`이면 앱이 사람에게 "폰에서 lophn을 열어 주세요" 같은 다음 일을 보이고 되풀이해 부르지 않는다), version 정책.
4. 메모 `cap-phone-1.0.0.md`(Previous: none, Breaking: no, 한 줄 예와 선언 예). `## Instruction diff`는 `mobile-widgets-guidance`가 채운다(지침은 그 task가 바꾼다).
5. `node tools/check-sdk-notes.ts`가 통과하게 한다.

## 끝남

- `npm run check`가 통과한다. `node tools/check-sdk-notes.ts`가 통과한다.
- 위험 test: 없음(grant 경계는 broker에 있고 `mobile-phone-use-grant`의 위험 test가 본다). fake host로 한 번 불러 broker body와 stand-in을 손으로 확인하고 보고에 적는다
- 남지 않음: 없음(새 폴더)

- flows catalog: 이 task가 더하거나 지우는 SDK export와 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 앱 코드 예(선언의 `permissions`와 `sdk_dependencies`, `getLocation` 호출과 `unavailable` 다루기), 등록할 것(`packages/core/apps/releases/sdk-permissions.ts`의 `"@lophn/cap-phone": [["phone.use"]]`는 `mobile-phone-use-grant`가 더한다).

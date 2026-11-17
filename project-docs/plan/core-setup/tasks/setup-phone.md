# setup-phone

폰 앱에서 그 컴퓨터를 처음 설정하는 데 꼭 필요한 것만 짓는다: agent가 청한 secret card에 폰의 보호 입력으로 답하기, provider 로그인 card를 device code로 끝내기, 컴퓨터마다의 Providers 화면(연결된 목록, API key 연결, device code 로그인). 폰의 "컴퓨터에서 하세요"는 이 셋에서 지운다.

- 단위: setup (wave 2)
- 선행: setup-provider, setup-scope.
- 소유(이 task만 고친다):
  - `packages/mobile/src/screens/session/ask.tsx`
  - `packages/mobile/src/screens/settings/`
  - `packages/mobile/src/app/{nav.ts,routes.tsx,root-params.ts}`
  - `packages/mobile/src/data/setup.ts`(새 file)
  - `tools/wireframes/drafts/phone/{session,more,index}.tsx`
  - `packages/design/i18n/catalog/{mobile-session,mobile-app,mobile-places}.ts`
- 읽을 것:
  - 계획 README "정한 것"의 값, 화면은 둘이다, loopback 로그인
  - architecture: `project-docs/architecture/remote.md` "모델"의 bytes 줄과 "지키는 것" 1, 2, 3, 7, `project-docs/architecture/agent-definition.md` 60(값이 남지 않는 곳)
  - 폰 규칙: `packages/mobile/README.md`(kit, gallery, 명령), `.claude/skills/ui-design/SKILL.md`
  - 본보기(화면): `tools/wireframes/drafts/phone/session.tsx`의 secret card("Secrets are typed on the computer …"), `tools/wireframes/drafts/phone/more.tsx`의 Settings·"A computer"
  - 지금 code: `packages/mobile/src/screens/session/ask.tsx`의 `InputRequest`, `packages/mobile/src/data/images.ts`(`base64Of`, upload를 `call`의 `{input, base64}`로 싣는 본보기), `packages/mobile/src/screens/settings/index.tsx`의 `ComputerScreen`
- 계약:
  - 쓰는 것(`setup-provider`가 고정했다): `input_request/answer_secret`(upload `{input: {session, tool_call, bytes}, base64}`), `providers/connect-key`(upload `{input: {target: {definition}, bytes}, base64}`), `providers/sign-in`(`{definition}`이나 `{request: {session, tool_call}}`), `providers/sign-in-state`(`{login}`, `StateChanged{providers}`로 다시 읽는다), `providers/login-cancel`, `oauthFlowOf`. 읽기 `providers/list`, `providers/definitions`. `setup-scope`의 규칙: 이 폰에 터미널 입력 허락이 없으면 이 route들이 `forbidden`이다.
  - 내놓는 것: 없음.

## 정한 것

- 값은 `TextInput`(`secureTextEntry`, 자동 고침·자동 채움 끔)에서 받아 React state에 두지 않고 `useRef`에만 둔다. 보낸 뒤와 화면을 떠날 때 비운다. log, 저장소(local store, 보안 저장소), 오류 글에 넣지 않는다. 길이는 보내기 전에 1 byte 이상 `SECRET_INPUT_MAX_BYTES` 이하인지 본다.
- 허락이 없는 폰은 `forbidden`을 받으면 그 까닭과 허락을 켜는 곳(컴퓨터의 Settings에 있는 기기 목록)을 한 줄로 보인다. 허락을 미리 묻는 route를 만들지 않는다.
- 폰의 로그인은 device code(`oauthFlowOf`가 `device_code`)만이다. 주소를 `Linking.openURL`로 열고 code를 복사할 수 있게 보인다. loopback 로그인, 앱 OAuth, MCP OAuth, site login 요청(`kind: login`)은 지금처럼 컴퓨터에서 한다는 한 줄이다(README 범위 밖).
- 폰에는 Custom provider, 끊기, 기본 model 화면을 두지 않는다. 기본 model은 대화의 model 고르기가 전역 기본이 없을 때 그것을 저장한다(`architecture/agent-definition.md` 74).
- secret card에 답한 뒤와 로그인이 끝난 뒤 요청을 끝내는 것은 core다. 폰은 `input_request/done`을 부르지 않는다.

## 할 일

1. gallery 먼저(`tools/wireframes/drafts/phone/`): `session.tsx`의 secret card를 입력 칸과 [Save]가 있는 모양으로, provider sign_in card를 device code 모양(주소 열기, code, 기다림, 끝남)으로 고친다. `more.tsx`의 "A computer"에 Providers 줄과 Providers 화면(연결된 목록, 연결할 정의 목록, API key sheet, device code sheet, 허락 없음 한 줄)을 더한다. 화면 설명(caption)은 한국어 한두 문장이다. `index.tsx`의 flow 높이·설명을 맞춘다.
2. `packages/mobile/src/data/setup.ts`: 위 route를 부르는 함수(값 bytes를 `base64Of`로 싣는 upload 둘, 로그인 시작·상태 따라가기·그만두기, provider 목록과 정의 읽기). React Native를 import하지 않는다.
3. `ask.tsx`의 `InputRequest`: `kind: secret`이면 입력 칸과 [Save]·[Cancel], provider sign_in이고 device code면 로그인 흐름, 그 밖은 지금의 한 줄. `mobile.session.notice.secret-on-computer`는 쓰는 곳이 없어지면 catalog에서 지운다.
4. Providers 화면: `screens/settings/` 안 새 file, `ComputerScreen`에 줄 하나, `nav.ts`의 `Place`에 `{name: "providers"; key: string}`, `routes.tsx`에 화면을 더한다. 연결된 줄은 `providers/list`, 연결할 줄은 `providers/definitions`에서 이미 연결된 정의를 뺀 것이다(API key 정의는 key sheet, device code 정의는 로그인 sheet).
5. 문구는 `@lophn/i18n` key다. 폰에만 있는 문장은 `mobile.`로 시작한다(`architecture/remote.md` 지키는 것 7).

## 끝남

- `npm run check`가 통과하고 `npm run wireframes`가 되며 gallery `phone-session`, `phone-settings`가 새 모양을 그린다.
- `cd packages/mobile && npm ci && npm run typecheck && npm test`가 통과한다.
- 위험 test: 없음(값과 범위의 경계는 `setup-provider`, `setup-scope`의 test가 본다). emulator나 서버를 띄우는 test, E2E는 만들지 않는다. 실제 폰에서의 확인은 끝난 뒤 사람에게 부탁한다(계획 README "lead가 할 일").
- 남지 않음: `grep -rn "Secrets are typed on the computer" tools packages`가 0줄이다. `grep -rn "secret-on-computer" packages`가 0줄이다.

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

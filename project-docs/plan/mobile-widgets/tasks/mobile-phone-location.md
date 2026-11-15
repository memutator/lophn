# mobile-phone-location

폰이 core의 `request`에 답하게 한다. 먼저 일반 고리를 짓는다: 폰이 답하는 kind의 표, `hello.capabilities`에 그 kind를 적기, `request` frame을 받아 kind의 handler를 부르고 같은 `id`의 `response`를 보내기, 앱이 앞에 없으면 답하지 않고 `unavailable`. 그 위에 첫 kind `location.get`(`expo-location`, 앞에 있을 때 한 번)을 단다. 단계 10의 `drive.*`는 같은 표에 handler를 더한다.

- 단위: phone-link (wave 10)
- 선행: mobile-phone-link, mobile-phone-use-grant. `packages/mobile`의 native build file을 이 계획의 앞 native task(`mobile-shortcut-native`) 뒤에 고친다
- 소유(이 task만 고친다):
  - `packages/mobile/src/link`(새 폴더: `answer.ts`, `location.ts`, `answer.test.ts`)
  - `packages/mobile/src/connection/connection.ts`(`hello`의 `capabilities` 줄과 `request` frame을 `link`로 넘기고 `response`를 보내는 만큼만)
  - `packages/mobile/app.json`
  - `packages/mobile/package.json`
  - `packages/mobile/package-lock.json`
- 읽을 것:
  - 계약: `packages/protocol/phone/{link,kinds}.ts`(frame, `location.get`의 input·output, `unavailable` 이유, `os_permission_denied`), `packages/protocol/remote/frames.ts`(`mobile-phone-link`가 union에 넣었다)
  - 폰 앱: `packages/mobile/src/connection/connection.ts`(`hello`를 보내는 곳, frame을 받는 곳), `packages/mobile/src/data/mod.ts`(연결의 수명), `packages/mobile/README.md`(dev build, 개발 core)
  - Expo Location 문서(설치한 판): foreground 권한 묻기, 위치 서비스가 켜졌는가, `getCurrentPositionAsync`의 accuracy, `getLastKnownPositionAsync`의 `maxAge`
  - 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/widgets-survey.md`의 2.3("First capability", 표), 계획 `README.md`의 "정한 것"(앞에 있을 때만, banner·기록 없음, background 위치 없음)
- 계약:
  - 쓰는 것: `request {id, kind, input, deadline_ms}`, `response {id, ok, value | error}`
  - 내놓는 것:
    - `packages/mobile/src/link/answer.ts`: `PHONE_HANDLERS: Record<kind, (input, ctx) => Promise<Result>>`, `phoneCapabilities(): string[]`(`hello.capabilities`에 싣는다), `answerRequest(frame, deps): Promise<response frame>`. 규칙: 모르는 kind는 `unavailable`(`unsupported`), 앱이 active가 아니면 handler를 부르지 않고 `unavailable`(`phone_in_background`), 입력이 kind의 input schema에 맞지 않으면 `invalid_input`, handler가 던지면 `internal`. 답은 deadline 안에 보낼 때만 보낸다(늦은 답은 core가 버린다)
    - `location.ts`(`location.get`): OS 위치 권한이 없으면 처음 한 번 묻고, 거절이면 `forbidden`(`details.reason: "os_permission_denied"`)이고 위치를 읽지 않는다. 위치 서비스가 꺼져 있으면 `unavailable`(`location_off`). `max_age_ms`가 있으면 그 안의 마지막 위치를 먼저 쓰고, 없으면 accuracy(`low`·`balanced`·`high`)로 한 번 읽는다. 답은 `{lat, lon, accuracy_m, at}`
    - background 위치 권한(`ACCESS_BACKGROUND_LOCATION`)과 foreground service를 manifest에 넣지 않는다. 위치 권한 글(app.json의 `expo-location` plugin): "lophn shares your location with an app on your computer when you allowed that app to use it."

## 할 일

1. `answer.ts`와 `location.ts`(native 호출은 인자로 받는 얇은 port 뒤에 둔다. test가 fake를 넣는다).
2. `connection.ts`: `hello.capabilities`를 `phoneCapabilities()`로, 받은 `request`를 `answerRequest`로, 결과를 `response`로 보낸다. 모르는 frame에 연결을 닫던 규칙이 있으면 `request`만 받게 한다.
3. `expo-location`을 판을 고정해 더하고(`app.json` plugin, `package.json`, lock), dev build를 다시 짓는다.
4. `answer.test.ts`: 위험 test(아래).
5. emulator(port 5604, Metro 8244)에서 끝까지 확인한다: `-read-only -memory 2048 -port 5604`, 모든 adb 명령에 `-s emulator-5604`, 끝나면 `adb -s emulator-5604 emu kill`, gradle은 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process`, 사람의 실제 폰(serial `R3CT90K6G2X`)에는 아무 명령도 보내지 않는다. 개발 core(`tools/remote-dev.ts`)에 `phone.use`를 선언하고 동의받은 작은 앱(`@lophn/cap-phone`의 `getLocation`을 command에서 부른다)을 두고: `adb -s emulator-5604 emu geo fix 126.978 37.5665` 뒤 command가 그 위치를 받는다, OS 권한을 거절하면(`pm revoke ... ACCESS_FINE_LOCATION`·`ACCESS_COARSE_LOCATION`) `forbidden`, 위치 서비스를 끄면 `location_off`, 앱을 뒤로 보내면 `phone_in_background`나 `phone_unreachable`, 폰 앱을 끄면 `phone_unreachable`. lophn banner가 뜨지 않는 것을 본다. 그림은 `.dev-data/mobile-phone-location/shots/`(OS 권한 창, Android 위치 표시).

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check`가 통과한다. dev build가 지어진다.
- 위험 test: "OS 위치 권한이 거절됐거나 모르는 kind거나 앱이 active가 아니면 위치를 읽는 native 호출을 하지 않고 `forbidden`·`unavailable`로 답한다"(`answer.test.ts`. fake port로. 폰의 위치가 사람이 모르는 때 읽히지 않게 하는 경계다)
- 남지 않음: 없음

- flows catalog: 이 task가 더하거나 지우는 입구와 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 더한 의존성과 판, manifest에 더한 권한(background 권한이 없다는 것), 끝까지 확인한 다섯 경우의 결과와 걸린 시간, 그림 목록.

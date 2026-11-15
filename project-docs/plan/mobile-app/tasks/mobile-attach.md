# mobile-attach

대화의 "Add to the message" sheet에 사진(Photos), 카메라(Camera), 파일(Files)을 넣는다. wave 3는 dev build에 native module이 없어 이 줄들을 뺐다. native module 둘을 더하고 dev build를 다시 짓는다.

- 단위: mobile-app (wave 4)
- 선행: mobile-session
- 소유(이 task만 고친다):
  - `packages/mobile/package.json`, `packages/mobile/package-lock.json`, `packages/mobile/app.json`
  - `packages/mobile/src/screens/session/attach.tsx`(새 file)
  - `packages/mobile/src/screens/session/sheets.tsx`(첨부 sheet 부분만)
  - `packages/mobile/src/screens/session/conversation.tsx`(고른 첨부를 composer에 싣고 보내는 만큼만)
  - `packages/mobile/src/data/attach.ts`(새 file)
  - `packages/design/i18n/catalog/mobile-session.ts`(첨부의 key만)
- 한 줄씩 허락(고친 줄을 "넘길 줄"에 적는다): `packages/mobile/src/data/mod.ts`(새 file을 다시 내보내는 줄), `packages/mobile/README.md`(dev build 절)
- 읽을 것:
  - 기준: `tools/wireframes/drafts/phone/session.tsx`의 첨부 sheet와 caption. 그림 `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/4-session.png`
  - desktop이 첨부를 보내는 길: `packages/shell/renderer/conversation`의 composer(첨부를 고르고, 올리고, message에 싣는 곳)와 그것이 부르는 route. 폰이 부를 수 있는 route는 `packages/protocol/remote/allowlist.ts`에 있는 것뿐이다. bytes를 올리는 route의 한도는 `packages/core/remote/call.ts`(file 하나 8 MiB)
  - 지금의 폰 대화: `packages/mobile/src/screens/session/{conversation.tsx,sheets.tsx}`, `packages/mobile/src/data/mod.ts`의 `useConversation`
  - dev build: `packages/mobile/README.md`
- 계약:
  - 쓰는 것: desktop과 같은 첨부 route와 message 모양. 폰의 route 목록에 그 route가 없으면 고치지 말고 멈추고 보고한다(목록을 여는 것은 lead가 정한다)
  - 내놓는 것: 새 dev build(x86_64) APK의 경로

## 할 일

1. `expo-image-picker`와 `expo-document-picker`를 Expo SDK 58에 맞는 판으로 정확히 고정해 더한다. `app.json`에 사진과 카메라 권한 문구를 넣는다(지금 카메라 문구는 pairing QR만 말한다. 두 쓰임을 같이 말하게 고친다).
2. 첨부 sheet: 최근 사진 줄(권한이 있으면), Photos, Camera, Files. 권한을 거절하면 그 줄이 왜 안 되는지 한 줄로 말하고 설정으로 가는 길을 준다. 고른 것은 composer 위에 작은 줄로 보이고 하나씩 뺄 수 있다. 8 MiB를 넘는 file은 고를 때 말한다.
3. 보내기: desktop과 같은 route로 올리고 같은 모양으로 message에 싣는다. 올리는 동안과 실패를 보인다. 컴퓨터가 offline이면 첨부를 잠근다.
4. dev build를 다시 짓는다(x86_64, `--no-daemon -Pkotlin.compiler.execution.strategy=in-process "-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1536m" --max-workers=3`). APK를 `/tmp/lophn-mobile-app-attach-x86_64.apk`에 둔다(`/tmp/lophn-mobile-app-x86_64.apk`는 다른 worker가 쓰고 있어 덮어쓰지 않는다).
5. emulator(port 5558, Metro 8198, 개발 core의 remote port 47458)에서 새 build로 sheet, 권한 묻기, 고른 뒤의 composer를 찍어 `.dev-data/mobile-attach/shots/`에 둔다. emulator의 사진은 `adb -s emulator-5558 push`로 넣는다. 실제 개발 core로 사진 하나를 올려 message에 실리는지 본다(model이 없어 turn은 돌지 않는다. 올라간 것과 message에 실린 것까지 본다).

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check:full`이 통과한다.
- 위험 test: 없음
- 그림이 wireframe과 같은 구조다(lead가 대조한다).

- flows catalog: 이 task가 더하거나 지우는 route, test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 더한 의존과 판, 쓴 route와 message 모양, 새 APK의 경로와 크기, 권한 문구, 실제 core로 확인한 것과 못 한 것, 그림 목록.

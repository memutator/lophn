# mobile-frame-fixes

`mobile-frame`의 보고에 남은 것 넷을 고친다: Settings의 Text size가 실제로 글 크기를 바꾸고, 폰에서 컴퓨터를 지운 뒤 다시 pairing이 되고, desktop이 pairing code를 글로도 보이고, About이 제품 판을 보인다.

- 단위: mobile-app (wave 3)
- 선행: mobile-frame
- 소유(이 task만 고친다):
  - `packages/design/native/theme.tsx`
  - `packages/design/native/provider.tsx`
  - `packages/design/native/primitives`(글 크기를 읽는 조각이 배율을 곱하게 하는 만큼만)
  - `packages/mobile/src/app/appearance.tsx`
  - `packages/mobile/src/screens/settings`
  - `packages/mobile/src/pairing`
  - `packages/core/remote/pairing.ts`
  - `packages/core/remote/devices.ts`
  - `packages/core/remote/host.ts`
  - `packages/shell/renderer/desktop/settings/remote`
  - `packages/design/i18n/catalog/mobile-app.ts`
- 한 줄씩 허락(공유 file. 고친 줄을 "넘길 줄"에 적는다): `packages/protocol/remote/routes.ts`와 `packages/protocol/remote/allowlist.ts`(아래 2의 route 하나), desktop Settings의 문구가 든 catalog file(아래 3의 key 하나), `packages/core/remote`의 test file(아래 2의 위험 test)
- 읽을 것:
  - `mobile-frame`이 지은 것: `packages/mobile/src/app/{appearance.tsx,nav.ts,frame.tsx}`, `packages/mobile/src/screens/settings/index.tsx`, `packages/mobile/src/screens/start/{pairing.tsx,enter-code.tsx}`, `packages/mobile/README.md`
  - kit: `packages/design/native/{theme.tsx,provider.tsx}`(ThemeProvider, UiProvider, token), `primitives/`(글을 그리는 조각), `packages/design/tokens.ts`
  - pairing: `project-docs/architecture/remote.md`("pairing", "지키는 것"), `packages/core/remote/{pairing.ts,devices.ts,host.ts}`, `packages/mobile/src/pairing/{pair.ts,store.ts}`, `packages/protocol/remote/{frames.ts,routes.ts,allowlist.ts}`
  - desktop의 pairing 화면: `packages/shell/renderer/desktop/settings/remote`(QR을 그리는 곳), wireframe skill `.claude/skills/ui-design`
  - 기준 그림: `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/`의 Settings와 pairing
- 계약:
  - 쓰는 것: `@lophn/ui-native`, `useNav()`, `packages/mobile/src/data/mod.ts`
  - 내놓는 것: kit의 text scale(`UiProvider`나 `ThemeProvider`가 받는 값 하나. 이름은 이 task가 정하고 보고한다), 기기 route 하나(아래 2)

## 할 일

1. **Text size.** kit에 글 크기 배율 하나를 둔다(Small, Default, Large의 세 값. 배율 숫자는 이 task가 정한다). kit의 `Text`와 글 크기를 token에서 읽는 조각이 그 배율을 곱한다. 줄 높이도 같이 간다. 폰 앱의 Appearance가 저장한 값을 kit에 넘긴다. 화면마다 따로 고치지 않는다. kit을 쓰는 다른 화면(wave 3의 다른 task가 짓는 중)은 배율 1에서 지금과 같아야 한다.
2. **지운 컴퓨터와 다시 pairing.** 지금은 폰에서 Remove를 누르면 폰만 잊고, 컴퓨터는 그 폰의 key를 알고 있어 같은 컴퓨터와 다시 pairing하면 "Cannot reach"가 된다. 둘을 고친다.
   - 폰이 Remove할 때 연결되어 있으면 자기 등록을 지우는 기기 route 하나를 부른다(자기 자신만 지운다. 다른 기기는 지울 수 없다. 이름은 지금 route 이름 규칙을 따른다). 닿지 않으면 폰만 잊는다.
   - core는 이미 아는 key가 유효한 pairing code로 `pair`를 보내면 옛 등록을 새 등록으로 바꾼다(code가 틀리거나 지났으면 지금처럼 거절한다). 컴퓨터가 꺼져 있을 때 지운 경우를 이것이 덮는다.
   - Remove 아래의 안내 글을 wireframe의 뜻으로 되돌린다(이 폰을 컴퓨터의 목록에서도 지운다. 닿지 않으면 다음에 pairing할 때 바뀐다).
   - 위험 test(core, 한 file): 기기 자격은 자기 등록만 지울 수 있다. 아는 key의 `pair`는 유효한 code일 때만 등록을 바꾸고, 틀린 code는 옛 등록을 그대로 둔다.
3. **desktop의 "Show as text".** 폰의 "Enter a pairing code instead"가 desktop Settings › Remote의 QR 아래 "Show as text"를 고르라고 안내하는데 desktop에 그 단추가 없다. QR 아래에 그 단추를 두고, 누르면 QR에 든 것과 같은 글과 복사 단추를 보인다. 화면 모양을 바꾸는 것이니 `ui-design` skill대로 그 화면의 wireframe이 있으면 같이 고친다.
4. **About의 판.** Settings › About이 `0.0.0`이 아니라 제품 판(root `package.json`의 `version`)을 보인다.
5. **작은 것.** Settings의 Computers 목록이 컴퓨터마다 자기 이름("Shown as")을 보이는지 확인한다(`mobile-frame`의 그림에서 두 줄이 같은 이름이었다). "UI kit gallery" 줄은 개발 build(`__DEV__`)에서만 보인다.

마지막으로 emulator(port 5576, Metro 8216)에 lead가 지어 둔 dev build `/tmp/lophn-mobile-app-x86_64.apk`를 깔고(native module을 더하지 않는다) Text size 셋과 Remove 뒤 다시 pairing을 그림으로 찍어 `.dev-data/mobile-frame-fixes/shots/`에 둔다. emulator는 그림을 찍을 때만 띄우고 찍으면 바로 끈다.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check:full`이 통과한다.
- 위험 test: 위 2의 하나
- 소유 밖 file을 고치지 않았다(허락한 줄은 "넘길 줄"에).

- flows catalog: 이 task가 더하거나 지우는 route, CLI 명령, IPC channel, test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: text scale의 이름과 배율, 새 route의 이름과 모양, 다시 pairing을 실제 개발 core로 본 것과 못 본 것, 그림 목록.

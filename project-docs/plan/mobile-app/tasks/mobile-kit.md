# mobile-kit

폰 UI kit `@lophn/ui-native`(`packages/design/native`)를 wireframe의 조각과 똑같이 그려지게 다시 짓고, 폰 dev build의 gallery에서 조각과 예시 화면을 보인다.

- 단위: design-native (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/design/native`
  - `packages/mobile/src/gallery`
  - `packages/design/i18n/catalog/mobile-kit.ts`
- 읽을 것:
  - 기준: `tools/wireframes/drafts/phone/phone.module.css`(숫자와 색), `tools/wireframes/drafts/phone/kit.tsx`(조각과 prop), 화면 file `start.tsx`, `shell.tsx`, `apps.tsx`, `session.tsx`, `inbox.tsx`, `workspace.tsx`, `more.tsx`. 그림: `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/*.png`
  - 지금 kit(첫 판, 모양이 wireframe과 다르다): `packages/design/native/mod.ts`와 그 폴더, `packages/mobile/src/gallery/gallery.tsx`
  - desktop kit의 이름과 token: `packages/design/components/*/mod.ts`, `packages/design/tokens.ts`, `packages/design/presets.ts`
  - desktop의 mascot: `packages/shell/renderer/parts/avatar/character.tsx`
  - build와 emulator: `packages/mobile/README.md`, 계획 `README.md`의 "돌리기 전에"
  - 비교 조사(목록과 keyboard): `/home/pyosechang/projects/lophn/reports/phone-native-ui/{t3code,paseo,happy}.md`
- 계약:
  - 쓰는 것: `packages/design/tokens.ts`, `packages/design/components/reading/markdown/{parse,model,stream,cache}.ts`(같은 parse 결과를 그린다)
  - 문구: kit이 스스로 보이거나 읽어 주는 말(Back, Close, Copy code 같은 것)은 `@lophn/i18n`의 `t()`로 쓴다. desktop catalog에 같은 문장이 있으면 그 key를 쓰고, 없을 때만 `mobile-kit.ts`에 `mobile.kit.`으로 시작하는 key를 더한다.
  - 내놓는 것: `@lophn/ui-native`의 export. wave 2, 3의 화면이 이것만으로 wireframe 화면을 조립한다. 이름은 뜻이 같은 것은 desktop `@lophn/ui`와 맞추고(Button, IconButton, Icon, Text, Card, Sheet, Tabs, SegmentedControl, Switch, Checkbox, Field, Input, Badge, Markdown, CodeBlock), 폰에만 있는 것은 뜻대로 짓는다. export마다 윗줄에 "언제 쓰나" 한 줄을 단다(`mod.ts`).

## 할 일

1. theme: 글꼴은 `Pretendard`와 `JetBrainsMono`(app.json의 expo-font 설정이 이미 있다. 굵기 400·500·600). 글자 크기, 색, 반지름, control 크기를 `phone.module.css`의 값으로 맞춘다. light와 dark 둘 다.
2. wireframe `kit.tsx`와 `phone.module.css`의 조각을 하나씩 component로 옮긴다. 숫자(px)는 그대로 dp다. 빠짐없이:
   - 틀: Screen(safe area, keyboard를 따라 올라오는 footer), TopBar(left `menu|back|close|none`, lead, title, sub, under, right, 단추의 점), Label, Row(lead, title, sub, end, strong, dim, wrap), 구분선, Group·ListCard·Card·Plain 표면, Banner, Toast, Fab
   - 표시: Dot(warning, good, critical, off), Badge, Tag, Mark(project·app, 크기 셋, tone), StatusMark, Pre(mono 상자), Stat(label과 큰 숫자)
   - 조작: Button(primary, 기본, ghost, danger × sm, md, lg, block, disabled, 앞 아이콘), IconButton, Field와 Input(focus, soft), Switch, Radio·Checkbox, Tabs(밑줄), SegmentedControl, filter chip, Chip(입력 칸의 고르기)
   - 떠오르는 것: Sheet(grabber, 제목, 끌어 내려 닫기, keyboard 위로), Menu 행
   - sidebar 조각: nav 행, workspace 행, session 행(얼굴, 제목, 상태 점), 묶음 label, worktree label, 컴퓨터 고르기 줄
   - 대화: 내 말풍선과 아래 note, agent turn(얼굴과 이름), 한 일 줄(Act), 고친 file card, CodeBlock, Markdown(chat·reading), Working 줄, meta 줄, 기다림 card(승인: 제목·fact·단추 두 줄 / 질문: 넘기기·고르기·직접 쓰기·Next / secret 안내), DiffLine, Composer(글, 아래 줄에 +·chip·보내기/멈춤, 위에 첨부), MessageList(뒤집은 목록, 최신 따라가기, 최신으로 가기 단추)
   - 얼굴: mascot(`character.tsx`의 path와 색을 react-native-svg로)은 lophn 것이므로 kit이 아니라 `packages/mobile/src/parts`에 간다(wave 2). kit의 조각은 얼굴 자리를 `ReactNode`로 받는다. gallery에서는 `packages/mobile/src/gallery` 안에 임시로 그려 쓴다.
3. 첫 판의 조각 가운데 wireframe에 없는 것(아래 TabBar 등)은 지운다.
4. gallery(`packages/mobile/src/gallery`)를 다시 쓴다: (가) 조각마다 상태별 견본, (나) kit으로 조립한 예시 화면: Welcome, Home, Sidebar가 열린 모습, Session 넷(Answer, Working, Approval, Question), 한 일 sheet, Inbox Now, 앱 화면(Orders), Settings. data는 wireframe의 것을 쓴다. light·dark를 gallery 안에서 바꾼다.
5. emulator(port 5562, Metro 8202)에서 gallery의 page마다 그림을 찍어 `.dev-data/mobile-kit/shots/`에 둔다(light 전부, dark는 Home·Session Approval·Sidebar). wireframe 그림과 나란히 놓고 어긋난 곳(간격, 글자 크기와 굵기, 색, 반지름, 줄바꿈)을 고친 뒤의 그림이어야 한다.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root의 `npm run check:full`이 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "TabBar" packages/design/native packages/mobile/src`가 0줄이다.
- gallery의 예시 화면이 wireframe 그림과 같은 구조·크기·색으로 그려진다(lead가 그림으로 대조한다).
- native module을 더하지 않았다(있는 것: react-native-svg, reanimated, worklets, gesture-handler, keyboard-controller, safe-area-context, expo-font, expo-haptics, expo-clipboard). 더 필요하면 더하지 말고 보고한다. `packages/mobile/package.json`, `packages/mobile/app.json`, `packages/mobile/metro.config.js`, `packages/mobile/tsconfig.json`은 이 task의 것이 아니다. 고칠 것이 있으면 보고한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 옮긴 조각 목록(wireframe 이름 → kit export), 그림 file 목록, wireframe과 일부러 다르게 한 곳과 이유.

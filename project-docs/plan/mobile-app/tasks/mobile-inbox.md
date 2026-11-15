# mobile-inbox

Inbox(Now, 앱 새 판 살펴보기, History, 빈 상태)를 wireframe대로 짓는다.

- 단위: mobile-app (wave 3)
- 선행: mobile-frame
- 소유(이 task만 고친다):
  - `packages/mobile/src/screens/inbox`
  - `packages/design/i18n/catalog/mobile-inbox.ts`
- 읽을 것:
  - 기준: `tools/wireframes/drafts/phone/inbox.tsx`의 `Now`, `Update`, `History`, `Empty`와 caption(`Lock`은 짓지 않는다). 그림: `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/5-inbox.png`
  - desktop의 같은 화면: `packages/shell/renderer/desktop/connection/waiting/`(항목의 종류와 답하는 법), 조사 `/home/pyosechang/projects/lophn/reports/phone-native-ui/lophn-inventory.md`의 D
  - kit과 뼈대: `packages/design/native/mod.ts`, `packages/mobile/src/app/nav.ts`, `packages/mobile/src/parts`, `packages/mobile/src/data/mod.ts`
  - 계획 `README.md`의 "정한 것"과 "돌리기 전에", `packages/mobile/README.md`
- 계약:
  - 쓰는 것: `@lophn/ui-native`, `useNav()`, `packages/mobile/src/data/mod.ts`. kit에 없는 조각이 필요하면 자기 영역 폴더에 두고 보고한다(kit은 고치지 않는다). data에 없는 읽기가 필요하면 자기 소유의 data file에 더한다.
  - 문구: `@lophn/i18n`의 `t()`로 쓴다. desktop catalog(`packages/design/i18n/catalog/*.ts`)에 같은 문장이 있으면 그 key를 쓰고, 없을 때만 자기 catalog file에 `mobile.`으로 시작하는 key를 더한다. 문장 조각을 이어 붙이지 않는다(ICU 한 문장). 지어낸 예시 data는 그대로 둔다.
  - 내놓는 것: 자기 영역의 `index.tsx`가 export하는 화면

## 할 일

1. Now: 종류마다 띠와 수(Permission requests, Questions, App updates, Jobs, 그 밖에 desktop waiting model이 내는 종류 전부). 항목은 얼굴, 제목, 시각, 설명, 어디서 온 것인지, fact, 오른쪽 끝의 단추(주 단추가 맨 오른쪽). 제목을 누르면 그 session으로 간다. 답하면 항목이 사라지고 실패하면 그 자리에 이유를 보인다.
2. 앱 새 판 살펴보기: 이 판이 새로 얻는 것과 data loss를 desktop과 같은 줄로 보이고 Deny·Allow.
3. History: 내가 답한 기록, 찾기와 종류 거르기.
4. 빈 상태. 그리고 컴퓨터가 offline이면 마지막으로 본 항목을 흐리게 두고 답하기 단추를 잠근다.

마지막으로 emulator(port 5570, Metro 8210)에 lead가 지어 둔 dev build `/tmp/lophn-mobile-app-x86_64.apk`를 깔고(native module을 더하지 않는다) sample 컴퓨터로 화면마다 그림을 찍어 `.dev-data/mobile-inbox/shots/`에 둔다(light 전부, dark 둘). 개발 core(`tools/remote-dev.ts`)에 pairing해 실제 data로 한 번씩 동작을 확인하고, 못 본 것은 "확인 못 함"으로 적는다.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check:full`이 통과한다.
- 위험 test: 없음
- 그림이 wireframe과 같은 구조·크기·색이다(lead가 대조한다).
- 소유 밖 file을 고치지 않았다.

- flows catalog: 이 task가 더하거나 지우는 route, CLI 명령, IPC channel, test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 그림 목록, wireframe과 다르게 한 곳과 이유, 실제 core로 확인한 것과 못 한 것.

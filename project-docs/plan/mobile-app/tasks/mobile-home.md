# mobile-home

Home 화면, 컴퓨터가 offline일 때의 Home, 검색을 wireframe대로 짓는다.

- 단위: mobile-app (wave 3)
- 선행: mobile-frame
- 소유(이 task만 고친다):
  - `packages/mobile/src/screens/home`
  - `packages/mobile/src/screens/search`
  - `packages/mobile/src/data/search.ts`
  - `packages/design/i18n/catalog/mobile-home.ts`
- 읽을 것:
  - 기준: `tools/wireframes/drafts/phone/shell.tsx`의 `HomeScreen`, `Offline`, `SearchScreen`과 caption. 그림: `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/2-home-and-sidebar.png`
  - kit과 뼈대: `packages/design/native/mod.ts`, `packages/mobile/src/app/nav.ts`, `packages/mobile/src/parts`, `packages/mobile/src/data/mod.ts`
  - 계획 `README.md`의 "정한 것"과 "돌리기 전에", `packages/mobile/README.md`
- 계약:
  - 쓰는 것: `@lophn/ui-native`, `useNav()`, `packages/mobile/src/data/mod.ts`. kit에 없는 조각이 필요하면 자기 영역 폴더에 두고 보고한다(kit은 고치지 않는다). data에 없는 읽기가 필요하면 자기 소유의 data file에 더한다.
  - 문구: `@lophn/i18n`의 `t()`로 쓴다. desktop catalog(`packages/design/i18n/catalog/*.ts`)에 같은 문장이 있으면 그 key를 쓰고, 없을 때만 자기 catalog file에 `mobile.`으로 시작하는 key를 더한다. 문장 조각을 이어 붙이지 않는다(ICU 한 문장). 지어낸 예시 data는 그대로 둔다.
  - 내놓는 것: 자기 영역의 `index.tsx`가 export하는 화면

## 할 일

1. Home: 오른쪽 위 컴퓨터 chip(누르면 Computers sheet), Needs you(Inbox의 앞 항목들. 승인은 그 자리에서 Deny·Allow once로 답하고, 질문과 그 밖은 누르면 Inbox의 그 항목으로 간다. 오른쪽 끝 `Inbox · n`은 Inbox로), Apps(앱 workspace의 표식 줄. 누르면 그 앱 workspace. New app은 이 계획에서 짓지 않으니 두지 않는다), Working now(일하는 중인 session), 맨 아래 입력 칸(보내면 Home workspace의 새 session이 열려 그 대화로 간다. workspace chip으로 다른 workspace를 고른다).
2. 컴퓨터가 offline이나 connecting이면 wireframe `Offline`처럼: banner와 Try again, 흐린 줄, 입력 칸이 잠긴다.
3. 검색: session, workflow, file, job, agent를 한 칸에서 찾는다. route가 있는 것만 찾고(`mobile-routes` 보고의 표), 없는 묶음은 그리지 않는다. 폰이 이미 읽은 목록(session, agent, job)은 화면에서 거른다.

마지막으로 emulator(port 5566, Metro 8206)에 lead가 지어 둔 dev build `/tmp/lophn-mobile-app-x86_64.apk`를 깔고(native module을 더하지 않는다) sample 컴퓨터로 화면마다 그림을 찍어 `.dev-data/mobile-home/shots/`에 둔다(light 전부, dark 둘). 개발 core(`tools/remote-dev.ts`)에 pairing해 실제 data로 한 번씩 동작을 확인하고, 못 본 것은 "확인 못 함"으로 적는다.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check:full`이 통과한다.
- 위험 test: 없음
- 그림이 wireframe과 같은 구조·크기·색이다(lead가 대조한다).
- 소유 밖 file을 고치지 않았다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 그림 목록, wireframe과 다르게 한 곳과 이유, 실제 core로 확인한 것과 못 한 것.

# page-view-phone

폰 앱에 agent page를 보는 화면을 짓는다: 그 컴퓨터의 page 목록, page 하나의 그림, 손가락(누르기, 끌기, 굴리기)과 keyboard, 주소로 가기·뒤로·다시 읽기, 잡기와 놓기, 그리지 않는 page의 이유. 화면 없는 기계의 로그인을 사람이 폰으로 하는 길이다.

- 단위: page (wave 3)
- 선행: page-view-core
- 소유(이 task만 고친다):
  - `tools/wireframes/drafts/phone/page.tsx`(새 file), `tools/wireframes/drafts/phone/index.tsx`
  - `packages/mobile/src/data/page.ts`(새 file), `packages/mobile/src/screens/page/`(새 폴더)
  - `packages/mobile/src/app/nav.ts`, `packages/mobile/src/app/routes.tsx`, `packages/mobile/src/app/sidebar.tsx`
  - `packages/mobile/src/data/sample.ts`(sample 컴퓨터의 `page_view/*` 답만)
  - `packages/design/i18n/catalog/mobile-page.ts`(새 file), `packages/design/i18n/en.ts`(한 줄)
- 읽을 것:
  - 계획 README "정한 것 › 멀리서 보기"(보는 화면은 둘, 보는 것은 내 기기 모두, 다루는 것은 터미널 입력을 허락받은 기기)
  - architecture: `project-docs/architecture/browser-tab.md`의 "멀리서 보기" 절, `remote.md` 지키는 것 1(화면은 기기 route 목록 밖을 부르는 단추를 보이지 않는다)
  - 본보기(화면): `tools/wireframes/drafts/phone/terminal.tsx`(flow 12)와 `packages/mobile/src/screens/terminal/`, `packages/mobile/src/data/terminal.ts`(lease 갱신 `LEASE_EVERY_MS`, event 뒤 다시 읽기, 입력 key, `terminal.test.ts`)
  - `.claude/skills/ui-design/SKILL.md`, `packages/mobile/README.md`
- 계약:
  - 쓰는 것: `page_view/list|snapshot|watch|input|control|open`, `PageInput`, `PageFrame`, `PAGE_VIEW_RENEW_MS`(`packages/protocol/lophn-agent/page-view.ts`), event `PageViewChanged`, `StateChanged{browser_pages}`
  - 내놓는 것: 없음

시작 전에 다시 볼 것(lead가 2026-11-18 main 0.23.84에 대 보았다: 아래 file과 `LEASE_EVERY_MS`, flow 12 `phone-terminal`이 그대로다. `device-roster`와 `core-terminals`는 land되었고 `core-setup`은 아직 열려 있다): `device-roster`의 `roster-client`가 폰의 컴퓨터 목록과 연결을, `core-terminals`의 `term-phone`과 `core-setup`의 `setup-phone`이 `nav.ts`·`routes.tsx`·`sidebar.tsx`를 고쳤을 수 있다. merge된 file 위에서 짓는다.

## 할 일

1. wireframe 먼저(`ui-design` skill): `drafts/phone/page.tsx`에 flow "Phone · 13 Agent pages"를 그리고 `drafts/phone/index.tsx`의 `FLOWS`에 id `phone-pages`로 더한다. 그릴 것: 그 컴퓨터의 page 목록(제목, 주소, 연 agent 또는 "You"), page 보기(그림이 폭에 맞고 위에 주소 칸·뒤로·다시 읽기, 아래에 keyboard 열기와 key 줄), agent가 다루는 중(“<agent> is using this page” 와 [Take control]), 잡은 뒤([Hand back]), 그리지 않음(이유 한 줄), 다룰 수 없는 기기(입력 줄 없이 보기만, 터미널 입력을 켜라는 안내), 새 page 열기(주소 칸, 다룰 수 있는 기기만). 모양은 flow 12의 부품(`kit.tsx`)으로 맞춘다.
2. `data/page.ts`: `terminal.ts`의 feed 꼴을 옮긴다. 보는 동안 `page_view/watch {on:true}`를 `PAGE_VIEW_RENEW_MS`마다, 떠날 때 `{on:false}`. `PageViewChanged`(그 탭)가 오면 `page_view/snapshot`을 다시 읽되 읽는 중이면 끝난 뒤 한 번만 더 읽는다(그래서 느린 연결에서는 읽어 간 만큼만 다음 frame이 온다). 목록은 `page_view/list`이고 `StateChanged`의 `browser_pages`에 다시 읽는다. 입력은 `page_view/input`에 key(`newId`)를 붙인다.
3. `screens/page/`: 목록과 page 보기 두 화면.
   - 그림은 `data:image/jpeg;base64,…`의 `Image`이고 비율은 frame의 width·height다. 누른 점은 그린 크기에 대한 비율로 frame의 CSS px에 옮긴다(x = 누른 x / 그린 폭 × width). 누르기는 pointer down·up, 끌기는 move(누른 동안, 초당 30번까지), 두 손가락 굴리기는 scroll이다.
   - keyboard 칸의 글은 `text`, key 줄(Enter, Backspace, Tab, 화살표)은 `key`다. 이름은 `keys.ts`의 것과 같게 쓴다.
   - 주소 칸은 `navigate`, 단추는 `back`·`reload`. 잡기·놓기는 `page_view/control`.
   - snapshot의 `control`이 false면 입력, 잡기, 새 page 열기를 그리지 않는다. `painting`이 false면 마지막 그림 위에 이유를 보인다. `frame`이 null이면 기다림 표시다.
4. `nav.ts`·`routes.tsx`에 화면 둘을 더하고, `sidebar.tsx`에서 그 컴퓨터의 page 목록으로 가는 줄을 wireframe대로 둔다. `sample.ts`의 sample 컴퓨터가 `page_view/*`에 고정 그림 하나로 답하게 한다(dev build에서 화면을 본다).
5. 글은 `mobile-page.ts` catalog의 key로 쓴다(`en.ts`에 한 줄). 화면 test는 쓰지 않는다.

정한 것:
- 끌기 move는 누른 동안만 보낸다: hover가 없는 폰에서 떼어 둔 move는 쓸 데가 없다.
- 새 page 열기는 목록 화면의 주소 칸 하나다: 로그인하려는 사람이 그 기계에 page를 여는 가장 짧은 길이다.

## 끝남

- `npm run check`가 통과한다. `npm run wireframes`가 되고 gallery의 `phone-pages`가 그려진다.
- `cd packages/mobile && npm ci && npm run typecheck && npm test`가 통과한다.
- 위험 test: 없음(입력 자격은 core가 본다, `page-view-core`).
- 남지 않음: 없음.

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

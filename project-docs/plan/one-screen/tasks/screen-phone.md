# screen-phone

폰의 목록 하나에 짝지은 모든 컴퓨터의 session이 보인다. "컴퓨터 고르기"는 줄마다의 컴퓨터 꼬리표와 거르기(모두 / 컴퓨터 하나)가 된다. 줄을 누르면 그 컴퓨터의 것으로 열린다. 폰은 이미 컴퓨터마다 연결과 data 묶음(`ComputerData`)을 따로 든다.

- 단위: screen (wave 2)
- 선행: screen-base-core, screen-base-scope.
- 소유(이 task만 고친다):
  - `packages/mobile/src/`(data, app, screens, open)
  - `packages/remote-client/{computers,computers_test}.ts`
  - `tools/wireframes/drafts/phone/`
  - `packages/design/i18n/catalog/{mobile-home,mobile-places,mobile-app}.ts`
  - `project-docs/flows/areas/sessions.yaml`(폰 줄만)
- 읽을 것:
  - 계획 README "정한 것 › 폰", "Home은 기계마다 따로다"
  - architecture: `project-docs/architecture/remote.md`의 모델(뼈대, 갈 곳 `Place`, 목록, 컴퓨터)
  - 조사 `reports/multi-device/survey-n1-one-screen.md` G10, 부록 B의 "Phone" 줄, 4의 "Phone open targets already carry the computer"
  - 지금 code: `packages/mobile/src/data/{hooks.tsx,link.ts,workspaces.ts,lists.ts}`(`useComputers`, `useCurrentComputer`, `useComputerData`, `DataProvider`), `packages/mobile/src/app/{sidebar.tsx,computers-sheet.tsx,nav.ts}`, `packages/mobile/src/screens/home/`, `packages/mobile/src/open/{target.ts,opener.tsx}`(`OpenTarget.host`으로 컴퓨터를 고른 뒤 연다), `packages/remote-client/computers.ts`(`current`)
  - `packages/mobile/README.md`(dev build, pairing), `.claude/skills/ui-design/SKILL.md`
- 계약:
  - 쓰는 것: `ComputerData`(`mobile/src/data/link.ts`), `OpenTarget`(`mobile/src/open/target.ts`), desktop의 `events/*`·`waiting/*`·`conversation/agent-tab-*`(import만. `screen-lists`가 export를 더하기만 한다)
  - 내놓는 것: 없음

## 할 일

1. wireframe 먼저(`ui-design` skill): `tools/wireframes/drafts/phone/`의 `phone-shell`(sidebar)과 Home page에 컴퓨터 꼬리표가 붙은 줄과 거르기를 그린다. 지금의 컴퓨터 고르기 sheet(`phone-shell`의 컴퓨터 줄)는 거르기가 된다. 꺼진 컴퓨터는 이름과 상태 한 줄이 남는다. 새 page id를 더하면 `drafts/phone/index.tsx`에 올린다.
2. data: 컴퓨터마다의 `useComputerData(key)`로 session 목록과 대기 수를 읽어 줄에 컴퓨터 key를 단 하나의 목록으로 합친다. 합친 목록의 key(`WorkspaceView.key`, sidebar `lineOf`, 쌍 key)는 앞에 컴퓨터 key를 붙인다(같은 앱 id와 `"home"`이 컴퓨터마다 같다). Home은 컴퓨터마다 따로 줄이다(합치지 않는다). 저장 목록과 icon은 지금처럼 컴퓨터 key마다다(`saved.ts`. 옮길 것이 없다).
3. 열기: 줄을 누르면 그 컴퓨터를 `current`로 고르고 연다(`OpenTarget`의 길). 거르기는 목록만 거르고 연결은 그대로 둔다. `Place`에는 컴퓨터를 넣지 않는다: 열린 화면은 지금처럼 `current` 컴퓨터의 것이다.
4. 거르기 값은 폰 설정에 남긴다(앱 file. `~/.lophn`이 아니다). 컴퓨터가 명단에서 빠지면 "모두"로 돌아간다.
5. 글은 `mobile-home.ts`, `mobile-places.ts`, `mobile-app.ts`의 key다. 바뀐 폰 흐름이 flows `sessions.yaml`의 폰 줄과 다르면 고친다(`flows` skill).

### 정한 것
- `Place`에 컴퓨터를 넣지 않고 여는 순간 `current`를 바꾼다: 폰의 stack과 화면은 한 컴퓨터의 data context 위에 서 있고, 열기 길(`OpenTarget`)이 이미 이 순서다.
- 거르기는 폰마다의 화면 설정이다: 컴퓨터 쪽 data를 바꾸지 않는다.

## 끝남

- `npm run check`가 통과한다. `cd packages/mobile && npm ci && npm run typecheck && npm test`가 통과한다. `npm run wireframes`가 되고 바꾼 phone draft page가 그려진다.
- 위험 test: 없음(목록 모양이다. 저장 목록은 컴퓨터 key마다 그대로라 잃는 data가 없다).
- 남지 않음: 컴퓨터 고르기를 지웠으면 그 글 key를 앞부분으로 grep해 `packages tools tests`에 0줄이다.
- emulator와 실제 폰 확인은 사람에게 부탁한다(lead). E2E를 만들지 않는다.

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

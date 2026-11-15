# mobile-session

대화 화면과 거기서 열리는 것(한 일 sheet, diff, 첨부, model, session menu, 새 session, agent 고르기)을 wireframe대로 짓는다.

- 단위: mobile-app (wave 3)
- 선행: mobile-frame, mobile-routes
- 소유(이 task만 고친다):
  - `packages/mobile/src/screens/session`
  - `packages/design/i18n/catalog/mobile-session.ts`
- 읽을 것:
  - 기준: `tools/wireframes/drafts/phone/session.tsx` 전부와 caption. 그림: `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/4-session.png`
  - desktop의 같은 화면(무엇을 어떤 줄로 보이는지): `packages/shell/renderer/conversation/agent-thread.tsx`, 조사 `/home/pyosechang/projects/lophn/reports/phone-native-ui/lophn-inventory.md`의 A.1~A.3
  - 목록과 keyboard를 다룬 법: `/home/pyosechang/projects/lophn/reports/phone-native-ui/{t3code,paseo,happy}.md`
  - kit과 뼈대: `packages/design/native/mod.ts`, `packages/mobile/src/app/nav.ts`, `packages/mobile/src/parts`, `packages/mobile/src/data/mod.ts`
  - 계획 `README.md`의 "정한 것"과 "돌리기 전에", `packages/mobile/README.md`
- 계약:
  - 쓰는 것: `@lophn/ui-native`, `useNav()`, `packages/mobile/src/data/mod.ts`. kit에 없는 조각이 필요하면 자기 영역 폴더에 두고 보고한다(kit은 고치지 않는다). data에 없는 읽기가 필요하면 자기 소유의 data file에 더한다.
  - 문구: `@lophn/i18n`의 `t()`로 쓴다. desktop catalog(`packages/design/i18n/catalog/*.ts`)에 같은 문장이 있으면 그 key를 쓰고, 없을 때만 자기 catalog file에 `mobile.`으로 시작하는 key를 더한다. 문장 조각을 이어 붙이지 않는다(ICU 한 문장). 지어낸 예시 data는 그대로 둔다.
  - 내놓는 것: 자기 영역의 `index.tsx`가 export하는 화면

## 할 일

1. 대화: 위 줄(sidebar 단추, 얼굴, agent 이름과 session 제목, ⋯), thread(desktop `ThreadEntry`의 종류를 빠짐없이 그린다: 내 말과 delivery note, agent 글, 한 일 줄, 고친 file card, subagent·call 줄, 승인·질문의 지난 결과 줄, turn 끝, provider 오류와 Retry, info 줄, shell 실행. wireframe에 없는 종류는 가장 가까운 줄 모양으로 그리고 보고한다), 오는 글(live), Working 줄, 입력 칸 위의 기다림 card(승인의 고르기는 source가 주는 것 그대로, 질문 넘기기와 직접 쓰기, secret·login은 '컴퓨터에서 넣으라'는 안내), 입력 칸(문구는 상태를 따른다: Reply…, Queue a message…, Describe a task…, 일하는 중이고 빈 칸이면 멈춤).
2. 목록: 최신을 따라가고, 읽으려고 올리면 따라가기를 멈추고 최신으로 가기 단추가 뜬다. keyboard가 올라와도 마지막 글이 가리지 않는다. 긴 대화에서 버벅이지 않는다(줄 component를 memo한다).
3. sheet와 딸린 화면: 한 일 상세(tool의 입력과 출력은 열 때 읽는다), diff, 첨부(사진첩과 camera는 expo의 image picker가 필요하면 더하지 말고 '등록할 것'으로 보고하고 file 고르기 줄만 둔다. workspace의 file 가리키기와 명령·skill은 route가 있을 때만), model과 effort(대화 snapshot의 meta가 model 묶음과 effort 축을 준다. 바꾸기는 `acp/send`의 `set_model`이다. desktop 대화의 picker와 같은 길), session menu(Rename, Permissions 보기, Context, Archive. Show on computer는 core에 route가 없어 두지 않는다).
4. 새 session: workspace와 agent를 고르고 첫 말을 보내면 그 대화로 간다. agent 고르기 sheet는 그 workspace에서 일할 수 있는 agent만 보인다. coding agent는 이 계획에서 열지 않으니 목록에 두지 않는다.
5. coding agent의 session을 열면 thread를 읽기만 보이고 입력 칸 자리에 '이 session은 컴퓨터에서 이어 간다'는 한 줄을 둔다(다루기는 다음 계획).

마지막으로 emulator(port 5568, Metro 8208)에 lead가 지어 둔 dev build `/tmp/lophn-mobile-app-x86_64.apk`를 깔고(native module을 더하지 않는다) sample 컴퓨터로 화면마다 그림을 찍어 `.dev-data/mobile-session/shots/`에 둔다(light 전부, dark 둘). 개발 core(`tools/remote-dev.ts`)에 pairing해 실제 data로 한 번씩 동작을 확인하고, 못 본 것은 "확인 못 함"으로 적는다.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check:full`이 통과한다.
- 위험 test: 없음
- 그림이 wireframe과 같은 구조·크기·색이다(lead가 대조한다).
- 소유 밖 file을 고치지 않았다.

- flows catalog: 이 task가 더하거나 지우는 route, CLI 명령, IPC channel, test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 그림 목록, wireframe과 다르게 한 곳과 이유, 실제 core로 확인한 것과 못 한 것.

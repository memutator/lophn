# mobile-app: lophn 폰 앱을 wireframe대로 처음부터 짓는다

- 목표: 폰 앱(`packages/mobile/`)의 화면을 사람이 승인한 wireframe(gallery Drafts › Phone app, `tools/wireframes/drafts/phone/`)대로 React Native로 다시 짓는다. 화면 조각은 폰 UI kit(`packages/design/native`, `@lophn/ui-native`)이 내고, 화면 아래 로직은 desktop과 같은 TypeScript를 쓴다. 컴퓨터가 화면을 내려주던 길(web bundle, WebView, bridge)을 지운다.
- 재료: `project-docs/products/roadmap/mobile.md`("폰 앱의 모양", 사람의 말 2026-11-15), `project-docs/PRODUCT.md`, `project-docs/architecture/{remote,acp,event,approval}.md`, wireframe `tools/wireframes/drafts/phone/*`(그림은 `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/*.png`), 조사 `/home/pyosechang/projects/lophn/reports/phone-native-ui/{lophn-inventory,t3code,paseo,happy}.md`, `packages/mobile/README.md`.
- 범위 밖(다음 계획): push 알림과 잠금 화면(roadmap 단계 4. 그래서 Paired 화면의 알림 묻기와 Settings › Notifications도 짓지 않는다), coding agent session 다루기(단계 5), 사용자 앱의 폰 화면 띄우기와 폰에서 도는 앱(단계 6, 7. wireframe 3 Apps의 앱 화면·Calendar·New version toast), 위젯, iOS build.
- 단위: `design-native`(폰 UI kit), `mobile-data`(폰의 data 층), `remote-routes`(폰이 부를 수 있는 route), `mobile-app`(앱 뼈대와 화면), `remote-web`(옛 web 화면 길 지우기). 소유 path는 brief가 정한다.
- 순서:
  - wave 1: kit, data, route를 나란히 짓는다. 서로 기대지 않는다.
  - wave 2: 앱 뼈대(화면 이동, sidebar, 연결 흐름, 설정). kit과 data 위에 선다.
  - wave 3: 화면 묶음들과 옛 web 길 지우기를 나란히.
  - land는 계획 끝에 한 번.

## 정한 것

- wireframe이 화면의 기준이다(사람, 2026-11-15 "좋아좋아 그대로 진행해"). worker는 wireframe 코드의 구조와 숫자(`phone.module.css`의 px를 그대로 dp로)를 옮긴다. 보고 다시 그리지 않는다.
- 뼈대는 sidebar다. 아래 tab bar를 두지 않는다(사람). 폭 600 이상에서는 sidebar가 늘 열려 있다.
- lophn 폰 앱은 어느 폰에서나 맞아야 한다. 등록한 기기에 맞추는 것은 lophn agent가 짓는 사용자 앱의 규칙이다(사람). 폭 320~430에서 늘고 주는 layout으로 짓는다.
- 폰의 권한: 보기, 말하기, 답하기(승인·질문·앱 update), 켜고 끄기, 지금 돌리기, 새 session. 만들기·고치기·지우기(agent, job), secret, provider, model 관리는 컴퓨터에서 한다(roadmap "추천대로 가려는 것"의 폰의 권한을 사람이 wireframe으로 승인).
- 화면 이동은 React Navigation(native stack과 drawer)으로 한다. 넓은 화면의 고정 sidebar가 들어 있고 비교한 폰 앱이 쓰는 표준이다(agent).
- 폰 화면 문구는 desktop과 같은 i18n catalog(`@lophn/i18n`)에서 온다(사람, 2026-11-15). desktop에 이미 있는 문장은 그 key를 그대로 쓰고, 폰에만 있는 문장만 새 key(`mobile.`으로 시작)로 더한다. 충돌을 피하려고 task마다 자기 catalog file(`packages/design/i18n/catalog/mobile-<영역>.ts`, lead가 빈 file로 만들어 `en.ts`에 올려 두었다)만 고친다.
- core에 route가 없어 wireframe에서 뺀 것(`mobile-routes` 보고): 아무 job이나 지금 돌리기(놓친 차례의 Start now만 남는다), 컴퓨터 화면에 session 띄우기, 보관 풀기, agent 상세의 MCP 수. project file 목록과 읽기는 route를 새로 짓는다(`mobile-files`).
- kit은 react-native-web이나 다른 runtime을 지금 고려하지 않는다. 사용자 앱이 kit을 쓰는 길은 단계 6의 spike가 정한다(roadmap).
- 화면을 core 없이 확인하도록 data 층이 지어낸 data를 내는 sample 컴퓨터를 둔다(dev build에서만, wireframe의 예시 data). 화면 worker는 sample로 모양을, 개발 core로 동작을 본다(agent).
- worker는 `sonnet-high`로 띄운다(사람, 2026-11-15. 처음의 opus 5.5 medium에서 바꿈).

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `mobile-kit` | 폰 UI kit을 wireframe의 조각대로 다시 짓고 gallery로 보인다 |
| 1 | `mobile-data` | 컴퓨터·연결 store와 workspace·Inbox·대화 data를 desktop 로직으로 내고 sample 컴퓨터를 둔다 |
| 1 | `mobile-routes` | 새 화면이 부를 route를 폰 allowlist에 더한다 |
| 2 | `mobile-files` | project의 file 목록과 글 file 읽기 route를 core에 짓고 폰에 연다 |
| 2 | `mobile-frame` | 앱 root, 화면 이동, sidebar, 연결 흐름, 컴퓨터 고르기, 설정. 옛 폰 화면과 WebView를 지운다 |
| 3 | `mobile-home` | Home, 컴퓨터 offline, 검색 |
| 3 | `mobile-session` | 대화와 그 sheet들, diff, 새 session |
| 3 | `mobile-inbox` | Inbox Now, 앱 새 판 살펴보기, History |
| 3 | `mobile-places` | project workspace(session, workflow, file)와 앱 workspace |
| 3 | `mobile-ops` | Jobs와 Agents |
| 3 | `mobile-web-removal` | core·renderer·tools의 web 화면 길을 지운다 |
| 3 | `mobile-frame-fixes` | `mobile-frame` 보고에 남은 것: Text size가 실제로 듣기(kit의 글 배율), 지운 컴퓨터와 다시 pairing, desktop의 pairing code 글로 보기, About의 판 (lead가 더함) |
| 4 | `mobile-polish` | wave 3의 화면들을 한 번 전체로 맞춘다: 같은 조각 합치기, 표기 통일, 연결이 죽는 결함, 여러 답 질문, 넓은 폭, wireframe 전체 대조 (opus high. lead가 더함) |
| 4 | `mobile-attach` | 대화의 첨부(사진, 카메라, 파일). native module 둘과 새 dev build (lead가 더함) |

## 돌리기 전에

- emulator: AVD `lophn-phone` 하나를 여럿이 쓴다. worker는 `-read-only -port <brief의 port>`로 자기 instance를 띄우고 모든 adb 명령에 `-s emulator-<port>`를 붙인다. 끝나면 `adb -s emulator-<port> emu kill`로 끈다. pkill·killall 금지. 사람의 실제 폰(serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다.
- Metro도 worker마다 brief의 port를 쓴다.
- 개발 core는 `packages/mobile/README.md`의 `tools/remote-dev.ts` 길을 쓴다. 사람의 `~/.lophn`과 실제 relay(`wss://lophn-relay.fly.dev`)를 쓰지 않는다.

## lead가 할 일

- **wave 1이 끝나면 바로(사람, 2026-11-15):** (1) 계획과 task 이름을 `mobile-app`, `mobile-*`로 바꾼다(계획 폴더, plan branch와 lead worktree, 남은 task의 id와 brief, change-log 이름. 사람: "이름이 mobile-app이 뭐야 mobile-app도 아니고"). (2) 폰 앱 폴더를 `packages/mobile/`에서 `packages/mobile`로 옮긴다(사람이 승인). root `package.json`의 workspace 목록에서 그 폴더를 빼 독립 npm project로 남기고, Metro 설정의 경로, `tools/check-deps.ts`의 제외, `AGENTS.md`의 mobile 줄, catalog와 문서의 path, 남은 brief의 path를 고친다. wave 2는 그 뒤에 띄운다.

- merge 때마다: `cd packages/mobile && npm run typecheck && npm test`(root check 밖), 화면 task는 worker가 남긴 emulator 그림(`.dev-data/<id>/shots/`)을 wireframe 그림과 대조한다. 어긋나면 같은 worker에게 돌려보낸다.
- wave 2 뒤: plan branch에서 dev build(x86_64)를 한 번 지어 `/tmp/lophn-mobile-app-x86_64.apk`에 두고 wave 3 worker에게 알린다(wave 3는 native module을 더하지 않는다).
- 끝에: `architecture/remote.md`(폰 껍데기 model을 native 화면으로), `architecture/ui-kit.md`(폰 kit), `boundary-catalog.yaml`·`module-catalog.yaml`(`packages/design/native`, `mobile`), `project-docs/flows/`(지운 route와 test), roadmap `mobile.md` 단계 2, `packages/mobile/README.md`, `AGENTS.md`의 mobile 줄, change-log `0.23/mobile-app.yaml`, `sdk-note`(kit을 SDK part로 올릴 때의 메모는 사용자 앱이 쓰게 되는 단계에서 쓴다는 것을 change-log에 적는다). 실제 폰에 새 build를 까는 것은 사람에게 묻는다.

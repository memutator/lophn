# mobile-docs

계획 `mobile-app`을 닫는 문서 일이다. 코드는 고치지 않는다. 이 계획이 바꾼 동작과 계약을 architecture 문서, catalog, flows, roadmap, README, AGENTS.md, change-log에 맞춘다. 사실은 코드에서 읽는다(문서가 코드와 다르면 코드가 맞다).

- 단위: mobile-app (wave 5)
- 선행: mobile-polish, mobile-attach
- 소유(이 task만 고친다):
  - `project-docs/architecture/remote.md`
  - `project-docs/architecture/ui-kit.md`
  - `project-docs/architecture/approval.md`
  - `project-docs/architecture/platform.md`
  - `project-docs/boundary-catalog.yaml`
  - `project-docs/module-catalog.yaml`
  - `project-docs/flows`
  - `project-docs/products/roadmap/mobile.md`
  - `project-docs/products/change-log/0.23/mobile-app.yaml`(새 file)
  - `project-docs/issues`(새 이슈 file만)
  - `packages/mobile/README.md`
  - `AGENTS.md`
- 읽을 것:
  - 이 계획의 `README.md`("정한 것", "lead가 할 일")와 `tasks/*.md`, `status.md`
  - lead가 worker 보고에서 모은 것: `/tmp/mobile-program/closing-notes.txt`의 "mobile-app" 절(문서에 적을 것의 목록이다. 사실은 코드에서 확인한다)과 `/tmp/mobile-program/polish-notes.txt`
  - 계획이 바꾼 것: `git diff main...HEAD --stat`(lead worktree에서)와 그 commit들의 message
  - 문서의 꼴: `AGENTS.md`("문서", "말"), `project-docs/products/change-log/README.md`와 `0.23/`의 다른 항목(예: `phone-shell.yaml`, `remote-relay.yaml`), `project-docs/issues/README.md`, `.claude/skills/flows/SKILL.md`, `.claude/skills/issue/SKILL.md`, `.claude/skills/wrap-plan/SKILL.md`
  - 화면 그림: `/home/pyosechang/projects/lophn/screenshot/mobile-app/`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음

## 할 일

1. `architecture/remote.md`: 폰 화면은 `packages/mobile`의 native React Native 화면이고 mobile UI kit(`packages/design/native`)으로 짓는다. 컴퓨터가 web 화면을 내려주던 길(route `remote_ui/*`, `packages/shell/renderer/remote`, `AgentView`의 `phone`, bundle cache, WebView)은 없다. 폰 앱의 구조(뼈대와 navigation의 자리, sidebar, 넓은 폭, data layer가 desktop의 순수 logic을 다시 쓰는 것, sample 컴퓨터), 폰 route 목록에 더해진 것(`project_files/list`, `project_files/read`, `devices/unpair`, 기기의 `jobs/update`는 `{job, enabled}`만), "폰은 목록 밖 route를 부르는 단추를 보이지 않는다"가 그대로인 것, pairing(Welcome, Scan, code를 글로 넣기, Paired의 "Shown as"), 지운 컴퓨터와 다시 pairing, 연결(틀린 `watch` 조건은 보내지 않는다, 닫힌 뒤 다시 붙는다), 첨부(사진과 카메라, `message-images/upload`, 5 MiB, 그림 네 종류)를 지금 코드대로 쓴다. 문서의 "문제, 모델, 지키는 것, 결정" 꼴을 지키고 code path는 적지 않는다.
2. `architecture/approval.md`, `platform.md`: 기기는 `devices/unpair`로 자기 등록만 지울 수 있다. 이미 아는 기기 key가 첫 frame으로 `pair`와 유효한 code를 보내면 옛 등록이 새 등록으로 바뀐다(틀린 code면 옛 등록이 그대로다).
3. `architecture/ui-kit.md`: mobile UI kit(`@lophn/ui-native`): desktop과 같은 token, 글 배율(small, default, large), 문구는 `@lophn/i18n`(폰만의 key는 `mobile.`으로 시작), 여러 답 질문 card, gallery. SDK part로 등록하는 것은 계획 `mobile-user-apps`의 일이라는 한 줄.
4. `boundary-catalog.yaml`, `module-catalog.yaml`: `packages/mobile`, `packages/design/native`와 이 계획이 더하거나 지운 module·경계를 맞춘다(`node tools/check.ts`의 modules·docs 단계가 본다).
5. flows: 이 계획이 더하거나 지운 route, IPC channel, test file이 catalog와 맞는지 `node tools/flows.ts check`로 보고, 계획이 바꾼 동작의 flow(pairing, 기기 등록, project file 읽기, 폰 route 목록)에서 낡은 step과 `unclear` 줄을 고친다. 폰 화면의 journey가 필요하면 한 file을 더한다(`flows` skill).
6. `products/roadmap/mobile.md`: 단계 2와 "진행" 표의 `mobile-app` 줄을 끝난 것으로 고치고, 본문에서 web 화면·WebView·bundle cache를 말하는 낡은 곳을 지금 구조로 고친다.
7. `products/change-log/0.23/mobile-app.yaml`: 바뀐 동작과 계약, 정한 것, 알려진 빈틈(대화의 수식·mermaid가 code box로 보인다, Deny에 이유를 못 쓴다, fork·rewind·subagent 열기가 폰에 없다, Inbox의 History는 notice 목록이다, agent 줄의 model은 raw 이름이다, folder가 여럿인 project는 첫 folder만 보인다, desktop 변경은 Electron 창을 띄워 확인하지 못했다, 실제 폰 확인은 뒤 단계다). 판은 branch에서 보이는 판으로 쓴다.
8. 이슈: 위 빈틈 가운데 고칠 것은 `project-docs/issues/<id>.yaml`로 올린다(`issue` skill. 이미 있는 이슈면 덧붙인다). worker 보고의 "무겁게 짠 것" 가운데 남은 것(desktop DOM file에 있는 순수 helper를 폰이 베껴 쓰는 것 등)도 본다.
9. `packages/mobile/README.md`와 `AGENTS.md`: 폰 앱 폴더, 명령(`cd packages/mobile && npm ci && npm run typecheck && npm test`), dev build와 gradle flag, emulator 규칙, sample 컴퓨터, 개발 core와 pairing하는 법이 지금과 맞는지 고친다. AGENTS.md는 짧게 둔다.

## 끝남

- root `npm run check`가 통과한다(docs, modules, flows, records 단계 포함).
- 위험 test: 없음
- 코드 file을 고치지 않았다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 고친 문서마다 한 줄, 새 이슈 목록, 문서와 코드가 달라 코드 쪽을 고쳐야 할 것으로 보이는 곳(고치지 말고 적는다).

# mobile-push-docs

계획 `mobile-push`를 닫는 문서 일이다. 코드는 고치지 않는다. 사실은 코드에서 읽는다(문서나 메모가 코드와 다르면 코드가 맞다).

- 단위: mobile-push (wave 4)
- 선행: mobile-push-phone
- 소유(이 task만 고친다):
  - `project-docs/architecture/attention.md`(새 file)
  - `project-docs/architecture/app-notice.md`
  - `project-docs/architecture/remote.md`
  - `project-docs/architecture/terminal-agent.md`
  - `project-docs/architecture/event.md`
  - `project-docs/boundary-catalog.yaml`
  - `project-docs/module-catalog.yaml`
  - `project-docs/flows`
  - `project-docs/products/roadmap/mobile.md`
  - `project-docs/products/change-log/0.23/mobile-push.yaml`(새 file)
  - `project-docs/issues`(새 이슈 file만)
  - `packages/mobile/README.md`
- 읽을 것:
  - 이 계획의 `README.md`("정한 것", "사람이 할 것", "lead가 할 일"의 "끝에" 줄이 이 task의 목록이다)와 `tasks/*.md`
  - lead가 worker 보고에서 모은 것: `/home/pyosechang/projects/lophn/reports/mobile-program/lead/closing-notes.txt`의 "mobile-push" 절
  - 계획이 바꾼 것: `git log --oneline main -40 -- packages/core/attention packages/protocol/attention packages/core/remote packages/shell/main/notice packages/mobile/src/push`와 그 code
  - 문서의 꼴: `AGENTS.md`("문서", "말"), `project-docs/products/change-log/README.md`와 `0.23/mobile-app.yaml`, `project-docs/issues/README.md`, `.claude/skills/{flows,issue,wrap-plan}/SKILL.md`, `project-docs/architecture/remote.md`(문제, 모델, 지키는 것, 결정의 꼴)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음

## 할 일

1. 새 `architecture/attention.md`: 문제(사람을 기다리는 일을 어느 기기에 알릴까), 모델(host들의 presence 보고, `unseen`, 계기와 대상 정하기, push 글 규칙: 제목과 상태 문장만, session 이름을 끄는 설정, push 보내기와 죽은 token 지우기, 잠긴 설정 `remote.push`), 지키는 것, 결정(Expo Push를 직접, 폰 설정 한 벌, 앞에 있는 host가 있으면 보내지 않는다, 창이 앞에 있어도 2분 쉬면 앞에 없는 것). code path는 적지 않는다.
2. `app-notice.md`: "`NoticePosted`를 받아 행동하는 core code를 두지 않는다"에 push 보내기가 예외라는 것(받는 쪽은 사람뿐이다), `unseen`이 core에 있고 desktop은 읽고 지우기만 한다는 것, 없어진 IPC channel.
3. `remote.md`: 기기의 push 열(token, 설정), 폰이 부르는 `devices/set_push`와 `presence/report`, machine만 부르는 `devices/clear_push`·`devices/push_targets`, 기기가 떠나면 presence를 잊는 것, remote가 꺼져 있으면 push가 나가지 않는 것, 폰 앱의 알림(Paired에서 묻기, Settings › Notifications, 채널 셋, 알림을 누르면 여는 곳, 죽은 앱에서 눌러도 열린다).
4. `terminal-agent.md`, `event.md`: tracker가 core에 올리는 signal(waiting, finished, failed)과 새 turn·종료 때 표시 지우기, change 이름 `unseen`.
5. catalog와 flows: `attention` module·경계, push를 보내는 flow가 없다고 적힌 곳(`flows/tests/core-rest.yaml`의 note)과 wiring의 죽은 token 갈래를 flow로 맞춘다(`node tools/flows.ts check`).
6. roadmap `mobile.md`: 단계 4와 "진행" 표의 `mobile-push` 줄(실제 배달은 사람의 Expo·Firebase 계정 뒤라는 것).
7. change-log `0.23/mobile-push.yaml`: 바뀐 동작과 계약, 정한 것, 알려진 빈틈(실제 FCM 배달과 Expo token은 확인하지 못했다, EAS project id가 없는 build는 알림을 못 쓴다, Android 알림 아이콘이 기본이다, GUI 탭에서 기다리는 승인의 push는 뒤의 일이다, desktop 변경은 Electron 창을 띄워 확인하지 못했다), 사람이 할 것(Expo project id와 `google-services.json`).
8. 이슈: 위 빈틈 가운데 고칠 것을 `project-docs/issues/<id>.yaml`로 올린다(`issue` skill).
9. `packages/mobile/README.md`의 알림 절이 지금 code와 맞는지 본다.

## 끝남

- root `npm run check`가 통과한다.
- 위험 test: 없음
- 코드 file을 고치지 않았다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 고친 문서마다 한 줄, 새 이슈 목록, 문서와 code가 달라 code를 고쳐야 할 것으로 보이는 곳(고치지 말고 적는다).

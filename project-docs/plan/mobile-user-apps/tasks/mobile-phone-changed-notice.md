# mobile-phone-changed-notice

사람의 기준 폰이 바뀌면(새 폰을 pairing하거나 Settings에서 기준을 바꾸면) 폰 화면이 있는 앱이 몇 개인지 한 줄 notice로 알린다. 옛 폰의 크기로 그린 폰 화면은 다시 그려야 하기 때문이다. 알리기만 하고 자동으로 다시 그리지 않는다(사람, 이 계획의 "정한 것" 5). 폰 화면이 있는 앱이 없으면 알리지 않는다.

- 단위: phone-screen (wave 4)
- 선행: mobile-phone-target, mobile-place-decl
- 소유(이 task만 고친다):
  - `packages/protocol/apps/notice.ts`
  - `packages/core/apps/notices/program-text.ts`
  - `packages/core/apps/notices/commands.ts`
  - `packages/core/apps/phone/changed.ts`(새 file)
  - `packages/core/apps/phone/changed_test.ts`(새 file)
  - `packages/shell/main/desktop/wiring/notice.ts`
  - `packages/shell/renderer/desktop/connection/waiting/notice-kinds.ts`
  - `packages/shell/renderer/desktop/connection/waiting/fake-source.ts`
  - `packages/design/i18n/catalog/data.ts`
- 공유 줄 허락(한 줄씩만 더하고 보고의 "넘길 줄"에 적는다): `packages/core/main/daemon/wiring/apps.ts`(`start`에서 Bus의 `StateChanged`를 구독해 위 module에 넘기는 줄. `mobile-views-core`가 같은 곳에 `AppViewChanged` 구독을 더했다)
- 읽을 것:
  - 같은 모양의 앞선 변경(program notice kind 하나를 더하는 자리 넷): kind `session_stopped_by_app`이 있는 곳 — `packages/protocol/apps/notice.ts`(kind 목록과 `variant`), `packages/core/apps/notices/program-text.ts`(글 template), `packages/shell/renderer/desktop/connection/waiting/notice-kinds.ts`(label key, `satisfies Record<NoticeKind, MessageKey>`가 빠진 kind를 typecheck로 알려 준다), `packages/shell/main/desktop/wiring/notice.ts`(toast 대상 목록), i18n key `waiting.label.kind-session-stopped-by-app`(`packages/design/i18n/catalog/data.ts`)
  - 기록하는 길: `project-docs/architecture/app-notice.md`("program 줄이 생기는 곳"), `packages/core/main/daemon/wiring/notices.ts`(`ctx.noticeRecorder`), `packages/core/apps/sdk-status/detect.ts`(`recordSdkUpdates`: 앱 없는 줄, `key`로 되풀이를 한 줄로 합친다), `packages/core/main/daemon/wiring/session-lifecycle.ts:170` 근처(core 안에서 `noticeRecorder`를 쓰는 예)
  - 기준 폰: `packages/core/remote/devices.ts`(table `devices`, `is_primary`. 새 pairing이 기준을 바꾼다. 이 task는 `packages/core/remote`를 고치지 않는다), `packages/protocol/remote/routes.ts`(`devicesRegister`·`devicesSetPrimary`가 `changes: remote_devices`를 낸다 → Bus의 `StateChanged`의 `{name: "remote_devices"}`), `packages/core/apps/phone/target.ts`
  - 폰 화면이 있는 앱: 선언의 `screens[].places == ["phone"]`(`loadApps(sql, "active")`와 `loadActiveDeclaration`, `packages/core/apps/releases/store.ts`)
- 계약:
  - 쓰는 것: `ctx.noticeRecorder`, `devices` 표(읽기만), 활성 선언
  - 내놓는 것: program notice kind `phone_changed`(앱 없는 줄, params `{apps: number(1..9999)}`, `key: "phone_changed"`로 되풀이를 한 줄로 합친다, 영구). 글: title `Your phone changed`, body `<N> app(s) have phone screens drawn for the old phone. Ask lophn to redraw them.`(`N app`/`N apps`를 `sdk_update_needed` 글처럼 단복수로). action은 없다(`null`). 앱 없는 kind라 `recordProgramNotice`의 appless 목록에 든다

## 할 일

1. protocol: `PROGRAM_NOTICE_KINDS`와 `noticeRecordInputSchema`에 `phone_changed`를 더한다(앱 없음). `commands.ts`의 `appless` 판정에 더한다. `program-text.ts`에 글을 더한다.
2. core: `packages/core/apps/phone/changed.ts`에 작은 module을 짓는다. 입력은 port 셋(기준 기기 id 읽기 `() => string | null`, 폰 화면이 있는 활성 앱 수 읽기 `() => number`, `record`)이고 Bus의 `StateChanged`(이름 `remote_devices`가 든 것)를 받을 때마다 기준 기기 id를 읽어 마지막으로 본 id와 다르면(없던 기기에서 처음 생긴 것 포함, 지운 뒤 다른 기기가 기준이 된 것 포함) 폰 화면 앱 수가 1 이상일 때만 알린다. 마지막으로 본 id는 메모리에만 둔다(core가 시작할 때 지금 값으로 시작한다. ledger step이 필요 없다. core가 꺼져 있는 사이의 변경은 알리지 못하지만 pairing은 core가 켜져 있어야 한다). 이름 바꾸기나 연결 시각 갱신은 기준 id가 같아 알리지 않는다. `wiring/apps.ts`의 `start`에 한 줄로 단다.
3. shell과 i18n: `notice-kinds.ts`에 label key `waiting.label.kind-phone-changed`를, `data.ts` catalog에 문구 `Phone changed`를 더한다. `wiring/notice.ts`의 목록(program kind 가운데 toast를 띄울 것)에서 이 kind를 어떻게 다룰지 `sdk_update_needed`와 같게 둔다(영구 줄은 Inbox에 남고 toast는 같은 규칙). desktop Inbox의 fake source(`fake-source.ts`)에 예시 한 줄.
4. 폰 Inbox: 폰의 Inbox는 desktop의 `waiting`/`notice-kinds` 코드를 그대로 쓴다. `packages/mobile`이 main에 올라와 있으면(mobile-app 계획이 land됐으면) `cd packages/mobile && npm run typecheck && npm test`를 돌려 새 kind 때문에 깨지는 곳(NoticeKind를 빠짐없이 매핑하는 곳)이 있으면 그 한 줄만 고친다. 아직 land 전이면 보고에 "mobile-app lead가 합칠 때 NoticeKind를 빠짐없이 매핑하는 곳을 맞춘다"고 적는다.
5. flows catalog: 새 notice kind와 기록 흐름, 새 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다. `project-docs/architecture/app-notice.md`의 program kind 표와 "program 줄이 생기는 곳"에 한 줄을 더한다(이 task가 고친다).

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 통과한다.
- 위험 test: 없음(사람의 data를 잃거나 권한을 넘는 일이 아니다). 알림 규칙(기준 id가 바뀔 때만, 폰 화면 앱이 있을 때만)을 확인하는 단위 test 하나는 둔다.
- 남지 않음: 없음(더하기뿐).
- `project-docs/flows/`가 check를 통과한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 새 줄의 title·body 실제 글, 등록할 것·넘길 줄, 폰 Inbox가 새 kind를 어떻게 그리는지(확인했으면 어느 화면, 못 했으면 이유).

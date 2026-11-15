# mobile-remote-gate

폰이 사용자 앱의 폰 화면을 돌리는 데 필요한 route와 event만 폰 자격에 연다: view binding(`app_views/*`), 화면 목록(`apps/phone_screens`), 화면 file(`apps/screen_file`), 앱 event(`AppViewEvent`). 폰의 Gateway session은 기기 principal을 owner로 받아 자기 view의 event만 받는다. 연결이 닫히면 그 기기의 view를 core가 지운다. 폰 자격이 앱을 직접 부르는 길(`apps/call_tool`, grant, 앱 쓰기)은 닫힌 채로 둔다.

- 단위: phone-host (wave 6)
- 선행: mobile-views-core, mobile-phone-reads, mobile-phone-contract. **`mobile-app` 계획이 main에 land된 뒤에 띄운다**(`packages/protocol/remote/allowlist.ts`와 `packages/core/remote`가 그 계획의 path다). `mobile-push`의 `mobile-push-device`와 `mobile-coding-agents`의 `mobile-terminal-device-grant`도 `packages/core/remote`·`wiring/remote.ts`·allowlist를 소유하니 running이면 끝난 뒤에 띄운다(`status.py ready`가 소유 겹침으로 막는다)
- 소유(이 task만 고친다):
  - `packages/protocol/remote/allowlist.ts`
  - `packages/core/remote/host.ts`
  - `packages/core/remote/host_test.ts`
  - `packages/core/main/daemon/wiring/remote.ts`
  - `packages/core/main/daemon/wiring/remote_test.ts`
  - `packages/core/apps/views`(`mobile-views-core`가 만든 폴더. 연결이 닫힐 때 owner의 view를 지우는 한 함수가 아직 없으면 그만큼만)
- 읽을 것:
  - 지금의 폰 gate: `packages/protocol/remote/allowlist.ts`(`REMOTE_ALLOWED_ROUTES`, `REMOTE_ALLOWED_EVENTS`와 윗줄의 이유 주석), `packages/core/remote/host.ts`(`attach`: 기기 자격, `createGatewaySession(..., {events})`, `cleanups`), `packages/core/remote/call.ts`(`devicePrincipal`, file route의 base64 답과 `REMOTE_FILE_MAX_BYTES`), `host_test.ts`의 "기기는 route 목록 밖의 route를 forbidden으로 받고 handler에 닿지 않는다", "route 목록을 넓힌 뒤에도 … forbidden이다", "기기의 watch는 types 없이 걸어도 REMOTE_ALLOWED_EVENTS 밖의 event를 받지 않는다"
  - 새로 여는 것: `packages/protocol/apps/views.ts`(`app_views/open|call|close`, event `AppViewEvent`), `packages/protocol/apps/phone.ts`(`apps/phone_screens`), `packages/protocol/apps/calls/screen.ts`(`apps/screen_file`, 기존 file route), `packages/core/events/gateway.ts`(`owner` 옵션: 이 task가 기기 principal을 준다), `packages/core/apps/views/`(`mobile-views-core`의 보고: view module의 API)
  - architecture: `project-docs/architecture/remote.md`(폰 자격은 actor user이되 route 목록으로 좁힌다. 지키는 것), `app-call.md`(operation은 사람(화면)만 부른다)
- 계약:
  - 쓰는 것: 위 route·event 정의와 Gateway `owner`
  - 내놓는 것: 폰 allowlist에 `app_views/open`, `app_views/call`, `app_views/close`, `apps/phone_screens`, `apps/screen_file`(그리고 폰 앱 목록이 쓰는 `apps/icon`이 아직 없으면)와 event `AppViewEvent`. 이 밖의 앱 route는 닫힌 채다: `apps/call_tool`, `app_grants/*`, 앱을 만들고 고치고 지우는 route, `AppEventPublished`, `AppViewChanged`

## 할 일

1. `allowlist.ts`에 위 route와 event를 더하고 윗줄 주석에 이유를 쓴다(폰 화면 bridge는 view id로만 앱을 부르고 operation은 묶인 release의 선언에 있는 것만 core가 판정한다). `REMOTE_ALLOWED_EVENTS`의 주석 "앱 event(`AppEventPublished`…)는 넣지 않는다"는 앱 event가 `AppViewEvent`로만, 구독을 선언한 view의 owner에게만 간다는 문장으로 고친다.
2. `host.ts`: Gateway session을 만들 때 `owner: devicePrincipal(device)`를 준다. 연결이 닫히면(`cleanups`) 그 owner의 view를 지운다(`views.closeOwner(devicePrincipal(device))` 같은 한 함수. 있으면 쓰고 없으면 view module에 더한다). `RemoteHostDeps`에 그 함수를 받는 칸을 더하고 `wiring/remote.ts`가 core의 view module을 넘긴다(core 안 다른 wiring이 view module을 쓰는 길은 `mobile-views-core`가 정한 대로 읽는다. 새 core wiring이나 ledger step이 필요해 보이면 만들지 말고 보고한다). 기기를 끊으면(`revoked`) 연결이 닫혀 같은 길로 view가 지워진다.
3. 앱의 화면 오류를 앱 log로: 폰 화면이 던진 오류를 agent가 읽을 수 있어야 폰 화면을 고칠 수 있다. `packages/protocol/apps/app-log.ts`의 `appLogViewError`(사람이 부르는 memory route, 입력은 앱과 오류 이름·글)가 폰 host의 호출에 맞는지 읽어 본다. 맞으면 폰 allowlist에 더한다. 입력의 앱·release 같은 칸을 폰이 자기 마음대로 정하게 되는 모양이면(다른 앱의 log에 쓸 수 있으면) 더하지 말고 보고한다(그때 폰 화면 오류는 app log에 가지 않고 폰 화면의 오류 상태로만 보인다).
4. test(아래 위험 test와 정상 경로): `host_test.ts`의 틀을 쓴다. 메모리 전송과 가짜 core로 돈다(server, subprocess를 띄우지 않는다).
5. flows catalog: 바뀐 폰 gate(허락한 route·event, 연결 종료의 view 정리)는 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다. `project-docs/architecture/remote.md`의 폰 자격 route 목록 문장은 lead가 계획 끝에 고친다.

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 통과한다. 폰 앱은 이 task가 고치지 않으므로 `cd packages/mobile`은 필요 없다.
- 위험 test(권한 경계라 둔다):
  - "폰 자격은 `apps/call_tool`, `app_grants/*`, 앱 만들기·고치기·지우기·release·rewind route를 forbidden으로 받고 handler에 닿지 않는다. 새로 연 `app_views/*`·`apps/phone_screens`·`apps/screen_file`은 통과한다"(기존 "route 목록을 넓힌 뒤에도 … forbidden이다" 표에 이름을 더한다)
  - "기기 A의 연결은 기기 B가 연 view를 호출하거나 닫지 못하고(없는 view와 같은 답), `AppViewEvent`는 owner인 기기의 Gateway session에만 가며, 연결이 닫히면 그 기기의 view가 지워진다"
- 남지 않음: 없음(폰 route를 더하기만 한다).
- `project-docs/flows/`가 check를 통과한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 더한 route·event 목록, 3번의 `appLogViewError` 결론, view module에 더한 함수, 등록할 것·넘길 줄.

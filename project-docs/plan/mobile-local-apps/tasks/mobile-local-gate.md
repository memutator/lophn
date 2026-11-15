# mobile-local-gate

폰이 폰에서 도는 앱을 설치하고 맞추는 데 필요한 route와 event만 폰 자격에 연다: `app_sync/push`, `app_sync/pull`, `app_sync/snapshot`, `app_sync/snapshot_file`, `apps/phone_file`, event `AppSyncChanged`. 그 밖의 앱 route는 닫힌 채다.

- 단위: phone-host (wave 5)
- 선행: mobile-sync-ledger, mobile-local-prepare. **중간 land 뒤**(계획 README. `packages/protocol/remote/allowlist.ts`와 `packages/core/remote`는 `mobile-app`·`mobile-user-apps`의 path다). 이 path를 소유한 다른 계획의 task(`mobile-push-device`, `mobile-terminal-device-grant`, `mobile-phone-link`, `mobile-widget-store`)가 running이면 끝난 뒤에 띄운다(`status.py ready`가 막는다)
- 소유(이 task만 고친다):
  - `packages/protocol/remote/allowlist.ts`
  - `packages/core/remote/host_test.ts`
- 읽을 것:
  - 지금의 폰 gate: `packages/protocol/remote/allowlist.ts`(`REMOTE_ALLOWED_ROUTES`, `REMOTE_ALLOWED_EVENTS`와 윗줄의 이유 주석), `packages/core/remote/{host.ts,call.ts}`(기기 자격, file route의 `{content_type, base64}` 답과 `REMOTE_FILE_MAX_BYTES`), `host_test.ts`의 "기기는 route 목록 밖의 route를 forbidden으로 받고 handler에 닿지 않는다", "route 목록을 넓힌 뒤에도 … forbidden이다", "기기의 watch는 … REMOTE_ALLOWED_EVENTS 밖의 event(앱 event)를 받지 않는다"
  - 여는 것: `packages/protocol/apps/app-sync.ts`(`mobile-sync-ledger`), `packages/protocol/apps/phone.ts`의 `apps/phone_file`(`mobile-local-prepare`), `packages/protocol/events/transient.ts`의 `AppSyncChanged`
  - architecture: `project-docs/architecture/remote.md`(폰 자격은 actor user이되 route 목록으로 좁힌다)
- 계약:
  - 쓰는 것: 위 route·event 정의
  - 내놓는 것: 폰 allowlist에 위 route 다섯과 event 하나. `apps/call_tool`, `app_grants/*`, 앱을 만들고 고치고 지우는 route, `AppEventPublished`는 닫힌 채다

## 할 일

1. `REMOTE_ALLOWED_ROUTES`에 "폰에서 도는 앱" 묶음으로 route 다섯을 더하고, 윗줄 주석에 이유 한 줄(폰이 앱 backend와 migration file을 받고 자기 사본을 컴퓨터와 맞춘다. push는 기기 자격만 받는다). `REMOTE_ALLOWED_EVENTS`에 `AppSyncChanged`.
2. `host_test.ts`: 기기가 `app_sync/pull`을 부르면 handler에 닿고, `apps/phone_file`과 `app_sync/snapshot_file`은 `{content_type, base64}`로 답하는지(기존 file route test의 꼴), 기기의 watch가 `AppSyncChanged`를 받는지를 기존 test에 줄로 더한다. "route 목록을 넓힌 뒤에도 … forbidden" test의 목록에 `apps/call_tool`이 없으면 더한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 기존 경계 test("route 목록 밖은 forbidden", "넓힌 뒤에도 forbidden", "watch는 목록 밖 event를 받지 않는다")가 새 route를 넣은 뒤에도 통과한다. 새 test는 위 2의 줄만.
- 남지 않음: 없음(더하기).
- flows catalog: 이 task가 바꾼 기기 route 목록의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 더한 route·event 목록과 기기 자격으로 확인한 결과.

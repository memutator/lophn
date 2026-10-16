# remove-platform-notifications

core의 옛 notification 모듈(계기 표, 엔진, 루프, 표, `NotificationCreated`·`NotificationRead`, Ask 값, OS 표시 전달)과 protocol의 notification 약속을 지운다. toast는 renderer 정책이고 사람을 부르는 일은 새 대기 목록이 맡는다(S1 8장). 화면과 shell main 쪽은 앞 task들이 지웠다.

- 단위: remove-platform (wave 1)
- 선행: `remove-documents-core`(core 조립 file을 같이 고친다), remove-platform-renderer, core-wiring
- 소유(이 task만 고친다):
  - `packages/core/notifications/`
  - `packages/protocol/notifications/`
- 추가 소유(lead 승인, 2026-10-16. 소유와 같이 고친다. 지운 것을 가리키는 줄만 고친다. core·shell 조립이 wiring file로 쪼개졌으면 그 줄이 옮겨 간 wiring file이 대신한다. "등록 file(lead)"도 지운 것을 가리키는 줄만 뺀다. 모두 지운 module을 쓰던 곳이다):
  - 조립: `packages/core/main/daemon/wiring/notifications.ts`(file째 지운다), `packages/core/main/daemon/platform-register.ts`의 notifications 몫, `runtime.ts`
  - 등록 file(lead): `packages/core/main/daemon/assembly.ts`의 `WIRINGS`에서 notifications 한 줄, `packages/protocol/registry.ts`의 `NOTIFICATION_ROUTES`·`NOTIFICATION_EVENTS`, `packages/protocol/deno.json`의 `./notifications` export
- 읽을 것:
  - spec: S1 5장·8장·12장·13장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - 삭제 목록: `/home/pyosechang/projects/lophn/project-docs/tmp/notes/removed.md` 2장(notifications 보류, "보류는 코드도 지운다")
  - 순서 제약: `/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md` 6장 "notifications 모듈과 OS notification 삭제"
  - inventory: `I1.1#10` (`../assignment.md`에서 이 task가 맡은 줄 전부), `I6#7`(lead 몫 줄을 이 task가 한다)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `code-map.md`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음(지우기만 한다)

## 할 일

1. `core/notifications/`(commands, engine, loop, model, store, schema, reads, delivery, ask-agent, os-display, mod)와 `protocol/notifications/`(`notifications.ts`, `mod.ts`)를 지운다. (I1.1#10)
2. 조립에서 걷는다. (I6#7)
   - `platform-register.ts`: `notificationCreated`·`notificationRead` event 등록, `NOTIFICATIONS_SCHEMA_STEPS`, `NOTIFICATION_COMMANDS`, `NOTIFICATION_SUBSCRIBER`, `notificationsGetRead`·`notificationsListRead`·`notificationsDisplayRead`, 모듈 설명 주석.
   - `wiring/notifications.ts`(core-wiring이 만든 file): `startNotifications` 시작과 종료 때 `stop`, `NOTIFICATIONS_CONTEXT` 자격 기록. file을 지우고 `assembly.ts`의 한 줄을 뺀다(등록 file이니 최소 편집으로 하고 보고한다).
   - `runtime.ts`: `createNotificationDelivery`와 `notifications/get|list|display|delivery` memory route.
   - `protocol/registry.ts`: `NOTIFICATION_ROUTES`·`NOTIFICATION_EVENTS`. `protocol/deno.json` export 한 줄.
3. 남기는 것: `notificationsOnlyVisibility`(`platform-register.ts`)와 `NOTIFICATIONS_PRINCIPAL`·그것을 쓰는 `core/server/credentials.ts`는 `core/apps/register.ts`, `core/apps/tickets/register.ts`, `core/problems/register.ts`가 event 공개 정책을 거는 데 쓴다. 그 정책 장치 전부는 events 단위가 지운다(I6#4). 이 task는 이름과 쓰는 곳을 바꾸지 말고, 이 장치만 남겨 check를 통과시킨 뒤 보고에 적는다.
4. 개발 data: `notifications` 표(`source_seq references events`)의 schema step이 사라진다. 새로 만든 data root에서만 열린다(AGENTS.md 호환성). data를 지우거나 migration을 만들지 않는다.
5. event 정의(`TicketConfirmed`, `AssignmentPaused`, `QuestionCreated`, `ApprovalRequestCreated`, `ContextViolationsRecorded`, `ReleasePrepared` 등)는 지우지 않는다. 그 정의를 지우는 일은 contract-events와 각 계약 단위 몫이다(다른 단위 몫). notification 모듈이 이 이름들을 가리키던 곳(`NOTIFICATION_TRIGGERS`)만 사라진다.
6. type check가 못 잡는 것을 grep으로 찾는다: route 이름 `notifications/`, subscriber 이름 `machine:notifications`, `notifications` 표를 읽는 SQL 문자열.
7. `deno task check`를 돈다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(지우기만 한다)
- 남지 않음: `grep -rn "core/notifications\|protocol/notifications\|startNotifications\|NOTIFICATION_ROUTES\|NOTIFICATION_EVENTS\|NOTIFICATIONS_SCHEMA_STEPS\|createNotificationDelivery\|NOTIFICATIONS_CONTEXT" packages tools`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: core 조립 목록에서 뺀 항목, `protocol/registry.ts`·`protocol/deno.json`에서 뺀 항목
- 안 쓰게 된 export: `notificationsOnlyVisibility`, `NOTIFICATIONS_PRINCIPAL`(events가 visibility 장치를 지울 때 같이), `core/config/shell-settings.ts`의 `shell.os_notifications`(platform), 지울 event 정의 목록(contract-events)
- 정한 것: 문서에 답이 없어 정한 것
- 걱정: `base/redaction/screen.ts`의 마지막 사용처가 사라졌다. `remove-documents-redaction`이 이어서 지운다
- 계약 바꾸기 요청: 없음

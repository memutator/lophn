# events-ledger

ledger를 S1의 Ledger로 줄인다. `events` 표는 domain event 10개만 담는 append-only 표가 되고 읽는 쪽은 Reactor뿐이다. 옛 `approval_uses`, `events.run` 칸, 표를 가리키는 FK를 지우고, command가 commit된 뒤 그 tx의 domain event를 Bus로 내는 길을 만든다. domain event가 상태와 같은 tx에 쓰인다는 규칙을 test한다.

- 단위: events (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/storage/ledger/` — 아래 두 묶음은 뺀다.
    - 뺌(events-bus-gateway의 것): `mod.ts`의 `../../events/*` re-export 줄, `reads.ts`·`reader-worker.ts`·`reader-registration.ts`의 event 읽기·visibility 부분
    - 뺌(events-reactor의 것): `reaction.ts`, `commands.ts`, `writer-assembly.ts`·`writer-registration.ts`의 subscriber gate 부분, `tx.ts`의 `advanceSubscriberCursor`
  - 새 file `packages/core/storage/ledger/commit-publisher.ts`
  - wiring file: 건드리지 않는다(아래 "등록할 것"에 적는다)
- 읽을 것:
  - spec: S1 3·4·5·10·11·12장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - inventory: `I1.1#11`, `I1.2#2`, `I1.11#7`(ledger 몫만), `I2.1#1`, `I2.1#3`, `I2.1#14`, `I2.1#17`, `I2.11#14` (`../assignment.md`에서 이 task가 맡은 줄 전부. 나머지 events 줄은 events-bus-gateway, events-reactor, events-identity가 맡는다)
  - 결정: `../README.md` 2.5의 B1 줄(위험 test), 1장 3항(옛것과 새것이 잠시 같이 있어도 된다)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `/home/pyosechang/projects/lophn/project-docs/dev/testing.md`
- 계약:
  - 쓰는 것: `packages/protocol/events/domain.ts`의 `DOMAIN_EVENTS`, `DomainEventType`, `domainEventEnvelopeSchema`, `bus.ts`의 `BusEvent`. `packages/core/events/ports.ts`의 `Bus`(publish만 부른다). Bus 구현은 events-bus-gateway가 만든다. 이 task는 `Bus` port와 fake로 짓는다.
  - 내놓는 것: `isDomainEvent(type: string): boolean`과 `createCommitPublisher({ reader, bus })`(`onCommit(success: CommandSuccess)`), `Tx.emit`이 domain event 10개가 아닌 type을 거절하는 길(켜는 시점은 아래 4).

## 할 일

1. `events` 표를 줄인다 — `core/storage/ledger/schema.ts` (`I2.1#1`, `I1.1#11`, `I2.1#3`, `I2.11#14`)
   - 다른 단위가 아직 쓰는 것은 지우지 않는다. 지울 수 있는지는 아래 grep으로 task를 시작할 때 센다. 0이면 지우고, 아니면 지우지 않고 남은 file 목록을 보고에 적는다(그 단위가 쓰기를 그만두면 cleanup이 지운다).
   - `events.run` 칸과 `events_run_seq` index, `tx.ts`의 `emitAs`가 쓰는 `insert into events (type, subject, actor, run, payload, at)`의 `run`: `grep -rn "events.*run\b\|e\.run\|run_seq" packages/core --include=*.ts`에서 이 task 소유 밖 사용이 0일 때만 뺀다. `Tx` 문맥의 `run`(다른 곳이 쓴다)은 지우지 않는다. `events`에 쓰는 것만 뺀다.
   - `blob_refs.registered_seq`의 `foreign key ... references events (seq)`만 뺀다(S1 5장: 대부분의 변경은 event가 없어서 event 없는 변경도 blob 참조를 등록해야 한다). 칸과 index는 `storage/blobs/register.ts`, `apps/tickets/report.ts` 등이 쓰므로 남긴다. `notifications.source_seq` FK는 remove-platform이 표째 지운다. 남아 있으면 같이 뺀다.
   - `command_results.first_seq/last_seq`의 FK는 남긴다(domain event를 쓴 command만 값이 있다).
   - schema step은 새 step을 더하지 않고 원래 step 내용을 고친다. 개발 DB는 지우고 새로 만든다(AGENTS.md "호환성"). step의 content hash를 고치면 `checkHistory`가 거절하므로 `schema.ts` 위 주석에 한 줄 적는다.
2. 옛 approval 사용 기록을 지운다 — `I1.2#2`
   - 지우는 조건: `grep -rn "approval_uses\|useApproval\|usableApproval\|recordedUse" packages/core --include=*.ts`의 결과가 `core/storage/ledger/`와 `core/server/identity/connection/sqlite.ts`(events-identity가 지운다)뿐일 때. 지금은 `core/approvals/`, `core/apps/{releases,permissions,invocations}/`, `core/lophn-agent/waiting-and-recovery/model.ts`도 쓴다. 그 단위(approvals, app-calls, releases-problems, router)가 먼저 merge됐으면 지운다. 아니면 지우지 않고 남은 file 목록을 보고한다.
   - 지울 때: `core/storage/ledger/approval-use.ts` 삭제, `mod.ts`의 `recordedUse`·`usableApproval` export, `tx.ts`의 `useApproval` 구현, `approval_uses` 표. 이 task가 못 고치는 stub(`core/apps/tickets/fixture.ts`는 coding-agent의 것)은 보고한다.
   - `question_evidence` 표와 `tx.ts`의 그 표 insert(`I1.11#7`의 ledger 몫, 질문 근거로 machine이 사람 결정을 대신하던 장치): 쓰는 곳이 `core/config/{question-evidence,evidence-use}.ts`(platform), `core/lophn-agent/tools/questions/model.ts`(agent-tools), `core/server/identity/question-evidence.ts`(events-identity)다. `grep -rn "question_evidence" packages/core`가 `core/storage/ledger/`뿐일 때만 지운다. 아니면 남은 file을 보고한다.
3. commit 뒤 Bus 배포 — `I2.1#14`, S1 3장 "command 층"
   - `core/storage/ledger/commit-publisher.ts`를 새로 둔다. `createCommitPublisher({ reader, bus })`가 `onCommit(success)`를 돌려준다. `success.first_seq`가 null이 아니면 `first_seq..last_seq`의 `events` 행을 reader로 읽어 `domainEventEnvelopeSchema`로 검사하고 `bus.publish`한다. 검사에 실패한 행은 건너뛰고 log만 남긴다(조용히 삼키지 않는다: 건너뛴 수를 log에 적는다).
   - 지금 writer가 commit 뒤 `wake`(`writer-message.ts`, `executor.ts:197`)를 돌려주고 dispatcher(`core/events/subscribe.ts`의 `createEventDispatcher`)가 200ms마다 reader로 다시 읽는다. 이 경로는 events-bus-gateway가 지운다. 이 task는 `wake`를 그대로 두고 `onCommit`을 부를 지점(`core/storage/ledger/writer.ts`의 `runCommand` 결과를 받는 곳)을 정해 `LedgerDeps`에 `onCommit?: (success: CommandSuccess) => void` 선택 칸으로 더한다. 연결은 wiring의 몫이다.
4. domain event만 쓰게 한다 — `I2.1#17`, S1 5장
   - `core/storage/ledger/domain-events.ts`(새)에 `isDomainEvent(type)`(`DOMAIN_EVENTS`의 type 집합)을 둔다.
   - `Tx.emit`이 domain event가 아닌 type을 `internal` 오류로 거절하게 하는 분기를 `LedgerDeps.domainOnly?: boolean`(기본 false)으로 둔다. 기본 false인 이유: 지금은 다른 단위 command 약 160곳이 아직 옛 event를 `emit`한다(`grep -rn "\.emit(" packages/core`). 모든 단위가 merge된 뒤 cleanup이 wiring에서 true로 켠다.
   - 옛 event 정의 `defineEvent` 약 155곳은 소유 단위가 지운다. 여기서 지우지 않는다.
5. 상태를 `events` 표에서 읽는 곳의 목록을 낸다 — `I2.1#2`(다른 단위 줄)의 "넘기는 것까지가 일"
   - `grep -rn "from events\|join events\|events where" packages/core`로 나온 file을 단위별로 묶어 보고에 적는다. 하나라도 남으면 이 표에서 event를 지울 수 없다. 이 task는 그 file들을 고치지 않는다.
6. 위험 test
   - `packages/core/storage/ledger/domain-event_test.ts` 하나, 이름은 "domain event가 상태와 같은 tx에 쓰인다". SQLite 하나를 임시 폴더에 열고(`openLedger`), 상태 표 한 행과 `ProblemOpened`를 한 transaction에서 쓰고 성공하면 둘 다 있고, 같은 transaction에서 상태를 쓴 뒤 오류를 내면 상태와 event가 둘 다 없는지 본다. fake `Bus`로 commit 뒤에만 `publish`가 불리고 롤백이면 불리지 않는지도 같은 test에서 본다. subprocess, Worker를 새로 띄우지 않는다. writer Worker 없이 `Ledger.transaction`을 쓴다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "domain event가 상태와 같은 tx에 쓰인다"
- 남지 않음: 위 1·2의 조건이 맞아 지운 것만 해당한다. `grep -rn "approval_uses\|usableApproval\|recordedUse" packages/core/storage`가 0줄이고 `events` 표에 `run` 칸이 없다. 조건이 안 맞아 못 지운 것은 보고에 file 목록으로 적는다.

## 보고

- 바꾼 file
- 등록할 것: wiring file(`packages/core/main/daemon/wiring/events.ts`. core-wiring 뒤에 있다. 이름이 다르면 그 단위의 file) — `createCommitPublisher({ reader, bus })`의 `onCommit`을 `LedgerDeps.onCommit`에 잇는다. 이 한 줄은 events-reactor가 wiring을 마지막에 고칠 때 넣는다. 그 task에 넘길 내용으로 적는다.
- 안 쓰게 된 export: `recordedUse`, `usableApproval`(`ledger/mod.ts`), `protocol/server/registration.ts`의 `Tx.useApproval`, `protocol/events/events.ts`의 `eventEnvelopeBaseSchema.run`
- 정한 것: `domainOnly` 기본 false의 이유와 켜는 시점, `blob_refs.registered_seq` FK를 뺀 것
- 계약 바꾸기 요청(wave 3): `Tx.useApproval`을 `protocol/server/registration.ts`에서 지울 것(cleanup이 할지 lead가 정한다)

# place-session

agent가 놓이는 place와 session의 열림·끝남·fork·rewind의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/place-session.md`.

## 앱 place의 Operator가 앱 data를 project 폴더에 쓸 길이 없다

```yaml
kind: bug
modules: [packages/core/agent-roles, packages/protocol, packages/shell/renderer]
```

지금: `project-docs/products/AGENT-ROLE.md`의 O2는 "앱 place의 Operator는 앱 data를 사람이 정한 project 폴더에 파일로 쓸 수 있다", O3는 "project 밖에 문서를 쓰게 되면 먼저 어느 project에 둘지 사람에게 묻는다"이다. 코드의 폴더 규칙(`packages/core/agent-roles/place/place-folders.ts`의 `placeScope`)은 앱 place의 Operator에게 앱 source 읽기만 주고 쓰기는 비운다. Operator 정의에도 화면에도 그 project 폴더를 정하는 칸이 없다(`packages/core/agent-roles/tools/operator.ts`의 주석은 "사람이 정한다"고만 한다).

영향: 사람이 앱 Operator에게 앱 data를 정리해 파일로 남기라고 하면 쓸 폴더가 없어 forbidden이다. 정책 문서와 코드가 달라 agent prompt나 다음 계획이 O2를 믿고 짠다.

고치려면:
- 만든다(중간): Operator 정의에 쓸 project 하나를 두고(사람이 화면에서 고름), `placeScope`가 그 project 폴더를 앱 Operator의 쓰기에 더하고, runtime 권한과 rewind도 같은 규칙을 따른다.
- 정책을 줄인다(작음): O2·O3를 AGENT-ROLE.md에서 지우고 `operator.ts` 주석을 고친다. 앱 Operator는 결과를 대화와 app-api로만 남긴다.
- 추천: 줄인다. 실제로 앱 data를 파일로 내보낼 일이 생기면 만든다.

정할 것: 앱 Operator가 project 폴더에 파일을 쓰는 기능을 지금 둘지.

## 성공한 tool call이 ledger에 `requested`로 남는다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: `packages/core/lophn-agent/run-loop/core-ports.ts`의 `attemptTool`은 `record`(state `requested`) 뒤 tool을 실행하고 곧바로 `finishToolCall`을 `{state_seq: "0"}`로 부른다. 그 사이 `decideToolCall`·`startToolCall`을 부르지 않는다(production 코드에서 두 command를 부르는 곳이 없다. `run-loop/runtime-access.ts`의 허용 목록에만 있다). `packages/core/lophn-agent/tools/commands.ts`의 finish는 `requested`에서 success로 끝내기를 `conflict("a requested call cannot finish as success")`로 거절하고, `attemptTool`은 그 결과를 보지 않는다. failure·not_executed는 requested에서 끝낼 수 있어 기록된다. 그래서 성공한 call만 `state: requested`, `decision: null`, `outcome: null`, `output: null`로 남는다. `tests/e2e/file-write_test.ts`와 `tests/e2e/approval_test.ts`가 재현한다(disk에는 file이 쓰였고 model의 다음 요청에도 success 결과가 간다).

영향: rewind preview의 `externalFacts`(`session/rewind/preview.ts`)는 `outcome.kind = 'success'`인 external call만 세므로, 성공한 외부 요청이 "되돌릴 수 없는 효과"로 사람에게 보이지 않는다. 성공한 tool 결과 blob(`tool_call_output`)이 ledger에 이어지지 않아 `turn-body-reads.ts`로 결과를 다시 읽을 수 없고, observability(`observability/reads.ts`)가 성공한 call을 미완으로 보여 준다.

고치려면:
- decide·start를 부른다(작음): `attemptTool`이 record 뒤 이미 내린 결정으로 `decideToolCall`을, 실행 직전에 `startToolCall`을 부르고, finish의 `compare`를 그 뒤 `state_seq`로 준다. 셋 중 하나라도 실패하면 버리지 않고 uncertain으로 닫는다.
- finish가 requested에서 success를 받게 한다(작음): decision과 started_at이 비어 command의 상태 전이와 어긋난다.
- 추천: decide·start를 부른다. command 쪽 규칙이 설계다.

## daemon에서 `rewind/preview`의 `restore_all`이 늘 `internal`로 실패한다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/main, packages/core/storage]
```

지금: preview read(`packages/core/lophn-agent/session/rewind/reads.ts`)는 `restore_all`일 때 `snapshot.port(appWritesPort)`를 부른다. reader Worker는 등록 하나의 `ports`를 그 등록의 `reads`에만 붙인다(`packages/core/storage/ledger/reader-worker.ts`). `appWritesPort`는 `packages/core/main/daemon/wiring/rewind-registration.ts`의 `reads: []`인 등록에 있고, preview read가 든 `session/rewind/reader.ts`의 `createReaderRegistration`은 `ports: new Map()`이다. 그래서 reader Worker 안에서 `unregistered read port`가 나고 route는 `PreviewRewind: internal`을 낸다. `tests/e2e/rewind_test.ts`가 재현한다. port를 preview 등록에 붙이면 그 test가 10번 연속 통과한다(worker가 임시 변경으로 확인).

영향: 사람이 session을 앞 시점으로 되돌리며 file을 복원하는 길(`restore_all`)이 화면에서 늘 실패한다. agent가 망친 file을 되돌릴 수 없다.

고치려면:
- port를 preview 등록으로 옮긴다(작음): `appWritesOf`가 `main/daemon/rewind-glue.ts`에 있으므로 `rewind-registration.ts`가 `createReaderRegistration()`의 reads와 `appWritesPort`를 한 등록으로 내놓거나, `createReaderRegistration`이 port를 인자로 받는다.
- reader Worker가 모든 등록의 port를 모든 read에 붙인다(작음): port 이름이 겹치면 조용히 덮인다.
- 추천: port를 preview 등록으로 옮긴다.

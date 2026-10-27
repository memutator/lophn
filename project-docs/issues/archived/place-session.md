# place-session (닫음)

## pre-image를 core가 읽어 두는 memory route 둘과 root별 기록

```yaml
kind: defect
modules: [packages/core/lophn-agent, packages/core/main]
closed: kept
guard: 없음
```

지금: file tool이 쓰기 전에 `StageRewindFile`로 core에게 쓰기 직전 파일 내용을 읽어 두게 하고, 쓴 뒤 `RecordRewindWrite`로 결과를 기록한다(`session/rewind/write-routes.ts`, `record.ts`의 `recordBeforeWrite`). 둘 다 memory route고 허용 폴더를 root로 기록한다. 한 단위에 허용 폴더가 둘 이상이거나 앞 기록의 after와 뒤 기록의 before가 다르면 `judge.ts`가 `chain_broken`으로 건너뛴다.

영향: route 둘, root별 기록, 판정 규칙(`chain_broken` 등 skip 사유 아홉 개)이 무겁다. 대신 agent runtime이 보낸 내용을 믿지 않고 core가 직접 읽으므로 파일 되돌리기가 틀린 내용으로 덮어쓰는 일(사용자 파일 손상)을 막는다.

고치려면: 추천: 남긴다(kept). 데이터 보호 장치라 단순화 이득이 작다. 이유를 `write-routes.ts` 머리 주석에 한 문단으로 둔다.

닫음: 남긴다. 되돌릴 때 틀린 내용으로 사람 파일을 덮지 않게 한다.

## session 되살리기(unarchive) route에 handler가 없다

```yaml
kind: defect
modules: [packages/protocol, packages/core/lophn-agent]
closed: fixed
guard: 없음
```

지금: `protocol/lophn-agent/sessions.ts`에 `unarchiveSession` command가 정의되고 `registry.ts`에 등록돼 있지만 `lophn-agent/session/commands.ts`에는 archive·delete·rename만 있고 handler가 없다. UI(`agent-tab-core-source-sessions.ts`)도 부르지 않는다. architecture 문서가 이미 "archive를 풀어 다시 여는 것(되살리기)은 지금 없다. 되살리면 session 허락과 대기 request가 돌아오지 않는 규칙을 따로 정해야 한다"고 적었다. 그러니 기능 누락이 아니라 정의만 남은 죽은 route다.

영향: 계약은 있는데 동작이 없어, 쓸 수 있는 기능으로 오해하게 한다.

고치려면:
- A. route와 schema를 지운다. 비용 작다. 문서와 일치한다.
- B. 지금 짓는다. archive가 call을 닫고 허락을 버리는 것(`endSession`)을 되돌릴 수 없어, 되살린 session이 받는 것과 못 받는 것의 규칙을 먼저 정해야 한다. 비용 중간~큼.
- 추천: A. 닫힌 session은 새 session으로 이어 가는 게 지금 설계다.

정한 것: 지운다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

닫음: `unarchiveSession` command와 input·compare schema, registry의 거르는 줄을 지웠다.

## 앱 place의 Operator는 file 범위가 없다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/main]
closed: fixed
guard: place-data_test.ts
```

지금: `run-loop/place-data.ts`의 `readPlaceData`는 project place면 role과 상관없이 project 폴더를 read·write에 넣고(Operator도 받는다), app place는 `role === "app_engineer"`일 때만 앱 `source_path`를 넣는다. 앱 place의 Operator는 scope가 비어 file tool을 쓸 폴더가 없다. `rewind-glue.ts`의 `placeFoldersOf`도 같은 이유로 `[]`를 준다. architecture 문서는 project의 Operator만 폴더를 적고 앱 place의 Operator는 말이 없다.

영향: 앱에 놓인 Operator는 grant받은 tool과 context는 쓰지만 앱 폴더 file은 읽고 쓰지 못한다. 앱 폴더 일을 맡길 수 없다.

고치려면: `place-data.ts`의 app 분기에서 `role === "app_engineer"` 조건에 operator를 더하고(`placeFoldersOf`도 같이), architecture의 file tool 줄에 앱 Operator를 적는다. 비용 작다. 다만 쓰기를 Operator에게 여는 것은 권한 결정이다.

정한 것: 앱 Operator에게 앱 source 폴더 읽기를 준다. 쓰기는 주지 않는다.

닫음: `place-data.ts`의 `appSourceScope`가 앱 place의 Operator에게 앱 source 폴더 읽기만 준다(쓰기는 App Engineer만). `rewind-glue.ts`의 `placeFoldersOf`는 쓰기 기록용이라 Operator에게 폴더를 주지 않는다.

## 숨김 구간을 `reverts.result_seq`로 잡는 규칙

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: kept
guard: 없음
```

지금: rewind가 숨기는 구간은 `boundary_seq`부터 결과를 확정한 때의 session 마지막 메시지 순번 `result_seq`까지다(`session/rewind/hidden.ts`의 `hiddenRangesOf`, `summary-read.ts`도 같은 칸을 읽는다). 그 뒤에 접수한 메시지는 숨기지 않는다. 이유(숨김에 끝이 없으면 rewind 뒤의 대화가 모두 사라진다)는 `hidden.ts` 머리 주석에 이미 있다.

영향: 숨김 끝이 messages가 아니라 reverts 행의 `result_seq`에서 나오는 숨은 규칙이다. 이유 설명은 코드에 있어 남는 비용은 작다.

고치려면: 추천: 남긴다(kept). 주석이 이미 이유를 적었으니 별도 작업 없이 닫는다.

닫음: 숨김 끝이 reverts 행의 `result_seq`에서 나오는 규칙이지만 이유(끝이 없으면 rewind 뒤의 대화가 모두 사라진다)는 `hidden.ts` 머리 주석에 있다.

## PM이 초안 폴더를 연 같은 turn에 쓰면 forbidden이다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/agent-roles, packages/core/main, packages/core/projects]
closed: fixed
guard: packages/core/agent-roles/place/place-folders_test.ts
```

지금: file tool이 닿는 폴더(`scope`)는 turn을 시작할 때 `run-loop/prepare.ts`가 `deps.placeData`(`agent-roles/place/place-data.ts`)로 한 번 채운다. 열린 초안 폴더는 `openDraftFolders`가 그때 읽는다. Project Manager가 `context.draft`(`agent-roles/tools/context/draft.ts`의 `openDraft`)로 폴더를 새로 열어도 `ctx.scope`에는 더하지 않아, 같은 turn의 `file.write`가 scope 밖으로 거절된다. 다음 turn부터 된다. 두 번째 문제는 rewind 쪽이다. `main/daemon/rewind-glue.ts`의 `placeFoldersOf`가 따로 폴더 목록을 만드는데 Project Manager의 project 폴더와 App Engineer의 source만 있고 초안 폴더가 없다. `StageRewindFile`/`RecordRewindWrite`가 `the folder is not open to this session`으로 거절하고, `recordBeforeWrite`는 그래도 쓰기를 하되 `recorded=false`를 낸다. 초안 폴더 쓰기는 다음 turn부터도 rewind로 되돌릴 수 없다.

영향: PM이 폴더를 열고 바로 계약을 쓰지 못해 turn 하나를 헛돈다(token). 초안 파일 쓰기는 "쓴 뒤 되돌리기"가 안 되어 rewind 약속(파일 쓰기는 되돌릴 수 있다)이 이 경로에서만 깨진다.

고치려면:
- A. `openDraft`가 성공하면 `ctx.scope`의 read·write에 `folder`를 더한다(타입은 readonly지만 실체는 `prepare.ts`의 가변 배열). 한 줄이고 비용 작다.
- B. scope를 만드는 곳을 하나로 합친다. `placeFoldersOf`가 `agent-roles/place/place-data.ts`와 같은 규칙을 쓰게 해(초안 폴더와 project Operator 포함) 같은 모양의 복사본 둘을 없앤다. 비용 중간.
- 추천: A를 지금, B를 같이 한다. 폴더 목록이 둘이라 한쪽만 고치면 이번처럼 어긋난다.

닫음: `PlaceScope`에 `open(folder)`를 두고 `openDraft`가 초안 폴더를 연 뒤 부른다(`run-loop/prepare.ts`가 그 turn의 read·write에 더한다). 폴더 목록 규칙은 `agent-roles/place/place-folders.ts`의 `placeScope` 하나이고, turn scope(`place-data.ts`)와 rewind의 쓰기 폴더(`main/daemon/place-folders-glue.ts`의 `placeFoldersOf`)가 같은 것을 쓴다. rewind는 이제 PM의 열린 초안 폴더와 project Operator의 폴더를 기록한다. `rewind-glue.ts`의 사본과 직접 SQL은 지웠다(조회는 projects·apps의 `lookups.ts`).

## agent runtime process의 Deno 권한에 place 폴더가 없다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/agent-roles]
closed: fixed
guard: packages/core/agent-roles/place/place-folders_test.ts
```

지금: file tool과 shell은 agent runtime process(`main/agent-runtime`) 안에서 돈다. 그 process의 권한은 `tools/runtime-permissions.ts`의 `agentRuntimePermissions`가 `placeFolders.read`·`write`를 `allow_read`·`allow_write`에 얹어 만들고, `supervision/security/launch-spec.ts`의 `launchArgv`가 `--no-prompt`와 `--allow-read`·`--allow-write` flag로 바꾼다. 그런데 `run-loop/runtime.ts`의 `specFor`는 늘 `placeFolders: { read: [], write: [] }`를 넘기고 다른 곳에서 채우지 않는다. turn의 `scope`(`agent-roles/place/place-data.ts`)가 폴더를 열어도 Deno 권한은 data root, skill root, socket뿐이라 `tools/file/read.ts`의 `Deno.readFile` 같은 호출은 `NotCapable`이다(같은 flag 조합으로 허락 밖 경로를 읽어 확인했다). 실제 turn을 돌려 보지는 않았다.

영향: place 폴더가 data root 밖이면 PM, project Operator, App Engineer, 앱 Operator 모두 file tool과 shell로 그 폴더를 못 읽고 못 쓴다. agent가 project 일을 하지 못한다.

고치려면: 열린 project·앱 source 폴더 목록으로 `placeFolders`를 채우고, 목록이 바뀌면 runtime을 다시 띄운다(hosts·MCP가 바뀔 때와 같은 길, 중간). 폴더 목록 만드는 곳이 `rewind-glue.ts`의 `placeFoldersOf`와 `agent-roles/place/place-data.ts`로 둘이니 같은 규칙으로 합친다(위 "PM이 초안 폴더를 연 같은 turn에 쓰면 forbidden이다"와 같은 정리).

닫음: `run-loop/runtime.ts`가 `readPlaceFolders`로 Deno 권한의 place 폴더를 받는다. 조립(`wiring/lophn-agent-runtime.ts`)이 `runtimeFoldersOf`로 active project 폴더와 active 앱 source 전체의 합을 넘기고, 초안 폴더는 turn 중에 열리므로 `<data root>/projects` 상위째 쓰기를 연다. 목록이 바뀌면 hosts·MCP와 같은 1초 polling에서 child를 다시 띄운다(돌던 turn은 끊긴다). session마다의 범위는 file tool scope가 지킨다. 실제 turn으로는 확인하지 않았다(process를 건너는 확인은 E2E 몫).

## 성공한 tool call이 ledger에 `requested`로 남는다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
closed: fixed
guard: tests/e2e/file-write_test.ts, tests/e2e/approval_test.ts
```

지금: `packages/core/lophn-agent/run-loop/core-ports.ts`의 `attemptTool`은 `record`(state `requested`) 뒤 tool을 실행하고 곧바로 `finishToolCall`을 `{state_seq: "0"}`로 부른다. 그 사이 `decideToolCall`·`startToolCall`을 부르지 않는다(production 코드에서 두 command를 부르는 곳이 없다. `run-loop/runtime-access.ts`의 허용 목록에만 있다). `packages/core/lophn-agent/tools/commands.ts`의 finish는 `requested`에서 success로 끝내기를 `conflict("a requested call cannot finish as success")`로 거절하고, `attemptTool`은 그 결과를 보지 않는다. failure·not_executed는 requested에서 끝낼 수 있어 기록된다. 그래서 성공한 call만 `state: requested`, `decision: null`, `outcome: null`, `output: null`로 남는다. `tests/e2e/file-write_test.ts`와 `tests/e2e/approval_test.ts`가 재현한다(disk에는 file이 쓰였고 model의 다음 요청에도 success 결과가 간다).

영향: rewind preview의 `externalFacts`(`session/rewind/preview.ts`)는 `outcome.kind = 'success'`인 external call만 세므로, 성공한 외부 요청이 "되돌릴 수 없는 효과"로 사람에게 보이지 않는다. 성공한 tool 결과 blob(`tool_call_output`)이 ledger에 이어지지 않아 `turn-body-reads.ts`로 결과를 다시 읽을 수 없고, observability(`observability/reads.ts`)가 성공한 call을 미완으로 보여 준다.

고치려면:
- decide·start를 부른다(작음): `attemptTool`이 record 뒤 이미 내린 결정으로 `decideToolCall`을, 실행 직전에 `startToolCall`을 부르고, finish의 `compare`를 그 뒤 `state_seq`로 준다. 셋 중 하나라도 실패하면 버리지 않고 uncertain으로 닫는다.
- finish가 requested에서 success를 받게 한다(작음): decision과 started_at이 비어 command의 상태 전이와 어긋난다.
- 추천: decide·start를 부른다. command 쪽 규칙이 설계다.

닫음: `attemptTool`(`run-loop/core-ports.ts`)이 Gate 판정 뒤 handler가 돌기 직전에 `decideToolCall`(allow, reason `gate_run`·`no_gate`)과 `startToolCall`을 부르고, finish의 `compare`를 그 뒤 `state_seq`로 준다. 셋 중 하나가 실패하면 그 call을 uncertain으로 닫는다. Gate가 거절하거나 실행하지 않은 call은 전처럼 finish만 한다.

## daemon에서 `rewind/preview`의 `restore_all`이 늘 `internal`로 실패한다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/main, packages/core/storage]
closed: fixed
guard: tests/e2e/rewind_test.ts
```

지금: preview read(`packages/core/lophn-agent/session/rewind/reads.ts`)는 `restore_all`일 때 `snapshot.port(appWritesPort)`를 부른다. reader Worker는 등록 하나의 `ports`를 그 등록의 `reads`에만 붙인다(`packages/core/storage/ledger/reader-worker.ts`). `appWritesPort`는 `packages/core/main/daemon/wiring/rewind-registration.ts`의 `reads: []`인 등록에 있고, preview read가 든 `session/rewind/reader.ts`의 `createReaderRegistration`은 `ports: new Map()`이다. 그래서 reader Worker 안에서 `unregistered read port`가 나고 route는 `PreviewRewind: internal`을 낸다. `tests/e2e/rewind_test.ts`가 재현한다. port를 preview 등록에 붙이면 그 test가 10번 연속 통과한다(worker가 임시 변경으로 확인).

영향: 사람이 session을 앞 시점으로 되돌리며 file을 복원하는 길(`restore_all`)이 화면에서 늘 실패한다. agent가 망친 file을 되돌릴 수 없다.

고치려면:
- port를 preview 등록으로 옮긴다(작음): `appWritesOf`가 `main/daemon/rewind-glue.ts`에 있으므로 `rewind-registration.ts`가 `createReaderRegistration()`의 reads와 `appWritesPort`를 한 등록으로 내놓거나, `createReaderRegistration`이 port를 인자로 받는다.
- reader Worker가 모든 등록의 port를 모든 read에 붙인다(작음): port 이름이 겹치면 조용히 덮인다.
- 추천: port를 preview 등록으로 옮긴다.

닫음: preview read를 `appWritesPort`와 같은 reader 등록(`main/daemon/wiring/rewind-registration.ts`)에 둔다. `session/rewind/reader.ts`는 `createRewindReads()`로 정의를 내놓고 자기 등록에는 checkpoints·list만 둔다.

## 사람이 turn을 멈춰도 agent runtime의 진행 중인 model 요청이 끊기지 않는다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/main, packages/protocol]
closed: fixed
guard: tests/e2e/stop_test.ts
```

지금: `turns/stop`(`packages/core/lophn-agent/run-loop/commands.ts`의 stop)은 core의 turn 행만 `finished`/`interrupted`(`user_stopped`)로 닫는다. core에서 agent runtime child로 turn 멈춤을 알리는 message가 없다(`packages/protocol/supervision/supervision.ts`의 parent 쪽 message는 `hello`, `stop`(process 종료), `credit`과 각종 `*_response`뿐이다). child의 `run-loop/driver.ts`에 `stop(turn, reason)`과 `endSession`이 있지만 production에서 부르는 곳이 없다. child는 `turn.ts`의 `stopped(state)`로 turn 행을 읽어 멈춤을 아는데, 그 확인은 prompt 조립 뒤, tool 시작 전, retry 대기 전후, 응답 뒤에만 있고 model 응답을 기다리는 동안에는 없다. 그래서 응답이 멈춘 provider 요청은 연결이 열린 채 남는다(호출당 idle 120초나 `stall_ms`가 끊을 때까지). `tests/e2e/stop_test.ts`가 재현한다(turn은 약 100ms에 닫히고 fake server의 연결은 열려 있다).

영향: 사람이 멈춘 turn이 provider에 token을 계속 쓴다. 화면은 멈췄다고 보이지만 model 요청은 최대 120초 더 살아 있고, 그 사이 응답이 끝나면 child가 그 결과를 받는다.

고치려면:
- turn 멈춤 message를 더한다(중간): supervision parent message에 `turn_stop {turn, reason}`을 더하고, core의 stop command가 끝난 뒤 그 turn을 맡은 child에 보내며, child가 `driver.stop(turn, reason)`을 부른다. protocol 변경이라 쓰는 쪽을 같은 변경에서 고친다.
- child가 model 호출 중에도 turn 행을 주기적으로 읽는다(작음): 읽기가 늘고 멈춤이 polling 간격만큼 늦는다.
- 추천: turn 멈춤 message를 더한다. `run-loop` boundary의 "멈춤은 진행 중인 요청을 끊는다"를 그대로 지킨다.

닫음: supervision parent message에 `turn_stop {turn, reason: "user_stopped"}`가 있다. core(`main/daemon/wiring/lophn-agent-runtime.ts`)가 Bus의 `TurnEnded`(interrupted, `user_stopped`)를 보고 child에 보내고, child(`main/agent-runtime/main.ts`)가 `driver.stop`을 부른다. session archive·delete로 닫는 turn은 아직 알리지 않는다(다음 계획 `e2e-coverage`).

## 앱 place의 Operator가 앱 data를 project 폴더에 쓸 길이 없다

```yaml
kind: bug
modules: [packages/core/agent-roles, packages/protocol, packages/shell/renderer]
closed: fixed
guard: tests/e2e/operator_test.ts
```

지금: `project-docs/products/AGENT-ROLE.md`의 O2는 "앱 place의 Operator는 앱 data를 사람이 정한 project 폴더에 파일로 쓸 수 있다", O3는 "project 밖에 문서를 쓰게 되면 먼저 어느 project에 둘지 사람에게 묻는다"이다. 코드의 폴더 규칙(`packages/core/agent-roles/place/place-folders.ts`의 `placeScope`)은 앱 place의 Operator에게 앱 source 읽기만 주고 쓰기는 비운다. Operator 정의에도 화면에도 그 project 폴더를 정하는 칸이 없다(`packages/core/agent-roles/tools/operator.ts`의 주석은 "사람이 정한다"고만 한다).

영향: 사람이 앱 Operator에게 앱 data를 정리해 파일로 남기라고 하면 쓸 폴더가 없어 forbidden이다. 정책 문서와 코드가 달라 agent prompt나 다음 계획이 O2를 믿고 짠다.

고치려면:
- 만든다(중간): Operator 정의에 쓸 project 하나를 두고(사람이 화면에서 고름), `placeScope`가 그 project 폴더를 앱 Operator의 쓰기에 더하고, runtime 권한과 rewind도 같은 규칙을 따른다.
- 정책을 줄인다(작음): O2·O3를 AGENT-ROLE.md에서 지우고 `operator.ts` 주석을 고친다. 앱 Operator는 결과를 대화와 app-api로만 남긴다.
- 추천: 줄인다. 실제로 앱 data를 파일로 내보낼 일이 생기면 만든다.

정한 것: 줄인다. O2·O3와 Operator prompt의 약속을 지운다(계획 `e2e-coverage`의 `operator-project-write`). (사람)

닫음: 정책을 줄였다. AGENT-ROLE.md에서 O2·O3를 지우고 Operator prompt와 `operator.ts`·`operators.ts` 주석을 코드(`placeScope`: 앱 place의 Operator는 앱 source 읽기만)에 맞췄다. `tests/e2e/operator_test.ts`의 `app-no-project-write` 행이 앱 Operator의 project 폴더·앱 source 쓰기가 `forbidden`인 것을 지킨다.

## agent runtime child의 Deno 권한 좁히기가 경계가 아닌데 깨지고 무겁다

```yaml
kind: defect
modules: [packages/core/lophn-agent, packages/core/agent-roles, packages/core/main, packages/core/supervision]
closed: fixed
guard: 없음
```

지금:
- `packages/core/lophn-agent/tools/runtime-permissions.ts`의 `agentRuntimePermissions`가 agent runtime child(`main/agent-runtime`)의 권한을 좁힌다. `allow_read`는 data root, 내장·등록 skill 폴더, 앱 socket, place 폴더이고 `allow_write`는 `<data>/derived/lophn-agent`, socket, place 쓰기 폴더다. `allow_run`은 MCP stdio 실행 파일과 `/bin/sh`이고 net은 `net_any`다. `register.ts`의 `agentRuntimeLaunchSpec`이 이 결과를 launch spec에 싣고 `supervision/security/launch-spec.ts`의 `launchArgv`가 `--allow-read=...` 같은 flag로 바꾼다. launch spec은 dev와 packaged가 같은 경로다(`launchArgv`를 쓰는 곳은 `supervision/responsiveness/run.ts` 하나이고 dev 분기는 없다). core 자신은 dev와 packaged 모두 `--allow-all`이다(`shell/main/desktop/core/supervise.ts`, 2026-10-24부터).
- place 폴더 목록은 `lophn-agent/run-loop/runtime.ts`의 `readPlaceFolders`가 받고, 조립 `main/daemon/wiring/lophn-agent-runtime.ts`가 `main/daemon/place-folders-glue.ts`의 `runtimeFoldersOf`로 채운다(active project 폴더, active 앱 source, active domain 폴더, active project의 workflows 폴더). 같은 파일의 1초 polling이 provider host, skill 폴더, MCP, place 폴더 중 하나라도 바뀌면 `io.updateSpec`으로 child를 다시 띄운다. 도는 turn이 있으면(`inbox.anyRunning()`) 다시 띄우지 않고 다음 주기에 다시 본다. 그래서 turn이 이어지는 동안은 새 폴더가 Deno 권한에 들어오지 않는다.
- 이 좁힘은 경계가 아니다. `packages/core/lophn-agent/tools/shell/run.ts`의 `runShell`은 `/bin/sh`를 사용자 uid로 띄우고(env만 `clearEnv`로 거른다) 파일 시스템 sandbox가 없다. Deno 권한 flag는 자식 process에 걸리지 않으므로 file tool에 막힌 경로도 shell로 닿는다. file tool의 폴더 범위는 이미 코드가 지킨다(`packages/core/lophn-agent/tools/file/scope.ts`의 `resolveInPlace`, 오류 "path is outside the place").
- 한 번 깨졌다. `archived/place-session.md`의 "agent runtime process의 Deno 권한에 place 폴더가 없다"는 `placeFolders`가 빈 채라 data root 밖 place 폴더를 file tool이 `NotCapable`로 못 읽었다. `readPlaceFolders`를 더해 닫았고, 그때도 실제 turn으로는 확인하지 못했다.
- 같은 종류의 좁힘이 packaged core에도 있었다(`packagedPermissionFlags`). 설치된 .deb에서 project 등록이 `projects/registry/record.ts`의 `existsSync`가 `NotCapable`을 던져 실패했고, launcher는 "wasn't registered, so nothing was saved"를 보였다. 사람이 2026-10-24에 packaged core도 dev처럼 `--allow-all`로 돌리기로 정했고 같은 날 고쳤다. dev와 test가 `--allow-all`이라 이 종류의 실패는 설치본에서만 드러난다.

영향: 사용자 데이터나 권한을 지키는 효과는 없고(shell로 우회) 깨지면 사람이 보는 동작이 막힌다. 폴더를 더하거나 바꾸는 쪽(project·앱 등록, domain 만들기, 폴더 종류 추가)마다 `placeScope`와 `runtimeFolders` 두 곳을 같이 고쳐야 하고(`architecture/place-session.md`), 한쪽만 고치면 file tool은 열렸는데 child가 `NotCapable`로 거절한다. turn이 이어지는 동안은 새 폴더가 늦게 열린다. 실제 turn으로만 드러나는 실패라 개발 비용이 크다. 이 좁힘이 막는 것은 AGENTS.md "속도"의 agent 실수가 아니라(그 실수는 file tool scope와 approval이 막는다) 우회되는 가짜 경계다.

고치려면:
- child를 `--allow-all`로 돌리고(`--no-prompt`, `--cached-only`, `--frozen`은 유지) `agentRuntimePermissions`, `readPlaceFolders`, `runtimeFoldersOf`, `runtimeFolders`와 폴더 목록이 바뀌면 다시 띄우는 polling을 지운다. 중간. `launch-spec.ts`의 `FORBIDDEN_FLAGS`가 `--allow-all`을 거절하므로 launch spec에 이 kind만 켜는 칸을 둔다(`net_any`와 같은 모양). provider host, skill 폴더, MCP net·run 목록도 권한 때문에만 다시 띄우던 것이라 같이 사라지는지 구현에서 확인한다. 고친 뒤 `architecture/place-session.md`, `artifact.md`, `kinds.md`, `domain.md`, `agent-definition.md`, `layers.md`의 child 권한 문장을 같이 고친다. 잃는 것: file tool 코드의 버그가 폴더 밖을 건드려도 Deno가 막지 못한다(shell로 이미 열려 있다).
- 좁힘을 두고 폴더 목록 버그만 고친다. 작음. 같은 종류의 실패가 폴더 종류를 더할 때마다 다시 생긴다.
- 추천: 첫째. sandbox는 AI가 쓴 코드를 돌리는 process에만 둔다: 앱 process(`apps/runtime/processes/spawn.ts`), flow process(`main/flow-host/flags.ts`), release prepare 자식(`apps/releases/prepare/from-source.ts`). `projects/kinds/host/process.ts`의 kinds worker도 같은 이유로 둔다.

정한 것(사람, 2026-10-24): agent runtime child는 `--allow-all`로 돌리고 file tool의 폴더 범위는 코드에 둔다. 구현은 아직 하지 않았다.

닫음: agent runtime child는 `--allow-all`(`--cached-only --frozen --no-prompt`는 그대로)로 뜬다. launch spec의 `allow_all`은 `lophn-agent/runtime` kind만 세울 수 있고 나머지 kind는 `checkLaunchSpec`이 거절한다(`launch-spec_test.ts`). `agentRuntimePermissions`, `runtimeFolders`, `runtimeFoldersOf`, `readPlaceFolders`, 목록이 바뀌면 child를 다시 띄우던 1초 poll, `allowNetList`·`allowRunList`, `inbox.anyRunning`을 지웠다. file tool의 폴더 범위는 `placeScope`와 `resolveInPlace`가 지킨다. e2e helper `settle`은 runtime이 ready인지만 본다.

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

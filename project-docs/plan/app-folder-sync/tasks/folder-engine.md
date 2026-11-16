# folder-engine

**opus high.** sync core(`packages/protocol/apps/sync/`)에 기계끼리 맞출 때 필요한 규칙을 더한다: 다른 기계의 snapshot을 덮지 않고 row·칸 clock으로 합치기, 부르는 쪽이 정한 clock 아래의 tombstone 정리와 horizon, 정리된 흔적과 안전하게 합칠 수 없는 변경을 버리지 않고 held로 돌려주기, 받는 쪽 시각보다 너무 앞선 clock을 알아보는 판정, PK 풀기. 폰과 컴퓨터가 같이 쓰는 module이라 폰의 동작은 바뀌지 않아야 한다(폰은 tombstone을 정리하지 않으니 horizon이 없다).

- 단위: sync (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/sync`(폴더 전체. 새 file `merge.ts`, `horizon.ts`와 test를 더해도 된다)
- 읽을 것:
  - `packages/protocol/apps/sync/mod.ts` 맨 위 주석(transaction과 찍기 순서), `apply.ts`(`applyChange`의 규칙과 `newer`), `clock.ts`(HLC 꼴, `observe`, `next`), `local.ts`(`stampLocal`은 칸 clock을 무조건 덮는다: 받는 쪽 clock이 저장된 clock보다 뒤면 local write가 다른 사본에서 진다), `tables.ts`(숨은 표, `StateKey`), `changeset.ts`(`encodePk`), `sql.ts`(`tableShape`), `snapshot.ts`(폰의 `adoptSnapshot`: 덮기), `converge_test.ts`(수렴 사례 표)
  - architecture: `project-docs/architecture/app-sync.md` "칸 단위 last-write-wins", "지키는 것" 2
  - 계획 `README.md` "정한 것"(snapshot은 합친다, 미래 clock은 미룬다)과 계약 10(흔적 정리와 horizon. 사람이 쓴 것은 정리 때문에 버려지지 않는다. 언제 지우나(`beforeHlc`)는 core가 정해 넘긴다. 이 module은 넘겨받은 값으로만 지운다)
  - 조사: `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 7.2(미래 시각, 단조 판, tombstone horizon), `happy.md` §6.3
  - 폰 native module이 쓰는 칸: `packages/mobile/modules/lophn-app-db`(표와 칸 이름을 바꾸지 않는다. state에 key를 더하는 것은 된다)
- 계약:
  - 쓰는 것: 없음(zod와 `node:` module을 import하지 않는다. `node-db.ts`와 test만 예외)
  - 내놓는 것(`mod.ts`):
    - `mergeSnapshot(db, source: SyncDb, clock, opts?: {absentDeletes?: {below: bigint, keep: (tbl, pk) => boolean}}) → Result<ApplyStats>`: `source`는 다른 기계의 앱 DB 사본(읽기 전용). 부르는 쪽 transaction 안에서 돈다(`applyRemote`와 같은 규칙: 부르는 쪽이 `foreign_keys`를 끄고 연다). 사용자 표마다 두 DB의 모양(칸 이름과 순서, PK)이 같아야 하고 하나라도 다르면 `conflict`이고 아무것도 쓰지 않는다(부르는 쪽이 rollback). source의 row마다 row clock(없으면 0)으로 INSERT를 적용하고, source의 칸 clock마다 그 칸 UPDATE를 그 clock으로 적용하고, source의 tombstone마다 DELETE를 그 clock으로 적용한다(모두 `applyChange`의 규칙 그대로). source의 horizon이 더 크면 받는다. `absentDeletes`가 있으면(README 계약 10 (a), horizon 밖에서 돌아온 기계): 받는 쪽 row 가운데 source에 없고, row clock과 칸 clock이 모두 `below` 이하이고, `keep`이 false인 것을 지우고(흔적은 `below`로 둔다) 지운 수를 센다. 끝에 본 가장 큰 clock을 `observe`한다
    - `dropTombstones(db, beforeHlc: bigint) → number`: `deleted = 1`이고 clock이 `beforeHlc`보다 작은 `lophn_sync_row` 줄을 지우고, 지운 가장 큰 clock을 state `horizon`으로 올린다(내려가지 않는다)
    - horizon 규칙: `unsafePastHorizon(db, change: {hlc, changeset}) → boolean`(change 안의 row change 가운데 하나라도 clock이 `horizon` 이하이고 그 row에 행도 clock 줄도 없으면 true: 흔적이 정리됐을 수 있어 그대로 적용하면 지워진 row가 되살아나거나 흔적 없이 지워질 수 있다). `applyRemote`는 그런 변경을 적용하지 않고 `ApplyStats.held: number[]`(입력 안의 순번)로 돌려준다. 버리지 않는다: 부르는 쪽이 held로 남긴다. horizon이 없으면(폰) 지금과 같다
    - `hlcAtMs(ms) → bigint`(그 ms의 가장 작은 HLC. `beforeHlc` 계산용), `msOfHlc(hlc) → number`, `clockAhead(hlc, nowMs, boundMs) → number`(앞선 ms, 아니면 0). 미루기는 부르는 쪽(`folder-import`)이 이 판정으로 한다. 받은 clock 값을 깎는 함수는 두지 않는다
    - `decodePk(blob) → ChangesetValue[]`(`encodePk`의 반대)
    - `StateKey`에 `horizon`
    - `ApplyStats`에 `held: number[]`(기존 부르는 쪽은 그대로 컴파일된다), `maxHlc(db) → bigint`(state의 마지막 clock. core가 `settled`를 셀 때 쓴다)

## 할 일

1. `decodePk`와 round-trip test(정수 64-bit 끝값, 실수, text, blob, NULL이 없는 PK 셋).
2. horizon: state key, `dropTombstones`, `unsafePastHorizon`과 `applyRemote`의 held, `ApplyStats.held`. 한 변경은 통째로 적용되거나 통째로 held다(먼저 보고 나서 적용한다). 같은 변경을 두 번 받아도 그대로라는 규칙("엄격히 크다")을 깨지 않는다.
3. `mergeSnapshot`: 위 계약. 합성한 변경은 `applyChange`를 그대로 지난다(규칙을 두 벌 두지 않는다). source에 clock이 없는 row는 clock 0이다: 아직 sync를 켜기 전에 쓴 data가 처음 내보내지는 경우이고, 받는 쪽에 clock이 있는 row는 이기지 못한다. 칸 clock은 칸 번호로 적혀 있으니 모양이 같을 때만 의미가 있다(위의 `conflict`).
4. clock: `clockAhead`, `hlcAtMs`, `msOfHlc`. `next`가 시계가 뒤로 가도 늘어나는지(state의 마지막 clock 위로) test가 없으면 더한다.
5. test(`node --test`, `node:sqlite`, 기존 `converge_test.ts` 꼴에 더한다).

## 끝남

- `npm run check`가 통과한다. 이 폴더의 file은 zod와 `node:` module을 import하지 않는다(`node-db.ts`와 test만 예외).
- 위험 test:
  - "snapshot 합치기는 그 snapshot까지의 변경을 하나씩 적용한 것과 같다": 세 사본 A, B, C가 같은 base에서 서로 다른 칸·row를 고치고 지운 뒤, B에 A의 snapshot을 합친 결과와 B에 A의 변경을 차례로 적용한 결과의 data dump와 clock dump가 같다. 받는 쪽만 고친 칸(더 새 clock)은 남는다. 같은 snapshot을 두 번 합쳐도 그대로다. 모양이 다른 표가 하나라도 있으면 아무것도 바뀌지 않는다
  - "흔적 정리는 사람이 쓴 변경을 버리지 않는다": 지운 뒤 horizon 너머로 정리하고, 그 delete보다 옛 insert·update·delete를 받으면 row가 되살아나지 않고 그 변경은 `held`로 돌아온다(DB는 그대로). horizon보다 새 insert는 들어온다. horizon 안쪽의 변경은 지금처럼 적용된다
  - "horizon 밖에서 돌아온 사본의 합치기는 keep이 가리키는 row를 지우지 않는다": `absentDeletes`가 source에 없는 옛 row만 지우고, `keep`이 true인 row와 `below`보다 새 clock이 있는 row는 그대로다
  - "시계가 뒤로 가도 clock은 늘어난다"
  - (기존) `converge_test.ts`, `reexpress_test.ts`가 그대로 통과한다
- 남지 않음: 없음(더하기).
- flows catalog: 이 task가 더하는 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `mod.ts`에 더한 이름과 signature(한 줄씩), source에 clock이 없는 row의 처리, 10k row snapshot 합치기 시간(`check5.ts` 꼴 data가 있으면 그것으로).

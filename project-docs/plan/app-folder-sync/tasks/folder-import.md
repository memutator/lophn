# folder-import

**opus high.** 컴퓨터가 다른 기계의 하위 폴더를 읽는다: 기계 기록과 앱 기록을 읽어 local 사본으로 두고(한 번에 바꾸고 실패한 읽기로 지우지 않는다), `sync_to`가 있는 앱마다 출처 기계의 data stream을 번호 순서로 따라가며 file을 전부 검사한 뒤 `FolderApply`로 적용한다. 다른 release의 file은 data root로 복사해 held로 둔다. 빠진 번호는 기다리고, 그보다 뒤의 snapshot이 있으면 합친다. 너무 앞선 clock은 미루고 어느 기계의 시계가 얼마나 앞섰는지 알린다. 이 기계가 horizon 밖에서 돌아왔으면 snapshot 합치기에 "다른 곳에서 지워진 옛 row"를 실어 따라온다. 사람이 지운 기계(`machine/forget`)를 목록에서 뺀다. 계기와 조립은 `folder-surface`가 한다.

- 단위: folder (wave 2)
- 선행: folder-contract, folder-engine, folder-decl. 셋 다 wave 1이다
- 소유(이 task만 고친다):
  - `packages/core/folder/import`(새 폴더: `scan.ts`, `stream.ts`, `held.ts`, `status.ts`, `mod.ts`와 test. 이름은 바꿔도 된다)
- 읽을 것:
  - 계약: 계획 `README.md` "다른 계획이 기대는 계약" 1~4, 6, 7, 10과 "정한 것"(snapshot은 합친다, held, 미래 clock은 미룬다, 계기와 backoff), `folder-contract`가 낸 `packages/protocol/folder`와 `packages/core/folder/{fs,destinations,schema,ports}.ts`(`FolderApply`)
  - sync core(`folder-engine`): `clockAhead`, `msOfHlc`
  - 조사 규칙: `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 7.2("알 수 없음"과 "없음", positive assertion, 실패한 읽기로 지우지 않음, 검증 후 적용), 14 (iii) 9·10·13, `omp.md` §6.1(전부 검사한 뒤 쓴다), `hermes.md` §7.3(하나라도 깨지면 아무것도 쓰지 않음), `mixdog.md` §7
  - release의 bundle hash: `packages/core/apps/releases/store.ts`(`loadActiveRelease`). 이 task는 port로 받는다
  - architecture: `project-docs/architecture/app-sync.md` "지키는 것" 5, 6
- 계약:
  - 쓰는 것: 위 계약, `FolderApply`, `Id<"mch">`
  - 내놓는 것(`mod.ts`. `folder-surface`가 조립한다):
    - `createFolderImport(deps)`. deps(port, 모두 인자): `machine: () => Id<"mch">`, `destinations`, `apps(): {app, sync_to, release: {id, bundle_hash, data_schema} | null}[]`, `apply: FolderApply`, `exportState(app) → {settled, data_head, away_since}`(`folder-export`), `heldRows(app) → {table, pk}[]`(이 기계 log의 풀리지 않은 held 줄이 건드리는 row, `folder-log`), ledger `sql`·`transaction`, `clock`, `random`, data root(held와 임시 file)
    - `scan() → Promise<Result<ScanOutcome>>`: destination마다 다른 기계의 `record.json`과 `apps/*/app.json`을 읽어 `folder_records`에 둔다. 한 출처 기계의 기록은 모두 읽혀야 그 기계의 행을 한 transaction에서 바꾼다. 읽기에 실패하거나 `newer_format`이면 옛 행을 그대로 두고 그 기계의 오류로 남긴다. 폴더에서 기계가 사라져도 행을 지우지 않는다
    - `runApp(app) → Promise<Result<ImportOutcome>>`: 그 앱의 destination에 하위 폴더가 있는 출처 기계마다 stream을 따라잡는다(한 번에 64 MiB까지)
    - `forgetMachine(origin)`/`isForgotten`: `folder_records`의 그 기계 행들에 `forgotten_at`을 적는다(행과 local data는 지우지 않는다). 그 기계가 더 큰 `revision`을 쓰면 `forgotten_at`을 지운다
    - `readsCaughtUp(app) → boolean`, `peerHorizons(app)`(알려진 기계의 앱 기록의 `horizon`)
    - `status(app) → ImportStatus[]`(README 계약 7의 `imports`), `records() → {machines, apps}`(읽기 명령과 `folder-apps`의 take-in 목록이 읽는다)
    - `forget(app)`: 그 앱의 `folder_reads`·`folder_held` 행과 `<root>/folder-held/<app>/`를 지운다. 앱을 지울 때만 부른다

## 할 일

1. scan(`scan.ts`): reader로 `machines/` 아래 자기 id가 아닌 폴더만. 기록 file은 크기 한도 안에서 읽고 schema와 `machine` 칸이 폴더 이름과 같은지 본다. `revision`이 가진 것보다 작으면 무시한다. 모르는 칸은 버리고 읽는다. 기계 기록의 `lophn.folder.min_version`이 이 기계의 꼴 판보다 크면 그 기계의 data·release·source file을 읽지 않고 `newer_format`(아무것도 지우지 않는다).
2. stream(`stream.ts`), (이 기계, 앱, 출처, `data`)의 `folder_reads` 행 하나에 대해:
   - `next_try_at`이 아직이면 건너뛴다. 다음 번호 `cursor + 1`의 `.changes`나 `.snapshot`을 찾는다(둘 다 있으면 맞지 않는 file로 본다).
   - 없으면: `cursor`보다 큰 번호의 맞는 snapshot 가운데 가장 큰 것이 있으면 그것으로 간다. 없으면 기다린다(앱 기록의 `data.head`가 `cursor`보다 크면 `waiting_for = cursor + 1`, 아니면 끝).
   - 있으면 전부 검사한다(container, path와 header, app·machine). 맞지 않으면: 그보다 큰 번호의 맞는 snapshot이 있으면 그것으로 가고, 없으면 `invalid_file`(또는 `newer_format`)로 그 번호에서 멈추고 backoff한다. 그 file에서는 아무것도 적용하지 않는다.
   - header의 `release.bundle_hash`가 이 기계 그 앱의 활성 release와 다르면 held(아래 3). 같으면: changes는 가장 큰 hlc가 `clockAhead(hlc, now, 5분) > 0`이면 적용하지 않고 `clock_ahead`로 기다린다. 오류의 `details`는 `{machine, machine_name, ahead_ms}`이고 message는 "The clock of <이름> is <n> minutes ahead"다. 아니면 `apply.applyChanges`(held가 생긴 것은 apply 쪽이 남긴다. 여기서는 세기만 한다). snapshot은 payload를 data root 아래 임시 file로 풀며 hash를 다시 보고 `apply.mergeSnapshot`(이 기계가 horizon 밖이고(`exportState.away_since`) 그 출처의 앱 기록에서 `read[이 기계].n ≥ 이 기계의 data_head`이면 `absentDeletes: {below: 그 출처의 horizon, keep: heldRows(app)}`을 싣는다. 닿지 않았으면 싣지 않는다: 출처가 이 기계가 낸 것을 다 받기 전의 "없음"은 "지워짐"이 아니다), 끝나면 임시 file을 지운다.
   - 성공하면 같은 transaction에서 `cursor = n`, `read_at`, `attempts = 0`, 오류를 지운다. `conflict`(그 사이 release가 바뀜)는 다음 번에 다시 본다. `unavailable`은 `app_not_running`으로 backoff(1분부터 두 배, 1시간까지).
3. held(`held.ts`): README 계약 4 그대로. bytes를 `<root>/folder-held/<app>/<origin>/<n>.<kind>`에 temp와 rename으로 쓰고(0600), 그 뒤 한 transaction에서 `folder_held` 행과 `cursor = n`. 복사 뒤 transaction 전에 죽으면 다음 번에 같은 file을 다시 쓴다(같은 bytes). held는 적용하지도 지우지도 않는다.
4. 맞지 않는 이름(충돌 사본, temp, OS file)은 reader가 이미 거른다. 폴더에서 file이 사라져도 local의 무엇도 지우지 않는다.
5. test(임시 폴더, test ledger, 가짜 `FolderApply`).

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "깨지거나 반만 온 file은 아무것도 적용하지 않고 stream이 그 번호에서 기다린다": 잘린 file, bytes가 바뀐 file, n이 다른 header의 file이 오면 `FolderApply`가 불리지 않고 cursor가 그대로이고 오류가 보인다. 맞는 file로 바뀌면 다음 번에 적용된다
  - "다른 release의 file은 적용되지 않고 잃지 않는다": held 행과 같은 bytes의 local 사본이 생기고, 출처가 폴더에서 그 file을 지운 뒤에도 사본이 남는다. 그 뒤의 같은 release file도 held다
  - "바깥 도구의 버릇에 견딘다": `000000000003 (1).changes`, `.sync-conflict-…`, `*.tmp-…`는 읽지 않는다. 4번이 3번보다 먼저 오면 3번을 기다리고, 3번이 오면 3, 4 순서로 적용한다. 같은 file이 두 번 읽혀도 한 번만 적용된다(cursor)
  - "실패한 읽기는 아무것도 지우지 않는다": 출처 기계의 폴더가 비거나 기록 file이 깨져도 `folder_records`의 옛 행과 local data가 그대로다
  - "horizon 밖에서 돌아온 기계의 snapshot 합치기는 출처가 이 기계의 것을 다 받기 전에는 아무 row도 지우지 않는다", "지운 기계는 알려진 기계에서 빠지지만 그 행과 data는 남는다"
  - "주인이 compaction한 뒤에 온 기계는 snapshot으로 따라온다", "clock이 5분 넘게 앞선 file은 시각이 따라올 때까지 적용하지 않는다"
- 남지 않음: 없음(더하기).
- flows catalog: 이 task가 더하는 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `mod.ts`의 이름과 deps(한 줄씩), 출처 기계 셋·앱 열 개에서 scan 한 번의 시간, 변경 file 1,000개를 처음 따라잡는 시간(가짜 apply).

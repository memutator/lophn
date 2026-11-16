# app-folder-sync: 앱 data, release, source, 기계 기록이 폴더를 거쳐 기계 사이를 간다

- 목표: roadmap `multi-machine.md` "모양" 3과 "순서" 2. 앱 선언의 `sync_to`가 그 앱의 data가 갈 destination(기계마다 local 폴더 path에 묶인 이름)을 고른다. 컴퓨터는 그 앱의 변경을 폴더의 자기 하위 폴더에 file로 쓰고, 다른 기계의 하위 폴더에서 file을 읽어 전부 검사한 뒤 한 transaction으로 적용한다. 폴더를 옮기는 것은 바깥 도구이고 lophn code는 폴더만 안다. release, 앱 source(기계마다의 증분 git bundle), 기계 기록도 같은 폴더로 가서 두 번째 기계가 사람의 동의로 앱을 받는다. agent는 읽기 전용 명령으로 환경을 읽고, 지침을 따라 정책을 고르고 바깥 도구를 붙인다.
- 재료: `reports/multi-machine/program.md`(계획 사이 경계, 정한 정책. roadmap과 다르면 이것), `project-docs/products/roadmap/multi-machine.md`, 코드 조사 `reports/multi-machine/code-survey.md`(D, E, G, A와 끝의 표), harness 비교 `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md`(6, 7, 8, 12, 14절)와 같은 폴더의 `omp.md` §6.1, `hermes.md` §7.2–7.3, `happy.md` §6.3, `mixdog.md` §6.2·§7, `others.md` §7.4·§10.3–10.4, `project-docs/architecture/{app-sync,app-call,activation}.md`, 바탕 계획 `project-docs/plan/machine-identity/README.md`("다른 계획이 기대는 계약"), 이 계획을 지은 계획의 꼴 `project-docs/plan/mobile-local-apps/`(main에서 지워졌으면 git 기록).
- 범위 밖(가는 계획):
  - 새 release를 저절로 따라가기, held 변경을 release가 바뀐 뒤 적용하기, "이 기계에서 앱을 올려야 한다" 상태, lophn 판 범위: `machine-update`.
  - OS service 등록, 늘 켜 둠의 값, 예약 작업의 주인 기계: `always-on`. 이 계획은 기계 기록의 `always_on`을 null로 낸다.
  - desktop이 다른 기계를 보기, 기계 고르기: `desktop-remote`.
  - project의 기계를 넘는 신분: `project-identity`.
  - agent 정의, skill, 설정, 자격을 맞추기: 하지 않는다(program 13, 16).
  - lophn이 cloud API를 부르는 길: 보류(사람). file 꼴은 그대로 쓴다.
  - 폰이 폴더를 쓰기: 하지 않는다(program 15). 폰은 짝지은 컴퓨터를 거친다.
  - 대량 삭제를 멈추고 묻기, 앱 data의 표·칸별 정책(기계에만 두는 칸, 특정 기계 빼기): 어느 계획에도 없다. roadmap "사람이 정할 것" 3에 남는다.

## 정한 것

- 앱 data의 길은 앱마다 선언하고 앱을 짓는 agent가 사람의 환경과 memory로 고른다 (사람, roadmap).
- 보관소 연결은 제품 기능이 아니다. lophn은 폴더에 쓰고 읽기만 하고 바깥 도구의 이름이 code·의존성·설정에 없다 (사람).
- lophn이 cloud API를 부르는 길은 보류하고, 변경 file은 폴더든 API든 같은 bytes다 (사람).
- 선언 칸은 `sync_to: "<destination 이름>"` 하나다. 없으면 내보내지 않는다. 값이 이름뿐이라 경로가 다른 기계에서도 같은 선언이 맞는다 (planner).
- `runs_on: ["phone"]`은 `sync_to`를 쓰지 못한다. 폰의 data는 컴퓨터를 거쳐서만 나가는데 그 앱은 컴퓨터 사본이 없다 (planner, program 15).
- `sync_to`가 있는 앱은 컴퓨터에서 sync 앱이다(clock 표, sync log). 그래서 폰 앱과 같은 schema 규칙(정수 PK, AUTOINCREMENT, trigger, PK 밖 UNIQUE·CHECK 없음)과 `@lophn/cap-store` 2.0.0 하한을 release 준비가 본다: 두 기계가 같은 정수 id를 만들면 row를 잃는다 (planner, `app-sync.md` 결정).
- SDK는 `@lophn/declaration` 4.9.0, 그 판을 고정하는 `@lophn/app-ui` 2.18.0과 `@lophn/app-ui-native` 1.4.0이다. `supported_from`은 그대로다(더하기만) (planner, sdk-note).
- destination은 기계마다의 설정 `folder.destinations`(이름 → 절대 경로)다. 경로는 기계마다 다르고 설정은 기계를 넘지 않는다 (planner, program 13).
- destination을 더하고 바꾸고 지우는 것은 사람의 승인이다. 사람의 data가 data root를 떠나 바깥 도구가 올리는 폴더로 가기 시작하는 일이라 pairing·연결과 같다. agent는 바꾸기를 요청만 하고, 지금 있는 승인 카드(turn 안 request)에 이름과 전체 local 경로가 보이며 사람이 그 한 번을 허락한다. unattended turn과 팀 자식은 요청하지 못한다. 사람 자격(Settings, 사람의 터미널의 `lophn settings`)은 그대로 바꾼다 (planner, 2026-11-16 뒤집음).
- data root를 공유 저장소에 두지 않는 검사는 destination과 data root가 서로 안에 있으면 설정을 거절하는 것만이다. 그 밖(network·sync 폴더 위의 data root)은 code가 도구를 모르니 지침이 막는다 (planner, machine-identity가 넘김).
- 기계마다 `machines/<자기 id>/` 아래에만 쓰고 남의 file은 읽기만 한다. 그래서 lock이 없고 같은 file을 둘이 고치지 않는다. 자기 하위 폴더에 자기가 쓰지 않은 번호가 보이면(알아채지 못한 복제) 내보내기를 멈추고 알린다 (planner, 조사 7.4·iii 8).
- 변경 file은 checksum 줄, header 줄, payload의 한 file이다. 끝까지 쓰기 전에 payload hash를 알 수 있어 큰 snapshot도 한 번에 쓰고, 잘린 file은 크기와 hash로 알아본다 (planner).
- 기록과 header는 모르는 칸을 버리고 읽는다. 꼴 판(`lophn-folder 1`, `format`)은 옛 판이 file을 틀리게 읽게 되는 바꿈에만 올리고 칸을 더하는 것으로는 올리지 않는다. 기계 기록의 `lophn.folder`가 쓰는 판과 읽는 하한을 알린다 (planner, machine-update 요청).
- 번호는 stream마다 1부터 빈틈없이 늘고 쓴 file은 다시 쓰지 않는다. 앱 기록의 `data.head`로 "아직 안 옴"과 "끝"을 가른다 (planner).
- 읽는 쪽의 cursor, held, 남의 기록 사본은 그 기계 ledger의 표에 두고 행마다 그 기계 id를 적는다. 폴더에는 두지 않는다 (planner, machine-identity 계약 1).
- 기계 사이 snapshot은 덮지 않고 row·칸 clock으로 합친다. hub가 없어 덮으면 받는 쪽의 아직 안 간 변경이 사라진다 (planner).
- 앱 id는 기계 사이 같다: 받는 기계가 같은 `app_` id로 등록하고, slug가 이미 다른 앱의 것이면 `conflict`다. release의 기계 사이 신분은 봉인한 bundle hash다(받는 기계가 bundle을 그대로 받으므로 같고, 같은 commit을 따로 준비하면 npm 때문에 다를 수 있다) (planner).
- take-in은 이미 들인 앱이면 앱 행을 건드리지 않고 그 release만 설치한다(같은 bundle이 있으면 그것을 돌려준다). `conflict`는 `details.reason`으로 까닭을 말한다 (planner, machine-update 요청: 따라가기가 같은 함수를 부른다).
- 같은 release(같은 bundle hash)끼리만 적용한다. 다른 release의 file은 받는 쪽 data root로 그대로 복사하고 held 표에 적는다. 주인의 compaction이 폴더에서 지워도 잃지 않는다 (planner, program 10).
- 받은 변경 하나는 invocation 하나다(caller `person` + `machine`, operation과 시작 시각은 주인 것). file 하나는 앱 DB transaction 하나이고 제약에 걸린 변경만 건너뛴다. 폰 변경과 같은 길이라 Activity와 rewind가 덮는다. snapshot 합치기는 invocation 하나(`lophn.snapshot_merge`)다 (planner, `app-sync.md` 결정).
- 폴더로 온 변경은 sync log에 origin `machine` 줄로 남겨 폰이 pull하고, 그 줄은 다시 내보내지 않는다. 폰에서 온 변경은 내보낸다: 컴퓨터가 폰의 폴더 길이다 (planner, program 15).
- 미래 clock은 값을 깎지 않고 미룬다: 받는 쪽 시각 + 5분보다 앞선 변경이 든 file은 시각이 따라올 때까지 적용하지 않고 `clock_ahead`로 알리며, 상태는 어느 기계의 시계가 얼마나 앞섰는지 말한다. 받은 clock 값을 깎으면 사본마다 다른 clock을 적어 갈라진다 (planner, 조사 7.2. planner가 받아들임).
- 지운 row의 흔적(tombstone)은 알려진 모든 기계가 지난 것이거나 90일보다 옛 것만 지운다. 사람이 쓴 것은 정리 때문에 버려지지 않는다: horizon을 넘겨 돌아온 기계는 그것을 알고 snapshot 합치기로 따라오며, 정리된 흔적과 안전하게 합칠 수 없는 자기 변경은 그 기계에 held로 남고(다른 기계에 적용하지 않고 지우지 않는다) 그 기계의 앱이 "너무 오래 떨어져 있었다"와 held 목록을 보여 사람이나 앱의 agent가 푼다. 받는 쪽도 그런 변경을 받으면 버리지 않고 held로 둔다(아래 계약 10) (planner, 2026-11-16 뒤집음).
- compaction은 주인만 한다: 새 snapshot을 쓴 뒤 그 앞 snapshot보다 옛 자기 file 가운데 30일 지난 것만 지우고 마지막 snapshot은 남긴다. 그보다 늦은 기계는 snapshot으로 따라온다 (planner, 조사 7.2 mixdog).
- SDK 사본은 따로 싣지 않는다. 봉인한 bundle이 그 판의 SDK를 이미 담는다. 받는 기계의 lophn에 없는 SDK 판을 고정한 release는 `conflict`("이 기계의 lophn을 올려라")다: 폴더에서 온 code가 그 기계의 SDK 저장소에 들어가지 않는다 (planner).
- source는 기계마다 증분 git bundle이다. 받는 쪽은 `refs/remotes/<mch>/*`로 fetch만 하고 합치지 않는다. 처음 받을 때만 그 release의 commit을 `main`으로 둔다. 폴더 안에 bare 저장소를 두지 않는다 (planner, 사람 roadmap).
- 기계 기록은 id, 이름, always_on, 주소(remote가 켜졌을 때 LAN 주소·port·relay), lophn 판과 폴더 꼴 판 범위다. 공개 key, pairing code, binding, 자격은 싣지 않는다. pairing은 사람이 한다 (planner, program, machine-update 요청).
- 이름이 겹친 기계는 목록에 `이름 (id 앞 6자)`로 보인다. 이름의 유일성은 강제하지 않는다 (planner, machine-identity가 넘김).
- 읽기 명령의 뼈대는 이 계획이 갖고, 뒤 계획은 등록한 함수 하나로 이름 붙은 section을 채운다(계약 7). 뒤 계획이 명령의 code를 고치지 않는다 (planner).
- 기계를 사람이 목록에서 지우면(`machine/forget`) 그 기계는 흔적 정리를 붙잡지 않는다. 그 기계가 다시 기록을 쓰면 목록에 돌아오고 자기가 horizon 밖인지 스스로 안다 (planner).
- 계기: 내보내기는 sync log가 바뀐 뒤 5초 debounce와 5분 timer, 읽기는 destination의 `machines/` 감시(2초 debounce)와 2분 timer. (앱, destination)·(앱, 출처 기계)마다 한 번에 하나, 한 번에 64 MiB까지, 실패한 stream은 1분부터 두 배씩 1시간까지 물러난다. 실시간이 아니다 (planner).
- Google Drive for desktop은 file을 평문으로 Google에 올린다. 그래서 cloud는 기본으로 암호화하는 도구(rclone `crypt`, Google Drive도 rclone의 remote로)로만 쓰고, 암호화하지 않는 cloud 폴더는 사람이 "file이 평문으로 올라간다"는 말을 듣고 받아들일 때만 쓴다. 지침은 묻기 전에 그것을 쉬운 말로 말하게 한다 (planner, 사람의 두 말을 맞춤).
- worker는 `sonnet-high`. `folder-contract`, `folder-engine`, `folder-log`, `folder-runtime`, `folder-export`, `folder-import`, `folder-apps`, `folder-approval`은 opus high다(brief 머리에 적었다) (planner).

## 다른 계획이 기대는 계약

1. **폴더 배치.** destination 경로 아래에 lophn은 이것만 쓴다. 기계는 자기 `<mch>` 아래만 쓴다.
   ```
   <destination>/machines/<mch_…>/
     record.json                             기계 기록
     apps/<app_…>/app.json                   앱 기록
     apps/<app_…>/data/<n>.changes           변경 file      (n은 12자리 0 채움, 1부터)
     apps/<app_…>/data/<n>.snapshot          snapshot file  (같은 번호 줄)
     apps/<app_…>/releases/<bundle hash>/files/<path>   봉인한 bundle의 file 그대로
     apps/<app_…>/releases/<bundle hash>/release.json   release 기록과 file 목록(마지막에 쓴다)
     apps/<app_…>/source/<n>.bundle          증분 git bundle
     apps/<app_…>/source/<n>.json            그 bundle의 heads, prerequisites, size, sha256(bundle 뒤에 쓴다)
   ```
   - 쓰기는 같은 폴더의 `<이름>.tmp-<16 hex>`에 쓰고 rename한다(앞에 점을 붙이지 않는다). 번호 붙은 file은 다시 쓰지 않는다. 읽는 쪽은 이름이 위 꼴과 정확히 맞는 file만 읽고 나머지(충돌 사본 `… (1).changes`, `.sync-conflict-…`, temp, OS file)는 없는 것으로 본다. 남의 file을 지우거나 고치지 않는다. 사라진 file은 "아직 안 옴"이고 local의 무엇도 지우지 않는다.
   - 여러 file로 된 것(release, source)은 목록 file(`release.json`, `<n>.json`)이 크기와 sha256을 싣고 마지막에 쓰인다. 목록이 없거나 file 하나라도 맞지 않으면 "아직 안 옴"이다.
2. **변경·snapshot file 꼴**(`.changes`, `.snapshot`, 폴더든 API든 같은 bytes).
   ```
   1행  "lophn-folder 1 <changes|snapshot> <2행 bytes(끝 \n 포함)의 sha256 hex>\n"
   2행  header JSON 한 줄(≤ 1 MiB) + "\n"
   나머지  payload, 정확히 header.payload.size bytes, sha256 = header.payload.sha256
   ```
   - header: `{ machine: mch_…, app: app_…, n, kind, release: { bundle_hash: <64 hex>, data_schema: int ≥ 0 }, created_at: ISO, payload: { size, sha256 }, changes?: [{ id, hlc, origin, operation, started_at, offset, size }] }`.
   - `changes`: payload는 SQLite session changeset들을 이어 붙인 것. 변경 하나 ≤ 8 MiB, file 하나 ≤ 1,000개·payload 16 MiB. `id`는 주인 sync log의 seq(십진 문자열, 주인 기계 안에서 다시 쓰지 않는다), `hlc`는 63 bit 십진 문자열, `origin`은 `computer | device | rewind`, `operation`과 `started_at`은 그 변경을 낸 invocation의 것(없으면 null).
   - `snapshot`: payload는 그 앱 DB 사본(SQLite file, `lophn_sync_row`·`lophn_sync_col`·`lophn_sync_state` 포함) ≤ 1 GiB. 번호 m의 snapshot은 그 stream의 m보다 작은 번호의 변경을 모두 담는다. stream의 첫 file과 주인의 release가 바뀐 뒤의 첫 file은 snapshot이다.
   - header와 모든 기록 file(아래 3, 6과 `source/<n>.json`)은 모르는 칸을 버리고 읽는다. 칸을 더해도 꼴 판(1행의 `1`, 기록의 `format`)은 그대로이고, 옛 판이 틀리게 읽게 되는 바꿈에만 오른다.
   - 맞는 file: 1행의 판이 이 기계가 읽는 범위 안(아니면 `newer_format`), 1행 hash, header의 아는 칸의 schema, header의 machine·app·n·kind가 path와 같음, 전체 크기가 정확히 맞음, payload hash. 하나라도 어기면 그 file에서 아무것도 적용하지 않는다.
   - 읽는 쪽은 (앱, 출처 기계)마다 cursor(적용했거나 held로 넘긴 마지막 번호)를 자기 ledger에 둔다. 다음 번호가 없거나 맞지 않으면 기다린다. 그보다 큰 번호의 맞는 snapshot이 있으면 그것을 합치고 cursor를 그 번호로 둔다.
3. **앱 기록** `app.json`: `{ format: 1, machine, app, revision, updated_at, slug, name, description, sync_to, active_release: { bundle_hash, data_schema, code_commit, created_at } | null, releases: [bundle_hash], data: { head: n, snapshot: n | null }, source: { head: n }, read: { <mch>: { n, at } }, settled: <hlc> | null, horizon: <hlc> | null }`. `revision`은 그 기계 안에서만 는다. `read`는 그 앱에서 다른 기계마다 읽은 번호, `settled`와 `horizon`은 계약 10. **release 기록** `release.json`: `{ format: 1, machine, app, bundle_hash, code_commit, declaration_hash, data_schema, data_changes, created_at, files: [{ path, size, sha256 }] }`. 선언은 bundle의 `declaration.json`이고 facts는 받는 기계가 선언에서 다시 만든다.
4. **held(다른 release의 변경).** 맞는 data file의 `release.bundle_hash`가 이 기계의 그 앱 활성 release의 bundle hash와 다르면 적용하지 않는다. 그 bytes를 그대로 `<root>/folder-held/<app>/<출처 mch>/<n>.<changes|snapshot>`(0600)에 복사하고, 같은 transaction에서 아래 행을 넣고 cursor를 n으로 둔다.
   ```
   folder_held(machine TEXT  -- 이 기계 id
     , app TEXT, origin TEXT  -- 출처 mch
     , n INTEGER, kind TEXT CHECK (kind IN ('changes','snapshot'))
     , bundle_hash TEXT, data_schema INTEGER, path TEXT  -- data root 기준
     , sha256 TEXT, size INTEGER, held_at TEXT
     , PRIMARY KEY (machine, app, origin, n)) STRICT
   ```
   - 뜻: 적용하지 않았고 잃지 않았다. 이 계획은 held를 적용하지도 지우지도 않는다(그 앱을 이 기계에서 지울 때만 지운다). `machine-update`가 이 기계의 활성 release가 `bundle_hash`가 된 뒤(또는 다시 표현해서) (origin, n) 순서로 같은 적용 길(`FolderApply`)로 적용하고 성공한 행과 file을 지운다. `machine` 칸이 지금 기계 id와 다른 행은 없는 것으로 본다.
5. **destination.** 설정 `folder.destinations`(`<root>/settings.json`, 기계마다): `{ "<이름>": { "path": "<절대 경로>" } }`, 이름 `^[a-z][a-z0-9-]{0,31}$`, 16개까지. 거절: 상대 경로, data root 안의 경로, data root를 품은 경로, 다른 이름과 같거나 서로 안에 있는 경로. 앱은 선언 `sync_to`로 이름만 고른다. 이 기계에 그 이름이 없으면 그 앱은 이 기계에서 내보내지도 읽지도 않는다.
   - 바꾸기는 사람만 한다. 사람 자격(Settings, 사람의 터미널)은 그대로 쓴다. agent 자격은 요청만 한다: 설정 선언의 새 칸 `approval: "person"`(과 바뀜을 사람의 말로 쓰는 `describe(before, after) → string[]`)이 붙은 key를 agent가 바꾸거나 지우면, `lophn settings set|unset`이 Gate에 `{ kind: "setting", key, lines }`를 묻고 지금 있는 승인 카드(turn 안 request, 대기 목록, 폰 포함)가 `lines`를 보인다(예: `Add sync folder "personal": /home/me/Sync/lophn`, `Remove sync folder "work" (/mnt/nas/lophn)`). 고르기는 once와 reject뿐이다(always 없음). 판정: attended와 skip은 `ask`, unattended와 팀 자식은 `deny`. 허락되면 settings update가 그 request id를 싣고, core는 같은 turn에서 허락된, 같은 key와 같은 값의 request 하나에만 한 번 받는다. 그 밖의 agent 쓰기는 `rejected: needs_approval`이다.
6. **기계 기록** `record.json`: `{ format: 1, machine, revision, updated_at, name, always_on: { keep_running, starts_at_login, keep_awake } | null, addresses: { lan: string[], port: int | null, relay: string | null }, lophn: { version, protocol: { version, min_version }, folder: { version, min_version } } }`. `lophn.folder`는 이 기계가 쓰는 꼴 판과 읽는 하한이다. 읽는 쪽은 상대의 `folder.min_version`이 자기 판보다 크면 그 기계의 file을 읽지 않고(`newer_format`, "이 기계를 올려라") 아무것도 지우지 않는다. destination마다 하나씩 쓴다. 주소는 `remote.enabled`일 때만 싣고 아니면 빈 목록과 null. `always-on`은 folder wiring에 주는 `alwaysOn(): { keep_running, starts_at_login, keep_awake } | null` 하나를 `ctx.alwaysOn.status()`로 채운다(이 계획은 null). 읽는 쪽은 기계마다 가장 큰 `revision`을 남기고, 한 기계의 기록을 읽다 실패하면 옛 사본을 그대로 둔다(한 번에 바꾸고 실패한 읽기로 지우지 않는다).
7. **읽기 명령.** route `machine/environment`(read, actors `user`·`agent`)와 CLI `machine.environment`(workspaces `home`, `app`). 출력(모르는 칸을 무시하고 읽는다):
   ```
   { this_machine: { id, name },
     machines: [{ id, name, display_name, always_on, addresses, lophn_version, record_at, destinations: [이름], sections }],
     destinations: [{ name, path, state: "ok" | "missing" | "not_writable", machines: int }],
     apps: [{ app, name, sync_to: string | null, destination: "set" | "not_set_here" | null, release: bundle_hash | null,
              export: { exported_at, head, pending, error } | null,
              imports: [{ machine, imported_at, cursor, waiting_for: int | null, held: int, error }],
              away: { since: ISO, held: int, changes: [{ table, op, at }] } | null,     계약 10
              sections }],
     available: [{ app, name, slug, machine, release: { bundle_hash, data_schema, created_at } | null }],
     sections }
   error = { code, message, at, details? } | null
   code ∈ destination_missing | not_writable | foreign_writer | invalid_file | newer_format | too_large
        | clock_ahead | apply_failed | app_not_running | release_incomplete | away_too_long
   clock_ahead의 details = { machine, machine_name, ahead_ms }, message는 "The clock of <name> is <n> minutes ahead"
   ```
   - **뒤 계획이 칸을 더하는 자리.** `sections`는 `{ <section 이름>: JSON }`이다. 뒤 계획은 명령의 code를 고치지 않고 자기 wiring에서 `ctx.folderEnvironment.register({ name, top?(): Promise<unknown>, machine?(id: Id<"mch">): Promise<unknown>, app?(app: Id<"app">): Promise<unknown> })`를 한 번 부른다. 함수가 던지거나 오래 걸리면(2초) 그 section만 `{ error }`가 되고 명령은 나머지를 돌려준다. 이름은 계획마다 하나다:
     - `always-on`: `always_on`은 section이 아니라 위 `machines[].always_on`(이 기계는 `alwaysOn()`, 다른 기계는 기록)이다. 그 계획이 land되기 전에는 null이다.
     - `project-identity`: top section `projects` = `[{ project, identity, found, remote: { url } | null }]`.
     - `machine-update`: machine section `update` = `{ folder: { version, min_version } | null, exchange: "ok" | "update_this" | "update_peer" }`, app section `update` = `{ follow, held_detail, machines }`(그 계획의 계약 꼴).
     - `desktop-remote`: 넣는다면 top section `viewed_machines`(그 계획이 정한다).
8. **sync log와 caller.** `app_sync_log.origin`에 `machine`, 새 칸 `machine`(origin이 machine일 때만), 같은 (machine, change_id)는 한 줄, `seq`와 다음 번호는 그대로다. 폴더에서 온 변경의 invocation caller는 `{ kind: "person", view_session: <주인 log seq>, machine: mch_… }`. `app_sync/pull`의 `origin`에 `machine`이 더해진다. `kind`에 `held`(계약 10. changeset blob과 출처를 쥐고 폰에 보내지 않고 내보내지 않는다)와 칸 `resolved_at`이 더해진다. 폰의 push에서 held가 된 변경은 `skipped`로 답한다(폰 code를 바꾸지 않는다).
9. **ledger schema step(이 순서로, `machine-identity`의 `remote.devices.kind` 뒤에).** `apps.sync-log.machine`(표 다시 만들기), `folder.tables`(`folder_streams`, `folder_written`, `folder_reads`, `folder_held`, `folder_records`(`forgotten_at` 칸 포함)). data step은 없다.
10. **흔적 정리와 horizon(90일).** 사람이 쓴 것은 정리 때문에 버려지지 않는다.
    - `settled`: 기계 M이 앱 A의 기록에 싣는 HLC. M의 그 앱 DB clock이 "내보낼 것이 없고(export `pending` 0) 읽는 모든 출처의 cursor가 그 출처 앱 기록의 `data.head`에 닿은" 마지막 때의 값이다. 뜻: M은 그 clock 이하의 자기 것을 다 냈고 남이 그때까지 낸 것을 다 받았다.
    - 알려진 기계: 이 기계가 A의 앱 기록을 가진 기계들. 사람이 `machine/forget`(사람만, 이 기계의 목록에서 지움)으로 지운 기계는 빠진다. 지운 기계가 더 큰 `revision`의 기록을 쓰면 다시 알려진 기계다.
    - 정리: 컴퓨터는 앱이 뜰 때와 하루에 한 번, clock이 `max(min(알려진 모든 기계와 자기의 settled), hlcAtMs(now − 90일))`보다 작은 tombstone만 지우고 `horizon`을 그 값으로 올려 기록에 싣는다. 모두가 지난 것이거나 90일보다 옛 것만 지운다는 뜻이다.
    - horizon 밖: 기계 N은 자기 `settled`가 다른 기계 X의 `horizon`보다 작으면 A에 대해 horizon 밖이다(`away_too_long`). 그러면 N은 (a) X를 snapshot으로 따라온다: 합치기는 X의 horizon 이하 clock만 가진 N의 row 가운데 X의 snapshot에 없고 N의 held가 건드리지 않는 것을 지운다(그 사이 다른 곳에서 지워지고 흔적이 정리된 row). 이 지우기는 X의 기록의 `read[N].n`이 N의 `data.head`에 닿은 뒤에만 한다: X가 N이 낸 것을 다 받았어야 "X에 없음"이 "지워짐"이다. 닿기 전에는 지우지 않고 기다린다. (b) 아직 내보내지 않은 자기 변경 가운데 clock이 X의 horizon 이하인 것은 내보내지 않고 자기 sync log의 `held` 줄로 남긴다(다른 기계에 적용하지 않고 지우지 않는다). (c) 그 앱의 상태와 사람의 알림이 "<앱>이 이 컴퓨터에서 너무 오래 떨어져 있었다, 변경 N개가 held다"를 말한다.
    - 받는 쪽의 그물: clock이 자기 `horizon` 이하인 변경이 row도 흔적도 없는 row를 만들거나 지우려 하면 적용하지 않고 `held` 줄로 남긴다(폰에서 온 것도 같다).
    - 풀기: `apps/sync_held`(사람과 그 앱의 agent): 목록, `apply`(그 변경을 지금 clock의 이 기계 write로 다시 적용해 보통처럼 내보낸다: 사람의 다시 정함), `discard`(사람이나 agent가 고른 버림. `resolved_at`을 적고 bytes는 기록에 남는다). 저절로 풀리지 않는다.


## 계약 바꾸기 요청

- 없음. `machine-identity`의 `ctx.machine`(id, 이름), sync 앱 DB의 machine 표지와 node 갱신, `machine.json`을 어디로도 내보내지 않는 규칙으로 충분하다.

## task

| wave | id | 단위 | 한 줄 |
|---|---|---|---|
| 1 | `folder-contract` | folder | (opus high) `protocol/folder`(배치, file 꼴, 모르는 칸을 버리는 기록 schema, 꼴 판 범위, 상태 schema와 section, 수치), `core/folder`의 destination 설정(잠금)·자기 하위 폴더 writer·reader, schema step `folder.tables`, port type. 깨진 file·밖에 쓰기·agent가 destination을 못 둠 위험 test |
| 1 | `folder-decl` | sdk | `sync_to`와 검사, 준비의 schema 규칙과 cap-store 하한, declaration 4.9.0·app-ui 2.18.0·app-ui-native 1.4.0, 메모와 pin |
| 1 | `folder-engine` | sync | (opus high) sync core: snapshot 합치기(horizon 밖의 지우기 포함), 넘겨받은 clock 아래 tombstone 정리, 흔적과 부딪는 변경을 held로 돌려주기, 미래 clock 판정, `decodePk`. 수렴·정리가 버리지 않음 위험 test |
| 1 | `folder-log` | sync | (opus high) schema step `apps.sync-log.machine`(seq 유지, origin `machine`, kind `held`), recorder, caller `machine`, pull의 origin. 다시 만들기 위험 test |
| 2 | `folder-runtime` | sync | (opus high) 앱 process의 file 적용(한 transaction)·snapshot 합치기·흔적 정리·held 다시 적용 control, `sync_to` 앱도 sync 앱으로, calls의 `folder`와 `syncHeld`. 적용·held 위험 test |
| 2 | `folder-export` | folder | (opus high) data stream 쓰기, snapshot, compaction, 남의 writer 알아채기, `settled`, horizon 밖의 자기 변경을 held로, 기계 기록 쓰기. 밖에 안 씀·id file과 자격 없음 위험 test |
| 2 | `folder-import` | folder | (opus high) 남의 하위 폴더 읽기, 검사 뒤 적용, held 복사, snapshot 건너뛰기, horizon 밖에서 돌아오기, 미래 clock 미루기, 기록 사본, 기계 지우기, backoff. 깨진 file·held 위험 test |
| 2 | `folder-apps` | folder | (opus high) 앱 기록, release 내보내기, source git bundle 내보내기·받기, take-in(같은 id, 이미 들인 앱은 release만, 봉인 bundle 설치, prepared, `details.reason`). 동의를 옮기지 않음 위험 test |
| 2 | `folder-approval` | approval | (opus high) 설정 선언 `approval: "person"`, 승인 카드의 `setting` subject(이름과 전체 경로), agent의 destination 바꾸기는 사람이 허락한 그 한 번만. desktop과 폰 카드. 위험 test |
| 3 | `folder-surface` | folder | wiring(계기, 감시, timer, 흔적 정리의 식, 떨어져 있었다 알림, 지울 때 정리), section 자리, route `machine/environment`·`apps/take_in`·`machine/forget`·`apps/sync_held`와 CLI, flows |
| 3 | `folder-guidance` | sdk | `design-app/folder-sync.md`(정책 고르기, 승인 전에 설명하기, destination, 바깥 도구와 암호화, 떨어져 있었을 때, 한계), SKILL.md 한 줄, 메모의 Instruction diff |

## lead가 할 일

- 띄우기 전에: `machine-identity`가 main에 land되어 있어야 한다(`ctx.machine`, 앱 DB의 machine 표지). `status.py ready`는 다른 계획의 land를 모르니 lead가 main을 본다.
- 공유 줄(brief가 한 줄씩 허락했다. 합칠 때 두 쪽을 다 남긴다): `packages/core/main/daemon/wiring/remote.ts`의 `schemaStepsAfterTeams`와 `packages/core/storage/migration/schema-steps.lock.json` 끝(wave 1의 `folder-log`이 먼저, `folder-contract`가 뒤. merge 순서를 그렇게 하고 lock의 순서가 main과 맞는지 본다), `wiring/setting-declarations.ts`, `wiring/apps.ts`, `wiring/apps-delete.ts`, `wiring/context.ts`(Late 칸. `machine-identity`도 더한다), `project-docs/flows/areas.yaml`, `packages/cli/commands/mod.ts`, `WIRINGS`(`assembly.ts`), `packages/core/apps/packages/template/app/AGENTS.md.tmpl`(wave 1은 pin 한 줄, wave 3은 지침 줄). `design-app/SKILL.md`와 declaration guide는 다른 계획이 running이면 끝난 뒤에 띄운다.
- `folder-approval`은 approvals(`packages/protocol/approvals`, `packages/core/approvals`), 설정 route, desktop 승인 카드와 대기 목록, `packages/mobile`의 session 화면을 고친다. 같은 때 이 file들을 고치는 다른 계획의 task가 running이면 끝난 뒤 띄운다. merge 뒤 `cd packages/mobile && npm ci && npm run typecheck && npm test`.
- 다른 계획과의 순서: `machine-update`의 task는 이 계획이 land된 뒤에만 띄운다. 그 task들은 이 계획이 만드는 file(`packages/core/folder/import/*`, `packages/core/folder/export/record.ts`, `packages/protocol/folder/*`, `packages/core/apps/runtime/entrypoint/sync.ts`)을 고친다. ledger schema step은 land 순서로 `machine-identity`의 `remote.devices.kind` 뒤에 붙는다(이 계획은 `apps.sync-log.machine`, `folder.tables`). `always-on`, `project-identity`, `machine-update`(그리고 넣는다면 `desktop-remote`)는 `machine.environment`에 자기 칸을 `ctx.folderEnvironment.register`로 꽂는다. 이 계획보다 먼저 land한 계획은 이 계획이 land된 뒤 그 한 줄을 더한다.
- merge 때마다 `npm run check`. `folder-log`과 `folder-contract` 뒤에는 `check:full`(schema step lock)과 `boot.sh`. `folder-log` 뒤에 `cd packages/mobile && npm ci && npm run typecheck && npm test`(pull의 origin enum).
- wave 3 뒤 끝에서 끝 확인(사람의 `~/.lophn`과 바깥 도구 없이): 새 data root 둘(`.dev-data/folder-a`, `.dev-data/folder-b`. 하나를 복사하지 않는다: 같은 OS에서 복사한 root는 같은 기계로 판정된다)로 개발 core 둘을 띄우고 같은 폴더 `.dev-data/folder-shared`를 두 기계의 `folder.destinations`에 같은 이름으로 둔다. A에서 손으로 쓴 sync 앱(`tests/support/app/` 꼴, `sync_to` 있음)을 등록·준비·활성화하고 data를 쓴다. B에서 `machine.environment`가 A와 그 앱을 보이는지, `app.take_in` 뒤 `release.activate`가 사람의 동의를 묻는지(사람 자격으로 동의), 동의 뒤 A의 data가 B에 오는지, B에서 쓴 것이 A에 오는지, 같은 row의 다른 칸을 양쪽에서 고쳐 둘 다 남는지, 한 file을 손으로 자르면 아무것도 적용되지 않고 `invalid_file`이 보이는지, A만 새 release로 올리면 B에 held가 생기고 data가 지워지지 않는지, A의 폴더 file을 지워도 B가 snapshot으로 따라오는지, 폴더에 `machine.json`의 binding·`secrets.json` 값·host key가 없는지 `grep -r`로 본다. agent turn에서 destination을 두려 하면 승인 카드가 이름과 전체 경로를 보이고 거절하면 설정이 그대로인지, B의 기계 기록 `settled`를 손으로 옛 값으로 두고 A의 흔적 정리를 90일 쪽으로 당겨(test용 시각) 돌리면 B가 `away_too_long`이 되고 B의 옛 변경이 held로 남으며 버려지지 않는지(손으로 바꾼 것은 되돌린다), `machine.environment`의 `clock_ahead`가 어느 기계인지 말하는지.
- 사람이 볼 것: 실제 두 기계에서 바깥 도구(같은 LAN의 Syncthing, rclone `crypt` 위 cloud)를 agent가 지침대로 붙이는지와 사람에게 무엇을 묻는지, B의 Activity에서 다른 기계에서 온 변경이 어떻게 보이는지, destination 승인 카드가 이름과 전체 경로를 보이는지, "너무 오래 떨어져 있었다" 알림과 held 목록이 알아들을 만한지. 실제 cloud와 바깥 도구의 설치는 사람에게 묻는다.
- 끝에(문서): 새 `project-docs/architecture/folder-sync.md`(문제, 모델: 폴더 배치·file 꼴·stream과 cursor·held·snapshot 합치기·take-in, 지키는 것: 자기 하위 폴더만 쓴다·검사 뒤 한 transaction·실패한 읽기는 아무것도 지우지 않는다·id file과 자격은 폴더에 없다·같은 release끼리만·폰은 컴퓨터를 거친다, 결정), `app-sync.md`(origin `machine`, snapshot 합치기, horizon, 미래 clock 미루기, `sync_to` 앱도 sync 앱, "컴퓨터가 hub"를 "폰에게는 컴퓨터가 hub, 기계끼리는 폴더"로), `app-call.md`(caller의 `machine`), `approval.md`(설정의 `approval: "person"`과 `setting` subject), `activation.md`(take-in은 prepared release, 동의는 그 기계에서), `boundary-catalog.yaml`·`module-catalog.yaml`(`protocol/folder`, `core/folder`), `project-docs/flows/`(`flows` skill로 마지막 대조), roadmap `multi-machine.md`(순서 2 끝남), sdk-note 확인(`node tools/check-sdk-notes.ts`), change-log `0.23/app-folder-sync.yaml`(바깥 도구는 사람마다, 실시간 아님, 흔적 정리는 사람이 쓴 것을 버리지 않고 90일 넘게 떨어진 기계에 held로 남긴다, 미래 clock은 미룸, held는 machine-update가 푼다), 이슈 정리(`wrap-plan`).

# folder-sync

한 사람의 여러 컴퓨터가 앱 data, release, 앱 source, 기계 기록을 폴더 하나로 주고받는 설계다. 앱 선언의 `sync_to`가 destination 이름(기계마다 local 폴더 경로에 묶인 이름)을 고른다. 컴퓨터는 그 앱의 변경을 destination 안 자기 하위 폴더에 file로 쓰고, 다른 기계의 하위 폴더에서 file을 읽어 전부 검사한 뒤 한 transaction으로 적용한다. 폴더를 기계 사이로 옮기는 것은 사람이 고른 바깥 도구(같은 LAN의 Syncthing, rclone `crypt` 위 cloud 등)이고 lophn code는 폴더만 안다. 두 번째 기계는 폴더에 온 release를 사람의 동의로 받는다. 앱을 들인 기계는 다른 기계가 낸 새 release를 스스로 따라가고(`activation.md`), 기계마다 앱 release나 lophn 판이 다른 동안 다른 release의 변경은 잃지 않고 두었다가 차례로 적용하며, 폴더 꼴을 서로 읽을 수 없으면 멈추고 누가 올려야 하는지 보인다. agent는 읽기 명령 `machine.environment`로 환경을 읽고, 지침(`design-app` skill의 `folder-sync.md`)을 따라 정책을 고르고 바깥 도구를 붙인다. 칸 단위 맞추기 규칙과 sync log는 `app-sync.md`, 기계 id는 `machine.md`, release 활성화와 동의는 `activation.md`가 맡는다.

## 문제

- 사람의 앱 data가 그 앱을 만든 컴퓨터에만 있었다. 집 PC에서 쓴 data를 회사 PC와 미니 PC에서 쓰려면 사람이 손으로 옮겨야 했다. 폰은 짝지은 컴퓨터를 거쳐 맞추지만(`app-sync.md`) 컴퓨터끼리는 길이 없었다.
- 컴퓨터끼리는 hub가 없다. 둘 다 꺼져 있다 켜지고, 서로 닿지 않고, 같은 앱을 동시에 고친다. 한쪽 사본으로 다른 쪽을 덮으면 받는 쪽이 아직 내보내지 않은 변경이 사라진다.
- 사람마다 쓰는 저장소가 다르다(같은 LAN, NAS, 여러 cloud). lophn이 저장소 하나에 묶이면 다른 사람은 쓰지 못하고, lophn이 cloud API와 자격을 들면 그 자격과 계약을 lophn이 지켜야 한다.
- 폴더를 옮기는 도구는 file을 반만 옮기고, 충돌 사본(`… (1)`, `.sync-conflict-…`)을 만들고, 순서를 지키지 않고, 지운 것을 되살린다. 그런 폴더에서 읽은 것을 그대로 적용하면 data가 깨진다.
- 지운 row의 흔적(tombstone)을 영원히 둘 수 없다. 흔적을 지우면 그보다 옛 변경을 든 기계가 돌아와 지운 row를 되살린다. 그렇다고 오래 떨어져 있던 기계의 변경을 버리면 사람이 쓴 것을 잃는다.
- 기계마다 시계가 어긋난다. 앞선 시계의 변경은 칸 단위 last-write-wins에서 늘 이긴다.
- 폴더는 data root 밖이고 바깥 도구가 인터넷으로 올리기도 한다. 기계 id file, 자격, secret이 거기에 섞이면 안 된다.
- 기계 X가 앱의 release r2(migration으로 칸을 더함)를 내고 그 release로 쓴 변경은 r1을 돌리는 기계 Y의 DB에 맞지 않는다. 버리면 X의 변경을 잃고, 억지로 적용하면 Y의 DB가 깨진다.
- Y가 r1에서 같은 row의 다른 칸을 고쳤다. Y가 r2로 올라간 뒤에도 그 고침이 X에 남아야 한다. migration이 칸 번호를 바꾸면서 칸 clock을 잃으면 늦게 올라온 Y의 칸 고침이 X의 더 옛 값에 진다.
- 다른 release의 변경을 기다리게 두면 끝없이 쌓여 data root가 찰 수 있다. 영영 올라오지 않는 기계도 있다.
- 두 기계의 lophn 판이 다르면 폴더의 꼴을 서로 틀리게 읽을 수 있다. 칸 하나 더할 때마다 모든 기계가 멈추면 한 기계를 올리는 것이 나머지를 막는다. 판이 맞지 않는데 말없이 멈추면 사람은 무엇을 해야 하는지 모른다.

## 목표와 비목표

- 목표: 앱마다 선언 하나(`sync_to`)로 data가 가는 길을 고른다. 기계가 아무 순서로 켜지고 꺼져도 사본이 같아지고, 충돌하지 않는 편집은 잃지 않는다. 폴더에서 깨지거나 반만 온 것은 하나도 적용하지 않는다. 사람이 쓴 것은 흔적 정리 때문에 버려지지 않는다. 두 번째 기계는 같은 앱 id와 같은 봉인 bundle을 받고 활성화는 그 기계에서 사람이 동의한다.
- 목표: 다른 release의 변경을 잃지 않고 두었다가 이 기계가 그 release가 되면 차례로 적용한다. 옛 release에서 한 변경은 그 기계가 올라온 뒤의 snapshot으로 온다. 기다리는 동안 앱은 이 기계의 data로 그대로 돈다.
- 목표: lophn 판은 범위로 본다. 범위 안이면 계속 주고받고, 범위 밖이면 그 기계의 file을 열지도 지우지도 않고 멈추며 누가 올려야 하는지 고칠 수 있는 곳에서 말한다.
- 비목표: 실시간 맞추기(분 단위로 늦을 수 있다). 바깥 도구의 설치·설정·이름(code, 의존성, 설정 어디에도 없다. agent가 지침대로 붙인다). lophn이 cloud API를 부르는 길(보류. file 꼴은 폴더든 API든 같은 bytes다). agent 정의·skill·설정·자격 맞추기. 폰이 폴더를 쓰는 것(폰은 짝지은 컴퓨터를 거친다). 대량 삭제를 멈추고 묻기, 표·칸별 정책. 충돌을 보이는 화면. 모든 기계를 올리는 단추와 updater(올리기는 각 기계에서 사람이 한다). 옛 release의 변경을 새 schema로 다시 표현하기(폰의 길. 컴퓨터는 자기 DB를 migration하고 덮지 않는 합치기를 받으니 snapshot이 그 일을 한다). 갈라진 release를 합치기(앱 agent가 합쳐 새 release를 낸다, `activation.md`).

## 모델

```
 기계 A                                    destination 폴더(바깥 도구가 옮김)                기계 B
 앱 DB ─ sync log(app_sync_log) ─ 내보내기 ─▶ machines/<A>/apps/<app>/data/<n>.changes|snapshot
                                            machines/<A>/apps/<app>/{app.json, releases/, source/}
                                            machines/<A>/record.json
                                            machines/<B>/…  ◀─ B만 쓴다
                         읽기(검사 → 한 tx 적용, 다른 release는 held로 복사) ─▶ B의 앱 DB, B의 sync log(origin machine)
 ledger: folder_streams·folder_written(쓴 것)   folder_reads·folder_held·folder_records(읽은 것)
```

### destination과 `sync_to`

- destination은 기계마다의 설정 `folder.destinations`(`{ "<이름>": { "path": "<절대 경로>" } }`, 이름 `^[a-z][a-z0-9-]{0,31}$`, 16개까지)다. 경로는 기계마다 다르고 설정은 기계를 넘지 않는다. 앱 선언 `sync_to: "<이름>"`은 이름만 고르므로 같은 선언이 경로가 다른 기계에서도 맞는다. 이 기계에 그 이름이 없으면 그 앱은 이 기계에서 내보내지도 읽지도 않는다.
- 거절하는 경로: 상대 경로, data root 안이나 data root를 품은 경로, 다른 이름과 같거나 서로 안에 있는 경로(symlink를 따라간 꼴과 글자 그대로의 꼴 둘 다 본다). 사람이 `settings.json`을 손으로 고쳐 검사를 지나친 값은 없는 것으로 본다. 그 밖의 위험(data root를 network·sync 폴더 위에 두기)은 code가 도구를 모르니 지침이 막는다.
- destination을 더하고 바꾸고 지우는 것은 사람의 승인이다. 설정 선언이 `approval: "person"`과 바뀜을 사람의 말로 쓰는 `describe(before, after)`를 갖는다(`settings.md`, `approval.md`). 카드는 `Add sync folder "personal": /home/me/Sync/lophn`처럼 이름과 전체 경로를 보인다.
- `sync_to`가 있는 앱은 컴퓨터에서 sync 앱이다(clock 표와 sync log, `app-sync.md`). 그래서 폰 앱과 같은 schema 규칙과 `@lophn/cap-store` 2.0.0 하한을 release 준비가 본다. `runs_on: ["phone"]`은 `sync_to`를 쓰지 못한다(컴퓨터 사본이 없다).

### 폴더 배치

```
<destination>/machines/<mch_…>/
  record.json                                        기계 기록
  apps/<app_…>/app.json                              앱 기록
  apps/<app_…>/data/<n>.changes | <n>.snapshot       data stream (n은 12자리 0 채움, 1부터)
  apps/<app_…>/releases/<bundle hash>/files/<path>   봉인한 bundle의 file 그대로
  apps/<app_…>/releases/<bundle hash>/release.json   release 기록과 file 목록(마지막에 쓴다)
  apps/<app_…>/source/<n>.bundle, <n>.json           증분 git bundle과 그 목록(bundle 뒤에 쓴다)
```

- 기계는 자기 `machines/<자기 id>/` 아래에만 쓰고 남의 하위 폴더는 읽기만 한다. 그래서 lock이 없고 같은 file을 둘이 고치지 않는다.
- 쓰기는 같은 폴더의 `<이름>.tmp-<16 hex>`에 쓰고 rename한다(앞에 점을 붙이지 않는다: 점 file을 건너뛰는 도구가 있다). 번호 붙은 file은 다시 쓰지 않는다.
- 읽는 쪽은 이름이 위 꼴과 정확히 맞는 file만 본다. 충돌 사본, temp, OS file은 없는 것이다. 사라진 file은 "아직 안 옴"이고 local의 무엇도 지우지 않는다.
- 여러 file로 된 것(release, source)은 목록 file이 각 file의 크기와 sha256을 싣고 마지막에 쓰인다. 목록이 없거나 하나라도 맞지 않으면 "아직 안 옴"이다.

### 변경 file 꼴

```
1행  "lophn-folder 1 <changes|snapshot> <2행 bytes(끝 \n 포함)의 sha256 hex>\n"
2행  header JSON 한 줄(≤ 1 MiB) + "\n"
나머지  payload, 정확히 header.payload.size bytes
```

- header는 `{machine, app, n, kind, release: {bundle_hash, data_schema}, created_at, payload: {size, sha256}, changes?}`다. `changes` file의 payload는 SQLite session changeset들을 이어 붙인 것이고 `changes[]`가 변경마다 `{id(주인 sync log seq), hlc, origin(computer|device|rewind), operation, started_at, offset, size}`를 싣는다. 변경 하나 ≤ 8 MiB, file 하나 ≤ 1,000개·payload 16 MiB. `snapshot` file의 payload는 그 앱 DB 사본(숨은 clock 표 포함, ≤ 1 GiB)이고 그 stream의 앞 번호 변경을 모두 담는다.
- 1행 hash 덕에 쓰는 쪽은 payload를 끝까지 쓰기 전에 header를 정할 수 있고(큰 snapshot도 한 번에 쓴다) 읽는 쪽은 잘린 file을 크기와 hash로 알아본다.
- 맞는 file: 1행의 판이 이 기계가 읽는 범위 안(아니면 `newer_format`), 1행 hash, header의 아는 칸 schema, header의 machine·app·n·kind가 path와 같음, 전체 크기, payload hash. 하나라도 어기면 그 file에서 아무것도 적용하지 않는다(`invalid_file`).
- header와 모든 기록 file은 모르는 칸을 버리고 읽는다. 칸을 더해도 꼴 판은 그대로이고, 옛 판이 file을 틀리게 읽게 되는 바꿈에만 오른다. 기계 기록의 `lophn.folder`가 쓰는 판과 읽는 하한을 알린다.

### stream과 cursor

- 번호는 (기계, 앱) stream마다 1부터 빈틈없이 는다. stream의 첫 file과 주인의 release가 바뀐 뒤의 첫 file은 snapshot이다.
- 쓰는 쪽은 file bytes의 sha256을 먼저 `folder_written`에 의도로 적고, temp에 쓰고 rename한 뒤, 한 transaction에서 다음 번호를 올린다. 다시 돌 때 끝나지 않은 의도는 file이 같은 hash면 끝난 것, 없으면 지우고, 다르면 남의 writer다.
- 자기 하위 폴더에 자기가 쓰지 않은 번호가 보이면(알아채지 못한 data root 복제가 같은 id로 쓴다) 내보내기를 멈추고 `foreign_writer`로 알린다. 저절로 풀리지 않고 사람이 그 file을 치운 뒤 `app.sync_resume`으로 다시 켠다.
- 읽는 쪽은 (앱, 출처 기계)마다 cursor(적용했거나 held로 넘긴 마지막 번호)를 자기 ledger `folder_reads`에 둔다. 다음 번호가 없거나 맞지 않으면 기다린다. 그보다 큰 번호의 맞는 snapshot이 있으면 그것을 합치고 cursor를 그 번호로 둔다(주인의 compaction이 옛 file을 지운 뒤 온 기계). 앱 기록의 `data.head`로 "아직 안 옴"과 "끝"을 가른다.
- 받은 file 하나는 앱 DB transaction 하나다. 받은 변경 하나는 invocation 하나이고(caller `{kind: person, view_session: <주인 log seq>, machine: <출처>}`, operation과 시작 시각은 주인 것) 제약에 걸린 변경만 건너뛴다. 같은 (출처 기계, 변경 id)는 한 번만 적용된다. 그래서 폰 변경과 같이 Activity와 rewind가 덮는다(`app-call.md`). 받은 변경은 sync log에 origin `machine` 줄로 남아 폰이 pull한다.
- compaction은 주인만 한다. 마지막 snapshot이 30일 지났고 새 줄이 있으면 새 snapshot을 쓰고, 그 앞 snapshot보다 작은 번호의 자기 file 가운데 30일 지난 것을 지운다. 마지막 snapshot은 남는다. 늦은 기계는 그 snapshot으로 따라온다.

### snapshot 합치기

- 기계 사이 snapshot은 덮지 않고 row·칸 clock으로 합친다. source의 상태를 변경으로 다시 지어(row마다 row clock의 INSERT, 칸 clock마다 UPDATE, 흔적마다 DELETE, 없는 row의 kept 칸마다 UPDATE) 칸 단위 적용 규칙에 그대로 넘긴다. 그 snapshot까지의 변경을 하나씩 적용한 것과 같다. 앱 표의 모양이 다르면 아무것도 쓰지 않고 `conflict`다.
- 합치기는 invocation 하나(`lophn.snapshot_merge`)다. 합친 결과는 clock이 여럿이라 폰에 줄 하나로 보낼 수 없어 sync log에 '다시 snapshot' 줄을 남기는데, 그 줄은 origin `machine`(출처 기계, 그 invocation)이고 내보내기가 건너뛴다.
- 받는 쪽의 그물: row clock이 받는 쪽 horizon 이하인 source row인데 받는 쪽에 그 row도 흔적도 없으면(받는 쪽이 지우고 흔적을 정리했을 수 있다) 적용하지 않고 held 줄로 남긴다. 변경 file의 변경도 같다(폰에서 온 것도).

### held: 두 가지

- **다른 release의 file(`folder_held`).** 맞는 data file의 `release.bundle_hash`가 이 기계의 그 앱 활성 release와 다르면 적용하지 않는다. bytes를 크기와 hash를 확인한 뒤 `<data root>/folder-held/<app>/<출처>/<n>.<kind>`(0600)에 temp와 rename으로 그대로 복사하고, 그 뒤 한 transaction에서 `folder_held` 행과 그 출처의 cursor를 둔다. 주인의 compaction이 폴더에서 지워도 잃지 않는다. held는 "적용하지 않았고 잃지 않았다"는 뜻이다. 적용, 지우기, 한도는 아래 "다른 release와 다른 lophn 판"이다.
- **흔적과 부딪을 수 있는 변경(sync log의 `held` 줄).** 아래 horizon 규칙이 내보내지 않거나 적용하지 않은 변경이다. changeset blob과 출처를 쥐고 폰에 보내지 않고 내보내지 않는다. 사람이나 그 앱의 agent가 `apps/sync_held`로 푼다.

### 흔적 정리와 horizon

- `settled`: 기계 M이 앱 기록에 싣는 HLC. M의 그 앱 DB clock이 "내보낼 것이 없고 읽는 모든 출처의 cursor가 그 출처 앱 기록의 `data.head`에 닿은" 마지막 때의 값이다. M은 그 clock 이하의 자기 것을 다 냈고 남이 그때까지 낸 것을 다 받았다는 뜻이다.
- 정리: 컴퓨터는 앱 release마다 core가 뜬 뒤 첫 내보내기와 하루에 한 번, clock이 `max(min(알려진 모든 기계와 자기의 settled), now − 90일)`보다 작은 흔적만 지우고(settled가 없는 기계가 있으면 90일 쪽만) 지운 가장 큰 clock을 `horizon`으로 앱 기록에 싣는다. 알려진 기계는 이 기계가 그 앱의 기록을 가진 기계이고, 사람이 `machine/forget`으로 목록에서 지운 기계는 빠진다(더 큰 revision의 기록을 쓰면 돌아온다).
- horizon 밖: 기계 N의 `settled`가 다른 기계 X의 `horizon`보다 작으면 N은 그 앱에 대해 떨어져 있다(away). 그러면
  - 내보내기는 아직 내보내지 않은 자기 변경 가운데 clock이 X의 horizon 이하인 것을 그 자리에서 `held` 줄로 바꾼다. snapshot을 쓰기 전에는 그 seq까지의 모든 줄에 먼저 이 규칙을 건다.
  - 그 변경은 이 기계의 앱 DB에 그대로 있어 snapshot에 실린다. 그래서 이렇게 held인 자기 변경이 하나라도 풀리지 않았으면 snapshot을 쓰지 않는다. 30일 compaction snapshot은 미루고, snapshot 없이 이을 수 없는 stream(첫 file, release가 바뀜, bytes로 남지 못한 자기 변경)은 `away_too_long`으로 멈춰 사람이 풀기를 기다린다. changes file은 계속 나간다.
  - N은 X를 snapshot으로 따라온다. 합치기는 X의 horizon 이하 clock만 가진 N의 row 가운데 X의 snapshot에 없고 N의 held가 건드리지 않는 것을 지운다(그 사이 다른 곳에서 지워지고 흔적이 정리된 row). 이 지우기는 X의 앱 기록 `read[N].n`이 N의 `data.head`에 닿은 뒤에만 한다: X가 N이 낸 것을 다 받았어야 "X에 없음"이 "지워짐"이다. 닿기 전에는 표시(`owes_absent_pass`)를 남기고 기다렸다가 X의 최신 snapshot을 한 번 더 합친다.
  - 앱의 상태(`machine.environment`의 `away`)와 사람의 알림(`app_sync_away`, `app-notice.md`)이 "이 앱이 너무 오래 떨어져 있었다, 변경 N개가 held다"를 말한다. 떨어져 있음이 끝나거나 사람이 held를 풀면 같은 줄을 "따라잡았다"와 남은 held 수로 바꾼다.
- 풀기(`apps/sync_held`, 사람과 그 앱의 agent): 목록(줄마다 `made_here`와 건드리는 표·종류·때), `apply`, `discard`. 저절로 풀리지 않는다.
  - apply: 이 기계가 낸 변경은 이미 data에 있어 다시 적용하지 않는다. 앱 process가 그 변경이 건드린 row·칸의 지금 값을 새 clock으로 찍고 그것이 보통 변경으로 나간다(사람의 다시 정함). 사라졌거나 뒤 변경이 다시 쓴 row는 뒤 변경이 맡으니 뺀다. 다른 기계나 폰에서 온 변경은 다시 적용하고 지금 data와 부딪으면 `conflict`다.
  - discard: 적용하지도 내보내지도 않고 `resolved_at`을 적는다. bytes는 기록에 남는다. 이 기계가 낸 변경은 이 기계의 data에 남고 변경으로는 나가지 않는다(뒤에 이 기계가 snapshot을 쓰면 그 지금 값이 실린다).

### 미래 clock

받는 쪽 시각 + 5분보다 앞선 변경이 든 changes file은 시각이 따라올 때까지 적용하지 않고 기다린다(`clock_ahead`, 물러나지 않는다). 상태의 `details`가 어느 기계(`machine`, `machine_name`)의 시계가 얼마나(`ahead_ms`) 앞섰는지 말한다. 값을 깎지 않는다.

### release와 source

- release: 주인은 활성 release의 봉인 bundle file을 `releases/<bundle hash>/files/`에 그대로 쓰고 마지막에 `release.json`(`{format, machine, app, bundle_hash, code_commit, declaration_hash, data_schema, data_changes, created_at, files: [{path, size, sha256}]}`)을 쓴다. `release.json`은 bundle의 file마다 한 줄이라(template 앱 하나가 node_modules로 수천 file이다) 다른 기록 file(256 KiB)과 따로 8 MiB까지 읽는다. release의 기계 사이 신분은 봉인 bundle hash다. SDK 사본은 따로 싣지 않는다(bundle이 이미 담는다).
- source: 기계마다 증분 git bundle이다. 새 commit이 있을 때만, 앞서 낸 heads와 다른 기계에서 받은 것을 빼고 `source/<n>.bundle`을 쓰고 그 뒤 `<n>.json`(heads, prerequisites, size, sha256)을 쓴다. 받는 쪽은 번호 순서로 검사하고 prerequisite가 이 저장소에 있을 때만 `refs/remotes/<mch>/*`로 fetch한다. 합치지 않는다. 사람의 branch, HEAD, 작업 tree는 처음 저장소를 만들 때(`main`을 그 release의 commit에 둔다) 말고는 건드리지 않는다. 폴더 안에 bare 저장소를 두지 않는다.

### take-in

- `app.take_in {app, from?, release?}`는 다른 기계가 폴더에 내놓은 앱을 이 기계에 들인다. 같은 `app_` id로 등록하고(slug가 이미 다른 앱의 것이면 `conflict`), release 폴더를 전부 검사한 뒤 봉인 사본을 설치하고 `prepared` release로 적는다. 이미 들인 앱이면 앱 행을 건드리지 않고 그 release만 설치한다(같은 bundle이 있으면 그것을 돌려준다).
- grant, 동의, secret, OAuth, invocation 기록, 앱 data는 옮기지 않는다. 활성화는 이 기계의 `release.activate`이고 첫 활성화는 이 기계에서 사람에게 동의를 묻는다(`activation.md`). data는 활성화 뒤 data stream으로 온다.
- `conflict`의 `details.reason`: `sdk_missing`(이 lophn에 bundle이 고정한 SDK 판이 없다. 폴더에서 온 code를 이 기계의 SDK 저장소에 넣지 않는다), `slug_in_use`, `dependency_missing`(`details.packages`). release file이 다 오지 않았으면 `invalid_input`에 `details.reason: release_incomplete`다.
- `app.create`에서 앱 id를 고를 수 있는 것은 사람과 폴더 take-in 자격(`machine:folder-apps`)뿐이다. agent와 그 밖의 machine 자격은 고르지 못한다.

### 기계 기록과 환경

- 기계 기록 `record.json`: `{format, machine, revision, updated_at, name, always_on, addresses: {lan, port, relay}, lophn: {version, protocol: {version, min_version}, folder: {version, min_version}}}`. 주소는 `remote.enabled`일 때만 싣는다. 공개 key, pairing code, binding, 자격은 싣지 않는다. destination마다 하나씩 쓴다. 읽는 쪽은 기계마다 가장 큰 `revision`을 남기고, 한 기계의 기록을 읽다 실패하면 옛 사본을 그대로 둔다. `lophn.folder`가 범위 밖인 기계의 file은 읽지 않는다(`newer_format`, 아래 "다른 release와 다른 lophn 판").
- 앱 기록 `app.json`: `{format, machine, app, revision, updated_at, slug, name, description, sync_to, active_release, releases, data: {head, snapshot}, source: {head}, read: {<mch>: {n, at}}, settled, horizon}`.
- 읽는 쪽의 cursor, held, 남의 기록 사본은 그 기계 ledger 표(`folder_reads`, `folder_held`, `folder_records`)에 두고 행마다 그 기계 id를 적는다. 다른 기계 id가 적힌 행(복제된 data root에서 온 것)은 없는 것이다.
- 읽기 명령 `machine.environment`(route `machine/environment`, actors user·agent, workspaces home·app)는 이 기계, 알려진 기계(이름이 겹치면 `display_name`이 `이름 (id 끝 6자)`), destination 상태, 앱마다 내보내기·읽기·`away`, 들일 수 있는 앱을 돌려준다. 오류 code는 `destination_missing`, `not_writable`, `foreign_writer`, `invalid_file`, `newer_format`, `too_large`, `clock_ahead`, `apply_failed`, `app_not_running`, `release_incomplete`, `away_too_long`이다.
- 확장 자리: 뒤 계획은 명령의 code를 고치지 않고 자기 wiring에서 `ctx.folderEnvironment.register({name, top?, machine?, app?})`를 한 번 부른다. 함수가 던지거나 2초를 넘기면 그 section만 `{error}`가 되고 명령은 나머지를 돌려준다. `always_on`은 section이 아니라 기계 칸이다(이 기계는 `ctx.alwaysOn`, 다른 기계는 기록).

### 다른 release와 다른 lophn 판

```
 출처 X의 data stream(번호 순서)            이 기계 Y(지금 release r1)
   n: r1 changes ──────────────────────────▶ 적용
   n+1: r2 snapshot(release가 바뀐 뒤 첫 file) ┐
   n+2: r2 changes                            ├▶ held: <data root>/folder-held/<app>/<X>/<n>.<kind>, 행 folder_held
   ...                                        ┘    (cursor는 held 뒤로 간다)
 Y가 r2를 따라간다(activation) ─▶ drain: X의 r2 held를 번호 순서로 적용하고 하나마다 지운다 ─▶ X의 stream을 잇는다

 Y가 r1에서 쓴 변경 ─▶ Y의 stream(r1) ─▶ X는 held(older_release)로 둔다
 Y가 r2가 된 뒤 첫 file = snapshot m ─▶ X가 clock으로 합친다(Y의 r1 칸 고침이 온다) ─▶ X의 Y held 중 m보다 옛 것을 지운다
```

- **따라가기.** 앱을 들인 기계는 다른 기계들의 앱 기록이 말하는 활성 release 가운데 git 조상 순서로 하나를 골라 take-in과 같은 길로 설치하고 activation에 넘긴다. 고르기, 동의, 실패와 갈라짐은 `activation.md`다.
- **drain 순서.** 이 기계의 활성 release가 held의 release가 되면, 출처마다 그 release의 held를 번호 순서로 stream과 같은 적용 길로 적용하고 하나가 성공할 때마다 그 행과 사본을 지운다. 그 출처의 stream은 지금 release의 held를 다 적용한 뒤에만 읽는다: cursor가 held 뒤에 있어 먼저 읽으면 순서가 뒤집힌다. 하나가 실패하면 그 출처는 그 행에서 멈추고 다음 계기에 같은 행부터 한다.
- **snapshot이 덮은 held.** 출처 X의 snapshot m이 합쳐지거나 held가 되면 같은 transaction에서 X의 m보다 옛 held를 지운다. snapshot m은 m 앞의 변경을 다 담기 때문이다(폴더 꼴의 계약). 그 밖에 held가 없어지는 길은 이 기계가 그 release가 되어 적용했을 때와 앱을 이 기계에서 지웠을 때뿐이다.
- **옛 release의 변경.** 주인의 release가 바뀐 뒤 내는 첫 file은 snapshot이다. 그래서 늦게 올라온 기계가 옛 release에서 한 변경은 따로 다시 표현하지 않고 그 snapshot을 칸 clock으로 합칠 때 온다. 이것이 맞으려면 migration 뒤에도 칸 clock이 남아야 해서, 앱 process가 뜰 때 칸 clock을 칸 이름으로 새 번호에 옮긴다(`app-sync.md`). 다른 destination에 쓰는 사이 진짜 폴더에 빈 번호가 생겨도 그 snapshot이 빈 곳을 덮어 읽는 쪽은 그 번호로 건너뛴다.
- **왜 기다리나(`why`).** held 한 줄(출처와 release마다)은 `newer_release`(이 기계가 그 release가 되면 적용된다. 사람이 이전으로 돌아가 내려놓은 release도 여기다)나 `older_release`(이 기계가 지금보다 먼저 들인 release이거나 data schema가 낮다. 그 기계가 올라오면 snapshot으로 온다)다.
- **한도.** 출처 하나·앱 하나에서 가장 새 held snapshot 뒤의 held changes 합이 128 MiB를 넘을 file은 복사하지 않고 폴더에 둔다(`full`). 그 출처의 stream은 거기서 멈추고, 폴더에 그 출처의 더 뒤 snapshot이 있으면 그리로 건너뛴다(snapshot이 앞을 담는다). 이 기계가 그 release에 오면 멈춘 cursor부터 폴더에서 읽고, 그 사이 주인이 compaction했으면 지금 규칙대로 뒤의 snapshot으로 따라온다. 128 MiB는 한 release의 changeset 합 한도와 같다: 그보다 많으면 출처의 snapshot 하나가 더 싸다.
- **꼴 판 범위.** 기계마다 쓰는 꼴 판과 읽는 하한(`FOLDER_FORMAT {version, min_version}`)을 기계 기록의 `lophn.folder`에 싣는다(없는 옛 기록은 `{1, 1}`). 상대의 `version`이 내 `version`보다 크거나 내 `version`이 상대의 `min_version`보다 낮으면 이 기계를 올려야 하고(`update_this`), 상대의 `version`이 내 `min_version`보다 낮거나 내 `version`보다 낮으면 그 기계를 올려야 한다(`update_peer`). 제품 판 글(`lophn.version`)은 보이기만 하고 판정에 쓰지 않는다. 꼴 판은 옛 판이 읽으면 틀리게 되는 바꿈에만 올리고 칸을 더하는 것은 올리지 않는다(위 "변경 file 꼴").
- **범위 밖 기계.** 기계 기록은 읽어 두고(누가 올려야 하는지 보이려고) 앱 기록은 건너뛴다. 그 기계의 data·source·release file을 열지도 복사하지도 지우지도 않으며 cursor도 그대로다. 읽기 오류는 `newer_format`이고 `details.exchange`가 누가 올릴지다. 다시 범위 안이 되면 그 cursor부터 잇는다.
- **보이는 곳.** App details의 Machines 절(`apps/update_state`)이 기계마다 release, 이 기계의 따라가기 상태, 기다리는 변경 수와 이유, 범위 밖 안내를 보인다: "Needs an update here: N changes from <기계> wait for it"(snapshot만 기다리면 "the latest data from <기계> waits"), "<기계> is on an older release; its changes arrive when it updates", "More from <기계> wait in the folder"(한도), "Update lophn on this computer to exchange with <기계>", "<기계> runs an older lophn. Update it on that machine.", 그리고 "While changes wait, the app keeps running on this computer's data." 올리는 단추는 없다.

### 계기와 물러남

- 내보내기와 앱 기록·release·source 쓰기: 앱마다 sync log가 바뀐 뒤 5초 debounce, 5분 timer, destination 설정이 바뀜, 활성 release가 바뀜(활성화, take-in), core 시작.
- 읽기: destination의 `machines/`와 다른 기계의 하위 폴더를 폴더마다 감시(2초 debounce)하고 2분 timer. 새 폴더는 다음 scan이 감시에 더한다.
- (앱, destination)·(앱, 출처 기계)마다 한 번에 하나이고, 한 번에 64 MiB까지 다룬다. 더 남으면 바로 이어 돈다. 실패한 일은 1분부터 두 배씩 1시간까지 물러난다. `clock_ahead`는 물러나지 않는다. 사람이 held를 풀거나 내보내기를 다시 켜면 물러남을 지우고 바로 돈다. 이 일들은 idle-exit를 막지 않는다.

## 지키는 것

1. 기계는 destination 안 자기 `machines/<자기 id>/` 아래에만 쓴다. 남의 file을 지우거나 고치지 않는다. 자기 하위 폴더에 자기가 쓰지 않은 file이 보이면 내보내기를 멈추고 사람이 다시 켤 때까지 쓰지 않는다.
2. 읽은 file은 전부 검사한 뒤에만 쓴다. 변경 file 하나는 앱 DB transaction 하나이고 cursor는 같은 단위로 오른다. 깨지거나 반만 온 file에서는 아무것도 적용하지 않고 그 번호에서 기다린다. 여러 file로 된 release와 source는 목록 file과 모든 file이 맞을 때만 쓴다.
3. 실패한 읽기와 사라진 file은 아무것도 지우지 않는다. 다른 기계의 기록 사본은 한 기계의 기록이 모두 읽혀야 바뀐다.
4. 기계 id file(`machine.json`)과 그 binding, `secrets.json`의 값, remote host key는 폴더에 없다. 기계 기록은 공개 key, pairing code, binding, 자격을 싣지 않는다.
5. 같은 release(같은 봉인 bundle hash)끼리만 적용한다. 다른 release의 file은 data root에 그대로 복사해 held로 둔다.
6. 폰은 폴더를 쓰지 않는다. 폰의 변경은 짝지은 컴퓨터가 받아 그 컴퓨터의 변경처럼 내보낸다.
7. 다른 기계에서 온 row는 이 기계에서 다시 내보내지 않는다(origin `machine` 줄과 그런 일의 '다시 snapshot' 줄을 건너뛴다). 이 기계가 쓴 것은 stream에서 빠지지 않는다(bytes로 남지 못한 자기 변경은 snapshot으로 나간다).
8. 기계 사이 snapshot은 덮지 않고 row·칸 clock으로 합친다.
9. destination은 사람만 바꾼다. agent의 바꾸기는 그 turn에서 사람이 이름과 전체 경로를 보고 허락한 그 한 번뿐이고, 사람이 없는 turn과 팀 자식은 물을 수 없어 거절된다.
10. horizon 밖으로 떨어졌던 기계의 변경은 held로 남고 버려지지 않는다. held인 자기 변경이 풀리지 않은 동안 그 변경을 담을 snapshot을 쓰지 않는다. 받는 쪽도 자기 horizon과 부딪을 수 있는 변경을 버리지 않고 held로 둔다.
11. 흔적은 알려진 모든 기계가 지난 것이거나 90일보다 옛 것만 지운다. 떨어져 돌아온 기계의 "X에 없음 = 지워짐" 지우기는 X가 그 기계가 낸 것을 다 받은 뒤에만 한다.
12. 미래 clock은 깎지 않고 미룬다.
13. take-in은 grant, 동의, secret, data를 옮기지 않는다. 활성화의 동의는 그 기계에서 사람이 한다.
14. 다른 release의 변경은 적용하거나 held로 두거나 폴더에 남긴다. 말없이 버리지 않는다. held를 지우는 것은 적용했을 때, 같은 출처의 더 뒤 snapshot이 덮을 때, 앱을 이 기계에서 지울 때뿐이다.
15. 한 출처의 변경은 번호 순서로 적용된다. 지금 release의 held가 남은 출처의 stream은 읽지 않는다.
16. held의 복사와 그 행·cursor는 따로 commit되지만, 복사 뒤 행 전에 꺼지면 다음 번에 같은 bytes를 다시 쓴다. 크기와 hash가 header와 맞는 file만 held가 된다.
17. migration 뒤 칸 clock은 칸 이름을 따라간다. 이름이 없어진 칸과 표의 clock만 지운다. 그래서 옛 release에서 고친 칸이 snapshot으로 와도 clock으로 맞춰진다.
18. 출처 하나·앱 하나의 held changes는 가장 새 held snapshot 뒤로 128 MiB를 넘지 않는다. 넘을 것은 폴더에 남는다.
19. 꼴 판이 범위 밖인 기계의 data·source·release file은 열지도 복사하지도 지우지도 않고 cursor를 움직이지 않는다. 누가 올려야 하는지를 보인다.
20. 기다리는 동안 앱은 이 기계의 data로 돈다. 기다림이 앱을 멈추지 않는다.

## 경계와 계약

- boundary `folder`(내보내기·읽기·앱 기록·take-in·환경, 폴더 꼴과 상태 schema, 다른 release의 held·drain·한도, 꼴 판 범위), `app-sync`(sync core의 snapshot 합치기·흔적 정리·held, sync log의 origin `machine`과 `held` 줄), `app-runtime`(앱 process의 file 적용·합치기·정리·다시 찍기 control, 칸 clock 옮기기), `apps`(take-in 등록, `sync_held`), `app-releases`(따라가기와 `apps/update_state`), `config`·`approvals`(설정의 사람 승인).
- 선언: `sync_to`(`@lophn/declaration` 4.9.0. 그 판을 고정하는 `@lophn/app-ui` 2.18.0, `@lophn/app-ui-native` 1.4.0). 설정: `folder.destinations`(`approval: "person"`).
- route와 CLI: `machine/environment`(read, `lophn machine environment`), `machine/forget`(memory, 사람만, `lophn machine forget`), `apps/take_in`(command `app.take_in`, user·agent, `lophn app take-in`), `apps/sync_held`(memory, 사람과 그 앱의 agent, `lophn app sync-held <app> list|apply|discard [seq]`), `apps/sync_resume`(memory, 사람, `lophn app sync-resume`). `app_sync/pull`의 `origin`에 `machine`.
- 앱 process control: `sync_apply`(변경 묶음 1~1,000개·16 MiB), `snapshot_merge`, `sync_cleanup {before} → {dropped, horizon, max_hlc}`, `sync_reapply`.
- 저장: ledger schema step `apps.sync-log.machine`(sync log 다시 만들기: origin `machine`, 칸 `machine`, kind `held`, 칸 `resolved_at`), `folder.tables`(`folder_streams`, `folder_written`, `folder_reads`, `folder_held`, `folder_records`). data step은 없다. data root의 `folder-held/`. 앱 DB 숨은 표 `lophn_sync_kept`와 `lophn_sync_state`의 `horizon`.
- notice kind `app_sync_away`(`app-notice.md`).
- `folder_held` 행: 이 기계, 앱, 출처, 번호, 종류, release, data schema, 크기. 앱 DB 숨은 표 `lophn_sync_columns`(표마다 마지막으로 본 칸 이름 목록).
- 폴더: 기계 기록 `lophn: { version, protocol, folder: { version, min_version } }`. data file header의 `release.bundle_hash`·`data_schema`.
- 읽기: `apps/update_state {app}`(memory, 사람과 그 앱 workspace의 agent. `follow`, `held: [{machine, bundle_hash, data_schema, changes, bytes, full, why}]`, `machines: [{machine, name, this_machine, lophn_version, exchange, release}]`). 폴더 읽기 오류 `newer_format`의 `details: { machine, exchange: update_this | update_peer }`.
- 한도 상수: held 128 MiB(한 release의 changeset 합 한도와 같다).

## 결정

- 앱 data의 길은 앱마다 선언하고 앱을 짓는 agent가 사람의 환경과 memory로 고른다. 선언 칸은 `sync_to: "<이름>"` 하나다. 이유: 값이 이름뿐이라 경로가 다른 기계에서도 같은 선언이 맞는다. (길을 앱마다 고름: 사람. 칸 하나: planner)
- 보관소 연결은 제품 기능이 아니다. lophn은 폴더에 쓰고 읽기만 하고 바깥 도구는 사람마다 agent가 지침대로 붙인다. 바깥 도구의 이름이 code·의존성·설정에 없다. 이유: 사람마다 저장소가 다르고 lophn이 자격과 cloud 계약을 들지 않는다. 대가: 실시간이 아니고(감시 2초, timer 2·5분, 바깥 도구의 지연) 처음 설정은 사람과 agent의 일이다. (사람)
- lophn이 cloud API를 부르는 길은 보류하고, 변경 file은 폴더든 API든 같은 bytes다. (사람)
- destination 바꾸기는 사람의 승인이다. 사람의 data가 data root를 떠나 바깥 도구가 올리는 폴더로 가기 시작하는 일이라 pairing·연결과 같다. agent는 요청만 하고, 지금 있는 승인 카드(turn 안 request)에 이름과 전체 경로가 보이며 사람이 그 한 번을 허락한다. 사람 자격(사람의 터미널의 `lophn settings`)은 그대로 바꾼다. 버린 안: locked(agent가 지침대로 붙이는 길이 막힌다). (planner, 2026-11-16 뒤집음)
- 기계마다 자기 하위 폴더에만 쓴다. 이유: lock 없이 같은 file을 둘이 고치지 않고, 바깥 도구의 충돌 사본이 생길 자리가 없다. (planner)
- 변경 file은 checksum 줄, header 줄, payload의 한 file이다. 이유: 끝까지 쓰기 전에 header를 정할 수 있어 큰 snapshot도 한 번에 쓰고, 잘린 file을 크기와 hash로 알아본다. (planner)
- 기계 사이 snapshot은 덮지 않고 합친다. 이유: hub가 없어 덮으면 받는 쪽의 아직 안 간 변경이 사라진다. (planner)
- 맞추기 engine의 규칙은 "write는 자기 clock으로만 순서가 정해지고, delete는 자기보다 옛 것만 지운다"다. delete가 그 row의 칸 clock을 모두 지우던 옛 규칙은 delete보다 새 칸 write를 도착 순서에 따라 잃거나 남겨 두 사본이 갈렸다(A가 3에 지우고 4에 다시 넣는 사이 B가 5에 칸을 고치면 A는 B의 값, B는 A의 값). delete보다 새 칸 값은 숨은 표 `lophn_sync_kept`에 남고 뒤에 row를 되살리는 insert가 칸마다 더 새 clock을 갖는다. row의 있음은 가장 새 insert와 가장 새 delete로 정한다. 그래서 delete, 다시 넣기, 칸 고침이 두세 node에서 어떤 순서로 와도 같아진다. (planner, agent)
- 같은 release끼리만 적용하고 다른 release의 file은 held로 복사한다. 이유: schema가 다를 수 있고, 주인의 compaction이 폴더에서 지워도 잃지 않는다. (planner)
- 흔적은 알려진 모든 기계가 지난 것이거나 90일보다 옛 것만 지우고, horizon 밖에서 돌아온 기계의 그런 변경은 held로 남는다(버리지 않는다). (사람, 2026-11-16 뒤집음: 처음 안은 90일 넘게 떨어진 기계의 변경을 버리는 것이었다)
- 미래 clock은 값을 깎지 않고 미룬다. 이유: 받은 clock을 깎으면 사본마다 다른 clock을 적어 갈라진다. (planner, 조사)
- 다른 기계에서 온 일(snapshot 합치기, 결과 모르는 받은 변경)의 '다시 snapshot' 줄은 origin `machine`(칸 `machine`은 출처, `change_id`는 그 invocation)이고 내보내기가 건너뛴다. 그 줄은 폰을 위한 것이다(합친 변경은 clock이 여럿이라 pull 줄 하나가 될 수 없다). 이유: 그 data는 출처 기계가 이미 냈고, 건너뛰지 않으면 두 기계가 서로의 snapshot을 합칠 때마다 snapshot을 주고받는다. 이 기계가 낸 크거나 결과 모르는 자기 write는 여전히 snapshot을 부른다. (agent, 두 기계 시험에서 찾음)
- hold 규칙은 내보내지 않은 줄을 그 자리에서 `held`로 바꾸고, snapshot 앞에는 내보내지 않은 모든 줄에 먼저 건다. held인 자기 변경이 풀리지 않은 동안은 snapshot을 쓰지 않는다: compaction은 기다리고, snapshot 없이 이을 수 없는 stream은 사람이 apply나 discard할 때까지 `away_too_long`으로 멈춘다. changes file은 계속 나간다. 이유: held인 자기 변경은 앱 DB에 그대로 있어 snapshot으로 새어 나간다. 막지 않으면 hold가 무의미하고, 대신 snapshot에서 그 row를 빼면 snapshot이 "그 번호까지의 모든 것"이 아니게 된다. 대가: 떨어졌던 기계는 그 사이 release를 바꾸면 사람이 풀 때까지 내보내지 못한다. (agent, 두 기계 시험에서 찾음)
- 이 기계가 낸 held 변경의 apply는 다시 적용하지 않고 지금 값을 새 clock으로 찍어 보통 변경으로 보낸다. discard는 data를 이 기계에 두고 보내지 않는다(뒤에 이 기계가 snapshot을 쓰면 지금 값이 실린다). 다른 기계나 폰에서 온 변경은 DB에 다시 적용한다. 이유: 자기 변경은 이미 data에 있어 다시 넣으면 늘 부딪고, 옛 clock 그대로 보내면 받는 쪽 horizon의 그물에 다시 걸린다. (agent, 두 기계 시험에서 찾음)
- `release.json`은 다른 기록 file(256 KiB)과 따로 8 MiB 한도다. 이유: template 앱의 봉인 bundle은 6,803 file이고 `release.json`이 1.05 MB였다. (agent)
- 떨어져 있음 알림은 앱마다 한 줄이고 떨어져 있음이 끝나거나 held가 줄면 같은 줄을 "따라잡았다"와 남은 수로 바꾼다. program 줄은 지울 수 없어서다(`app-notice.md`). (agent)
- 앱 id는 기계 사이 같다. release의 기계 사이 신분은 봉인 bundle hash다. 이유: 받는 기계가 bundle을 그대로 받으므로 같고, 같은 commit을 따로 준비하면 npm 때문에 다를 수 있다. take-in은 이미 들인 앱이면 release만 설치한다(`machine-update`의 따라가기가 같은 함수를 부른다). (planner)
- SDK 사본은 따로 싣지 않고, 받는 기계의 lophn에 없는 SDK 판을 고정한 release는 `conflict`(`sdk_missing`)다. 이유: 폴더에서 온 code가 그 기계의 SDK 저장소에 들어가지 않는다. (planner)
- source는 기계마다 증분 git bundle이고 받는 쪽은 `refs/remotes/<mch>/*`로 fetch만 한다. 폴더 안에 bare 저장소를 두지 않는다. 이유: 폴더 안 저장소는 두 기계가 같은 file을 고치고 바깥 도구가 반쯤 옮긴 object를 남긴다. (planner, 사람 roadmap)
- 읽는 쪽의 cursor, held, 남의 기록 사본은 그 기계 ledger에 두고 폴더에는 두지 않는다. (planner, `machine-identity` 계약)
- 읽기 명령의 뼈대는 이 계획이 갖고 뒤 계획은 등록한 함수로 section을 채운다. (planner)
- 이름이 겹친 기계는 `이름 (id 끝 6자)`다. id 앞쪽은 만든 시각(ULID)이라 같은 날 만든 기계끼리 겹친다. 이름의 유일성은 강제하지 않는다. (planner)
- 감시는 recursive watch가 아니라 폴더마다 하나다. 이유: recursive watch가 core process 안에서 event를 내지 않았다(Linux, Electron의 Node). (agent)
- Google Drive for desktop처럼 평문으로 올리는 도구는 사람이 "file이 평문으로 올라간다"는 말을 듣고 받아들일 때만 쓰고, cloud는 기본으로 rclone `crypt` 같은 암호화 도구로 쓴다. 지침이 묻기 전에 그것을 쉬운 말로 말하게 한다. (planner, 사람의 두 말을 맞춤)
- 새 release의 변경은 이 기계가 그 release가 되면 출처마다 번호 순서로 적용하고, 그 출처의 stream은 held를 다 적용한 뒤에 잇는다. 이유: cursor가 held 뒤에 있어 먼저 읽으면 순서가 뒤집힌다. (사람·planner, `machine-update`)
- 출처 X의 snapshot m이 합쳐지거나 held가 되면 X의 그보다 옛 held를 지우고, 그 밖에는 지우지 않는다. 이유: snapshot m은 m 앞의 변경을 다 담는다. (planner, `machine-update`)
- 옛 release에서 한 변경은 그 기계가 올라온 뒤의 첫 snapshot을 clock으로 합칠 때 온다. 버린 안: 폰처럼 backup, 허브 snapshot 받기, outbox를 칸 이름으로 다시 표현하기(폰은 자기 DB를 허브의 snapshot으로 바꾸기 때문에 그 길이 있다. 컴퓨터는 자기 DB를 migration하고 덮지 않는 합치기를 받는다). 그래서 migration 뒤 칸 clock을 지우지 않고 칸 이름으로 옮긴다(`app-sync.md`). 이유: 지우면 늦게 올라온 기계의 칸 고침이 먼저 올라간 기계에서 진다. (planner, 코드, `machine-update`)
- held 한도는 출처·앱마다 가장 새 held snapshot 뒤 128 MiB이고, 넘으면 폴더에 두고 뒤의 snapshot으로 따라온다. 이유: 그보다 많으면 snapshot 하나가 더 싸다. (planner, `machine-update`)
- lophn 판은 범위로 본다(폴더는 꼴 판 `[min_version, version]`). 제품 판 글은 보이기만 한다. 이유: 같은 build를 요구하면 한 기계를 올릴 때 나머지가 멈춘다. (사람·planner, 정책 11, `machine-update`)
- 범위 안에서는 모르는 칸을 버리고 계속 주고받고, 꼴 판은 옛 판이 틀리게 읽는 바꿈에만 올린다. 이유: 칸 하나 더할 때마다 모든 기계가 멈추면 안 된다. (planner, `machine-update`)
- 범위 밖이면 그 기계의 file을 열지도 복사하지도 지우지도 않고 cursor도 그대로이며, 올려야 하는 기계는 "Update lophn on this computer", 다른 기계는 "<이름> runs an older lophn"을 보인다. 이유: 고칠 수 있는 곳에서 고칠 것을 말한다. (planner, `machine-update`)
- 기다리는 동안 앱은 이 기계의 data로 그대로 돌고 App details의 Machines 절이 기다리는 것과 이유를 보인다. 모든 기계를 올리는 단추와 updater는 없다. (사람·planner, 정책 10·12, `machine-update`)

## 열린 것

- 실제 두 기계와 실제 바깥 도구로 돌려 보지 않았다. 한 기계에서 data root 둘(개발 core 둘)과 같은 local 폴더로 내보내기, take-in과 동의, 양쪽 row, 같은 row의 다른 칸 양쪽 편집, snapshot 주고받기가 멈춤, 손으로 자른 file(`invalid_file`, 아무것도 적용 안 됨), 한쪽만 새 release(held 복사, data 그대로), 손으로 지운 changes file(snapshot으로 따라옴), 폴더에 id file·secret·host key 없음, 손으로 쓴 미래 clock file(`clock_ahead`가 기계를 말함), 앞당긴 시각의 흔적 정리(떨어진 기계의 자기 변경이 held)를 보았다. 같은 OS 위라 두 기계의 이름이 같았다. 다른 release의 따라가기, held drain, 꼴 판 범위도 두 개발 core가 한 폴더를 나눈 끝에서 끝 확인으로만 보았다(change-log `machine-update`).
- held 한도(128 MiB)에 닿는 경우와 그 뒤 snapshot으로 건너뛰기는 test도 끝에서 끝 확인도 없다(이슈 `folder-held-limit-untested`).
- 영영 올라오지 않는 기계가 옛 release에서 한 변경은 그 기계의 폴더와 다른 기계의 held에만 남는다. 앱을 지우기 전에는 held가 지워지지 않는다.
- 사람이 한 기계에서 이전 release로 돌아가면 그 기계는 다른 기계의 새 release를 다시 따라가지 않고 다른 기계는 내려오지 않는다. 두 기계는 새 release가 나올 때까지 서로의 변경을 held로 둔다. 갈라진 release도 같다(앱 agent가 합친 release가 풀어 준다). 갈라진 동안 다른 기계의 held를 "그 기계가 올라오면 온다"로 보인다(이슈 `machine-update-diverged-held-says-older`).
- agent는 따라가기 상태, held, 기계의 꼴 판 범위를 읽을 길이 없다. `machine/environment`에 그 칸이 없고 `apps/update_state`의 CLI 명령이 없다(이슈 `machine-environment-lacks-update-state`).
- 범위 밖 기계는 그 앱을 쓰는지 몰라 폴더로 맞추는 모든 앱의 Machines 절에 선다(이슈 `machine-update-out-of-range-listed-under-every-app`).
- `update_peer`(그 기계를 올려야 한다)는 모든 기계가 같은 꼴 판(`{1, 1}`)인 지금은 생기지 않는다. 꼴 판(`version`이나 `min_version`)을 처음 올리는 판이 나올 때까지 실제로 보이지 않고, 끝에서 끝 확인은 기록을 손으로 고쳐 `update_this`만 보았다(이슈 `machine-update-update-peer-unreachable`).
- 따라가기의 설치 실패와 거절은 메모리에만 있어 core가 다시 뜨면 다시 한다(`activation.md`).
- 앞선 시계의 snapshot은 미루지 않는다. 미루기는 changes file만 보고 snapshot 합치기는 source의 clock을 그대로 받아 이 기계의 clock이 앞으로 뛴다(이슈 `folder-snapshot-future-clock-not-deferred`).
- destination을 처음 둘 때 내보내기가 다른 기계의 horizon을 읽기 전에 돈다(이슈 `folder-first-export-before-peer-horizon`).
- 떨어져 있음이 끝난 뒤에도 held인 자기 변경이 남는데 `machine.environment`의 `away`는 null이다(이슈 `folder-environment-hides-held-after-away`). 알림의 held 수는 core 메모리라 재시작하면 잊는다(이슈 `folder-away-notice-count-in-memory`).
- 변경 묶음 적용의 답이 시간을 넘기면 invocation이 실패로 닫혀 그 묶음의 effective changeset을 Activity가 잃는다(이슈 `sync-apply-timeout-closes-as-failed`). sync 앱 rewind의 답은 4 KiB 한도다(이슈 `sync-rewind-reply-capped`).
- take-in이 앱을 만든 뒤 release 적기가 실패하면 release 없는 앱이 남는다. 다시 take-in하면 release만 설치한다(이슈 `take-in-leaves-app-without-release`).
- 빚진 지우기 표시가 `folder_reads.error` 칸 안 JSON에 산다(이슈 `folder-absent-pass-mark-in-error-column`).
- `clock_ahead`의 글은 기계 이름만 쓴다. 이름이 겹친 기계끼리는 `details.machine`(id)으로만 가린다.
- destination을 바꿀 Settings 화면이 없다. 사람은 자기 터미널의 `lophn settings set`을 쓴다. harness agent(lophn agent tool call 밖)는 승인을 묻지 못해 늘 `needs_approval`이다.

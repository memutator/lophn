# folder-sync

한 사람의 여러 컴퓨터가 앱 data, release, 앱 source, 기계 기록을 폴더 하나로 주고받는 설계다. 앱 선언의 `sync_to`가 data 동기화 destination 이름(기계마다 local 폴더 경로에 묶인 이름)을 고른다. `sync_to`가 없는 앱도 `private` workspace가 아닌 활성 앱이면 기본 `computers` 갈 곳으로 앱 기록(`app.json`, `sync_to: null`)과 source git bundle 및 `@me/*` package 의존성을 자동 내보내, 다른 컴퓨터에서 바로 들이고(`take-in`) 새 release를 따라간다(data와 `across_machines` event는 `sync_to`가 있는 앱만 동기화한다). 컴퓨터는 `sync_to`가 있는 앱의 변경을 destination 안 자기 하위 폴더에 file로 쓰고, 다른 기계의 하위 폴더에서 file을 읽어 전부 검사한 뒤 한 transaction으로 적용한다. 이름 붙인 폴더를 기계 사이로 옮기는 것은 사람이 고른 바깥 도구(같은 LAN의 Syncthing, rclone `crypt` 위 cloud 등)다. 미리 있는 갈 곳 `computers`("내 컴퓨터들")는 data root 안 폴더이고, 그 file은 lophn이 고른 길(컴퓨터 사이 연결, 폰, 사람이 정한 같이 보는 폴더)로 옮긴다. 낸 기계가 file 목록(manifest)에 명단의 서명 key로 서명하고, 받는 기계는 명단의 컴퓨터가 서명한 목록에 맞는 file만 받는다. 두 번째 기계는 폴더에 온 release를 사람의 동의로 받는다. 앱을 들인 기계는 다른 기계가 낸 새 release를 스스로 따라가고(`activation.md`), 기계마다 앱 release나 lophn 판이 다른 동안 다른 release의 변경은 잃지 않고 두었다가 차례로 적용하며, 폴더 꼴을 서로 읽을 수 없으면 멈추고 누가 올려야 하는지 보인다. agent는 읽기 명령 `machine.environment`로 환경을 읽고, 지침(`design-app` skill의 `folder-sync.md`)을 따라 정책을 고르고 바깥 도구를 붙인다. 사람은 Settings › Sync에서 폴더를 보고 고치고 지금 어느 길로 맞는지 본다. 칸 단위 맞추기 규칙과 sync log는 `app-sync.md`, 기계 id는 `machine.md`, release 활성화와 동의는 `activation.md`가 맡는다.

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

- 목표: 앱마다 선언 하나(`sync_to`)로 data가 가는 길을 고른다. 기계가 아무 순서로 켜지고 꺼져도 사본이 같아지고, 충돌하지 않는 편집은 잃지 않는다. 폴더에서 깨지거나 반만 온 것은 하나도 적용하지 않는다. 사람이 쓴 것은 흔적 정리 때문에 버려지지 않는다. 두 번째 기계는 같은 앱 id로 source를 받아 이 기계에서 직접 release를 준비하고 활성화는 그 기계에서 사람이 동의한다.
- 목표: 다른 release의 변경을 잃지 않고 두었다가 이 기계가 그 release가 되면 차례로 적용한다. 옛 release에서 한 변경은 그 기계가 올라온 뒤의 snapshot으로 온다. 기다리는 동안 앱은 이 기계의 data로 그대로 돈다.
- 목표: lophn 판은 범위로 본다. 범위 안이면 계속 주고받고, 범위 밖이면 그 기계의 file을 열지도 지우지도 않고 멈추며 누가 올려야 하는지 고칠 수 있는 곳에서 말한다.
- 비목표: 실시간 맞추기(분 단위로 늦을 수 있다). 바깥 도구의 설치·설정·이름(code, 의존성, 설정 어디에도 없다. agent가 지침대로 붙인다). lophn이 cloud API를 부르는 길(보류. file 꼴은 폴더든 API든 같은 bytes다). agent 정의·skill·설정·자격 맞추기. 폰이 폴더를 쓰거나 file을 검증·적용하는 것(폰은 `computers`의 file을 내용을 읽지 않고 나르기만 하고, 폰이 쓴 변경은 짝지은 컴퓨터를 거친다). 대량 삭제를 멈추고 묻기, 표·칸별 정책. 충돌을 보이는 화면. 모든 기계를 올리는 단추와 updater(올리기는 각 기계에서 사람이 한다). 옛 release의 변경을 새 schema로 다시 표현하기(폰의 길. 컴퓨터는 자기 DB를 migration하고 덮지 않는 합치기를 받으니 snapshot이 그 일을 한다). 갈라진 release를 합치기(앱 agent가 합쳐 새 release를 낸다, `activation.md`).

## 모델

```
 기계 A                                    destination 폴더(바깥 도구가 옮김)                기계 B
 앱 DB ─ sync log(app_sync_log) ─ 내보내기 ─▶ machines/<A>/apps/<app>/data/<n>.changes|snapshot
                                            machines/<A>/apps/<app>/{app.json, source/}
                                            machines/<A>/record.json
                                            machines/<B>/…  ◀─ B만 쓴다
                         읽기(검사 → 한 tx 적용, 다른 release는 held로 복사) ─▶ B의 앱 DB, B의 sync log(origin machine)
 ledger: folder_streams·folder_written(쓴 것)   folder_reads·folder_held·folder_records(읽은 것)
```

### destination과 `sync_to`

- destination은 기계마다의 설정 `folder.destinations`(`{ "<이름>": { "path": "<절대 경로>" } }`, 이름 `^[a-z][a-z0-9-]{0,31}$`, 16개까지)다. 경로는 기계마다 다르고 설정은 기계를 넘지 않는다. 앱 선언 `sync_to: "<이름>"`은 이름만 고르므로 같은 선언이 경로가 다른 기계에서도 맞는다. 이 기계에 그 이름이 없으면 그 앱은 이 기계에서 내보내지도 읽지도 않는다.
- 거절하는 경로: 상대 경로, data root 안이나 data root를 품은 경로, 다른 이름과 같거나 서로 안에 있는 경로(symlink를 따라간 꼴과 글자 그대로의 꼴 둘 다 본다). 사람이 `settings.json`을 손으로 고쳐 검사를 지나친 값은 없는 것으로 본다. 그 밖의 위험(data root를 network·sync 폴더 위에 두기)은 code가 도구를 모르니 지침이 막는다.
- destination을 더하고 바꾸고 지우는 것은 사람의 승인이다(사람은 Settings › Sync나 자기 터미널의 `lophn settings`에서 직접 바꾼다. 사람 자격이라 승인 카드 없이 바로 바뀌고, 바꾸기 전에 file이 평문으로 나갈 수 있다는 경고를 화면이 보인다). 설정 선언이 `approval: "person"`과 바뀜을 사람의 말로 쓰는 `describe(before, after)`를 갖는다(`settings.md`, `approval.md`). 카드는 `Add sync folder "personal": /home/me/Sync/lophn`처럼 이름과 전체 경로를 보인다.
- `sync_to`가 있는 앱은 컴퓨터에서 sync 앱이다(clock 표와 sync log, `app-sync.md`). 그래서 폰 앱과 같은 schema 규칙과 `@lophn/cap-store` 2.0.0 하한을 release 준비가 본다. `runs_on: ["phone"]`은 `sync_to`를 쓰지 못한다(컴퓨터 사본이 없다).

### 폴더 배치

```
<destination>/machines/<mch_…>/
  record.json                                        기계 기록
  packages (<part>@<version>.json)                   `@me/*` 사용자 package source와 metadata
  apps/<app_…>/app.json                              앱 기록
  apps/<app_…>/data/<n>.changes | <n>.snapshot       data stream (n은 12자리 0 채움, 1부터)
  apps/<app_…>/source/<n>.bundle, <n>.json           증분 git bundle과 그 목록(bundle 뒤에 쓴다)
```

- 기계는 자기 `machines/<자기 id>/` 아래에만 쓰고 남의 하위 폴더는 읽기만 한다. 그래서 lock이 없고 같은 file을 둘이 고치지 않는다.
- 쓰기는 같은 폴더의 `<이름>.tmp-<16 hex>`에 쓰고 rename한다(앞에 점을 붙이지 않는다: 점 file을 건너뛰는 도구가 있다). 번호 붙은 file은 다시 쓰지 않는다.
- 읽는 쪽은 이름이 위 꼴과 정확히 맞는 file만 본다. 충돌 사본, temp, OS file은 없는 것이다. 사라진 file은 "아직 안 옴"이고 local의 무엇도 지우지 않는다.
- 여러 file로 된 것(source)은 목록 file이 각 file의 크기와 sha256을 싣고 마지막에 쓰인다. 목록이 없거나 하나라도 맞지 않으면 "아직 안 옴"이다.

### 내 컴퓨터들(`computers`)과 옮기는 길

```
 기계 A                                <data root>/computers/ (A의 것)          길                     기계 B
 내보내기 ─▶ machines/<A>/… + manifest.json(A가 서명) ─▶ link(carry/*) · 폰(carry/put) · 거울 ─▶ 받는 자리(검증, staging, rename)
                                                                                          ─▶ B의 computers/machines/<A>/… ─▶ 읽기(지금 그대로)
 사람의 폴더(folder.shared): 기계마다 자기 machines/<자기>/만 그대로 복사한다. 남의 것은 받는 자리로 들인다.
```

- **갈 곳.** 앱 선언 `sync_to: "computers"`는 "내 명단의 컴퓨터들"이다. 그 폴더는 `<data root>/computers/`(0700)이고 배치와 file 꼴은 이름 붙인 폴더와 같다. 내보내기와 읽기는 이 폴더를 이름 붙인 destination처럼 쓴다(따로 갈래가 없다). 사람은 `folder.destinations`에 이름 `computers`를 쓰지 못한다. 앱 하나는 갈 곳 하나다(`sync_to`가 하나이고 읽기 cursor가 destination 없이 (앱, 출처)마다라서).
- **누가 쓰나.** 자기 하위 폴더 `machines/<자기>/`는 내보내기만 쓴다. 다른 기계의 하위 폴더는 받는 자리만 쓰고, 그 기계가 서명한 목록에 맞는 file만 쓴다. 그래서 남의 writer 검사(자기 하위 폴더에 자기가 쓰지 않은 file)는 그대로 맞는다.
- **사람의 폴더.** 설정 `folder.shared`(`{path} | null`, 기본 null, 사람 승인, `folder.destinations`와 같은 겹침 검사)는 사람이 고른 "내 컴퓨터들이 같이 보는 폴더"(dual boot의 공유 디스크, Google Drive나 Syncthing이 옮기는 폴더)다. 그 폴더는 `computers` 폴더의 거울이다: 기계마다 자기 `machines/<자기>/`만 그대로 복사하고(지금 목록에 없는 자기 file은 지운다), 다른 기계의 하위 폴더는 받는 자리로 들인다. 읽기는 거울을 바로 읽지 않는다. 서명을 보므로 그 폴더를 믿지 않아도 된다. 사람의 폴더는 누구나 쓸 수 있어 거울이 읽는 양을 줄인다: 서명 key가 없는 기계의 하위 폴더는 열기 전에 건너뛰고, 명단에 없는 기계의 명단 file은 scan마다 4개(`CARRY_UNKNOWN_ROSTER_FILES_MAX`)만 돌아가며 읽어 그 기계 이름의 컴퓨터 항목이 다루는 key의 statement만 명단에 넘기고(아직 믿지 못하는 컴퓨터의 들어오기만 이 길로 온다), 명단에 든 기계의 명단 file은 `computers`에서만 읽는다. 사람의 폴더에서 받는 자리로 들이는 반복도 기계마다 scan에 8번까지다(받은 목록 file이 그 아래 file을 새로 바라므로 사슬 층수만큼 돈다). 거울만 보는 기계가 다른 기계의 file을 받는 것은 그 기계가 직접 거울에 낸 것으로 한정된다(아래 열린 것).
- **목록의 사슬.** 기계의 file 목록은 세 층이다. 층마다 아래 file의 path, 크기, sha256을 싣는다.
  - `machines/<mch>/manifest.json`(서명, 8 MiB까지) = `{body, signature}`, `body = {format: 1, machine, revision, written_at, files: [{path, size, sha256}], packages?: [{path, size, sha256}]}`. `files`는 `record.json`, `roster.json`, 앱마다 `apps/<app>/files.json`을 싣고, 선택 칸 `packages`는 그 기계가 `packages` 하위 폴더에 내놓은 `<part>@<version>.json`을 싣는다(`packages`가 비면 생략한다. 옛 판 2 기계는 모르는 칸을 버리고 원본 canonical `body`로 서명을 검증해 호환된다). path는 destination 기준이고 모두 그 기계의 `machines/<machine>/`로 시작하며 겹치지 않는다.
  - 앱 목록 `apps/<app>/files.json`(8 MiB까지) = `{format: 1, machine, app, written_at, files}`. 싣는 것은 그 앱의 `app.json`, `data/<n>.*`, `source/<n>.json`, `events/<id>.json`이다. data file은 그 앱의 마지막 snapshot과 그 뒤 번호만 싣는다(snapshot이 앞 번호를 다 담는다).
  - `source/<n>.bundle`은 그 `<n>.json`이 싣는다.
  - 받는 쪽은 아래 층 file을 위 층이 기대한 크기·sha256 그대로 든 목록 file이 실을 때만 기대한다. 사슬 하나라도 맞지 않으면 그 아래는 기대하지 않는다.
- **manifest 쓰기(내는 쪽).**
  - manifest와 앱 목록은 내보내기가 쓴 file의 기록(`folder_written` 행과 그 run이 쓴 기록 file)으로 만든다. 폴더를 훑어 만들지 않는다: 쓰는 중에 훑은 목록은 서명된 채 빠진 file이 있어 모든 받는 쪽이 멀쩡한 사본을 지운다.
  - 앱 목록이 싣는 snapshot 뒤 data file이 `CARRY_DATA_FILES_MAX`(2,000)를 넘으면 내보내기가 `computers`에 새 snapshot을 쓴다(30일 compaction을 기다리지 않는다). snapshot을 쓰지 못하는 동안(held인 자기 변경) 목록은 늘어난다.
  - 앱 목록이나 manifest가 8 MiB를 넘게 되면 그 file을 쓰지 않고 지난 것을 둔다. 내는 기계의 그 앱 stream에 오류(`too_large`, 글은 "too many files to carry")를 남겨 `machine.environment`와 App details에 보인다. 받는 쪽은 지난 목록으로 계속 받는다.
  - `revision`은 `max(지난 revision + 1, 지금 ms)`다. 지난 revision은 자기 manifest file의 것과 자기 표시(아래) 가운데 큰 것이다.
  - 서명 bytes는 `utf8("lophn-folder-manifest/1" + "\n" + canonical(body))`이고, key는 그 기계의 명단 서명 key(Ed25519, 명단 항목의 `signing_key`)다. 서명 key가 없으면(remote를 켠 적이 없다) manifest를 쓰지 않는다.
- **받는 쪽 규칙.** 길과 상관없이 받는 자리 하나가 지킨다.
  - 서명자: 이 기계 명단 view에서 `machine`이 manifest의 `machine`인 컴퓨터 항목이 하나뿐일 때 그 서명 key로만 검증한다. 없거나 둘 이상이면(믿는 컴퓨터가 다른 기계 이름을 단 새 key에 서명했다) 그 이름의 manifest는 아무것도 믿지 않는다.
  - 표시: 받아 들인 manifest의 revision은 (그 기계, 그 서명 key)마다 ledger `folder_carry_marks`에 둔다. 하위 폴더 밖이고 지우지 않는다. 믿는 manifest는 그 표시보다 revision이 엄격히 클 때만 그 기계의 지금 목록이 된다(옛 목록으로 돌아가지 않는다). key가 바뀐 기계는 새 key의 표시에서 시작한다.
  - 자기 기계: 자기 manifest와 file은 두지 않는다. 다른 기계가 되돌려 준 자기 manifest가 자기 key로 맞고 자기 표시보다 크면 자기 표시만 올린다(다음 revision이 그보다 크다. data root를 잃고 시계가 틀렸던 기계가 옛 revision에 막히지 않는다).
  - 지금 key: rename 직전과 `wants`·`holds`에서 든 목록 file은 그것을 검증한 서명 key가 지금 `computerSigningKey(machine)`와 같을 때만 센다(명단이 바뀐 뒤의 다시 보기는 뒤늦게 돈다).
  - 다시 보기: 명단 view가 바뀔 때마다 든 manifest를 지금 서명 key로 다시 검증한다. 맞지 않게 된 기계(빼기가 정해지지 않음, 충돌, 같은 이름의 컴퓨터가 둘, key가 바뀜)에서는 새 manifest와 file을 받지 않고 든 file은 두되 누구에게도 내주지 않는다(`carry/*`가 `not_found`로 답한다). 그 기계의 지금 key로 서명한 manifest가 오면 그것이 지금 목록이 된다.
  - file: 그 기계의 지금 목록 사슬이 그 path를 싣고 크기와 sha256이 같을 때만 쓴다. 첫 조각에서 보고, 받는 동안은 `computers` 폴더 밖 staging에 쓰며, rename 직전에 그때의 지금 목록 사슬과 크기·sha256을 다시 견준다(받는 사이 목록이 바뀔 수 있다). 맞지 않으면 쓰지 않고 staging에서 지운다.
  - 지우기: 목록 file(manifest, 앱 목록, `source/<n>.json`) 아래의 file은 그 목록 file의 지금 판을 든 뒤에만, 그 판이 더는 싣지 않는 것만 지운다(compaction, 옛 event). 지금 판을 아직 받지 못한 동안은 앞 판이 싣던 file을 그대로 두고 읽기도 그것을 계속 읽는다: 앱 목록은 내보내기마다 바뀌어, manifest를 받아 들이자마자 지우면 새 앱 목록이 올 때까지 그 앱의 snapshot, data file, source bundle이 없어지고 아직 적용하지 않은 data를 잃는다. 앱 목록이 싣는 가장 새 snapshot이 그 크기·sha256으로 오기 전에는 그보다 앞 번호의 data file도 둔다(snapshot이 큰 file이라 늦게 와도 그 사이 읽기가 앞 변경을 적용한다). 지울지는 한 번 편 사슬로 정하고 그 사이 기다리지 않고 지운다(정하는 사이 새 목록 file이 와도 그것이 싣는 file을 지우지 않는다). 하위 폴더를 통째로 지우는 것은 그 컴퓨터가 정해진 빼기로 명단에서 빠졌고, 그 기계 이름의 컴퓨터가 지금 없고, 그 이름의 정해지지 않은 빼기도 없을 때뿐이다(새 key로 돌아온 기계가 빼기 다툼에 걸려 있으면 지우지 않는다). 그때도 곧바로 지우지 않는다: 그 하위 폴더를 `computers` 폴더 밖 data root로 옮겨 두고(받지도 내주지도 읽지도 않는다) 이 기계가 처음 정해진 것을 본 때부터 7일(`CARRY_REMOVED_GRACE_MS`)이 지나야 지운다. 그 사이 빼기가 풀리면 되돌린다. 도둑의 빼기 하나가 정직한 컴퓨터의 사본을 곧바로 지우지 못하게 하려는 것이다. 이미 적용한 data는 남고, 표시는 지우지 않는다.
  - 이 기계에 없는 앱의 file도 받는다(들이기와 따라가기가 그 기록을 읽는다).
  - `carry/put`의 조각은 부른 기기마다 staging에 두고 file마다 한 번에 하나씩 이어 붙인다(두 기기가 같은 file을 보내도 서로의 조각이 섞이지 않는다). 온 manifest는 입력의 `machine`, `size`, `sha256`이 그 글의 `body.machine`, byte 길이, hash와 같아야 하고, 이 컴퓨터 자신의 것이거나 서명 key가 있는 컴퓨터의 것일 때만 받는다. 아니면 `rejected`다.
- **옮기는 길 셋.** 어느 길로 왔는지는 받는 규칙을 바꾸지 않는다. 같은 file이 여러 길로 와도 같은 path에 한 번 쓰이고 읽기는 지금처럼 번호로 한 번 적용한다.
  - 연결(link): 이 컴퓨터의 core가 명단의 다른 컴퓨터마다 드는 link(`remote.md`)가 그 길이다. 명단의 컴퓨터끼리 붙어 있으면 상대의 manifest 목록(`carry/manifests`: 기계마다 revision, 크기, sha256)을 보고 든 것보다 새 manifest의 글만 `carry/file`로 받아 들인다. 그 뒤 `carry/wants`의 cursor를 따라 믿는 목록이 싣는데 없는 file을 상대에게서 조각으로(`carry/file`, 8 MiB) 받는다. 상대가 다른 기계의 file을 들고 있으면 그것도 받는다. 그래서 늘 켜 둔 기계가 저절로 가운데가 된다. 계기는 link가 붙음, 상대의 `StateChanged{carry_files}`, 이 기계의 같은 신호, 5분 timer다.
  - 폰: 한 컴퓨터에서 manifest와 file을 받아 두었다가 다른 컴퓨터에 붙으면 넘긴다(`carry/put`, 8 MiB 조각, 받는 쪽이 `partial | accepted | have | rejected`로 답한다). 받는 쪽이 바라는 것은 `carry/wants`를 cursor로 끝까지 읽어 안다. 폰은 검증하지 않고 적용하지 않는다. 폰은 짝지은 컴퓨터가 몇이든 나르는 줄 하나로 모든 컴퓨터를 오가고, 화면이 있는 앱만이 아니라 `computers`로 맞추는 모든 앱의 file을 든다. 폰은 목록 file(manifest, 앱 목록, `source/<n>.json`)을 확인용으로 따로 들고 크기·sha256만 맞춰 본다. 상한: file 하나와 드는 양이 256 MiB(넘으면 그 file은 나르지 않고, 드는 양이 넘치면 먼저 받은 것부터 버린다), 나이 30일(event file은 7일), 폰이 아는 모든 컴퓨터가 그 file이 실린 manifest를 갖고 바라지 않으면 지운다. 모바일 데이터로 나를 file의 크기는 폰 Settings의 "Between your computers"(256 KiB, 1 MiB(기본), 8 MiB, 제한 없음)가 정하고 Wi-Fi에서는 상한까지 나른다. 폰 앱이 앞에 있고 컴퓨터에 닿은 동안만 돈다.
  - 거울: 읽기 scan 때 사람의 폴더에 있는 다른 기계의 manifest와 file을 받는 자리에 넘긴다.
  - `carry/wants`는 (machine, path) 글자 순서이고 `after: {machine, path}` 뒤부터 준다. 앞 page의 file을 들지 않은 상대도 다음 page로 간다.
  - 이 route가 없는 상대(옛 lophn)는 `not_found`로 답한다. 나르는 쪽은 그것을 "이 상대는 나르지 않는다"로 보고 다음 계기까지 묻지 않는다.
  - 이 기계가 든 manifest가 바뀌면 `StateChanged{carry_files}`를 낸다. link의 상대와 폰이 그것으로 다시 본다.
- **명단 file.** `machines/<mch>/roster.json` = `{format: 1, machine, written_at, statements}`(8 MiB까지). remote가 켜져 있고 자기 항목이 있는 컴퓨터가 쓴다. 주소(reach)는 싣지 않고, 읽을 때도 statement만 명단에 넘긴다: 폴더는 명단 밖의 누구나 쓸 수 있어, 서명 없는 주소를 받으면 기기들이 거는 곳을 그가 정한다. 주소는 Noise로 확인한 연결로만 온다. 명단 규칙이 서명을 보고 statement를 스스로 거른다(믿는 서명이 없는 statement는 모르는 서명자 상한 안에서만 남고 기기가 되지 않는다). `roster.json`은 manifest가 없어도 받아 명단에 넘긴다: 아직 믿지 못하는 컴퓨터(dual boot의 다른 OS)의 들어오기 statement가 이 길로만 온다. 하위 폴더에 두는 것은 목록에 있을 때만이다.
- **기계를 건너는 event file.** `machines/<mch>/apps/<app>/events/<id>.json`(id는 ULID) = `{format: 2, machine, app, id, code_commit, name, payload, at}`(64 KiB까지). 앱 선언이 그 event에 `across_machines`를 단 것만 쓴다.
  - 난 기계, 앱, id는 path에서 얻는다(서명된 목록이 싣는 것은 path다). 내용의 `machine`, `app`, `id`가 path와 다르면 거절한다. 그래서 믿는 컴퓨터도 자기 하위 폴더에서 다른 기계가 낸 event인 척하지 못한다.
  - `at`이 받는 쪽 시각보다 5분(`CLOCK_AHEAD_MAX_MS`) 넘게 앞서거나 7일보다 옛 것, 이 기계 활성 release와 `code_commit`이 다른 것은 내지 않는다. 쓴 기계는 7일보다 옛 자기 event file을 지운다.
  - 이 기계가 이미 낸 것은 ledger `folder_events_seen`이 들어 여러 길로 와도 한 번만 난다. 그 행은 14일(나이 한도의 두 배)이 지나야 지운다: 행이 지워진 뒤 같은 file이 아직 나이 한도 안일 수 없다.
  - 도착한 기계에서 내는 규칙은 `event.md`다.
- **data가 바뀌었다.** 다른 기계나 폰에서 온 변경을 앱 DB에 적용하면 그 앱 하나에 `lophn`의 event `data.changed`(payload 없음)를 낸다(`event.md`).
- **판.** 기기 연결의 protocol 판은 그대로다(frame과 handshake가 바뀌지 않는다). 나르기를 모르는 상대는 위처럼 `carry/*`에 `not_found`로 답한다. 폴더 꼴 판(`FOLDER_FORMAT`)은 `{version: 2, min_version: 2}`다(release 신분을 `bundle_hash`에서 `code_commit`으로 옮기고 `releases/`를 없애 옛 format 1과 호환되지 않으므로 `min_version`을 올려 옛 판 기계를 `update_peer`로 막는다).

### 변경 file 꼴

```
1행  "lophn-folder 2 <changes|snapshot> <2행 bytes(끝 \n 포함)의 sha256 hex>\n"
2행  header JSON 한 줄(≤ 1 MiB) + "\n"
나머지  payload, 정확히 header.payload.size bytes
```

- header는 `{machine, app, n, kind, release: {code_commit, data_schema}, created_at, payload: {size, sha256}, changes?}`다. `changes` file의 payload는 SQLite session changeset들을 이어 붙인 것이고 `changes[]`가 변경마다 `{id(주인 sync log seq), hlc, origin(computer|device|rewind), operation, started_at, offset, size}`를 싣는다. 변경 하나 ≤ 8 MiB, file 하나 ≤ 1,000개·payload 16 MiB. `snapshot` file의 payload는 그 앱 DB 사본(숨은 clock 표 포함, ≤ 1 GiB)이고 그 stream의 앞 번호 변경을 모두 담는다.
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

- **다른 release의 file(`folder_held`).** 맞는 data file의 `release.code_commit`이 이 기계의 그 앱 활성 release와 다르면 적용하지 않는다. bytes를 크기와 hash를 확인한 뒤 `<data root>/folder-held/<app>/<출처>/<n>.<kind>`(0600)에 temp와 rename으로 그대로 복사하고, 그 뒤 한 transaction에서 `folder_held` 행과 그 출처의 cursor를 둔다. 주인의 compaction이 폴더에서 지워도 잃지 않는다. held는 "적용하지 않았고 잃지 않았다"는 뜻이다. 적용, 지우기, 한도는 아래 "다른 release와 다른 lophn 판"이다.
- **흔적과 부딪을 수 있는 변경(sync log의 `held` 줄).** 아래 horizon 규칙이 내보내지 않거나 적용하지 않은 변경이다. changeset blob과 출처를 쥐고 폰에 보내지 않고 내보내지 않는다. 사람이나 그 앱의 agent가 `apps/sync_held`로 푼다.

### 흔적 정리와 horizon

- `settled`: 기계 M이 앱 기록에 싣는 HLC. M의 그 앱 DB clock이 "내보낼 것이 없고 읽는 모든 출처의 cursor가 그 출처 앱 기록의 `data.head`에 닿은" 마지막 때의 값이다. M은 그 clock 이하의 자기 것을 다 냈고 남이 그때까지 낸 것을 다 받았다는 뜻이다.
- 정리: 컴퓨터는 앱 release마다 core가 뜬 뒤 첫 내보내기와 하루에 한 번, clock이 `max(min(알려진 모든 기계와 자기의 settled), now − 90일)`보다 작은 흔적만 지우고(settled가 없는 기계가 있으면 90일 쪽만) 지운 가장 큰 clock을 `horizon`으로 앱 기록에 싣는다. 알려진 기계는 이 기계가 그 앱의 기록을 가진 기계이고, 사람이 `machine/forget`으로 목록에서 지운 기계는 빠진다(더 큰 revision의 기록을 쓰면 돌아온다).
- horizon 밖: 기계 N의 `settled`가 다른 기계 X의 `horizon`보다 작으면 N은 그 앱에 대해 떨어져 있다(away). 그러면
  - 내보내기는 아직 내보내지 않은 자기 변경 가운데 clock이 X의 horizon 이하인 것을 그 자리에서 `held` 줄로 바꾼다. snapshot을 쓰기 전에는 그 seq까지의 모든 줄에 먼저 이 규칙을 건다.
  - 그 변경은 이 기계의 앱 DB에 그대로 있어 snapshot에 실린다. 그래서 이렇게 held인 자기 변경이 하나라도 풀리지 않았으면 snapshot을 쓰지 않는다. 30일 compaction snapshot은 미루고, snapshot 없이 이을 수 없는 stream(첫 file, release가 바뀜, bytes로 남지 못한 자기 변경)은 `away_too_long`으로 멈춰 사람이 풀기를 기다린다. changes file은 계속 나간다.
  - N은 X를 snapshot으로 따라온다. 합치기는 X의 horizon 이하 clock만 가진 N의 row 가운데 X의 snapshot에 없고 N의 held가 건드리지 않는 것을 지운다(그 사이 다른 곳에서 지워지고 흔적이 정리된 row). 이 지우기는 X의 앱 기록 `read[N].n`이 N의 `data.head`에 닿은 뒤에만 한다: X가 N이 낸 것을 다 받았어야 "X에 없음"이 "지워짐"이다. 닿기 전에는 표시(`owes_absent_pass`)를 남기고 기다렸다가 X의 최신 snapshot을 한 번 더 합친다.
  - 앱의 상태(`machine.environment`의 `away`)와 사람의 알림(`app_sync_away`, `app-notice.md`)이 "이 앱이 너무 오래 떨어져 있었다, 변경 N개가 held다"를 말한다. 떨어져 있음이 끝나거나 사람이 held를 풀면 같은 줄을 "따라잡았다"와 남은 held 수로 바꾼다. `away`는 떨어져 있는 동안과 그 뒤에도 풀리지 않은 held 줄이 남은 동안 서고, 떨어져 있지 않으면 `since`가 null이다. 마지막으로 알린 held 수는 그 앱의 stream 행(ledger)에 두어 core를 다시 켜도 같은 수로 다시 알리지 않는다.
- 풀기(`apps/sync_held`, 사람과 그 앱의 agent): 목록(줄마다 `made_here`와 건드리는 표·종류·때), `apply`, `discard`. 저절로 풀리지 않는다.
  - apply: 이 기계가 낸 변경은 이미 data에 있어 다시 적용하지 않는다. 앱 process가 그 변경이 건드린 row·칸의 지금 값을 새 clock으로 찍고 그것이 보통 변경으로 나간다(사람의 다시 정함). 사라졌거나 뒤 변경이 다시 쓴 row는 뒤 변경이 맡으니 뺀다. 다른 기계나 폰에서 온 변경은 다시 적용하고 지금 data와 부딪으면 `conflict`다.
  - discard: 적용하지도 내보내지도 않고 `resolved_at`을 적는다. bytes는 기록에 남는다. 이 기계가 낸 변경은 이 기계의 data에 남고 변경으로는 나가지 않는다(뒤에 이 기계가 snapshot을 쓰면 그 지금 값이 실린다).

### 미래 clock

받는 쪽 시각 + 5분보다 앞선 변경이 든 changes file과 snapshot은 시각이 따라올 때까지 적용하지 않고 기다린다(`clock_ahead`, 물러나지 않는다). snapshot은 합치기 전에 풀어 둔 file의 sync 상태 clock(`lophn_sync_state.hlc`)을 본다(그대로 합치면 이 기계의 clock이 앞으로 뛴다). 상태의 `details`가 어느 기계(`machine`, `machine_name`)의 시계가 얼마나(`ahead_ms`) 앞섰는지 말한다. 값을 깎지 않는다.

### source와 release 신분

- release의 기계 사이 신분은 `code_commit`(40자리 git commit SHA)과 `data_schema`다. build된 봉인 bundle(`node_modules` 포함)은 OS·아키텍처마다 달라지고 크기도 수천 file이라 폴더로 옮기지 않는다. 각 컴퓨터가 증분 `git bundle`로 source를 받아 자기 OS에 맞게 직접 release를 준비한다.
- source: 기계마다 증분 git bundle이다. 새 commit이 있을 때만, 앞서 낸 heads와 다른 기계에서 받은 것을 빼고 `source/<n>.bundle`을 쓰고 그 뒤 `<n>.json`(heads, prerequisites, size, sha256)을 쓴다. 받는 쪽은 번호 순서로 검사하고 prerequisite가 이 저장소에 있을 때만 `refs/remotes/<mch>/*`로 fetch한다(여러 기계 A → B → C를 거친 prerequisite 사슬도 모든 출처의 bundle을 고정점까지 돌며 받는다). 합치지 않는다. 사람의 branch, HEAD, 작업 tree는 처음 저장소를 만들 때(`main`을 그 release의 commit에 둔다) 말고는 건드리지 않는다. 폴더 안에 bare 저장소를 두지 않는다.

### take-in

- `app.take_in {app, from?, release?}`는 다른 기계가 폴더에 내놓은 앱을 이 기계에 들인다(`release`는 40자리 `code_commit`, 생략하면 출처 기계의 `active_release.code_commit`). 같은 `app_` id로 등록하고(slug가 이미 다른 앱의 것이면 `conflict`), 출처들의 `source/<n>.bundle`에서 목표 commit을 받아 `<data root>/apps/<app>/source` 저장소를 만들거나(이미 있으면 이어 fetch) `app.connect_source`로 이은 뒤, 이 기계에서 release를 직접 준비(`npm install`·build·봉인·검사)해 `prepared` release로 적는다. 이미 들인 앱이면 앱 행을 건드리지 않고 source를 이어 받아 그 commit의 release만 준비한다(같은 `code_commit`의 release가 이미 있으면 그것을 돌려준다).
- `@me/*` 사용자 package: 내보내기는 `sync_to`가 있는 앱의 활성 release commit이 고정한 `@me/*` version(과 그 package가 의존하는 `@me/*` version)을 catalog의 bundle·guide blob과 함께 `machines/<mch>`의 `packages` 하위 폴더에 `<part>@<version>.json`(8 MiB까지)으로 쓴다(`computers`에서는 `manifest.json`의 선택 칸 `packages`로 싣고 link·폰·사람의 폴더 세 길로 그대로 나른다). `take-in`(과 따라가기)은 commit이 기대는 `@me/*` version이 이 기계에 없으면 다른 기계들의 `packages` 하위 폴더에서 먼저 찾아 의존 순서대로 들인다: `bundle_hash`·`guide_hash`·안전한 상대 경로·내부 `@lophn/cap-*`와 `@me/*` permission 덮기를 검사한 뒤 자기 catalog(`package.register_version`, 불변 규칙 적용)에 등록하고 설치 사본을 쓴다. 따라가기는 package file이 source보다 늦게 도착해 `dependency_missing`으로 멈췄더라도 새 package file이 들어오거나 local에 등록되면 자동으로 다시 시도한다.
- grant, 동의, secret, OAuth, invocation 기록, 앱 data는 옮기지 않는다. 활성화는 이 기계의 `release.activate`이고 첫 활성화는 이 기계에서 사람에게 동의를 묻는다(`activation.md`). data는 활성화 뒤 data stream으로 온다.
- `conflict`의 `details.reason`: `sdk_missing`(이 lophn에 commit이나 `@me/*` package가 고정한 `@lophn/*` SDK 판이 없다. 폴더에서 온 code를 이 기계의 SDK 저장소에 넣지 않는다), `slug_in_use`, `dependency_missing`(`details.packages`, 이 기계에도 없고 다른 기계의 폴더에서도 찾지 못한 `@me/*` package), `preparing`(같은 앱의 release 준비가 이미 돌고 있다). 목표 commit이 담긴 source bundle이 아직 다 오지 않았으면 `invalid_input`에 `details.reason: source_incomplete`다.
- 앱을 등록한 뒤 release 준비가 실패하면 오류 글이 앱이 release 없이 더해졌다고 말하고, release가 없는 그 앱은 들일 수 있는 앱(`available`)에 계속 선다. 다시 take-in하면 release만 준비한다.
- `app.create`에서 앱 id를 고를 수 있는 것은 사람과 폴더 take-in 자격(`machine:folder-apps`)뿐이다. agent와 그 밖의 machine 자격은 고르지 못한다.

### 기계 기록과 환경

- 기계 기록 `record.json`: `{format, machine, revision, updated_at, name, always_on, addresses: {lan, port, relay}, lophn: {version, protocol: {version, min_version}, folder: {version, min_version}}, projects: [{identity, remote_key, separated}]}`. 주소는 `remote.enabled`일 때만 싣는다. `projects`는 이 기계의 active git project 가운데 remote key가 있는 것(512개, key 256자까지)이고 내 다른 컴퓨터가 같은 저장소의 project를 같은 id로 맞추는 데 쓴다(`project-identity.md` "자동 match"). 이름, 경로, url은 싣지 않고, 이 칸이 없는 옛 기록은 빈 목록이다. 공개 key, pairing code, binding, 자격은 싣지 않는다. destination마다 같은 내용으로 하나씩 쓰고, project 목록이 바뀌면 다시 쓴다. 읽는 쪽은 기계마다 가장 큰 `revision`을 남기고, 한 기계의 기록을 읽다 실패하면 옛 사본을 그대로 둔다. `lophn.folder`가 범위 밖인 기계의 file은 읽지 않는다(`newer_format`, 아래 "다른 release와 다른 lophn 판").
- 앱 기록 `app.json`: `{format: 2, machine, app, revision, updated_at, slug, name, description, sync_to, active_release: {code_commit, data_schema, created_at} | null, data: {head, snapshot}, source: {head}, read: {<mch>: {n, at}}, settled, horizon}`.
- 읽는 쪽의 cursor, held, 남의 기록 사본은 그 기계 ledger 표(`folder_reads`, `folder_held`, `folder_records`)에 두고 행마다 그 기계 id를 적는다. 다른 기계 id가 적힌 행(복제된 data root에서 온 것)은 없는 것이다.
- 읽기 명령 `machine.environment`(route `machine/environment`, actors user·agent, workspaces home·app)는 이 기계, 알려진 기계(이름이 겹치면 `display_name`이 `이름 (id 끝 6자)`), destination 상태, 앱마다 내보내기·읽기·`away`, 들일 수 있는 앱을 돌려준다. 기계마다 폴더 꼴 판 범위(`exchange`), 앱마다 `apps/update_state`와 같은 따라가기(`follow`), held, 기계별 release(`machines`)도 실어 agent가 따라가기와 기다리는 변경을 읽는다(폴더로 맞추지 않는 앱은 `follow`가 null이고 둘은 빈 목록). 오류 code는 `destination_missing`, `not_writable`, `foreign_writer`, `invalid_file`, `newer_format`, `too_large`, `clock_ahead`, `apply_failed`, `app_not_running`, `away_too_long`이다.
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
  - `computers`로만 온 release는 들이되(take-in) 늘어난 권한이 없어도 activation이 사람의 동의를 기다린다(기존 동의 카드). 같은 release를 이름 붙인 폴더도 내놓거나 그 release를 낸 컴퓨터를 이 컴퓨터가 터미널 입력으로 허락했으면 지금처럼 묻지 않는다. 이유: 따라가기는 다른 기계의 code를 사람이 준 권한으로 이 컴퓨터에서 돌리는 일이고, `computers`의 file은 연결과 폰으로도 온다. 명단의 컴퓨터(도둑맞은 노트북 포함)가 이것으로 이 컴퓨터에서 code를 돌리면 안 된다. 허락은 이 컴퓨터의 표라 명단의 컴퓨터가 스스로 켤 수 없다(아래 열린 것).
- **drain 순서.** 이 기계의 활성 release가 held의 release가 되면, 출처마다 그 release의 held를 번호 순서로 stream과 같은 적용 길로 적용하고 하나가 성공할 때마다 그 행과 사본을 지운다. 그 출처의 stream은 지금 release의 held를 다 적용한 뒤에만 읽는다: cursor가 held 뒤에 있어 먼저 읽으면 순서가 뒤집힌다. 하나가 실패하면 그 출처는 그 행에서 멈추고 다음 계기에 같은 행부터 한다.
- **snapshot이 덮은 held.** 출처 X의 snapshot m이 합쳐지거나 held가 되면 같은 transaction에서 X의 m보다 옛 held를 지운다. snapshot m은 m 앞의 변경을 다 담기 때문이다(폴더 꼴의 계약). 그 밖에 held가 없어지는 길은 이 기계가 그 release가 되어 적용했을 때와 앱을 이 기계에서 지웠을 때뿐이다.
- **옛 release의 변경.** 주인의 release가 바뀐 뒤 내는 첫 file은 snapshot이다. 그래서 늦게 올라온 기계가 옛 release에서 한 변경은 따로 다시 표현하지 않고 그 snapshot을 칸 clock으로 합칠 때 온다. 이것이 맞으려면 migration 뒤에도 칸 clock이 남아야 해서, 앱 process가 뜰 때 칸 clock을 칸 이름으로 새 번호에 옮긴다(`app-sync.md`). 다른 destination에 쓰는 사이 진짜 폴더에 빈 번호가 생겨도 그 snapshot이 빈 곳을 덮어 읽는 쪽은 그 번호로 건너뛴다.
- **왜 기다리나(`why`).** held 한 줄(출처와 release마다)은 `diverged`(이 기계의 따라가기가 갈라졌고 그 release의 held다. 앱 agent가 두 release를 합친 release가 나와야 온다), `older_release`(이 기계가 지금보다 먼저 들인 release이거나 data schema가 낮다. 그 기계가 올라오면 snapshot으로 온다), `newer_release`(그 밖. 이 기계가 그 release가 되면 적용된다. 사람이 이전으로 돌아가 내려놓은 release도 여기다) 차례로 정한다.
- **한도.** 출처 하나·앱 하나에서 가장 새 held snapshot 뒤의 held changes 합이 128 MiB를 넘을 file은 복사하지 않고 폴더에 둔다(`full`). 그 출처의 stream은 거기서 멈추고, 폴더에 그 출처의 더 뒤 snapshot이 있으면 그리로 건너뛴다(snapshot이 앞을 담는다). 이 기계가 그 release에 오면 멈춘 cursor부터 폴더에서 읽고, 그 사이 주인이 compaction했으면 지금 규칙대로 뒤의 snapshot으로 따라온다. 128 MiB는 한 release의 changeset 합 한도와 같다: 그보다 많으면 출처의 snapshot 하나가 더 싸다.
- **꼴 판 범위.** 기계마다 쓰는 꼴 판과 읽는 하한(`FOLDER_FORMAT {version, min_version}`)을 기계 기록의 `lophn.folder`에 싣는다(없는 옛 기록은 `{1, 1}`). 상대의 `version`이 내 `version`보다 크거나 내 `version`이 상대의 `min_version`보다 낮으면 이 기계를 올려야 하고(`update_this`), 상대의 `version`이 내 `min_version`보다 낮거나 내 `version`보다 낮으면 그 기계를 올려야 한다(`update_peer`). 제품 판 글(`lophn.version`)은 보이기만 하고 판정에 쓰지 않는다. 꼴 판은 옛 판이 읽으면 틀리게 되는 바꿈에만 올리고 칸을 더하는 것은 올리지 않는다(위 "변경 file 꼴").
- **범위 밖 기계.** 기계 기록은 읽어 두고(누가 올려야 하는지 보이려고) 앱 기록은 건너뛴다. 그 기계의 data·source·release file을 열지도 복사하지도 지우지도 않으며 cursor도 그대로다. 읽기 오류는 `newer_format`이고 `details.exchange`가 누가 올릴지다. 다시 범위 안이 되면 그 cursor부터 잇는다. Machines 절에는 범위 밖이 되기 전에 읽은 그 기계의 앱 기록 사본이 있는 앱 아래에만 선다(사본이 하나도 없으면 폴더로 맞추는 모든 앱 아래에 선다).
- **보이는 곳.** App details의 Machines 절(`apps/update_state`)이 기계마다 release, 이 기계의 따라가기 상태, 기다리는 변경 수와 이유, 범위 밖 안내를 보인다: "Needs an update here: N changes from <기계> wait for it"(snapshot만 기다리면 "the latest data from <기계> waits"), "<기계> is on an older release; its changes arrive when it updates", "<기계>'s changes arrive after the app's agent combines the two releases"(갈라짐), "More from <기계> wait in the folder"(한도), "Update lophn on this computer to exchange with <기계>", "<기계> runs an older lophn. Update it on that machine.", 그리고 "While changes wait, the app keeps running on this computer's data." 올리는 단추는 없다.

### 계기와 물러남

- 내보내기와 앱 기록·release·source 쓰기: 앱마다 sync log가 바뀐 뒤 5초 debounce, 5분 timer, destination 설정이 바뀜, 활성 release가 바뀜(활성화, take-in), core 시작. core 시작과 destination 바뀜 뒤의 첫 내보내기는 읽기 scan이 다른 기계의 기록 사본(horizon)을 읽은 뒤에 돈다(사본 없이 내보내면 hold 규칙이 다른 기계의 horizon을 몰라 떨어져 있던 변경이 그대로 나간다). scan이 실패하면 다음 scan 뒤로 미룬다.
- 읽기: destination의 `machines/`와 다른 기계의 하위 폴더를 폴더마다 감시(2초 debounce)하고 2분 timer. 새 폴더는 다음 scan이 감시에 더한다.
- (앱, destination)·(앱, 출처 기계)마다 한 번에 하나이고, 한 번에 64 MiB까지 다룬다. 더 남으면 바로 이어 돈다. 실패한 일은 1분부터 두 배씩 1시간까지 물러난다. `clock_ahead`는 물러나지 않는다. 사람이 held를 풀거나 내보내기를 다시 켜면 물러남을 지우고 바로 돈다. 이 일들은 idle-exit를 막지 않는다.

## 지키는 것

1. 기계는 destination 안 자기 `machines/<자기 id>/` 아래에만 쓴다. 남의 file을 지우거나 고치지 않는다. 하나뿐인 예외는 `computers` 폴더의 받는 자리다: 다른 기계의 하위 폴더에 그 기계가 서명한 지금 목록 사슬에 맞는 file만 쓰고, 그 사슬에서 빠진 file과 정해진 빼기로 빠진 컴퓨터의 하위 폴더만 지운다. 사람의 폴더에는 자기 하위 폴더만 쓴다. 자기 하위 폴더에 자기가 쓰지 않은 file이 보이면 내보내기를 멈추고 사람이 다시 켤 때까지 쓰지 않는다.
2. 읽은 file은 전부 검사한 뒤에만 쓴다. 변경 file 하나는 앱 DB transaction 하나이고 cursor는 같은 단위로 오른다. 깨지거나 반만 온 file에서는 아무것도 적용하지 않고 그 번호에서 기다린다. 여러 file로 된 release와 source는 목록 file과 모든 file이 맞을 때만 쓴다.
3. 실패한 읽기와 사라진 file은 아무것도 지우지 않는다. 다른 기계의 기록 사본은 한 기계의 기록이 모두 읽혀야 바뀐다.
4. 기계 id file(`machine.json`)과 그 binding, `secrets.json`의 값, remote host key는 폴더에 없다. 기계 기록은 공개 key, pairing code, binding, 자격을 싣지 않는다.
5. 같은 release(같은 `code_commit`)끼리만 적용한다. 다른 release의 file은 data root에 그대로 복사해 held로 둔다.
6. 폰은 폴더를 쓰지 않고 file을 검증하거나 적용하지 않는다. 폰이 나르는 file은 받는 컴퓨터가 검증한다. 폰이 쓴 변경(row)은 짝지은 컴퓨터가 받아 그 컴퓨터의 변경처럼 내보낸다.
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
21. 다른 기계의 file은 명단 view에서 그 `machine`의 하나뿐인 컴퓨터가 서명한 manifest에서 시작한 목록 사슬이 그 path를 싣고 크기·sha256이 같을 때만 `computers` 폴더에 쓰인다. 첫 조각과 rename 직전에 본다. 어느 길로 왔는지는 이 판정을 바꾸지 않는다.
22. 받는 쪽은 (기계, 서명 key)마다 받아 들인 가장 큰 revision을 하위 폴더 밖에 두고 지우지 않는다. 그보다 크지 않은 revision은 받지 않는다.
23. 반쯤 받은 file은 읽기에 보이지 않는다(staging에 쓰고 맞으면 rename한다).
24. 하위 폴더를 통째로 지우는 것은 정해진 빼기로 빠졌고 그 이름의 정해지지 않은 빼기가 없는 컴퓨터의 것뿐이고, 처음 그것을 본 때부터 7일 동안 읽기 밖에 치워 두었다가 지운다. 목록 file 아래의 file은 그 목록 file의 지금 판을 든 뒤 그 판이 싣지 않는 것만 지우고, 앱 목록의 가장 새 snapshot이 오기 전에는 그 앞 번호의 data file을 둔다. 빼기가 정해지지 않았거나 충돌인 컴퓨터는 새것을 받지 않되 든 것은 둔다. 이미 적용한 data는 남는다.
25. 기계를 건너는 event는 한 기계에서 한 번만 난다. 난 기계·앱·id는 path의 것이다.
26. 폴더로 온 명단 file은 statement만 명단에 넘긴다. 주소는 폴더로 오가지 않는다.
27. 내는 쪽은 manifest와 앱 목록을 쓴 file의 기록으로 만든다. 목록이 한도를 넘으면 쓰지 않고 내는 기계에 오류를 보인다.

## 경계와 계약

- boundary `folder`(내보내기·읽기·앱 기록·take-in·환경, 폴더 꼴과 상태 schema, 다른 release의 held·drain·한도, 꼴 판 범위, `computers` 폴더의 받는 자리·manifest 쓰기·사람의 폴더 거울·명단 file·event file·지금 길 읽기 `carry/status`), `remote`(명단의 컴퓨터마다 드는 link가 `carry/*`로 file을 받는 나르기), `remote-protocol`(manifest와 목록 사슬의 계약, `carry/*` route, 기기 route 목록), `mobile`(폰의 나르기와 Settings의 크기 선택), `events`(`data.changed`, `StateChanged{carry_files}`), `shell`(Settings › Sync), `agent-workspaces`(내장 skill `connect-computers`), `app-sync`(sync core의 snapshot 합치기·흔적 정리·held, sync log의 origin `machine`과 `held` 줄), `app-runtime`(앱 process의 file 적용·합치기·정리·다시 찍기 control, 칸 clock 옮기기), `apps`(take-in 등록, `sync_held`), `app-releases`(따라가기와 `apps/update_state`), `config`·`approvals`(설정의 사람 승인).
- 선언: `sync_to`(`@lophn/declaration` 4.10.0이 `computers`와 `across_machines`를 더했다. 지금 판은 `@lophn/declaration` 4.12.0, `@lophn/app-ui` 2.23.0, `@lophn/app-ui-native` 1.9.3). 설정: `folder.destinations`(`approval: "person"`).
- route와 CLI: `machine/environment`(read, `lophn machine environment`), `machine/forget`(memory, 사람만, `lophn machine forget`), `apps/take_in`(command `app.take_in`, user·agent, `lophn app take-in`), `apps/sync_held`(memory, 사람과 그 앱의 agent, `lophn app sync-held <app> list|apply|discard [seq]`), `apps/sync_resume`(memory, 사람, `lophn app sync-resume`). `app_sync/pull`의 `origin`에 `machine`.
- 앱 process control: `sync_apply`(변경 묶음 1~1,000개·16 MiB), `snapshot_merge`, `sync_cleanup {before} → {dropped, horizon, max_hlc}`, `sync_reapply`.
- route(기계 사이로 옮기기, actors user. 앞의 넷은 기기 route 목록에 있어 연결의 컴퓨터와 폰이 부르고, `carry/status`는 목록 밖이라 사람의 화면만 부른다): `carry/manifests`(read, `{}` → `{manifests: [{machine, revision, size, sha256}]}`), `carry/wants`(read, `{limit?, after?: {machine, path}}` → `{files: [{machine, path, size, sha256}]}`, (machine, path) 순서, 1,000개까지), `carry/file`(file, `{machine, path, offset, length}`, 8 MiB까지. 들고 지금 목록이 싣는 file과 든 `machines/<mch>/manifest.json`만, 아니면 `not_found`), `carry/put`(memory, `{machine, path, size, sha256, offset, bytes}` → `{status}`, path `machines/<mch>/manifest.json`은 manifest). `carry/status`(read, `{}` → `{shared: {path, state} | null, machines: [{machine, revision, received_at, via}], apps: [{app, name, sync_to, read_at}]}`. 받은 때와 길(`link`·`phone`·`folder`)은 메모리에만 있어 core를 다시 띄우면 비고, Settings › Sync가 읽는다). 바뀜 이름 `carry_files`. 설정 `folder.shared`. 내장 skill `connect-computers`(home만. 같이 보는 폴더나 Tailscale을 사람과 함께 붙이는 지침이고 lophn이 둘 다 설치하지는 않는다). event `data.changed`(발행자 `lophn`). 선언 칸 `events[].across_machines`.
- 폴더(기계 사이): `manifest.json`(서명 문맥 `lophn-folder-manifest/1`), `apps/<app>/files.json`, `roster.json`(statement만), `apps/<app>/events/<id>.json`. data root의 `computers/`(0700)와 받는 staging.
- 저장: ledger schema step `apps.sync-log.machine`(sync log 다시 만들기: origin `machine`, 칸 `machine`, kind `held`, 칸 `resolved_at`), `folder.tables`(`folder_streams`, `folder_written`, `folder_reads`, `folder_held`, `folder_records`), `folder.away-notified`(`folder_streams.away_notified`: 떨어져 있음 알림에 마지막으로 쓴 held 수), `folder.events-seen`(`folder_events_seen`: 이 기계가 이미 낸 다른 기계의 event), `folder.carry-marks`(`folder_carry_marks`: (기계, 서명 key)마다 받아 들인 가장 큰 manifest revision), `folder.code-commit`(`folder_streams`·`folder_reads`에 `code_commit` 추가, `folder_held`를 `code_commit` 기준으로 다시 만들기, `folder_written`에서 옛 `release` 행 정리), `apps.event-publications.machine`(`app_event_publications.machine`: 다른 기계에서 온 event를 낸 기록의 난 기계). data step은 없다. data root의 `folder-held/`. 앱 DB 숨은 표 `lophn_sync_kept`와 `lophn_sync_state`의 `horizon`.
- notice kind `app_sync_away`(`app-notice.md`).
- `folder_held` 행: 이 기계, 앱, 출처, 번호, 종류, `code_commit`, data schema, 크기. 앱 DB 숨은 표 `lophn_sync_columns`(표마다 마지막으로 본 칸 이름 목록).
- 폴더: 기계 기록 `lophn: { version, protocol, folder: { version, min_version } }`. data file header의 `release.code_commit`·`data_schema`.
- 읽기: `apps/update_state {app}`(memory, 사람과 그 앱 workspace의 agent. `follow`, `held: [{machine, code_commit, data_schema, changes, bytes, full, why: newer_release | older_release | diverged}]`, `machines: [{machine, name, this_machine, lophn_version, exchange, release}]`). 폴더 읽기 오류 `newer_format`의 `details: { machine, exchange: update_this | update_peer }`.
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
- 다른 기계에서 온 일(snapshot 합치기, 결과 모르는 받은 변경)의 '다시 snapshot' 줄은 origin `machine`(칸 `machine`은 출처, `change_id`는 그 invocation)이고 내보내기가 건너뛴다. 그 줄은 폰을 위한 것이다(합친 변경은 clock이 여럿이라 pull 줄 하나가 될 수 없다). 이유: 그 data는 출처 기계가 이미 냈고, 건너뛰지 않으면 두 기계가 서로의 snapshot을 합칠 때마다 snapshot을 주고받는다. 이 기계가 낸 크거나 결과 모르는 자기 write는 여전히 snapshot을 부른다. (agent, 두 기계 test에서 찾음)
- hold 규칙은 내보내지 않은 줄을 그 자리에서 `held`로 바꾸고, snapshot 앞에는 내보내지 않은 모든 줄에 먼저 건다. held인 자기 변경이 풀리지 않은 동안은 snapshot을 쓰지 않는다: compaction은 기다리고, snapshot 없이 이을 수 없는 stream은 사람이 apply나 discard할 때까지 `away_too_long`으로 멈춘다. changes file은 계속 나간다. 이유: held인 자기 변경은 앱 DB에 그대로 있어 snapshot으로 새어 나간다. 막지 않으면 hold가 무의미하고, 대신 snapshot에서 그 row를 빼면 snapshot이 "그 번호까지의 모든 것"이 아니게 된다. 대가: 떨어졌던 기계는 그 사이 release를 바꾸면 사람이 풀 때까지 내보내지 못한다. (agent, 두 기계 test에서 찾음)
- 이 기계가 낸 held 변경의 apply는 다시 적용하지 않고 지금 값을 새 clock으로 찍어 보통 변경으로 보낸다. discard는 data를 이 기계에 두고 보내지 않는다(뒤에 이 기계가 snapshot을 쓰면 지금 값이 실린다). 다른 기계나 폰에서 온 변경은 DB에 다시 적용한다. 이유: 자기 변경은 이미 data에 있어 다시 넣으면 늘 부딪고, 옛 clock 그대로 보내면 받는 쪽 horizon의 그물에 다시 걸린다. (agent, 두 기계 test에서 찾음)
- 떨어져 있음 알림은 앱마다 한 줄이고 떨어져 있음이 끝나거나 held가 줄면 같은 줄을 "따라잡았다"와 남은 수로 바꾼다. program 줄은 지울 수 없어서다(`app-notice.md`). (agent)
- 앱 id는 기계 사이 같다. release의 기계 사이 신분은 `code_commit`이다. 처음에는 봉인 bundle(`releases/<bundle_hash>/files/`, `node_modules` 포함)을 그대로 옮기고 `bundle_hash`를 신분으로 삼았으나, OS·아키텍처마다 native dependency와 경로 대소문자·정규화 충돌이 생기고 수천 file을 매번 옮기는 비용이 컸다. 이제 증분 `git bundle`(`source/<n>.bundle`)만 옮기고 받는 컴퓨터가 자기 OS에서 직접 release를 준비하며 `code_commit`으로 같은 release를 알아본다(`FOLDER_FORMAT`은 `{2, 2}`로 올려 옛 format 1 피어를 `update_peer`로 막는다). take-in은 이미 들인 앱이면 source를 이어 받고 그 commit의 release만 준비한다(`machine-update`의 따라가기가 같은 함수를 부른다). (사람, 2026-11-19 뒤집음)
- SDK 사본은 따로 싣지 않고, 받는 기계의 lophn에 없는 SDK 판을 고정한 release는 `conflict`(`sdk_missing`)다. 이유: 폴더에서 온 code가 그 기계의 SDK 저장소에 들어가지 않는다. (planner)
- `@me/*` 사용자 package는 앱 폴더 밖 `machines/<mch>`의 `packages` 하위 폴더에 `<part>@<version>.json`으로 `package.publish`가 만든 source bundle·guide blob과 metadata를 내보내고, `manifest.json`의 선택 칸 `packages`로 싣는다. 이유: package는 여러 앱이 공유하고 version마다 불변이라 목록 사슬 한 층을 더 만들지 않아도 되고, `files` 대신 선택 칸 `packages`에 두면 `FOLDER_FORMAT` `{2, 2}`를 올리지 않고도 옛 판 기계와 서명 검증이 깨지지 않는다. 받는 쪽은 bundle 경로 탈출·hash·permission 덮기·불변을 다시 검사해 catalog에 등록한 뒤 설치 사본을 만든다. (agent)
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
- 앱 선언의 미리 있는 갈 곳 `computers`("내 컴퓨터들")는 data root 안 폴더이고, 그 file을 다른 컴퓨터로 옮기는 길은 lophn이 고른다(연결, 폰, 사람의 폴더). 이름 붙인 폴더는 지금 그대로 남는다. 이유: 폴더로 주고받는 꼴이 이미 앱 들이기부터 흔적 정리까지 다 하므로, 길마다 꼴을 따로 만들지 않고 그 file을 옮기는 길만 늘린다. (사람: "길은 lophn이 고른다", planner)
- 낸 기계가 file 목록에 명단의 서명 key로 서명하고, 받는 기계는 명단의 컴퓨터가 서명한 목록에 맞는 file만 받는다. 이유: file이 폰, 다른 컴퓨터, cloud 폴더를 거쳐도 고치거나 바꿔치지 못한다. (planner)
- manifest는 기록 file과 앱마다 목록 file 하나만 싣고, 앱 목록이 그 앱의 file을, `source/<n>.json`이 source bundle을 싣는다. 앱 목록의 data file은 마지막 snapshot부터이고 그 뒤가 2,000을 넘으면 snapshot을 일찍 쓴다. 이유: 1분에 한 번 바뀌는 앱도 한 달이면 한 목록이 8 MiB에 닿아 그 기계의 모든 것이 멈춘다. 버린 안: 한도에 닿으면 받는 쪽이 조용히 거절하기. (planner, review)
- revision은 `max(지난 것 + 1, 지금 ms)`다. 내는 쪽은 다른 기계가 되돌려 준 자기 manifest의 revision도 지난 것으로 본다. 이유: 늘기만 하고, data root를 잃었고 그 전 시계가 앞서 있었어도 되돌려 받은 것보다 크다. (planner, review)
- 받는 쪽의 revision 표시는 (기계, 서명 key)마다 하위 폴더 밖 ledger에 두고 지우지 않는다. 이유: 하위 폴더에 두면 그 폴더를 지운 뒤 옛 manifest를 되살려 넘겨도 받고, 기계마다 하나면 한 번 새거나 바뀐 key의 큰 revision이 그 기계를 영영 막는다. (review)
- 서명자는 명단 view에서 그 기계 이름의 하나뿐인 컴퓨터다. 둘 이상이면 아무것도 믿지 않는다. 이유: 명단 규칙은 다른 key가 같은 기계 이름을 다는 것을 충돌로 보지 않아, 믿는 컴퓨터(도둑맞은 노트북, 새 초대장)가 다른 기계의 file을 대신 낼 수 있었다. (review)
- 하위 폴더는 정해진 빼기에만 통째로 지운다. 이유: 빼기 다툼이나 충돌은 도둑의 빼기 하나로도 생기고, 그때 지우면 큰 snapshot과 release를 다시 받아야 하고 아직 적용하지 않은 file을 잃는다. (review)
- 폴더로 온 명단 file은 주소를 넘기지 않는다. 이유: 폴더는 명단 밖의 누구나 쓸 수 있고 주소는 서명이 없다. (review)
- 기기 연결의 protocol 판을 올리지 않는다. 이유: frame과 handshake가 바뀌지 않고, 하한을 올리면 옛 폰과 컴퓨터가 화면·터미널·명단까지 다 끊긴다. 나르기를 모르는 상대는 `carry/*`에 `not_found`로 답한다. (lead, review)
- 사람의 폴더에는 자기 하위 폴더만 쓴다. 이유: 남의 하위 폴더를 쓰면 그 주인의 바깥 도구와 같은 file을 둘이 고치고, 주인이 compaction으로 지운 file이 되살아나 남의 writer 검사에 걸린다. (planner)
- `roster.json`은 manifest 없이도 받는다. 이유: 아직 믿지 않는 컴퓨터(dual boot의 다른 OS)의 들어오기 statement가 이 file로만 오고, statement가 스스로 서명되어 있다. (planner)
- 서명은 받은 body 그대로의 canonical 글에 대해 본다(모르는 칸을 버리기 전). 이유: 뒤 판이 body에 칸을 더해도 서명이 깨지지 않는다. (agent)
- 폰은 받은 file을 읽지 않고 나른다. 그래서 폰에 화면이 없는 앱의 file도 나르고, 폰이 서명을 확인하지 않는다. 폰이 든 file이 틀려도 받는 컴퓨터의 검사가 막는다. 나르는 줄은 컴퓨터가 몇이든 하나이고, 모바일 데이터로 나를 file의 크기는 사람이 폰에서 정한다(기본 1 MiB). 이유: 짝지은 컴퓨터마다 줄을 따로 두면 같은 file을 컴퓨터 수만큼 든다. 버린 안: 폰이 file을 검증하거나 폴더에 쓰기(폰에 서명 확인과 폴더 규칙이 두 벌이 된다). (사람: "폰을 hub로 쓸 수도 있게", planner)
- Settings › Sync는 지금 길을 보이기만 하고 길을 고르는 설정은 두지 않는다. 이유: 길은 lophn이 고른다. 보이는 것은 폴더(이름 붙인 폴더와 같이 보는 폴더의 상태), 컴퓨터(연결이 있는지, 마지막으로 file이 온 길과 때), 앱(다른 기계의 변경을 마지막으로 읽은 때)이다. 컴퓨터의 마지막 길과 때는 메모리에만 있어 core를 다시 띄우면 빈다. (agent)
- 바깥 도구(같이 보는 폴더의 Google Drive나 Syncthing, 밖에서 붙기 위한 Tailscale)는 lophn이 설치하지 않고 home의 agent가 내장 skill `connect-computers`로 사람과 함께 붙인다. 이유: lophn 안에 도구를 넣으면 그 도구의 자격과 계약을 lophn이 져야 한다. (사람, 2026-11-17)

## 열린 것

- 실제 두 기계와 실제 바깥 도구로 돌려 보지 않았다. 한 기계에서 data root 둘(개발 core 둘)과 같은 local 폴더로 내보내기, take-in과 동의, 양쪽 row, 같은 row의 다른 칸 양쪽 편집, snapshot 주고받기가 멈춤, 손으로 자른 file(`invalid_file`, 아무것도 적용 안 됨), 한쪽만 새 release(held 복사, data 그대로), 손으로 지운 changes file(snapshot으로 따라옴), 폴더에 id file·secret·host key 없음, 손으로 쓴 미래 clock file(`clock_ahead`가 기계를 말함), 앞당긴 시각의 흔적 정리(떨어진 기계의 자기 변경이 held)를 보았다. 같은 OS 위라 두 기계의 이름이 같았다. 다른 release의 따라가기, held drain, 꼴 판 범위도 두 개발 core가 한 폴더를 나눈 끝에서 끝 확인으로만 보았다(change-log `machine-update`).
- held 한도(128 MiB)에 닿는 경우와 그 뒤 snapshot으로 건너뛰기는 test(한도를 작게 넣는다)로만 보았고 끝에서 끝 확인은 없다.
- 영영 올라오지 않는 기계가 옛 release에서 한 변경은 그 기계의 폴더와 다른 기계의 held에만 남는다. 앱을 지우기 전에는 held가 지워지지 않는다.
- 사람이 한 기계에서 이전 release로 돌아가면 그 기계는 다른 기계의 새 release를 다시 따라가지 않고 다른 기계는 내려오지 않는다. 두 기계는 새 release가 나올 때까지 서로의 변경을 held로 둔다. 갈라진 release도 같다(앱 agent가 합친 release가 풀어 준다).
- `machine.environment`의 따라가기·held·꼴 판 칸은 `design-app`의 folder-sync 지침에 아직 적지 않았다(앱 agent가 읽는 지침이라 SDK 메모가 든다).
- 범위 밖이 되기 전에 읽은 앱 기록이 없는 기계는 폴더로 맞추는 모든 앱의 Machines 절에 선다.
- `update_peer`(그 기계를 올려야 한다)는 `FOLDER_FORMAT` `{2, 2}`에서 옛 `{1, 1}` 기계와 만날 때 생기며, 판정 표는 test가 다섯 경우를 본다.
- 따라가기의 설치 실패와 거절은 메모리에만 있어 core가 다시 뜨면 다시 한다(`activation.md`).
- 빚진 지우기 표시가 `folder_reads.error` 칸 안 JSON에 산다. 그 칸을 읽고 쓰는 곳이 import 하나라 칸을 나누는 schema step은 folder 표를 다음에 고칠 때 같이 한다(이슈 `folder-absent-pass-mark-in-error-column`, kept).
- `clock_ahead`의 글은 기계 이름만 쓴다. 이름이 겹친 기계끼리는 `details.machine`(id)으로만 가린다.
- 기계 사이로 옮기기는 실제 두 기계와 바깥 폴더 도구(Google Drive, Syncthing, dual boot의 공유 디스크)로는 돌려 보지 않았다. 자동 test는 가짜 link와 가짜 받는 자리, 한 폴더를 나눈 data root 둘로만 본다.
- 앱 목록의 data file을 줄이는 이른 snapshot은 큰 앱 DB에서 무겁다(5초마다 바뀌는 앱은 몇 시간마다 snapshot이다). held인 자기 변경이 있는 동안은 snapshot을 쓰지 못해 목록이 한도에 닿을 수 있고, 그때는 내는 기계에 오류가 선다.
- 명단 규칙은 다른 key가 같은 기계 이름을 다는 것을 아직 충돌로 보지 않는다. 받는 쪽은 그 이름을 믿지 않는 것으로 막지만, 사람에게는 그 기계가 멈춘 것만 보인다.
- 나르는 쪽이 목록을 내놓지 않고 버티는 것은 받는 쪽이 알 수 없다(늦어질 뿐이다).
- harness agent(lophn agent tool call 밖)는 destination과 `folder.shared`를 바꾸는 승인을 묻지 못해 늘 `needs_approval`이다. 사람은 Settings › Sync나 자기 터미널의 `lophn settings set`으로 바꾼다.
- `computers`로만 온 release는 그 release를 낸 컴퓨터를 이 컴퓨터가 터미널 입력으로 허락하지 않았으면 늘 사람의 동의를 기다린다(`followAsksPerson`). 허락한 컴퓨터(그 기계의 컴퓨터 항목이 명단에 하나뿐이고 그 key가 이 컴퓨터의 `remote_grants`에 있다. `ctx.computerGranted`)의 release와 이름 붙인 폴더로 온 release는 묻지 않고 따라간다. 허락은 명단 항목의 값이 아니라 이 컴퓨터의 표라(컴퓨터가 자기 항목에 그 허락을 스스로 서명할 수 있고 받은 항목에 컴퓨터마다 저절로 같이 서명해 명단 view로는 "이 컴퓨터의 사람이 허락했다"를 가를 수 없다. 이슈 `roster-computer-self-grants-terminal-input`) 도둑맞은 노트북이 앱 code로 이 컴퓨터에서 돌 수 없다. 이 컴퓨터가 허락하지 않은 컴퓨터는 늘 묻는다.
- 사람의 폴더(거울)에는 각 기계가 자기 하위 폴더만 쓴다. 거울만 보는 기계는 다른 기계의 file을 그 기계가 직접 거울에 낸 것으로만 받아, link나 폰이 그 기계에 닿아야 나머지가 간다.
- `computers`로 맞추는 앱의 data와 source bundle은 data root 안에 한 번 더 복사된다(그 폴더가 data root 안이다).
- 폰은 상한(256 MiB)보다 큰 file(큰 snapshot, 큰 source bundle)을 나르지 못한다. 그런 것은 link나 거울로만 간다. 모바일 데이터에서 크기 선택 때문에 건너뛴 새 file은 폰이 따로 기억하지 않는다. Wi-Fi로 돌아와도 폰이 다시 찾지 않고, 다른 컴퓨터가 그 file을 바란다고 알려 올 때 가져온다.
- 폰의 지우는 규칙은 폰이 저장한 컴퓨터만 센다. 폰이 아직 저장하지 않은 명단의 컴퓨터는 센 수에 들지 않아 그 컴퓨터가 아직 받지 못한 file을 폰이 일찍 지울 수 있다.
- key가 맞지 않게 된 컴퓨터의 하위 폴더에는 든 file이 남아 있어, 사람이 그 컴퓨터를 `from`으로 골라 `app.take_in`하는 것은 막지 않는다. 활성화는 그래도 사람의 동의를 묻는다.
- `carry/file`은 기기 자격이면 누구에게나 `computers`로 맞추는 모든 앱의 file을 내준다. 짝지은 폰이 명단의 컴퓨터가 낸 앱 data와 source bundle을 모두 읽을 수 있다.
- 이름 붙인 폴더에는 manifest가 없어 그 폴더의 event file은 서명으로 막히지 않는다. 그 폴더를 쓸 수 있는 누구나 다른 기계가 낸 event인 척하는 file을 둘 수 있다(난 기계는 path에서 읽을 뿐이다). `computers`의 event file은 manifest 사슬이 싣는다.

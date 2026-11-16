# folder-sync-releases

폴더로 맞추는 앱(선언의 `sync_to`)을 두 기계가 다른 release나 다른 lophn 판으로 돌릴 때의 설계다. 한 기계가 앱의 새 release를 내면 다른 기계는 그 release를 따라갈 때까지 새 release의 변경을 적용하지 못하고, 늦게 올라온 기계가 옛 release에서 한 변경도 잃으면 안 된다. lophn 판이 다르면 폴더의 꼴을 서로 읽을 수 있는지에 따라 계속 주고받거나 멈추고 누가 올려야 하는지 보인다. 폴더로 옮기기와 file 꼴 자체는 폴더 sync 문서(`folder-sync.md`), 새 release를 따라가는 activation은 `activation.md`, 칸 단위 합치기는 `app-sync.md`가 맡는다.

## 문제

- 기계 X가 앱의 release r2(migration으로 칸을 더함)를 내고 그 release로 쓴 변경은 r1을 돌리는 기계 Y의 DB에 맞지 않는다. 버리면 X의 변경을 잃고, 억지로 적용하면 Y의 DB가 깨진다.
- Y가 r1에서 같은 row의 다른 칸을 고쳤다. Y가 r2로 올라간 뒤에도 그 고침이 X에 남아야 한다. migration이 칸 번호를 바꾸면서 칸 clock을 잃으면 늦게 올라온 Y의 칸 고침이 X의 더 옛 값에 진다.
- 기다리는 변경이 끝없이 쌓이면 data root가 찬다. 영영 올라오지 않는 기계도 있다.
- 두 기계의 lophn 판이 다르면 폴더의 꼴을 서로 틀리게 읽을 수 있다. 칸 하나 더할 때마다 모든 기계가 멈추면 한 기계를 올리는 것이 나머지를 막는다. 판이 맞지 않는데 말없이 멈추면 사람은 무엇을 해야 하는지 모른다.

## 목표와 비목표

- 목표: 다른 release의 변경을 잃지 않고 두었다가 이 기계가 그 release가 되면 차례로 적용한다. 옛 release에서 한 변경은 그 기계가 올라온 뒤의 snapshot으로 온다. 기다리는 동안 앱은 이 기계의 data로 그대로 돈다.
- 목표: lophn 판은 범위로 본다. 범위 안이면 계속 주고받고, 범위 밖이면 그 기계의 file을 열지도 지우지도 않고 멈추며 누가 올려야 하는지 고칠 수 있는 곳에서 말한다.
- 비목표: 모든 기계를 올리는 단추, updater. 올리기는 각 기계에서 사람이 한다.
- 비목표: 옛 release의 변경을 새 schema로 다시 표현하기(폰의 길). 컴퓨터는 자기 DB를 migration하고 덮지 않는 합치기를 받으니 snapshot이 그 일을 한다.
- 비목표: 갈라진 release를 합치기. 앱 agent가 합쳐 새 release를 낸다(`activation.md`).

## 모델

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

- **held.** 다른 기계의 data file 가운데 header의 release(bundle hash)가 이 기계의 활성 release와 다른 것은 적용하지 않고 data root에 그대로 복사해 둔다(크기와 hash를 확인한 뒤 temp와 rename, 0600). 그 뒤 한 transaction에서 held 행과 그 출처의 cursor를 둔다. held는 "적용하지 않았고 잃지 않았다"는 뜻이다.
- **drain 순서.** 이 기계의 활성 release가 held의 release가 되면, 출처마다 그 release의 held를 번호 순서로 stream과 같은 적용 길로 적용하고 하나가 성공할 때마다 그 행과 사본을 지운다. 그 출처의 stream은 지금 release의 held를 다 적용한 뒤에만 읽는다: cursor가 held 뒤에 있어 먼저 읽으면 순서가 뒤집힌다. 하나가 실패하면 그 출처는 그 행에서 멈추고 다음 계기에 같은 행부터 한다.
- **snapshot이 덮은 held.** 출처 X의 snapshot m이 합쳐지거나 held가 되면 같은 transaction에서 X의 m보다 옛 held를 지운다. snapshot m은 m 앞의 변경을 다 담기 때문이다(폴더 꼴의 계약). 그 밖에 held가 없어지는 길은 이 기계가 그 release가 되어 적용했을 때와 앱을 이 기계에서 지웠을 때뿐이다.
- **옛 release의 변경.** 주인의 release가 바뀐 뒤 내는 첫 file은 snapshot이다(폴더 꼴의 규칙). 그래서 늦게 올라온 기계가 옛 release에서 한 변경은 따로 다시 표현하지 않고 그 snapshot을 칸 clock으로 합칠 때 온다. 이것이 맞으려면 migration 뒤에도 칸 clock이 남아야 해서, 앱 process가 뜰 때 칸 clock을 칸 이름으로 새 번호에 옮긴다(`app-sync.md`). 다른 destination에 쓰는 사이 진짜 폴더에 빈 번호가 생겨도 그 snapshot이 빈 곳을 덮어 읽는 쪽은 그 번호로 건너뛴다.
- **왜 기다리나(`why`).** held 한 줄(출처와 release마다)은 `newer_release`(이 기계가 그 release가 되면 적용된다. 사람이 이전으로 돌아가 내려놓은 release도 여기다)나 `older_release`(이 기계가 지금보다 먼저 들인 release이거나 data schema가 낮다. 그 기계가 올라오면 snapshot으로 온다)다.
- **한도.** 출처 하나·앱 하나에서 가장 새 held snapshot 뒤의 held changes 합이 128 MiB를 넘을 file은 복사하지 않고 폴더에 둔다(`full`). 그 출처의 stream은 거기서 멈추고, 폴더에 그 출처의 더 뒤 snapshot이 있으면 그리로 건너뛴다(snapshot이 앞을 담는다). 이 기계가 그 release에 오면 멈춘 cursor부터 폴더에서 읽고, 그 사이 주인이 compaction했으면 지금 규칙대로 뒤의 snapshot으로 따라온다. 128 MiB는 한 release의 changeset 합 한도와 같다: 그보다 많으면 출처의 snapshot 하나가 더 싸다.
- **꼴 판 범위.** 기계마다 쓰는 꼴 판과 읽는 하한(`FOLDER_FORMAT {version, min_version}`)을 기계 기록 `record.json`의 `lophn.folder`에 싣는다(없는 옛 기록은 `{1, 1}`). 상대의 `version`이 내 `version`보다 크거나 내 `version`이 상대의 `min_version`보다 낮으면 이 기계를 올려야 하고(`update_this`), 상대의 `version`이 내 `min_version`보다 낮거나 내 `version`보다 낮으면 그 기계를 올려야 한다(`update_peer`). 제품 판 글(`lophn.version`)은 보이기만 하고 판정에 쓰지 않는다.
- **모르는 칸.** 기록과 header는 모르는 칸을 버리고 읽는다. 꼴 판은 옛 판이 읽으면 틀리게 되는 바꿈에만 올린다. 칸을 더하는 것은 올리지 않는다.
- **범위 밖 기계.** 기계 기록은 읽어 두고(누가 올려야 하는지 보이려고) 앱 기록은 건너뛴다. 그 기계의 data·source·release file을 열지도 복사하지도 지우지도 않으며 cursor도 그대로다. 읽기 오류는 `newer_format`이고 `details.exchange`가 누가 올릴지다. 다시 범위 안이 되면 그 cursor부터 잇는다.
- **보이는 곳.** App details의 Machines 절(`apps/update_state`)이 기계마다 release, 이 기계의 따라가기 상태, 기다리는 변경 수와 이유, 범위 밖 안내를 보인다: "Needs an update here: N changes from <기계> wait for it"(snapshot만 기다리면 "the latest data from <기계> waits"), "<기계> is on an older release; its changes arrive when it updates", "More from <기계> wait in the folder"(한도), "Update lophn on this computer to exchange with <기계>", "<기계> runs an older lophn. Update it on that machine.", 그리고 "While changes wait, the app keeps running on this computer's data." 올리는 단추는 없다.

## 지키는 것

1. 다른 release의 변경은 적용하거나 held로 두거나 폴더에 남긴다. 말없이 버리지 않는다. held를 지우는 것은 적용했을 때, 같은 출처의 더 뒤 snapshot이 덮을 때, 앱을 이 기계에서 지울 때뿐이다.
2. 한 출처의 변경은 번호 순서로 적용된다. 지금 release의 held가 남은 출처의 stream은 읽지 않는다.
3. held의 복사와 그 행·cursor는 따로 commit되지만, 복사 뒤 행 전에 꺼지면 다음 번에 같은 bytes를 다시 쓴다. 크기와 hash가 header와 맞는 file만 held가 된다.
4. migration 뒤 칸 clock은 칸 이름을 따라간다. 이름이 없어진 칸과 표의 clock만 지운다. 그래서 옛 release에서 고친 칸이 snapshot으로 와도 clock으로 맞춰진다.
5. 출처 하나·앱 하나의 held changes는 가장 새 held snapshot 뒤로 128 MiB를 넘지 않는다. 넘을 것은 폴더에 남는다.
6. 꼴 판이 범위 밖인 기계의 data·source·release file은 열지도 복사하지도 지우지도 않고 cursor를 움직이지 않는다. 누가 올려야 하는지를 보인다.
7. 기다리는 동안 앱은 이 기계의 data로 돈다. 기다림이 앱을 멈추지 않는다.

## 경계와 계약

- boundary `folder`(held, drain, 한도, 꼴 판 범위), `app-runtime`(앱 process의 칸 clock 옮기기, 변경 적용과 snapshot 합치기), `app-releases`(따라가기와 `apps/update_state`).
- 저장: data root의 `folder-held/<app>/<origin>/<n>.<kind>`(받은 file 그대로)와 ledger 표 `folder_held`(이 기계, 앱, 출처, 번호, 종류, release, data schema, 크기). 앱 DB의 숨은 표 `lophn_sync_columns`(표마다 마지막으로 본 칸 이름 목록).
- 폴더: 기계 기록 `lophn: { version, protocol, folder: { version, min_version } }`. data file header의 `release.bundle_hash`·`data_schema`.
- 읽기: `apps/update_state {app}`(memory. `follow`, `held: [{machine, bundle_hash, data_schema, changes, bytes, full, why}]`, `machines: [{machine, name, this_machine, lophn_version, exchange, release}]`). 폴더 읽기 오류 `newer_format`의 `details: { machine, exchange: update_this | update_peer }`.
- 한도 상수: held 128 MiB(한 release의 changeset 합 한도와 같다).

## 결정

- 새 release의 변경은 이 기계가 그 release가 되면 출처마다 번호 순서로 적용하고, 그 출처의 stream은 held를 다 적용한 뒤에 잇는다. 이유: cursor가 held 뒤에 있어 먼저 읽으면 순서가 뒤집힌다. (사람·planner, `machine-update`)
- 출처 X의 snapshot m이 합쳐지거나 held가 되면 X의 그보다 옛 held를 지우고, 그 밖에는 지우지 않는다. 이유: snapshot m은 m 앞의 변경을 다 담는다. (planner, `machine-update`)
- 옛 release에서 한 변경은 그 기계가 올라온 뒤의 첫 snapshot을 clock으로 합칠 때 온다. 버린 안: 폰처럼 backup, 허브 snapshot 받기, outbox를 칸 이름으로 다시 표현하기(폰은 자기 DB를 허브의 snapshot으로 바꾸기 때문에 그 길이 있다. 컴퓨터는 자기 DB를 migration하고 덮지 않는 합치기를 받는다). (planner, 코드)
- migration 뒤 칸 clock을 지우지 않고 칸 이름으로 옮긴다. 이유: 지우면 늦게 올라온 기계의 칸 고침이 먼저 올라간 기계에서 진다. (planner, 코드)
- held 한도는 출처·앱마다 가장 새 held snapshot 뒤 128 MiB이고, 넘으면 폴더에 두고 뒤의 snapshot으로 따라온다. 이유: 그보다 많으면 snapshot 하나가 더 싸다. (planner)
- lophn 판은 범위로 본다(폴더는 꼴 판 `[min_version, version]`). 제품 판 글은 보이기만 한다. 이유: 같은 build를 요구하면 한 기계를 올릴 때 나머지가 멈춘다. (사람·planner, 정책 11)
- 범위 안에서는 모르는 칸을 버리고 계속 주고받고, 꼴 판은 옛 판이 틀리게 읽는 바꿈에만 올린다. 이유: 칸 하나 더할 때마다 모든 기계가 멈추면 안 된다. (planner)
- 범위 밖이면 그 기계의 file을 열지도 복사하지도 지우지도 않고 cursor도 그대로이며, 올려야 하는 기계는 "Update lophn on this computer", 다른 기계는 "<이름> runs an older lophn"을 보인다. 이유: 고칠 수 있는 곳에서 고칠 것을 말한다. (planner)
- 기다리는 동안 앱은 이 기계의 data로 그대로 돌고 App details의 Machines 절이 기다리는 것과 이유를 보인다. 모든 기계를 올리는 단추와 updater는 없다. (사람·planner, 정책 10·12)

## 열린 것

- 두 개발 core가 한 폴더를 나눈 끝에서 끝 확인으로만 보았다(change-log `machine-update`). 실제 두 기계와 바깥 동기화 도구(Syncthing, rclone)는 보지 못했다.
- 한도(128 MiB)에 닿는 경우와 그 뒤 snapshot으로 건너뛰기는 test도 끝에서 끝 확인도 없다(이슈 `folder-held-limit-untested`).
- 영영 올라오지 않는 기계가 옛 release에서 한 변경은 그 기계의 폴더와 다른 기계의 held에만 남는다. 앱을 지우기 전에는 held가 지워지지 않는다.
- 사람이 한 기계에서 이전 release로 돌아가면 그 기계는 다른 기계의 새 release를 다시 따라가지 않고 다른 기계는 내려오지 않는다. 두 기계는 새 release가 나올 때까지 서로의 변경을 held로 둔다. 갈라진 release도 같다(앱 agent가 합친 release가 풀어 준다). 갈라진 동안 다른 기계의 held를 "그 기계가 올라오면 온다"로 보인다(이슈 `machine-update-diverged-held-says-older`).
- agent는 따라가기 상태, held, 기계의 꼴 판 범위를 읽을 길이 없다. `machine/environment`에 그 칸이 없고 `apps/update_state`의 CLI 명령이 없다(이슈 `machine-environment-lacks-update-state`).
- 범위 밖 기계는 그 앱을 쓰는지 몰라 폴더로 맞추는 모든 앱의 Machines 절에 선다(이슈 `machine-update-out-of-range-listed-under-every-app`).
- `update_peer`(그 기계를 올려야 한다)는 모든 기계가 같은 꼴 판(`{1, 1}`)인 지금은 생기지 않는다. 꼴 판(`version`이나 `min_version`)을 처음 올리는 판이 나올 때까지 실제로 보이지 않고, 끝에서 끝 확인은 기록을 손으로 고쳐 `update_this`만 보았다(이슈 `machine-update-update-peer-unreachable`).
- 따라가기의 설치 실패와 거절은 메모리에만 있어 core가 다시 뜨면 다시 한다(`activation.md`).

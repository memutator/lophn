# app-sync

폰에서 도는 앱(선언의 `runs_on`에 `phone`이 든 앱)의 설계다. backend와 data가 폰에 있어 컴퓨터가 꺼져도 폰에서 읽고 쓰고, 컴퓨터에 닿으면 폰의 사본과 컴퓨터의 사본이 같아진다. 컴퓨터가 hub이고 ledger의 순서 있는 sync log가 두 사본의 변경을 이어 준다. 폰의 write는 컴퓨터에 닿을 때 invocation이 되어 Activity와 rewind에 든다. 앱의 호출 경로와 기록은 `app-call.md`, 폰 화면과 guest runtime은 `phone-screen.md`, 폰 gate와 폰 앱은 `remote.md`, release가 바뀌는 순간은 `activation.md`, 앱 SDK 판은 `package.md`가 맡는다.

## 문제

- 폰 화면이 컴퓨터의 backend를 remote로 부르면(`phone-screen.md`) 컴퓨터가 꺼지거나 닿지 않을 때 앱이 열리지 않는다. 캘린더와 메모처럼 사람이 폰으로 늘 쓰는 앱은 컴퓨터 없이 읽고 써야 한다.
- 폰과 컴퓨터가 각자 data를 쓰면 두 사본이 갈라진다. 같은 row의 다른 칸을 양쪽에서 고쳐도 한쪽 변경이 지워지면 안 되고, 닿은 뒤 두 사본이 같아야 한다.
- 폰에서 한 write도 사람의 data 변경이다. 컴퓨터의 Activity에 보이고 rewind가 덮어야 한다. 폰의 호출이 기록 없이 data만 바꾸면 "모든 호출은 core가 기록한다"가 깨진다.
- 폰에서 도는 backend는 AI가 쓴 code다. 폰 앱의 key와 다른 file과 network에 닿으면 안 되고, data file을 깨거나 sync가 쓰는 숨은 표를 건드려 맞추기를 망가뜨리면 안 된다.
- release가 바뀌면 폰에는 옛 schema의 data와 컴퓨터에 아직 안 간 변경이 있다. 이것을 잃으면 사람이 폰에서 쓴 data를 잃는다. 폰에만 있는 앱의 data는 다른 사본도 없다.

## 목표와 비목표

- 목표: 선언의 `runs_on` 하나로 앱이 어디서 도는지 가른다. 폰의 read와 write는 컴퓨터에 닿을 때도 늘 폰에서 돈다. 두 사본은 칸 단위 last-write-wins로 같아진다. 폰의 write는 컴퓨터에서 invocation이 된다. 컴퓨터에 안 간 변경과 폰에만 있는 앱의 data는 지우지 않는다.
- 비목표: iOS(내려받은 code로 앱 기능을 바꾸는 것과 native API를 내주는 것은 Apple 지침 2.5.2와 4.7.2에 걸려 사람이 Apple에 물어야 한다). 컴퓨터가 꺼진 동안 relay가 변경을 맡아 두는 것(그래서 폰 둘은 컴퓨터를 거쳐서만 맞고, 컴퓨터가 꺼진 동안은 맞지 않는다). 충돌을 보이는 화면. background sync(폰 앱이 앞에 있고 컴퓨터에 닿은 동안만 맞춘다). 폰에서 도는 앱의 위젯, 홈 화면 아이콘, 폰 기능. 폰에서 network, secret, 알림, event 발행, command, agent, job. 폰에만 있는 앱 data의 backup. core가 Hermes bytecode를 만드는 것(아래 결정의 fallback).

## 모델

```
선언 runs_on ─ ["computer"]            remote: backend와 data는 컴퓨터(phone-screen.md)
             ├ ["computer","phone"]    sync: 컴퓨터와 폰이 각자 data를 갖고 맞춘다. 컴퓨터가 hub
             └ ["phone"]               standalone: 폰에만 있다

 release 준비 ─▶ release bundle: phone/backend.js + backend.json + migrations/
                    │  apps/phone_file(manifest가 적은 file만)
                    ▼
 폰 host(신뢰) ── app.sqlite(data, clock, outbox) ◀─ 같은 SQLite 라이브러리 ─▶ 그 앱 화면의 guest
   │ 설치·push·pull·release 바뀜                       base | backend | screen, 호출 하나가 transaction 하나
   ▼
 app_sync/push ─▶ 컴퓨터: 적용(칸 단위 LWW)과 invocation ─▶ app_sync_log ─ app_sync/pull ─▶ 다른 폰
 app_sync/snapshot(+snapshot_file) ◀─ 컴퓨터 DB의 사본(처음 설치, release 바뀜)
```

- **`runs_on` 셋.** 값은 `["computer"]`(없을 때의 기본), `["computer","phone"]`, `["phone"]`의 정규 꼴뿐이다. `phone`이 있으면 `phone` 자리의 화면이 하나 있어야 한다(폰에서 backend를 부르는 것은 폰 화면뿐이다). `["phone"]`은 command, 구독, `external` operation, widgets, 폰 밖 자리의 화면을 선언하지 못한다(live에서 그것을 돌릴 곳이 없다). 화면으로 짐작하지 않고 칸 하나로 정한다.
- **폰 backend bundle.** release 준비가 앱의 `main`을 plain JS 한 file(`phone/backend.js`, 즉시 실행 함수, es2015, minify, 4 MiB 한도)과 manifest(`phone/backend.json`: 크기, sha256, data schema 판, migration file 목록과 hash, operation별 effect, 묶인 SDK 판)로 묶는다. SDK는 Node 내장이 없는 폰 entry로 풀린다. migration SQL은 bundle에 넣지 않고 release의 `migrations/` file 그대로 두어 폰 host가 돌린다. 폰은 `apps/phone_file`로 manifest가 적은 file(backend, manifest, migration)만 받고 `apps/phone_screens`의 항목이 `runs_on`과 manifest를 싣는다.
- **release 검사.** `runs_on`에 `phone`이 있는 앱만 준비가 다음을 하고 어기면 agent가 읽고 고칠 영어 한 줄로 실패한다. 폰 bundle에 `node:` import와 Node 내장 이름(`fs` 같은 것)과 `@lophn/cap-fs`·`@lophn/flow`가 없다. 짓고 나서 빈 context(child process 안의 `vm`)에 폰과 같은 host prelude만 깔고 실어 선언한 handler(operation, command, 구독 handler)를 정확히 등록하는지 본다. 빈 DB를 target schema까지 올린 scratch DB에서 폰 schema 규칙(정수 PK, AUTOINCREMENT, trigger, PK 밖의 UNIQUE와 CHECK 없음)을 본다. 선언이 `@lophn/cap-store` 2.0.0과 `@lophn/cap-tool` 2.2.0 이상을 고정했다(그 밑 판에는 폰 entry가 없다). 앱 code는 core process 밖의 짧은 child에서만 돈다.
- **어디서 도나.** 폰의 backend는 그 앱 화면의 guest runtime 안에서 돈다. guest는 base, backend, 화면 bundle을 이 순서로 싣고, base가 backend가 평가되기 전에 host(호출을 하나씩 돌리는 handler port, 앱 DB driver, random, 늘 `unavailable`로 답하는 network 통로)를 깐다. 화면의 operation 호출은 선언의 effect로 갈린다. read와 write는 컴퓨터에 닿을 때도 늘 guest 안에서 돈다. `external`만 host로 가서 컴퓨터로 간다. 갈림이 컴퓨터 유무에 따라 바뀌지 않아 길이 하나이고 online과 offline이 같게 동작한다.
- **호출 하나는 transaction 하나.** guest의 호출은 한 번에 하나씩 `BEGIN IMMEDIATE`로 열리고, 끝나면 native module이 그 호출의 changeset을 같은 transaction 안에서 숨은 `lophn_sync_outbox`에 한 줄(변경 id, operation, 시작 시각, changeset)로 쓰고 commit한다. 던진 handler가 바꾼 것도 같이 남는다. 호출이 3초 안에 끝나지 않으면 rollback하고 `unavailable`이다. read가 쓴 변경도 outbox에 남아 같이 간다(말없이 갈라지는 것보다 낫다). 컴퓨터 쪽도 같은 규칙이다: sync 앱의 write는 data, changeset, clock 찍기를 앱 process 안의 transaction 하나로 commit한다.
- **폰의 SQLite.** 폰 앱의 주 runtime(host)과 앱 화면의 guest가 우리 작은 native module의 같은 SQLite 라이브러리로 같은 file을 연다. 한 process에서 SQLite 사본 둘이 한 file을 열면 lock이 깨지기 때문이다. guest의 연결은 host가 file 하나에 묶는다. ATTACH와 `VACUUM INTO`, extension 싣기, 숨은 `lophn_sync_*` 표 접근, 둘째 handle, trigger 만들기, 호출 안의 `BEGIN`·`COMMIT`을 거절하고 5초 넘는 statement를 끊는다. SQLite는 공식 amalgamation 3.53.3을 손대지 않고 sha256으로 고정해 둔다.
- **칸 단위 last-write-wins.** 모든 사본은 hybrid logical clock(63 bit 정수 하나: 시각, 같은 시각의 순번, node 몫)을 쓴다. 변경을 적용할 때 row마다 한 줄(마지막 insert나 delete의 clock)과, insert 뒤에 바뀐 칸만의 칸 clock을 본다. UPDATE는 들어온 clock이 그 칸의 clock(없으면 row clock)보다 클 때만 그 칸을 쓴다. 그래서 한 row의 다른 칸을 양쪽에서 고쳐도 둘 다 남는다. delete는 그 row의 마지막 insert나 delete보다 새로울 때만 적용되고 delete된 row에 온 UPDATE는 버려진다(delete가 이긴다). 없는 row의 INSERT는 묘비보다 새로울 때만, 있는 PK의 INSERT는 모든 칸의 UPDATE다. 비교는 엄격히 크다: 같은 변경을 두 번 받아도 그대로다. 들어온 변경은 changeset을 그대로 적용하지 않고 칸 이름으로 만든 SQL로 적용한다(`foreign_keys`를 끄고 한 transaction 안에서). 제약에 걸린 변경 하나는 건너뛰고 나머지를 이어 간다.
- **hub와 sync log.** 컴퓨터는 앱마다 순서 있는 sync log(ledger 표 `app_sync_log`)를 쥐고 폰은 자기 cursor(받은 마지막 번호)를 쥔다. core는 기기마다의 상태를 두지 않는다. log의 한 줄은 컴퓨터의 write, 폰에서 온 변경, rewind, 또는 "다시 snapshot"이고, changeset은 invocation이 이미 쥔 blob을 가리킨다. 다른 기기에는 원래 changeset과 그 clock을 보낸다(적용한 뒤의 실제 변경(effective)만 보내면 값이 같은 update가 clock만 움직이고 사라져 다른 폰의 clock이 어긋난다).
- **폰의 write가 컴퓨터에서 invocation이 되는 길.** `app_sync/push`는 폰의 변경을 256개·10 MiB 안에서 차례로 보낸다(변경 하나는 8 MiB 이하). 받은 컴퓨터는 앱의 write 줄을 잡고 invocation 하나를 연다: operation 이름과 시작 시각은 폰의 값, caller는 `{kind: person, view_session: <폰의 변경 id>, device: <기기 id>}`, effect는 `write`. 앱 process가 변경을 칸 단위 규칙으로 적용하며 실제로 바뀐 것(effective changeset)을 뜨고, 그것이 invocation의 changeset이 되어 Activity와 rewind가 덮는다. 같은 기기의 같은 변경 id는 한 번만 적용된다(`duplicate`). 제약에 걸려 건너뛴 변경은 `skipped`로 답하고 폰이 outbox에서 지운다. 컴퓨터는 log에 줄을 쓰고 `AppSyncChanged`를 낸다.
- **폰의 sync.** 폰 host가 한다. push는 clock이 없는 outbox 줄에 clock을 commit 순서로 찍고(write는 outbox 줄과 같이 commit되고 clock은 나중에 찍힌다) 컴퓨터가 답한 줄만 outbox에서 지운다. pull은 cursor 뒤를 받아 묶음마다 transaction 하나에서 "찍기, 적용, cursor 올리기"를 하고 도중에 실패하면 cursor가 그대로다. 들어온 변경은 guest 호출 사이에만 적용된다(`busy_timeout`). 계기는 local 변경, 연결됨, `AppSyncChanged`, 목록 읽기다. 폰 앱이 앞에 있고 그 컴퓨터에 닿은 동안만 돈다.
- **컴퓨터 node의 기계 표지.** 컴퓨터의 sync 앱 DB는 `lophn_sync_state`에 node를 처음 적은 기계의 id(key `machine`)를 같이 둔다. 앱 process가 열 때 표지가 지금 기계 id와 다르면(다른 기계에서 복사된 data root, `machine.md`) node를 새것으로 바꾸고 표지를 고친다. data, row·칸 clock, log는 그대로다. 표지가 없으면 이 판 전에 이 기계에서 만든 DB라 지금 id를 적고 node를 지킨다. 두 기계가 같은 node로 clock을 찍으면 서로의 변경을 같은 replica의 것으로 보기 때문이다. 폰은 이 key를 쓰지 않는다(폰의 node는 기기 id다).
- **컴퓨터의 write.** sync 앱의 컴퓨터 write는 호출이 끝난 뒤 같은 write 줄 안에서 log에 줄을 쓴다(그래서 log의 순서가 DB에 적용된 순서다). 앱이 뜨며 한 write는 ready 통보에 실어 log에 남긴다. changeset이 너무 크거나 결과를 알 수 없는 변경은 보낼 수 없으니 "다시 snapshot" 줄을 남기고, 그 줄에 닿은 폰은 새 snapshot을 받는다. core가 앱의 commit과 log 줄 사이에서 죽었으면 core가 뜰 때 같은 줄로 메운다.
- **rewind.** sync 앱의 rewind는 effective changeset과 새 clock을 log에 `rewind` 줄로 남겨 폰이 받는다. 새 clock이 앞선 것보다 새로워 폰이 받아 간 변경 위에서 이긴다. rewind 범위에는 폰에서 온 invocation도 다른 live write처럼 든다.
- **처음 설치와 snapshot.** 폰은 `app_sync/snapshot`으로 컴퓨터 DB의 사본을 받는다(core가 write 줄을 쥔 채 앱 process가 `VACUUM INTO`로 떠서 사본이 log의 그 번호까지의 변경을 담는다). `app_sync/snapshot_file`로 8 MiB씩 읽고 크기와 sha256을 disk에서 확인한 뒤에 연다. core는 DB를 열지 않고 byte만 흘린다. snapshot은 10분 뒤 만료되고 다 읽히면 지워진다. standalone 앱은 snapshot 없이 빈 DB에 release의 migration을 올린다.
- **release가 바뀔 때(폰).** 새 release가 활성이 되거나(push의 `conflict`가 `active_release`를 말한다) pull이 snapshot을 요구하면 폰은 guest를 내리고 `app.sqlite`를 backup한 뒤 모든 일을 `work/`의 사본에서 한다. outbox가 비어 있으면 새 snapshot이 `app.sqlite`가 된다. 안 보낸 변경이 있으면 backup 사본을 새 release의 migration으로 local migration하고, 새 snapshot을 받아, 남은 변경을 표와 칸 이름으로 다시 표현해 snapshot 위에 적용한 file이 `app.sqlite`가 되고 push한다. 이 backup은 새 release에서 outbox가 비는 push가 될 때까지 둔다. 어느 단계가 실패해도 `app.sqlite`와 outbox는 그대로이고 옛 release로 계속 열리며 다음 계기에 다시 한다. migration이 지운 표와 칸의 안 보낸 변경은 버려진다(그 migration의 `-- loss:` 줄을 사람이 activation 때 이미 보았다). 칸 이름 바꾸기는 지우고 새로 만든 것으로 취급된다. 같은 release끼리만 맞춘다: 컴퓨터는 활성이 아닌 release의 push를 `conflict`로 거절하고 pull은 snapshot을 알린다.
- **release가 바뀔 때(컴퓨터).** activation이 옛 release의 log 줄과 changeset을 지우고 지운 것이 있으면 "다시 snapshot" 줄을 남긴다(지운 줄을 못 받은 폰이 같은 release로 돌아와도 빈 곳을 건너뛰지 않게). migration이 칸 목록을 바꾼 표의 칸 clock은 새 release의 첫 시작이 지운다(칸 clock은 칸 번호로 적히기 때문). 앱을 지우면 그 앱의 log와 임시 snapshot도 지운다.
- **external.** 폰에서 `external` operation은 outbox를 먼저 push한 뒤 컴퓨터의 view 표(`app_views/call`)로 간다. 컴퓨터에 닿지 않거나 push가 안 되거나 안 보낸 변경이 남으면 보내지 않고 `unavailable`이다. 컴퓨터에서 바뀐 것은 다음 pull로 온다.
- **폰의 앱 폴더.** 컴퓨터와 앱마다 `files/apps/<computer key>/<app>/`에 `app.sqlite`(data, clock, outbox), release 폴더(backend, manifest, migration, 화면 bundle), release 바뀜의 backup, 설치 기록(마지막에 쓴다. 없는 폴더는 멈춘 설치라 지운다)이 있다. 받은 file은 크기와 sha256이 manifest와 같을 때만 쓴다.
- **지우는 때.** 앱이 컴퓨터의 목록에서 빠지거나 컴퓨터를 지워도 sync 앱의 폴더는 outbox가 비었을 때만 지운다. standalone 앱의 data는 자동으로 지우지 않는다(컴퓨터의 목록에서 빠져도 폰의 목록에 남고 열린다). 옛 release 폴더는 바꾼 뒤에 지운다.
- **폰에서 못 하는 것.** 폰의 backend는 network, secret, 알림, event 발행, 다른 앱의 command, agent, job을 부르면 `unavailable`이다. 컴퓨터가 필요한 일은 `external` operation에 둔다. 폰에서 한 write가 낸 앱 event는 전달되지 않는다(폰의 호출이 event를 내지 못하고 컴퓨터가 적용한 변경도 event를 내지 않는다). 폰 write와 컴퓨터 write가 같은 칸을 고치면 나중 것이 말없이 이긴다.
- **폰 gate.** 폰 자격에 `app_sync/push|pull|snapshot|snapshot_file`, `apps/phone_file`, event `AppSyncChanged`(앱 id와 번호만 싣는다)를 연다. `app_sync/push`와 `snapshot`은 짝지은 기기만 받는다. 그 밖의 앱 route는 닫힌 채다.
- **폰에 보이는 것.** 앱 화면 위 줄이 sync 앱은 "On this phone · synced <시각>", standalone은 "Only on this phone · not backed up"을 말한다(`phone-screen.md`). 충돌은 보이지 않는다.

## 지키는 것

1. 폰의 read와 write는 컴퓨터가 닿아도 폰에서 돈다. 호출 하나의 data 변경과 그 변경 기록(outbox 줄)은 같은 transaction이라 함께 commit되거나 함께 사라진다. 컴퓨터도 sync 앱의 write는 data, changeset, clock이 한 transaction이다.
2. 두 사본이 같은 변경을 어느 순서로, 몇 번 받아도 같아진다. 충돌은 칸 단위로 나중 것이 이기고 delete가 이긴다. 충돌하지 않는 편집은 잃지 않는다.
3. 폰의 write는 컴퓨터에 닿을 때 invocation(기기가 붙은 caller)이 되고 Activity와 rewind가 덮는다. rewind는 log에 effective 변경과 새 clock을 남겨 폰이 받는다.
4. sync 일(clock 찍기, outbox, 들어온 변경 적용, migration, snapshot, backup)은 신뢰된 폰 host만 한다. guest는 묶인 file 하나만 보고 숨은 `lophn_sync_*` 표와 transaction 제어에 닿지 못한다. guest의 호출이 3초 안에 안 끝나면 rollback된다.
5. 컴퓨터에 안 간 변경이 있는 data는 지우지 않는다. sync 앱의 폴더는 outbox가 비었을 때만, standalone 앱의 data는 자동으로 지우지 않는다. release 바뀜의 backup은 새 release의 첫 push가 될 때까지 남고, 어느 단계가 실패해도 `app.sqlite`와 outbox는 그대로다.
6. 같은 release끼리만 맞춘다. 활성이 아닌 release의 변경은 `conflict`다.
7. relay는 변경을 맡지 않는다. 폰은 컴퓨터에 닿은 동안 앞에 있을 때만 맞춘다.
8. 폰에서 도는 backend는 release 검사를 통과한 code뿐이다: Node 내장 import, 선언과 다른 handler 집합, 정수 PK·AUTOINCREMENT·trigger·PK 밖의 UNIQUE와 CHECK, 폰 entry가 없는 SDK 판이 없다. 준비는 앱 code를 core process 안에서 돌리지 않는다.
9. 폰이 받는 backend file은 그 release의 manifest가 적은 것뿐이고 크기와 sha256이 맞아야 쓴다. 폰 gate에서 push와 snapshot은 짝지은 기기만 받는다.
10. 같은 기기의 같은 변경 id는 한 번만 적용된다(다시 보내도 중복되지 않는다). outbox 줄은 컴퓨터가 답한 것만 지운다.
11. 다른 기계에서 온 컴퓨터 sync DB는 같은 node로 clock을 찍지 않는다. node만 바꾸고 data와 clock 표는 그대로 둔다.

## 경계와 계약

- boundary `app-sync`(sync log, 폰의 push·pull·snapshot, 칸 단위 규칙의 sync core), `app-releases`(폰 backend build와 검사, manifest), `app-runtime`(앱 process의 sync 일), `remote-protocol`(폰 gate), `mobile`(폰 host의 설치와 sync, guest의 backend, native SQLite module), `sdk`·`sdk-api`(선언 `runs_on`과 SDK 판).
- 선언: `runs_on`(`@lophn/declaration` 4.8.0, 없는 옛 선언은 그대로 읽히고 hash도 같다). SDK: `@lophn/cap-store` 2.0.0(`StoreDb`, 인자 없는 `migrate()`, `newId()`, `transaction()`은 SAVEPOINT), `@lophn/cap-tool` 2.2.0, `@lophn/cap-problem` 1.1.0(Node 내장을 폰 entry 뒤로 옮김). 앱 SDK의 판과 지원 하한은 `package.md`다.
- route: `app_sync/push`(memory, 오류 `invalid_input`·`not_found`·`forbidden`·`conflict`·`unavailable`), `app_sync/pull`(read, 오류 `invalid_input`·`not_found`·`forbidden`·`unavailable`. 출력의 `snapshot_needed`는 활성이 아닌 release와 "다시 snapshot" 줄이 뜻한다), `app_sync/snapshot`(memory), `app_sync/snapshot_file`(file), `apps/phone_file`(file, 활성 release의 manifest가 적은 file만, 그 밖은 `not_found`), `apps/phone_screens`의 항목에 `runs_on`과 `backend`(manifest) 칸. event `AppSyncChanged`(남지 않음, `{release, seq}`).
- 저장: ledger 표 `app_sync_log`(schema step `apps.sync-log`. 앱마다 번호, release, 종류 `change`·`skipped`·`snapshot`, 출처 `computer`·`device`·`rewind`, 기기와 변경 id, clock, changeset hash와 크기, invocation). person caller의 `device`. 앱 DB의 숨은 표 `lophn_sync_row`, `lophn_sync_col`, `lophn_sync_state`(node, 마지막 clock, cursor, release, 컴퓨터는 node를 적은 기계 id `machine`), `lophn_sync_outbox`(폰에서만). cap-store의 session은 `lophn_` 표를 담지 않아 clock이 changeset과 rewind로 퍼지지 않는다. 폰 data는 폰 앱의 `files/apps/` 아래다.
- 계약 상수와 codec: sync core는 컴퓨터의 app runtime과 폰 host가 같은 module을 쓴다(IO는 driver 하나로만 하고 Node와 Hermes에서 같이 돈다). 폰 backend의 host prelude는 release 준비의 load 검사와 폰의 guest base가 같은 것을 쓴다.

## 결정

- 선언 칸 `runs_on` 하나로 셋을 가른다. 버린 안: 모드마다 SDK API를 따로 두는 것(같은 길을 셋 짓는다), 화면으로 모양을 짐작하는 것(폰 화면이 있는 remote 앱이 말없이 sync 앱이 된다). (planner)
- 폰의 backend는 그 앱 화면의 guest runtime 안에서 돈다. 버린 안: 앱마다 별도 headless runtime(runtime 하나에 20–40 MB와 native 작업이 더 들고 지금 backend를 부르는 것은 화면뿐이다. 위젯과 background 일을 열 때 다시 본다), 폰 앱의 주 runtime에서 돌리기(AI가 쓴 code가 기기 key와 폰 앱의 native module에 닿는다), 숨은 WebView(SQLite가 비동기라 SDK의 동기 DB API와 맞지 않는다), 폰용 Node(nodejs-mobile는 `node:sqlite`가 없는 판이다). (planner, spike)
- 폰의 SQLite는 우리 작은 native module이고 expo-sqlite는 쓰지 않는다. 이유: guest 안의 expo-sqlite는 JS로 막을 수 없는 구멍이 있었다(다른 file을 ATTACH하고 `VACUUM INTO`로 내보내고, 전역 `expo`로 SecureStore 같은 Expo module 21개에 닿고, 숨은 clock 표를 지웠다). authorizer와 limit을 native에서 걸 수 있는 module이어야 file 하나에 묶을 수 있다. 같은 이유로 host와 guest가 같은 라이브러리여야 lock이 안 깨진다. SQLite 소스는 공식 amalgamation 한 쌍을 저장소에 그대로 두고(9.5 MB의 text) sha256으로 고정한다. 이유(추론): build가 network나 다른 package의 이름 바꾼 사본(expo-sqlite의 `exsqlite3_*`)에 기대지 않고, 판을 올릴 때 diff가 한 쌍의 교체뿐이다. 대가: 저장소가 9.5 MB 커진다. (planner, agent)
- 충돌은 칸 단위로 나중 것이 이기고 delete가 이긴다. 버린 안: row 단위 clock(한쪽이 `title`, 다른 쪽이 `done`을 고치면 row 단위로는 한쪽 변경을 버려 두 사본이 영영 갈라진다). `applyChangeset`로 그대로 적용하기(binding마다 충돌 정책이 다르고 expo-sqlite는 늘 REPLACE라 칸 단위로 거르려면 changeset byte를 다시 써야 한다). clock을 칸마다 한 줄로 두기(spike에서 10k row data의 1.84배. 고른 꼴은 row마다 한 줄과 insert 뒤에 바뀐 칸만이라 insert만 한 data에서 0.21배). 행의 delete가 clock 순서와 관계없이 무조건 이기게 하기(지웠다 다시 넣은 row가 한쪽에서만 지워진다. 그래서 delete도 그 row의 마지막 insert나 delete보다 새로울 때만 적용한다). 충돌을 사람에게 보이는 화면은 만들지 않는다: 사람은 한 명이고 같은 칸을 두 기기에서 동시에 고치는 일이 드물어 말없이 나중 것이 이기는 편이 낫다. (planner, spike)
- 폰의 clock 찍기와 write를 한 transaction으로 하기 위해 guest의 호출마다 native module이 outbox 줄을 같은 transaction 안에서 쓴다(host와 guest는 연결이 따로라 한 transaction을 나눌 수 없다). host는 clock을 나중에 찍고 들어온 변경을 적용하는 transaction의 맨 앞에서 안 찍힌 줄부터 찍는다. 이유: 찍기 전에 적용하면 들어온 변경이 옛 clock과 비교되어 local 값을 덮고 사본이 갈린다. write와 그 기록은 늘 같이 commit되어 잃지 않는다. (agent, spike의 경합 발견)
- 정수 PK와 AUTOINCREMENT는 거절하고 id는 `newId()`(시각 순으로 정렬되는 ULID 꼴 text)다. 이유: 두 기기가 같은 id를 만들면 어떤 규칙으로도 row 하나를 잃는다. trigger를 거절하는 이유: trigger가 쓴 row는 changeset에도 다시 와서 적용하면 효과가 두 번 난다. PK 밖의 UNIQUE와 CHECK를 거절하는 이유: 한 row의 칸이 두 기기에서 와 제약에 같이 걸리면 적용이 같은 변경에서 영영 실패한다(그래도 제약에 걸린 변경은 하나만 건너뛰고 이어 간다). (planner, agent)
- 폰의 local 호출은 한 번에 하나이고 3초 안에 끝나야 한다. 이유(코드의 주석에서): 호출이 file의 write lock을 쥐고 있는 동안 host의 sync 쓰기는 5초 busy timeout을 기다린다. 끝나지 않는 호출이 sync를 영영 막지 않게 rollback한다. 대가: 끝나지 않는 handler는 그 앱의 다음 local 호출을 다시 mount할 때까지 막는다(이슈 `phone-hung-handler-blocks-later-calls`). (agent)
- 폰에서 한 write는 컴퓨터가 받을 때 invocation이 된다. caller는 새 종류가 아니라 `person`에 `device`를 더한 것이다. 이유: ledger schema step이 늘지 않고 Activity와 rewind가 기존 길로 덮는다. 폰이 read로 쓴 변경도 effect `write`로 남긴다(invocation 표는 read에 changeset을 받지 않는다). 그래서 "모든 호출은 core를 지난다"는 "모든 호출은 core가 기록한다. 폰의 local 호출은 맞출 때 기록된다"로 바뀌었다(`app-call.md`). (planner)
- 다른 기기에 보내는 것은 원래 changeset과 clock이고 effective changeset은 invocation 기록에만 쓴다. 이유: 값이 같은 update나 없는 row의 delete는 clock만 움직이고 effective에는 남지 않아, effective만 퍼뜨리면 폰의 clock이 컴퓨터와 어긋나고 시계가 어긋난 기기가 있으면 나중에 data가 갈라진다. (agent)
- release가 바뀔 때 migration이 지운 표와 칸의 안 보낸 변경은 말없이 버린다. 이유: 그 migration의 `-- loss:` 줄을 사람이 activation에서 이미 보았다. "N개를 보내지 못했다"는 상태는 만들지 않는다. 버린 안: 옛 release로 먼저 push하기(컴퓨터는 활성이 아닌 release를 받지 않는다). (planner)
- standalone 앱은 폰에서만 돈다. data를 backup하지 않고 컴퓨터는 그 DB와 맞추지 않으며 폰이 "Only on this phone · not backed up"을 말한다. 이유: roadmap이 사람의 앱은 사람의 기기에 있다고 정했고, backup을 만들려면 sync와 다른 길이 하나 더 든다. 폰 data가 지워지면 되살릴 곳이 없다는 것을 앱 agent가 사람에게 말한다(지침). (planner)
- 폰 backend bundle은 plain JS이고 core는 Hermes bytecode를 만들지 않는다. 이유: 실제 크기 backend(약 20 KB)는 release build에서 mount부터 첫 호출까지 55–139 ms였다. 200 KB의 plain JS는 machine 부하 아래에서 372–535 ms로 300 ms를 넘었고 같은 크기의 bytecode는 83–129 ms였다. 그래서 backend가 크게 나와 느리면 bytecode가 fallback이다(폰 앱의 Hermes와 맞는 `hermesc`를 core가 들어야 한다). (planner, spike)
- sync 앱의 read와 write는 컴퓨터가 닿아도 폰에서 돌고, 컴퓨터에 닿을 때만 맞춘다. external이 가는 길은 컴퓨터의 기존 view 표다. 이유: 한 길로 두어 online과 offline이 같고 전환 경합이 없다. (planner)
- 컴퓨터 sync DB의 node에 만든 기계의 id를 표지로 찍고, 다르면 앱 process가 열 때 node를 새로 받는다. 이유: 복제 판정이 앱 DB를 열 수 없고(앱 process만 연다) 소비자 목록을 몰라도 각 상태가 스스로 맞춘다. 앱 DB는 data step으로 옮길 수 없어 표지가 없는 옛 DB는 이 기계의 것으로 본다. (planner, agent)
- 컴퓨터가 hub이고 폰 둘은 컴퓨터를 거쳐서만 맞는다. relay는 변경을 맡지 않는다. 이유: 암호문을 relay가 맡는 것은 relay에 저장과 키 관리를 더하는 일이고, 사람이 컴퓨터를 켜 둔다는 전제로 충분하다고 보았다. 대가: 컴퓨터가 꺼진 동안 폰 둘이 같은 앱을 고치면 컴퓨터가 켜진 뒤에야 맞는다. (planner)

## 열린 것

- **실제 폰, 실제 agent, 두 폰, Electron으로 보지 못했다.** emulator(Android)에서 개발 core에 손으로 release한 앱 둘(sync, standalone)로 설치, offline write의 push, 컴퓨터 write의 pull, 같은 row의 다른 칸 양쪽 편집, 안 보낸 변경이 있을 때의 release 바뀜, rewind, external, core를 끈 standalone, 앱을 열지 않고 하는 설치와 push, 손가락 입력을 보았다. 앱 agent가 만든 앱(개발 core에는 model이 없다), 실제 폰, Electron desktop 앱, 한 앱을 두 폰이 컴퓨터를 거쳐 맞추는 것(기기를 하나만 붙였다), 변경 하나가 8 MiB를 넘을 때의 폰 쪽, 오래 끊긴 뒤와 큰 data, 폰에서 1,000개 변경을 push하는 시간은 보지 못했다. iOS는 짓지 않았다.
- 변경 하나가 8 MiB를 넘으면 폰에서는 commit되지만 push가 영영 거절되어 앱이 실패 상태에 머문다. 폰에서 막는 장치가 없다(이슈 `phone-oversize-change-cannot-be-pushed`).
- 끝나지 않는 handler는 3초 뒤 rollback되지만 그 앱의 다음 local 호출을 막는다(이슈 `phone-hung-handler-blocks-later-calls`).
- sync는 지금 화면에 있는 컴퓨터에 대해서만 돈다(이슈 `phone-sync-only-for-current-computer`).
- 폰 앱의 설치 실패 문구가 컴퓨터가 낸 오류 글을 그대로 보인다(이슈 `phone-install-failure-shows-raw-core-error`).
- 폰 backend는 operation과 command를 한 bundle로 묶어서 컴퓨터에서만 쓰는 command가 `node:`를 import해도 두 곳에서 도는 앱의 준비가 실패한다(이슈 `phone-backend-bundle-includes-computer-only-commands`).
- sync 앱을 컴퓨터에서 띄우는 자동 검사가 없다(이슈 `no-check-starts-a-sync-app-on-the-computer`). 이 때문에 컴퓨터의 sync 노드 id가 틀린 모양이라 어떤 sync 앱도 컴퓨터에서 뜨지 못한 버그가 emulator 확인 중에야 드러났다.
- 폰의 local 호출 문맥의 앱 id가 빈 글자다(이슈 `phone-local-call-context-has-no-app-id`). 폰에서 한 write의 앱 event는 전달되지 않는다(이슈 `phone-write-events-not-delivered`).
- guest를 띄울 때마다 쓰는 backend 사본이 cache 폴더에 쌓이고 앱을 다시 켤 때까지 남는다(이슈 `phone-guest-backend-copies-pile-in-cache`). `backend.js.map`이 bundle에 실리지만 폰은 받지 않는다(이슈 `phone-backend-source-map-in-bundle`).
- 이 판 전에 다른 기계로 복사한 sync DB는 표지가 없어 두 기계 모두 node를 지킨다. 두 기계가 같은 node를 쓴다(`machine.md`의 열린 것).
- 컴퓨터는 `["phone"]` 앱도 다른 앱처럼 activation하고 process를 띄워 DB를 만든다. 그 DB는 폰과 맞추지 않고 쓰이지도 않는다. 막지는 않았다.

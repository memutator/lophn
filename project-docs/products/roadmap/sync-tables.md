# sync-tables: 앱 data를 table마다 다른 길로 보낸다

상태: 계획 전(2026-11-21). 조사 끝, 구현 안 함. 길은 "한 줄"이다(같은 file을 차례로 고치고 앞에서 정한 것을 뒤가 쓴다). branch `feat/sync-tables`.
배경 문서: `project-docs/architecture/folder-sync.md`, `project-docs/architecture/app-sync.md`, `project-docs/products/roadmap/multi-machine.md`, change-log `0.23/app-folder-sync.yaml`·`0.23/carry-paths.yaml`·`0.23/app-source-share-without-sync.yaml`.

## 사람의 말 (원문)

2026-11-21, session `ses_01m7whydh7fk4m4er4mqbq8mwf`(Mahas)와 `ses_01m7wc59spfhrpmxrhxqb7wcq1`(Home)을 보고:

> 앱의 기능별로 데이터 동기화 정책을 다르게 둘 수 있게끔 하는거야 (…) 근데 이게 앱 별로 정해지는 게 아니란거지 mahas에서도 토큰 사용데이터는 그냥 vm이 서버의 역할을 해서 쏴주고 만약에 오래된 세션 자동 백업을 쓴다면 그냥 google drive로 보내는거고 만약에 동기화해야하는 빈도 수가 낮고 또 용량이 크면 토큰 사용데이터도 구글 드라이브로 할 수도 있는 거고

> 그리고 앱 데이터 동기화랑 앱 remote use에 대해서는 구분해야해

## 문제

선언의 `sync_to`는 앱에 문자열 하나다(`packages/protocol/apps/declaration/types.ts`). 켜면 앱 DB의 모든 table이 한 destination으로 간다.

- Mahas는 시간별 집계만 컴퓨터끼리 맞추면 되는데, 272MB 원본 table과 컴퓨터마다 다른 file 읽기 위치 table까지 따라간다. Mahas의 agent는 여기서 막혀 아무것도 만들지 못했다.
- 제약이 DB 전체에 걸린다: snapshot은 DB 통째(`VACUUM INTO`)이고 1 GiB 한도가 그 file을 잰다(`packages/core/folder/export/stream.ts`). trigger는 하나도 못 쓰고, 정수 PK·UNIQUE·CHECK 금지가 모든 table에 걸린다(`packages/protocol/apps/activation/phone-schema.ts`).
- 한 앱이 두 곳으로 보내지 못한다. 집계는 `computers`, 백업은 바깥 폴더가 안 된다.

## 원칙

1. **단위는 table이다.** 기능이 저장하고 보내는 것이 table이고, changeset도 clock도 이미 table로 나뉘어 있다(`lophn_sync_row`·`lophn_sync_col`·`lophn_sync_kept`의 `tbl`).
2. **정책은 그 앱의 agent가 선언에 적는다.** 사람은 "집계는 컴퓨터끼리, 오래된 세션은 Drive에"라고 말하고, 길(`computers`의 연결·폰·폴더)은 lophn이 고른다(PRODUCT.md 3절, 5절). 사람이 채우는 정책 화면은 만들지 않는다.
3. **적지 않은 table은 그 컴퓨터를 떠나지 않는다.** 보내는 것을 적는다. 로컬 전용이 기본이다.
4. **제약은 보내는 table에만 건다.**

## 모델

선언에서 `sync_to`를 지우고 table → destination 표를 둔다.

```ts
sync: {
  usage_hour: "computers",
  usage_session_hour: "computers",
  plan: "computers",
  session_archive: "gdrive",
}
```

- 값은 지금 `sync_to`와 같은 destination 이름이다(`computers`나 `folder.destinations`의 이름).
- 표에 없는 table은 로컬 전용이다. migration이 table을 더하면 보낼 것만 표에 더한다.
- 앱 DB file은 하나로 둔다. rewind와 Activity의 기록(모든 table의 session changeset)은 그대로다.

## 단계

### 1단계: 로컬 전용 table 빼기 (destination은 앱에 하나)

선언은 최종 모양으로 받되, 표의 값이 모두 같은 destination이어야 한다. Mahas가 막힌 곳이 여기서 풀린다.

| 무엇        | 어떻게                                                                                                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 선언        | `sync` 표를 읽고 검사한다(table이 있고 PK가 있다). `across_machines` event는 `sync`가 비어 있으면 못 쓴다                                                                                                                                                |
| changeset   | sync log에 넣기 전에 보내는 table의 section만 남긴다(`packages/base/changeset-invert.ts`의 `sections()` 위에 `filterChangeset`). 보내는 변경이 없는 invocation은 `skipped` 줄을 남긴다(줄이 없으면 core 기동의 backfill이 매번 re-snapshot으로 되살린다) |
| clock       | `stampLocal`, `remapColumnClocks`, rewind의 stamp가 보내는 table만 본다. table이 표에서 빠지면 앱 process가 뜰 때 그 table의 clock 줄을 지운다                                                                                                           |
| snapshot    | 새 DB file에 앱 DB를 `ATTACH`해 보내는 table과 그 clock 줄만 복사한다. 1 GiB는 이 file을 잰다                                                                                                                                                            |
| merge       | `mergeSnapshot`이 자기 선언의 table만 모양을 대조하고 합친다. 없는 줄 지우기(`deleteAbsent`)도 그 table만이다                                                                                                                                            |
| schema 검사 | 정수 PK, AUTOINCREMENT, UNIQUE, CHECK 검사를 보내는 table로 좁힌다. trigger와 FK는 아래 규칙                                                                                                                                                             |
| 읽는 곳     | 선언을 읽는 다섯 곳이 `syncPlanOf(declaration)` 하나를 쓴다                                                                                                                                                                                              |
| 지침        | `design-app/folder-sync.md`를 다시 쓴다. `declaration` 판과 `migrate-sdk` 메모                                                                                                                                                                           |

### 2단계: 한 앱에서 destination 여럿

| 무엇                | 어떻게                                                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sync log            | `app_sync_log`에 `destination`을 더하고, 넣을 때 destination마다 줄을 나눈다(hold와 held가 줄 단위라 섞인 줄은 한쪽만 붙들 수 없다)                                                                        |
| ledger              | `folder_reads`, `folder_held`, `folder_records`의 key에 destination을 넣는다(schema step, lock). `folder_streams`와 `folder_written`은 이미 destination이 key다                                            |
| export·import       | 앱 하나가 아니라 (앱, destination)마다 돈다. `settled`는 stream마다, tombstone horizon은 DB에 하나(모든 stream의 가장 늦은 쪽)                                                                             |
| source와 `app.json` | private이 아닌 앱은 늘 `computers`에 쓰고, table을 보내는 이름 붙인 destination에도 쓴다. 지금은 이름 붙인 destination만 쓰는 앱이 `computers`에 안 나가 `app-source-share-without-sync`의 결정과 어긋난다 |
| event               | `across_machines` event는 table을 보내는 destination 모두에 쓴다(받는 쪽이 이미 중복을 거른다)                                                                                                             |
| 화면과 읽기         | Settings › Sync, `machine environment`, carry status, update state가 앱마다 destination 목록을 든다                                                                                                        |

폴더 file format(`FOLDER_FORMAT`)은 그대로다. 받는 쪽은 같은 `code_commit`의 자기 선언에서 table 집합을 안다.

## trigger와 FK 규칙

apply는 SQL을 그대로 돌린다. 그래서 받은 변경을 넣을 때도, snapshot을 합칠 때도 trigger가 돈다. FK는 그때 꺼져 있다.

- trigger는 **보내는 table에 걸린 것만 거절한다.** 로컬 table에 걸린 trigger가 보내는 table에 쓰는 것은 된다(그 컴퓨터에서 한 번만 돌고, 쓴 것은 기록되어 간다). Mahas의 rollup trigger 넷이 이 경우다.
- FK: 보내는 table이 로컬 table을 가리키면 거절한다(다른 컴퓨터에는 그 부모 줄이 없다). 로컬 table이 보내는 table을 가리키는 것은 되지만 `ON DELETE/UPDATE`의 CASCADE·SET NULL·SET DEFAULT는 거절한다. 2단계에서 보내는 table끼리의 FK는 같은 destination일 때만 된다.

## 사람의 data root

- **켜 둔 옛 release의 `sync_to`는 "모든 table을 그 destination으로"로 읽는다.** 봉인한 선언은 hash가 걸려 고쳐 쓸 수 없다. 읽지 않으면 그 앱은 말없이 clock을 찍지 않게 되고, 나중에 다시 sync할 때 그 사이의 로컬 수정이 다른 컴퓨터의 옛 값에 덮일 수 있다. 새 release 준비는 `sync_to`를 거절한다. 읽는 곳은 `syncPlanOf` 하나다.
- 새 선언의 첫 release는 보통의 release 바꿈과 같다: 첫 file이 snapshot이고 다른 컴퓨터는 따라올 때까지 held로 둔다. 따로 옮길 것은 clock 줄 지우기뿐이다.
- 로컬 전용이 된 table의 줄 가운데 이미 다른 컴퓨터로 간 것은 거기 남는다. 폴더의 옛 snapshot은 30일 compaction까지 남는다.
- 2단계의 ledger step은 `folder_reads`의 destination을 켜 둔 release의 선언에서 채운다. 올림은 이전 release로 만든 data root에 새 code를 기동해 본다.

## 정한 것

| 정한 것                                                                                                                           | 근거                                                                                               | 누가  |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----- |
| 정책 단위는 앱이 아니라 앱 안의 data다. `app-folder-sync`의 "선언 칸은 `sync_to` 하나"를 바꾼다                                   | 위 사람의 말                                                                                       | 사람  |
| data를 맞추는 것과 다른 컴퓨터의 앱을 쓰는 것(remote use)은 다른 일이다. 이 문서는 앞의 것만 다룬다                               | 위 사람의 말. 뒤의 것은 change-log `remote-app-use`, `app-roster-sdk`                              | 사람  |
| 단위는 table, 적지 않으면 로컬                                                                                                    | 원칙 1, 3                                                                                          | agent |
| DB file을 여럿으로 나누지 않는다                                                                                                  | 기존 앱이 선언만 고치면 된다. file을 나누면 rewind와 한 invocation의 원자성이 file을 건넌다        | agent |
| 폰에서 도는 앱(`runs_on`에 phone)은 폰 길이 모든 table을 그대로 다룬다. 폴더로 나갈 때만 거른다. 2단계에서 destination은 하나까지 | 폰 사본은 DB 통째를 받는다. 폰 쪽을 같이 바꾸면 일이 둘이 된다                                     | agent |
| tombstone horizon은 DB에 하나                                                                                                     | destination마다 두면 clock 표가 갈린다. 대가: 가장 느린 상대가 모든 table의 흔적을 90일까지 붙든다 | agent |
| `folder.shared`는 그대로 `computers`의 길 하나다                                                                                  | PRODUCT.md 5절. 일부만 cloud에 두는 것은 이 문서의 이름 붙인 destination이다                       | agent |

## 위험과 test

- 컴퓨터마다 자기 원본을 같은 rollup PK로 모으면 칸 단위 last-write-wins로 서로 덮는다. 지침이 "컴퓨터마다 생기는 줄의 PK에 machine id를 넣는다"를 요구해야 한다. id는 `app-roster-sdk`의 명단 API가 준다.
- `ATTACH` 복사와 node:sqlite의 FK 기본값은 확인하지 않았다. 1단계 처음에 본다.
- `skipped` 줄이 로컬 전용 invocation마다 하나씩 쌓인다(작은 줄).
- test는 data를 잃는 규칙 셋만 쓴다: `filterChangeset`을 거친 changeset이 그대로 적용된다, 로컬 table이 없는 snapshot을 합쳐도 로컬 줄이 남는다, table이 표에서 빠지면 그 clock이 지워진다. 2단계는 held가 destination마다 갈리는 것 하나. 폴더 export·import·apps test는 고쳐 살리지 않고 다시 쓴다.

## 하지 않는 것

- 칸(column)별 정책, 줄(row)별 정책.
- 폰 사본의 table별 정책.
- 사람이 Settings에서 table마다 길을 고르는 화면.

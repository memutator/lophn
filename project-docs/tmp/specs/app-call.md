# S5. 앱 호출 경로와 rewind

상태: **확인됨** (2026-10-15). 전부 사람이 확인했다(docs-review).

## 1. 범위

앱 app-api 호출이 core를 거쳐 앱 process에 가고 돌아오는 길, 그 기록(invocation), 앱 data를 되돌리는 길(rewind)이다. grant와 Gate의 모양은 S2, activation과 drain은 S7, session rewind는 S8이 맡고, 여기는 접점만 적는다.

## 2. 한 줄

모든 app-api 호출은 core를 거친다(req-0887). core가 부른 쪽과 project를 정하고, Gate로 판정하고, invocation을 남긴다. write는 앱마다 한 번에 하나씩 돌고, 앱 process의 SDK가 그 동안의 앱 DB 변경을 changeset으로 떠서 core에 넘긴다. rewind는 고른 invocation부터 최신까지 changeset을 뒤집어 적용한다.

## 3. 부품과 소유

| 부품 | 맡는 일 | 지금 코드 |
|---|---|---|
| 호출 경로(core) | 부른 쪽 확인, project 정하기, Gate 부르기, invocation 시작과 끝, write 줄 세우기, 앱 process로 보내기 | 없다. 새로 짓는다. 지금은 부르는 쪽이 core가 서명한 연결로 앱 process의 socket을 직접 부르고 앱 process가 invocation을 나중에 알린다. `packages/core/apps/connections`(앱 쌍 직접 통로)와 그 서명 연결은 지울 옛 것이다(9장) |
| Invocations(core) | invocation 기록과 changeset 보관. 주인이다 | `packages/core/apps/invocations` |
| Rewind(core) | 되돌아갈 목록 계산, drain, changeset 뒤집기, 적용 지휘, 되돌림 기록 | `packages/core/apps/revert`(옛 모델, 9장) |
| SDK runtime(앱 process) | app-api dispatch, write 동안 SQLite session, changeset 돌려주기, 뒤집은 changeset 적용 | `packages/sdk` |

앱 DB는 그 앱의 process만 연다(req-0950). 그래서 changeset을 뜨고 적용하는 것은 SDK이고, core는 보관하고 지휘한다.

## 4. 호출 경로

| 부르는 쪽 | Gate | 보는 grant | project(req-1513, 1515) |
|---|---|---|---|
| 앱 화면(사람) | 거치지 않는다. 사람 자신의 동작이다(S2 5장) | 없음 | 화면을 연 project. 앱은 `cap-project` 꼴 SDK client로 project 목록과 지금 project를 읽고, project를 고르는 UI는 shell(앱 place)이 맡는다 |
| agent | 거친다 | 그 agent의 agent grant | project에 놓인 agent면 그 project. lophn과 앱 place의 agent는 입력으로 정한다 |
| 다른 앱 | 거친다 | 부른 앱의 앱 grant(req-0915) | 부른 invocation의 project |

**순서**

1. core가 부른 쪽을 확인한다(사람과 화면, agent session과 turn과 tool call, 부른 앱과 그 release와 부모 invocation).
2. app-api가 project 범위이면(req-1512) 위 표대로 project를 정한다.
3. Gate(S2 5장)로 판정한다. 막음이면 이유를 돌려주고, 물음이면 turn 안 request로 기다린다.
4. invocation을 시작으로 남긴다(5장).
5. write나 external app-api이면 그 앱의 write 줄에 세운다(6장). read는 바로 보낸다.
6. 앱 process에 보낸다. SDK가 handler를 부르고 결과를 돌려준다. write와 external이면 changeset도 함께 돌려준다.
7. core가 invocation을 끝으로 남기고 changeset을 붙인다. 부른 쪽에 결과를 준다.

- 앱이 멈추거나 연결이 끊기면 그 호출에는 unavailable이나 결과 모름을 돌려주고, 부른 앱의 다른 일은 계속 돈다(req-0922).
- preview는 따로 띄운 process와 일회용 DB로 돈다(req-0945, 0946). preview invocation은 운영과 구분해 남기고, rewind 대상이 아니다.

## 5. invocation 기록

남기는 것은 write와 external app-api, 실패한 읽기, 앱 시작이다. 성공한 읽기는 매번 남기지 않는다(req-0893).

| 칸 | 뜻 | 근거 |
|---|---|---|
| 앱, release, app-api | 그때의 것 | req-0894 |
| 운영·preview | 구분 | req-0894 |
| 부른 쪽 | 사람, agent의 session·turn·tool call, 다른 앱과 그 release와 부모 invocation | req-0894 |
| project | project 범위 app-api일 때 | req-1514 |
| 효과 | 선언된 read, write, external | S2 3장 |
| 시작, 끝, 결과 | 성공, 실패, 결과 모름 | req-0894 |
| changeset | write, external, 앱 시작에서 앱 DB가 바뀌었을 때 | req-0893 |
| 되돌림 | 이 invocation을 되돌린 rewind. 기록은 지우지 않는다 | 11장 2 |

- 부른 session과 turn이 남으므로 "이 session이 부른 write 목록"은 기록에서 뽑는다(8장).

## 6. changeset

(사람 확인, 2026-10-15)

- **SDK가 뜬다.** write와 external app-api, 앱 시작 invocation이 도는 동안 SDK가 앱 DB 연결에 SQLite session을 건다. 끝나면 changeset을 결과와 함께 core로 보내고, core가 그 invocation에 붙여 보관한다. 앱은 SDK가 주는 DB 연결 하나만 쓴다(앱 data는 앱 DB 하나, req-1497). 시작 중에 DB를 바꾸는 앱 시작 invocation도 changeset을 남긴다. migration(DDL)은 release 경계라 rewind 대상이 아니다.
- **표에는 PRIMARY KEY가 있어야 한다.** SQLite session은 PRIMARY KEY 없는 표의 변경을 기록하지 않는다. 그래서 SDK의 migration으로 만드는 표는 PRIMARY KEY가 필수다(req-1521).
- **write는 앱마다 한 번에 하나다.** SQLite session은 연결 단위라 두 write가 겹치면 한 changeset에 두 호출의 변경이 섞여 invocation 단위로 되돌릴 수 없다. core가 앱마다 write와 external invocation을 줄 세운다. read는 동시에 돈다.
- **뒤집기는 core가 한다.** Deno 2.9.7의 `node:sqlite`에는 `createSession()`과 `applyChangeset()`이 있지만 changeset을 뒤집는 함수는 없다(lead가 돌려 확인). changeset에는 UPDATE와 DELETE의 원래 값이 들어 있으므로 core가 SQLite 문서의 changeset format을 읽어 뒤집는다.
- **지금 활성 release 것만 둔다.** activation하면 이전 release의 changeset을 지운다. invocation 기록은 남는다. release를 넘는 rewind는 하지 않기 때문이다(req-1496).
- read app-api는 선언을 믿고 session을 걸지 않는다(S2 2장). 선언이 맞는지는 선언하는 쪽(앱을 만드는 쪽)의 책임이고 lophn은 따로 검사하지 않는다(11장 4).

## 7. rewind (앱 data)

시점 단위다. invocation k를 고르면 그 앱에서 k부터 최신까지 모든 invocation을 되돌려 k 직전의 앱 DB로 돌아간다(req-1496). 누가 한 호출이든 되돌아간다. 호출 하나만 빼내 되돌리지 않는다. 읽기 의존을 알 수 없기 때문이다.

**순서** (drain은 사람 확인, 2026-10-15)

1. 사람이 invocation k를 고른다. 앱 rewind는 사람만 한다(11장 1).
2. core가 k부터 최신까지 되돌아갈 목록을 보인다. 사람의 화면 조작과 다른 session의 호출도 들어 있고, 되돌아가지 않는 external 효과를 표시한다.
3. 사람이 확인한다.
4. core가 그 앱의 새 호출 접수를 닫고 도는 호출이 끝나기를 기다린다. 그 사이에 온 호출은 붙잡아 둔다(activation의 drain과 같다, req-1508).
5. core가 changeset을 최신부터 뒤집어 앱 process에 보낸다.
6. SDK가 한 transaction으로 적용한다. 충돌이 나면 통째로 취소하고 이유를 남긴다.
   - 앱 rewind의 확인은 앱 화면 안의 panel에서 받는다(따로 확인 창을 두지 않는다).
7. core가 되돌린 invocation에 되돌림을 남기고, 접수를 다시 열고, 붙잡은 호출을 넘긴다.

- 지금 release의 activation 전 invocation은 고를 수 없다(req-1496).
- core가 호출 중에 죽어 changeset을 받지 못한 write는 결과 모름으로 닫고, rewind 화면에 "되돌릴 수 없음"으로 표시한다.
- rewind가 끝나면 열린 앱 화면에 다시 그리라는 남지 않는 event를 보낸다(S1 7장).
- 되돌린 것을 다시 하기(redo)는 없다.

## 8. session rewind와 나누기

(사람 확인, 2026-10-15)

| | session rewind | 앱 data rewind |
|---|---|---|
| 되돌리는 것 | 대화, 그리고 그 session이 file tool로 바꾼 파일(req-0044) | 앱 DB(req-1496) |
| 단위 | session 안의 시점 | 그 앱의 invocation 시점 |
| 영향 | 그 session 하나 | 그 앱을 쓴 모두(사람의 화면 조작, 다른 agent의 호출) |
| 언제까지 | session이 살아 있는 동안 | 지금 release 안 |

- session rewind가 앱 data를 저절로 되돌리지 않는다. 앱 rewind는 시점 단위라 그 사이 다른 쪽의 변경도 함께 사라지기 때문이다.
- 잇는 법은 S8이 정한다. 방향: session rewind 화면에서 고른 시점 뒤에 이 session이 앱에 write를 했으면 앱마다 보이고, 사람이 고르면 그 앱도 같은 시점으로 되돌린다(7장 순서, 함께 되돌아갈 목록을 먼저 보임). Claude Code의 rewind 메뉴가 코드와 대화를 따로 고르게 하는 것과 같다.
- S5가 S8에 주는 것: session·turn별 write invocation 목록, 고른 invocation 직전으로의 rewind.

## 9. 지울 옛 것

- `packages/core/apps/revert`, SDK `withRevert`, 앱이 되돌림 app-api를 선언하던 모델(req-0714 rejected) → 6, 7장.
- 앱 직접 통로: `packages/core/apps/connections`, 서명 연결과 proof 검증, `runtime/client`(직접 호출 client), 후행 전달, shell main의 `app-call`·`app-invoke`. 앱 화면 byte(`/screens`)를 내주던 길도 이 통로라 새 길이 필요하다(refactor session이 정한다).
- blueprint의 `revert`·`confirm` 칸과 `connections`·`invocations`의 confirm 경로 → S2 Gate.
- 설계 문서 `../architecture/approval.md` 5장의 "core가 앱 DB에 SQLite session을 건다" → SDK가 건다(req-0950).

## 10. 하지 않는 것

- invocation 하나만 빼내 되돌리기.
- release를 넘는 rewind. 이전 release로 돌아가는 것은 activation이다(S7).
- external 효과 되돌리기. 목록에 표시만 한다.
- redo.
- session rewind가 앱 data를 저절로 되돌리기.

## 11. 다시 따진 것

1. **정함(사람, 2026-10-15): 앱 rewind는 사람만 한다.** 그 앱을 쓴 모두의 변경이 함께 되돌아가는 일이라 agent에게 rewind tool을 주지 않는다(S4의 쓰기 tool 표에도 없다).
2. **정함: 되돌린 invocation은 지우지 않고 되돌림으로 표시한다. 뒤집은 changeset은 한 transaction으로 적용하고 충돌이면 통째로 취소해 이유를 남긴다.** 기록은 감사와 S8 연결에 쓰이고, 반쯤 되돌아간 DB는 남기지 않는다.
3. **정함: 오래 도는 write에 시간 상한을 지금 두지 않는다.** app-api 호출 시간 상한 요구가 없다. 기다리는 write는 화면에 보인다. 필요해지면 더한다.
4. **정함(사람, 2026-10-15): read app-api가 DB를 바꾸는지 lophn은 검사하지 않는다.** 선언이 맞는지는 바꾸는 쪽(앱을 만드는 쪽)의 책임이다. 잘못 선언한 read 때문에 rewind가 충돌하면 7장 6대로 통째로 취소되고 이유가 남는다. lead 실수: release test에 read 검사를 더하자고 해 "선언은 믿는다"를 다시 뒤집으려 했다.

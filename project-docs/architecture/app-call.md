# app-call

앱의 app-api를 부르는 길은 셋이다: 사람이 연 앱 화면, agent의 tool, 다른 앱. 어느 길이든 같은 판정(부른 쪽 확인, project 정하기, Gate)과 같은 기록(invocation)과 같은 직렬화(write는 앱마다 하나씩)를 거쳐야 한다. 그래야 "이 호출이 앱 data에 한 일"을 호출 단위로 알고, 사람이 고른 시점으로 앱 data를 되돌릴 수 있다(rewind). 그래서 모든 호출은 core를 지나고, write 동안의 앱 DB 변경은 changeset으로 떠서 invocation에 붙여 보관한다.

## 흐름

```
 person ── shell 앱 화면 ─────┐
 agent  ── run-loop tool ─────┼─ core-api ─▶ 호출 경로 (core/apps/calls)
 app    ── sdk ─ broker ──────┘              1 부른 쪽 확인        (credential, 도는 turn·부모 invocation)
                                             2 project 정하기
                                             3 Gate(approvals)      agent·앱만. 사람 화면은 거치지 않는다
                                             4 write·external이면 앱별 줄을 얻는다. read는 바로
                                             5 invocation 시작을 남긴다        ─▶ storage (ledger + changeset blob)
                                             6 보낸다
                                                │ child-supervision-protocol (supervisor가 길만 이어 준다)
                                                ▼
                                    앱 process (sdk runtime): handler 실행
                                    write·external 동안만 SQLite session ─▶ 결과와 changeset을 응답에 싣는다
                                                │
                                             7 invocation을 끝으로 남기고 changeset을 붙인다 ─▶ 부른 쪽에 결과

 rewind (사람만): 되돌릴 목록 ─▶ 앱 접수 닫기·drain ─▶ changeset을 최신부터 뒤집기(base)
                  ─▶ 앱 process가 한 transaction으로 적용(sdk) ─▶ 되돌림 표시, 접수 열기
 session rewind에서 사람이 앱을 고르면 같은 rewind로 간다 (place-session)
```

## 지키는 것

- 모든 app-api 호출은 core를 지난다. 화면에서 앱으로, 앱에서 앱으로 가는 직통 통로를 두지 않는다.
  - Gate, project, 기록, write 줄이 core 한 곳에 있어야 changeset이 빠지지 않는다.
- 부른 쪽은 호출 본문이 주장하는 대로 믿지 않고 core가 확인한다. credential의 종류와 caller 종류가 맞아야 하고, agent는 지금 도는 turn의 tool call이어야 하고, 앱은 활성 release이면서 부모 invocation이 지금 도는 호출이어야 한다.
  - 신원을 속이면 Gate를 우회한다. agent와 앱은 늘 live 활성 release만 부른다.
- project는 부른 쪽이 정한다. 앱은 입력으로 project를 고르지 못하고 부른 invocation의 project를 이어받는다. project에 놓인 agent는 자기 project만 쓴다. project 범위가 아닌 app-api는 project를 받지 않는다.
  - 앱이 다른 project의 data를 건드리는 우회를 막는다.
- Gate의 사람 대기는 write 줄에 서기 전에 끝낸다. 허락은 줄을 얻은 뒤 실행 직전에 consume한다(한 번 쓰는 허락이면 그때 소비).
  - 사람이 답하는 몇 분 동안 앱의 write를 막지 않는다. 그사이 intent가 달라졌거나 허락이 이미 쓰였으면 실행하지 않는다.
- write와 external은 앱마다 한 번에 하나다. core의 줄과 앱 process 안의 mutex, 두 겹이다. read는 동시에 돈다.
  - SQLite session은 연결 단위라 두 write가 겹치면 한 changeset에 두 호출의 변경이 섞여 호출 단위로 되돌릴 수 없다. 줄을 쥔 호출이 돌아오지 않아도 줄이 영영 막히지 않게 abandon이 줄을 비운다.
- changeset은 앱 process(sdk)만 뜨고 적용한다. 앱 DB는 그 앱의 process만 열기 때문이다. core는 보관하고, 뒤집고, 지휘한다.
  - sdk migration으로 만드는 표는 PRIMARY KEY가 필수다. 없으면 SQLite session이 그 표의 변경을 기록하지 않아, 되돌릴 수 없는데 되돌린 것처럼 보인다.
  - read app-api가 DB를 바꾸지 않는다는 선언은 믿고 검사하지 않는다. 틀린 선언이 rewind를 충돌시키면 통째로 취소되고 이유가 남는다.
- 보냈는데 응답을 못 받은 호출은 실패가 아니라 결과 모름(unknown)이다. 추정하지 않고 같은 일을 다시 부르지 않는다. 보내기 전에 막힌 것(앱이 멈춤, 연결 없음)은 unavailable로 구분한다. core가 다시 켜질 때 running으로 남은 invocation도 unknown으로 닫는다.
  - 쓰기가 일어났는지 모르는 채 성공이나 실패로 적으면 rewind와 재호출이 틀린다. 한 앱의 문제가 부른 쪽의 다른 일을 멈추지 않는다.
- invocation 기록은 지우지 않는다. 끝난 행은 되돌림 표시와 changeset 정리 말고는 바뀌지 않고(trigger), rewind 기록도 불변이다. 성공한 read는 남기지 않고, 실패한 read와 Gate 등에 막힌 호출(denied)은 남긴다.
  - 감사와 session rewind 연결(session·turn별 write 목록)이 이 기록에서 나온다.
- rewind는 사람만 하고 시점 단위다. 고른 invocation부터 최신까지 live, 활성 release 안, 아직 되돌리지 않은 write·external을 모두 되돌린다. 누가 한 호출이든 같다.
  - 읽기 의존을 알 수 없어 호출 하나만 빼낼 수 없다. 그 앱을 쓴 모두의 변경이 함께 사라지므로 agent에게 rewind tool을 주지 않는다.
- rewind는 접수를 닫고 도는 호출을 drain한 뒤 적용한다(유예를 넘으면 취소). 어떤 길로 끝나도 접수를 다시 연다. 앱마다 applying rewind는 하나다.
  - changeset은 최신부터 뒤집어 한 transaction으로 적용하고, 충돌하면 통째로 취소한다. 반쯤 되돌아간 DB를 남기지 않는다.
- 결과 모름으로 닫혀 changeset이 없는 write가 범위에 있으면 rewind를 막는다. 얼마나 바뀌었는지 모르기 때문이다. 크기 한도로 changeset을 못 붙인 write는 막지 않고 "DB를 되돌리지 못함"으로 표시한다.
- release를 넘는 rewind는 없다. activation이 끝나면 이전 release의 changeset을 지운다(invocation 기록은 남는다). 이전 release로 돌아가는 것은 activation의 일이다.
- preview는 따로 띄운 process와 일회용 DB로 돈다. 기록은 운영과 구분해 남기고 rewind 대상이 아니다. 운영 앱의 drain과 정지에도 걸리지 않는다.
- 앱 호출 사슬은 같은 앱이 다시 나오면(call_loop) 또는 깊이 한도를 넘으면 handler에 가기 전에 막는다. 앱끼리 서로 부르다 줄이 영영 풀리지 않는 것을 막는다.

## 왜 이 모양인가

- **core 경유로 일원화했다.** 이전에는 부르는 쪽이 core가 서명한 연결로 앱 process socket을 직접 부르고 앱이 invocation을 나중에 알렸다. Gate, project, 기록, 줄 세우기가 흩어지고 신원 증명(proof) 장치가 따로 필요했다. 지금은 경로가 하나다.
- **앱이 되돌림 app-api를 선언하게 하는 모델을 버렸다.** 앱마다 맞게 짜야 하고 틀려도 알 수 없다. SQLite session의 changeset은 앱 코드와 무관하게 DB 변경을 호출 단위로 잡는다.
- **뒤집기는 직접 구현했다.** node:sqlite에는 session과 apply는 있고 changeset을 뒤집는 함수(`sqlite3changeset_invert`)가 없다. changeset에는 UPDATE와 DELETE의 원래 값이 들어 있어, SQLite 문서의 changeset format을 읽는 순수 함수로 뒤집는다(base). patchset은 원래 값이 없어 뒤집지 못한다.
- **호출 단위가 아닌 시점 단위로 되돌린다.** write가 무엇을 읽고 썼는지 모르니, 호출 하나만 빼면 뒤 호출의 전제가 깨진다.
- **되돌린 invocation을 지우지 않고 표시한다.** 기록은 감사에 쓰이고, 반쯤 되돌아간 DB는 남기지 않는다. 되돌린 것을 다시 하기(redo)는 없다.
- **agent에게는 app-api가 tool로 보인다.** 앱 할당, release 선언, agent grant의 교집합만 tool 정의가 되고 사람이 뺀 app-api는 요청에 아예 없다. 효과(read, write, external)는 tool 정의에 싣지 않고 core가 blueprint 선언에서 읽어 Gate에 쓴다. 조사한 harness 모두 정의에 효과를 싣지 않고 호출 때 판정한다. tool 이름은 parse하지 않고 정의 목록이 (앱, api)를 안다.
- **session rewind가 앱 data를 저절로 되돌리지 않는다.** 시점 단위라 그 사이 다른 쪽의 변경도 함께 사라지기 때문이다. 사람이 앱을 골랐을 때만, 함께 되돌아갈 목록을 보인 뒤 같은 rewind로 간다(Claude Code의 rewind 메뉴가 코드와 대화를 따로 고르게 하는 것과 같다).

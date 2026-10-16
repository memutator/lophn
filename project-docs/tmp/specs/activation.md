# S7. release와 activation

상태: **확인됨** (2026-10-15). 요구로 정해진 것은 ID로 건다. 11장의 결정은 사람이 확인했다(docs-review).

## 1. 범위

coding agent가 준비한 release가 운영 앱이 되는 길이다. release 준비의 요건, activation을 여는 계기, 사람에게 묻는 조건, process를 바꾸는 순서, 실패, 이전 release로 돌아가기를 다룬다. 보류 request와 앱 grant의 모양은 S2, drain과 changeset은 S5, coding agent 쪽은 S6, domain event는 S1이 맡는다.

## 2. 한 줄

ticket이 확인됨이 되면 program이 그 ticket에 이은 release를 activate한다(req-1507). 선언이 넓어지거나 data 손실 migration이 있을 때만 사람에게 묻는다(req-0825). 바꾸는 동안 접수를 닫고 비우며, 실패하면 이전 release를 그대로 둔다(req-1508, 0830).

## 3. 부품과 소유

| 부품 | 맡는 일 |
|---|---|
| Releases | release 준비, bundle 고정, 이전 활성 release와의 선언 비교 |
| Activation handler(Reactor) | activation을 열고 순서를 지휘한다 |
| App runtime | drain, process 교체와 시작 확인 |
| App data | 복구본, migration |
| Approvals | 묻는 경우의 보류 request(S2 6장) |
| Grants | 앱 grant를 새 선언과 맞춘다(req-0860) |
| Invocations | 이전 release의 changeset을 지운다(S5 6장) |
| App tickets | 확인됨, release 잇기 |

## 4. release 준비

요구가 정해 두었다. coding agent가 CLI로 요청한다.

- 맡은 ticket의 지금 claim 아래에서만 받고 근거를 ticket에 잇는다(req-1353).
- 연결된 source의 지정한 commit 파일로 bundle을 만든다(req-0812). 의존을 넣는다(req-0811).
- blueprint가 부적합하지 않고, 같은 bundle hash로 실제 돌린 app test가 통과해야 한다(req-0817). 필수 검사가 든다(req-0818, 0820).
- bundle은 고정되고 test 뒤 byte가 바뀌지 않는다(req-0806).
- 준비만으로는 activate되지 않는다(req-1507). 준비 끝남은 domain event가 아니다(S1 5장).

## 5. activation을 여는 길

1. App Engineer가 `ticket.verify(result: verified)`를 부른다(S4 4장).
2. App tickets가 ticket을 확인됨으로 두고, 같은 tx로 domain event `TicketVerified`를 남긴다.
3. Reactor의 activation handler가 그 ticket에 이은 release를 찾는다. 이은 release가 없거나 이미 활성이면 아무것도 하지 않는다. 이은 release가 여럿이면 가장 새로 준비된 release를 고른다.
4. 6장의 조건으로 묻는지 판정한다.

- domain event로 두는 이유: 꺼졌다 켜져도 Reactor가 cursor 뒤부터 이어 반응한다(S1). 보류 request의 결정(`ApprovalDecided`)이 handler를 다시 부르는 것과 같은 꼴이다.
- 더 새 release의 activation이 시작되면 이전 release를 기다리던 보류 request는 cancelled다(req-0315).

## 6. 묻는 조건

이전 활성 release와 새 release의 선언을 비교한다(req-0825). program이 결정적으로 판정한다.

| 비교 | 넓어짐 | 근거 |
|---|---|---|
| 바깥 자원(network host, secret, 파일) | 새로 선언한 것이 있다 | S2 4장 앱 grant, req-0859 |
| 다른 앱의 app-api 쓰기 | 새로 선언한 앱이나 app-api가 있다 | req-0802, 0915 |
| data 손실 | migration이 손실이 생길 수 있는 단계를 선언했다(지우는 표나 칸, 좁히는 type) | req-0825, 1520 |

- 이전 활성 release가 없는 첫 activation은 선언 전부를 늘어난 것으로 보고 묻는다(req-0825, AGENT-ROLE H2).
- 셋 다 아니면 묻지 않고 바로 7장으로 간다.
- 하나라도 있으면 보류 request를 만든다(S2 6장, `ApprovalRequested`). 카드는 program이 선언에서 만들고, 늘어난 선언과 손실 단계를 이전 release와 비교해 보인다(req-0300). 카드에는 늘어난 선언과 손실 단계만 보인다.
- data 손실은 migration의 선언으로 판정한다. DB 사본에서 migration을 돌려 재지 않는다(11장 2). 선언은 믿는다(S2 2장).
- app-api가 더해지는 것은 activation에서 묻지 않는다. agent grant가 효과별 기본값으로 받는다(S2 4장).

## 7. 순서

1. 그 앱에 activation이 이미 돌면 끝날 때까지 줄에 세운다(11장 4). 줄은 메모리다. lophn이 꺼졌다 켜지면 Reactor가 cursor 뒤의 `TicketVerified`부터 다시 반응한다.
2. 새 호출 접수를 닫고 도는 호출이 끝나기를 기다린다. 그 사이 온 호출은 붙잡아 둔다(req-1508). S5 7장 rewind의 drain과 같다.
3. 이전 process의 종료를 확인한다(req-0850).
4. migration이 있으면 변경 전 복구본을 확보하고(req-0952) 지금 번호부터 목표까지 단계를 순서대로 적용한다(req-0957). 결과를 남긴다(req-0959).
5. 새 process를 시작하고 시작 확인을 한다(req-0830).
6. **성공:** 새 release를 활성으로 둔다. 앱 grant는 새 선언과의 교집합이다(req-0860). 이전 release의 changeset을 지운다(S5 6장). 붙잡은 호출을 새 release에 넘긴다(req-1508). 복구본을 지운다(req-0954).
7. **실패:** 복구본으로 되돌리고 무결성과 schema를 확인한 뒤 이전 release를 다시 시작한다(req-0960). 붙잡은 호출을 이전 release에 넘긴다(req-1508). 실패 이유를 남기고(req-0830) domain event `ReleaseActivationFailed`로 그 앱의 App Engineer를 부른다(S1 5장, AGENT-ROLE E3).

## 8. 이전 release로 돌아가기

- 이것도 activation이다. 지금 data schema와 같은 release만 고를 수 있다(req-0832).
- 새 release가 업무를 받기 시작한 뒤에 돌아가면 앱 code만 바뀌고 DB는 그대로다(req-0961).
- 7장의 순서를 따르되 migration이 없다.
- 사람만 한다(11장 3). App Engineer는 필요하면 사람에게 올린다.

## 9. 다른 spec과 닿는 곳

- S1: domain event `TicketVerified`를 더한다(5장). `ReleaseActivationFailed`는 이미 있다.
- S2: 보류 request와 결정, 앱 grant.
- S5: drain을 같이 쓰고, activation이 끝나면 이전 release의 changeset을 지운다. rewind는 release를 넘지 않는다.
- S6: coding agent가 release를 준비하고 ticket에 잇는다.

## 10. 지울 옛 것

- release 준비가 끝나면 activation으로 이어지던 길과 `ReleasePrepared` domain event(S1에서 지움).
- activation 전 DB 사본에서 migration을 돌려 재던 단계(docs-review, S7로 미뤘던 안).
- 시작과 확정 때 비교 기준을 다시 확인하던 것, activation 중 grant 변경 거절(req-0828, 0829 rejected).

## 11. 다시 따진 것

1. **정함(사람, 2026-10-15): activation의 계기는 domain event `TicketVerified`다.** 꺼졌다 켜져도 Reactor가 이어 가고, 보류 request의 결정과 같은 길이다. S1 5장에 더했다.
2. **정함: data 손실은 migration의 선언으로 판정한다.** DB 사본에서 돌려 재지 않는다. 선언은 믿는다(S2 2장). 새 req-1520.
3. **정함: 이전 release로 돌아가기는 사람만 한다.** 앱을 쓰는 모두에게 영향이 가는 일이라 앱 rewind(S5 11장 1)와 같다.
4. **정함: activation이 겹치면 앱마다 하나씩 줄에 세운다.** coding session을 줄에 세우는 것(S6)과 같다.

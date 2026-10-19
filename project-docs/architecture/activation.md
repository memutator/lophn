# activation

coding agent가 준비한 release가 운영 앱이 되는 순간이다. 도는 앱 process, 앱 DB, 앱 grant, 들어오는 호출을 한꺼번에 바꾸는 일이라 여러 module(app-releases, app-runtime, app-data, approvals, app-tickets)이 순서를 지켜야 한다. 도중에 core가 꺼지거나 새 release가 뜨지 못해도 앱이 반쯤 바뀐 채 남으면 안 된다. 이 문서는 activation을 여는 계기, 사람에게 묻는 조건, 바꾸는 순서와 실패 때 되돌리는 약속을 다룬다.

## 흐름

```
 app-tickets: ticket 확인됨 ─ TicketVerified(domain event, 같은 tx) ─▶ Ledger ─▶ Reactor
   activation handler (app-releases)
     ticket에 이은 prepared release를 찾는다 (없거나 이미 활성이면 끝)
     선언 비교: 새 선언 중 지금 active 앱 grant가 안 덮는 것 / 첫 activation / migration의 loss 선언
       ├ 늘지 않음 ──────────────────────────────────────────────┐
       └ 늘었음 ─▶ 보류 request (approvals) ─▶ 사람이 허락 ─▶ ApprovalDecided ─▶ handler ─┤
                                                                                             ▼
                                                       앱마다 하나만 돈다 (메모리. 돌고 있으면 conflict로 거절)
 시도 하나:
   1 접수를 닫고 도는 호출이 끝나길 기다린다 (app-runtime). 그 사이 온 호출은 붙잡아 둔다
   2 이전 process의 종료를 확인한다 (supervision)
   3 종료된 실제 DB의 schema와 무결성을 읽는다 (app-data worker)
   4 migration이 있으면 복구본을 만들어 ledger에 확정한 뒤 단계를 순서대로 적용한다
   5 새 process를 준비 모드로 띄워 hash, handler, schema, 연결을 확인한다. 업무 통로는 닫혀 있다
   6 complete, 한 tx: active 참조, 이전 superseded, 앱 grant를 새 선언에 맞춤, 복구본 정리
   7 업무 통로를 열고, 접수를 다시 열어 붙잡은 호출을 활성 release로 넘기고, 이전 release의 changeset을 지운다
 6 전에 실패 ─▶ 종료 확인 ─▶ 복구본 복원과 확인 ─▶ fail, 한 tx: 실패 기록 + ReleaseActivationFailed ─▶ 이전 release를 다시 띄움
```

- 이전 release로 돌아가기도 같은 순서다. 사람만 시작하고, 지금 활성 release와 data schema가 같은 release만 고른다. migration이 없어서 앱 code만 바뀌고 DB는 그대로다.
- 앱 process의 실제 권한은 선언과 active 앱 grant의 교집합으로 만든 flag다. 앱 code가 선언을 어겨도 flag 밖은 열리지 않는다.

## 지키는 것

계기와 묻는 조건
- 계기는 ticket 확인됨이고 release 준비만으로는 시작하지 않는다. App Engineer가 검증하기 전의 것을 운영에 올리지 않으려는 것이다.
- app test가 되돌리기를 증명하지 못한 write tool(만든 입력의 호출이 실패함)은 activation을 막지 않는다. examples ticket이면 examples run이 남은 것을 앱 problem으로 알린다(`coding-agent.md`). 막으면 앞선 상태가 있어야 하는 tool을 가진 정상 앱이 올라가지 못한다.
- 계기가 domain event라서 꺼졌다 켜져도 Reactor가 이어 간다. handler는 다시 불려도 안전하다. 이은 release가 prepared가 아니면 아무것도 하지 않는다.
- 묻는지는 program이 선언으로 결정적으로 판정한다. 늘어난 바깥 자원, 늘어난 다른 앱 tool 쓰기, migration이 선언한 loss, 이전 활성 release가 없는 첫 activation이다. 아무것도 늘지 않으면 묻지 않는다. 앱 자신의 tool이 더해지는 것은 묻지 않고 agent grant의 효과별 기본값이 받는다.
- data 손실은 migration 파일 머리의 `-- loss:` 줄이 유일한 출처다. 줄이 틀리면 release 준비가 거절된다. 선언을 믿으니 사본에서 돌려 재지 않는다.
- 사람이 허락한 비교와 시작할 때의 비교가 다르면 다시 판정해 다시 묻는다. 기다리는 사이 grant가 바뀔 수 있다.
- 새 release가 다른 domain이 쓰는 공개 tool을 지우면 activation은 시작되지 않고 release는 `prepared`로 남는다. 막기는 machine command `activation.block`이 막힌 사실을 event와 같은 tx로 남긴다(오류를 내는 command는 event를 되돌리기 때문이다).
- release가 active가 되어 공개 tool이 바뀌거나 지워지면 그 tool의 domain과 그 tool을 쓰는 다른 domain마다 `PublicToolsChanged{domain, change: changed}`를 낸다(domain마다 하나). 받는 쪽은 그 domain 그릇의 Project Manager나 App Engineer다. 막혔을 때는 `change: blocked`를 지운 tool의 domain마다 낸다. 그 domain은 이 앱의 것이라 받는 쪽은 그 앱의 App Engineer다. 단위와 규칙은 `architecture/domain.md`다.
- 보류 request는 approvals의 `Approvals` port(`request(id)`, `pending()`)로만 읽는다. approvals 표를 건너 읽으면 그 표 모양이 바뀔 때 activation이 조용히 깨진다.
- 앱마다 한 번에 하나만 돌고, 겹치면 줄에 세우지 않고 `conflict`로 거절한다(이전 release로 돌아가기 요청도 같다). 거절된 `prepared` release는 저절로 다시 시작하지 않는다. 새 ticket 확인이나 새 release가 계기다. 실패는 다시 시도하지 않고 실패로 끝낸다.
- 끝내지 못한 시도(종료 확인이나 복원이 unavailable)는 앱을 붙든 채로 두고, 매 sweep이 ledger의 진행 중 시도를 보고 이어받는다. 이미 켜진 새 판의 data를 복구본으로 덮지 않게 하는 장치라 남긴다. 돌고 있는 메모리 상태는 꺼지면 사라지지만 Reactor가 cursor 뒤의 event부터 다시 반응한다.

순서
- 앞 단계가 확인되지 않으면 뒤 단계를 시작하지 않는다. 특히 이전 process의 종료를 확인하기 전에는 DB 작업도 새 process도 없다. 두 process가 한 DB를 열면 안 된다. 종료가 확인되지 않으면 진행하지 않는다.
- migration의 출발 schema는 ledger 값이 아니라 종료 뒤 읽은 실제 DB의 값이다. 기록과 실제가 어긋날 수 있다.
- 복구본이 ledger에 확정된 뒤에만 migration을 시작한다. 확정 전에 꺼지면 복원할 근거가 없다.
- 새 process는 준비 모드로 확인까지만 하고 업무 통로는 complete가 commit된 뒤에 연다. 그 전에 업무가 들어오면 실패해도 되돌릴 수 없는 쓰기가 생긴다.
- complete 뒤에는 그 후보 process가 그대로 운영 process가 된다. 다시 띄우는 것은 complete가 앱 grant를 바꿔(넓어진 선언을 허락) flag가 달라질 때 한 번뿐이다. 앱 process를 바꿀 때 끝내는 credential은 그 앱의 app credential이고, 같은 앱의 coding token은 coding session이 끝날 때까지 남는다.
- complete는 한 tx다. active 참조, grant 맞춤, 복구본 정리가 따로 있으면 어디서 끊겨도 중간 상태가 남는다. complete는 같은 시도인지와 실제 데이터 결과, 준비 확인을 core가 다시 검사한다.
- 도는 호출이 유예 안에 끝나지 않으면 결과 모름으로 닫고 강제로 멈춘다. 호출 접수는 성공이든 실패든 끝에 다시 연다. 닫힌 채 두면 앱이 영영 안 받는다.

실패와 복구
- commit 뒤의 실패(업무 통로를 못 엶)는 복원하지 않고 같은 release를 다시 띄운다. ledger가 이미 새 release를 채택했고, 옛 복구본으로 덮으면 새 release가 받은 데이터를 잃는다.
- 복구본 복원이나 확인이 실패하면 이전 code도 띄우지 않고 앱을 사용 불가로 둔다. data와 code의 schema가 맞지 않는 앱을 띄우면 더 망가진다.
- 끊긴 시도(core 재시작, 응답 유실)는 ledger가 말하는 대로 잇는다. 채택됐으면 그 release를 다시 띄우고, 진행 중이면 알려진 복구본으로만 복원한다. 모르는 migration script를 다시 적용하지 않는다.
- 실패 기록과 `ReleaseActivationFailed`는 같은 tx다. 기록이 없는 실패나 기록만 있고 App Engineer가 모르는 실패가 없게 한다.
- 더 새 release의 activation이 시작되면 이전 release를 기다리던 보류 request를 취소한다.

## 왜 이 모양인가

- 계기를 "release 준비 끝남" event로 하지 않았다. 준비는 coding agent의 일이고 운영에 올리는 판단은 ticket 확인됨이 한다. 준비 끝남은 domain event가 아니다.
- 계기를 domain event로 둔 이유는 보류 request의 결정(`ApprovalDecided`)이 handler를 다시 부르는 것과 같은 꼴이라서다. 별도 트리거나 polling을 두지 않는다.
- 묻는 판단에서 DB 사본에 migration을 돌려 손실을 재는 안을 버렸다. 선언을 믿는 철학과 어긋나고 data가 크면 비싸다. 대신 migration이 있으면 늘 복구본을 먼저 확정해 둔다.
- 새 process를 commit 전에 준비 모드로 먼저 띄우는 이유는, commit 뒤에 띄우다 실패하면 이미 바뀐 active 참조를 되돌려야 하기 때문이다. 확인이 끝난 것만 commit한다.
- 이전 release로 돌아가기를 사람에게만 열었다. 앱을 쓰는 모두에게 영향이 가는 일이고, 앱 rewind와 같은 이유다. 돌아가도 DB는 되돌리지 않는다. data를 거꾸로 돌리는 것은 별개의 위험이라 schema가 같을 때만 허락한다.
- core는 앱 DB를 열지 않는다. DB 작업은 supervisor가 띄우는 data worker가 하고 core는 복구본 byte를 흘려 보내기만 한다. 앱 DB는 그 앱의 process만 여는 규칙을 지키려는 것이다.
- 시작 요청의 줄과 30초 재시도를 두지 않는다. 앱마다 줄을 세우면 기다리는 release와 다시 묻는 시점이 메모리에 쌓이고, 재시도는 같은 실패를 되풀이한다. 겹치는 일은 드물어 거절하고 계기를 기다리는 쪽이 단순하다.

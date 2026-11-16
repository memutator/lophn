# activation

앱 workspace의 session이 준비한 release가 운영 앱이 되는 순간이다. 도는 앱 process, 앱 DB, 앱 grant, 들어오는 호출을 한꺼번에 바꾸는 일이라 앱의 release·runtime·data 세 영역(`app-releases`, `app-runtime`, `app-data`)이 순서를 지켜야 한다. 도중에 core가 꺼지거나 새 release가 뜨지 못해도 앱이 반쯤 바뀐 채 남으면 안 된다. 이 문서는 activation을 여는 계기, 사람에게 묻는 조건, 바꾸는 순서와 실패 때 되돌리는 약속을 다룬다.

## 문제

release를 운영에 올리면 일이 한꺼번에 바뀐다. 이전 process를 끄고, DB를 새 schema로 옮기고, 새 process를 띄우고, 앱이 받을 권한을 새 선언에 맞추고, 그 사이 들어온 호출을 어디로 보낼지 정해야 한다. 이 중 하나만 되고 멈추면 두 process가 한 DB를 열거나, 옛 code가 새 schema 위에서 돌거나, 사람이 허락하지 않은 권한이 켜지거나, 사람이 쌓은 data가 옛 복구본으로 덮인다. 복구 못 하는 쪽은 앱의 data와 사람의 신뢰다.

또 사람이 모르는 사이 앱이 더 넓은 권한을 얻거나 data를 잃으면 안 된다. 그렇다고 사람 물음을 매번 끼우면 agent가 앱을 고치는 흐름이 막힌다. 늘어난 것만 묻고 나머지는 묻지 않아야 한다.

## 목표와 비목표

- 목표: release 하나가 운영 앱이 되거나, 실패하면 이전 release와 data가 그대로인 상태로 돌아간다. 중간 상태가 남지 않는다.
- 목표: 권한·data 손실이 늘어나는 activation만 사람에게 묻고, 묻는 판정은 program이 선언 사실로 결정적으로 한다.
- 목표: core가 꺼지거나 응답이 끊겨도 ledger를 근거로 이어받는다.
- 비목표: activation을 줄 세우지 않는다. 겹치면 거절하고 다시 시작은 사람이나 agent가 한다(아래 결정).
- 비목표: 저절로 동의하는 장치. unattended에서도 동의는 사람이 한다.
- 비목표: data를 거꾸로 돌리는 migration. 이전 release로 돌아가도 DB는 되돌리지 않는다.
- 비목표: release 준비. 준비는 이 문서의 앞 단계이고 activation은 `prepared`인 release만 받는다.

## 모델

release의 상태는 `prepared`, `activating`, `active`, `superseded`, `failed`다. 앱의 한 시점 운영 release는 하나이고 그것을 가리키는 참조(active 참조)를 바꾸는 순간이 activation의 commit이다.

```
 앱 workspace session: release.activate {release}
   prepared release가 아니거나 그 앱의 시도가 돌고 있으면 conflict
   선언 사실(facts) 비교: 새 선언 사실 중 지금 active 앱 grant가 안 덮는 것 / 첫 activation / migration의 loss 선언
     ├ 늘지 않음 ──────────────────────────────────────────────────────────────┐
     └ 늘었음 ─▶ 동의 대기(activation_consents), waiting_consent를 바로 돌려준다   │
                ─▶ 사람이 동의(activation.consent) ─▶ 시작 sweep ───────────────┤
                                                                                 ▼
                                                  앱마다 하나만 돈다 (겹치면 conflict로 거절)
                                                  release.activate는 시도의 끝을 120초까지 기다려
                                                  active·failed를, 넘으면 running을 돌려준다
 시도 하나:
   1 호출 접수를 닫고 도는 호출이 끝나길 기다린다. 그 사이 온 호출은 붙잡아 둔다
   2 이전 process의 종료를 확인한다
   3 종료된 실제 DB의 schema와 무결성을 읽는다
   4 migration이 있으면 복구본을 만들어 ledger에 확정한 뒤 단계를 순서대로 적용한다
   5 새 process를 준비 모드로 띄워 hash, handler, schema, 연결을 확인한다. 업무 통로는 닫혀 있다
   6 complete, 한 tx: active 참조, 이전 superseded, 앱 grant를 새 선언 사실에 맞춤, 복구본 정리
   7 업무 통로를 열고, 접수를 다시 열어 붙잡은 호출을 활성 release로 넘기고, 이전 release의 changeset을 지운다(폰에서도 도는 앱이면 옛 release의 sync log 줄도 지우고 새 release에 '다시 snapshot' 줄을 남긴다)
 6 전에 실패 ─▶ 종료 확인 ─▶ 복구본 복원과 확인 ─▶ fail, 한 tx: 실패 기록 ─▶ 이전 release를 다시 띄움
```

- 선언 사실은 release 선언에서 권한 요구, 다른 앱 tool 쓰기, tool 이름만 뽑아 준비 때 한 번 계산해 release 행의 `facts` 열에 둔 값이다. 동의를 묻는 판정과 complete의 grant 맞춤이 이 값만 본다.
- 권한 요구 가운데 `phone.use`(scope `{capability}`, 지금은 `location.get`)는 앱이 사람의 폰 기능을 쓰겠다는 요구다. 앱마다 한 번 이 동의 카드가 묻고 카드는 항목 "Phone"에 "Use your phone's location"을 보인다(앱 상세의 권한에도 같은 글이 선다. 이 줄은 desktop 창에서 보지 못했다). 기능을 더 선언한 release는 늘어난 선언으로 다시 묻는다. 허락은 grant가 되고 사람이 거둘 수 있다(`remote.md`). 이것은 lophn의 동의이고 OS의 위치 권한은 폰이 처음 쓸 때 따로 묻는다.
- 이전 release로 돌아가기도 같은 순서다. 사람만 시작하고(요청 행 `activation_requests`), 지금 활성 release와 data schema가 같은 `superseded` release만 고른다. migration이 없어서 앱 code만 바뀌고 DB는 그대로다.
- 시도가 멈출 수 있는 곳은 둘이다. 닫혀 끝난 시도(`active` 또는 `failed`)와 앱을 붙든 채 멈춘 시도(`held`)다. held는 복원이나 종료를 확인하지 못해 앱을 사용 불가로 두고 이전 release도 띄우지 않은 상태이고, 매 sweep이 이어받는다.
- 다른 기계가 sync 폴더에 내놓은 앱(`folder-sync.md`)은 `app.take_in`이 이 기계에 들인다. 같은 앱 id로 등록하고(앱 id를 고를 수 있는 것은 폴더 take-in 자격 `machine:folder-apps` 하나다) 폴더의 봉인 bundle을 전부 검사한 뒤 그대로 설치해 `prepared` release로 적는다(`created_by`는 `machine`). 이미 들인 앱이면 release만 설치한다. activation은 이 문서의 길 그대로다: 이 기계의 `release.activate`가 시작하고, 이 기계에는 그 앱의 grant가 없으니 첫 activation은 이 기계에서 사람의 동의를 묻는다. grant, 동의, secret, OAuth는 기계를 넘지 않는다.
- **다른 기계의 release 따라가기.** 폴더로 맞추는 앱(`sync_to`, `folder-sync.md`)은 그 앱을 들인 다른 기계가 새 release를 활성하면 이 기계가 스스로 따라간다. 따라갈 release는 다른 기계들의 앱 기록이 말하는 활성 release 가운데 git 조상으로 고른다: commit이 지금 활성 commit의 자손이고 data schema가 낮지 않은 것만 후보이고, 여럿이면 나머지 모두의 자손 하나로 바로 간다(migration은 누적이라 중간 release를 건너뛴다). 고른 release는 들이기(take-in)와 같은 길로 봉인 bundle 그대로 `prepared`에 설치하고(`created_by` `machine`) 위의 시도에 넘긴다. 시도와 동의 판정은 `release.activate`와 같다. 계기는 core 시작, 폴더 scan과 source 받기 뒤, 그 앱의 release 상태 바뀜, 동의 닫힘이다. 상태(`current`, `installing`, `activating`, `waiting_consent`, `declined`, `lophn_update`, `install_failed`, `activation_failed`, `diverged`)는 `apps/update_state`와 App details의 Machines 절이 보인다.
- 앱 process는 권한 flag 없이 뜬다(사람이 정했다).
- 실행 허용(`run_enabled`)은 activation과 별개의 사람의 스위치다. 사람이 끄거나 보관하면 꺼지고, 보관을 되살려도 꺼진 채라 사람이 켜야 한다. activation이 대신 켜지 않는다. 사람의 입구는 App details 탭의 Run 절이다. 켜는 것은 active 보관 상태와 채택한 release가 있을 때만 받는다. 이미 켜진 채 crash loop로 멈춘 앱(10분 창, 다섯 번 초과)은 `AppRestartHalted`가 알리고, 사람의 동작이 있어야 다시 뜬다. 사람이 Run을 켜거나 새 release를 활성화하면 종료 기록(crash 창)을 비우고 다시 띄운다. 그 밖에는 스스로 다시 시도하지 않는다.

## 지키는 것

계기와 묻는 조건
1. 계기는 앱 workspace session의 `release.activate`다. release 준비만으로는 시작하지 않는다.
2. `release.activate`는 시작한 시도의 끝을 120초까지 기다린다. 넘으면 `running`을 돌려주고 시도는 core 안에서 이어 가며, session은 `app.status`와 `release.get`으로 본다. 120초는 `shell.run`의 기본 timeout과 앱 tool 호출 상한과 같아 tool 하나가 turn을 이보다 오래 붙들지 않는다.
3. 동의를 기다리면 `release.activate`는 기다리지 않고 `waiting_consent`를 돌려준다. 동의 뒤의 시작은 sweep이 한다. 결과는 `activation.report`로 release를 만든 session에 notice로 간다(아래 실패와 복구의 `activation.report`).
4. 묻는지는 program이 선언 사실로 결정적으로 판정한다. 늘어난 바깥 자원, 늘어난 다른 앱 tool 쓰기, migration이 선언한 loss, 이전 활성 release가 없는 첫 activation이다. 아무것도 늘지 않으면 묻지 않는다.
   - secret의 OAuth 칸(끝점, scope, 추가 parameter)이 바뀐 것도 늘어난 바깥 자원이다. 비교가 정규화한 scope 전체를 맞추므로 순서만 바뀐 것은 묻지 않는다. 동의 화면은 authorize host, refresh token이 갈 token host, scope를 보인다.
   - 앱 자신의 tool이 더해지는 것은 묻지 않는다. 그 앱을 할당받은 agent는 새 tool도 묻지 않고 쓴다(할당이 허락이다, `architecture/approval.md`).
5. data 손실은 migration 파일 머리의 `-- loss:` 줄이 유일한 출처이고, 줄이 틀리면 release 준비가 거절된다. 선언을 믿으니 사본에서 돌려 재지 않는다.
6. 사람이 동의한 비교와 시작할 때의 비교가 다르면 다시 판정해 다시 묻는다. 기다리는 사이 앱 grant가 바뀔 수 있다.
7. 새 release가 다른 workspace가 쓰는 공개 command를 지워도 activation은 막지 않는다. `release.prepare`가 결과의 `removed_public_tools`에 그 command를 싣고, 그 앱 workspace의 session이 정한다(`architecture/app-call.md`).
8. 앱마다 한 번에 하나만 돌고, 겹치면 줄에 세우지 않고 `conflict`로 거절한다(이전 release로 돌아가기 요청도 같다). 거절된 `prepared` release는 저절로 다시 시작하지 않는다. 앱 workspace의 session이 다시 부르거나 새 release를 준비한다. 실패는 다시 시도하지 않고 실패로 끝낸다.
9. 끝내지 못한 시도(종료 확인이나 복원이 `unavailable`)는 앱을 붙든 채로 두고, 매 sweep이 ledger의 진행 중 시도를 보고 이어받는다. 이미 켜진 새 판의 data를 복구본으로 덮지 않게 하는 장치다. 돌고 있는 메모리 상태는 꺼지면 사라지고 ledger의 진행 중 시도로 잇는다.

동의
10. 동의는 activation의 상태이고 approvals를 거치지 않는다. 묻기는 machine 자격의 `activation.ask_consent`가 `activation_consents` 표에 줄을 쓰고, 사람이 `activation.consent`(사람 자격만, compare `{requested_at}`)로 허락하거나 거절한다.
11. 동의 대기와 허락은 표에 남아 재시작을 넘는다. 허락은 `allowed_at`으로 남긴다. 대기를 메모리에 두면 재시작 때 사라지는데 `release.activate`를 부른 turn은 이미 `waiting_consent`를 받고 끝나 다시 묻는 쪽이 없고, 허락만 메모리로 넘기면 commit 뒤 시작 전에 꺼질 때 허락을 잃는다. 허락한 줄은 sweep이 시작한다.
12. 같은 release는 한 줄이다. 같은 release를 다시 `release.activate`해도 같은 비교면 줄과 카드가 늘지 않는다. 비교가 달라졌으면 줄을 덮어 다시 기다린다(`requested_at`이 바뀌어 옛 카드의 동의는 `conflict`다).
13. 거절은 줄을 지우고 release는 `prepared`로 남는다. 이유를 받지 않는다(읽는 곳이 없다).
14. 더 새 release의 activation이 시작되면 그 앱의 동의 줄을 모두 닫는다(기다리던 것은 `cancelled`). 낡은 동의가 새 release에 쓰이면 안 된다. 시작과 같은 tx다.
15. 같은 앱에 열린 앱 공유 요청(`architecture/approval.md`)이 있으면 동의 카드가 그 요청(받을 agent, coding agent, 이유, 받게 되는 공개 skill·command 수)을 같이 보이고, 허락하면 같은 tx에서 그 요청도 승인한다.
    - `activation.consent`의 선택 입력 `share_requested_at`이 카드가 본 요청의 `requested_at`이고, 지금 열린 요청과 다르거나 없으면 동의째 `conflict`다(사람이 보지 못한 요청을 승인하지 않는다).
    - 공유가 먼저 적용되고 실패하면 tx가 되돌아가 동의는 대기로 남는다. 거절은 공유 요청을 건드리지 않아 공유 요청이 제 줄로 다시 보인다.
    - approvals를 import하지 않으려고 activation은 port만 부르고 구현은 조립이 꽂는다.
16. unattended에서도 동의는 사람이 한다. 저절로 동의하는 장치를 두지 않는다.

순서
17. 앞 단계가 확인되지 않으면 뒤 단계를 시작하지 않는다. 특히 이전 process의 종료를 확인하기 전에는 DB 작업도 새 process도 없다. 두 process가 한 DB를 열면 안 된다. 종료가 확인되지 않으면 진행하지 않는다.
18. migration의 출발 schema는 ledger 값이 아니라 종료 뒤 읽은 실제 DB의 값이다. 기록과 실제가 어긋날 수 있다.
19. 복구본이 ledger에 확정된 뒤에만 migration을 시작한다. 확정 전에 꺼지면 복원할 근거가 없다.
20. 새 process는 준비 모드로 확인까지만 하고 업무 통로는 complete가 commit된 뒤에 연다. 그 전에 업무가 들어오면 실패해도 되돌릴 수 없는 쓰기가 생긴다.
    - 후보의 시작 code가 broker를 부르는 것은 채택 중에만 일어난다(process를 먼저 띄우고 commit으로 release를 active로 잇는다). broker는 supervisor가 아는 후보(prepare로 띄웠고 아직 열리지 않은 자식)에게만 예외를 둔다: 읽기뿐인 `sessions`는 그 release의 선언으로 답하고, 발행·net·secret·notify(위젯 값 포함)·폰 요청은 `forbidden`이 아니라 `unavailable`(곧 된다, 다시 시도)이다. core의 발행과 알림이 active release를 보고 일하기 때문이다. 교체된 옛 release의 자식은 후보가 아니므로 그대로 `forbidden`이다.
21. complete 뒤에는 그 후보 process가 그대로 운영 process가 된다. 다시 띄우지 않는다. 앱 process를 바꿀 때 끝내는 credential은 그 앱의 app credential이다. 같은 앱 조건의 agent credential(coding session의 CLI 등)은 남는다.
22. complete는 한 tx다. active 참조, grant 맞춤, 복구본 정리가 따로 있으면 어디서 끊겨도 중간 상태가 남는다. complete는 같은 시도인지와 실제 데이터 결과, 준비 확인을 core가 다시 검사한다.
23. 도는 호출이 유예(30초) 안에 끝나지 않으면 결과 모름으로 닫고 강제로 멈춘다. 호출 접수는 성공이든 실패든 끝에 다시 연다. 닫힌 채 두면 앱이 영영 안 받는다.

실패와 복구
24. commit 뒤의 실패(업무 통로를 못 엶)는 복원하지 않고 같은 release를 다시 띄운다. ledger가 이미 새 release를 채택했고, 옛 복구본으로 덮으면 새 release가 받은 데이터를 잃는다.
25. 복구본 복원이나 확인이 실패하면 이전 code도 띄우지 않고 앱을 사용 불가로 둔다. data와 code의 schema가 맞지 않는 앱을 띄우면 더 망가진다.
26. 끊긴 시도(core 재시작, 응답 유실)는 ledger가 말하는 대로 잇는다. 채택됐으면 그 release를 다시 띄우고, 진행 중이면 알려진 복구본으로만 복원한다. 모르는 migration script를 다시 적용하지 않는다.
27. 앱의 handler 확인(probe)이 선언과 등록된 handler가 안 맞아 거절하면 그 이유가 고칠 tool을 가리킨다. 거절 본문이 빠진 tool(`declared without a handler: …`)과 더해진 tool(`handler not declared: …`)을 각 5개와 `and N more`로 싣고, 그 글이 500자까지 reason에 붙는다. release 준비의 `handlers` 실패 reason이 이 글이다. probe가 통과한 뒤 preview가 하는 비교와 같은 꼴이다.
28. 실패 기록(release의 `failure`: code, summary, 복원했는지)은 fail 한 tx에 남는다. `release.activate`는 끝난 시도의 이 기록을 읽어 돌려준다. complete가 거절되면(`commit_rejected`) 그 거절 message를 summary에 붙인다. 버리면 무엇을 고칠지 아무도 모른다.
29. `release.activate`가 기다리지 않은 시도(동의 뒤, 2분 기다림 상한 뒤, 재시작 뒤 이어받음)가 active나 failed로 끝나면 `activation.report`(machine)가 release를 만든 agent session(`created_by`)에 `activation_finished` notice로 결과(실패면 code, summary, 이전 release가 다시 도는지)를 넣는다. 그 session이 닫혔으면 넣지 않는다. 동의 뒤의 시작은 부른 turn이 이미 끝난 뒤라, 알리지 않으면 agent는 실패를 모르고 사람은 화면 어디에서도 이유를 듣지 못한다.
30. 사람에게 남는 기록(`architecture/app-notice.md`의 program 줄)은 결과를 확정하는 command와 같은 tx에서 쓴다. 한 시도에 한 줄이라 재전송은 줄을 늘리지 않는다(이미 끝난 시도의 재전송은 기록 앞에서 돌아간다).
    - `activation.complete`는 `release_activated {release}`를 남기고, 이미 켜졌던 release를 다시 켠 이전으로 돌아가기면 `release_rolled_back {release: 지금까지 켜 있던 것, to: 돌아간 것}`을 남긴다.
    - `activation.fail`은 `release_failed {release, reason}`을 남긴다. reason은 실패 summary이고 복원했으면 "The app is back on release rN"을 덧붙인다. release 이름은 Version 탭과 같은 `r<number>`다.
    - 데이터 변경·복원 기록(`activation.record_data_change`·`activation.record_data_restore`)은 `app_data_migrated`·`app_data_restored`를, 앱을 사용 불가로 둔 `app.record_unavailable`(복원 실패·종료 확인 불가 포함)은 `app_unavailable`을 같은 tx에서 남긴다.
    - 기록은 `activation.report`와 다른 길이다. report는 만든 agent가 turn 안에서 알게 하는 것이고 기록은 사람이 나중에 찾는 것이다.

폰에서도 도는 앱(`runs_on`에 `phone`. 설계는 `app-sync.md`)
31. release 준비가 폰 backend를 묶고 검사한다(Node 내장 import, 선언과 다른 handler 집합, 정수 PK·AUTOINCREMENT·trigger·PK 밖의 UNIQUE와 CHECK, `@lophn/cap-store` 2.0.0·`@lophn/cap-tool` 2.2.0 아래 판). 어기면 준비가 실패해 activation까지 오지 않는다. activation이 받는 입력은 봉인된 bundle이고 폰 backend도 그 안의 file이다.
32. activation이 옛 release의 changeset을 지울 때 그 앱의 옛 release sync log 줄도 지우고 지운 것이 있으면 새 release에 '다시 snapshot' 줄을 남긴다. 지운 줄을 받지 못한 폰이 새 snapshot을 받게 하려는 것이다. 폰은 같은 release의 변경만 맞추므로 새 release가 활성이 된 뒤 옛 release의 push는 `conflict`다.
33. migration이 표의 칸 목록을 바꾸면 새 release의 첫 시작이 그 표의 칸 clock(칸 번호로 적힌다)을 칸 이름으로 새 번호에 옮기고, 이름이 없어진 칸과 표의 clock만 지운다(`app-sync.md`). data 손실을 말하는 `-- loss:` 줄은 폰에 안 간 변경의 손실에도 그대로 근거다. 폰은 release가 바뀌면 컴퓨터 DB의 snapshot을 받고 안 보낸 변경을 새 schema에 이름으로 다시 얹는다(지운 표와 칸의 변경만 버려진다).
34. standalone 앱(`runs_on`이 `["phone"]`)은 컴퓨터에서 activation 규칙을 그대로 받는다. 컴퓨터의 DB는 폰과 맞추지 않는다.

다른 기계에서 받은 release(설계는 `folder-sync.md`)
35. take-in은 release를 `prepared`로 둘 뿐 activation을 시작하지 않는다. 다른 기계의 동의와 grant는 옮기지 않으므로 그 앱의 첫 activation은 받은 기계에서 사람에게 묻는다. 저절로 동의하는 장치는 여기에도 없다.
36. 받은 release는 다른 기계가 봉인한 bundle 그대로다(기계 사이 신분이 bundle hash다). 받는 기계의 lophn에 없는 SDK 판을 고정한 release는 들이지 않는다(`conflict`, `details.reason: sdk_missing`): 폴더에서 온 code가 그 기계의 SDK 저장소에 들어가지 않는다.
37. sync 앱(`sync_to`)의 활성 release가 바뀌면 그 기계의 다음 내보내기는 snapshot이다. 다른 release의 폴더 변경은 적용하지 않고 held로 복사해 두었다가 이 기계가 그 release가 되면 출처마다 번호 순서로 적용한다(`folder-sync.md`).

다른 기계의 release 따라가기(폴더로 맞추는 앱)
38. 따라가는 activation에는 session이 없다. 동의를 묻는 판정은 1–16 그대로다(늘어난 바깥 자원·다른 앱 tool·`-- loss:`면 이 기계의 사람에게 묻는다). 결과는 activation 기록(앱 notice)과 따라가기 상태로 보이고 `activation.report`는 가지 않는다(알릴 session이 없다).
39. 내려가지 않는다. 다른 기계의 release가 지금 commit의 조상이거나 data schema가 낮으면 따라가지 않는다. 이 기계가 활성했다가 내려놓은 release(사람의 이전으로 돌아가기 포함, `superseded`)와 activation에 실패한 release(`failed`)는 다시 고르지 않는다. 그래서 사람이 한 기계에서 이전으로 돌아가도 다른 기계는 새 release에 남는다.
40. 실패와 거절은 다시 하지 않는다. activation 실패는 release 행에 남아 다시 고르지 않고, 다른 기계가 그 release를 돌리는 동안 `activation_failed`와 실패 이유가 core가 다시 떠도 보인다. 설치 실패, 이 lophn에 없는 SDK 판(`lophn_update`), 사람이 거절한 동의는 core가 도는 동안 같은 bundle을 다시 하지 않고, core가 다시 뜨거나 다른 release가 오면 다시 한다(거절한 release는 다시 묻는다). 기억을 ledger에 두면 schema step이 든다.
41. 갈라진 release는 따라가지 않는다. 후보 둘 이상이 서로 조상이 아니거나, 후보가 없는데 다른 기계의 release가 지금 commit의 자손도 조상도 아니면(두 기계가 따로 release를 냈다) `diverged`를 보이고 지금 release에 남는다. 앱 agent가 합쳐 둘 모두의 자손인 새 release를 내야 풀린다. 번호나 시각으로 고르면 갈라진 code를 오간다.
42. 따라가기의 시도가 다른 시도와 겹치거나(`conflict`, 앞서 따라간 release가 동의를 기다리는 때 포함) 아직 못 하면(`unavailable`, release 폴더가 덜 옴) 그 계기 전의 상태를 두고 다음 계기에 다시 한다.

## 경계와 계약

경계는 앱 release(`app-releases`)가 activation을 주관하고, 앱 process 감독·호출 접수(`app-runtime`)와 앱 DB 작업(`app-data`)을 부른다. 앱 process와의 통신은 `child-supervision-protocol`을 지난다.

| 이름 | 누가 | 무엇 |
| --- | --- | --- |
| `release.activate {release}` | 그 앱 workspace의 agent session | 시도를 열거나 동의를 요청한다. 결과 `active`·`failed`·`waiting_consent`·`running`. 오류 `invalid_input`·`forbidden`·`not_found`·`conflict`·`unavailable` |
| `activation.ask_consent` | machine | `activation_consents`에 줄을 쓴다. 같은 비교면 줄을 늘리지 않는다 |
| `activation.consent` | 사람만 | `allow`·`reject`, compare `{requested_at}`, 선택 입력 `share_requested_at` |
| `activations.consents` | 읽기 | 대기 목록. 앱 id와 함께 앱 이름(`app_name`)을 싣는다 |
| `activation.start` | machine | 시도를 연다(같은 tx에서 그 앱의 동의 줄을 닫는다) |
| `activation.record_backup` | machine | 복구본을 ledger에 확정한다 |
| `activation.record_data_change`·`activation.record_data_restore` | machine | data 변경·복원을 남기고 notice를 쓴다 |
| `activation.complete`·`activation.fail` | machine | 결과를 한 tx로 확정한다. complete가 grant 맞춤까지 한다 |
| `activation.report` | machine | 기다리지 않은 시도의 결과를 만든 session에 알린다 |
| `activation.activate_previous` | 사람만 | 이전 release로 돌아가기 요청 행을 넣는다. 시작은 sweep이 한다 |
| `app.record_unavailable` | machine | 앱을 사용 불가로 두고 `app_unavailable`을 남긴다 |
| `apps/update_state {app}` | 사람, 그 앱 workspace의 agent | 폴더로 맞추는 앱의 따라가기 상태, 기다리는 변경(held), 기계마다의 release와 꼴 판 범위를 읽는다(memory) |

- event(남지 않는다): `ActivationConsentRequested`, `ActivationConsentClosed`, `AppRestartHalted`. 앞 둘과 `AppRestartHalted`, `activations.consents`는 앱 id와 함께 `app_name`을 싣는다. 알림과 대기 목록이 id 대신 이름을 보이게 하고 renderer가 이름을 따로 찾지 않게 하려는 것이다.
- 저장: 표 `activation_consents`(`requested_at`, `allowed_at`)와 `activation_requests`(이전으로 돌아가기), release 행의 `failure`·`facts`, 복구본은 앱마다 최근 하나만 영구 blob으로 둔다.
- 화면: `release.activate`가 `waiting_consent`를 돌려주면 대화에 그 결과로 만든 카드가 선다. 카드는 대기 목록에 그 release 줄이 있는 동안 기다림으로 보이고 [Review]가 대기 panel을 연다.
- 실패 code: `drain_failed`, `schema_changed`, `backup_failed`, `migration_failed`, `start_failed`, `commit_rejected`.

## 결정

- 계기를 release 준비 끝남으로 하지 않고 `release.activate`로 한다. 이유: 준비와 올리기 사이에 앱 workspace의 session이 preview에서 확인한다. 앱 일은 그 앱 workspace의 session이 하니 올리는 것도 그 command다. 버린 안: ticket 확인됨의 domain event와 Reactor handler로 올리기(ticket과 함께 지웠다). (agent)
- `release.activate`는 동의를 기다리지 않고 `waiting_consent`를 돌려주며, 시도는 120초까지 기다린다. program이 App Engineer를 다시 부르지 않는다. (agent, 0.6.0)
- 동의를 generic approval(보류 request와 applier)에서 activation의 상태로 옮겼다. 이유: 보류 request 길을 쓰던 것은 activation과 reaction의 물음 둘뿐이었고, reaction의 물음을 지우자 activation 하나를 위해 표, applier, 결정 event를 둘 이유가 없어졌다. (agent, 0.6.0)
- 동의 대기와 허락은 ledger 표에 둔다. 이유: 메모리에 두면 재시작과 commit 뒤 꺼짐에서 잃는다. (agent, 0.6.0)
- unattended에서 activation을 저절로 동의하는 장치를 두지 않는다. (사람, 2026-10-20)
- 묻는 판단에서 DB 사본에 migration을 돌려 손실을 재는 안을 버렸다. 이유: 선언을 믿는 철학과 어긋나고 data가 크면 비싸다. 대신 migration이 있으면 늘 복구본을 먼저 확정해 둔다. 이 때문에 `-- loss:` 줄이 사람에게 묻는 유일한 근거이고, 단계마다 PRIMARY KEY 검사를 남긴다(없으면 SQLite session이 그 표를 기록하지 않아 rewind가 조용히 틀린다). 닫은 이슈 "migration 단계마다 PRIMARY KEY 검사와 `-- loss:` 줄 파싱"(kept).
- 새 process를 commit 전에 준비 모드로 먼저 띄운다. 이유: commit 뒤에 띄우다 실패하면 이미 바뀐 active 참조를 되돌려야 한다. 확인이 끝난 것만 commit한다.
- 이전 release로 돌아가기를 사람에게만 열고 schema가 같을 때만 허락한다. 이유: 앱을 쓰는 모두에게 영향이 가는 일이고 앱 rewind와 같은 이유다. data를 거꾸로 돌리는 것은 별개의 위험이다.
- core는 앱 DB를 열지 않는다. 이유: 앱 DB는 그 앱의 process만 여는 규칙이다. DB 작업은 supervisor가 띄우는 data worker가 하고 core는 복구본 byte를 흘려 보내기만 한다.
- 시작 요청의 줄과 30초 재시도를 두지 않는다. 이유: 앱마다 줄을 세우면 기다리는 release와 다시 묻는 시점이 메모리에 쌓이고, 재시도는 같은 실패를 되풀이한다. 겹치는 일은 드물어 거절하고 계기를 기다리는 쪽이 단순하다. 허락과 시작 사이에 비교가 달라지면 다시 묻는 검사는 남긴다. 닫은 이슈 "앱별 activation 줄(메모리)과 30초 재시도"(fixed). (agent)
- 끊긴 시도 이어받기는 남긴다. 이유: 기동 때 `activating`을 모두 실패로 닫고 복구본으로 되돌리는 안은 응답 유실 때 이미 채택된 release를 복구본으로 덮는 사고를 낸다. 닫은 이슈 "끊긴 activation 시도를 이어받는다"(kept).
- complete의 일(active 참조, superseded, grant 맞춤, 복구본 정리, 돌아가기 요청 삭제)을 함수로 나누거나 tx를 쪼개지 않는다. 이유: 한 tx여야 하는 이유가 중간 상태 금지이고, 나눠 얻는 것은 읽기 쉬움뿐이다. 닫은 이슈 "복구본 보존과 complete 한 tx에 몰린 일"(kept).
- 앱 source와 겹치는 경로 규칙(grant가 앱 source를 감싸거나 그 안이면 거절)을 지웠다. 이유: 이 검사는 complete의 마지막 commit에서만 돌아 사람의 동의를 다 지난 뒤에 떨어졌고, 막아야 하는 것(앱 code 쓰기와 `secrets.json`·다른 앱 data 같은 data root)을 정확히 막지 못했다. `~/.lophn`을 지키는 장치는 사람의 동의 화면뿐이다. (사람, 0.13.0)
- 기다리지 않은 시도의 결과는 release를 만든 session에 알린다. 이유: 동의 표에는 부른 session이 없고, release를 만든 session과 activate를 부른 session은 보통 같다. 버린 안: 동의 표에 session을 더하기(schema migration이 필요하다). (agent, 0.13.0)
- 앱 공유 요청을 activation 동의와 한 번에 승인한다. 이유: 사람이 command를 만들고 grant하는 것까지 agent가 알아서 하기를 바랐고, 사람의 승인은 남기되 한 번으로 줄였다. (사람, 2026-11-07) 카드가 본 공유 요청이 바뀌었으면 동의째 `conflict`, 공유 적용이 실패하면 동의는 대기로 남음, 거절은 공유 요청을 건드리지 않음은 agent가 정했다.
- take-in은 prepared release만 두고 동의는 받은 기계에서 사람이 한다. 이유: grant와 동의는 그 기계에서 앱이 닿는 자원의 허락이고, 기계마다 secret과 폴더가 다르다. 동의를 옮기면 사람이 보지 않은 기계에서 앱이 돈다. (planner)
- 폴더 take-in만 앱 id를 정해 등록한다. 이유: 기계 사이 같은 앱은 같은 id여야 data stream과 기록이 이어지고, 그 밖의 등록이 id를 고르면 다른 앱의 id를 가로챌 수 있다. (planner, agent)
- 앱 알림과 toast가 앱 id가 아니라 앱 이름을 보이도록 event와 읽기에 `app_name`을 싣는다. 이유: renderer가 이름을 따로 찾지 않게 한다. (agent, 0.13.0)
- 대화의 동의 카드 종류는 tool 이름이 아니라 결과를 보고 정하며, `release.activate`가 성공해 끝난 뒤에만 선다. 이유: 이름만으로 정해지는 종류는 시작 때부터 줄이 서야 하는데, `consent`는 결과(동의 대기)를 봐야 안다. (agent, 0.18.0)
- 사람에게 남는 기록(program 줄)은 상태를 바꾸는 command와 같은 tx에서 쓴다. 이유: 재전송과 끊김에서 빠지거나 늘지 않는다. (agent, 0.20.0)
- crash loop로 멈춘 앱은 사람의 동작(Run 켜기, 새 release 활성화)이 crash 창을 비우고 다시 띄운다. 창이 지난 뒤 supervisor가 스스로 다시 시도하지 않는다. 이유: 같은 원인이면 다섯 번 더 죽고 멈춰 이유 없이 느리다. 닫은 이슈 "crash loop로 자동 재시작이 멈춘 앱은 새 release 말고는 다시 띄울 길이 없다". (agent, 0.23.3)
- 앱 process를 권한 flag 없이 띄운다. (사람)
- 앱이 쓰는 npm·jsr 의존은 release 준비 때 받아 bundle에 통째로 담는다. 이유: 운영 앱이 network 없이 뜨고 앱이 자기 의존성(예: 공휴일 data 라이브러리)을 쓸 수 있어야 한다. 닫은 이슈 "npm·jsr 의존을 준비 때 받아 bundle에 통째로 담는다"(kept). 설계는 release 준비의 몫이고 activation이 받는 입력은 봉인된 bundle이다.
- 다른 기계의 새 release는 그 앱을 들인 기계에서 스스로 따라가고 판정은 지금 activation 그대로다. 들이지 않은 기계는 아무것도 하지 않는다. (사람·planner, `machine-update`)
- "더 새 release"는 git 조상으로 정한다. 버린 안: release 번호(기계마다 따로 센다)나 활성 시각(갈라진 code를 오간다). 사람이 내려놓은 release와 실패한 release는 다시 따라가지 않는다. (planner, `machine-update`)
- 따라가는 activation은 session 없이 activation 기록과 따라가기 상태로만 보인다. 설치 실패와 거절의 기억은 메모리에 두고 core가 다시 뜨면 다시 한다. 이유: ledger에 두면 schema step이 든다. activation 실패는 이미 release 행에 남으니 그것으로 다시 뜬 뒤에도 보인다. (planner, agent, `machine-update`)

## 열린 것

- 사람이 허락한 줄이나 돌아가기 요청 행을 시작하려다 `conflict`·`invalid_input`으로 거절되면 같은 줄을 매 sweep(1초)마다 다시 시작하려 하는지 확인하지 못했다. 거절은 조용히 돌려준다.
- `held`의 이유(`restore_failed` 등)는 release 실패 기록에 남지 않고 `app_unavailable` 기록의 reason에만 남는다.
- 실패 reason에는 앱의 migration script가 낸 글이 앞 200자까지 실릴 수 있다. 복원된 실패는 toast가 둘(실패, data 복원) 뜰 수 있다.
- 카드가 열린 동안 새로 열린 공유 요청은 그 동의에 묶이지 않고 따로 선다.
- data root(`secrets.json`, 다른 앱 data)를 지키는 규칙은 아직 없다. 앱 grant가 그 경로를 덮는 선언은 사람의 동의 화면이 유일한 장치다.
- 따라가기는 두 개발 core가 한 폴더를 나눈 끝에서 끝 확인으로만 보았다(change-log `machine-update`). 실제 두 기계, 실제 바깥 동기화 도구, 실제 agent가 합친 release는 보지 못했다.
- 사람이 거절한 따라가기는 core가 다시 뜰 때마다 다시 묻는다. 거절을 ledger에 남기지 않기로 한 대가다.

---
name: lophn-build-app
description: "사람이 지정한 구현 ticket으로 lophn 앱을 만드는 절차. MCP claim, 채택된 설계 읽기, 설치 SDK 확인, blueprint 먼저 수정, 구현, 실제 테스트, preview, release 준비, 결과 보고 순서를 따른다. 지정되지 않은 ticket은 claim하지 않는다."
---

# lophn 앱 제작

사람이 지정한 구현(implementation) ticket 하나를 앱으로 만드는 절차다. 모든
coding 작업은 ticket 하나의 현재 claim 아래에서만 한다.

## 시작 조건

- 이 터미널에서 사람이 ticket을 지정했거나 [Start]의 첫 prompt가 ticket을
  지정했을 때만 시작한다. 지정된 ticket만 claim한다.
- ticket 목록(`lophn_ticket` op `list`), 시작 summary(`lophn_session` op
  `summary`), 열린 ticket이 보이는 것은 착수 지시가 아니다. 목록에서 일을 골라
  claim하지 않는다. 사람이 이미 ticket을 지정했으면 어느 ticket을 할지 다시 묻지
  않는다.
- 사람이 ticket 없이 "이 앱을 만들어 줘"라고만 했으면 code를 시작하지 않는다.
  사람에게 lophn의 담당 agent(App Engineer)가 요청을 검사 가능한 ticket으로
  정리해 줄 것이라고 안내한다. ticket 생성은 사람 전용이고 coding credential로는
  만들 수 없다(`lophn ticket create`는 거절된다). 채택된 설계 답이나 acceptance
  조건이 없으면 ticket이 만들어지지 않고 담당 agent가 필요한 확인을 사람에게
  묻는다. ticket이 생기면 사람이 그 ticket을 지정한다.

## 통로

- `lophn_ticket`: op `list`, `show`, `checks`, `claim`, `renew`, `release`,
  `report`
- `lophn_app`: op `list`, `show`, `register`, `source`, `sync_tools`,
  `blueprint`, `validate`, `test`, `preview_start`, `preview_stop`,
  `release_prepare`, `status`, `invocations`, `logs`, `command`
- `lophn_sdk`: op `catalog`, `show`, `add`
- `lophn_read`, `lophn_index`: 채택된 설계를 고정 판으로 읽는다
- 문제 code 선언과 보고: `@lophn/blueprint`의 `problem_codes`,
  `@lophn/cap-problem`의 `reportProblem`

MCP가 없으면 같은 이름의 CLI command를 쓴다. CLI에서 claim은 안내만 하고
실행하지 않으니 claim은 MCP로 한다.

## 순서

1. 지정 ticket을 읽는다. `lophn_ticket` op `show`로 목표(무엇·왜), 고정 근거와
   채택 답, acceptance 조건, 볼 곳과 지킬 것을 읽고 op `checks`로 조건별 현재
   상태를 본다. ticket 본문은 바뀌지 않는다. ticket이 `needs_confirmation`이거나
   작업 가능 여부가 false면 claim하지 않고 사람에게 알린다.
2. claim한다. `lophn_ticket` op `claim`에 ticket과 읽은 `base_revision`을 준다.
   응답의 `claim_seq`와 `expires_at`을 기억한다. 기한은 기본 60분이고 자료를
   읽거나 release를 준비해도 늘지 않으므로 오래 걸리면 기한 전에 op `renew`를
   직접 부른다. claim은 다른 권한의 허락이 아니다.
3. 채택된 설계와 유지 제약을 읽는다. ticket의 고정 근거(문서의 고정 판)를
   `lophn_read`로, 채택 답은 ticket 본문에서 읽고, 볼 곳과 지킬 것의 상대 경로를
   source에서 읽는다. 최신 판이나 다른 판으로 근거를 대신하지 않는다. 낯선
   용어는 `lophn-navigate`의 순서로 context glossary를 찾는다.
4. 설치 SDK와 재사용 재료를 찾는다. 새 code를 쓰기 전에 `lophn_sdk` op
   `catalog`(설명·API 이름 `query`)로 쓸 package를 찾고 op `show`로
   API·type·permission·peer·예제를 읽는다. 필요한 package는 op `add`로 exact
   version의 import 안내를 받는다. 범위 지정 version이나 조용한 upgrade는 쓰지
   않는다. `apply`로 source에 반영하는 것은 지정한 앱 source에만 한다. 이미 있는
   앱의 command와 화면 재료는 `lophn_app` op `list`·`show`·`blueprint`로 읽는다.
5. 앱을 준비한다. 전체 범위 connection이고 앱이 아직 없으면 `lophn_app` op
   `register`로 이름·제목만 가볍게 등록한다. 앱 하나에 연결된 connection이면
   등록하지 않고 이미 등록된 그 앱(`lophn_app` op `show`)을 쓴다.
6. 구현을 시작할 source를 연결한다. `lophn_app` op `source`로 앱의 source 폴더를
   연결하고 앱 template을 준비한다. 도구와 안내를 다시 맞추려면 op
   `sync_tools`를 쓴다. 이 폴더 안의 앱 root 안내 파일을 먼저 읽는다.
7. blueprint를 먼저 고친다. 화면·command·automation·permission·problem
   code·문서·SDK 의존이 바뀌면 code보다 앞서 blueprint 선언을
   `@lophn/blueprint`로 고친다. 새 문제 code는 `problem_codes`에 선언하고 앱
   code는 선언한 code로 `reportProblem`을 부른다. 처리하지 못한 예외도 같은
   통로로 모이게 한다.
8. 구현한다. 화면과 command는 선언과 맞게 쓰고, 생성물(machine이 만든 파일)은
   손으로 고치지 않는다. 기존 fixture와 업무 제약(ticket의 지킬 것)을 보존한다.
9. 실제 테스트를 돌린다. source를 commit한 뒤 `lophn_app` op `validate`로
   blueprint 오류·경고·permission 검토를 읽고, op `test`로 실제 app test와
   ticket의 test command 조건을 요청한다. test는 기본 300초 timeout이고 결과는
   같은 묶음 hash의 실제 test result다. 실패·timeout·미실행이면 원인을 고쳐 다시
   테스트하고, 통과 전에 release 준비를 시도하지 않는다. source가 바뀌면 이전
   통과를 쓰지 않는다. 직접 돌린 shell 결과는 test result가 아니다.
10. preview로 확인한다. `lophn_app` op `preview_start`로 fixture 격리 preview를
    열고 화면과 command를 확인한 뒤 op `preview_stop`으로 닫는다. op `command`는
    읽기 command만 호출할 수 있고 기본 환경은 preview다. preview 결과는 운영이
    정상이라는 증거가 아니다.
11. release를 준비한다. 모든 테스트가 통과한 같은 묶음에서 `lophn_app` op
    `release_prepare`에 `ticket`과 현재 `claim_seq`를 준다. 준비는 activation이
    아니다. 새 release를 운영에 켜는 일은 사람이 한 번 눌러 고른다. claim이
    만료되었거나 반납되었으면 준비하지 않고 먼저 claim을 다시 확인한다.
12. 결과를 보고한다. `lophn_ticket` op `report`에 준비한 release, 변경 내용,
    수행한 확인, 미실행 확인, 한계를 summary에 담는다. 접수되면 claim이 끝난다.

## 결과를 쓸 때

다음을 서로 다른 말로 쓴다. 하나로 뭉치지 않는다.

- 완료 주장: 내가 끝냈다고 보는 것
- preview: fixture에서 본 동작
- 실제 test result: runner가 낸 통과·실패·미실행(이유 포함)
- release 준비: 준비된 release가 있다는 것
- activation: 사람이 운영에 켠 것
- 문제 닫힘: 사람 확인과 problems의 판정이며 구현 ticket 보고로 닫히지 않는다

실패하거나 돌리지 못한 확인, 승인 대기, 알려진 한계를 그대로 적는다. test
result와 확인됨은 machine이 낸다. 보고서에서 만들어 내지 않는다.

## 하지 않는 것

- 지정되지 않은 ticket을 claim하거나 claim 없이 source를 바꾸지 않는다.
- 선언한 문제 code를 지우거나 테스트 기대값을 낮춰 통과시키지 않는다.
- ticket의 목표를 바꾸지 않는다. 바꿔야 하면 사람이 기존 ticket을 취소하고 새
  ticket을 만든다.
- 운영 앱 시작·중지, release activation, secret 값, 문제 닫힘은 요청하지 않는다.
  사람이 화면에서 한다.

---
name: lophn-repair
description: "맡겨진 수리 ticket 하나로 lophn 앱의 문제를 고치는 절차. lophn CLI로 ticket 읽기와 claim, 문제 근거 읽기, 수정, release 준비, 실제 테스트와 preview, claim 재확인, release 확인, 결과 보고 순서를 따른다. 맡겨지지 않은 ticket은 claim하지 않고 조사만 요청받으면 수리하지 않는다."
---

# lophn 수리

맡겨진 수리(repair) ticket 하나로 앱의 문제를 고치는 절차다. 문제를 직접
claim하지 않는다. claim은 ticket에만 있다. 통로는 `lophn` CLI 하나다. 이
터미널의 working directory가 앱 source 폴더이고 CLI는 그 앱 하나만 본다.

## 시작 조건

- 맡겨진 ticket만 claim한다. `lophn ticket list`나 `lophn problem list`로 읽은
  것은 착수 지시가 아니다. 읽기만 하고 지시를 기다린다.
- 사람이 "왜 이런 문제가 생겼는지 봐 달라"처럼 조사만 요청했으면 수리에 착수하지
  않는다. 읽고 근거와 가설을 보고한다. code 수정은 ticket을 claim한 뒤에만 한다.
- 사람이 ticket 없이 "이걸 고쳐 줘"라고 하면 code를 시작하지 않는다. lophn의 App
  Engineer가 수리 요청을 ticket으로 정리해 맡길 것이라고 안내한다.

## 명령

모든 명령은 `lophn <명령> --input '<JSON>'`이고 입력 칸은
`lophn <명령> --help`로 본다.

- ticket: `ticket list`, `ticket show`, `ticket claim`, `ticket renew`,
  `ticket report`
- 문제: `problem list`, `problem show`, `problem more`, `problem diff`,
  `problem occurrence`, `problem body`
- 앱: `app show`, `app status`, `app blueprint`, `app invocations`, `app logs`,
  `app test`, `app test status`, `app test result`, `app preview start`,
  `app preview stop`
- release: `release prepare`, `release status`
- App Engineer에게 청하기: `message send`

입력에 `app`이 필수인 명령(`app show`, `release prepare` 등)에는 앱 id를 넣는다.
core가 token에서 채워 주지 않는다. 값은 `ticket show` 출력의 `app`이다.

## 순서

1. 맡겨진 ticket을 읽는다. `ticket show`로 대상 문제, 증상, 근거, acceptance
   check(하나. `app_test`, `examples`, `text` 중 하나), 볼 곳과 지킬 것을
   읽는다. check가 예시(`examples`)이면 api와 입력, 기대 결과를 그대로 읽는다.
   수리 ticket의 예시는 원래 증상을 보이는 호출과 고쳐진 기대 결과다. 예시는
   고치지 않는다. 틀린 것 같으면 `message send`로 App Engineer에게 청한다.
2. claim한다. `ticket claim`에 ticket과 읽은 revision(`base_revision`)을 준다.
   `claim_seq`와 `expires_at`을 기억하고 기한 전에 필요하면 `ticket renew`를
   부른다.
3. 문제 근거를 읽는다. `problem show`로 문제를 읽는다. 사실과 해석을 나누는 조사
   순서는 [수리 조사 순서](references/investigation.md)를 따른다.
4. 필요한 근거를 더 읽는다. 잘렸거나 부족한 것은 `problem more`에 문제와
   `kind`를 주어 한 종류씩 읽는다. 두 release 사이 source 차이는
   `problem diff`로 읽는다. 이름이 붙은 보고 하나의 message 앞부분, details
   hash, snapshot은 `problem occurrence`로 읽고, 그 보고의 message·details나
   snapshot log의 본문이 필요하면 `problem body`를 offset으로 나눠 읽는다. 앱 쪽
   사실은 `app status`, `app invocations`, `app logs`로 읽는다. 전체 목록이나
   전체 log를 한 번에 가져오지 않는다.
5. 고친다. 원인 가설을 세우고 최소 변경으로 source를 고친다. 먼저 원래 증상을
   재현하는 테스트를 앱 `tests/`에 만들고 `deno task test`로 수리 전에는
   실패하고 수리 뒤에는 통과하는 것을 직접 확인한다. 직접 돌린 결과는 test
   result가 아니므로 보고 summary에 "수행한 확인"으로 적는다. 기존 fixture와
   ticket의 지킬 것을 보존한다. 테스트 기대값을 낮춰서 문제를 숨기지 않는다.
   blueprint나 의존을 바꿔야 하면 직접 고치지 않고 `message send`로 App
   Engineer에게 청한다.
6. release를 준비한다. 변경한 source를 commit한 뒤 `release prepare`를 부르고
   `release status`로 `status`가 `completed`가 될 때까지 읽는다. 준비가 끝나면
   `bundle_hash`와 `test`(고정 시험 hash)가 나온다. 준비는 activation이 아니다.
7. 실제 테스트와 preview를 한다. `app test`는 플랫폼 검사다.
   `target.bundle_hash`와 `test`에 6에서 읽은 값을 넣어 요청한다. 예시는 보고한
   뒤 program이 보고한 release로 돌린다. 예시의 api를 그 입력으로 불렀을 때 기대
   결과가 나오도록 고친다. `text` check는 runner가 돌리지 않는다(App Engineer가
   판단한다). `app test status`로 `result_ref`를 읽고 `app test result`로 결과를
   읽는다. 결과는 runner가 낸 test result만 근거다. 실패· timeout·미실행이면
   고쳐서 6부터 다시 한다. 통과 전에 보고하지 않는다. `app preview start`로
   fixture 격리 preview에서 증상이 사라졌는지 보고 `app preview stop`으로
   닫는다. preview는 운영 정상의 증거가 아니다.
8. claim을 다시 확인한다. 보고하기 전에 `ticket show`로 이 claim이 아직 내 현재
   claim인지, 기한이 남았는지 본다. 만료·반납·회수로 claim을 잃었으면 보고를
   멈추고 `message send`로 알린다. 오래된 claim으로 결과를 제출하지 않는다.
9. release를 확인한다. 테스트가 통과한 뒤 `release status`를 다시 읽으면 core가
   release를 확정하고 `release`(id)를 준다. 새 release를 운영에 켜는 일은 사람이
   한다.
10. 결과를 보고한다. `ticket report`에 확정된 release, summary(변경 내용, 수행한
    확인, 미실행 확인, 한계), verification 참조를 담는다.

## 결과를 쓸 때

다음을 서로 다른 말로 쓴다. 하나로 뭉치지 않는다.

- 완료 주장: 내가 고쳤다고 보는 것
- preview: fixture에서 본 동작
- 실제 test result: runner가 낸 통과·실패·미실행(이유 포함)
- release 준비: 준비된 release가 있다는 것
- activation: 사람이 운영에 켠 것
- 문제 닫힘: problems가 판정한다. 보고나 ticket 확인됨으로 문제가 닫히지 않으며
  coding agent는 문제를 닫거나 무시하거나 사람 확인을 대신하지 않는다

실패하거나 돌리지 못한 테스트, 알려진 한계를 그대로 적는다. 고쳤다는 말이나
shell log를 test result로 쓰지 않는다.

## 하지 않는 것

- 맡겨지지 않은 ticket을 claim하거나 claim 없이 source를 바꾸지 않는다.
- 문제의 원래 증상을 바꿔 말하거나 증상 보고를 대신 결론 내지 않는다.
- 운영 앱 시작·중지, activation, secret 값, 문제 닫힘과 무시는 요청하지 않는다.
  사람이 화면에서 한다.

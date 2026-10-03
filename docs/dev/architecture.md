---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# 코드 구조 규칙

모든 코드가 따르는 clean architecture 규칙이다. 자리는 [code-map.md](code-map.md), 규칙의 뜻은 requirements와 domain model이 정한다. spec 문서는 두지 않는다. 코드가 spec이다. 그래서 코드는 읽기 쉬워야 한다.

## concern 모듈의 모양

```
packages/<최상위>/<leaf>/
  mod.ts          밖으로 내보내는 것만. 다른 모듈은 이것만 import한다
  model.ts        entity, 값, 상태 전이, 불변 조건. 순수 함수만. IO 없음
  commands.ts     ledger command handler: 입력 검사 → CAS 비교 → 쓰기 → event. 짧은 transaction 하나
  reads.ts        read query
  work.ts         command 밖의 무거운 일(파일, 네트워크, model 호출, 앱 실행). 결과는 command로 낸다
  adapters/       OS, keychain, HTTP, provider 같은 바깥 세계
  *_test.ts       대상 바로 옆
```

필요 없는 파일은 만들지 않는다. 파일 하나가 400줄을 넘으면 나눈다.

## 의존 방향

- 안쪽(model)은 바깥(adapters, work)을 모른다. 바깥이 안쪽을 부른다.
- 시각, id, 무작위 값, 파일 시스템, 네트워크는 인자로 받는다(`packages/base`의 Clock, IdSource 같은 interface). 테스트에서 바꿔 끼운다.
- 전역 mutable 상태를 두지 않는다. 프로세스 수명의 상태는 entry(`apps/*`)에서 만들어 넘긴다.
- 최상위 사이는 `packages/contracts`만 거친다([contracts.md](contracts.md)).

## 오류

- 경계(API, command, contract)에서는 공통 오류 코드만 쓴다: `invalid_input`, `not_found`, `forbidden`, `unauthorized`, `conflict`, `unavailable`. `packages/base`의 Result 타입으로 돌려준다.
- 안쪽에서는 throw해도 되지만 경계를 넘기 전에 공통 오류로 바꾼다.
- 조용히 삼키지 않는다. 모르는 결과는 모른다고 기록한다(P11).
- secret과 개인정보는 오류와 log에 넣지 않는다(platform/redaction).

## 이름

- 이름은 문서의 말을 그대로 영어 식별자로 쓴다: Preset, Assignment, Invocation, Release, Blueprint. 새 동의어를 만들지 않는다.
- 이름과 경로에 판, 단계, 작업 번호를 넣지 않는다. `v2/`, `milestone1/`, `w07`, `new-`, `old-`, `legacy-`, `-next` 같은 것은 쓰지 않는다. 바꿀 때는 그 자리를 고친다.
- 파일과 폴더는 kebab-case, 타입은 PascalCase, 함수와 변수는 camelCase, 상수 표는 SCREAMING_SNAKE_CASE.
- ledger 표와 ID 접두사는 domain model이 정한 그대로 쓴다.

## 쓰는 법

- 동작을 바꾸면 그 동작을 설명하는 requirements도 같은 변경에서 고친다. 고칠 수 없으면 [open-issues.md](../../open-issues.md)에 질문으로 올린다.
- 주석은 "왜"만 쓴다. 코드가 말하는 "무엇"은 쓰지 않는다.
- 죽은 코드는 지운다. 주석으로 남기지 않는다.
- 나중을 위한 자리, 예약 필드, 쓰지 않는 옵션을 만들지 않는다(P2).
- 화면 문구는 직접 쓰지 않고 wording key로 쓴다(shell/wording, 처음엔 en만).
- 의존성을 더할 때는 [stack.md](stack.md)의 목록에 이유와 함께 더한다.

# 코드 규칙

## 속도가 먼저다

MVP 이전의 prototype이다(AGENTS.md "속도").
- 동작하는 것이 완벽한 것보다 먼저다. 요구를 채우는 가장 단순한 구현을 고른다.
- 쓰일지 모를 일반화, 확장 지점, 방어 코드, 예약 필드, 쓰지 않는 옵션을 미리 만들지 않는다.
- 부르는 쪽이 없는 동작은 늘어놓지 않는다.

## 모듈 모양

core의 module 하나는 이런 모양이다. 필요 없는 파일은 만들지 않는다.

```
packages/core/<module>/<leaf>/
  mod.ts        밖으로 내보내는 것만. 다른 module은 이것만 import한다
  model.ts      값, 상태 전이, 불변 조건. 순수 함수만. IO 없음
  commands.ts   쓰기: 입력 검사 → 비교(CAS) → 쓰기 → domain event. 짧은 transaction 하나
  reads.ts      읽기
  work.ts       command 밖의 무거운 일(파일, 네트워크, model 호출, 앱 실행). 결과는 command로 낸다
  adapters/     OS, keychain, HTTP, provider 같은 바깥
```

- 파일 하나가 400줄을 넘으면 나눈다.
- shell, sdk, coding-agent도 같은 생각을 따른다: 순수한 판정과 바깥 IO를 나눈다.

## 의존 방향

- 안쪽(model)은 바깥(adapters, work)을 모른다. 바깥이 안쪽을 부른다.
- 시각, id, 무작위 값, 파일 시스템, 네트워크는 인자로 받는다(`packages/base`의 Clock, IdSource 같은 interface). test에서 바꿔 끼운다.
- 전역 mutable 상태를 두지 않는다. process 수명의 상태는 entry(`packages/core/main/*`)에서 만들어 넘긴다.
- package 사이 import는 [code-map.md](code-map.md)만 따른다.

## package 사이 약속(protocol)

package 사이의 약속은 `packages/protocol/<module>/`에 둔다. 담는 것은 다음과 같다.
- API 경로와 method, 입력·출력 type과 schema
- command와 event의 이름과 payload
- tool, MCP tool, CLI command의 이름과 입력
- 그 약속의 오류 코드

구현은 두지 않는다. 의존 없는 순수 함수를 여러 package가 같이 써야 할 때만 예외다(예: md 목차 parser, blueprint 검사).

바꾸는 법:
- 판을 나누지 않는다. `v2` 경로나 `FooV2` type을 만들지 않고 그 위치를 고친다.
- 필드를 지우거나 뜻을 바꾸면 쓰는 쪽이 type check에서 깨져야 한다. `any`나 optional로 숨기지 않는다.
- 약속을 바꾸는 일은 그것을 쓰는 쪽을 같은 변경에서 고치거나, 그 변경을 먼저 main에 넣는다.

## 오류

- 경계(API, command, protocol)에서는 공통 오류 코드 일곱만 쓴다: `invalid_input`, `not_found`, `forbidden`, `unauthorized`, `conflict`, `unavailable`, `internal`. `internal`은 우리 코드의 결함일 때만 쓴다. `packages/base`의 Result로 돌려준다.
- 안쪽에서는 throw해도 되지만 경계를 넘기 전에 공통 오류로 바꾼다.
- 조용히 삼키지 않는다. 모르는 결과는 모른다고 남긴다.
- secret과 개인정보는 오류와 log에 넣지 않는다.

## 이름

- 문서의 말을 그대로 영어 식별자로 쓴다(Grant, Invocation, Release, Blueprint, Project Manager). 새 동의어를 만들지 않는다.
- 이름과 경로에 판, 단계, 작업 번호를 넣지 않는다: `v2/`, `milestone1/`, `w07`, `new-`, `old-`, `legacy-`, `-next`.
- 파일과 폴더는 kebab-case, type은 PascalCase, 함수와 변수는 camelCase, 상수 표는 SCREAMING_SNAKE_CASE.

## 주석과 죽은 코드

- 주석은 "왜"만 쓴다. 코드가 말하는 "무엇"은 쓰지 않는다. 둘레 코드처럼 한국어로 짧게 쓴다.
- 주석과 test 이름에 요구 ID, 결정 번호, 작업 번호를 넣지 않는다.
- 죽은 코드는 지운다. 주석으로 남기지 않는다. TODO를 남기지 않는다. 남길 일은 작업으로 만든다.

## 화면

- 화면 문구는 직접 쓰지 않고 wording key로 쓴다(`packages/design/wording`, 지금은 en만).
- 화면 모양의 기준은 wireframe(`tools/wireframes`)과 `../tmp/ui-inventory.md` 6장이다.

## 의존성

- 의존성을 더할 때는 [stack.md](stack.md)에 이유와 함께 적는다. 판은 정확히 고정하고 lockfile로 묶는다.

## 호환성

MVP 이전이다(AGENTS.md "호환성").
- 설계가 바뀌면 옛 표, event, route, schema step, 약속, flow를 고치거나 지운다.
- migration, 옛 경로 남기기, 옛 이름 읽기 같은 호환 장치를 만들지 않는다.
- 개발 데이터는 schema가 바뀌면 지우고 새로 만든다.

## 문서와 같이 고친다

- 동작이 requirements나 spec과 다르면 같은 변경에서 그 문서를 고친다.
- 정할 수 없으면 lead에게 질문으로 보고하고 추천안으로 진행한다.

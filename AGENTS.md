# AGENTS.md

<br />

## 속도

프로토타입이다. 스타트업처럼 만든다. 빨리 만들고, 써 보고, 틀리면 버린다.

* 동작하는 것이 완벽한 것보다 먼저다. 요구를 채우는 가장 단순한 구현을 고른다. 쓰일지 모를 일반화, 확장 지점, 방어 코드를 미리 만들지 않는다.
* 테스트는 깨지면 정말 곤란한 것에만 쓴다: 사용자 데이터를 잃거나 망가뜨리는 규칙, 권한·secret·sandbox 경계, 두 번 이상 고친 버그. 화면, 문구, 내부 구현, 이미 다른 테스트가 보는 동작은 테스트하지 않는다.
* 작업 하나에 테스트는 몇 개면 충분하다. 요구마다 테스트를 붙이지 않는다.
* subprocess, Worker, 서버, 브라우저를 띄우는 테스트와 E2E는 새로 만들기 전에 사람에게 묻는다.
* 소스 파일을 텍스트로 읽어 검사하는 테스트는 쓰지 않는다.
* 테스트를 지우거나 합치는 것도 좋은 작업이다. 설계와 맞지 않는 테스트는 고치지 말고 지운다.
* 작업 중에는 바꾼 곳의 테스트만 돌린다. 

## 말

개발자가 평소 쓰는 말을 그대로 쓴다. 영어 단어 그대로(leaf, ledger, redaction, snapshot) 쓰거나 굳은 음차(테스트, 세션)를 쓰고, 뜻을 옮긴 번역어(잎, 장부, 가림, 시험)를 새로 만들지 않는다. 문서, 코드 주석, 사람에게 하는 답 모두에 적용한다.

## 문서

무엇을 만들지는 `project-docs/`가 정한다. 먼저 [PRODUCT.md](project-docs/PRODUCT.md)를 읽고, 맡은 일에 걸린 요구(`project-docs/requirements/`)와 spec(`project-docs/tmp/specs/`)만 읽는다. 정할 수 없는 것은 보고하고 추천안으로 진행한다.

## 코드

어떻게 만들지는 [project-docs/dev/](project-docs/dev/README.md)가, 순서와 작업 단위는 [project-docs/plan/](project-docs/plan/README.md)이 정한다.

* 코드 위치와 package 사이 import 방향은 [code-map.md](project-docs/dev/code-map.md)를 따른다. core를 import하는 것은 core뿐이다.
* 모듈 모양, 의존 방향, 오류, 이름은 [code.md](project-docs/dev/code.md)를 따른다. 이름과 경로에 `v2`, `milestone1`, `w07` 같은 판·단계·작업 번호를 넣지 않는다.
* 테스트는 [testing.md](project-docs/dev/testing.md)를 따른다.
* 작업은 [workflow.md](project-docs/dev/workflow.md)의 끝남 기준을 모두 채워야 끝난다. 테스트 이름과 코드 주석에 요구 ID나 작업 번호를 넣지 않는다.
* 끝내기 전에 `deno task check`를 돌린다.

## 호환성

MVP 이전이다. 호환성보다 뒤에 헷갈리지 않는 깔끔함이 먼저다.

* 설계가 바뀌면 옛 표·event·route·schema step·contract·flow를 고치거나 지운다. migration, 옛 경로 남기기, 옛 이름 읽기 같은 호환 장치를 만들지 않는다.
* 틀린 옛 test(e2e 포함)는 옮기거나 고쳐 살리지 않는다. 지우고 새 설계에 맞춰 다시 쓴다.
* 개발 데이터는 schema가 바뀌면 지우고 새로 만든다.

## worker

일을 worker(subagent)에게 맡길 때 model은 이렇게 고른다.

* 보통은 `sonnet-high`를 쓴다.
* `mimo-v2.6-flash`는 쓰지 않는다.

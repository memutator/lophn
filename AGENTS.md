# AGENTS.md

<br />

## 속도

프로토타입이다. 스타트업처럼 만든다. 빨리 만들고, 써 보고, 틀리면 버린다.

* 동작하는 것이 완벽한 것보다 먼저다. 요구를 채우는 가장 단순한 구현을 고른다. 쓰일지 모를 일반화, 확장 지점, 방어 코드를 미리 만들지 않는다.
* 사용자 앱과 사람이 쓴 글은 공격자로 보지 않는다. 막는 것은 AI가 만든 코드와 agent의 실수(데이터 잃기, 폴더 밖 쓰기, 틀린 되돌리기)와 인터넷에서 온 것이다.
* 테스트는 깨지면 정말 곤란한 것에만 쓴다: 사용자 데이터를 잃거나 망가뜨리는 규칙, 권한·secret·sandbox 경계, 두 번 이상 고친 버그. 화면, 문구, 내부 구현, 이미 다른 테스트가 보는 동작은 테스트하지 않는다.
* 작업 하나에 테스트는 몇 개면 충분하다. 요구마다 테스트를 붙이지 않는다.
* subprocess, Worker, 서버, 브라우저를 띄우는 테스트와 E2E는 새로 만들기 전에 사람에게 묻는다.
* 소스 파일을 텍스트로 읽어 검사하는 테스트는 쓰지 않는다.
* 테스트를 지우거나 합치는 것도 좋은 작업이다. 설계와 맞지 않는 테스트는 고치지 말고 지운다.
* 작업 중에는 바꾼 곳의 테스트만 돌린다.

## 말

개발자가 평소 쓰는 말을 그대로 쓴다. 영어 단어 그대로(leaf, ledger, redaction, snapshot) 쓰거나 굳은 음차(테스트, 세션)를 쓰고, 뜻을 옮긴 번역어(잎, 장부, 가림, 시험)를 새로 만들지 않는다. 문서, 코드 주석, 사람에게 하는 답 모두에 적용한다.

## 문서

| 위치                                     | 무엇                                                        |
| -------------------------------------- | --------------------------------------------------------- |
| `project-docs/PRODUCT.md`              | 제품이 무엇이고 무엇이 아닌가                                          |
| `project-docs/boundary-catalog.yaml`   | 추상화 경계와 공개 계약의 ID                                         |
| `project-docs/module-catalog.yaml`     | 코드 module ↔ boundary ID                                   |
| `project-docs/architecture/<topic>.md` | 여러 module에 걸친 메커니즘의 흐름, 불변 조건, 이유                         |
| `project-docs/flows/`                  | 모든 동작(entry, flow, outcome, journey)과 test가 덮는 outcome. `node tools/flows.ts report` |
| `project-docs/products/roadmap/`       | 아직 계획으로 열지 않은 큰 일. 주제 하나에 md 하나                           |
| `project-docs/plan/`                   | 진행 중인 계획                                                  |
| `project-docs/issues/`                 | 열린 이슈: bug, defect(코드 결함, 무겁게 짠 것), mistake(worker의 큰 실수) |
| `project-docs/products/change-log/`    | 판마다 바뀐 동작·계약과 결정                                          |

* 동작을 바꿔 architecture 문서와 달라지면 같은 변경에서 그 문서를 고친다.
* 정할 수 없는 것은 보고하고 추천안으로 진행한다.

## 코드

* 경계(API, command, protocol)에서는 공통 오류 코드 일곱(`invalid_input`, `not_found`, `forbidden`, `unauthorized`, `conflict`, `unavailable`, `internal`)과 `packages/base`의 Result만 쓴다.
* 시각, id, 무작위 값, 파일 시스템, 네트워크는 인자로 받는다(`packages/base`의 Clock, IdSource). 전역 mutable 상태를 두지 않는다.
* protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2` 경로나 `FooV2` type을 만들지 않는다.
* SDK 판(`packages/sdk/*`, `packages/design`)을 올리거나 앱 agent가 읽는 지침(guide.md·skill·template)을 바꾸면 `sdk-note` skill대로 `migrate-sdk` 메모(지침이 바뀌었으면 `## Instruction diff`)를 쓰고, 지원 하한이 바뀌면 `lophn.supported_from`을 고친다. check의 sdk notes가 잡는다.
* route, CLI 명령, agent tool, 단축키 command, IPC channel, SDK export, 내장 skill, control 요청이나 test file을 더하거나 지우면 같은 변경에서 `project-docs/flows/`를 고친다(`flows` skill). check의 flows가 잡는다.
* 주석은 "왜"만 쓴다. 죽은 코드는 지운다.
* 의존성은 판을 정확히 고정한다.
* 끝내기 전에 `npm run check`를 돌린다.
* 저장소 root checkout은 여러 session이 같이 쓴다. 거기서 branch를 바꾸지 않는다. branch 일은 자기 worktree에서 하고, root에서 commit·merge할 때는 바로 앞에 `git branch --show-current`로 branch를 확인한다.

## 사람에게 묻는 것

* push, force push, 기록 지우기, 병합 안 된 branch 삭제
* 실제 model provider 호출(개발은 `npm run dev`가 띄우는 fake, test는 `tests/support/fake-server`와 녹화 재생)
* 사람의 `~/.lophn`을 건드리는 일(개발은 `.dev-data/`)

## 호환성

MVP 이전이다. 설계는 자유롭게 바꾸되, 사람이 실제로 쓰는 data root(`~/.lophn`)는 새 판으로 이어져야 한다.

* 설계가 바뀌면 옛 표·event·route·schema·contract·flow를 고치거나 지운다(표는 아래 migration으로). 옛 경로 남기기, 옛 이름 읽기 같은 호환 장치는 만들지 않는다.
* 저장된 data의 모양이 바뀌면 기존 data를 새 모양으로 옮기는 migration을 같은 변경에 넣는다.
  * ledger: 새 schema step(새 id)을 더한다. 이미 낸 step의 SQL은 고치지 않는다. 적용기가 id와 SQL hash로 대조해 다르면 기동을 거절한다. 새 step은 `WIRINGS`(`packages/core/main/daemon/assembly.ts`) 맨 뒤 wiring의 `schemaStepsAfterTeams`에 더하고, 같은 변경에서 `schema-steps.lock.json` 끝에 `{id, sha256}`을 덧붙인다.
  * ledger 밖 data root 파일(`agents/*.md`, `settings.json`, `secrets.json` 등): 소유 wiring의 `dataSteps`에 step을 더한다.
* 제품 판은 root `package.json`의 `version` 하나다. 다른 package의 `version`은 쓰지 않는다.
* 틀린 옛 test(e2e 포함)는 옮기거나 고쳐 살리지 않는다. 지우고 새 설계에 맞춰 다시 쓴다.

## worker

일을 worker(subagent)에게 맡길 때 model은 이렇게 고른다. 워커와의 대화는 영어로만 소통한다

* 보통은 `sonnet-high`를 쓴다.
* `mimo-v2.6-flash`는 쓰지 않는다.

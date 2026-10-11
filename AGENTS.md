# AGENTS.md

## 말

개발자가 평소 쓰는 말을 그대로 쓴다. 영어 단어 그대로(leaf, ledger, redaction, snapshot) 쓰거나 굳은 음차(테스트, 세션)를 쓰고, 뜻을 옮긴 번역어(잎, 장부, 가림, 시험)를 새로 만들지 않는다. 문서, 코드 주석, 사람에게 하는 답 모두에 적용한다.

## 문서

무엇을 만들지는 `docs/`가 정한다. 먼저 [docs/README.md](docs/README.md)를 읽는다. 문서는 concern 단위로 나뉘고, 맡은 concern의 문서만 읽는다. intent는 사람만 고친다. 정할 수 없는 것은 [open-issues.md](open-issues.md)에 올리고 추천안으로 진행한다. 문서를 고친 뒤에는 `node tools/check-docs.ts`를 돌린다.

## 코드

어떻게 만들지는 [docs/dev/](docs/dev/README.md)가 정한다.

- 코드 자리는 [code-map.md](docs/dev/code-map.md)를 따른다. 최상위 concern 사이는 `packages/contracts`로만 부른다.
- 모듈 모양, 의존 방향, 오류, 이름은 [architecture.md](docs/dev/architecture.md)를 따른다. 이름과 경로에 `v2`, `milestone1`, `w07` 같은 판·단계·작업 번호를 넣지 않는다.
- 작업은 [tasks.md](docs/dev/tasks.md)의 완료 기준을 모두 채워야 끝난다. 테스트 이름은 요구 번호로 시작한다.
- 끝내기 전에 `deno task check`를 돌린다.

## worker

일을 worker(subagent)에게 맡길 때 model은 이렇게 고른다.

- 보통은 `sonnet-high`를 쓴다.
- 범위가 작고 실수할 여지가 없는 쉬운 일인데 token을 많이 써야 하면 `mimo-v2.6-flash`를 쓴다.

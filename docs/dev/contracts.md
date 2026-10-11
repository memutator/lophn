---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# contracts

여러 팀이 동시에 구현하려면 최상위 concern 사이의 약속이 먼저 코드로 고정되어야 한다. 그 약속을 `packages/contracts`에 둔다. 여기가 흔들리면 병렬 작업이 모두 깨진다.

## 무엇을 두나

`packages/contracts/<최상위>/`에 그 최상위가 내놓는 것만 둔다. 무엇을 내놓는지는 각 architecture 문서의 "내놓는 contract" 절과 [architecture/README.md](../architecture/README.md) 4장의 표가 정한다.

- API 경로와 method, 입력·출력 타입과 schema
- command 이름과 입력, event 이름과 payload
- read query의 입력·출력
- tool·MCP tool·CLI command의 이름과 입력
- 그 contract의 오류 코드(공통 오류 코드 안에서)

구현은 두지 않는다. 타입, schema, 상수, 작은 client 생성 함수만 둔다. 예외: 의존 없는 순수 함수를 여러 최상위가 같이 써야 하고 다른 자리가 없을 때만 둔다(apps blueprint 검사, 문서 outline parser — code-map "여러 최상위가 같이 쓰는 순수 함수"). schema는 한 가지 도구로 쓴다([stack.md](stack.md)).

## 누가 고치나

- contract는 contracts 팀만 고친다([team.md](team.md)).
- 다른 팀은 바꿀 것이 생기면 contracts 팀에 요청한다: 무엇을, 왜, 영향받는 쪽.
- contracts 팀은 바꾸기 전에 그 contract를 쓰는 쪽을 모두 찾아 같은 변경에서 고치거나, 고칠 팀에게 작업을 만든다.

## 바꾸는 법

- 판을 나누지 않는다. `v2` 경로나 `FooV2` 타입을 만들지 않고 그 자리를 고친다. 아직 배포한 적이 없으니 호환 층도 두지 않는다.
- 필드를 지우거나 뜻을 바꾸면 쓰는 쪽이 typecheck에서 깨져야 한다. 깨지지 않게 any나 optional로 숨기지 않는다.
- contract 변경은 다른 변경보다 먼저 main에 들어간다([tasks.md](tasks.md)의 병합 순서).

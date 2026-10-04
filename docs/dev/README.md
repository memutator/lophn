---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# 개발 가이드

lophn을 구현하는 사람과 agent가 함께 지키는 것이다. 무엇을 만들지는 `docs/`의 intent, requirements, domain model, architecture, flow가 정하고, 여기는 어떻게 나눠 만들지만 정한다. spec 문서는 두지 않는다. 코드와 테스트가 spec이다.

| 문서 | 무엇 |
|---|---|
| [code-map.md](code-map.md) | 저장소 모양, concern마다의 코드 자리, 의존 규칙 |
| [architecture.md](architecture.md) | clean architecture 규칙: 모듈 모양, 의존 방향, 오류, 이름 |
| [contracts.md](contracts.md) | 최상위 사이 contract를 코드로 먼저 고정하는 규칙 |
| [stack.md](stack.md) | 기술 스택, check 명령, 개발 환경과 fixture |
| [tasks.md](tasks.md) | 계획 문서와 작업 단위의 모양, 완료, 테스트, 추적, git |
| [team.md](team.md) | 역할, worker 등급과 model, 주고받는 법 |
| [research.md](research.md) | agent 관련 주제는 오픈소스 3개 이상을 코드로 조사한다. 참고 주소 |
| [legacy.md](legacy.md) | 이전 lophn 코드에서 가져와도 되는 것 |
| [team-brief.md](team-brief.md) | worker가 작업 하나를 구현하고 PR을 올리는 법 |

순서: contracts와 base, 뼈대(`skeleton` slice)를 먼저 만들고 그다음 slice들을 병렬로 진행한다.

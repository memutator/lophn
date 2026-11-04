# remove-domain: domain과 kind를 지운다

- 목표: domain(`dom_`)과 kind(`kinds.yaml`)를 지우고 경계를 그릇(project, app)으로 접는다. 사람의 data root는 migration으로 이어진다.
- 재료: `project-docs/products/roadmap/agent-platform.md` 단계 1(정한 것 6~11). 코드 사실과 path는 task brief에 있다.
- 범위 밖: `PACKAGE_KINDS`의 `"domain"`(sdk package 분류), chart 축 `domain`, `kind:` 판별 칸과 tab kinds. change-log, 보관 이슈, eval 녹화 run. 사람이 둔 untracked `tests/eval/materials/calendar-app-*`.

## 정한 것

1. 앱 command는 `lophn <slug> <command>`, wire `<slug>_<command>`, deny `lophn(<slug> <words>)`이다. domain이 하나인 앱은 글자가 그대로다. (agent)
2. 비공개 command는 그 앱 place session만 본다. 예약어는 앱 slug 규칙이 된다. (agent)
3. 선언의 `domain` 칸을 지우고 `@lophn/declaration`을 3.0.0으로 올린다. 봉인한 옛 bundle은 뜨지 않고 다시 release한다(0.14.0 선례). (agent, 사람이 답하지 않아 추천대로)
4. artifact는 `<그릇 자리>/artifacts/`, data skill은 `<그릇 자리>/skills/`(층 이름 `place-data`)로 옮긴다. 그릇 자리는 `<data>/projects/<prj>/`, `<data>/apps/<app>/`다. (agent)
5. `DOMAIN.md`, `kinds.yaml`은 `<그릇 자리>/old-domains/<domain 이름>/`로 옮기고 prompt에 붙이지 않는다. change-log로 알린다. (agent)
6. 정의의 `domains` 칸을 지운다. 칸이 차 있던 agent는 그릇 전체로 넓어진다. (agent)
7. migration은 `domains` 표로 옮길 자리를 찾고, 마지막 data step이 표를 지운다. 옛 step `domains.tables`는 inert로 남긴다. (agent)

## task

wave 하나에 task 하나다. 앞 task가 쓰는 곳을 떼어 낸 뒤 다음이 지운다. 할 일과 소유는 `tasks/<id>.md`.

| wave | id | 한 줄 |
|---|---|---|
| 1 | `rd-kinds` | kind 기능을 통째로 지운다 |
| 2 | `rd-commands` | command를 앱 단위로: 표기, 비공개 경계, 예약어 slug, SDK 3.0.0, deny와 release 선언 migration |
| 3 | `rd-artifacts` | artifact를 그릇 자리로: 신원, annotation, rewind root, layout v9 migration |
| 4 | `rd-layers` | `DOMAIN.md` 층, domain skill 층, 정의 `domains`, place 정보 Domains 절을 지운다. skill·문서 옮기기 migration |
| 5 | `rd-domains` | 남은 domain(protocol, core module, 화면, CLI, i18n)을 지우고 표를 거둔다 |

0.17.0은 `rd-domains`가 land하기 전에 release하지 않는다.

## lead가 할 일

- merge마다: 그 task가 바꾼 동작의 architecture 절을 고친다(`app-call.md`, `artifact.md`, `annotation.md`, `agent-definition.md`, `workspace-layout.md`).
- `rd-domains` 뒤: `.dev-data/`에 domain 둘인 앱, 칸 찬 정의, 열린 artifact tab을 만들고 새 판으로 띄워 본다.
- 다 끝나면: `architecture/{domain,kinds}.md`, `roadmap/domain.md`를 지우고 `PRODUCT.md`, `products/AGENT.md`, catalog 셋, 열린 roadmap·이슈를 고친다(`agent-platform.md` "다른 계획, roadmap, 이슈" 표). change-log 0.17.0에 동작, migration, 옮긴 자리, 결정을 적는다. 계획 폴더를 지운다.

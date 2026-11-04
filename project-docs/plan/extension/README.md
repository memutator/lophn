# extension: lophn 본체와 따로 설치하는 기능 묶음

- 목표: 대다수에게 필요 없는 기능(첫 사용자: third-party CLI GUI와 harness host)을 extension 단위로 묶는다. 사람이 설정에서 설치·켜기·끄기·지우기를 한다. 꺼져 있으면 code를 load하지 않고 아무것도 등록하지 않는다.
- 재료: `project-docs/products/roadmap/agent-platform.md` 단계 6(사람의 원문 "별도로 설치하게끔, 근데 지금 그런 구조가 없거든", "구조도 만들어놓자"). 코드 사실과 path는 task brief에 있다.
- 범위 밖: mac·win packaging(지금 없다), 자동 update(지금 없다).

## 정한 것

1. extension 하나는 폴더와 manifest(`id`, 이름, 설명, 판, 들어 있는 것, code 진입점)다. 판은 제품 판(root `package.json` `version`)과 같아야 한다. 다르면 켜지 않는다. (agent)
2. shell main의 registry가 manifest를 읽고, 켜진 extension의 진입점만 load한다. extension은 `activate(ctx)`·`deactivate()`를 내고 ctx로 core client, 설정, spawn, Clock, IdSource를 받는다. core에는 protocol route로만 붙는다. (agent)
3. 켜기는 사람이 설정 화면에서만 한다. 설정 키는 `extensions.<id>.enabled`이고 harness의 `harness.enabled`는 `extensions.harness.enabled`로 바꾼다. (agent)
4. 끄고 지우면 extension이 쓴 file만 지운다(표시 file로 안다). 사람 file과 다른 설정은 그대로다. (agent)
5. 받는 길은 먼저 (가) 본체 .deb 안에 넣어 두고 설정에서 켠다. 뒤에 (나) 따로 받는 package로 옮긴다(사람, 2026-11-04). 그 전환이 구조를 고치지 않게 extension은 (1) shell main bundle과 따로 빌드한 file을 경로로 load하고 (2) registry는 manifest가 든 폴더 목록만 읽고(지금은 본체 안 폴더, 뒤에 `<data>/extensions/<id>/`를 더한다) (3) `ctx`로만 lophn에 닿고 shell main 내부를 import하지 않는다(`tools/check-deps.ts`가 막는다). (사람·agent)

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `extension-core` | manifest, registry, load·activate·deactivate, 설정 키, 판 검사 |
| 2 | `extension-settings` | 설정 화면의 extension 목록(설치·켜기·끄기·지우기) |

## lead가 할 일

- merge마다: 새 `architecture/extension.md`를 쓰고 `boundary-catalog.yaml`, `module-catalog.yaml`, `context-component-registry.yaml`에 올린다.
- 다 끝나면: `agent-platform.md` 단계 6을 끝남으로 적고, 계획 harness-agent가 아직 돌고 있으면 그 lead에게 `harness.enabled` 대신 extension API를 쓰라고 알린다. change-log 열린 판에 적고 계획 폴더를 지운다.

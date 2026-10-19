# domain-rename: project를 domain으로, PM을 Domain Engineer로 이름을 바꾸고 문서를 모은다

- 목표:
  - 코드, data 자리, 화면 문구에서 다음 이름을 바꾼다.
    - project → domain
    - `project_manager` → Domain Engineer
    - 앞 계획들이 남긴 app 이름 가운데 domain 개념에 속하는 것
  - domain을 한 문서(`architecture/domain.md`)로 모은다.
- 재료:
  - `project-docs/products/roadmap/domain.md` 전체
  - 앞 계획 넷(`domain-kinds`, `domain-tools`, `domain-place`, `artifact`)이 쓴 architecture 문서와 changelog
- 범위 밖:
  - 새 동작. 이 계획은 이름과 자리와 문서만 바꾼다.
  - e2e 다시 쓰기. 이 계획 뒤 따로 계획을 연다.
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다. task id는 `dr-`로 시작한다.
- 시작 조건: 앞 계획 넷이 모두 main에 land했다.
  - brief는 그 뒤의 코드를 보고 쓴다. 지금은 쓰지 않는다. planner(`lophn-7e`)가 넷이 land한 것을 확인하고 brief worker를 띄운다.

## 정할 것 (brief를 쓸 때)

- **무엇을 바꾸나**
  - id 접두(`prj_`)
  - module 자리(`packages/core/projects`)
  - route 이름(`project.*`)
  - place kind
  - data 자리(`<data>/projects/`)
  - role id와 지침 file
  - wording
  - agent tool 접두(`app__`)
- **app이라는 이름을 어디까지 남기나:** 앱 runtime·release·ticket 같은 engineering 장치의 module 이름(`packages/core/apps`)을 남길지가 걸린다. roadmap "정한 것"은 "앱"을 화면 문구로 남길 수 있다고 했다.
- **나누는 법:** 이름 바꾸기는 package를 건너 type check가 한 번에 맞아야 한다. 그래서 codemod task 하나로 할지, 계약을 먼저 고정한 뒤 영역별로 나눌지는 brief가 정한다.

## e2e

- 이 계획은 e2e를 돌리지도 고치지도 않는다.
- land는 `LOPHN_LAND_SKIP_E2E=1 project-docs/plan/tools/lead/land.sh domain-rename`로 돈다.

## lead가 할 일

- **다 끝나면**
  - `project-docs/architecture/domain.md`를 새로 쓴다. 앞 계획들이 쓴 `kinds.md`, `artifact.md`와 app-call·place-session의 domain 부분을 모으거나 가리킨다.
  - PRODUCT 2절, 3절, 6절을 고친다.
  - AGENT-ROLE 전체를 고친다.
  - `boundary-catalog.yaml`, `module-catalog.yaml`, `context-component-registry.yaml`을 고친다.
  - `products/roadmap/domain.md`는 남은 몫(live view)만 남기고 줄인다.
  - changelog 열린 판에 항목을 덧붙인다.
- **사람에게 묻는 것:** 화면에서 쓰는 말(domain, Domain Engineer, 앱)을 정할 때.

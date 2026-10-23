# br-docs

살아 있는 문서(PRODUCT, AGENT-ROLE, architecture, roadmap)에서 "blueprint"를 걷어내고 "앱의 선언"으로 쓴다. 문서가 말하는 코드 이름(폴더, SDK, tool, CLI, 열, 실패 code)을 `br-move`가 바꾼 실제 이름에 맞춘다.

- 단위: br-docs (wave 2)
- 선행: 없음
- 소유(이 task만 고친다). 이 task는 project-docs를 고치는 것이 일이다(worker 기본 지침의 "project-docs는 고치지 않는다"의 예외):
  - `project-docs/PRODUCT.md`
  - `project-docs/architecture/activation.md`
  - `project-docs/architecture/agent-definition.md`
  - `project-docs/architecture/app-call.md`
  - `project-docs/architecture/approval.md`
  - `project-docs/architecture/coding-agent.md`
  - `project-docs/architecture/domain.md`
  - `project-docs/architecture/place-session.md`
  - `project-docs/architecture/testing.md`
  - `project-docs/architecture/ui-kit.md`
  - `project-docs/products/AGENT-ROLE.md`
  - `project-docs/products/roadmap/domain.md`
  - `project-docs/products/roadmap/app-preview.md`
- 읽을 것:
  - 공통: `project-docs/plan/blueprint-remove/names.md`, `project-docs/plan/blueprint-remove/README.md`
  - 배경: root `ISSUE-blueprint-domain.md`("blueprint가 지금 담는 것", "정한 것")
  - 코드(문서가 말하는 것을 확인하는 곳): `packages/protocol/apps/declaration/`, `packages/core/apps/declaration/`, `packages/core/apps/permissions/facts.ts`, `packages/core/apps/releases/schema.ts`, `packages/sdk/declaration/`, `packages/core/apps/packages/template/app/`
  - 문서 규칙: `AGENTS.md` "문서"(동작을 바꿔 architecture 문서와 달라지면 같은 변경에서 그 문서를 고친다), "말"(개발자가 평소 쓰는 말. 뜻을 옮긴 번역어를 새로 만들지 않는다)
- 계약:
  - 쓰는 것: `br-move`가 바꾼 이름 전부(이름 표).
  - 내놓는 것: 없음.

## 할 일

1. 인벤토리: `git grep -n -i blueprint -- project-docs/PRODUCT.md project-docs/architecture project-docs/products/AGENT-ROLE.md project-docs/products/roadmap`. 지금 목록은 위 소유 file들이다(`project-docs/products/roadmap/eval.md`와 `project-docs/architecture/eval.md`는 eval 재료 이름이 바뀌는 `br-eval-materials`가 고친다. 이 task는 그 둘을 건드리지 않는다). `app-oauth`가 문서를 더했으면 그 file도 맡는다.
2. 문서마다 "blueprint"를 읽고 문장을 고친다. 이름만 치환하면 "blueprint 선언"이 "declaration 선언"이 되어 틀린다. 개념은 "앱의 선언"(앱 code의 `lophn.ts`에 있고 release와 같이 봉인된다)이다. 코드 이름은 이름 표대로: `apps/blueprint` → `apps/declaration`, `blueprint.check` → `declaration.check`, `lophn app blueprint` → `lophn app declaration`, `@lophn/blueprint` → `@lophn/declaration`(`defineApp`), 열 `blueprint_hash` → `declaration_hash`.
3. 파생 사실: `activation.md`, `app-call.md`가 현재 release의 선언에서 만든 값(권한 요구, 다른 앱 tool 쓰기, tool 이름)을 가리킬 때는 코드의 `AppFacts`(`facts`)와 같은 말을 쓴다("선언 사실(facts)"). 선언 전체를 말하는 곳은 그냥 "선언"이다. 문서가 이미 "선언"이라고 쓴 곳(activation.md 대부분)이 어느 쪽인지 코드(`packages/core/apps/releases/facts.ts`, `packages/core/apps/permissions/facts.ts`)를 읽고 가른다.
4. 문서가 말하는 file·폴더 path는 `check-docs`가 막는다. 새 이름의 실제 path로 맞춘다.
5. `project-docs/products/roadmap/domain.md`, `project-docs/products/roadmap/app-preview.md`의 "앱 blueprint" 문장은 2026-10-23 결정(선언을 앱 code 안에 두고 "선언"으로만 말한다)에 맞춰 고친다. 로드맵이 말하는 앞날의 일(선언을 domain으로 옮길지 등)은 바꾸지 않는다. 그 부분은 root `ISSUE-blueprint-domain.md`와 `ISSUE-calendar-without-calendar.md`가 정한다.
6. 문서에 답이 없거나 결정에 어긋나 보이는 문장은 고치지 말고 보고의 "정한 것"에 적는다.

## 끝남

- `deno task check`가 통과한다(`check-docs`, fmt 포함). 문서만 고치는 task지만 `deno task check:full`도 돌려 본다.
- 위험 test: 없음.
- 남지 않음:
  - `git grep -il blueprint -- project-docs/PRODUCT.md project-docs/architecture project-docs/products/AGENT-ROLE.md project-docs/products/roadmap/domain.md project-docs/products/roadmap/app-preview.md`가 0줄이다. `project-docs/architecture/eval.md`는 이 grep에 나오더라도 `br-eval-materials`의 몫이다.
  - 문서에 적힌 옛 코드 이름(`blueprint_hash`, `blueprint.check`, `@lophn/blueprint`, `blueprint.ts`, `blueprint.json`, `blueprint_missing`)이 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것(특히 "선언"과 "선언 사실(facts)"을 가른 곳)
- 넘길 줄: `eval.md` 두 file에서 본 blueprint 줄(`br-eval-materials`로 넘긴다)
- 계약 바꾸기 요청: 없으면 "없음"
- 남은 blueprint 줄, 겹침: `names.md`의 "보고에 더할 것"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

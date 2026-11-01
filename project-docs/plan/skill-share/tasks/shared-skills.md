# shared-skills

agent에게 할당한 앱이 active release로 내놓은 public skill을 그 agent의 skill 목록과 `skill.read`에 싣는다(source `shared`).

- 단위: agent (wave 2)
- 선행: skill-places, assign-file, app-skill-decl. skill 받기 규칙, 할당 파일, 선언 `skills`를 쓴다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/extensions/**`
  - `packages/core/lophn-agent/run-loop/{prepare.ts,prepare_test.ts}`
  - `packages/core/lophn-agent/tools/bundles/skill.ts`
  - `packages/core/main/agent-runtime/product-driver.ts`
  - `packages/core/apps/screens/skills.ts`(새 file, active release bundle에서 skill을 읽는다)
  - `packages/core/apps/routes.ts`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/harness-config.md` 단계 8
  - 계획: `project-docs/plan/skill-share/README.md` 정한 것 7, `project-docs/plan/skill-share/facts.md` "skill 발견과 받기", "앱 선언과 release"(bundle, `readAppIcon`)
  - architecture: `project-docs/architecture/agent-definition.md`(skill 목록, 도는 turn은 시작 때 판을 쓴다, cache)
- 계약:
  - 쓰는 것: `skillReceived(skill, off, domains)`, `AgentInfo.apps`, `AppDeclaration.skills`
  - 내놓는 것: 앱 slug로 그 앱 active release의 public skill(이름, 설명, SKILL.md와 딸린 `.md`)을 읽는 core 함수. `harness-skill-copies`가 같은 것을 route로 읽는다면 그 route도 여기서 낸다.

## 할 일

1. bundle reader: 앱의 active release bundle에서 선언 `skills` 가운데 `public: true`인 것의 `.lophn/skills/<name>/` 파일을 읽는다(`readAppIcon`처럼 bundle 안 realPath 확인). 비공개 skill과 선언에 없는 폴더는 읽지 않는다.
2. 받기: turn을 준비할 때 그 agent 정의의 `apps` 각각의 public skill을 source `shared`로 skill 목록에 더한다. `skills_off`가 이긴다. 같은 이름이 다른 층에 있으면 그 층이 이긴다(공유 skill은 가장 아래 층 바로 위, 내장 다음). 같은 이름의 공유 skill을 두 앱이 내면 slug 순으로 앞의 것이다. 앱 자기 place에서는 `app` source(skill-places)로 이미 보이므로 공유로 또 싣지 않는다.
3. `skill.read`와 `/` 메뉴가 같은 목록을 쓴다. 할당이 없는 앱의 skill은 읽기도 막는다.
4. 할당이나 activation이 바뀌면 다음 turn에 목록이 바뀌고 지금 규칙대로 notice가 붙는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "앱을 할당받지 않은 agent는 그 앱의 public skill을 목록에서도 `skill.read`로도 받지 않고, 할당받은 agent도 비공개 skill은 받지 않는다"
- 남지 않음: 없음

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

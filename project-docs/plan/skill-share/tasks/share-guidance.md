# share-guidance

앱을 짓는 agent(lophn 앱 agent와 coding agent)가 command가 어떻게 쓰이는지 알고, 기능이 다른 agent에게 쓸모 있으면 skill과 공유 요청을 스스로 제안하게 지침을 고친다.

- 단위: agent-places (wave 2)
- 선행: app-share-request. 명령 이름 `lophn app share`를 쓴다.
- 소유(이 task만 고친다):
  - `packages/core/agent-places/skills/design-app/SKILL.md`
  - `packages/core/agent-places/prompts/{app.md,prompts.ts}`
  - `packages/core/apps/packages/template/app/AGENTS.md.tmpl`
  - `tests/eval/registry/**`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/harness-config.md` 단계 8의 "지침"
  - 계획: `project-docs/plan/skill-share/README.md`
  - architecture: `project-docs/architecture/agent-definition.md`(지침과 skill 글의 규칙: skill 설명은 무엇을 하는지만, 절과 규칙은 본문)
  - 지금 글: 위 소유 file 셋
- 계약:
  - 쓰는 것: 명령 `lophn app share`, 선언 `skills: [{name, public, commands}]`, 앱 source `.lophn/skills/<name>/SKILL.md`

## 할 일

1. `design-app`: "Operations and commands"에 command가 다른 agent와 coding agent에게 `lophn <domain> <command> --flag`로 보이고 `description`이 `--help`가 된다는 것, `description`은 "언제 쓰나"로 쓴다는 것을 더한다. 새 절 "Sharing with other agents": 새로 만들 때와 바꿀 때 "이 기능이 다른 agent에게 쓸모 있나, 누구에게"를 묻는다. 쓸모 있으면 `.lophn/skills/<name>/SKILL.md`(언제 쓰고, 어떤 명령을, 결과를 어떻게 읽나)를 쓰고, 선언 `skills`에 `public: true`와 쓰는 command를 적고, release 뒤 `lophn app share`로 받을 agent를 제안한다. 사람이 승인해야 할당된다. DESIGN.md 6절에 공유 skill을 적는다.
2. `app.md`: 선언 단계에 skill 선언을 한 줄 더하고, release activate 뒤 공유할 skill이 있으면 `lophn app share`를 부르라는 것, `removed_public_skills`도 `removed_public_tools`처럼 다루라는 것을 쓴다. `prompts.ts`의 명령 안내가 이 명령을 말해야 하면 고친다.
3. `AGENTS.md.tmpl`: coding agent도 읽는 글이다. 두 층(operation, command), command가 `lophn <domain> <command>`로 보인다는 것, `.lophn/skills`는 commit한다(`.lophn/sdk/`만 뺀다)는 것, 공유 skill과 `lophn app share`를 짧게 쓴다.
4. eval registry의 skill·지침 snapshot을 새 글에 맞춘다(registry를 다시 만드는 명령이 있으면 그것으로).

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음
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

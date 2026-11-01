# app-skill-decl

앱 선언에 `skills: [{name, public, commands}]`를 더하고, release 준비가 skill 폴더와 command를 검사하고, public skill을 지우는 release를 준비 결과에 드러낸다. `@lophn/declaration`을 2.1.0으로 올리고 앱 template이 `.lophn/skills`를 commit하게 한다.

- 단위: apps (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/declaration/**`
  - `packages/protocol/apps/releases.ts`
  - `packages/protocol/apps/activation/activation.ts`
  - `packages/sdk/declaration/**`
  - `packages/sdk/app-ui/package.json`
  - `package-lock.json`
  - `packages/core/apps/packages/{vendor.ts,builtin.ts}`
  - `packages/core/apps/packages/template/**`(`AGENTS.md.tmpl` 빼고)
  - `packages/core/apps/releases/prepare/**`
  - `packages/core/apps/releases/{commands.ts,public-tools.ts}`
  - `packages/core/apps/releases/*_test.ts`(release 준비·기록 test)
  - `packages/cli/commands/{release.ts,release_test.ts}`
  - `tests/support/app/sample/**`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/harness-config.md` 단계 8
  - 계획: `project-docs/plan/skill-share/README.md` 정한 것 7, 10, `project-docs/plan/skill-share/facts.md` "앱 선언과 release"
  - architecture: `project-docs/architecture/app-call.md`(선언 두 목록), `project-docs/architecture/domain.md`(`removed_public_tools`)
  - 본보기: `icon`(없어도 되는 칸, 준비의 파일 검사)
- 계약:
  - 내놓는 것: `AppDeclaration.skills?: {name: string; public: boolean; commands: string[]}[]`, 준비 결과와 activation 결과의 `removed_public_skills: {skill, domains}[]`(`removed_public_tools`와 같은 꼴). `shared-skills`가 `skills`를, `share-guidance`가 이름을 쓴다.

## 할 일

1. 선언: `skills`는 없어도 되는 칸이다. 항목 `{name, public, commands}`, `name`은 skill 폴더 이름 규칙(`skillNameSchema`, `packages/protocol/lophn-agent/skill-settings.ts`), 이름은 겹치지 않는다. `commands`는 이 선언의 command 이름이다. public skill의 `commands`는 모두 public command여야 한다. 없는 command나 public skill이 비공개 command를 쓰면 선언 오류다.
2. 준비: `prepare/flow.ts`가 `extractDeclaration` 뒤에 선언의 skill마다 commit에 `.lophn/skills/<name>/SKILL.md`가 있는지 본다. 없으면 `failed`(stage `release`)이고 reason에 "commit에 `.lophn/skills/<name>/SKILL.md`가 없다. `.gitignore`가 `.lophn/`을 빼면 `.lophn/sdk/`로 바꾼다"를 쓴다.
3. 기록: `release.record`가 앞 active release에 있던 public skill이 사라지거나 비공개가 되면 `removed_public_skills`에 그 skill과, 그 앱이 할당된 agent가 맡은 domain을 싣는다(`removed_public_tools`와 같은 길). 막지 않는다. CLI `release prepare`의 결과 글에 보인다.
4. SDK: `@lophn/declaration`을 2.1.0으로 올리고 2.0.0이 박힌 곳(facts.md)을 모두 고친다. `vendor.ts`에 새 file이 있으면 더한다.
5. template: `.gitignore.tmpl`의 `.lophn/`을 `.lophn/sdk/`로 바꾼다. `lophn.ts.tmpl`·`package.json.tmpl`의 판을 맞춘다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "declaration/2.0.0" packages tests`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

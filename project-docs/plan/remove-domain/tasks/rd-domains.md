# rd-domains

쓰는 곳이 없어진 domain을 모두 지운다: protocol, core module, id prefix, 화면(Domain panel, domain dialog), CLI, i18n, wireframes, eval. 마지막 data step이 남은 폴더와 `domains` 표를 거둔다.

- 단위: domains (wave 5)
- 선행: rd-layers.
- 소유(이 task만 고친다):
  - `packages/protocol/domains/**`, `packages/protocol/{mod,base/ids,approvals/assignment}.ts`
  - `packages/core/domains/**`, `packages/core/main/daemon/wiring/domains-registration.ts`, `packages/core/main/daemon/assembly.ts`, `packages/core/lophn-agent/agents/{skills-off-step,skills-off-step_test}.ts`
  - `packages/cli/commands/{domain,mod}.ts`
  - `packages/shell/renderer/workspace/domains/**`, `packages/shell/renderer/workspace/sidebar/{domain-panel,project-sidebar,app-panel}.tsx`, `packages/shell/renderer/workspace/{place-window,source,core-source,fake-source}.ts*`, `packages/shell/renderer/app-frame/app-detail/**`, `packages/shell/renderer/apps/source.ts`, `packages/shell/renderer/icons/shell.ts`
  - `packages/design/i18n/{en,catalog/domain}.ts`
  - `tools/check-deps.ts`, `tools/wireframes/**`
  - `tests/eval/` 중 domain 항목(registry `domain.*`, scenario L4-app·L5·O6, `versions/versions_test.ts`)
- 읽을 것:
  - architecture: `project-docs/architecture/domain.md`(지우는 동작의 자리)
  - 선례: `packages/core/main/daemon/wiring/assignment-file.ts`의 `OLD_TABLE_STEPS`(옛 step을 inert로 남긴다)와 표 지우기
  - 제품 결정: 계획 README 정한 것 7
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음

## 할 일

1. 지운다: `protocol/domains/**`, `core/domains/**`, `domains-registration.ts`, `cli/commands/domain.ts`, renderer `workspace/domains/**`, Domain panel(project `domain-panel.tsx`, app `domains-section.tsx`와 app panel의 Domain tab), i18n `catalog/domain.ts`, id prefix `dom`, wireframe domain page.
2. `app.create`가 domain을 만들지 않는다(`domainProvisioningPort`). event `DomainCreated` 등 정의를 지우기 전에 저장된 event를 읽는 곳이 모르는 type을 거절하는지 본다. 거절하면 지우지 말고 보고한다.
3. ledger: `domains.tables` step은 inert로 목록에 남긴다(지우면 기동 거절 `newer_schema`).
4. 마지막 data step `domains.retire`(등록 순서 맨 끝): `<data>/domains/`에 남은 file이 없으면 폴더를 지우고, 있으면 그대로 둔다. `domains` 표와 `<data>/derived/kinds.sqlite`를 지운다.
5. `skills-off-step.ts`의 `protocol/domains/paths` import를 없앤다(이미 적용된 step이라 새 data root에서는 돌지 않는다. 옛 root를 위해 돌 수 있게 path는 문자열로 둔다).
6. `tools/check-deps.ts`의 `domains` module, eval registry·scenario의 domain 항목을 지운다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "`domains.retire`가 남은 file이 있으면 폴더를 지우지 않는다"
- 남지 않음: `grep -rnE "dom_|domainId|DomainCreated|domainList" packages tests tools`가 0줄이다(오탐: chart, `PACKAGE_KINDS`, credential "domain key").

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.

## lead가 더함

- `rd-kinds`가 scenario O6와 그 registry 항목, material `tax-kinds`를 이미 지웠다. L4-app·L5만 남았다.
- `protocol/domains/paths.ts`의 `DOMAIN_KINDS_FILE`·`domainKindsFile`도 같이 지운다.
- data step은 `WIRINGS` 순서로 돈다. `domains.retire`는 `artifactMoveWiring`(`artifacts.container`)과 `rd-layers`의 옮기기 step 뒤, 맨 끝에 둔다. 이름이 둘 다 차서 못 옮긴 artifact는 `domains/<dom>/artifacts/`에 남으므로 retire가 폴더를 지우지 않는다.
- wireframes의 artifact sidebar page "one domain"과 "list"가 거의 같아졌다(`rd-artifacts`). 하나를 지운다.

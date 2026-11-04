# rd-commands

앱 command를 domain이 아닌 앱 단위로 바꾼다: 표기 `lophn <slug> <command>`, 비공개 경계는 앱, 예약어는 slug 규칙. 선언의 `domain` 칸을 지우고 SDK를 3.0.0으로 올리고, 저장된 release 선언과 정의의 deny 규칙을 migration한다.

- 단위: commands (wave 2)
- 선행: rd-kinds.
- 소유(이 task만 고친다):
  - `packages/protocol/apps/declaration/**`, `packages/protocol/apps/{apps,app-slug,usage,releases}.ts`, `packages/protocol/apps/activation/activation.ts`
  - `packages/core/apps/**` (`annotations/` 빼고)
  - `packages/core/main/daemon/wiring/{apps,apps-usage,assignment-file}.ts`(+test), `packages/core/main/daemon/agent-domains.ts`, `packages/core/main/tool-names_test.ts`
  - `packages/core/lophn-agent/tools/{app-public,app-toolkit}.ts`, `packages/core/lophn-agent/tools/app-tool/**`, `packages/core/lophn-agent/tools/lophn/**`
  - `packages/core/agent-places/place/place-data.ts` (command의 `domain`으로 거르는 줄만)
  - `packages/cli/commands/{app-command,app,release,run,domain-names_test}.ts`, `packages/cli/main.ts`
  - `packages/sdk/declaration/**`, `packages/sdk/flow/guide.md`, `packages/core/apps/packages/**`
  - `packages/shell/renderer/workspace/agents/editor/{grants-model,grants-model_test}.ts`
  - `tests/support/app/**`, `tests/e2e/{app-call,app-data-rewind}_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`, `project-docs/architecture/activation.md`
  - 선례: `packages/core/apps/releases/schema.ts`의 `apps.releases.declaration-layers`(0.14.0), `packages/core/main/daemon/wiring/assignment-file.ts`의 `assignmentFileStep`(data step이 lophn.db를 직접 연다)
  - 제품 결정: 계획 README 정한 것 1~3, 7
- 계약:
  - 쓰는 것: `domains` 표(아직 있다. mapping에만 읽는다)
  - 내놓는 것: `RESERVED_APP_SLUGS`(`protocol/apps/declaration/types.ts`), `denyRuleOf(slug, name)`, command 신원은 `{app, name}`(domain 없음)

## 할 일

1. 예약어: `RESERVED_DOMAIN_NAMES`를 `RESERVED_APP_SLUGS`로 옮긴다(`domainNameSchema`는 새 이름을 import). `app.create`(`core/apps/registration/commands.ts`)가 slug를 직접 검사해 `invalid_input`으로 거절한다. 지금은 `DomainCreated` payload 검사가 엉뚱한 오류로 막고 있다.
2. 선언: `CommandDeclaration.domain`, `DeclarationOptions.domains`, `exactKeys`의 `domain`, `isDomainName` 검사를 지운다. wire 이름 64자·겹침 검사(`declaration/tools.ts:177-196`)는 slug로 한다(validator에 slug를 넘긴다). `read.ts`의 `domain` 칸을 지운다.
3. 표기: 사람 CLI(`cli/main.ts:103-160`, `app-command.ts` `loadAppCommands`)는 첫 단어를 앱 slug로 찾는다(`domainList` 대신 앱 목록). `appCommandDoc` 이름 `<slug>.<command>`. agent wire `<slug>_<command>`(`tools/app-tool/command.ts`, `tools/lophn/resolve.ts`).
4. 비공개 경계: `tools/app-public.ts` `withPublicOnly`, `core/apps/declaration/reads.ts`, `core/apps/calls/{gate,service}.ts`, `grants-model.ts`가 caller의 domain id 대신 caller session의 place가 그 앱인지로 본다. `agent-domains.ts`는 쓰는 곳이 없어지면 지운다.
5. 사용 관계: `app.usage`(`core/apps/usage/*`)는 쓰는 쪽을 앱·project로 센다. `removed_public_tools`·`removed_public_skills`의 `domains` 칸을 지운다.
6. SDK: `@lophn/declaration` 3.0.0, guide에서 `domain` 설명을 지운다. template `lophn.ts.tmpl`·`package.json.tmpl`·`AGENTS.md.tmpl`과 vendor pin을 같이 올린다(`core/apps/packages/`).
7. ledger step(새 id, `core/apps/releases/schema.ts` 끝): `releases.declaration`의 `commands[].domain`을 지운다. 0.14.0 꼴(trigger 내리기, `declaration`만, `declaration_hash`는 그대로, trigger 다시 만들기).
8. data step(`assignment-file` wiring에 더한다): `agents/*.md`의 `permissions.deny`에서 `lophn(<domain> <words>)`를 `domains` 표로 찾은 앱 slug의 `lophn(<slug> <words>)`로 다시 쓴다. 못 찾은 규칙은 그대로 둔다.
9. test 지원: `tests/support/app/sample/lophn.ts.tmpl`과 patch들의 `domain:`을 지운다. `patch-domain.ts`(둘째 domain)와 그것을 쓰는 test 줄은 지운다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "둘째 domain의 deny `lophn(<domain> <cmd>)`가 step 뒤 `lophn(<slug> <cmd>)`가 되고 그 command가 여전히 막힌다"
  - "release 선언 step 뒤 `commands[].domain`이 없고 `declaration_hash`는 그대로다"(`schema_test.ts` 꼴)
  - "예약어 slug의 `app.create`가 `invalid_input`이다"
- 남지 않음: `grep -rn "command.domain\|RESERVED_DOMAIN_NAMES\|loadAppCommands(core, domain" packages tests`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 봉인한 옛 bundle이 뜨지 않는 것은 정한 것이다(알려진 미완 동작에 적지 않는다).

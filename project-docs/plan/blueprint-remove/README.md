# blueprint-remove: "blueprint"라는 개념을 걷어내고 "앱의 선언"으로 부른다

- **목표:** 앱이 lophn에 내놓는 선언(이름, 설명, 화면, tool, 권한, 다른 앱 tool 쓰기, SDK 판)은 지금처럼 앱 code 안에 두고 release와 같이 봉인한다. 다만 "blueprint"라는 따로 된 개념과 이름을 모두 걷어내고 "선언(declaration)"으로 부른다(사람, 2026-10-23. root `ISSUE-blueprint-domain.md`).
- **재료:**
  - root `ISSUE-blueprint-domain.md`("정한 것")
  - architecture `app-call.md`, `activation.md`(이미 대부분 "선언"이라 부른다), `domain.md`, `agent-definition.md`, `testing.md`, `eval.md`
  - `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`
- **범위 밖:**
  - 선언의 모양 바꾸기(칸 더하기, 빼기, domain으로 옮기기). 이름만 바꾼다.
  - 닫힌 changelog와 archived 이슈, eval의 지난 run JSON과 지난 재료 판(@1~@3). 기록이라 두고 바꾸지 않는다.
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `br-`로 시작한다.
- **시작 조건:** 계획 `app-oauth`가 land한 뒤 연다. 그 계획이 선언 file(`packages/protocol/apps/blueprint/`의 scope와 type)을 고치므로 같이 돌면 이름 바꾸기와 부딪힌다. lead는 시작할 때 `git grep -il blueprint`로 범위를 다시 잰다(아래 수는 2026-10-23 main `3fddc74b5` 기준이다).

## 범위

살아 있는 code와 문서 약 190 file이다(2026-10-23 조사).
- protocol 29, core/apps 66, core/main·server·lophn-agent 11, agent-roles 7, SDK 19, shell 14, coding-agent 2, tools(wireframes 포함) 7, tests/support와 e2e 14, eval code·criterion·type 7, 살아 있는 문서 14
- eval 재료의 새 판과 registry, 시나리오 다시 고정 약 35 file

text만 바꾸는 안(약 25 file)은 file 이름 `blueprint.ts`, tool `blueprint_check`, SDK `@lophn/blueprint`, 실패 code `blueprint_missing`, `release.get`의 `blueprint_hash`가 agent에게 그대로 보여 개념이 사라지지 않는다. 그래서 전부 바꾼다(agent, planner).

## 정한 것

agent(planner)가 정했다. 겹치는 이름은 2026-10-23 조사로 확인했다.

이름
- **개념은 "선언(declaration)"이다.** 사람 화면(wording)은 이미 "declarations"라 부르고, 문서도 대부분 "선언"이다.
- **앱 source의 선언 file은 `lophn.ts`다.** `Dockerfile`, `wrangler.toml`처럼 그 file을 읽는 쪽 이름을 쓰는 개발 관례다. "manifest"는 bundle의 `manifest.json`(`BundleManifest`)과 겹쳐 쓰지 않는다. `@lophn/app`은 template import map에서 `./main.ts`의 별칭이라 쓰지 않는다.
- **SDK는 `@lophn/declaration`이고 `defineApp`, `validateDeclaration`, type `AppDeclaration`을 낸다.**
- **agent tool은 `declaration.check`, route는 `declarations/check`, CLI는 `lophn app declaration`이다.**
- **release와 bundle:** `blueprint_hash`는 `declaration_hash`, release 표의 `blueprint` 열은 `declaration`, bundle의 `blueprint.json`은 `declaration.json`이다. 지금 `declarations`라는 이름의 파생 사실(release 표의 `declarations` 열, `AppDeclarations`, `declarationsOfBlueprint`)은 `facts`(`AppFacts`, `factsOfDeclaration`)로 바꿔 겹치지 않게 한다.
- **실패 code:** `declaration_missing`, `declaration_eval_failed`, `not_a_declaration`.
- **선언의 부분 이름(`ToolDeclaration`, `ScreenDeclaration`, `AppToolUseDeclaration`)은 그대로 둔다.** 이미 "선언"의 일부라는 뜻이다.
- 나머지 내부 이름(protocol·core 폴더 `blueprint/`, 함수, shell identifier, 주석)도 같은 꼴로 바꾼다. 뒤에 읽는 사람이 두 이름을 맞춰 보지 않게 한다(AGENTS.md "호환성").
- 겹침이 더 나오면 그 task가 정하지 않고 보고한다. lead가 planner에게 묻는다.

저장과 기록
- release 표의 열 이름과 schema step이 바뀐다. migration 없이 개발 data를 새로 만든다.
- 모든 bundle hash가 바뀐다(file 이름이 bundle manifest에 들어간다). 개발 data를 새로 만들면 된다.
- **eval:** 재료 `notify-app`, `calendar-app`, `calendar-app-bug`는 제품 길(release 준비)로 되살리므로 이름이 바뀌면 준비가 떨어진다. 새 판 @4를 만든다. 그 재료를 needs로 가리키는 `date-range`와 `calendar-data`도 needs만 바꾼 @4를 만든다. 그리고 registry hash와 시나리오 8개(calendar-dev, calendar-user, calendar-api, calendar-maintain, calendar-diagnose, L4-new, L7, O4)를 다시 고정한다. criterion `card-covered`는 judge 입력의 `[BLUEPRINT]` 이름표를 바꾸므로 @5를 만든다. check id `blueprint-kept`는 `declaration-kept`로 바꾸고, 지난 run과의 비교가 끊긴다는 것을 changelog에 적는다.
- coding agent 첫 prompt(`packages/protocol/coding-agent/launch-plan.ts`)와 template `AGENTS.md`가 선언 고치기를 서로 다르게 말한다. template 쪽(coding agent가 `lophn.ts`와 `deno.json`을 같이 고친다)에 맞춘다.

## 순서

이름 표의 파생 규칙, 공통 절차, 남아도 되는 곳, planner의 답은 `names.md`에 있다. 모든 task가 먼저 읽는다.

- wave 1(하나): protocol·core·SDK의 `blueprint` 폴더와 file을 옮기고, flat 옛 사본(`packages/protocol/apps/blueprint*.ts`)을 지우고, import를 모두 고친다. 다른 lane의 file을 거의 다 건드리므로 혼자 먼저 간다.
- wave 2(같이): release·DB·bundle / runtime·supervisor·preview·permissions / agent가 읽는 글과 template과 SDK guide / shell과 wireframe / 살아 있는 문서
- wave 3: `tests/support/app`과 e2e, 그 뒤 eval(check, judge 입력, criterion, 재료 @4, registry, 시나리오 고정). 재료마다 이름이 바뀐 release 준비를 지나야 한다.
- wave 1·2가 끝난 plan branch는 e2e가 깨져 있다(sample과 e2e는 wave 3에서 고친다). 그래서 wave마다 land하지 않고 wave 3 뒤에 한 번 land한다.

## 위험 test

새 위험 test는 없다. 이름만 바뀐다. 있는 test(선언 검사, release 봉인, 앱 호출, parser parity)가 그대로 통과해야 한다. e2e는 land가 돌린다.

## lead가 할 일

- 시작할 때 범위를 다시 잰다. `app-oauth`가 더한 file이 있다.
- wave마다 `git grep -il blueprint -- ':!tests/eval/runs' ':!project-docs/products/change-log' ':!project-docs/issues/archived'`로 남은 곳을 본다. 끝에는 eval 지난 재료 판(@1~@3)만 남아야 한다.
- 화면 task를 merge할 때 `deno run -A packages/shell/renderer/build.ts`를 돈다.
- eval 재료 @4는 `deno task eval`의 되살리기 길로 한 번 준비가 지나는지 본다. 실제 model provider는 부르지 않는다(되살리기는 provider를 부르지 않는다. 부르게 되면 사람에게 묻는다).
- 다 끝나면: 살아 있는 architecture 문서, `PRODUCT.md`, `AGENT-ROLE.md`, roadmap(`eval.md`, `domain.md`, `app-preview.md`)의 이름을 고치고, root `ISSUE-blueprint-domain.md`의 일이 끝났다고 사람에게 알리고, changelog 열린 판에 항목(개발 data 새로 만들기, eval 비교 끊김)을 쓰고, 계획 폴더를 지운다.
- 사람에게 묻는 것: AGENTS.md "사람에게 묻는 것" 전부, subprocess·Worker·서버·브라우저를 띄우는 새 test. 그 밖은 planner에게 묻는다.

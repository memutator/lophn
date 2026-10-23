# br-agent-text

agent가 읽는 글(role 지침, skill, agent tool 설명, coding agent CLI 설명과 첫 prompt, 앱 template의 AGENTS.md와 주석, SDK guide)에서 "blueprint" 개념을 걷어내고 "앱의 선언"으로만 말한다. coding agent 첫 prompt(`launch-plan.ts`)와 template `AGENTS.md`가 선언 고치기를 서로 다르게 말하는 것을 template 쪽에 맞춘다.

- 단위: br-agent-text (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/`
  - `packages/core/apps/agent-tools/`
  - `packages/coding-agent/`
  - `packages/protocol/coding-agent/launch-plan.ts`
  - `packages/core/apps/packages/template/`
  - `packages/sdk/declaration/guide.md`
  - `packages/sdk/app-ui/`
  - `packages/sdk/cap-fs/`
  - `packages/sdk/cap-net/`
  - `packages/sdk/cap-secret/`
  - `packages/sdk/cap-tool/`
- 읽을 것:
  - 공통: `project-docs/plan/blueprint-remove/names.md`, `project-docs/plan/blueprint-remove/README.md` ("정한 것"의 마지막 줄: launch-plan과 template AGENTS.md)
  - 배경: root `ISSUE-blueprint-domain.md` ("왜 다시 보나"와 "정한 것": App Engineer와 coding agent가 받는 글에서 개념을 걷어낸다)
  - architecture: `project-docs/architecture/coding-agent.md`(coding agent가 받는 글), `project-docs/architecture/agent-definition.md`(tool 설명과 지침), `project-docs/architecture/app-call.md`
  - 본보기: `packages/core/apps/packages/template/app/AGENTS.md.tmpl`("설계와 구현의 구별", "파일", "명령" 절. coding agent가 `lophn.ts`와 `deno.json`을 같이 고친다는 쪽이 정본이다)
  - 코드: `packages/protocol/coding-agent/launch-plan.ts`의 `firstPromptOf`
- 계약:
  - 쓰는 것: `br-move`가 바꾼 이름(tool `declaration.check`, CLI `lophn app declaration`, 앱 source의 `lophn.ts`, SDK `@lophn/declaration`의 `defineApp`).
  - 내놓는 것: 없음. 글만 바뀐다. tool·CLI·file 이름은 이미 `br-move`가 바꿨고 이 task가 바꾸지 않는다.

## 할 일

1. 인벤토리(`names.md` "공통 절차" 1). `br-move`의 보고 "넘길 줄"에서 이 lane 몫을 먼저 본다.
2. `agent-roles`: `roles/app-engineer/prompt.md`, `roles/project-manager/prompt.md`, `skills/guide-roles-and-assignments/SKILL.md`, `place/place-info.ts`(agent에게 보이는 줄 `Blueprint: ...`는 그 줄이 보여 주는 것이 앱 선언 file이면 이름 표에 따라 선언을 말하게 고친다), `place/place-data.ts`, `credentials.ts`, `tool-lists.ts`의 주석. 지침 문장에 "blueprint"라는 개념어가 남지 않게 한다. ticket 예에 "blueprint의 app_connections에 ... 선언한다" 같은 말이 있으면 "앱의 선언(`lophn.ts`)의 `app_connections`"처럼 file 이름과 칸 이름으로 말한다.
3. `apps/agent-tools`(`app.ts`, `app-card.ts`, `release.ts`, `visual.ts`): tool 설명과 오류 message. tool 설명은 agent가 읽는 글이니 "declaration"이 무엇인지(앱 code 안의 `lophn.ts`, release와 같이 봉인된다)가 한 번 분명해야 한다. `declaration.check` 설명이 그렇다.
4. `coding-agent`: `cli/commands/app.ts`의 `entryOf("app declaration", ...)` 설명 문장(`br-move`는 이름만 바꿨다), `cli/commands/types.ts` 주석, `harnesses/`는 인벤토리에 있으면 고친다.
5. `protocol/coding-agent/launch-plan.ts`의 `firstPromptOf`: 지금 "2. 막히거나 blueprint 변경이 필요하면 `lophn message send`로 알린다."는 coding agent가 선언을 직접 고치지 않고 알리라는 말이다. template `AGENTS.md.tmpl`은 반대로 `lophn.ts`를 coding agent가 직접, 코드보다 먼저 고치고 `deno.json`의 import map과 같은 정확한 version으로 같이 맞추라고 한다. template 쪽에 맞춘다: 선언(`lophn.ts`)이 맡은 일에 필요하면 직접 고치고(`deno.json`도 같이), 막혔을 때만 `lophn message send`로 알린다고 쓴다. 이 prompt 글을 검사하는 test가 있으면 그 기대값도 같이 고친다(약하게 하지 않는다). `firstPromptOf`를 쓰는 곳(`core/apps/coding/hook.ts`, `sessions.ts`)은 함수 모양이 같아 건드리지 않는다.
6. 앱 template `packages/core/apps/packages/template/`: `app/AGENTS.md.tmpl`("설계와 구현의 구별", "파일", "명령"의 문장), `app/lophn.ts.tmpl`의 주석, `app/tests/declaration_test.ts.tmpl`, `app/tests/wording_test.ts.tmpl`, `app/src/tools.ts.tmpl`, `app/src/screens/home/app.tsx.tmpl`, `app/deno.json.tmpl`의 주석. `AGENTS.md.tmpl`에서 개념어 "blueprint"를 걷고 "선언"이나 `lophn.ts`로 말한다. `files.ts`의 `REQUIRED_TEMPLATE_FILES`(이름은 `br-move`가 바꿨다)와 scaffold·install test가 통과한다.
7. SDK 글: `packages/sdk/declaration/guide.md`는 새 SDK(`defineApp`, `validateDeclaration`, `AppDeclaration`)를 설명하는 guide로 다시 쓴다. 내용(선언의 칸과 검사)은 그대로이고 이름만 맞춘다. `app-ui`(`guide.md`, `mod.ts`, `tool-button.tsx`, `use-tool.ts`), `cap-fs`·`cap-net`·`cap-secret`(`declaration.ts`·`errors.ts`·`guide.md`·`secret.ts`)의 지역 이름·주석·guide 문장도 고친다. cap-*의 `declaration.ts`가 내놓는 `checkDeclaration`은 그대로다(그 package 하나의 선언을 검사하는 함수다).
8. template에서 견본 업무(`add_item`/`list_items`, `items` 화면)를 빼는 일은 이 계획 밖이다. 건드리지 않는다.

## 끝남

- `deno task check`와 `deno task check:full`이 통과한다.
- 위험 test: 없음. 있는 test(scaffold, template 설치 `install_test.ts`, coding-agent CLI와 harness test, launch plan)가 그대로 통과한다.
- 남지 않음:
  - `git grep -il blueprint -- packages/core/agent-roles packages/core/apps/agent-tools packages/coding-agent packages/protocol/coding-agent packages/core/apps/packages/template packages/sdk/declaration packages/sdk/app-ui packages/sdk/cap-fs packages/sdk/cap-net packages/sdk/cap-secret packages/sdk/cap-tool`가 0줄이다.
  - `git grep -n -i "blueprint" -- packages/sdk`가 0줄이다.
  - `firstPromptOf`의 2번 줄과 template `AGENTS.md.tmpl`의 선언 고치기 문장이 같은 말이다. 보고에 두 문장을 나란히 적는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없으면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(특히 launch-plan 2번 줄의 최종 문장)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 없으면 "없음"
- 남은 blueprint 줄, 겹침: `names.md`의 "보고에 더할 것"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

# doc-paths

문서 속 backtick 저장소 path와 `context-component-registry.yaml`의 `path`·`change_reasons.boundaries`·`roles`가 실제로 있는지 보는 check(`tools/check-docs.ts`)를 만들어 `tools/check.ts`에 단계 하나로 올리고, 지금 걸리는 문장을 지금 사실에 맞게 고친다.

- 단위: doc-paths (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/check-docs.ts`
  - `tools/check.ts`
  - `.claude/skills/write-test/SKILL.md`
  - `project-docs/architecture/layers.md`
  - `project-docs/issues/agent-definition.md`
  - `project-docs/issues/code-health.md`
  - `project-docs/issues/layers.md`
  - `project-docs/issues/place-session.md`
  - `project-docs/issues/platform.md`
- 읽을 것:
  - 이슈: `project-docs/issues/mistakes.md`의 "새로 쓴 문서와 주석이 지운 파일을 가리킴"(이 task가 닫는 절. 닫는 일은 lead가 한다)
  - registry 꼴: `project-docs/context-component-registry.yaml` 머리 주석(roles, components, `path`, `change_reasons.boundaries`·`paths`)
  - 본보기: `tools/check-modules.ts`(`@std/yaml`로 읽기, `Issue` 목록, `import.meta.main`에서 오류를 찍고 exit code를 정하는 꼴), `tools/check.ts`(`buildSteps`)
  - boundary·module: `project-docs/boundary-catalog.yaml`(ID는 `elements`를 `children`까지 돈 것과 `interfaces`), `project-docs/module-catalog.yaml`의 `tools`
  - test 기준: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `deno.json`의 `check` task가 `tools/check.ts`를 돈다. 새 file은 `check-modules.ts`처럼 `deno run --allow-read tools/check-docs.ts [root]`로 돈다(root 기본은 cwd).
  - 내놓는 것: `deno task check`의 단계 `docs`. 실패하면 `<file>:<줄> 없는 path: <path>` 꼴로 찍고 exit 1.

## 지켜야 할 것(계획 README 그대로)

- module은 `core/main`을 import하지 않는다. 바닥은 위층을 import하지 않는다. domain끼리는 problems → apps만.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 설치 사본은 읽기 전용이고 release bundle에 굳힌 사본과 섞지 않는다.

이 task는 코드 module을 만지지 않으니 앞의 셋은 닿지 않는다. `tools/check-docs.ts`는 packages를 import하지 않는다.

## 돌리기 전에 알 것

- 다른 session이 test·E2E 계획에서 `tools/check.ts`, `tools/dev.ts`, `tools/fake-provider`를 고칠 수 있다(계획 README "돌리기 전에"). 이 task는 `tools/check.ts`에 `docs` 단계 하나와 그것이 쓰는 줄만 더한다. 다른 줄을 정리하지 않는다. 합칠 때 부딪치면 lead가 두 쪽을 다 남긴다.
- 문장 고치기 file 여럿(`issues/layers.md`, `place-session.md`, `agent-definition.md`, `code-health.md`, `architecture/layers.md`)은 계획 `agent-place`가 만드는 절(question-path, place-folders, mcp-grants, role-rules)과 같은 file이다. lead가 merge 때 그 절을 닫거나 지우면 이 task의 고친 줄이 같이 사라지거나 부딪칠 수 있다. 그 경우는 lead가 지우는 쪽을 따른다. 이 task는 그 계획의 task가 이미 고치는 줄을 따로 정리하지 않는다. `platform.md`(sdk 설치 사본 절)는 `sdk-install`이 닫는다.

## 할 일

1. `tools/check-docs.ts`를 만든다. 근거: `mistakes.md` "고치려면", 계획 README "정한 것" 6, `tools/check-modules.ts` 꼴.
   - 대상: `AGENTS.md`와 `.claude/skills/`, `project-docs/` 아래 모든 `.md`·`.yaml`(폴더를 돌아 찾는다. `node_modules`는 건너뛴다. `.claude/worktrees/`는 `.claude/skills/`만 보므로 닿지 않는다). 제외(앞으로 생길 path·옛 path를 적는 곳): `project-docs/products/change-log/`, `project-docs/issues/archived/`, `project-docs/plan/`, `project-docs/products/roadmap/`.
   - path 찾기: 줄마다 backtick 한 쌍 안의 글 전체가 `packages/`, `project-docs/`, `tools/`, `.claude/` 중 하나로 시작하고 공백이 없으면 저장소 path로 본다(`` `deno run tools/x.ts` `` 같은 명령은 `deno`로 시작해 저절로 빠진다). fenced code block(`` ``` ``) 안은 건너뛴다. 그 path가 root 기준으로 있어야 한다(file이든 폴더든 `Deno.stat`).
   - 건너뛰기: `<` `>` `*` `{` `}` `...` `…`가 든 path(glob, placeholder). 문서 기준 상대 path(`../`, `./`, 위 네 접두사가 아닌 것)는 보지 않는다. `:줄번호`나 `#` 꼬리는 지금 문서에 없으니 따로 다루지 않는다.
   - registry(`project-docs/context-component-registry.yaml`): 각 component의 `path`가 있는지, `change_reasons.boundaries`의 ID가 boundary-catalog에 있는지, component의 `roles`가 registry의 `roles` id인지. 정한 것: `change_reasons.paths`도 같은 이유(없는 path를 가리키는 같은 실수)로 있는지 본다. 지금은 다 있다(한 줄이다). boundary ID는 `elements`를 `children`까지 돈 id와 `interfaces`의 id다. `tools/check-modules.ts`는 그 집합을 내놓지 않으니(내보내는 것은 `checkModules`뿐) 몇 줄을 `check-docs.ts`에 따로 쓴다. 두 file이 같은 도우미를 나누게 `check-modules.ts`를 고치지 않는다(범위 밖, 합칠 값이 작다).
   - 결과: 위반마다 `<file>:<줄> 없는 path: <path>`(registry는 `project-docs/context-component-registry.yaml: <component id> path가 없음: <path>` 같은 한 줄). 하나라도 있으면 exit 1, 없으면 `docs: 통과`. 오류 코드·Result는 쓰지 않는다(CLI check script다. `check-modules.ts`와 같은 꼴).
   - 주석은 "왜"만. 제외 폴더가 왜 빠지는지(앞으로 생길 path, 옛 path), `tools/…` 상대 표기가 왜 안 되는지(저장소 root `tools/`와 헷갈린다) 정도.
2. `tools/check.ts`에 단계 `docs`를 더한다. 근거: 지금 코드의 `buildSteps`.
   - 자리: `modules` 단계 바로 뒤에 `checks.push({ name: "docs", commands: [["deno", "run", "--allow-read", "tools/check-docs.ts"]] })`.
   - non-full에서 언제 도는가: **늘 돈다**(`deps`처럼 조건 없이). 이유는 코드로 확인했다. non-full은 바뀐 file을 `packageOf`로 package에 묶는데 md·yaml은 `undefined`라 `run`이 비어도(문서만 바꿨을 때) `source`·`modules`는 `run.size > 0`이나 `catalogChanged`가 아니면 건너뛴다. 그런데 이 check가 잡으려는 것은 문서만 바뀐 변경(문서 path가 틀림)이므로 조건을 걸면 못 잡는다. `catalogChanged`도 `project-docs/*.yaml`만 보고 `AGENTS.md`와 `.claude/skills/`는 안 본다. 비용은 md·yaml 읽기뿐이라 작다.
   - `tools/check-docs.ts`는 `/^tools\/check[^/]*\.ts$/`에 걸려 `packageOf`가 "all"이다. 이 task를 검증할 때 전 package가 도는 것은 정상이다.
   - 파일 머리 주석(`// 빠른 check…`)이나 다른 단계는 고치지 않는다.
3. `.claude/skills/write-test/SKILL.md`의 "check 파이프라인" 표에서 `deno task check` 행의 단계 나열에 `docs`(문서 속 path가 있는지)를 한 구절 더한다. 근거: AGENTS.md "동작을 바꿔 문서와 달라지면 같은 변경에서 그 문서를 고친다". 다른 줄은 고치지 않는다.
4. 지금 걸리는 문장을 고친다. 최소 수정(지금 사실에 맞는 path로)이다. 근거: check가 통과해야 하고, 이 문장들은 `mistakes.md`가 말한 같은 실수다. 고치는 일 전에 `deno run --allow-read tools/check-docs.ts`를 돌려 아래 목록과 맞는지 본다. 목록은 brief를 쓸 때 grep과 `ls`로 찾은 것이라 달라졌으면 실제 출력을 따른다(28줄, 6 file).
   - **원인 가) harness 안 상대 표기.** `tools/…`는 `packages/core/lophn-agent/tools/…`다(저장소 root `tools/`가 아니다). 전부 그 폴더에 실제로 있다. 앞에 `packages/core/lophn-agent/`를 붙인다. 앞에 이미 `lophn-agent`를 풀어 적은 문장도 path는 전체로 쓴다.
     - `project-docs/architecture/layers.md` 77줄: `tools/registry.ts`, `tools/spi.ts` / 87줄: `tools/questions/`
     - `project-docs/issues/agent-definition.md` 25줄: `tools/file/read.ts`, `tools/file/pdf.ts`, `tools/file/image.ts` / 40줄: `tools/shell/run.ts`, `tools/result.ts` / 53줄: `tools/web/fetch.ts` / 68줄: `tools/commands.ts`, `tools/file/image.ts`
     - `project-docs/issues/code-health.md` 18줄(절 제목), 25줄, 29줄: `tools/questions/`, `tools/questions/wait.ts`
     - `project-docs/issues/layers.md` 15줄: `tools/app-tools.ts`, `tools/app-toolkit.ts`, `tools/app-api/input.ts`, `tools/runtime-permissions.ts` / 16줄: `tools/bundles/call.ts`, `tools/call/target.ts`, `tools/file/image.ts` / 16줄 `tools/file/read.ts` / 17줄: `tools/questions/option-actions.ts`
     - `project-docs/issues/place-session.md` 28줄: `tools/runtime-permissions.ts`, `tools/file/read.ts`
   - **원인 나) 옮겨진 path.** `project-docs/issues/platform.md` 56줄: `packages/template/import-map.ts`, `packages/template/scaffold.ts`는 지금 `packages/core/apps/packages/template/import-map.ts`, `…/scaffold.ts`다(`packages/template/`는 없다).
   - `code-health.md` 18줄은 절 제목(`` ## `tools/questions/`의 ledger 질문 길이 쓰이지 않는다 ``)이다. 제목도 `` `packages/core/lophn-agent/tools/questions/` ``로 고친다(제목 밖 말로 풀어 check를 피하지 않는다). 계획 `agent-place`의 README·brief가 이 제목을 옛 글자로 가리키지만 `project-docs/plan/`은 check 제외라 깨지지 않고, 그 계획의 lead가 닫을 때 이슈를 찾을 이름이 바뀐 것을 보고에 적어 알린다.
   - 같은 이유로 `mistakes.md`의 그 절 자체는 건드리지 않는다(닫기는 lead). 이 절에 든 `tools/check-modules.ts` 같은 backtick path가 이미 맞는지는 check가 본다.
5. `deno task check`를 돌려 `docs` 단계가 도는지 보고, 일부러 틀린 path 하나를 임시로 넣어 실패하는 것을 한 번 확인한 뒤 되돌린다(test file로 남기지 않는다).

## 끝남

- `deno task check`가 통과하고 단계 표에 `docs`가 `통과`로 나온다.
- 위험 test: 없음. 이 check는 문서를 읽는 구조 검사이고 사용자 data, 권한, secret, sandbox 경계와 관계없다. `write-test`: 문서를 글로 읽어 검사하는 test와 화면·문구는 쓰지 않는다. 구조 규칙은 check가 맡는다. 새 E2E·subprocess·서버 test를 쓰지 않는다.
- 남지 않음:
  - `deno run --allow-read tools/check-docs.ts`가 `docs: 통과`.
  - ``grep -rnE '`tools/(registry|spi|questions|file|shell|web|bundles|call|app-api|app-tools|app-toolkit|runtime-permissions|commands|result)' AGENTS.md .claude/skills project-docs --include=*.md --include=*.yaml``가 제외 폴더(`project-docs/plan/`, `products/change-log/`, `issues/archived/`, `products/roadmap/`) 밖에서 0줄이다.
  - `grep -rn 'packages/template/' AGENTS.md .claude/skills project-docs`가 제외 폴더 밖에서 `packages/core/apps/packages/template/`뿐이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 `project-docs/context-component-registry.yaml`에 `tool-check-docs`(kind tool, roles `[planner]`, path `tools/check-docs.ts`, run `deno run --allow-read tools/check-docs.ts`, change_reasons note는 "문서나 registry의 꼴이 바뀔 때") 조각. `tool-check`의 description에 `docs`를 더할지. module-catalog는 `tools` 폴더 안 file이라 안 바뀐다. worker는 registry를 고치지 않는다(lead).
- 안 쓰게 된 export: 없음
- 정한 것: `change_reasons.paths`도 보는 것, fenced block을 건너뛰는 것, `docs`가 non-full에서 늘 도는 것
- 넘길 줄: 다른 계획이 닫을 절의 줄을 맞춘 곳(file과 줄)
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 문서 기준 상대 path와 `:줄`·`#` 꼬리, 제외 폴더 안의 path는 보지 않는다(첫판 범위). 모듈 상대 표기를 다시 쓰는 문장은 check가 root 기준으로 보고 막는다.

# agent-places-rename

module `packages/core/agent-roles`를 `packages/core/agent-places`로 옮기고 import 경로, deps 검사의 층 이름, 경로를 글로 적은 test·eval을 고친다. 안의 file 이름, export, 동작은 바꾸지 않는다.

- 단위: agent-places (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles` (옮겨서 없앤다)
  - `packages/core/agent-places` (새 자리)
  - `packages/core/lophn-agent/agents/{commands_test,definition-file_test,reads_test,resolve_test,role-table}.ts`
  - `packages/core/lophn-agent/extensions/mcp-snapshot.ts`
  - `packages/core/lophn-agent/places/ports.ts`
  - `packages/core/main/agent-runtime/{main,product-driver}.ts`
  - `packages/core/main/{agent-tools,agent-tools_test,tool-names_test}.ts`
  - `packages/core/main/daemon/place-folders-glue.ts`
  - `packages/core/main/daemon/wiring/{instructions-registration,lophn-agent-extensions,lophn-agent-registration,lophn-agent-runtime,lophn-agent-team,lophn-agent,secrets}.ts`
  - `tests/e2e/{file-write,prompt-notice,registration}_test.ts`
  - `tests/eval/experiment/gate/gate_test.ts`
  - `tests/eval/experiment/variant/texts.ts`
  - `tests/eval/versions/{components,files,versions_test}.ts`
  - `tests/live/suite.ts`
  - `tools/check-deps.ts`
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "정한 것" > "session과 place 종류" 끝 줄(module `packages/core/agent-roles`는 `packages/core/agent-places`로 이름을 바꾼다), "뼈대 검토"의 "eval의 지난 기록은 고치지 않는다"
  - architecture: `project-docs/architecture/layers.md`의 "모양"과 "규칙과 그 이유". core 층과 `tools/check-deps.ts`가 지키는 import 규칙이 있다. 이 module은 그 표에서 role 층(`agent-roles`)이다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`와 interface `agent-tool-spi`. `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`. 옮기면 없는 path가 된다. 이 task는 catalog를 고치지 않는다(아래 할 일 7).
  - 코드:
    - `tools/check-deps.ts`의 core 층(77~118줄 `CORE_ROLES`, `coreLayerViolation`), tool 정의 file 규칙(170~190줄 `ROLE_TOOL_DIR`), 판 이름 검사의 내장 skill 폴더 예외(264줄)
    - `tools/check-modules.ts`, `tools/check-docs.ts`: 옮긴 뒤 무엇이 실패하나
    - `tests/eval/versions/files.ts`: path로 eval component를 가르는 표
    - `packages/core/agent-roles/skills/root.ts`, `packages/core/agent-roles/roles/prompts.ts`: 안의 file을 `import.meta.url` 기준으로 읽는다. 옮겨도 고칠 것이 없다.
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: wave 2부터 이 module의 자리는 `packages/core/agent-places/`다. 안의 file과 export 이름은 그대로다. `ROLE_TABLE`·`AgentRoleTable`은 `agents-core`가, `roles/` 폴더(지침 글)는 `place-prompts`가 바꾼다. deps 검사(`tools/check-deps.ts`)의 core 층 이름도 `agent-places`다.

## 할 일

기계적 이동이다. 이름(file, export, 함수, role 낱말이 든 다른 이름)과 동작은 바꾸지 않는다. 바꾸는 것은 `agent-roles`라는 module 이름이 든 글뿐이다. 근거는 README "module `packages/core/agent-roles`는 `packages/core/agent-places`로 이름을 바꾼다"다. 아래 줄 번호는 HEAD 706993098 기준이다.

1. `git mv packages/core/agent-roles packages/core/agent-places`. file 52개다.
   - 안의 file은 고치지 않는다. 안에는 `agent-roles`라는 글이 없다.
   - 상대 import는 깊이가 같아 그대로 맞는다(`../lophn-agent/...`, `../../protocol/...`).
2. **import 경로**: specifier의 `agent-roles/`를 `agent-places/`로 바꾼다.

   | file | 줄 |
   |---|---|
   | `packages/core/lophn-agent/agents/commands_test.ts` | 8 |
   | `packages/core/lophn-agent/agents/definition-file_test.ts` | 8 |
   | `packages/core/lophn-agent/agents/reads_test.ts` | 8 |
   | `packages/core/lophn-agent/agents/resolve_test.ts` | 4 |
   | `packages/core/main/agent-runtime/main.ts` | 9, 10 |
   | `packages/core/main/agent-runtime/product-driver.ts` | 41, 42, 43, 44, 45, 49, 53, 54, 71 |
   | `packages/core/main/agent-tools.ts` | 1, 2 |
   | `packages/core/main/agent-tools_test.ts` | 4, 6, 7 |
   | `packages/core/main/tool-names_test.ts` | 5 |
   | `packages/core/main/daemon/place-folders-glue.ts` | 13, 14 |
   | `packages/core/main/daemon/wiring/instructions-registration.ts` | 3, 8 |
   | `packages/core/main/daemon/wiring/lophn-agent-extensions.ts` | 9 |
   | `packages/core/main/daemon/wiring/lophn-agent-registration.ts` | 12, 14 |
   | `packages/core/main/daemon/wiring/lophn-agent-runtime.ts` | 18, 21 |
   | `packages/core/main/daemon/wiring/lophn-agent-team.ts` | 7, 8, 9, 10, 11 |
   | `packages/core/main/daemon/wiring/lophn-agent.ts` | 18, 19, 23 |
   | `packages/core/main/daemon/wiring/secrets.ts` | 8 |
   | `tests/e2e/file-write_test.ts` | 13 |
   | `tests/eval/versions/components.ts` | 3, 4 |
   | `tests/eval/versions/versions_test.ts` | 6, 7 |
   | `tests/live/suite.ts` | 15, 16 |
   | `tests/eval/experiment/variant/texts.ts` | 14. script 글 안의 dynamic import다 |

3. **주석의 module 이름**: `agent-roles`만 `agent-places`로 바꾼다. 같은 주석의 role 말은 고치지 않는다. 뒤 task가 다시 쓴다.
   - `packages/core/lophn-agent/agents/role-table.ts` 10줄: "role 층(agent-roles)"
   - `packages/core/lophn-agent/places/ports.ts` 33줄
   - `packages/core/lophn-agent/extensions/mcp-snapshot.ts` 56줄
   - `packages/core/main/daemon/place-folders-glue.ts` 1줄
   - `packages/core/main/daemon/wiring/lophn-agent-team.ts` 2줄
4. **eval의 경로 문자열**:
   - `tests/eval/versions/files.ts`:
     - 31~34줄: `TOOL_FILES`
     - 50줄: `ROLES` 상수의 값만 바꾼다. 이름은 그대로 둔다.
     - 55줄: `SKILL` 정규식 `agent-roles` → `agent-places`
     - 58줄: `RUNTIME`
   - `tests/eval/versions/components.ts` 44줄: `SKILL_ROOTS`
   - `tests/eval/versions/versions_test.ts` 61, 62, 154줄
   - `tests/eval/experiment/gate/gate_test.ts` 58줄
   - `versions_test.ts`의 "role이 받는 agent tool은 모두 TOOL_FILES의 source file에 정의돼 있다"는 실제 repo의 `TOOL_FILES`를 읽는다. 1번 뒤 `files.ts`를 안 고치면 이 test가 깨진다.
   - 지난 eval 기록은 고치지 않는다: `tests/eval/runs/`, `tests/eval/scorecards/`, `tests/eval/experiments/*/`. 지금 `tests/eval/experiments/call-list-without-session/{report.md,spec.json}`에 옛 이름이 있다.
5. **e2e의 boundary 언급**: `tests/e2e/registration_test.ts` 2줄과 `tests/e2e/prompt-notice_test.ts` 2줄의 boundary `` `agent-roles` ``를 `` `agent-places` ``로 바꾼다.
   - 정한 것: boundary ID도 module과 같은 이름으로 간다고 본다(README "남은 축이 place 종류뿐이다").
   - catalog의 ID는 lead가 바꾼다(7번). eval gate(`tests/eval/experiment/gate/e2e.ts`의 `e2eBoundaries`)는 catalog에 없는 ID를 말없이 넘기므로 그 사이에도 깨지지 않는다.
6. **`tools/check-deps.ts`**:
   - 81줄 `const CORE_ROLES = "agent-roles"`를 `const CORE_PLACES = "agent-places"`로 바꾸고 쓰는 곳(104~115줄, 170줄, 186줄)을 모두 바꾼다.
   - 170줄 `ROLE_TOOL_DIR`는 `PLACE_TOOL_DIR`로, 178·179·185줄의 지역 변수 `role`은 `placeTool`로 바꾼다.
   - 77~78줄 주석의 "role 층(agent-roles)"은 "place 층(agent-places)"으로 바꾼다.
   - 264줄 `"packages/core/agent-roles/skills/"`를 `"packages/core/agent-places/skills/"`로 바꾼다.
   - 정한 것: 상수 이름도 바꾼다. 값만 바꾸면 `CORE_ROLES = "agent-places"`가 남아 뒤에 헷갈린다(AGENTS.md "호환성", README "옛 이름이 남으면 뒤에 헷갈린다").
   - harness-domain 규칙의 `ROLE_NAMES`와 "role 이름" 글(122~131, 256, 285줄)은 module 이름이 아니라 role 값을 보는 규칙이다. 그대로 둔다.
   - 층 값이 빠지면 `agent-places`가 바닥 층이 된다. 그러면 `lophn-agent`를 import하는 줄마다 `node tools/check-deps.ts`가 실패하므로 바꾼 것을 이것으로 확인한다.
7. **project-docs는 고치지 않는다**(orchestrate: worker는 `project-docs`를 고치지 않는다). 옮긴 뒤 두 check가 아래 줄로만 실패해야 한다.
   - `node tools/check-modules.ts`
     - `project-docs/module-catalog.yaml`: `없는 path: packages/core/agent-roles`
     - `project-docs/module-catalog.yaml`: `catalog에 없는 폴더: packages/core/agent-places`
   - `node tools/check-docs.ts`의 없는 path:
     - `project-docs/architecture/kinds.md:50`
     - `project-docs/architecture/job.md:117`
     - `project-docs/architecture/agent-definition.md:44`
     - `project-docs/architecture/place-session.md:60`
     - `project-docs/architecture/domain.md:13`
     - `project-docs/issues/place-session.md:12`(path 둘)
     - `project-docs/context-component-registry.yaml`의 `change_reasons.paths`(352줄 `packages/core/agent-roles/place/place-folders.ts`)
   - 이 목록 밖의 실패는 소유 file에서 고친다.
   - 보고의 "등록할 것"에 이 목록과 아래를 적는다.
     - `project-docs/issues/place-session.md` 9줄 `modules:`의 `packages/core/agent-roles`
     - boundary ID `agent-roles`를 쓰는 곳: `project-docs/boundary-catalog.yaml` 89, 255줄, `project-docs/module-catalog.yaml` 56줄, `project-docs/context-component-registry.yaml`의 `boundaries`
8. 나머지 check를 따로 돌린다. `npm run check`는 7번의 두 단계가 먼저 실패하면 나머지 단계를 끈다(`tools/check.ts`는 첫 실패에서 나머지 child를 멈춘다). 그래서 `npm run check`만으로는 나머지가 통과하는지 알 수 없다. 아래를 worktree root에서 돌린다.
   - `node tools/check-deps.ts`
   - `node tools/check-source.ts`
   - `node_modules/.bin/biome format`, `node_modules/.bin/biome lint`
   - `node_modules/.bin/tsc --noEmit -p packages/core`, `-p tests`, `-p tools`, `-p tools/wireframes`
   - 바꾼 곳의 test(`write-test` "돌리기"의 `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test <file...>`):
     - `packages/core/agent-places/**/*_test.ts`
     - `packages/core/lophn-agent/agents/{commands,definition-file,reads,resolve}_test.ts`
     - `packages/core/main/{agent-tools,tool-names}_test.ts`
     - `tests/eval/versions/versions_test.ts`
     - `tests/eval/experiment/gate/gate_test.ts`
   - e2e와 live는 type check(`-p tests`)만 받는다. 돌리지 않는다.

## 끝남

- check:
  - `node tools/check-modules.ts`와 `node tools/check-docs.ts`의 실패 줄이 할 일 7의 목록과 같다. `npm run check`는 그 가운데 먼저 끝난 하나만 찍으므로 둘을 따로 돌려 본다.
  - 할 일 8의 명령이 모두 통과한다.
  - 이 둘이 맞으면 commit하고 보고한다. "통과한 check"에 할 일 8의 명령과 7의 실패 줄을 그대로 적는다.
  - lead는 `merge.sh` 전에 이 branch에서 project-docs의 path와 catalog를 고친 뒤 `check:full`을 돈다.
- 위험 test: 없음. 새로 쓰지 않는다. 옮긴 `packages/core/agent-places/place/place-folders_test.ts`(file 범위, 폴더 밖 쓰기)와 `packages/core/main/agent-tools_test.ts`(tool 목록과 credential 상한)가 그대로 통과한다.
- 남지 않음:
  - `test ! -e packages/core/agent-roles`가 참이다.
  - `grep -rn "agent-roles" packages tools tests --exclude-dir=node_modules | grep -v "^tests/eval/runs/\|^tests/eval/scorecards/\|^tests/eval/experiments/"`가 0줄이다.
  - `grep -n "CORE_ROLES\|ROLE_TOOL_DIR" tools/check-deps.ts`가 0줄이다.
  - `git diff -M --name-status plan/remove-role...HEAD -- packages/core/agent-roles packages/core/agent-places | grep -vc "^R100"`가 0이다. 52 file 모두 내용이 그대로인 이동이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

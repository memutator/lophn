# ds-scope

domain agent의 file 범위와 지침 층을 "domain은 project 하나에 속한다"(1:N)에 맞춘다. 범위는 "그 project의 폴더(폴더 단위) + 그 domain 자기 lophn 자리의 몫"이고, 상대 경로 base는 project의 첫 폴더(없으면 `<data>/domains/<dom>`)다. 지침 층은 전역 → 그 project의 `LOPHN.md` → `DOMAIN.md` → agent 정의 본문이다. `DOMAIN.md`는 Domain Engineer가 file tool로 Gate 없이 쓴다(rewind가 되돌린다). 같은 project에 속한 domain 둘은 prompt에 각자의 `DOMAIN.md`·kind·skill만 싣는다.

- 단위: scope (wave 3)
- 선행: ds-project-registry
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/instructions.ts`
  - `packages/core/agent-roles/place`
  - `packages/core/agent-roles/hooks.ts`
  - `packages/core/agent-roles/hooks_test.ts`
  - `packages/core/agent-roles/credentials.ts`
  - `packages/core/agent-roles/roles`
  - `packages/core/agent-roles/tools/instructions.ts`
  - `packages/core/lophn-agent/instructions`
  - `packages/core/lophn-agent/prompt-assembly/basis.ts`
  - `packages/core/lophn-agent/prompt-assembly/turn-prompt.ts`
  - `packages/core/lophn-agent/prompt-assembly/mod.ts`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/main/agent-runtime/product-driver.ts`
  - `packages/core/main/daemon/place-folders-glue.ts`
  - `packages/core/main/daemon/place-folders-glue_test.ts`
  - `packages/core/main/daemon/wiring/instructions-registration.ts`
- 읽을 것:
  - 계획: `project-docs/plan/domain-split/README.md`("정한 것"의 file 범위, 지침 층, role), `tasks/ds-project-registry.md`(lookup 계약: `domainProject`, `domainFolderPaths`)
  - architecture: `project-docs/architecture/place-session.md`("file tool의 범위는 place가 정한다"), `kinds.md`("prompt: … `<lophn-kinds>`"), `agent-definition.md`, `layers.md`("harness와 lophn domain": role 층이 채우는 값)
  - 제품: `project-docs/products/AGENT-ROLE.md`(Domain Engineer 책임), `project-docs/PRODUCT.md` 3절
  - 코드(R 이름): `packages/core/agent-roles/place/{place-folders,place-data,place-info,data-folder,domain-layer,instruction-rules}.ts`, `packages/core/agent-roles/hooks.ts`, `packages/core/lophn-agent/instructions/{files,model,turn,read}.ts`, `packages/core/lophn-agent/prompt-assembly/{basis,turn-prompt}.ts`, `packages/core/lophn-agent/run-loop/prepare.ts`(`instructionTexts`), `packages/core/main/daemon/place-folders-glue.ts`
  - 본보기(test): `packages/core/main/daemon/place-folders-glue_test.ts`, `packages/core/agent-roles/place/place-folders_test.ts`, `packages/core/lophn-agent/instructions/read_test.ts`
- 계약:
  - 쓰는 것: `ds-project-registry`의 lookup(`domainFolderPaths`, `domainProject`, `activeProjectFolderPaths`, `projectExists`)과 `domain.get`의 `project`, `project.list`.
  - 내놓는 것: 지침 층 `PROMPT_INSTRUCTION_LAYERS = ["global","project","domain","agent"]`(`packages/protocol/lophn-agent/instructions.ts`). `instructions.get` 입력의 `project`는 lophn이 한 project의 `LOPHN.md`를 읽을 때만 준다(`prj_`). 레이어 `domain`은 입력 칸이 없고 session의 domain을 쓴다.

## 정한 것

- `PlaceFacts`(`place-folders.ts`)의 폴더 칸은 이름을 project 뜻으로 돌린다: `projectFolders`는 이 domain의 project 폴더(active일 때), `allProjectFolders`는 active project 전체(lophn 읽기 전용)다. `domainFile`(`<data>/domains/<dom>/DOMAIN.md`) 칸을 더한다.
- Domain Engineer 범위 = `projectFolders` + artifacts + `kindsFile` + `domainFile` + 앱 source + skill 폴더. Operator = `projectFolders` + artifacts. lophn = `allProjectFolders` 읽기만. 앱의 `app/` 아래 data·release 사본과 `agents/`, `extensions.json`은 열지 않는다(지금과 같다).
- `base` = `projectFolders[0] ?? dataFolder`. project에 폴더가 없으면 상대 경로는 `<data>/domains/<dom>` 기준이다.
- `LOPHN.md`는 project 몫이다. 폴더 없는 domain의 `<data>/domains/<dom>/LOPHN.md` 대체 자리는 없앤다(`instructions/files.ts`의 `projectDataFolder`, `instructions-registration.ts`). project가 폴더 0개면 `project` 층은 비어 있다.
- `project` 층은 그 domain의 project 첫 폴더의 `LOPHN.md` 하나다(합치지 않는다). 상한 처리는 지금과 같다.
- `DOMAIN.md` 쓰기는 Gate에 묻지 않는다. `isInstructionFile`(`hooks.ts`)은 `LOPHN.md`만 가려내고 그대로 둔다. `DOMAIN.md`가 없을 때 `domain` 층은 빈 글이다(안 만든다).
- lophn은 place가 없어 `project`·`domain` 층이 비어 있다(`instructions/turn.ts`의 lophn 분기를 `domain` 층에도 건다).

## 할 일

1. **범위.** `place-folders.ts`의 `PlaceFacts`·`placeScope`·`runtimeFolders`를 위 규칙대로 고친다. `runtimeFolders`(agent runtime child의 Deno 권한 합집합)에 domain마다 `DOMAIN.md` 쓰기를 더한다. 근거: `place-session.md`가 "폴더 종류를 더하면 두 곳(`placeScope`와 `runtimeFolders`)을 같이 고친다. 한쪽만 고치면 file tool은 열렸는데 child가 거절한다"고 정한다.
2. **glue.** `place-folders-glue.ts`의 `placeFoldersOf`가 `domainFolderPaths`로 `projectFolders`를 채우고 `domainFile`을 넣는다. kinds 파일처럼 `DOMAIN.md`도 rewind root는 부모 폴더로 바꾼다(같은 부모는 한 번만 담는다). `runtimeFoldersOf`는 `activeProjectFolderPaths`를 쓴다.
3. **place 정보.** `place-data.ts`는 `domain.get`의 `project`(이름, 폴더, 하위 폴더)로 `projectFolders`와 prompt 재료를 채우고, lophn의 `allProjectFolders`는 `project.list`로 읽는다(`credentials.ts`의 `PLACE_READS`에 `projectApi.list.name`을 더한다). `place-info.ts`는 prompt에 project 이름과 폴더(설명, 하위 폴더), 상대 경로 base 문장, `Domain file: <path>`(DE만)를 싣는다. 폴더 문장은 "이 domain의 agent는 이 domain의 project 폴더를 읽고 쓴다"는 사실만 쓴다.
4. **지침 층.** protocol `PROMPT_INSTRUCTION_LAYERS`를 4층으로 늘린다. `instructions/{model,turn,files}.ts`, `prompt-assembly/{basis,turn-prompt,mod}.ts`의 `INSTRUCTION_LAYERS`·`InstructionTexts`·층 제목(`Project instructions (LOPHN.md)`, `Domain instructions (DOMAIN.md)`)·`run-loop/prepare.ts`의 `instructionTexts`를 맞춘다. 층이 바뀌면 notice로 알리는 기존 길(`basis`의 diff)이 새 층에도 그대로 돈다.
5. **reader.** `instructions/files.ts`의 `InstructionReadDeps`를 새 층에 맞춘다: `domainProject`(그 domain의 project와 첫 폴더). `mayReadOtherProject`(lophn만 남의 project `LOPHN.md`를 읽는다)는 그대로다. `instructions-registration.ts`가 `projects`의 lookup을 꽂는다. `agent-roles/tools/instructions.ts`(`instructions.read`)의 입력은 `project: prj_`이고 설명 문구를 맞춘다.
6. **prompt·guide 문장.** `roles/domain-engineer/prompt.md`, `roles/operator/prompt.md`, `roles/lophn/prompt.md`, `roles/lophn/guides/*.md`에서 project와 domain의 역할을 가른다: 파일은 project의 폴더에 있고, 글·kind·skill·artifact는 domain 자리에 있다. `LOPHN.md`(project 지침, 쓰기는 Gate)와 `DOMAIN.md`(domain 글, Domain Engineer가 쓴다, Gate 없음)를 설명한다. 새 동작을 지어내지 않는다. kind glob은 project 폴더 기준 그대로다(접두 없음). `skills/kinds-yaml/SKILL.md`는 건드리지 않는다.
7. **test.** 위험 test만:
    - `place-folders-glue_test.ts`를 새 표(`domains.project` 외래키)로 다시 쓴다: DE는 자기 project의 폴더와 자기 domain의 lophn 자리(artifacts, kinds 파일, `DOMAIN.md`, 앱 source, skill 폴더)뿐이다. 같은 project의 domain 둘은 같은 폴더를 받되 서로의 lophn 자리를 갖지 않고, 폴더 0개 project의 domain은 자기 자리뿐이다. 다른 project의 폴더는 들어오지 않는다.
    - `instructions/read_test.ts`: 같은 project의 domain 둘이 `domain` 층에서 각자의 `DOMAIN.md`만 읽고 `project` 층은 같은 `LOPHN.md`를 읽는다. 자기 project가 아닌 project의 `LOPHN.md`를 domain agent가 요청하면 `forbidden`이다. lophn의 `domain` 층은 비어 있다.
    - `hooks_test.ts`: `writeGate`가 `LOPHN.md`에는 요청을 내고 `DOMAIN.md`에는 `null`이다.
    - 옛 모양(domain에 폴더가 있다는 전제, `<data>/…/LOPHN.md` 대체 자리)을 시험하던 test는 지운다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "DE의 file 범위는 자기 project의 폴더와 자기 lophn 자리뿐이다", "같은 project의 domain 둘은 각자의 DOMAIN.md만 받는다", "DOMAIN.md는 Gate 없이 쓰고 LOPHN.md는 Gate를 거친다".
- 남지 않음:
  - `grep -rn "projectDataFolder\|data 자리의 LOPHN" packages/core`가 0줄이다(폴더 없는 domain의 `LOPHN.md` 대체 자리가 없다).
  - `grep -rnE "INSTRUCTION_LAYERS\s*=\s*\[\"global\", \"project\", \"agent\"\]|project: \"\", agent: \"\"" packages/core`가 0줄이다(3층 literal이 없다).
  - `grep -rn "project_manager\|Project Manager" packages/core/agent-roles` 0줄.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: `domainDataFolder`류 대체 자리 함수가 있으면 목록
- 정한 것: 폴더 0개 project의 `project` 층 처리, 문구
- 넘길 줄: `main/agent-runtime/product-driver.ts` 등 남의 file을 고친 곳
- 계약 바꾸기 요청: `domain.get` 모양 변경이 필요하면 적는다
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 사람이 `DOMAIN.md`를 고치는 화면은 없다(editor는 project 폴더의 파일만 연다). 그 밖에 안 되는 동작.

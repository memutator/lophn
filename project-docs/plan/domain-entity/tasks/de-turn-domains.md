# de-turn-domains

turn 하나가 prompt에 싣는 domain 몫을 정한다. 지침 층에 `DOMAIN.md`를 더하고(전역 → project의 `LOPHN.md` → domain의 `DOMAIN.md` → agent 본문), `ResolvedAgent.domains`를 turn의 tool 맥락(`ToolContext.domains`)에 싣고, skill 목록을 그 domain들의 것으로 거른다. 그 agent가 맡은 domain의 `DOMAIN.md`만 실린다.

- 단위: harness (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/`
  - `packages/core/lophn-agent/instructions/`
  - `packages/core/lophn-agent/prompt-assembly/`
  - `packages/core/lophn-agent/tools/tool-context.ts`
  - `packages/protocol/lophn-agent/instructions.ts`
  - `packages/protocol/lophn-agent/kind-text.ts`
  - `packages/core/agent-roles/place/instruction-rules.ts`
  - `packages/core/agent-roles/place/instruction-rules_test.ts`
  - `packages/core/main/daemon/wiring/instructions-registration.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`(흐름 그림, "지침 층은 덮지 않고 이어 붙인다", "사람이 쓴 지침은 조용히 빼지 않는다", "같은 재료는 같은 bytes다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `run-loop`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > 지침 층", "PM·App Engineer prompt"
  - 본보기(코드): `packages/core/lophn-agent/instructions/turn.ts`(`readTurnInstructions`), `instructions/files.ts`(`readInstruction`), `prompt-assembly/turn-prompt.ts`(`instructionsBlock`, `INSTRUCTION_LAYERS`), `prompt-assembly/basis.ts`, `run-loop/prepare.ts`(`instructions` 조립, `skills` 목록, `ToolContext` 조립)
- 계약:
  - 쓰는 것: `ResolvedAgent.domains`(구체 id 목록. `de-agents-domains`가 채운다. 이 task가 시작할 때는 `[]`로 올 수 있고 코드는 그대로 돈다), `SkillEntry.domain`, `de-domain-core`의 `domainList`·`domainGet` read와 `packages/protocol/domains/paths.ts`의 `domainDocFile`, `DOMAIN_DOC_FILE`
  - 내놓는 것
    - `PROMPT_INSTRUCTION_LAYERS`(`packages/protocol/lophn-agent/instructions.ts`)는 `global | project | domain | agent`이고, `GetInstructions`(`instructionsGet`) 입력에 `domain?: dom_…`가 더해진다(layer가 `domain`일 때 필수, 아니면 거절). 출력 모양은 그대로다.
    - `ToolContext.domains`는 turn을 시작할 때 `resolved.domains`로 채운다. tool은 이 목록 밖 domain을 읽지 않는다(`de-kinds-domain`이 `kind.*`에서 쓴다).
    - kind 글이 domain별로 묶인다: `kindTextSchema`(`packages/protocol/lophn-agent/kind-text.ts`)는 `{domains: [{domain: string, kinds: […기존 kind 항목…], warning: boolean}]}`(domain은 이름, 이름순)이고, `buildKindText({domains: readonly {name, kinds, warning}[]})`와 `renderKindText(text, level)`(`prompt-assembly/kind-text.ts`)이 그 모양을 쓴다. 글은 `Domain <name>` 머리 아래 domain마다 한 덩이다. level(full → names → count)은 전체 예산에 걸린다. `PlaceKinds = {hash, text}`의 hash는 호출하는 쪽(`de-place-info`)이 domain별 적용 hash를 이어 낸 하나의 값이다.

## 할 일

1. protocol: `PROMPT_INSTRUCTION_LAYERS`에 `"domain"`을 `project`와 `agent` 사이에 더하고 `instructionsGetInputSchema`에 `domain`을 더한다. `instructionRead`·`instructionPreview`가 층 이름을 나열하는 곳이 있으면 같이 맞춘다(shell이 층 이름을 쓰면 type 오류로 알린다. shell 쪽은 최소로 맞추고 "넘길 줄"에 적는다).
2. 읽기(reader Worker): `instructions/files.ts`의 `readInstruction`이 `layer === "domain"`이면 `domainDocFile(root, domain)`을 연다. session의 place 그릇이 그 domain의 owner일 때만 읽고(`InstructionReadDeps.domainOwnerOf(sql, domain)` — 조립 `wiring/instructions-registration.ts`가 `packages/core/domains/lookups.ts`의 `domainOwnerOf`로 꽂는다) 아니면 `forbidden`이다. place가 없는 lophn은 `forbidden`이다. 파일이 없으면 부재(null)다. 크기 상한·UTF-8 검사는 다른 층과 같은 `inspectInstruction`이다. 앱 place에서 `project` 층은 부재다(`de-place-restore`가 정했다).
3. turn 시작: `instructions/turn.ts`의 `readTurnInstructions`가 `session.domains`(구체 id, 그 domain의 `name` 사전순)마다 `domain` 층 파일을 읽어 한 층의 글로 잇는다. 각 domain 몫은 `## <domain name>` 제목 아래 본문이다. 한 domain이라도 읽지 못하거나 상한을 넘거나 UTF-8이 아니면 다른 층처럼 turn을 시작하지 않는다(`blocked`). 잇는 순서와 제목은 고정 문장이라 같은 재료는 같은 bytes다.
4. 예산: 이은 글이 `DOMAIN_TEXT_BUDGET`(글자 수 상수 하나. 처음 값 24000)을 넘으면 넘은 domain부터 본문을 빼고 `## <name>` 아래 한 줄(domain의 `purpose`, `domainGet`/`domainList`로 읽은 값)과 "full text: read DOMAIN.md" 안내 한 줄만 싣는다(PM·App Engineer가 domain이 많을 때). 몇 번째부터 줄이는지는 앞 domain부터 예산을 채우는 방식으로 정한다.
5. prompt: `prompt-assembly/turn-prompt.ts`의 층 제목 표(`INSTRUCTION_TITLE`, 69~73째 줄)에 `domain: "Domain instructions (DOMAIN.md)"`를 더하고 `prompt-assembly/basis.ts`의 `INSTRUCTION_LAYERS`(8째 줄. 순서는 global, project, domain, agent)와 seen 비교, `instructions_changed` notice에 domain 층을 포함한다(바뀐 domain 층의 새 글이 notice로 붙는다). cache 경계는 그대로다.
6. `run-loop/prepare.ts`: (a) `readTurnInstructions`에 `resolved.domains`를 넘기고 domain 이름·purpose를 agent 자격으로 읽는다(`readOf(agentCall, domainList, {…})`). 읽지 못하면 domain 층만 비우고 turn은 계속한다(prompt를 줄이는 쪽으로 실패한다). (b) `ToolContext`에 `domains: resolved.domains`를 넣는다. (c) skill 목록(`deps.skills?.(…)` 결과를 prompt에 싣는 두 곳, 484째·624째 줄 근처)에서 `entry.domain !== null`이면 `resolved.domains`에 들어 있을 때만 켠다. `resolved.skills.includes(entry.name)`는 그대로다.
7. `agent-roles/place/instruction-rules.ts`: 지침 읽기 권한 규칙에 domain 층을 더한다. 어느 role이든 자기 place 그릇의 domain만 읽는다(`mayReadOtherProject`처럼 lophn만 다른 곳을 읽는 예외는 만들지 않는다. lophn은 domain 층이 없다).
8. machine 자격 route: `run-loop/runtime-access.ts`의 `RUNTIME_MACHINE_ROUTES`에 `domainList`를 더한다(`de-agents-domains`의 skill 발견과 `de-tool-filter`의 tool 목록이 agent runtime의 machine 자격으로 읽는다. 빠지면 단위 test와 core 기동은 통과하고 e2e에서 모든 turn이 `configuration_unavailable`로 끝난다). 주석의 "app-api tool의 정의 재료 …" 줄도 domain 읽기를 같이 적는다.
9. kind 글: 위 계약대로 `kind-text.ts`(protocol과 prompt-assembly), `prompt-assembly/model.ts`의 `PlaceKinds` 주석, `turn-prompt.ts`의 `kinds_changed` notice(바뀐 글 전체를 붙인다. domain별로 가르지 않는다)를 맞춘다. 쓰는 곳 `agent-roles/place/place-data.ts`는 이 task가 `buildKindText` 호출만 새 모양으로 최소 수정한다(블록을 `de-kinds-domain`이 걷어 낸 뒤라 호출이 없으면 건드릴 것이 없다. 있으면 "넘길 줄"에 적는다).
10. 시험: `instructions/read_test.ts`, `prompt-assembly/budget_test.ts`, `run-loop/runtime_test.ts` 등 이 영역 test가 새 층을 따라간다.

## 정한 것

- `DOMAIN.md`는 instruction 층(system 2번째 cache 경계 안)에 둔다. place 정보(system 4번째)에 두면 domain마다 책임을 가르는 지침과 kind 글이 섞이고, README가 정한 층 순서(`LOPHN.md` → `DOMAIN.md` → agent 본문)가 깨진다.
- 합쳐진 한 층의 글로 둔다(domain마다 층을 따로 두지 않는다). basis·notice가 층 이름 하나로 비교하는 기존 구조를 지킨다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test:
  - "domain 하나를 고른 Operator의 turn은 그 domain의 `DOMAIN.md`만 읽는다. 다른 domain의 파일은 읽기 요청도 나가지 않는다" — `packages/core/lophn-agent/instructions/read_test.ts`(또는 `turn_test.ts` 새 file)에서 읽기 요청을 기록하는 fake `InstructionFiles`로 본다.
  - "session의 그릇이 아닌 domain의 `DOMAIN.md`를 `GetInstructions`로 읽으면 `forbidden`이다" — 같은 file
  - "다른 domain의 skill(`SkillEntry.domain`)은 목록에서 꺼진다" — `run-loop/`의 skill 목록 test
- 남지 않음: `grep -rn "PROMPT_INSTRUCTION_LAYERS" packages`의 사용처가 모두 `domain` 층을 처리한다(0줄 검사가 아니다. 보고에 사용처 목록을 적는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것
- 넘길 줄: 층 이름 때문에 최소로 고친 shell file:줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: `DOMAIN.md`를 사람이 고치는 editor 입구는 없다(`de-shell-domain-list`가 더한다)

# ev-versions

eval의 버전 층을 만든다. component, core, checks, 시나리오, criterion, judge, 재료에 `이름@n`을 매기는 hash 규칙, registry 읽기·쓰기와 n 정하기, run이 본 component 목록(`seenComponents`), 출처 commit과 working tree diff를 잡는 일이다. 전부 지금 checkout(eval을 돌리는 그 checkout)을 대상으로 한다.

- 단위: ev-versions (wave 2)
- 선행: ev-contract
- 소유(이 task만 고친다):
  - `tests/eval/versions/`
  - `tests/eval/registry/`
- 읽을 것:
  - 설계 정본: `project-docs/products/roadmap/eval.md`의 "버전", "run"(run 기록의 꼴과 "근거는 이미 남는다"), "재료 / 자리와 조립"
  - 계획: `project-docs/plan/eval-base/README.md`의 "자리", "정한 것"
  - architecture: `project-docs/architecture/agent-definition.md`(role prompt, tool, skill, prompt 조립), `project-docs/architecture/testing.md`
  - 같은 계획의 `ev-collect.md`("기대하는 모양": 이 task가 받는 `CollectedModelCall`, `CollectedToolCall`)
  - 코드: `packages/core/agent-roles/roles/prompts.ts`, `roles/guides.ts`, `packages/core/agent-roles/tool-lists.ts`(`TOOL_ORDER`), `packages/core/lophn-agent/models/binding.ts`(`anthropicPacker`), `packages/core/lophn-agent/extensions/skills.ts`(`parseSkillFrontmatter`), `packages/core/lophn-agent/prompt-assembly/skill-list.ts`
- 계약:
  - 쓰는 것: `tests/eval/types.ts`(ev-contract)의 `VersionKind`, `VersionRef`, `RegistryEntry`, `Criterion`, `SourceInfo`, `CollectedModelCall`, `CollectedToolCall`. `packages/base/mod.ts`의 `sha256Hex`, `canonicalize`, `Result`, `ok`, `err`.
  - 내놓는 것: 아래 "할 일"의 함수. 다른 task는 이 이름과 꼴로 부른다. `tests/eval/versions/mod.ts`가 전부 다시 내보낸다. 호출하는 쪽(ev-runner, ev-scorecard)이 쓰는 이름: `seenComponents`, `currentVersions`, `resolveVersion`, `registerAuthored`, `coreVersion`, `checksVersion`, `scenarioHash`, `criterionContent`, `judgeContent`, `captureSource`, `readEntries`, `latestEntry`, `contentFiles`.

## 알아 둘 코드 사실

- model call마다 보낸 요청 body는 blob이다(`model_call_input`, 정규 JSON 글, redaction 거친 값). **이 body를 읽는 product route는 없다**(`blob.read`가 `general_read: false`로 막는다). ev-collect가 eval이 만든 data root의 file을 직접 읽어 `CollectedModelCall.request`(parse한 JSON, 못 읽으면 null)에 담는다. 이 task는 그 값을 받는다. 제품에 route를 더하지 않는다.
- Anthropic Messages body의 꼴(`anthropicPacker`): `{ model, max_tokens, system: [{type:"text", text, cache_control?}], messages, tools: [{name, description, input_schema}] }`. system 블록 순서는 role, instructions(`# Instructions`로 시작, 없으면 빠짐), skills(`# Skills`로 시작, 없으면 빠짐), place다. role 블록 글은 `rolePrompt(role)`(`PRODUCT_INSTRUCTIONS` + 그 role의 `prompt.md`)와 같다. tool 이름은 wire 이름(`.`이 `_`)이다.
- skills 블록 글: 첫 줄 `# Skills`, 둘째 줄 안내 문장, 그 뒤 `- <name>: <description>` 한 줄씩(description은 공백을 한 칸으로 줄인 값). `skillListText`(`prompt-assembly/skill-list.ts`).
- 연 skill과 guide는 tool call로 안다: `CollectedToolCall.call.tool`이 `skill.read`(`input`이 `{name, path?}`)나 `guide.read`(`input`이 `{topic?}`)이고 `call.outcome.kind`가 `success`인 것.
- 요약 call(compaction)의 body는 role 블록이 없다. `CollectedModelCall.call.purpose`가 `judgment`인 것만 본다.
- tool 이름에서 그것을 정의한 source file로 가는 표가 코드에는 없다. 그래서 tool을 정의한 file 목록(아래 `TOOL_FILES`, 16개)을 상수로 두고 file 글에서 `defineTool({ name: "<이름>"`을 정규식 `/defineTool\(\{\s*name:\s*"([^"]+)"/g`로 찾아 표를 만든다. 지금 코드에서 이 방법이 `TOOL_ORDER`의 51개 이름을 정확히 하나씩 찾는다(확인함). 표에 없는 이름이 있으면 에러다(`currentVersions`가 `TOOL_ORDER` 전체로 확인한다).
- 이 계획에서 진짜 model을 받는 쪽은 role agent뿐이고 provider는 Anthropic이다(ev-provider). 그래서 body는 Anthropic Messages 꼴만 다룬다.

## 할 일

각 항목의 근거는 roadmap "버전"·"run"이다. `export type Deps = { root?: string; registryDir?: string }`를 `registry.ts`에 둔다. 파일은 `tests/eval/versions/` 아래에 나눠 둔다(권장: `hash.ts`, `registry.ts`, `files.ts`, `components.ts`, `source.ts`, `mod.ts`). 경로를 받는 함수는 `deps?: { root?: string; registryDir?: string }`를 마지막 인자로 받고, 기본은 repo root와 `tests/eval/registry`다(test가 임시 폴더를 준다).

1. **hash 함수** (`hash.ts`)

```ts
export function hashText(text: string): Promise<string>;                       // sha256Hex(text)
export function hashValue(value: unknown): Promise<string>;                    // sha256Hex(canonicalize(value))
export function hashBundle(files: Record<string, string>): Promise<string>;    // hashValue(files). 경로 → 글
export function prettyJson(value: unknown): string;                            // JSON.parse(canonicalize(value))를 2칸 들여쓰기로. registry content용
```

2. **registry** (`registry.ts`). registry는 `tests/eval/registry/<kind>/<name>.json`이다. 내용은 `RegistryEntry[]`를 n 오름차순으로 `JSON.stringify(entries, null, 2) + "\n"`한 것이다. 이 폴더는 root `deno.json`의 `fmt.exclude`에 오른다(lead가 올린다). 쓴 byte가 곧 정본이다. 글 component(instruction, skill, skill-description, guide, template, cli)와 criterion, judge는 `content`도 담는다(`TEXT_KINDS`). tool, assembly, runtime, core, checks, model, scenario, material은 hash만 담는다(코드는 git에 있다).

```ts
export const TEXT_KINDS: readonly VersionKind[] = [
  "instruction", "skill", "skill-description", "guide", "template", "criterion", "judge", "cli",
];
export type Measured = { kind: VersionKind; name: string; hash: string; content?: string };

export function readEntries(dir: string, kind: VersionKind, name: string): Promise<RegistryEntry[]>;   // 없으면 []
// 처음 보는 내용이면 n = (가장 큰 n) + 1로 더하고 file에 쓴다. 이미 있는 hash면 그 n을 돌려준다. checkout에서 재서 registry가 n을 붙이는 종류(component, core, checks)용이다.
export function resolveVersion(dir: string, measured: Measured): Promise<{ ref: VersionRef; created: boolean }>;
// 작성자가 n을 정한 종류(scenario, criterion, judge, material)용이다. `kind:name@n`이 없으면 더한다(n은 1이거나 가장 큰 n + 1이어야 한다. 아니면 invalid_input).
// 있고 hash가 같으면 created: false. hash가 다르면 conflict("내용이 바뀌었다. n을 올려라").
export function registerAuthored(dir: string, ref: VersionRef, hash: string, content?: string): Promise<Result<{ created: boolean }>>;
export function latestEntry(dir: string, kind: VersionKind, name: string): Promise<RegistryEntry | null>;
// scorecard diff용. skill과 template은 content가 `{경로: 글}`의 JSON이라 풀어서 주고, 나머지는 { "": content }다. content가 없으면 {}.
export function contentFiles(entry: RegistryEntry): Record<string, string>;
```

   - name은 `/^[A-Za-z0-9._-]+$/`만 허용한다(file 이름으로 쓰므로). 아니면 `invalid_input`.
   - 같은 file을 동시에 쓰는 일은 막지 않는다(이 계획의 runner는 순서대로 쓴다).
3. **file 분류와 file set** (`files.ts`). checkout의 file이 어느 component나 core에 드는지를 아래 표로 정한다. 위에서부터 처음 맞는 줄이 이긴다. 경로는 repo root 기준이고 `/`로 쓴다.

   | 순서 | 경로 | 소속 |
   |---|---|---|
   | 1 | `node_modules/`가 든 경로, `packages/shell/**`, `packages/design/**`, `*_test.ts`, `*_test.tsx`, `packages/` 밖(root의 `deno.json`, `deno.lock`만 예외) | 없음(어디에도 안 든다) |
   | 2 | `packages/core/agent-roles/roles/{lophn,project-manager,app-engineer,operator}/prompt.md`, `packages/core/agent-roles/roles/prompts.ts` | instruction |
   | 3 | `packages/core/agent-roles/roles/guides.ts`, `packages/core/agent-roles/roles/lophn/guides/*.md` | guide |
   | 4 | `packages/core/agent-roles/skills/<name>/**`(단 `root.ts`는 아래 runtime), `packages/coding-agent/guides/skills/<name>/**` | skill (이름은 `<name>`) |
   | 5 | `packages/core/apps/packages/template/app/**` | template |
   | 6 | `packages/core/lophn-agent/prompt-assembly/**` | assembly |
   | 7 | `TOOL_FILES`(아래) | tool |
   | 8 | `packages/core/lophn-agent/**`(나머지), `packages/core/agent-roles/**`(나머지), `packages/core/main/agent-runtime/**`, `packages/core/main/agent-tools.ts`, `packages/core/apps/agent-tools/**`(나머지), `packages/core/problems/agent-tools.ts`(`TOOL_FILES`에 든 것은 7) | runtime |
   | 9 | `packages/{base,protocol,core,sdk,coding-agent}/**`(나머지), root `deno.json`, root `deno.lock` | core |

   - `TOOL_FILES`는 상수 16개다. 코드에서 `defineTool({ name:`으로 tool을 정의하는 file 전부다.
     - `packages/core/apps/agent-tools/{app,package,release,ticket,visual}.ts`
     - `packages/core/problems/agent-tools.ts`
     - `packages/core/lophn-agent/tools/bundles/{skill,file,call,web,ask,shell}.ts`
     - `packages/core/agent-roles/tools/{operator,context,instructions,guide}.ts`
   - tool 정의 file이 새로 생기면 목록에 없어 runtime에 든다(과하게 낡게 표시되는 쪽이라 안전하다). 목록과 코드가 어긋나는 것은 `currentVersions`가 `TOOL_ORDER`의 이름을 표에서 못 찾을 때 에러로 드러난다.
   - `.md`나 `.tmpl`처럼 test가 아닌 file도 위 표대로 센다(예: `packages/sdk/*/guide.md`는 9줄이라 core). `template/app/` 안의 `tests/*_test.ts.tmpl`은 `.tmpl`이라 1줄에 안 걸리고 5줄에 든다. template 밖의 `template/*.ts`(scaffold 코드)는 core다.
   - 구현은 정규식이나 `startsWith` 비교로 한다. glob 라이브러리를 더하지 않는다.

```ts
export const TOOL_FILES: readonly string[];
export type FileGroup =
  | { group: "none" }
  | { group: "core" | "assembly" | "runtime" | "instruction" | "guide" | "template" | "tool" }
  | { group: "skill"; name: string };
export function classifyPath(rel: string): FileGroup;
// root 아래 packages/와 root의 deno.json, deno.lock을 걷는다(Deno.readDir). node_modules, .git, dist, .dev-data 폴더는 들어가지 않는다. 경로 정렬 순서.
export function listFiles(root: string): Promise<string[]>;
// group의 file 목록을 [경로, sha256(bytes)] 쌍으로 hash한다. 목록이 비어도(폴더가 없어도) throw하지 않는다.
export function hashGroup(root: string, group: "core" | "assembly" | "runtime"): Promise<string>;
// TOOL_FILES의 글을 읽어 정본 tool 이름 → { file, hash(= hashText(file 글)) }. 한 file이 정의한 tool은 같은 hash를 받는다(함께 바뀐다). 없는 file은 건너뛴다(임시 root의 test용).
export function toolFileTable(root: string): Promise<Map<string, { file: string; hash: string }>>;
export function coreVersion(deps?: Deps): Promise<VersionRef>;     // kind "core", name "core"
export function checksVersion(deps?: Deps): Promise<VersionRef>;   // kind "checks", name "checks". `tests/eval/checks/**`의 file(`_test.ts` 제외)을 [경로, sha256(bytes)] 쌍으로 hash하고 resolveVersion으로 n을 붙인다
```

4. **component 측정** (`components.ts`). component마다 이름, hash, content를 이렇게 낸다. 모두 `Measured`를 돌려주고, n을 붙이는 일은 5번이 한다.

   | kind | name | hash 대상 / content |
   |---|---|---|
   | instruction | role id(`lophn`, `project_manager`, `app_engineer`, `operator`) | `rolePrompt(role)`(`packages/core/agent-roles/roles/prompts.ts`)의 글. 제품 공통 문장이 앞에 붙어 있어 그 문장을 고치면 네 role이 모두 새 n이다. content = 그 글 |
   | skill-description | skill 이름 | 요청의 skills 블록에서 읽은 description(공백을 한 칸으로 줄인 값). content = 그 글 |
   | skill | skill 이름 | skill 폴더의 `{상대경로: 글}`. `SKILL.md`는 `parseSkillFrontmatter(...).body`(frontmatter 뒤 본문)만, 나머지 file은 글 그대로. `hashBundle`. content = 그 map의 `prettyJson` |
   | guide | topic | `guideText(topic)`(`roles/guides.ts`). content = 그 글 |
   | tool | 정본 tool 이름(`app.create`) | 그 tool을 정의한 source file의 글(`toolFileTable`). description, schema, handler가 한 file에 있어 모두 걸린다. content 없음 |
   | assembly | `assembly` | `hashGroup(root, "assembly")` |
   | runtime | `runtime` | `hashGroup(root, "runtime")` |
   | template | `app` | `template/app/**`의 `{app/ 기준 상대경로: 글}`. `hashBundle`. content = 그 map의 `prettyJson` |
   | model | 요청 body의 `model` 값 | `hashText(name)`. content 없음. 같은 model 이름이면 늘 같은 n이다 |
   | cli | CLI 이름(`claude`) | 인자로 받은 version 글. `measureCli(name, versionText)`. content = version 글. 이 계획에서는 부르는 곳이 없다(`eval-coding`이 쓴다) |

   - skill 이름 목록은 `packages/core/agent-roles/skills/`와 `packages/coding-agent/guides/skills/`의 하위 폴더 이름이다. 요청의 skills 블록에서 이 목록에 없는 이름(사용자 skill)은 건너뛴다. 앱 api tool(`app__...`), MCP tool(`mcp__...`, `ext_...`)도 건너뛴다. 이것들은 harness가 아니라 world의 것이다.
   - tool 이름은 요청 body에서 wire 이름으로 오므로 `TOOL_ORDER`(`packages/core/agent-roles/tool-lists.ts`)의 이름마다 `toWireToolName`(`packages/protocol/lophn-agent/tool-catalog.ts`)을 거친 표로 정본 이름을 찾는다. 표에 없는 이름은 에러(`invalid_input`)다.

```ts
export function measureCli(name: string, versionText: string): Promise<Measured>;
// 요청 body 없이 지금 checkout만으로 잴 수 있는 것 전부: instruction(네 role), skill과 skill-description(skill 폴더의 frontmatter), guide(모든 topic), tool(toolFileTable의 모든 tool), assembly, runtime, template, core, checks. 키는 `${kind}:${name}`이고 core와 checks의 name은 kind와 같다.
export function currentVersions(deps?: Deps): Promise<Map<string, VersionRef>>;
```

5. **seenComponents** (`components.ts`). run이 진짜 model이 본 component만 남기는 규칙이다.

```ts
export function seenComponents(
  sessions: { model_calls: CollectedModelCall[]; tool_calls: CollectedToolCall[] }[],
  deps?: Deps,
): Promise<Result<VersionRef[]>>;
export function openedOf(toolCalls: CollectedToolCall[]): { skills: string[]; guides: string[] };   // 성공한 skill.read/guide.read의 input.name/input.topic. 중복 없이
```

   - 모든 session의 `model_calls` 가운데 `call.purpose === "judgment"`인 것만 본다. 그런 call이 없으면 `[]`를 돌려준다. `request`가 null인 call이 있으면 `invalid_input`(읽지 못한 body를 건너뛰면 component가 조용히 빠진다). 꼴이 틀리면(`model`이 문자열이 아니거나 `system`·`tools`가 배열이 아님) `invalid_input`.
   - body마다 `system[0].text`가 네 role의 `rolePrompt(role)` 중 하나와 같아야 그 role의 instruction을 더한다. **하나도 같지 않으면 `invalid_input`**이다(core가 다른 checkout에서 떴거나 redaction이 글을 바꿨다는 뜻이므로 조용히 넘기지 않는다). 메시지에 앞 80자를 넣는다.
   - body들의 합집합으로: model, 위 instruction, tool(요청의 `tools`마다, 위 규칙), skill-description(skills 블록이 있으면), assembly, runtime. 그리고 모든 session의 `tool_calls`에서 `openedOf`로: skill(연 skill 이름 중 skill 폴더가 있는 것), guide(연 topic 중 `guideText`가 있는 것).
   - 연 skill 본문은 지금 checkout의 파일에서 잰다. 이유: 같은 checkout에서 띄운 core가 읽은 파일이고 run 중에 고치지 않는다는 가정이다.
   - 하나씩 순서대로 `resolveVersion`을 불러 n을 붙이고, `kind:name` 정렬로 중복 없이 돌려준다. core와 checks는 넣지 않는다(`RunRecord.core`, `RunRecord.grader.checks`가 따로 있다).
6. **authored 종류의 hash 도우미** (`registry.ts` 또는 `components.ts`). scenario, criterion, judge, material은 작성자가 n을 정하고 registry는 내용이 같은지만 본다(`registerAuthored`). 호출하는 쪽은 runner다.

```ts
// criterion 한 개(`tests/eval/criteria/<name>.json`의 값, n을 포함)에서 n을 뺀 {name, question, verdicts, pass}의 prettyJson. hash는 hashText(content). registerAuthored에 넘긴다.
export function criterionContent(criterion: Criterion): string;
// judge 정의(`tests/eval/judge/judge.json`의 값. n을 포함하고 ev-judge의 loadJudgeDefinition()이 돌려준다)에서 n을 뺀 나머지의 prettyJson. prompt 글이 풀려 있는 값을 받는다.
export function judgeContent(definition: { n: number } & Record<string, unknown>): string;
// 시나리오 file 하나의 hash: 그 file과, 같은 폴더의 `.scenario.ts`가 아닌 file(`common.ts` 같은 helper, `_test.ts` 제외)의 글을 경로 순으로 묶어 hashBundle한다.
export function scenarioHash(scenarioPath: string): Promise<string>;
```

   - criterion과 judge의 n은 각 json file에 작성자가 쓴 값이다. registry가 n을 매기지 않는다.
   - 재료의 hash는 `MaterialManifest.content_hash`다(ev-restore가 재고 쓴다). `registerAuthored(dir, {kind:"material", name, n}, content_hash)`로 등록한다. 이 task는 재료 hash를 계산하지 않는다.
7. **출처** (`source.ts`).

```ts
export type Git = (args: string[]) => Promise<string>;     // stdout. 실패하면 throw
export function denoGit(root: string): Git;                // Deno.Command("git", { args: ["-C", root, ...args] })
// commit = `rev-parse HEAD`. 변경은 packages, deno.json, deno.lock만 본다: `status --porcelain --untracked-files=all -- packages deno.json deno.lock`이 비어 있지 않으면 dirty.
// diff = `diff HEAD -- packages deno.json deno.lock`의 글. untracked = status에서 `?? ` 줄의 경로.
export function captureSource(deps?: Deps & { git?: Git }): Promise<SourceInfo>;   // 기본 git은 denoGit(root). dirty가 false면 diff와 untracked는 쓰지 않는다
```

   - 이유: `tests/eval/runs`, `registry`, `scorecards`, `materials`는 run이 스스로 쓰는 것이라 변경으로 세면 늘 dirty가 된다. 대상의 변경(제품 코드)만 본다.
8. `mod.ts`가 위 export를 모두 다시 내보낸다.
9. test (아래 "끝남"의 위험 test)를 `tests/eval/versions/versions_test.ts`에 쓴다. 임시 폴더만 쓰고 core를 띄우거나 subprocess, network를 쓰지 않는다. `captureSource`는 test하지 않는다.

## 정한 것

brief가 이미 정한 것이다. 다르게 하려면 이유를 보고에 적는다.

- 이름: instruction은 role id(`project_manager`처럼 밑줄), tool은 정본 이름(`app.create`), cli는 `claude`. 이유: 요청 body에서 바로 얻는 이름(wire 이름)은 `.`이 `_`로 바뀌어 roadmap의 예(`tool:app.create@2`)와 다르다. `TOOL_ORDER`가 정본 이름 표라 되돌릴 수 있다.
- tool component의 hash는 그 tool을 정의한 source file의 글이다. 요청 body의 description·schema를 따로 hash하지 않는다. 이유: handler까지 한 file에 있어 tool 실행이 바뀐 것도 잡히고, runtime에서 이 file들을 빼 tool 하나의 수정이 모든 run을 낡게 하지 않는다. 한 file이 여러 tool을 정의하면 함께 바뀐다. file이 import하는 helper(`agent-roles/tools/context/*.ts`, `lophn-agent/tools/define.ts`)의 변경은 runtime으로 잡힌다.
- n을 매기는 두 방식: component, core, checks는 checkout에서 재서 registry가 n을 붙인다(`resolveVersion`). scenario, criterion, judge, material은 작성자가 n을 쓰고 registry는 내용이 맞는지만 본다(`registerAuthored`). 이유: 이 넷은 다른 file이 `name@n`으로 가리킨다(시나리오의 `world`, judge check의 `criterion`). 자동으로 n을 붙이면 가리키는 쪽이 어긋난다.
- 시나리오 hash는 시나리오 file과 같은 폴더의 helper file을 합친 것이다. 이유: helper를 고치면 그 폴더 시나리오의 뜻이 바뀐다. 단점은 helper를 고치면 그 폴더의 모든 시나리오 n을 올려야 한다는 것이다. check helper(`tests/eval/checks`)의 변경은 `checks@n`이 따로 잡는다.
- `guide`를 kind로, `checks`를 kind로 더했다(`VersionKind`는 ev-contract가 정한다). 이유: roadmap "run"이 turn 중에 연 guide를 component로 센다. checks는 grader의 일부라 대상 component와 따로 매긴다.
- 요청 body는 Anthropic 꼴만 받는다. 이유: 이 계획의 대상 model은 `claude-sonnet-5-5`뿐이다(roadmap "정한 것").
- registry 위치는 `<kind>/<name>.json` 하나씩. 이유: 단순하고 diff가 한 component에 한정된다.
- `root`는 인자다. test는 임시 폴더를 쓰고 runner는 repo root를 준다. 단 instruction, guide는 import한 코드(= 지금 프로세스의 checkout)에서 온다.

## 끝남

- `deno task check`가 통과한다. 이 폴더의 `_test.ts`도 check에서 돈다. 그래서 위 9번처럼 순수해야 한다.
- 위험 test (`versions_test.ts`, 판단이 있는 곳만 세 개):
  - "같은 내용은 같은 n을 받고, 바뀐 내용은 새 n을 받고, 옛 내용으로 돌아가면 옛 n을 받으며, 작성자가 정한 n의 내용이 달라지면 거절한다": 임시 registry 폴더에서 `resolveVersion`과 `registerAuthored`.
  - "연 skill만 본문 버전을 갖고, 본문만 고치면 본문 n만 바뀌고 description n은 그대로다. role 블록이 어느 role과도 같지 않은 body는 거절한다": 임시 root에 `packages/core/agent-roles/skills/<이름>/SKILL.md`를 두고 손으로 만든 Anthropic body(system[0]은 `await rolePrompt("lophn")`의 글, `# Skills` 블록, tool 하나)를 `request`에 담은 `CollectedModelCall`(`call.purpose: "judgment"`만 채운 값을 형 변환해 쓴다)과 `CollectedToolCall`로 `seenComponents`. tool 하나가 그것을 정의한 file의 글이 바뀔 때만 새 n을 받는 것도 같은 test에서 본다(임시 root에 `TOOL_FILES` 가운데 file 둘을 두면 된다).
  - "component 파일은 core에 들지 않고, tool 정의 file은 runtime에 들지 않으며, shell·design·test는 어디에도 들지 않는다": `classifyPath`를 표로(각 줄마다 경로 하나씩).
- 남지 않음: 해당 없음(새 코드).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `deno.json`의 `fmt.exclude`에 `tests/eval/registry/`(lead가 한다)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것. 위 "정한 것"과 다르게 했으면 이유를 적는다.
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약(`tests/eval/types.ts`)을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 아래를 확인해 적는다. 지금 안 되는 동작과 고치려면 필요한 것.
  - tool hash가 정의 file 전체의 글이라, 그 file에 든 다른 tool의 수정에도 같이 바뀐다.
  - 시나리오 폴더의 helper를 고치면 그 폴더의 모든 시나리오 n을 올려야 한다.

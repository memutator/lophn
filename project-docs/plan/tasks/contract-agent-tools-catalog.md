# contract-agent-tools-catalog

agent tool의 목록과 입력 schema, wire 이름 규칙, 사람에게 묻는 tool(`ask`), 명령 목록, 입력 tag 상수, context 글의 꼴을 `protocol/lophn-agent`에 고정한다. type, schema, 상수만 두고 구현은 넣지 않는다. 옛 모양은 지우지 않고 새것을 옆에 더한다.

- 단위: contract-agent-tools (wave 2)
- 선행: contract-calls-places (role 이름 `project_manager`, call 봉투, agent 정의 입력 schema를 import한다. 그쪽이 먼저 main에 있어야 type check가 된다)
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/tool-catalog.ts` (새로)
  - `packages/protocol/lophn-agent/ask-tool.ts` (새로)
  - `packages/protocol/lophn-agent/input-tags.ts` (새로)
  - `packages/protocol/lophn-agent/context-text.ts` (새로)
  - `packages/protocol/lophn-agent/commands.ts`
  - `packages/protocol/lophn-agent/message-content.ts`
  - 같은 단위의 소유라도 고치지 않는 것: `tool-calls.ts`, `tool-values.ts`(옛 ledger tool call 기록. agent event로 대신해 wave 3 이후 cleanup이 지운다), `command-filter.ts`, `questions.ts`, `question-submission.ts`, `question-text.ts`, `../server/question-option.ts`(옛 질문 묶음 모델. 새 `ask`가 대신한다)
- 읽을 것:
  - spec: S4 3·4·6·7·11장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S3 3·8장(call 봉투) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-call.md`
  - inventory: `I1.1#7`, `I1.4#12`, `I2.4#34` (`../assignment.md`의 contract-agent-tools 줄. `I3.4#26`은 `contract-agent-tools-config`가 맡는다)
  - 결정: `../README.md` 3장 #3, #5, #41, #18·23·57 (tool 이름 철자, 이름 바꾸기)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md` "package 사이 약속"
- 계약:
  - 쓰는 것: contract-calls-places의 role 값(`project_manager` 포함)과 call 봉투 입력 schema, agent 정의 입력 schema(`protocol/lophn-agent/agent-values.ts` 쪽. 이름은 그 file에서 찾는다). 사람에게 묻는 질문 event(`QuestionAsked`, `QuestionResolved`)의 payload는 contract-events가 정한다(S1 6장). 이 task는 그 payload가 쓸 수 있게 질문 한 개의 값(`askQuestionSchema`)만 내놓는다.
  - 내놓는 것: 아래 "모양"의 이름 전부. wave 3의 agent-tools와 agent-definition이 기댄다.

## 모양

### tool-catalog.ts

tool의 정본 이름은 `<자원>.<동사>`다. `call`, `reply`, `cancel`, `ask`는 자원 없이 한 단어다.

```ts
export const TOOL_NAME_MAX = 64;
export const WIRE_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// 정본 `context.get` → model에 보내는 이름 `context_get`. provider API가 `.`을 받지 않기 때문이다.
// 거꾸로 찾기는 core registry 표가 한다. 이름을 parse하지 않는다.
export function toWireToolName(canonical: string): string; // "."을 "_"로 바꾼다
export const APP_API_TOOL_PREFIX = "app__"; // app__<앱>__<api>
export const MCP_TOOL_PREFIX = "mcp__";     // mcp__<server>__<tool>

export const COMMON_TOOLS: readonly [
  "file.read", "file.glob", "file.grep", "pdf.read", "image.read",
  "web.search", "web.fetch", "call", "reply", "cancel", "session.list",
  "ask", "skill.read", "tool.search",
];
// 쓰기 성격이지만 lophn을 뺀 세 role이 갖는다(S4 3장)
export const WORK_TOOLS: readonly ["file.write", "file.edit", "shell.run"];
// 읽기 tool은 모든 role이 갖는다(S4 4장 "role이 갖는 tool")
export const READ_TOOLS: readonly [
  "ticket.list", "ticket.get", "problem.list", "problem.get",
  "app.list", "app.get", "blueprint.check", "package.list", "package.get",
  "release.list", "release.get", "context.list", "context.get",
  "context.search", "context.test", "context.violations", "outline.get",
  "guide.read", "settings.get", "visual.show",
];
// lophn만. 나머지 role은 project 지침을 prompt로 받는다(S4 5장)
export const LOPHN_ONLY_READ_TOOLS: readonly ["instructions.read"];
export const ROLE_WRITE_TOOLS: {
  lophn: ["app.create"];
  app_engineer: ["ticket.create", "ticket.update", "ticket.verify", "ticket.cancel",
    "problem.set_state", "app.link_source", "package.publish",
    "operator.create", "operator.update"];
  operator: [];
  project_manager: ["context.draft", "context.submit", "glossary.set",
    "outline.set", "outline.delete", "operator.create", "operator.update"];
};
export function builtinToolNames(role: AgentRole): readonly BuiltinToolName[];
// role 고정 목록 = COMMON_TOOLS + READ_TOOLS + (lophn이면 LOPHN_ONLY_READ_TOOLS, 아니면 WORK_TOOLS) + ROLE_WRITE_TOOLS[role]
export type BuiltinToolName = /* 위 목록의 이름 union */;
export const TOOL_INPUTS: { [N in BuiltinToolName]: z.ZodType }; // 모델이 보는 입력 schema
```

- `AgentRole`은 contract-calls-places의 role 값이다(`lophn`, `app_engineer`, `operator`, `project_manager`).
- 효과(read, write, external)는 이 목록에 넣지 않는다. 효과는 core registry와 Gate에만 있다(S4 4장 "app-api tool", 10장).
- 앱 app-api tool과 외부 MCP tool의 이름은 동적이라 목록에 없다. 접두사와 길이 상수만 둔다.
- `image.read`는 vision이 없는 model에는 주지 않는다. 이 목록은 거르지 않고, 거르는 것은 core registry(agent-tools-registry)다.

입력 schema(`TOOL_INPUTS`). 모두 `z.strictObject`다. S4가 칸을 적은 것은 그대로, 안 적은 것은 아래 값으로 정한다.

| tool | 입력 |
|---|---|
| `file.read` | `path`, `offset?`(줄), `limit?`(줄) |
| `file.write` | `path`, `content` |
| `file.edit` | `path`, `old_string`, `new_string`, `replace_all?` |
| `file.glob` | `pattern`, `path?` |
| `file.grep` | `pattern`, `path?`, `glob?` |
| `pdf.read` | `path`, `pages`(예: `"1-5"`) |
| `image.read` | `path` |
| `shell.run` | `command`, `timeout_ms?` |
| `web.search` | `query` |
| `web.fetch` | `url` |
| `call` | S3 3장 봉투. S4 3장 표 그대로: `to`, `reply`, `body`, `refs`, coding agent일 때 실행 옵션. contract-calls-places의 call 입력 schema를 그대로 쓴다 |
| `reply` | `call`, `body`, `refs?` (contract-calls-places의 것) |
| `cancel` | `call`, `reason`(한 줄) |
| `session.list` | 없음 |
| `ask` | `ask-tool.ts`의 `askInputSchema` |
| `skill.read` | `name`, `path?`(딸린 파일) |
| `tool.search` | `names`(정본 이름 1~20개) |
| `ticket.list` | `app?`, `state?` |
| `ticket.get` | `ticket` |
| `ticket.create` | `app`, `goal`, `check`(app test / test command / 글 조건 가운데 하나), `evidence?`(문제, 파일, annotation 링크 목록) |
| `ticket.update` | `ticket`, `goal?`, `check?` |
| `ticket.verify` | `ticket`, `result`(`verified`, `failed`), `note?` |
| `ticket.cancel` | `ticket`, `reason`(한 줄) |
| `problem.list` | `app?`, `state?`, `since?`, `until?` |
| `problem.get` | `problem` |
| `problem.set_state` | `problem`, `state`(`resolved`, `ignored`) |
| `app.list` | 없음 |
| `app.get` | `app` |
| `app.create` | `name`, `purpose` |
| `app.link_source` | `app`, `path`(git 폴더) |
| `blueprint.check` | `app` |
| `package.list` | 없음 |
| `package.get` | `name`, `version?` |
| `package.publish` | `app`, `name`, `path`(앱 source 안 폴더) |
| `release.list` | `app` |
| `release.get` | `release` |
| `context.list` | 없음 |
| `context.get` | `context` |
| `context.search` | `context`, `search`, `input`(검색 입력 객체) |
| `context.draft` | `context?`(있으면 그 context의 새 판, 없으면 새 context), `name?`, `purpose?`(새 context일 때) |
| `context.test` | `context`, `draft` |
| `context.submit` | `context`, `draft` |
| `context.violations` | `context` |
| `glossary.set` | `context`, `term`, `meaning`, `remove?` |
| `outline.get` | `context`, `path` |
| `outline.set` | `context`, `path`, `outline`(항목 목록) |
| `outline.delete` | `context`, `path` |
| `guide.read` | `topic?` |
| `settings.get` | `key?` |
| `visual.show` | `app`, `view`(앱 blueprint 화면 key. card 크기를 선언한 화면만 된다) |
| `instructions.read` | `project` |
| `operator.create` | `place`(`{project}`나 `{app}`), `name`, contract-calls-places의 agent 정의 입력(지침, model, context, skill, MCP, profile). grant는 입력에 없다(S4 11장 18) |
| `operator.update` | `operator`(정의 이름), 같은 정의 칸을 모두 optional로 |

id 칸은 `protocol/base/ids.ts`의 접두사 schema를 쓴다(`app`, `prj`, `ctx`, `tkt`, `prb`, `rel`, `pkg`는 있다). `call`은 아직 접두사가 없을 수 있다. 그때는 contract-calls-places가 정한 것을 따른다.

### ask-tool.ts

```ts
export const ASK_QUESTION_MAX = 4;
export const askOptionSchema;   // { label, description } — description은 짧은 한 줄
export const askQuestionSchema; // { question, header(짧게, 24자 이하), options(2~4개), multiSelect }
export const askInputSchema;    // { questions: askQuestionSchema[1..4] }
export const askAnswerSchema;   // { question, status: "answered" | "unanswered", answer: string[] }
export const askResultSchema;   // outcome으로 가르는 union
```

- 자유 답("Other")은 입력 schema에 없다. 화면이 늘 붙인다. 기한은 없다. Skip도 없다.
- `askResultSchema`: `{ outcome: "submitted", answers }` / `{ outcome: "cancelled", answers }`(꺼졌다 켜지거나 turn이 끊김) / `{ outcome: "human_message", message, answers }`(기다리는 중 사람이 보낸 메시지가 답을 대신함). `answers`는 질문 순서대로다.
- tool 설명에 넣을 규칙 문구는 상수로 둔다: `ASK_TOOL_RULES` — 사람이 정할 결정이고 요청, 파일, 기본값으로 풀 수 없을 때만 묻는다. 권한 확인에 쓰지 않는다(권한은 Gate).

### input-tags.ts

```ts
export const INPUT_TAGS = {
  call: "lophn-call", reply: "lophn-reply", reaction: "lophn-reaction",
  notice: "lophn-notice", steer: "lophn-steer", attached: "lophn-attached",
  annotation: "lophn-annotation", untrusted: "lophn-untrusted",
} as const;
export const INPUT_TAG_ATTRIBUTES = {
  call: ["from", "call", "reply"],
  reply: ["call", "from", "status", "reason"],
  reaction: ["event", "seq"],
  notice: ["kind"],
  attached: ["kind", "name"],
  annotation: ["n", "kind", "app", "release", "view"],
  untrusted: ["source"],
  steer: [],
} as const;
export const NOTICE_KINDS = ["instructions_changed", "tools_changed", "contexts_changed", "agents_changed", "call_cancelled"] as const;
export const ATTACHED_KINDS = ["context", "file", "violation"] as const;
export const UNTRUSTED_SOURCES = ["web.search", "web.fetch"] as const;
```

- 이 파일은 이름과 속성 이름만 둔다. tag를 만들고 escape하는 코드는 core(agent-definition-input-tags) 몫이다.
- `reply`의 `status` 값은 contract-calls-places의 call 상태를 import해 쓴다.

### context-text.ts

context 글은 agent가 자기 context를 이해하는 글이다. program이 적용된 판에서 결정적으로 조립한다(S4 6장 "context 글"). 계약 원문은 넣지 않는다.

```ts
export const CONTEXT_TEXT_TAG = "lophn-context";
export const CONTEXT_TEXT_LEVELS = ["full", "names", "count"] as const; // 예산을 넘으면 full → names → count
export const contextTextSchema; // 아래 값. 순서와 꼴이 결정적이라 같은 판이면 같은 글이다
// {
//   name, version("r3"), purpose,
//   project: { name, purpose, folders: [{ path, description }], subfolders: [{ path, description }] },
//   types: [{ name, summary, fields: string[], relations: [{ label, target, count: "one" | "many" }] }],
//   searches: [{ name, inputs: [{ name, optional }], description }],
//   glossary: [{ term, meaning }],
// }
export const contextGetOutputSchema; // { version, text } — `context.get`은 같은 글을 돌려준다
```

- 다른 context의 type은 `target`에 `context/Type`으로 적는다.
- 글을 만드는 함수는 두지 않는다(core의 agent-definition-prompt가 한다).

### commands.ts

- `BUILTIN_COMMAND_IDS`에 `recap`을 더한다(S4 7장). `fork`는 남는다.
- role 명령 이름 표를 더한다: `ROLE_COMMAND_NAMES = { lophn: ["new-app", "repair-app"], project_manager: ["check-contracts"], app_engineer: [], operator: [] }`. `new-context`는 내장 skill `context-init`과 겹쳐 뺀다.
- `COMMAND_WHILE_RUNNING`, `COMMAND_SKILL_ORIGINS`, action 종류 `tool`은 지금 쓰는 곳이 있어 이 task에서 지우지 않는다. 도는 turn 중에 부른 command는 다음 turn에 들어가므로(S4 7장) 셋 다 wave 3의 agent-definition-roles가 쓰기를 그만두고 cleanup이 지운다.

### message-content.ts

- part에 둘을 더한다.
  - `{ kind: "attached", attached: "context" | "file" | "violation", name, line?, path?, rule? }` — 사람이 composer chip으로 붙인 것. 이름과 한 줄만 싣는다(S4 6장). 위반은 `path`와 `rule`, 파일은 `path`를 더한다.
  - `{ kind: "app_card", app, view }` — `visual.show`가 대화에 보이는 앱 카드. 표, 차트, 도표 블록은 MVP 밖이다.
- 사람 메시지(`userMessageContentInputSchema`)에 `attached` part를 허용한다. agent 답(`agentMessageContentInputSchema`)에 `app_card`를 허용한다.
- 옛 `visual` part는 wave 1(remove-app-extras)이 이미 정리했으면 없다. 남아 있으면 지우지 않는다.

## 할 일

1. contract-calls-places가 main에 있는지 확인하고 `agent-values.ts`, call 입력 schema, 접두사를 읽는다. 이름이 이 brief와 다르면 그쪽 이름을 따르고 보고에 적는다.
2. `tool-catalog.ts`를 만든다. role 목록, `builtinToolNames`, `toWireToolName`, `TOOL_INPUTS`를 위 모양대로 둔다.
3. `ask-tool.ts`를 만든다. `QuestionAsked` payload가 `askQuestionSchema`를 쓸 수 있게 export한다.
4. `input-tags.ts`와 `context-text.ts`를 만든다.
5. `commands.ts`에 `recap`과 `ROLE_COMMAND_NAMES`를 더한다.
6. `message-content.ts`에 `attached`, `app_card` part를 더한다.
7. 새 export를 `packages/protocol/lophn-agent/mod.ts`에 올릴 목록으로 보고에 적는다(lead가 등록한다). 새 route는 없다.
8. 옛 file(`tool-calls.ts`, `tool-values.ts`, `questions.ts` 등)은 지우지 않는다. `I1.1#7`과 `I1.4#12`의 옛 event·묶음 모델 삭제는 쓰는 쪽이 사라지는 wave 3(agent-tools-call, agent-tools-registry)과 cleanup이 한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "내장 tool의 wire 이름이 provider 규칙에 맞고 서로 겹치지 않는다" — `tool-catalog_test.ts`에 role 네 개를 표로 돌려 `toWireToolName`의 결과가 `WIRE_TOOL_NAME_PATTERN`에 맞고, 같은 이름이 둘이 되지 않는지 본다. 이름이 겹치면 tool 실행이 다른 tool로 가기 때문이다.
- 남지 않음: 지우는 일이 없다.

## 보고

- 바꾼 file
- 등록할 것: `protocol/lophn-agent/mod.ts`에 새 file 네 개의 export
- 안 쓰게 된 export: `tool-calls.ts`·`tool-values.ts` 전체(agent event와 session 기록이 대신함), `questions.ts`·`question-submission.ts`·`question-text.ts`·`server/question-option.ts`(`ask`가 대신함), `COMMAND_WHILE_RUNNING`, `COMMAND_SKILL_ORIGINS`
- 정한 것: tool 이름 철자(`file.glob`, `file.grep`, `shell.run`, `session.list`, `tool.search`, `ask`), `instructions.read`를 lophn만 주는 것, ask의 `header` 24자 상한과 `answer: string[]`, `NOTICE_KINDS` 다섯, `target` 표기, 입력 칸 가운데 S4가 적지 않은 것
- 계약 바꾸기 요청: 없음(wave 2)

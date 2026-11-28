# @lophn/flow

이 package는 앱이 import하는 SDK가 아니라 flow 전용이다. 앱이 import하면 lophn
진입 file(`entry.ts`) 없이 실행되어 던진다.

## 목적

workflow의 `flow.ts`가 사람, agent, sub-workflow, 앱 tool, 앱·session event와 닿는
통합 durable 실행 길이다. 모든 호출은 core를 거쳐 checkpoint·관측·redaction을 남긴다.

## 공개 API와 type

```ts
import {
  agent,
  escalate,
  human,
  input,
  inputs,
  instance,
  onEvent,
  report,
  step,
  tool,
  withFallback,
  workflow,
} from "@lophn/flow";
```

- `input: string` — 이 instance를 시작할 때 받은 입력 글이다.
- `inputs: Readonly<Record<string, unknown>>` — `workflow.yaml`에 선언한 `inputs`로 받은 구조화 입력이다(선언이 없거나 값이 없으면 `{}`). 시작 시 core가 검증·기본값 적용·redaction을 끝낸 읽기 전용(frozen) 객체다.
- `instance: string` — instance id다.
- `step<T>(key, fn)` — durable checkpoint 단위다. `key`(비어 있지 않은 고유 문자열)는 **필수**다. 이미 `completed`로 저장된 `key`는 재시작·재개 replay 때 `fn`을 다시 돌리지 않고 저장된 값을 바로 돌려준다. `step` 안에서 순차 호출하는 primitive는 `AsyncLocalStorage`로 격리된 순번(`${key}/${kind}#${n}`)을 자동 부여받는다. `Promise.all` 병렬 분기는 각 항목을 고유 `step(key, ...)`로 감싸거나 명시적 `key`를 준다.
- `agent({ agent, prompt, input?, schema?, key?, mode?, session?, open?, worktree?, step?, on?, signal? })` — `Promise<Outcome<SoftOutput>>`.
  - `mode`: `"turn"`(기본, turn 끝 + 열린 `agent_calls` 0개일 때 완료; 열린 call이 모두 닫혔는데 후속 turn이 없으면 `stalled`) 또는 `"report"`(세션이 `workflow.report`를 낼 때 완료).
  - `session`: `"new"`(기본), `"same"`, 또는 session id.
  - `open`: `"tab"`(보이는 탭으로 열어 사람이 진행을 지켜보거나 승인·개입할 수 있게 함; project의 harness agent는 GUI 터미널 탭, lophn/custom은 workflow desk의 Agent 탭) 또는 `"background"`(탭을 자동으로 열지 않고 뒤에서 실행). 생략하면 agent 정의의 `open` 설정과 기본 규칙(내장 coding agent는 `tab`, 그 밖은 `background`)을 따른다.
  - `worktree`: `"new"`(project에 새 git worktree를 만들어 그 session에 고정; 브랜치 이름은 instance 제목 slug 기반 `wt/<slug>-<4hex>`) 또는 `"inherit"`(앞 step session의 worktree를 그대로 물려받음). 생략하면 원본 폴더에서 연다. instance가 끝나거나 멈춰도 worktree는 자동으로 지우지 않는다.
  - `on`: 다른 컴퓨터의 이름 또는 id.
  - `signal`: `AbortSignal`. 취소되면 core가 turn을 멈추고 `cancelled`를 돌려준다.
- `human({ with, prompt, input?, step?, key?, session?, open?, signal? })` — `Promise<Outcome<SoftOutput>>`. `with`(agent 주소 또는 handle) 세션에 `human_turn`으로 입력을 넣고 사람이 논의해 `workflow.report`로 완료할 때까지 기다린다. `open`을 생략하면 기본은 `"tab"`이다. core가 켜져 있는 동안 process를 유지하며 stall 판정에서 제외된다.
- `workflow({ workflow, input?, inputs?, key?, signal? })` — `Promise<Outcome<SoftOutput>>`. 같은 project 안의 다른 workflow를 sub-workflow로 호출한다(다른 project는 `forbidden`, 순환·최대 깊이 5 초과는 `conflict`).
- `tool<T = unknown>({ app, tool, input?, key?, signal? })` — `Promise<Outcome<T>>`. 앱 command를 부르고 2단계 checkpoint로 기록한다. 그 앱의 skill이 `workflow.yaml`의 `agent`(없으면 lophn)나 그 project에 배포돼 있어야 하고(flow는 사람에게 물을 수 없다) public command만 부른다.
- `onEvent({ source, event, workspace? }, handler)` — `() => void`. 실행 중 앱 event(앱 slug/id)나 session event(`source: "lophn"`)를 비영속 구독한다. 반환된 disposer를 부르면 구독을 해제한다.
- `report({ step, text, refs?, data?, next? })` — `Promise<Outcome<void>>`. 진행과 명시적 산출물 경로(`refs`), 선택적 구조화 값(`data`)을 남긴다. `next: "end"`는 instance를 `ended`로 닫는다.
- `escalate({ step, reason })` — `Promise<Outcome<void>>`. 사람의 판단이 필요함을 기록해 instance를 `needs_you`로 올린다.
- `withFallback<T>(outcome, { fallbackAgent, context?, retry?, step?, key?, signal? })` — core 밖 SDK helper. `outcome.ok`면 그대로 돌려주고, 실패면 `fallbackAgent`를 불러 `retry | substitute | throw | escalate` 중 하나를 결정·실행한다.
- `SoftOutput = { summary: string; refs?: string[]; data?: unknown }`
- `Outcome<T> = { ok: true; result: T } | { ok: false; reason: OutcomeReason; message: string; session?: string }`
  - `OutcomeReason`: 경계 오류 코드 일곱(`invalid_input`, `not_found`, `forbidden`, `unauthorized`, `conflict`, `unavailable`, `internal`)과 실행 사유 넷(`cancelled`, `interrupted`, `stalled`, `model_error`).

## 쓰는 법과 durable replay 규칙

`flow.ts`는 top-level `await`로 흐름을 쓴다. `agent`, `human`, `workflow`, `tool`은
**반드시 `step(key, fn)` 안에서 부르거나 명시적 `key`를 줘야 한다.** 둘 다 없으면
즉시 오류를 던진다.

primitive 자체는 `Outcome<T>`를 돌려주며 실패를 던지지 않는다. 반면 처리되지 않은
예외가 나거나 0이 아닌 exit code로 끝나면 instance는 `running`(`blocked`)으로 남아
사람이 `[Retry]` 또는 `[Resume]`(필요하면 최신 코드로) 이어 갈 수 있다.

재시작·재개 replay:
- 시작 시점의 workflow 폴더 code snapshot을 고정해 실행한다.
- 이미 `completed` 또는 `failed`인 `step`·`agent`·`human`·`workflow`·`tool`은 저장된 결과를 그대로 돌려주고 바깥 효과를 다시 내지 않는다.
- 재시작 시 돌던 `agent`·`tool`은 절대 자동 재실행하지 않고 `{ ok: false, reason: "interrupted", message, session? }`로 돌려준다.
- `human()`이 사람의 입력을 기다리며 쉬고 있던 상태는 끊김으로 치지 않고 기존 세션에 다시 붙어 report를 기다린다.
- `onEvent()`는 비영속이므로 process가 꺼진 사이의 event는 저장·재전송하지 않는다. 재시작 뒤 현재 상태가 필요하면 `tool()`로 다시 조회한다.

같은 폴더의 다른 file을 상대 경로로 import할 수 있다(`.ts` 확장자를 쓴다).
`console.log`는 stderr log로 간다.

## process

flow는 Node process 하나로 돈다(Electron의 Node, V8 heap 512 MiB 한도). sandbox도
권한 한도도 없어 file·network·자식 program을 쓸 수 있고, 넘긴 환경 변수(`HOME`,
`PATH`, 있으면 `XDG_CACHE_HOME`)만 본다. lophn이 기록·checkpoint하는 바깥 효과는
SDK primitive를 거친 것뿐이다.

Node가 type만 지우고 code를 바로 실행한다. import할 수 있는 것은 `@lophn/flow`,
같은 폴더의 file(`.ts` 확장자를 쓴다), `node:` built-in module이다. `enum`이나
`namespace`처럼 변환이 필요한 문법은 실행 중에 깨지고, `lophn workflow check`가
잡아 준다.

## 하지 않는 것

- `console.log`와 `process.stdout.write`로 쓴 것은 stderr로 간다. 통로(stdout)에는 닿지 못한다.
- 결과 type을 검사하지 않는다.
- core는 도메인별 통과 판정이나 돌던 `agent`·`tool`의 자동 재실행을 하지 않는다.

## 예제

```ts
import {
  agent,
  human,
  input,
  inputs,
  report,
  step,
  tool,
  withFallback,
} from "@lophn/flow";

const target = typeof inputs.target === "string" ? inputs.target : "notes";

const draft = await step("draft", async () => {
  const first = await agent({
    agent: { agent: "lophn", workspace: { app: target } },
    prompt: "Write a short note summary.",
    input,
  });
  return withFallback(first, {
    fallbackAgent: { agent: "lophn" },
    context: { target },
    retry: () =>
      agent({
        agent: { agent: "lophn", workspace: { app: target } },
        prompt: "Retry writing a concise note summary.",
        input,
      }),
  });
});

if (!draft.ok) {
  await report({ step: "draft", text: draft.message, next: "end" });
} else {
  const approval = await step("review", () =>
    human({
      with: { agent: "lophn" },
      prompt: `Confirm adding this note to ${target}: ${draft.result.summary}`,
    }),
  );
  if (approval.ok) {
    await step("save", () =>
      tool({ app: target, tool: "notes.add", input: { body: approval.result.summary } }),
    );
    await report({
      step: "save",
      text: approval.result.summary,
      refs: approval.result.refs,
      next: "end",
    });
  }
}
```

## version 정책

판마다 바뀐 점과 code를 옮기는 법은 `migrate-sdk` skill의 메모 `<이름>-<판>.md`(예: `flow-2.0.0.md`)에 있다(이 SDK의 판을 올리면 그 메모를 같이 쓴다).

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다.

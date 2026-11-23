# @lophn/flow

이 package는 앱이 import하는 SDK가 아니라 flow 전용이다. 앱이 import하면 lophn
진입 file(`entry.ts`) 없이 실행되어 던진다.

## 목적

workflow의 `flow.ts`가 바깥과 닿는 길이다. flow code는 agent를 부르고, 앱 command를
부르고, 진행을 report로 남긴다. 모두 core를 거친다.

## 공개 API와 type

```ts
import { agent, input, inputs, instance, report, tool } from "@lophn/flow";
```

- `input: string` — 이 instance를 시작할 때 받은 입력 글이다.
- `inputs: Readonly<Record<string, unknown>>` — `workflow.yaml`에 선언한 `inputs`로 받은 구조화 입력이다(선언이 없거나 값이 없으면 `{}`). 시작 시 core가 검증·기본값 적용·redaction을 끝낸 읽기 전용(frozen) 객체다.
- `instance: string` — instance id다.
- `agent({ agent, prompt, input?, schema? })` — agent 한 명에게 일을 시키고 답을
  기다린다. `agent`는 `{ agent, workspace? }`다(`agent`는 agent handle, `workspace`는
  `{ project }`나 `{ app }`의 이름이나 id. 없으면 이 workflow의 project).
  `schema`를 주면 답이 그 JSON schema 모양이다.
- `tool({ app, tool, input? })` — 앱 command를 부르고 결과를 기다린다. `tool`은
  command 이름이다.
  `workflow.yaml`의 `agent`(없으면 lophn)의 지금 할당 안에서만 되고, flow는
  project에서 돌므로 public command만 부른다.
- `report({ step, text, next? })` — 진행을 남긴다. `next`는 다음 step 이름이나
  `"end"`다. 인자 검사는 core가 한다.
- `Outcome<T> = { ok: true, result: T } | { ok: false, reason, message }`

`agent<T>`와 `tool<T>`는 `result`의 type `T`를 부르는 쪽이 정한다. 검사하지 않는
단언이다. `schema`를 준 agent 호출의 답을 쓰기 쉽게 하려는 것이다.

## 쓰는 법

`flow.ts`는 top-level `await`로 흐름을 쓴다. 끝나면 process가 끝난다. `await` 안
한 일은 `flow.ts`가 끝난 뒤 응답만 기다린다. 오래 걸리는 agent는 기다리는 법을
몰라도 된다. `await`만 하면 된다.

어떤 함수도 던지지 않는다. 실패도 값이다. `reason`은 run의 실패 이유,
`"cancelled"`, 요청이 시작되지 못했을 때의 경계 오류 코드(`invalid_input`,
`forbidden` 등) 가운데 하나다. 다시 할지는 code가 정한다. 요청 JSON이 1 MiB를
넘거나 JSON이 아니면 `invalid_input` 값이 돌아온다.

같은 폴더의 다른 file을 상대 경로로 import할 수 있다(`.ts` 확장자를 쓴다).
`console.log`는 stderr log로 간다.

## process

flow는 Node process 하나로 돈다(Electron의 Node). sandbox도 권한 한도도 없어서
file을 읽고 쓸 수 있고, network를 쓸 수 있고, 다른 program을 띄울 수 있다. 넘긴
환경 변수(`HOME`, `PATH`, 있으면 `XDG_CACHE_HOME`)를 본다. lophn이 기록하는 바깥 효과는
`tool`과 `agent`로 낸 것뿐이니, 기록과 rewind가 서야 하는 일은 그 둘로 낸다.

memory 한도는 없다. process가 끝나면 끝 code와 stderr 끝 줄이 instance에 남는다.

Node가 type만 지우고 code를 바로 실행한다. import할 수 있는 것은 `@lophn/flow`,
같은 폴더의 file(`.ts` 확장자를 쓴다), `node:` built-in module이다. `enum`이나
`namespace`처럼 변환이 필요한 문법은 실행 중에 깨지고, `lophn workflow check`가 그런
것도 알려 준다.

## 하지 않는 것

- `console.log`와 `process.stdout.write`로 쓴 것은 stderr로 간다. 통로(stdout)에는
  닿지 못한다.
- 결과 type을 검사하지 않는다.
- 다시 하기와 시간 제한을 두지 않는다.

## 예제

```ts
import { agent, input, inputs, report, tool } from "@lophn/flow";

const target = typeof inputs.target === "string" ? inputs.target : "notes";
const draft = await agent<{ title: string }>({
  agent: { agent: "lophn", workspace: { app: target } },
  prompt: "Write a title for this note.",
  input,
  schema: { type: "object", required: ["title"] },
});
if (!draft.ok) {
  await report({ step: "draft", text: draft.message, next: "end" });
} else {
  await tool({ app: target, tool: "notes.add", input: draft.result });
  await report({ step: "draft", text: draft.result.title, next: "end" });
}
```

## version 정책

판마다 바뀐 점과 앱 code를 옮기는 법은 `migrate-sdk` skill의 메모 `<이름>-<판>.md`(예: `declaration-4.0.0.md`)에 있다(이 SDK의 판을 올리면 그 메모를 같이 쓴다).

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다.

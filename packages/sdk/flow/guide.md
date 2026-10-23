# @lophn/flow

이 package는 앱이 import하는 SDK가 아니라 flow 전용이다. 앱이 import하면 lophn
진입 file(`entry.ts`) 없이 실행되어 던진다.

## 목적

workflow의 `flow.ts`가 바깥과 닿는 길이다. flow code는 agent를 부르고, 앱 tool을
부르고, 진행을 report로 남긴다. 모두 core를 거친다.

## 공개 API와 type

```ts
import { agent, input, instance, report, tool } from "@lophn/flow";
```

- `input: string` — 이 instance를 시작할 때 받은 입력이다.
- `instance: string` — instance id다.
- `agent({ agent, prompt, input?, schema? })` — agent 한 명에게 일을 시키고 답을
  기다린다. `agent`는 `{ role, place?, name? }`다(`role`은 `lophn`,
  `project_manager`, `app_engineer`, `operator`, `coding_agent`). `schema`를
  주면 답이 그 JSON schema 모양이다.
- `tool({ app, tool, input? })` — 앱 tool을 부르고 결과를 기다린다. PM의 지금
  할당과 맡은 domain 안에서만 된다.
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

같은 폴더의 다른 file을 import할 수 있다. `console.log`는 stderr log로 간다.

## sandbox

읽기는 workflow 폴더와 SDK뿐이다. 쓰기, 네트워크, 환경 변수, 다른 program 실행이
없다. 바깥 효과는 모두 `tool(...)`과 `agent(...)`로 한다.

## 하지 않는 것

- `Deno.stdout`에 직접 쓰지 않는다. core와의 통로가 깨지고 process가 끝난다.
- 결과 type을 검사하지 않는다.
- 다시 하기와 시간 제한을 두지 않는다.

## 예제

```ts
import { agent, input, report, tool } from "@lophn/flow";

const draft = await agent<{ title: string }>({
  agent: { role: "app_engineer", place: { app: "notes" } },
  prompt: "Write a title for this note.",
  input,
  schema: { type: "object", required: ["title"] },
});
if (!draft.ok) {
  await report({ step: "draft", text: draft.message, next: "end" });
} else {
  await tool({ app: "notes", tool: "notes.add", input: draft.result });
  await report({ step: "draft", text: draft.result.title, next: "end" });
}
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다.

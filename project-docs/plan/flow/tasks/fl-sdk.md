# fl-sdk

새 SDK package `@lophn/flow`(`packages/sdk/flow`)를 만든다. flow code(`flow.ts`)가 바깥과 닿는 길이다: `input`, `instance`, `agent(...)`, `tool(...)`, `report(...)`. lophn이 쥔 진입 file(`entry.ts`)도 이 package 안에 둔다. 설치 사본 `<data>/sdk/flow/1.0.0/`에 같이 풀려 flow process의 읽기 범위(workflow 폴더와 `<data>/sdk`) 안에서 실행되기 때문이다.

- 단위: sdk (wave 2)
- 선행: fl-contract
- 소유(이 task만 고친다):
  - `packages/sdk/flow/deno.json` (새 file)
  - `packages/sdk/flow/mod.ts` (새 file)
  - `packages/sdk/flow/entry.ts` (새 file)
  - `packages/sdk/flow/wire.ts` (새 file)
  - `packages/sdk/flow/guide.md` (새 file)
- 읽을 것:
  - 계획: `project-docs/plan/flow/README.md`의 "process"(stdin·stdout JSON 줄, `console`을 stderr로 돌린 뒤 `flow.ts`를 import), "SDK"
  - 본보기: `packages/sdk/cap-tool/{deno.json,context.ts,guide.md}`(자기 완결 package, host port를 `globalThis` symbol로 두는 법(`APP_TOOL_PORT = Symbol.for(...)`, `currentPort`), protocol type의 손 사본과 "원본은 어디" 주석), `packages/core/apps/packages/install.ts`의 `installSdkCopies`(`packages/sdk/*`에서 `deno.json`이 있는 폴더를 모두 깐다. 등록할 목록은 없다)와 `vendor.ts`의 `keepSourceFile`(`*_test.ts`와 `testdata`만 사본에서 빠진다. 그 밖 file은 모두 들어간다)
  - 본보기(소비 쪽): `packages/core/apps/packages/template/import-map.ts`의 `devImportMap`과 앱 template의 `deno.json.tmpl`(`"@lophn/cap-tool": "lophn-sdk:@lophn/cap-tool@1.0.0/mod.ts"` 꼴. flow도 이 꼴로 풀린다), `packages/core/apps/packages/builtin.ts`(`packages.builtin`이 `<data>/sdk/<part>/<newest>/guide.md`를 읽어 app 쪽 agent에게 SDK 목록과 안내로 보인다)
  - 계약: `packages/protocol/workflows/flow-wire.ts`(`fl-contract`)
  - 이 SDK를 쓰는 쪽: `project-docs/plan/flow/tasks/fl-host.md`(process를 띄우는 argv, 환경 변수 없음, 줄 상한, 응답 순서)
- 계약:
  - 쓰는 것: `flow-wire.ts`의 약속(`flowStartMessageSchema`, `flowRequestSchema`, `flowResponseSchema`, `flowOutcomeSchema`). SDK는 protocol과 Zod를 import하지 않는다. type과 모양을 손으로 옮기고 주석에 원본을 적는다.
  - 내놓는 것: `@lophn/flow` 1.0.0의 export 다섯. `input: string`, `instance: string`, `agent({agent, prompt, input?, schema?}): Promise<Outcome>`, `tool({app, tool, input?}): Promise<Outcome>`, `report({step, text, next?}): Promise<Outcome>`. `Outcome = {ok: true, result} | {ok: false, reason, message}`(던지지 않는다). `entry.ts`는 `deno run <entry.ts> <flow.ts 경로>`로 돈다. `fl-host`와 `fl-check`가 `FLOW_SDK_NAME`·`FLOW_SDK_VERSION`·`FLOW_ENTRY_FILE`로 위치를 찾는다.

## 정한 것 (이 brief가 정했다. 까닭 없이 바꾸지 않는다)

- 통로 줄 상한: process → core 한 줄은 1 MiB(`LINE_MAX_BYTES`, `fl-host`의 `FLOW_LINE_MAX_BYTES`와 같은 값을 손 사본으로 둔다). 요청 JSON이 넘으면 **보내지 않고** `{ok: false, reason: "invalid_input", message: "request is over 1 MiB"}`를 값으로 돌려준다(보내면 host가 통로가 깨진 줄로 보고 process를 죽인다). `JSON.stringify`가 던지는 값(순환, BigInt)도 같은 값 오류다. core → process 쪽은 상한을 두지 않는다.
- 종료 code: flow.ts가 끝나면 0, flow.ts를 import하다 던지거나 처리 안 된 rejection·uncaught error가 나면 1(stack을 stderr에), 인자가 없거나 통로(start 줄)가 틀리면 2, stdin이 닫히면 1.
- stdin이 닫히면(EOF) process는 스스로 끝난다. core가 갑자기 죽어도 flow process가 고아로 남지 않게 하는 약속이다. `fl-host`가 이 약속에 기댄다. 끝나는 중에 응답을 기다리던 요청은 버린다.
- flow.ts가 끝난 뒤(top-level `await` 포함) 아직 응답을 못 받은 요청(await 안 한 `report` 등)이 있으면 그 응답이 다 오기를 기다린 뒤 끝낸다. 요청을 잃지 않으려는 것이고, 응답이 안 오면(core가 안 답함) stdin EOF나 `StopWorkflow`가 끝낸다.
- `deno check`(fl-check)는 `mod.ts`를 실행하지 않고 type만 본다. 그래서 진입 file 없이 실행되면 던지는 top-level 검사가 있어도 type check는 지나간다.
- `agent<T>`·`tool<T>`는 `result`의 type을 부르는 쪽이 정하는 generic(기본 `unknown`)이다. 검사하지 않는 단언이다(schema를 준 agent 호출의 답을 쓰기 쉽게). `guide.md`에 "검사하지 않는다"고 적는다.

## 할 일

1. `deno.json`: `{"name": "@lophn/flow", "version": "1.0.0", "exports": "./mod.ts"}`(다른 SDK의 `deno.json`과 같은 꼴). 루트 `deno.json`의 workspace가 `./packages/sdk/*`를 이미 덮는다. 의존은 없다(`deno.lock`이 바뀌면 그 이유를 보고에 쓴다).
2. `wire.ts`(손 사본과 통로):
   - 맨 위 주석: 원본은 `packages/protocol/workflows/flow-wire.ts`이고 SDK는 protocol을 import하지 않아 모양을 손으로 옮겼다는 것. 모양이 어긋나면 host가 요청을 값 오류로 돌려보낸다는 것(`cap-tool/context.ts`의 같은 문장을 본보기로).
   - type: `Outcome<T = unknown>`, `NamedAgent`(`role: "lophn" | "project_manager" | "app_engineer" | "operator" | "coding_agent"`, `place?: {project: string} | {app: string}`, `name?: string`), 요청 본문 type 셋(`id` 없이), 응답 줄 type.
   - port: `FLOW_PORT = Symbol.for("lophn.flow")`를 `globalThis`에 둔다. 모양은 `{instance: string, input: string, request(body): Promise<Outcome>}`. `currentPort()`가 읽는다(`cap-tool`의 `installPort`·`currentPort` 꼴).
   - `connect()`: stdin을 `Deno.stdin.readable`에서 읽어 `\n`으로 줄을 나눈다. **첫 줄**이 `{type: "start", instance, input}`여야 한다. 아니면 stderr에 이유를 쓰고 `Deno.exit(2)`. 받으면 port를 `globalThis`에 놓고 resolve한다. 그 뒤 줄은 `{type: "response", id, outcome}`로 읽어 `id`로 대기 중인 요청(`Map`)을 푼다. 모르는 줄이나 모르는 `id`는 stderr에 한 줄 쓰고 무시한다(core는 믿는 쪽이라 버그일 때만 닿는다). 줄이 순서대로 오므로 줄 나누기는 남은 조각을 이어 붙이는 문자열 하나로 충분하다.
   - 요청 보내기: `id`는 process 안에서 `"1"`, `"2"`… 로 센다. `{...body, id}`를 `JSON.stringify` + `"\n"`으로 stdout에 쓴다. 여러 요청이 동시에 있을 수 있어(`Promise.all`) 쓰기를 promise 줄로 직렬화하고, `Deno.stdout.write`가 일부만 쓰는 경우를 위해 다 쓸 때까지 반복한다. 상한(위 "정한 것")과 stringify 실패를 먼저 본다.
   - stdin EOF: 대기 중 요청을 모두 버리고 `Deno.exit(1)`(stderr에 `stdin closed`).
   - `settled()`: 대기 중 요청이 0이고 쓰기 줄이 비면 resolve. entry가 마지막에 쓴다.
   - 근거: README "process"(stdin·stdout JSON 줄).
3. `entry.ts`: `deno run <entry.ts> <flow.ts 경로>`로 돈다. 순서가 중요하다.
   1. `console`의 `log`·`info`·`debug`·`warn`·`trace`·`dir`·`table`을 원래 `console.error`를 부르는 함수로 바꾼다(`console.log`가 stdout 통로를 깨지 않게. 이 바꾸기는 어떤 `import`보다 앞이다. `flow.ts`는 동적 import로만 읽는다).
   2. `globalThis`에 `unhandledrejection`과 `error` 처리기를 걸어 stack을 stderr에 쓰고 `Deno.exit(1)`.
   3. `Deno.args[0]`(flow.ts 절대 경로)가 없으면 stderr에 쓰고 `Deno.exit(2)`. 경로는 `"file://" + path.split("/").map(encodeURIComponent).join("/")`로 URL로 바꿔 동적 import한다(`node:url`에 기대지 않는다).
   4. `await connect()` 뒤 `await import(flowUrl)`. 던지면 `error.stack ?? String(error)`를 stderr에 쓰고 `Deno.exit(1)`.
   5. `await settled()` 뒤 `Deno.exit(0)`. stdin 읽기 loop가 event loop를 붙잡고 있어 명시적 `exit`이 필요하다.
   - `entry.ts`는 `mod.ts`를 import하지 않는다(`wire.ts`만). flow.ts가 `@lophn/flow`를 import할 때 `mod.ts`가 처음 실행되고, 그때는 port가 이미 있다.
   - 근거: README "process"(`console`을 stderr로 돌린 뒤 `flow.ts`를 import, 틀린 줄이면 process를 끝낸다).
4. `mod.ts`: 다섯 export와 type export(`Outcome`, `NamedAgent`, 입력 type들).
   - 위쪽에서 `const port = currentPort()`를 읽고, 없으면 `"@lophn/flow can only run inside a lophn flow process (entry.ts)"`를 던진다.
   - `export const input = port.input`, `export const instance = port.instance`.
   - `agent(args)` → `port.request({type: "agent", ...args})`, `tool(args)` → `{type: "tool", ...args}`, `report(args)` → `{type: "report", ...args}`. `report`의 `next`는 step 이름이나 `"end"`. 인자를 가공하지 않는다(검사는 core가 한다).
   - 어떤 함수도 던지지 않는다. 던질 수 있는 일은 `connect`에서 이미 끝났다.
5. `guide.md`(`cap-tool/guide.md`와 같은 꼴: 목적, 공개 API와 type, 쓰는 법, 하지 않는 것). 이 package는 **앱이 import하는 SDK가 아니라** flow 전용이다(`packages.builtin` 목록에 다른 SDK와 함께 보이므로 맨 앞에 쓴다). 담을 것: `flow.ts`의 꼴(`import {…} from "@lophn/flow"`, top-level `await`로 흐름을 쓴다. 끝나면 process가 끝난다. `await` 안 한 일은 flow.ts가 끝난 뒤 응답만 기다린다), 다섯 export, `Outcome`(실패도 값이고 `reason`은 run의 실패 이유·`"cancelled"`·경계 오류 코드. 다시 할지는 code가 정한다), sandbox(읽기는 workflow 폴더와 SDK뿐. 쓰기·네트워크·환경 변수·다른 program 실행 없음. 바깥 효과는 모두 `tool(...)`과 `agent(...)`로), `console.log`는 stderr log로 간다는 것, 같은 폴더의 다른 file을 import할 수 있다는 것, 오래 걸리는 agent는 기다리는 법을 몰라도 된다는 것, `tool`은 PM의 지금 할당과 맡은 domain 안에서만 된다는 것, 짧은 예 하나.
6. 설치 사본에 `entry.ts`·`wire.ts`·`guide.md`가 모두 들어가는지 확인한다. `keepSourceFile`은 `*_test.ts`와 `testdata`만 거르고 `installSdkCopies`는 `deno.json`이 있는 `packages/sdk/*` 폴더를 모두 깔므로 들어갈 것이다. 안 들어가면 보고에 적는다(`vendor.ts`는 소유 밖). 개발 core를 띄워 `.dev-data/sdk/flow/1.0.0/`에 file이 있는지 보면 확인된다(`project-docs/plan/tools/lead/boot.sh`가 새 data root를 만든다).

## 등록할 것

없다. `installSdkCopies`가 `packages/sdk/*`를 읽으므로 설치 목록이 따로 없고, `module-catalog.yaml`의 `packages/sdk`(boundary `sdk`)가 이미 이 폴더를 덮는다. 알아 둘 것: `packages.builtin`이 설치된 모든 `@lophn/*`를 나열하므로 `@lophn/flow`도 앱 쪽 agent에게 보인다. 앱이 import하면 진입 file 없이 실행되어 던진다. 막지 않는다(`guide.md` 첫 줄이 알린다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (process를 띄우는 test는 사람에게 먼저 묻는다. stdin EOF 종료와 `console` 돌리기는 test로 두지 않는다)
- 손으로 한 번 확인(남기지 않는다): 임시 폴더에 `flow.ts`(`console.log("x")`, `await report({step: "a", text: "t"})`)를 두고 `echo '{"type":"start","instance":"wfi_x","input":"hi"}' | deno run --no-prompt --no-config --no-remote --no-npm --cached-only --no-lock --allow-read=<폴더>,<repo>/packages/sdk/flow --import-map=<임시 map> packages/sdk/flow/entry.ts <flow.ts 절대 경로>`처럼 돌려, stdout에는 report 요청 한 줄만 나오고 `x`는 stderr로 가며 stdin이 닫히면 code 1로 끝나는지 본다. 임시 폴더와 map은 scratchpad에 만들고 지운다.
- 남지 않음: `grep -rn "zod\|npm:" packages/sdk/flow`가 0줄이다(외부 의존 없음). `grep -rn "protocol" packages/sdk/flow`는 "원본은 …" 주석 외에 import가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 (위 "등록할 것"을 확인한다. `packages.builtin`에 보인다는 것을 알린다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 알려진 것: flow.ts가 `Deno.stdout`에 직접 쓰면 통로가 깨진다(막지 않는다. host가 틀린 줄이면 process를 끝낸다).

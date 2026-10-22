# wf-artifact-serve

봉한 scheme이 workflow artifact에 가상 file 셋을 내준다. instance 상태 `data/_instance.json`, kit build `_lophn/kit.js`·`_lophn/kit.css`. instance가 바뀌면 열린 view를 다시 load한다.

- 단위: artifact (wave 3)
- 선행: wf-artifact-source
- 소유(이 task만 고친다):
  - `packages/shell/main/artifact/serve.ts`
  - `packages/shell/main/artifact/roots.ts`
  - `packages/shell/main/desktop/wiring/artifact.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/artifact.md`의 "지키는 것"(봉한 scheme, root마다 host, 응답 CSP, 가상 `data/_entries.json`, appearance는 문서에 token을 넣는 길), `project-docs/architecture/event.md`(남지 않는 event와 놓친 화면은 다시 읽는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/main`
  - 코드:
    - `packages/shell/main/artifact/serve.ts`(`createArtifactServer`, `CSP`, `ENTRIES_PATH` 분기가 가상 file의 본보기)
    - `packages/shell/main/artifact/roots.ts`
    - `packages/shell/main/artifact/entries.ts`(가상 file 하나를 만드는 본보기)
    - `packages/shell/main/desktop/wiring/artifact.ts`
    - `packages/shell/main/desktop/wiring/app-views.ts`의 `ctx.relay.conditions.push({ types: ["AppViewChanged"] })`와 `ctx.relay.events.push(...)`(event 구독 본보기)
    - `packages/shell/main/desktop/wiring/context.ts`의 `coreInternal`, `relay`, `rendererDist`. `CallResult`는 `packages/shell/main/app-frame/app-connection.ts`
  - 계약 task: `wf-contract.md`의 `ReadWorkflowInstance`(`cursor`, `next_cursor`, `last_reports`, `lines`)와 `WorkflowInstanceChanged`, `wf-kit-build.md`(`entry.js`·`entry.css`), `wf-artifact-source.md`(`scope`, `registerRoot`, `reloadInstance`)
- 계약:
  - 쓰는 것: `wf-artifact-source`의 `scope`·`registerRoot(root, scope)`·`views.reloadInstance`, `wf-contract`의 `ReadWorkflowInstance`·`WorkflowInstanceChanged`, shell main의 `ctx.coreInternal`(read)과 `ctx.relay.conditions/events`(본보기는 `wiring/app-views.ts`의 `AppViewChanged`), `ctx.rendererDist()`
  - 내놓는 것:
    - `roots.register(root, scope?)`: host는 root realpath에 scope가 있으면 `\0<scope>`를 붙인 글의 sha256 앞 24자다. `roots.scopeOf(host)`.
    - `createArtifactServer`가 deps `scopeOf(host)`, `readInstance(instance): Promise<string | null>`, `kit(name: "kit.js" | "kit.css"): Promise<Uint8Array | null>`를 받는다.
    - 가상 path(디스크에 같은 이름이 있어도 가상이 이긴다):
      - `data/_instance.json`: host의 scope가 있을 때만. 본문은 `ReadWorkflowInstance`를 `cursor`를 따라 끝까지 읽은 `{ "instance", "last_reports", "lines" }` JSON이다(`as_of_seq`·`next_cursor`는 뺀다). scope가 없으면 디스크 file로 넘어간다. 읽기 실패면 503과 `{"error": "<code>"}`.
      - `_lophn/kit.js`, `_lophn/kit.css`: `<rendererDist>/artifact-kit/entry.js`, `entry.css`(만드는 것은 `wf-kit-build`). 없으면 404. `kit.js`는 `text/javascript`, `kit.css`는 `text/css`. CSP는 그대로(`script-src 'self'`).
    - `wiring/artifact.ts`: `{ types: ["WorkflowInstanceChanged"] }` 조건을 걸고 event를 받으면 `views.reloadInstance(event.subject)`.

## 정한 것

- **kit 두 path는 모든 artifact root에 내준다.** scope가 있는 workflow instance view만이 아니다. 근거: 같은 build를 workflow의 static·instance artifact, domain artifact, 사람의 `.html`이 같이 쓴다(roadmap "node 시각화"). 읽는 파일은 요청 path가 아니라 고정 이름 둘뿐이라 root 밖을 읽는 길이 되지 않는다.
- **가상 path 비교는 `_entries.json`과 같은 방식이다.** `new URL(request.url).pathname`에서 앞 `/`를 뗀 글이 정확히 같을 때만 가상이다. 비슷한 path(`_lophn/kit.js/..`, 인코딩한 것)는 가상이 아니고 `resolveInsideRoot`로 넘어간다(거기서 거절되거나 root 안 file이다).
- **`readInstance`가 `null`이면 503과 `{"error":"unavailable"}`다.** 계약의 `{"error":"<code>"}`는 `readInstance`의 반환이 `string | null`이라 code를 나를 수 없어서 늘 `unavailable`이다. 근거: artifact는 오류의 종류를 가르지 않고 "지금 못 읽음"만 알면 된다. 계약 바꾸기는 하지 않는다.
- **`scopeOf(host)`는 scope가 없거나 모르는 host면 `undefined`다.**
- **instance가 너무 크면 `null`이다.** 줄을 모으다 JSON이 `ARTIFACT_MAX_BYTES`(4 MiB, 일반 file 상한과 같다)를 넘으면 읽기를 멈추고 `null`이다. 근거: agent가 report를 끝없이 내면 view를 다시 load할 때마다 전부 읽게 된다(agent의 실수로 main이 커지지 않게 한다). 이 경우 instance artifact는 못 읽는다고 보이고, 고치는 것은 화면의 기본 view다.
- **`readInstance`와 `kit`은 `wiring/artifact.ts` 안 함수로 둔다.** 소유가 이 세 file이라서다. 테스트는 만들지 않는다.

## 할 일

1. `packages/shell/main/artifact/roots.ts`
   - `Map<host, { root, scope }>`로 바꾼다. `register(realRoot, scope?: string | null)`: 해시 입력은 scope가 있으면 `` `${realRoot}\0${scope}` ``, 없으면 `realRoot` 그대로다(scope 없는 host는 지금과 같아 localStorage가 이어진다). `rootOf`는 그대로, `scopeOf(host): string | undefined`를 더한다.
   - 이유: root가 같은 instance view 둘은 origin이 달라야 하고, `_instance.json`이 어느 instance인지는 page가 아니라 등록 때 main이 정한 scope로만 정해진다.
2. `packages/shell/main/artifact/serve.ts`
   - deps에 `scopeOf`, `readInstance`, `kit`을 받는다. 상수 `INSTANCE_PATH = "data/_instance.json"`과 kit path → `kit(name)` 인자 표(`_lophn/kit.js`, `_lophn/kit.css`)를 둔다.
   - `ENTRIES_PATH` 분기 다음, `resolveInsideRoot` 앞에서 `key = path.replace(/^\/+/, "")`로 가른다.
     - `key`가 kit path면 `deps.kit(name)`. `null`이면 `notFound()`. 아니면 200과 content-type(`text/javascript; charset=utf-8`, `text/css; charset=utf-8`), `head`면 body `null`. 헤더는 기존 `headers(type, CSP)`를 쓰고 CSP 문자열은 건드리지 않는다.
     - `key === INSTANCE_PATH`이고 `deps.scopeOf(url.hostname)`가 있으면 `deps.readInstance(scope)`. `null`이면 503, 본문 `{"error":"unavailable"}`, type `application/json; charset=utf-8`. 아니면 200 JSON. scope가 없으면 아무것도 하지 않고 다음 코드(디스크)로 간다.
   - 이유: 가상 file은 `architecture/artifact.md`의 `_entries.json`과 같은 방식이다. 디스크에 같은 이름이 있어도 가상이 이긴다.
3. `packages/shell/main/desktop/wiring/artifact.ts`
   - `readInstance(instance)`: `ctx.coreInternal("read", "workflow_instances", "read", { instance, cursor })`를 부른다(첫 호출은 `cursor` 칸을 뺀다). `ok`가 아니면 `null`. 값은 `unknown`이라 객체인지, `lines`가 배열인지 손으로 보고 아니면 `null`이다(zod를 새로 들이지 않는다). `lines`를 이어 붙이고 `instance`와 `last_reports`는 마지막 page 것을 쓴다. `next_cursor`가 글(string)이고 직전 cursor와 다르면 계속, 아니면 끝. 누적 크기가 `ARTIFACT_MAX_BYTES`를 넘으면 `null`. 끝에 `JSON.stringify({ instance, last_reports, lines })`.
   - `kit(name)`: `join(ctx.rendererDist(), "artifact-kit", name === "kit.js" ? "entry.js" : "entry.css")`를 `readFile`해서 `Uint8Array`로, 실패하면 `null`.
   - `createArtifactServer({ rootOf: roots.rootOf, scopeOf: roots.scopeOf, readInstance, kit, maxBytes: ARTIFACT_MAX_BYTES })`.
   - `views`를 만든 뒤 `ctx.relay.conditions.push({ types: ["WorkflowInstanceChanged"] })`와 `ctx.relay.events.push((event) => { if (event.type === "WorkflowInstanceChanged") views.reloadInstance(event.subject); })`. `stop()`은 `app-views.ts`와 같이 relay 항목을 지우지 않는다.
   - 이유: CLI로 낸 report는 session event가 없어 이 event가 view가 알 유일한 길이다(`wf-contract`). 이 event는 남지 않고 놓친 view는 다시 열 때 다시 읽는다.
4. 화면에서 실제로 열어 보는 확인은 `wf-kit-build`가 land한 뒤 lead가 한다. 이 task는 type check와 코드 대조까지다: 새 가상 분기 둘이 `_entries.json` 분기와 같은 모양(정확히 같은 글만, HEAD는 body 없음, 같은 CSP 헤더)인지 다시 읽는다.

## 끝남

- `deno task check`가 통과한다(shell main `tsc`와 `deno check`로 `wiring/artifact.ts` 포함).
- 위험 test: 없음. 가상 path는 요청 path로 디스크를 열지 않고(정확히 같은 글만 가상, 나머지는 기존 `resolveInsideRoot`), instance는 등록 때 정해진 scope로만 읽고, root 종류 쪽 경계 검사는 `wf-artifact-source`의 test가 본다. 기존 `paths_test.ts`가 그대로 통과해야 한다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(예상). 있으면 적는다.
- 안 쓰게 된 export: 없음(예상)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 4 MiB가 넘는 instance는 `_instance.json`이 503이다(정한 것). 그 밖에 안 되는 것이 있으면 적는다

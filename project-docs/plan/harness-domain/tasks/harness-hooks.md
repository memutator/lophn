# harness-hooks

범용 file tool 안의 lophn 규칙 둘(`LOPHN.md` 쓰기를 `settings_edit` Gate로 묻기, 쓰기 전 rewind pre-image 남기기)을 harness의 hook으로 바꾸고 role 층이 채운다. place 폴더 가두기는 이미 role 층이 채운 `ToolContext.scope`(허용 폴더 목록)로만 판정하므로 고칠 것이 없다는 것을 확인하고 harness 쪽에 role·place 말이 남지 않게 정리한다.

- 단위: harness-hooks (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/{ports.ts,tool-context.ts}`
  - `packages/core/lophn-agent/tools/bundles/file.ts`
  - `packages/core/lophn-agent/tools/file/write.ts`
  - `packages/core/lophn-agent/tool-judgment/{intents.ts,mod.ts}`
  - `packages/core/lophn-agent/run-loop/{unwired.ts,prepare.ts}`
  - `packages/core/agent-roles/hooks.ts`
  - `packages/core/agent-roles/hooks_test.ts`
  - `packages/core/main/agent-tools.ts`
  - `packages/core/main/agent-tools_test.ts`
  - `packages/core/main/agent-runtime/{main.ts,product-driver.ts}`
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`("file tool은 place 폴더 안에 가둔다. … `LOPHN.md` 쓰기만 설정 고치기로 묻는다"), `project-docs/architecture/layers.md`
  - roadmap: `project-docs/products/roadmap/harness-domain-split.md`("범용 tool에 새는 domain", "단계" 4번, 정할 것 4)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tools`, `agent-roles`
- 계약:
  - 쓰는 것: `agent-roles/`(앞 wave에서 생김), `session/rewind/{record.ts,runtime-port.ts}`의 `recordBeforeWrite`, `rewindOverCore`, `tool-judgment/intents.ts`의 `settingsEditIntent`.
  - 내놓는 것:
    - `tools/ports.ts`의 `FileHooks`: `{ writeGate(path: string, ctx: ToolContext): GateRequest | null; aroundWrite(ctx: ToolContext, target: { root: string; relative: string }, run: () => Promise<Result<void>>): Promise<Result<void>> }`.
    - `tools/bundles/file.ts`의 `createFileTools(hooks: FileHooks): readonly ToolDefinition[]`(옛 `FILE_TOOLS`를 대신한다). `file.write`·`file.edit`의 `gate`는 `hooks.writeGate`, 쓰기는 `hooks.aroundWrite`로 감싼다.
    - `main/agent-tools.ts`의 `agentTools({ file: FileHooks })`.
    - `agent-roles/hooks.ts`의 `FILE_HOOKS`: `writeGate`는 `LOPHN.md`(`isInstructionFile`)에만 `settingsEditIntent({ what: "instructions", … })`를 Gate 요청으로 낸다. `aroundWrite`는 `recordBeforeWrite(rewindOverCore(ctx.core), { session, turn, tool_call, root, path, moved_from: null, run })`이다(pre-image 기록이 실패해도 쓰기는 막지 않는 지금 동작 그대로).
    - `ToolContext`에서 `rewind` 칸이, `ToolPorts`와 `UNWIRED_TOOL_PORTS`에서 `rewind`가 없어진다.

## 정한 것

- `ToolContext`의 `agent`, `role`, `place`, `router`를 role 층 값 하나로 묶지 않는다(README 정한 것 1의 마지막 문장과 다르다). 범용 `call` tool(`tools/call/target.ts`)과 Gate의 intent(`agent`)와 `file/scope.ts`가 이 칸들을 읽고 이 계획에서 `call`은 harness에 남는다(README 정한 것 4, roadmap의 "하지 않는 것"). 묶으면 harness가 role 층 type을 알아야 한다. type은 protocol의 `Role`·`Place`·`AgentRef`라 harness가 가져도 role 이름 문자열은 아니다.
- place 가두기(`file/scope.ts`의 `resolveInPlace`)는 hook으로 바꾸지 않는다. 허용 폴더 목록(`ToolContext.scope`)은 role 층의 `placeData`(앞 wave)가 채운다. harness는 목록으로만 판정한다.

## 할 일

근거: roadmap "단계" 4번, README `harness-hooks` 단위.

1. snapshot을 뜬다(이전 task의 `.tmp-probe/dump.ts`와 같은 script). 끝에 같은 결과여야 한다. `file.write`·`file.edit`의 Gate 유무도 포함한다. 끝낼 때 script를 지운다.
2. `tools/ports.ts`에 `FileHooks`를 정의한다. `tools/file/write.ts`에서 `instructionGate`를 지우고, 쓰기를 `hooks.aroundWrite(ctx, target, run)`으로 감싼다. `write.ts`는 hook을 인자로 받는 함수로 바꾸고(`writeFile(input, ctx, hooks)`, `editFile(input, ctx, hooks)`) `session/rewind`·`tool-judgment` import가 없어진다.
3. `tools/bundles/file.ts`를 `createFileTools(hooks)`로 바꾼다. 읽는 tool 넷(`file.read`, `file.glob`, `file.grep`, `pdf.read`)과 `image.read`는 hook과 상관없다.
4. `tool-judgment/intents.ts`의 `isInstructionFile`을 `agent-roles/hooks.ts`로 옮기고(`LOPHN.md`는 lophn이 정한 지침 파일 이름이다) `tool-judgment/mod.ts`의 export를 맞춘다. `settingsEditIntent`는 Gate의 intent를 만드는 함수라 harness에 남는다(`agent-roles/tools/operator.ts`도 쓴다).
5. `agent-roles/hooks.ts`에 `FILE_HOOKS`를 만든다(위 계약). 위험 test 하나를 `hooks_test.ts`에 쓴다(아래).
6. `ToolContext.rewind`를 지우고 `run-loop/prepare.ts`의 `ToolPorts` pick 목록과 `run-loop/unwired.ts`에서 `rewind`를 뺀다. `main/agent-runtime/product-driver.ts`의 `rewind: rewindOverCore(turn.core)`를 지운다.
7. `main/agent-tools.ts`가 `agentTools({ file: FILE_HOOKS })`를 받는다. 부르는 곳 셋(`main/agent-runtime/main.ts`, `main/agent-runtime/product-driver.ts`, `main/daemon/wiring/lophn-agent-runtime.ts`)과 `main/agent-tools_test.ts`를 맞춘다.
8. rewind route의 credential operation(`StageRewindFile`, `RecordRewindWrite`)을 `agent-roles/credentials.ts`가 "tool 목록에 `file.write`/`file.edit`가 있으면" 더하는 지금 동작을 그대로 둔다(operation 값이 전후로 같아야 한다).
9. harness 쪽에 남은 `LOPHN.md`·rewind 말을 찾는다: `grep -rnE "LOPHN\.md|isInstructionFile|recordBeforeWrite" packages/core/lophn-agent --include=*.ts`. 주석과 `instructions/`(지침 파일을 읽는 일. 이 계획 범위 밖)를 빼고 tool 코드에 남은 것이 없어야 한다.

## 끝남

- `deno task check`가 통과한다.
- 동작 비교: 1번의 snapshot 전후가 같다. `roleOperations` 값이 전후로 같다. `tools/registry_test.ts`, `main/agent-tools_test.ts`, `tool-judgment/tool-gate_test.ts`가 통과한다.
- 위험 test: "`FILE_HOOKS.writeGate`는 `LOPHN.md`(어느 폴더든)에만 `settings_edit` Gate 요청을 내고 다른 파일에는 null이다. 이것이 빠지면 agent가 사람의 지침 파일을 Gate 없이 고친다." (`agent-roles/hooks_test.ts`. `settings_edit` 판정은 `tool-judgment/tool-gate_test.ts`가 이미 본다. 이 test는 hook이 연결된 경로만 본다.)
- 남지 않음:
  - `grep -rnE "ctx\.rewind|rewind:" packages/core/lophn-agent/tools packages/core/lophn-agent/run-loop/unwired.ts packages/core/lophn-agent/run-loop/prepare.ts`가 0줄이다.
  - `grep -rnE "instructionGate|isInstructionFile" packages/core/lophn-agent --include=*.ts`가 0줄이다.
  - `grep -rn "session/rewind\|tool-judgment" packages/core/lophn-agent/tools/file packages/core/lophn-agent/tools/bundles/file.ts`가 0줄이다.
  - `packages/core/.tmp-probe/`가 없다.

## 지켜야 할 것(계획 README)

- 동작을 바꾸지 않는다. agent가 보는 tool 목록과 입력이 role마다 나누기 전과 같아야 한다(`tools/registry_test.ts`가 role별 목록을 본다).
- tool 정의 file은 agent runtime child에서 실린다. domain의 store나 DB 코드를 import하지 않는다(`layers.md` "실행 때 import가 뜻하는 것").
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 위 두 가지 말고 worker가 정한 것
- 넘길 줄: 없음이 기본
- 계약 바꾸기 요청: 없음이 기본
- **무겁게 짠 것**: 없음이 기본. 있으면 `무엇 / 왜 / 줄인다면 / 어디`
- **알려진 미완 동작**: 없음이 기본. `tools/questions/`, `extensions/`, `tools/call/`의 domain 섞임은 범위 밖이다(README 정한 것 4)

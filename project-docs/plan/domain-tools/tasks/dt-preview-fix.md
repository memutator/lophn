# dt-preview-fix

wave 3 뒤 손 확인에서 coding agent가 preview를 띄워 MCP로 앱 tool을 부르는 길이 세 곳에서 막혔다. 셋을 고친다: MCP가 인자 없는 tool을 부르지 못함, CLI `app preview start`가 늘 `invalid_input`, 실제 bundle의 preview가 supervisor에서 늘 거절됨. 그리고 supervisor 거절 이유가 core 오류에서 사라지는 것을 고친다.

- 단위: domain-tools (wave 4)
- 선행: dt-mcp-harness
- 소유(이 task만 고친다):
  - `packages/core/apps/mcp/serve.ts`
  - `packages/core/apps/mcp/serve_test.ts`
  - `packages/coding-agent/cli/main.ts`
  - `packages/coding-agent/cli/main_test.ts`
  - `packages/core/apps/preview/flags.ts`
  - `packages/core/apps/preview/flags_test.ts`
  - `packages/core/apps/runtime/supervisor-link.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`(preview, coding agent MCP 절), `project-docs/architecture/coding-agent.md`(MCP 절)
  - 지금 코드: 아래 "할 일"의 file과 `packages/core/apps/permissions/flags.ts`의 `appFlags`·`databaseFiles`(preview flags를 만드는 쪽), `packages/protocol/apps/previews.ts`의 `previewsStartInputSchema`(`{ input: previewInput }`), `packages/protocol/coding-agent/cli-commands.ts`의 `app preview start`, `packages/protocol/apps/blueprint/schema.ts`의 `validateInput`
  - 손 확인 기록: `.dev-data/mcp-check/check.ts`와 `run7.log`(lead worktree `/home/pyosechang/projects/lophn/.claude/worktrees/plan-domain-tools` 안. git 밖이다)
- 계약:
  - 쓰는 것: `dt-mcp-endpoint`의 MCP 규칙, `previews.start` route 입력
  - 내놓는 것: 없음(동작 고침)

## 할 일

1. **MCP가 인자 없는 tool을 부르지 못한다.** `packages/core/apps/mcp/serve.ts`의 `call`이 늘 `input: args`(빈 `arguments`면 `{}`)를 보낸다. 선언의 `inputSchema`가 `null`인 tool은 `validateInput(null, value)`가 `undefined`만 받아 늘 `invalid_input: app-api accepts no input`이다(template의 `list_items`).
   - 선언의 `inputSchema`가 `null`이면 `input`을 싣지 않는다. 이때 `arguments`에 key가 있으면 앱에 보내지 않고 `isError`로 돌려준다(agent가 고쳐 부르게). `arguments`가 없거나 `{}`이면 그대로 부른다.
   - agent tool(`packages/core/lophn-agent/tools/app-tools.ts`)이 같은 규칙(`api.inputSchema === null`이면 input을 싣지 않음)을 쓴다. 그 file은 고치지 않는다.
2. **CLI `app preview start`가 늘 `invalid_input`이다.** route 입력의 칸 `input`(`{ input: { app, bundle_hash, release, fixture_hash } }`)과 CLI 공통 key `input`(`--input`)이 이름이 같아, `packages/coding-agent/cli/main.ts`가 검증한 입력에서 `COMMON_KEYS`를 빼면서 route의 `input` 칸까지 지운다. core는 `{}`를 받는다.
   - CLI가 스스로 더한 key(`--json`, `--idempotency-key` 같은 flag가 만든 칸)만 빼고 route 입력의 칸은 남긴다. 어떻게 가를지는 `main.ts`의 candidate 조립을 읽고 가장 단순한 길을 고른다.
   - 다른 명령의 동작은 바뀌지 않는다(`--input`/`--input-file`로 받은 JSON 본문이 route 입력이 되는 것).
3. **실제 bundle의 preview가 supervisor에서 늘 거절된다.** `packages/core/apps/preview/flags.ts`의 `previewFlagsViolation`이 `--allow-write`의 모든 path가 `launch.dataPath`와 같기를 요구한다. 그런데 flags를 만드는 `appFlags`는 `<data>/app.sqlite`, `-wal`, `-shm`과 socket path를 쓴다. 그래서 `invalid_input: preview can write only its disposable directory`다.
   - 규칙의 뜻(preview는 자기 일회용 폴더 안에만 쓴다)을 지키며 "같다"를 "그 폴더 안이다"로 고친다. 읽기 검사(운영 data를 읽지 못함)는 그대로다.
4. **supervisor 거절 이유가 사라진다.** `packages/core/apps/runtime/supervisor-link.ts`(187행 근처)가 supervisor의 거절을 "app supervisor rejected the request"로만 돌려줘 3의 원인이 보이지 않았다. supervisor가 준 code와 message를 그대로 싣는다(secret이나 token이 실리는 길이 아닌지 확인한다).
5. 위험 test(아래)를 쓰고, 손 확인 script(`.dev-data/mcp-check/check.ts`)를 다시 돌려 preview 시작(CLI `app preview start`), MCP `list_items`·`add_item`·`list_items`가 통과하는지 본다. script는 commit하지 않는다. script가 쓰던 scratch 사본(`.dev-data/mcp-check/repo`)의 우회는 쓰지 않고 이 task의 worktree 코드로 돌린다(script의 `MCP_CHECK_REPO`를 이 worktree로 준다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test:
  - `packages/core/apps/preview/flags_test.ts`(새 file): "preview flags는 일회용 폴더 안의 쓰기(DB file, socket)만 받고, 그 밖 쓰기와 운영 data 읽기와 net은 거절한다" — 표 하나로. `write-test`: sandbox 경계(AI가 만든 코드가 preview에서 운영 data를 건드리지 못한다).
  - `packages/core/apps/mcp/serve_test.ts`에 한 행: 인자 없는 tool을 `arguments` 없이·`{}`로 부르면 호출 길에 `input`이 실리지 않는다. 기존 test에 행으로 더하고 새 test를 만들지 않는다.
  - CLI 쪽은 `main_test.ts`가 이미 있으면 거기에 `app preview start` 입력이 route 입력 그대로 가는 행 하나를 더한다. 없으면 test를 만들지 않고 손 확인으로 대신한다.
- 손 확인: 위 5가 통과하고 보고에 그 결과를 적는다.

## 보고

- 바꾼 file
- 통과한 check
- 손 확인 결과(단계마다 통과·실패)
- 등록할 것: 없음 예상
- 정한 것
- 넘길 줄
- **무겁게 짠 것**
- **알려진 미완 동작**

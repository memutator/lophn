# ec-metrics

진짜 Claude Code 한 session의 token, tool 오류 비율, `lophn` 명령 기록(`message send` 수 포함)을 읽어 `CodingRecord`로 만든다. lophn은 coding agent의 usage를 남기지 않으므로 Claude Code가 자기 폴더에 쓰는 session JSONL을 읽기만 한다. 비용은 세지 않고 token만 센다(사람).

- 단위: ec-metrics (wave 2)
- 선행: ec-contract
- 소유(이 task만 고친다):
  - `tests/eval/coding/metrics/**`
- 읽을 것:
  - 계획: `project-docs/plan/eval-coding/README.md`("정한 것"의 coding agent token)
  - 설계: `project-docs/products/roadmap/eval.md`의 "공통 수치"(coding agent 열), "진짜로 도는 것"
  - eval-base(land함): `project-docs/architecture/eval.md`, `tests/eval/collect/`(`metrics.ts`: role agent 쪽 `Metrics`. 이 task는 그것과 합치지 않는다)
  - 이 task가 쓰는 type: `tests/eval/types.ts`의 `CodingTrace`, `CodingUsage`, `CodingCommand`, `CodingRecord`(ec-contract). 모양은 `ec-contract.md` 할 일 8.
  - `packages/base/mod.ts`의 `Result`, `ok`, `err`
- 계약:
  - 쓰는 것:
    - `CodingTrace`(ec-driver가 찍는다). 이 task는 `command_log`(file 경로)와 `cwd`만 읽는다.
    - wrapper 기록 형식(ec-driver가 쓴다): 한 줄 `<ISO 시각>\t<arg1>\t<arg2>\t<arg3>\n`, 없는 인자는 빈 칸. hook 호출도 같은 file에 적힌다(`...\thook\tclaude\tStop`).
  - 내놓는 것(`tests/eval/coding/metrics/mod.ts`가 다시 내보낸다):
    - `claudeProjectDir(home: string, cwd: string): string`: `<home>/.claude/projects/<cwd의 영숫자 아닌 글자를 모두 "-"로 바꾼 것>`.
    - `parseClaudeJsonl(texts: string[]): CodingUsage`: JSONL file 내용들을 받는 순수 함수.
    - `readClaudeUsage(home: string, cwd: string): Promise<Result<CodingUsage>>`: 폴더를 읽기만 한다.
    - `parseCommandLog(text: string): CodingCommand[]`: 순수 함수.
    - `countHook(text: string, event: string): number`: 순수 함수. wrapper 기록에서 `hook\tclaude\t<event>` 줄의 수(`PermissionRequest`).
    - `codingRecordOf(trace: CodingTrace, commands: CodingCommand[], usage: Result<CodingUsage>, permissionRequests: number): CodingRecord`: 순수 함수. trace에서 `command_log`와 `attach_socket`만 빼고 나머지(`human_input` 포함)를 그대로 복사한다.
    - `codingTotals(records: CodingRecord[]): CodingUsage | null`: trial 안 session들의 합(`models`는 합집합, 비율은 합에서 다시 계산, usage가 하나도 없으면 null).
    - `collectCoding(deps: { home: string }, traces: CodingTrace[]): Promise<CodingRecord[]>`: trace마다 `command_log`를 읽어(없으면 빈 목록) `parseCommandLog`, `countHook`, `readClaudeUsage`를 불러 `codingRecordOf`로 합친다. runner(ec-runner)가 부른다. 시각순 안정 정렬은 trace 순서를 유지한다.

## 확인한 것 (2026-10-18, claude 2.1.302, 이 컴퓨터)

- **lophn은 coding agent의 usage를 남기지 않는다.** hook(`packages/protocol/coding-agent/hook-signal.ts`의 `HOOK_EVENT_TABLE.claude`)은 `session_id`·`tool_name`·turn 끝만 core에 넘기고 token은 없다. `packages/core/agent-roles/hooks.ts`의 `FILE_HOOKS`는 role agent의 file tool 연결이라 coding agent와 상관없다. `packages/coding-agent/`에도 usage 코드가 없다. 그래서 JSONL을 읽는다.
- **session file 자리**: `~/.claude/projects/<cwd의 영숫자 아닌 글자를 "-"로>/<session id>.jsonl`. 이 컴퓨터의 `~/.claude/projects/` 20개 가운데 17개가 이 규칙과 맞았고(`/home/pyosechang/projects/lophn` → `-home-pyosechang-projects-lophn`, `.claude` → `--claude`), 나머지 셋은 session 도중 cwd가 worktree로 바뀐 것이었다. 밑줄·대문자가 든 경로는 이 컴퓨터에 예가 없어 확인하지 못했다. 파일은 첫 메시지를 보낼 때 만들어진다(메시지 없이 닫으면 폴더도 안 생긴다).
- **trial의 session 찾기**: trial마다 app source 폴더(`cwd`)가 새로 만들어지므로(`tests/support/app/source.ts`: `run.work/<slug>`) 그 폴더의 project 폴더 안 `*.jsonl`이 모두 그 trial의 것이다. session id를 따로 찾지 않는다. subagent는 `<session id>/subagents/agent-*.jsonl`에 따로 쓰고 줄에 `isSidechain: true`가 있다. token은 subagent 몫도 쓴 것이므로 합친다.
- **JSONL 꼴**(이 컴퓨터의 session 하나로 확인):
  - `type: "assistant"`인 줄의 `message.usage`는 `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`를 갖는다. `input_tokens`는 cache를 뺀 값이다(role agent와 같은 뜻이라 `input_total = input + cache_read + cache_write`).
  - **한 응답이 여러 줄로 쓰인다.** content 블록(thinking, tool_use…)마다 한 줄이고 `message.id`와 `usage`가 줄마다 같다(1854 응답이 3794줄이었고 같은 id의 줄끼리 usage가 달랐던 적은 0이었다). 그래서 `message.id`로 중복을 빼고 센다. 안 빼면 token이 두 배쯤 부푼다.
  - tool 결과는 `type: "user"`인 줄의 `message.content[]` 가운데 `type: "tool_result"` 블록이다. 오류는 `is_error: true`다(사람이 permission 물음을 거절한 것도 같다). 한 `tool_use_id`가 두 번 오면 한 번만 센다.
  - `message.model`로 요청한 model이 실제로 쓰였는지 볼 수 있다(`claude-sonnet-5-5`). `models`에 남긴다.
- **env 주의(ec-driver 몫이지만 이 task의 입력이 걸린다)**: `CLAUDE_CODE_CHILD_SESSION`이 환경에 있으면 Claude Code가 "Transcript saving is off"로 뜨고 JSONL을 쓰지 않는다(확인함). runner를 Claude Code 안에서 돌리면 걸린다. driver가 그 변수를 지운다(`ec-driver.md`). JSONL이 없으면 이 task는 `usage_error`를 남기고 `usage: null`로 두며 던지지 않는다.

## 할 일

1. `tests/eval/coding/metrics/jsonl.ts`: `claudeProjectDir`, `parseClaudeJsonl`, `readClaudeUsage`.
   - 파싱: 줄마다 `JSON.parse`, 깨진 줄은 건너뛴다(마지막 줄이 쓰는 도중일 수 있다). `assistant`는 `message.id`가 처음 본 것만 `usage`를 더하고 `message.model`을 모은다. `message.id`가 없으면 건너뛴다. `user`는 `message.content`가 배열일 때 `tool_result`를 센다(`tool_use_id` 중복 제거).
   - `readClaudeUsage`: `claudeProjectDir`가 없으면 `err({ code: "not_found", message: "Claude Code session 기록 폴더가 없다: <경로>" })`. 있으면 폴더 안 `*.jsonl`과 `<하위 폴더>/subagents/*.jsonl`을 읽는다(`Deno.readDir`, 읽기만). 읽을 file이 하나도 없으면 같은 `not_found`.
2. `tests/eval/coding/metrics/commands.ts`: `parseCommandLog`. 빈 줄·깨진 줄은 건너뛴다. `arg1`이 `hook`이면 건너뛴다. name = `arg1 arg2`(`arg2`가 비었거나 `-`로 시작하면 `arg1`만). 시각 오름차순으로 정렬해 돌려준다.
3. `tests/eval/coding/metrics/record.ts`: `codingRecordOf`(`message_send` = name이 `message send`인 수, `usage`가 `!ok`면 `usage: null`, `usage_error: error.message`), `codingTotals`, `collectCoding`. `collectCoding`은 `command_log`를 못 읽어도(file 없음) 던지지 않고 빈 목록과 0으로 간다. `permission_requests` = `countHook(text, "PermissionRequest")`다(사람이 없는 터미널에서 permission 물음이 뜬 기록. 이 물음이 뜨면 session은 core에서 `waiting`으로 남는다).
4. `tests/eval/coding/metrics/mod.ts`: 위 export를 다시 내보낸다.
5. `tests/eval/coding/metrics/usage_test.ts`: 위험 test 하나(아래).
6. `home`은 인자다(`Deno.env.get("HOME")`을 이 task가 직접 읽지 않는다. runner가 사람의 HOME을 넘긴다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "같은 `message.id`가 여러 줄에 있어도 token을 한 번만 센다. subagent file의 token은 합쳐진다. `is_error`인 tool_result 수와 비율이 맞는다." (작은 JSONL 문자열 둘로 `parseClaudeJsonl`을 부르는 순수 test. file도 process도 쓰지 않는다. 값이 부풀면 coding agent 수치가 조용히 틀려지는 곳이다.) `parseCommandLog`가 hook 줄을 빼고 `message send`를 세고 `countHook`이 `PermissionRequest` 줄을 세는 것도 같은 file의 두 번째 case로 둔다.
- 새 file만 만들었다. 제품 code는 안 고쳤다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음". 밑줄·대문자가 든 cwd의 폴더 이름 규칙은 확인하지 못했다고 적는다.

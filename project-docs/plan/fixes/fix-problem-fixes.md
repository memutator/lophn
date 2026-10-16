# fix-problem-fixes

releases-problems-repairs(`f0c5fac70`)가 "고친 기록" handler(`RecordProblemFix`, `ListProblemFixes`, `problemsUploadFixSummary`)를 지웠다. 그런데 coding CLI 계약(`CODING_CLI_COMMANDS`)에 `problem fix-records`·`problem record-fix`가 남아, coding token의 operation 목록이 registry 상한을 넘어 **coding token 발급이 모두 실패한다**. 계약과 쓰는 줄을 걷는다.

- 단위: coding-agent (wave 3 계약 고침)
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/cli-commands.ts`, `mcp-problem.ts`의 fix 기록 줄
  - `packages/protocol/problems/fixes.ts`와 `packages/protocol/problems/registry.ts`의 `recordProblemFix`·`listProblemFixes`·`problemsUploadFixSummary`·`problemFixRecorded`
  - `packages/coding-agent/cli/commands/{problem,types}.ts`, `packages/coding-agent/connection/problem-ops.ts`(쓰는 곳이 없어지면 file째)
  - `packages/coding-agent/guides/skills/`에서 `problem record-fix`·`fix-records`를 설명하는 줄(바꾸면 `guides/manifest.ts` hash를 다시 계산한다)
  - `packages/core/apps/tickets/report.ts`의 `ProblemFixRecorded` 읽기(`fix_records` 검증)
  - `packages/core/server/identity/coding-connection.ts`의 `REPAIR_CONTEXT_ROUTES`·`SESSION_ROUTES` unavailable 등록과 protocol `repair-context.ts`, `sessions.ts`의 `codingAgentSessionSummary`(쓰는 곳이 없으면)
- 읽을 것: `/home/pyosechang/projects/lophn/project-docs/plan/fixes/README.md`, releases-problems-repairs 보고(`git log -1 f0c5fac70`)
- 계약: 위 이름을 지운다.

## 할 일

1. 위 줄을 걷는다. `ticket report`의 `fix_records` 칸이 이 기록에 기대면 그 검사를 지운다(가장 단순하게).
2. 확인: `deno task check:full`, core 기동(같은 data root로 두 번). 그리고 core 안에서 `createCodingTokens({registry}).issue({session, app})`가 통과하는지 임시 probe로 본다(commit하지 않는다).

## 끝남

- `deno task check:full` 통과, `grep -rn "record-fix\|fix-records\|recordProblemFix\|listProblemFixes" packages`가 0줄, token 발급 확인.

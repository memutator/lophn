# pr-cli-problem

coding agent CLI의 `problem list|show|more|occurrence|body|diff`와 그것만 쓰는 source diff(route `coding.source_diff`와 release source reader)를 지운다. coding agent skill `lophn-repair`를 지우고, 고치는 ticket에도 `lophn-build-app`을 쓰게 한다.

- 단위: cli-problem (wave 2)
- 선행: pr-check-exclude.
- 소유(이 task만 고친다):
  - `packages/core/apps/tickets/coding/signal.ts`
  - `packages/protocol/coding-agent/cli-commands.ts`
  - `packages/protocol/coding-agent/source-diff.ts`
  - `packages/protocol/coding-agent/harness-adapter.ts`
  - `packages/coding-agent/cli/commands/problem.ts`
  - `packages/coding-agent/cli/commands/types.ts`
  - `packages/coding-agent/cli/registry.ts`
  - `packages/coding-agent/cli/main_test.ts`
  - `packages/coding-agent/guides/skills/lophn-repair`
  - `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`
  - `packages/coding-agent/harnesses/install_test.ts`
  - `packages/core/apps/tickets/coding/source-diff.ts`
  - `packages/core/apps/tickets/coding/relay.ts`
  - `packages/core/apps/tickets/coding/register.ts`
  - `packages/core/apps/tickets/coding/mod.ts`
  - `packages/core/apps/releases/bundle/read.ts`
  - `packages/core/main/daemon/wiring/coding-sessions.ts`
- 읽을 것:
  - 계획: `project-docs/plan/problem-remove/README.md`의 "정한 것"(problem tool, CLI 명령, coding agent skill을 지운다. App Engineer는 고치는 ticket에도 `lophn-build-app`을 쓴다)
  - architecture: `project-docs/architecture/coding-agent.md`의 "coding agent가 lophn에 닿는 길은 CLI와 MCP endpoint 둘", "전역 skill은 얇고 절차는 `lophn guide <name>`이 낸다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `coding-agent-cli`, `coding-agent-cli-interface`, `app-tickets`, `app-releases`, `project-docs/module-catalog.yaml`의 `packages/coding-agent`, `packages/protocol`, `packages/core/apps`, `packages/core/main`
  - 계약: `project-docs/plan/problem-remove/tasks/pr-log-sdk.md`의 "내놓는 것"(`reportProblem(name, message)`은 앱 log에 `error <name>: <message>` 한 줄을 쓴다)
  - 코드: `packages/coding-agent/harnesses/install.ts`와 `packages/coding-agent/guides/distribution.ts`(`CODING_SKILL_NAMES`대로 skill을 읽고 놓는다), `packages/coding-agent/cli/commands/guide.ts`, `packages/protocol/coding-agent/mod.ts`(`source-diff.ts` export 줄), `packages/core/apps/tickets/coding/signal.ts`(`app_of`. source diff만 쓴다)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것:
    - `CODING_SKILL_NAMES = ["lophn-build-app"]`(`harness-adapter.ts`). harness 설치와 `guide` 명령이 이 목록을 따른다.
    - 지운다: `CODING_CLI_COMMANDS`의 `problem *` 여섯, `codingSourceDiff`·`SOURCE_DIFF_ROUTES`(memory route `coding.source_diff`), `ReleaseSourceReader`, `createReleaseSourceReader`, CLI 읽기 단어 `more`·`occurrence`·`body`·`diff`
    - `cli-commands.ts`는 `problems/problem-views.ts`와 `problems/report-body.ts`를 더 import하지 않는다(그 file은 `pr-cleanup`이 지운다).
    - `lophn-build-app` 설명과 본문의 `reportProblem` 줄은 "앱 log에 error 한 줄을 쓴다"(`pr-log-sdk`)에 맞춘다.

## 할 일

1. `packages/protocol/coding-agent/cli-commands.ts`: `CODING_CLI_COMMANDS`에서 `problem list`, `problem show`, `problem more`, `problem occurrence`, `problem body`, `problem diff`를 지우고, `CODING_ROUTES`에서 `SOURCE_DIFF_ROUTES`를 뺀다. import에서 `problem-views.ts`의 넷(`problemGet`, `problemGetOccurrence`, `problemList`, `problemMore`), `report-body.ts`의 `reportBody`, `source-diff.ts`를 지운다.
2. `packages/protocol/coding-agent/source-diff.ts`를 지운다. `packages/protocol/coding-agent/mod.ts`에서는 `export * from "./source-diff.ts";` 한 줄만 뺀다(지운 file을 가리키던 등록 줄이다. 보고의 "등록할 것"에 적는다).
3. `packages/protocol/coding-agent/harness-adapter.ts`: `CODING_SKILL_NAMES = ["lophn-build-app"] as const`.
4. CLI: `packages/coding-agent/cli/commands/problem.ts`를 지우고 `packages/coding-agent/cli/registry.ts`에서 `PROBLEM_COMMANDS`와 그 import를 뺀다. `packages/coding-agent/cli/commands/types.ts`의 `READ_WORDS`에서 `more`, `occurrence`, `body`, `diff`를 뺀다(남는 명령 가운데 이 단어로 끝나는 것이 없다).
5. `packages/coding-agent/guides/skills/lophn-repair` 폴더(`SKILL.md`, `references/investigation.md`)를 지운다.
6. `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`:
   - frontmatter `description`과 첫 문단을 "맡겨진 구현이나 수리 ticket 하나로 앱을 만들거나 고치는 절차"로 고친다. "시작 조건"의 "ticket 없이 만들어 달라고만 했으면"에 고쳐 달라는 말도 넣는다.
   - 3번(현재 앱 읽기)에 한 줄을 더한다: 고치는 ticket이면 `app status`, `app logs`, `app invocations`로 증상의 근거를 읽는다. 정한 것: `lophn-repair`의 "문제 근거 읽기"를 남는 읽기 명령 셋으로 대신한다.
   - 6번의 `reportProblem` 줄: `reportProblem(name, message)`을 그 자리에 두면 앱 log에 error 한 줄이 남는다고 쓴다. "같은 이름은 한 problem으로 묶인다"를 지우고, "진입점이 이미 보고하는 잡히지 않은 예외"를 진입점이 앱 log에 쓴다는 말로 바꾼다. 원인이 다른 실패는 이름을 나눈다는 줄과 cap-problem `guide.md`를 읽으라는 줄은 남긴다.
   - ticket, claim, examples, release 줄은 건드리지 않는다(`ae-builds`의 몫이다).
7. `packages/coding-agent/harnesses/install_test.ts`: `memory`의 skill 목록을 `["lophn-build-app"]`로 줄인다.
8. `packages/coding-agent/cli/main_test.ts`: problem 명령을 부르는 행이 있으면 지운다(지금은 없다. 없으면 그대로 둔다).
9. core:
   - `packages/core/apps/tickets/coding/source-diff.ts`를 지운다.
   - `packages/core/apps/tickets/coding/relay.ts`: `source` handler, `CodingRelayDeps.sources`, `handlers`의 `source`, import(`codingSourceDiff`, `./source-diff.ts`)를 지운다.
   - `packages/core/apps/tickets/coding/register.ts`: `memoryRoutes`의 `codingSourceDiff`와 그 import를 지운다. wiring의 memory handler와 같이 빼야 한다. core 기동이 둘을 대조한다.
   - `packages/core/apps/tickets/coding/mod.ts`: `ReleaseSourceReader` export를 지운다.
   - `packages/core/apps/releases/bundle/read.ts`를 지운다(`createReleaseSourceReader` 하나뿐이고 source diff만 쓴다).
   - `packages/core/main/daemon/wiring/coding-sessions.ts`: `createReleaseSourceReader` import와 `sourceReader`, relay deps의 `sources`, `memory`의 `[key(codingSourceDiff), handlers.source]`, `codingSourceDiff` import를 지운다.
10. 지운 이름을 grep해 소유 file의 주석에 남은 것을 고친다. route는 문자열(`coding_agent_sources`, `coding.source_diff`)로도 grep한다.

추가(planner): source diff handler가 없어지면 `signal.ts`의 `app_of` signal 종류와 `SignalResult`의 `app` 칸은 쓰는 곳이 없다. 같이 지운다.

## 끝남

- `deno task check`가 통과한다.
- core가 뜬다: `cd <worktree>; project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 두 번 찍는다(memory route 등록과 handler를 같이 뺐는지 기동이 대조한다).
- 위험 test: 없음.
- 남지 않음:
  - `git grep -nE "codingSourceDiff|SOURCE_DIFF_ROUTES|SourceDiffOutput|ReleaseSourceReader|createReleaseSourceReader|coding_agent_sources|coding\.source_diff|PROBLEM_COMMANDS" -- packages tools`가 0줄이다.
  - `git grep -nE "problem (list|show|more|occurrence|body|diff)" -- packages/coding-agent packages/protocol/coding-agent`가 0줄이다.
  - `git grep -n "problems/problem-views.ts\|problems/report-body.ts" -- packages/protocol/coding-agent`가 0줄이다.
  - `git grep -n "lophn-repair" -- packages tools`가 `packages/core/apps/packages/template/app/AGENTS.md.tmpl`(`pr-log-sdk` 소유) 말고 0줄이다. 그 file에 남았으면 고치지 말고 보고한다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 적어도 `packages/protocol/coding-agent/mod.ts`의 `source-diff.ts` export 줄
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): 적어도 `packages/core/apps/tickets/coding/signal.ts`의 `app_of` signal 갈래(소유 밖. 부르던 곳은 source diff handler뿐이었다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적어도: 사람 home에 이미 놓인 얇은 `lophn-repair` skill은 설치가 지우지 않고, 그 skill이 가리키는 `lophn guide lophn-repair`는 입력 검사에서 거절된다

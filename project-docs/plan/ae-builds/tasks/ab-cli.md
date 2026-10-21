# ab-cli

coding agent CLI에서 ticket, test runner, 옛 두 단계 release 준비에만 쓰이던 명령과 coding agent skill `lophn-build-app`을 지운다. 설치(`lophn harness install`)는 lophn이 사람 home에 놓은 얇은 skill 사본 가운데 이제 없는 이름의 것을 지운다(이슈 `project-docs/issues/coding-agent.md` "지운 배포 skill의 얇은 사본이 사람 home에 남는다"의 추천). 앱 template의 `AGENTS.md`에서 ticket과 `app test` 줄을 지우고, 이제 그 file을 읽는 App Engineer에게도 맞게 고친다. 연결 장치(hook, 메시지, preview, 앱 읽기, 설치와 감지)는 그대로다(README "범위 밖").

정한 것: `harness install`의 출력 모양(`{skill, hook, files}`)은 그대로 둔다. 이유: Settings › Coding agents 화면이 그 칸을 읽는다. 연결의 크기는 보류라(roadmap "정할 것" 1) 화면을 지금 바꾸지 않는다. skill 갈래는 옛 사본 지우기만 알린다.

- 단위: cli (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/{cli-commands.ts,harness-adapter.ts}`
  - `packages/coding-agent/`
  - `packages/core/server/identity/{coding-token.ts,coding-token_test.ts}`
  - `packages/core/server/mcp.ts`(안내 글만)
  - `packages/core/apps/packages/template/app/AGENTS.md.tmpl`
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "App Engineer가 coding agent에게 맡기는 흐름을 막는다"(ticket에만 쓰이던 CLI 명령과 skill `lophn-build-app`을 지우고 얇은 사본 이슈를 같이 다룬다), "뼈대 검토에서 정한 것"(CLI는 `app test*`, `release prepare/status`, `guide`도 지운다)
  - 이슈: `project-docs/issues/coding-agent.md`의 "지운 배포 skill의 얇은 사본이 사람 home에 남는다"(닫는 것은 lead다)
  - architecture: `project-docs/architecture/coding-agent.md`의 "전역 설정은 사람의 다른 항목을 보존한다", "전역 skill은 얇고 절차는 `lophn guide <name>`이 낸다", "skill과 hook은 … 놓기 전에 사람에게 묻는다". 앞 둘은 이 task로 틀린다. 문서는 계획 끝에 lead가 고친다.
  - 코드(줄은 main `dd956b49f`)
    - `packages/protocol/coding-agent/cli-commands.ts`: 머리 주석(1~5), import(13·16~21·27~33), `CODING_CLI_COMMANDS`(111~240)
    - `packages/protocol/coding-agent/harness-adapter.ts`: `CODING_SKILL_NAMES`(33), `skill_dir`(24~25)
    - `packages/coding-agent/cli/registry.ts`, `cli/commands/{ticket,release,guide,app,harness,harness-run,types}.ts`, `connection/{ticket-ops,mod}.ts`, `guides/`(`distribution.ts`, `mod.ts`, `skills/lophn-build-app/SKILL.md`)
    - `packages/coding-agent/harnesses/install.ts`: `InstallPorts`(21~28), `thinSkill`(165~174. 사람 home에 놓던 얇은 사본의 꼴. 2026-10-17부터 같다), `installSkill`(176~201), `installGlobal`(283~330)
    - `packages/coding-agent/harnesses/install_test.ts`(memory port 대역), `cli/main_test.ts`
    - 권한: `packages/coding-agent/cli/launch.ts`의 `planSelection`(`harness install`은 그 harness의 hook 설정 폴더와 `<home>/<skill_dir>`의 읽기·쓰기만 연다. 지우기도 이 안에서만 된다)
    - 출력 꼴을 읽는 곳: `packages/shell/main/terminal/coding/requests.ts`의 `installResult`, `registerOnce`(`dry_run`이 `missing`이면 사람에게 `files`를 보여 주고 묻는다)
    - `packages/core/server/identity/coding-token.ts`(`CODING_TOKEN_OPERATIONS`), `coding-token_test.ts`(권한 경계 test. 남긴다), `packages/core/server/mcp.ts` 39~40줄(`INSTRUCTIONS`)
    - 앱 template: `packages/core/apps/packages/template/app/AGENTS.md.tmpl`. release 준비가 source를 읽는 규칙은 `packages/core/apps/releases/prepare/git-extract.ts`의 머리 주석과 `extractCommit`(HEAD의 tree만 읽고, commit하지 않은 변경이나 ignore하지 않은 새 file이 있으면 거절한다)
    - `tools/package-linux.ts` 110~113줄(skill 원본이 없으면 빈 폴더를 둔다. 고치지 않는다)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것:
    - `CODING_CLI_COMMANDS`에 `ticket list|show|claim|renew|report`, `app test`, `app test status`, `app test result`, `release prepare`, `release status`, `guide`가 없다. 남는 것은 `message send`, `hook`, `app show`, `app preview start|stop`, `app status`, `app blueprint`, `app invocations`, `app logs`, `package list|show`, `harness detect|refresh|install`이다.
    - `CODING_SKILL_NAMES`, `packages/coding-agent/guides/`(skill `lophn-build-app` 원본과 배포 코드)가 없다.
    - `harness install`은 skill을 놓지 않고, lophn이 쓴 얇은 사본(`lophn-build-app`, `lophn-repair`. 내용이 lophn이 쓰던 꼴인 것만)을 지운다. 사람이 고친 사본은 남는다.
    - coding token이 여는 operation에 `ticketUploadSummary`가 없다(남은 CLI 명령의 route에서만 나온다).
    - coding CLI는 ticket, test runner, 옛 release 준비의 route(`ticket/*`, `requestTest`·`getTestRequest`·`getVerification`, `release.prepare_bundle`·`release.preparation`)를 import하지 않는다. 그 route 자체는 남는다(ab-release-prepare, ab-ticket-delete, ab-runner-delete가 지운다).
  - 등록할 것(lead): `packages/protocol/coding-agent/mod.ts`의 `CODING_SKILL_NAMES` export.

## 할 일

1. `cli-commands.ts`(근거: README "뼈대 검토에서 정한 것")
   - `CODING_CLI_COMMANDS`에서 위 명령 열하나를 지운다. 안 쓰게 된 import(`releasePreparation`, `releasePrepareBundle`, `problems/tests.ts`의 셋, `ticket/claims.ts`·`ticket/routes.ts`의 것, `CODING_SKILL_NAMES`)를 지운다.
   - 머리 주석 4~5줄의 "`ticket list`·`ticket show`가 알려 주는 앱 id"를 "앱 id는 session을 맡긴 쪽이 첫 prompt로 알려 준다"로 고친다(ab-coding-detach가 첫 prompt에 앱 id를 싣는다).
2. `harness-adapter.ts`: `CODING_SKILL_NAMES`와 그 주석을 지운다. `skill_dir` 주석을 "lophn이 전에 skill 사본을 놓던 곳. 지운 skill의 옛 사본을 지울 때 쓴다"로 고친다. `packages/protocol/coding-agent/mod.ts`의 그 export 줄도 뺀다(지운 것을 가리키던 등록 줄만 빼는 것은 worker가 한다. "등록할 것"에 적는다).
3. `packages/coding-agent`
   - 지운다: `cli/commands/{ticket.ts,release.ts,guide.ts}`, `connection/ticket-ops.ts`, `guides/` 폴더 전체.
   - `cli/registry.ts`: `TICKET_COMMANDS`, `RELEASE_COMMANDS`, `GUIDE_COMMANDS`를 뺀다. 표 대조(25~32줄)가 남은 명령으로 맞는지 본다.
   - `cli/commands/app.ts`: `app test`, `app test status`, `app test result` 줄과 머리 주석의 "test"를 지운다.
   - `cli/commands/types.ts`: `READ_WORDS`에서 이제 쓰는 명령이 없는 `result`, `guide`를 지운다.
   - `connection/mod.ts`: `reportTicket` export를 지운다.
   - `cli/commands/harness-run.ts`: `loadSkills`와 `skills` port를 지우고 새 port 둘(4)을 실제 file 시스템으로 채운다. 40줄 주석을 고친다. `cli/commands/harness.ts`의 머리 주석과 `harness install` 요약을 "hook을 놓고 지운 skill의 옛 사본을 지운다"로 고친다.
   - `cli/help.ts`는 표에서 만들어 고칠 것이 없을 것이다. 남은 ticket 말이 있으면 고친다.
   - `cli/main_test.ts`: 둘째 test("release와 app test를 읽는 명령은 표의 route에 닿는다")를 지운다. 대상 명령이 모두 없어진다(설계와 맞지 않는 test는 지운다). 그 test만 쓰던 import(`routePath`, `releasePreparation`, `getTestRequest`, `getVerification`)를 지운다. 다른 셋은 그대로 둔다. 넷째 test("app preview start는 …")의 입력 `fixture_hash`는 ab-preview가 route 입력을 바꾸며 맞춘다. 이 task는 건드리지 않는다.
4. 옛 사본 지우기(`harnesses/install.ts`. 근거: 이슈의 추천, 계약). 사람 home에 쓰는 일이라 아래 규칙을 정확히 지킨다.
   - `InstallPorts`에서 `skills`를 지우고 둘을 더한다: `list(dir): Promise<string[] | null>`(폴더 안 항목 이름. 없으면 null), `remove(path): Promise<void>`(file 하나나 빈 폴더 하나를 지운다. recursive가 아니다). 실제 구현(`harness-run.ts`)은 `Deno.readDir`과 `Deno.remove(path)`(옵션 없음)다. 비지 않은 폴더는 `Deno.remove`가 던지므로 사람의 다른 file을 지울 길이 없다.
   - 지울 이름은 상수 하나다: `RETIRED_SKILL_NAMES = ["lophn-build-app", "lophn-repair"]`. 이름을 패턴, 접두, 목록 읽기로 고르지 않는다. 폴더 목록에서 이름을 찾지 않고 이 두 이름의 path만 만든다.
   - harness마다(`skill_dir`가 null이면 `not_supported`) 이름마다 `folder = <home>/<skill_dir>/<name>`, `file = <folder>/SKILL.md`. 지우는 조건은 셋 다다.
     - `list(folder)`가 정확히 `["SKILL.md"]`다(다른 file이나 폴더가 하나라도 있으면 사람이 손댄 것이라 둔다).
     - `read(file)`의 글이 `---\nname: <name>\n`으로 시작하는 frontmatter(`---` 줄로 닫힘) 하나와, 그 뒤 본문이 `thinSkill`이 쓰던 본문(`\n# <name>\n\n절차는 \`lophn guide <name>\`이 내준다. 그 출력을 따른다.\n`)과 byte까지 같다. `thinSkill`의 본문 글은 지우기 전 함수에서 그대로 옮겨 상수로 둔다.
     - `dry_run`이 아니다. `dry_run`이면 지우지 않고 그 `file`을 `files`에 담는다.
   - 지울 때는 `remove(file)` 뒤 `remove(folder)`다. 그 밖의 path에 `remove`를 부르지 않는다.
   - 결과의 `skill`: 지운(dry_run이면 지울) 것이 있으면 `installed`(dry_run이면 `missing`), 없으면 `unchanged`, `skill_dir`가 null이면 `not_supported`. `files`에는 지운(지울) `SKILL.md` path를 담는다. hook 갈래는 그대로다.
   - 머리 주석(1~3줄)을 "hook 설정을 놓고, lophn이 전에 놓은 얇은 skill 사본 가운데 지운 skill의 것만 지운다"로 고친다. `thinSkill`, `installSkill`은 지운다.
5. `coding-token.ts`: `ticketUploadSummary` import와 `CODING_TOKEN_OPERATIONS`의 그 줄, 11~12줄 주석의 `ticket report` 문장을 지운다. `coding-token_test.ts`의 `tokenRoutes`에서도 지운다. test의 판정(그 앱 하나만 연다, 회수하면 거절)은 그대로다(권한 경계 test라 남긴다).
6. `server/mcp.ts`의 `INSTRUCTIONS`: "These are the tools of this ticket's app."를 "These are the tools of this session's app."로 고친다.
7. 앱 template `AGENTS.md.tmpl`의 lophn-managed 묶음(6~55줄)을 다시 쓴다(planner: 이제 이 file은 App Engineer가 읽는다. 누가 source를 고치든 맞는 말만 둔다).
   - 지운다: "통로와 필요한 배포 skill"과 "사람 지시 claim" 절 전체(ticket, claim, `lophn ticket`, 배포 skill `lophn-build-app`), `lophn app test`와 ticket 예시(`examples`) 줄, "runner가 낸 실제 test result", "`message send`로 App Engineer에게 청한다"는 말.
   - 둔다: 정본 `AGENTS.md` 하나를 읽는다는 줄, "설계와 구현의 구별" 절, SDK `guide.md`를 읽는 줄, `reportProblem` 줄, preview는 fixture 격리 사본에서의 확인일 뿐이라는 줄.
   - 바꾼다
     - 새 SDK Package나 의존: `blueprint.ts`의 의존 선언과 `deno.json` import map을 같은 정확한 version으로 함께 고친다(release 준비가 둘을 대조한다).
     - test: 앱 test는 `deno task test`, type 검사는 `deno task check`로 돌린다(아래 "명령" 절과 같은 말).
     - release 전 commit: release 준비는 source의 지금 commit(HEAD)으로 bundle을 만들고, commit하지 않은 변경이나 ignore하지 않은 새 file이 있으면 거절한다. 고친 것은 모두 commit한 뒤 준비한다.
     - 결과를 알릴 때 확인한 것(앱 test, preview에서 본 동작, release 준비, activation)과 확인하지 않은 것, 알려진 한계를 구별해 적는다.
   - managed 묶음 밖 "파일" 절의 "다른 domain이 필요하면 App Engineer에게 청한다." 한 문장도 같은 이유로 지운다. 나머지 절(파일, 명령, 재사용 기준)은 그대로다.
8. (worker는 고치지 않는다. lead가 이 task branch에서 merge 전에 고친다. 안 고치면 docs check가 떨어진다) `project-docs/architecture/ui-kit.md` 70줄: 지운 `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`를 가리키는 괄호를 지운다. 문장의 뜻(coding agent는 설치 사본의 `guide.md`를 읽는다)은 둔다.
9. 위험 test(`harnesses/install_test.ts`. 아래 "끝남"). 지금의 `memory` 대역을 file Map 위의 `read`, `write`, `list`(그 폴더 바로 아래 항목 이름), `remove`(file이면 Map에서 빼고, 폴더면 아래 항목이 없을 때만 빈 폴더 표시를 뺀다. 아래가 있으면 던진다)로 바꾼다. 준비는 한 번, 경우는 표로 돈다.
   - lophn이 쓴 꼴의 `<home>/.claude/skills/lophn-build-app/SKILL.md` → file과 폴더가 없어진다. 결과 `skill`은 `installed`.
   - 사람이 본문을 고친 `lophn-repair/SKILL.md` → 남는다.
   - lophn 꼴 `SKILL.md` 옆에 `notes.md`가 더 있는 `lophn-build-app/` → 둘 다 남는다.
   - 다른 이름의 skill 폴더(예: `my-skill/SKILL.md`, 본문이 thin 꼴이라도) → 남는다.
   - `dry_run` → 아무것도 지우지 않고 `skill`은 `missing`, `files`에 지울 path가 있다.
   - 판정은 Map에 남은 file 목록(바깥 결과)이다. 호출 횟수를 세지 않는다.
   - 지금 있는 두 hook test는 새 대역으로 그대로 돈다.

## 끝남

- `deno task check`가 통과한다.
- 바꾼 곳의 test: `deno test --no-check packages/coding-agent packages/core/server/identity`
- 위험 test: "설치는 lophn이 놓은 지운 skill의 얇은 사본만 지우고, 사람이 고친 사본, 다른 file이 더 든 폴더, 다른 이름의 skill 폴더는 남긴다"(`packages/coding-agent/harnesses/install_test.ts`. 사람 home에 쓰는 경계다).
- 남지 않음
  - `git grep -n -i "ticket" -- packages/coding-agent packages/protocol/coding-agent/cli-commands.ts packages/protocol/coding-agent/harness-adapter.ts packages/core/server/identity/coding-token.ts packages/core/server/identity/coding-token_test.ts packages/core/server/mcp.ts packages/core/apps/packages/template/app/AGENTS.md.tmpl`가 0줄이다.
  - `git grep -n "CODING_SKILL_NAMES\|loadSkills\|guides/\|thinSkill\|requestTest\|getTestRequest\|getVerification\|releasePrepareBundle\|releasePreparation" -- packages/coding-agent packages/protocol/coding-agent`가 0줄이다.
  - `git grep -n "lophn-build-app\|lophn-repair" -- packages`가 `install.ts`의 `RETIRED_SKILL_NAMES`와 `install_test.ts`뿐이다.
  - `git grep -n "message send\|App Engineer에게 청한다\|lophn app test" -- packages/core/apps/packages/template/app/AGENTS.md.tmpl`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `packages/protocol/coding-agent/mod.ts`의 `CODING_SKILL_NAMES` export 줄(뺀 그대로인지)
- 안 쓰게 된 export: `tools/package-linux.ts`의 skill 배포 자리(`layout.skills`, 110~113줄)와 `tools/verify-linux-install.ts` 65줄은 원본이 없어 빈 폴더만 둔다. 지우지 않고 적는다. 그 밖에 생기면 적는다.
- 정한 것: 문서에 답이 없어 worker가 정한 것(template 글의 문장)
- 넘길 줄: `project-docs/architecture/ui-kit.md` 70줄
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: `harness install`은 coding session을 열 때만 돈다(`requests.ts`의 `registerOnce`). ab-router 뒤 Router가 coding session을 열지 않으므로, 이미 옛 사본이 있는 사람은 손으로 `lophn harness install --input '{"harness":"claude"}'`를 돌려야 지워진다. 그 밖에 있으면 적는다.

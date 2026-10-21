# ab-coding-move

coding agent 연결 장치가 든 폴더 `packages/core/apps/tickets/coding/`을 ticket 밖 `packages/core/apps/coding/`으로 옮긴다. 동작은 바꾸지 않는다. ticket을 지우는 뒤 task들이 새 자리에서 일하게 하려고 먼저 옮긴다(README "App Engineer가 coding agent에게 맡기는 흐름을 막는다"의 "연결 장치는 `packages/core/apps/tickets/coding/`에서 `packages/core/apps/coding/`으로 옮긴다").

정한 것: 자리는 `packages/core/apps/coding/`이다. 이유: 지금처럼 apps module(boundary `apps`) 안이라 `project-docs/module-catalog.yaml`과 import 규칙(`tools/check-deps.ts`)이 바뀌지 않는다. coding session은 앱 하나의 source 폴더와 앱 줄에 묶인다.

- 단위: coding (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/tickets/coding/`(옮긴다)
  - `packages/core/apps/coding/`(새 폴더)
  - `packages/core/apps/tickets/register.ts`(`./coding/lookup.ts` import 한 줄만)
  - `packages/core/main/daemon/wiring/{coding-sessions.ts,router-registration.ts,session-snapshots.ts,setting-declarations.ts}`(import 경로만)
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "App Engineer가 coding agent에게 맡기는 흐름을 막는다" 묶음
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core`(boundary `apps`. coding 폴더는 따로 줄이 없다), `tools/check-deps.ts`(apps 안의 폴더 이동은 규칙에 걸리지 않는다)
  - 도구: `tools/move-files.ts`(머리 주석이 사용법이다. mapping대로 옮기고 import·`new URL` 경로를 고치고, 고치지 못한 곳과 옛 경로 언급을 보고서에 file:line으로 남긴다. 폴더 mapping은 `from`, `to` 둘 다 `/`로 끝나야 한다. 끝나지 않으면 "from에 맞는 파일이 없음"으로 멈춘다)
  - 옛 경로를 가리키는 곳(main `dd956b49f`)
    - `packages/core/main/daemon/assembly.ts` 48줄(`createCodingRegistration` import), 88줄(`TEAM_MODULES`의 URL)
    - `packages/core/main/daemon/wiring/coding-sessions.ts` 31줄, `router-registration.ts` 13·19줄, `session-snapshots.ts` 14줄, `setting-declarations.ts` 4줄
    - `packages/core/apps/tickets/register.ts` 12줄(`./coding/lookup.ts`)
    - 옮긴 폴더 안에서 ticket 쪽을 가리키는 import: `transport.ts` 26줄(`../store.ts`의 `loadTicket`), `coding_test.ts` 8줄(`../schema.ts`의 `ticketSchemaSteps`)
    - 문서: `project-docs/architecture/coding-agent.md` 58줄(`packages/core/apps/tickets/coding/scaffold-source.ts`). `tools/check-docs.ts`가 본다. `project-docs/issues/archived/`, `project-docs/plan/`, `project-docs/products/change-log/`, `project-docs/products/roadmap/`의 언급은 docs 검사 밖이라 두고 보고만 한다.
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: coding 폴더의 file과 export 이름이 모두 그대로이고 경로만 `packages/core/apps/coding/`이다. `packages/core/apps/tickets/coding/`이 없다. coding 폴더가 ticket을 가리키는 import(`transport.ts`의 `../tickets/store.ts` `loadTicket`, `coding_test.ts`의 `../tickets/schema.ts` `ticketSchemaSteps`)는 경로만 고쳐 남는다(ab-coding-detach가 끊는다).
  - 등록할 것(lead): `packages/core/main/daemon/assembly.ts`의 coding 등록 import와 `TEAM_MODULES`의 URL 두 줄.

## 할 일

근거: README의 옮길 자리. 동작, 이름, schema step id(`coding-agent.sessions.tables`)는 바꾸지 않는다.

1. 도구로 옮긴다. worktree가 깨끗한 상태(`git status --porcelain`이 빔)에서 한다. 도구가 그 조건을 본다.
   - mapping file(저장소 밖 임시 자리): `{"moves":[{"from":"packages/core/apps/tickets/coding/","to":"packages/core/apps/coding/"}]}`
   - 먼저 `deno run --allow-read --allow-write=<임시 자리> --allow-run tools/move-files.ts <mapping> --dry-run --report <임시 자리>/report.txt`. 기대: 옮김 24개, 오류 0, 손으로 고칠 경로 0(main `dd956b49f`에서 확인함).
   - 보고서에 오류나 "손으로 고칠 경로"가 있으면 고치지 말고 그 줄을 보고하고 멈춘다.
   - `--dry-run` 없이 다시 돌린다(`--allow-write`는 저장소 root). 도구는 `Deno.rename`으로 옮긴다. git은 commit 때 rename으로 본다.
2. 도구가 고친 곳이 위 "읽을 것"의 목록과 같은지 `git diff --stat`으로 본다. 소유 밖 file이 바뀌었으면(`assembly.ts` 말고) 되돌리고 보고한다. `assembly.ts`의 두 줄은 도구가 고친 대로 두고 "등록할 것"에 적는다(그대로 두어야 check가 돈다).
3. (worker는 고치지 않는다. lead가 이 task branch에서 merge 전에 고친다. 안 고치면 docs check가 떨어진다) `project-docs/architecture/coding-agent.md` 58줄의 path를 `packages/core/apps/coding/scaffold-source.ts`로 고친다. 문장은 고치지 않는다(동작은 ab-source가 바꾸고 그 줄도 그때 고친다).
4. 옛 경로가 남지 않았는지 본다: `git grep -n "tickets/coding" -- packages tools project-docs/architecture AGENTS.md .claude`가 0줄이다. 주석 언급이 남았으면 경로만 고친다(소유 file 안일 때). 소유 밖이면 보고한다.
5. 바꾼 곳의 test를 돌린다: `deno test --no-check packages/core/apps/coding`(`coding_test.ts`, `store_test.ts`).

## 끝남

- `deno task check`가 통과한다.
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다(team 등록 URL이 바뀌었다).
- 위험 test: 없음. 동작을 바꾸지 않고 옮기기만 한다.
- 남지 않음
  - `test -e packages/core/apps/tickets/coding`이 실패한다(폴더가 없다).
  - `git grep -n "tickets/coding" -- packages tools project-docs/architecture`가 0줄이다.

## 보고

- 바꾼 file(도구 보고서의 "옮김"과 고친 file 목록)
- 통과한 check
- 등록할 것: `packages/core/main/daemon/assembly.ts` 48줄과 88줄(도구가 고친 그대로인지)
- 안 쓰게 된 export: 없을 것이다. 있으면 적는다.
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `project-docs/architecture/coding-agent.md` 58줄의 path. 도구 보고서의 "옛 경로 언급" 가운데 docs 검사 밖이라 고치지 않은 것(file:line)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

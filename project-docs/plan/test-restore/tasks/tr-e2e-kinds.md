# tr-e2e-kinds

새 e2e flow 하나: project domain의 kind 파일 위반이 kinds worker process를 거쳐 domain problem(`domain_problems`)이 되고 `KindViolationFound`로 그 project의 Project Manager가 깬다.

- 단위: e2e (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/e2e/kinds_test.ts` (새 file)
  - 제품 bug일 때만: `packages/core/projects/kinds/`, `packages/core/problems/domain/`
- 읽을 것:
  - AGENTS.md, `.claude/skills/write-test/SKILL.md`
  - architecture: `project-docs/architecture/kinds.md`(흐름 그림, "지키는 것"의 위반·problem·`KindViolationFound` 항목), `project-docs/architecture/domain.md`(`agentOfDomain`, domain 폴더), `project-docs/architecture/testing.md`("case 고르는 규칙", "E2E 실행 폴더")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `kinds`·`problems`·`domains`·`events`·`router`, `project-docs/module-catalog.yaml`의 `packages/core/projects`·`packages/core/problems`
  - 코드: `packages/core/projects/kinds/host/watch/service.ts`(`createKindsWatch`의 `open`·`refreshAll`·`WATCH_COMMANDS`), `packages/core/projects/kinds/host/watch/fs.ts`(없는 폴더는 건너뜀), `packages/core/projects/kinds/host/dispatcher.ts`, `packages/core/main/daemon/wiring/kinds.ts`(조립. lead만 고친다), `packages/core/problems/domain/commands.ts`(`problem.sync_domain`이 `KindViolationFound`를 낸다), `packages/core/events/reactor/session-opening.ts`(`KindViolationFound` → `agentOfDomain` → 새 session), `packages/protocol/projects/kinds-file.ts`(kind 파일 schema, `DOCUMENT_RULES`)
  - 본보기: `tests/e2e/reaction_test.ts`의 `reactionSessions`·`newSession`(program이 연 session 찾기)
- 계약:
  - 쓰는 것: `packages/protocol/domains/`(`domainCreate`, `domainKindsFile`), `tests/support/core/`·`tests/support/fake-server/`(고치지 않는다)

## 할 일

자리: 새 file이다. 앱이 없는 project 길이라 준비가 core 기동뿐이다(`bootCore(run)`, `appCoreEnv` 없이). 시간은 file 전체 10초 안.

1. `tests/e2e/kinds_test.ts`에 `Deno.test` 하나, core 하나. `createRun` → `startFakeServer` → `bootCore(run)` → `connectFakeProvider`. 정리는 `finally`에서 `core.kill()`, `fake.close()`, `run.remove()`(다른 e2e file과 같은 꼴).
2. 머리 주석에 세 질문(testing.md 규칙 1).
   - contract: `kinds`·`problems`·`events`(그릇의 domain 폴더에 처음 쓴 kind 파일의 문서 위반이 kinds worker를 거쳐 domain problem으로 열리고, 새 위반이면 `KindViolationFound`가 그 그릇의 Project Manager session을 한 번 연다).
   - 현실적 회귀: watch가 domain 폴더를 못 봐 처음 쓴 `kinds.yaml`을 놓친다, worker launch spec의 읽기 권한에 project 폴더나 kind 파일이 빠져 worker가 못 읽는다, dispatcher의 machine 자격이 `problem.sync_domain`을 못 부른다, reaction이 project owner domain의 Project Manager를 못 찾는다, 같은 위반이 sync마다 session을 또 연다.
   - 왜 지금 test로 못 잡나: `kinds-file_test.ts`와 `packages/core/problems/domain/commands_test.ts`는 한 쪽씩만 본다. core watch → worker process → machine command → Reactor → Router → Project Manager turn은 process를 건너야 보인다.
   - fake 대답: 1(reaction session turn의 text).
3. 단계(6 이하). 순서는 제품과 같게 한다: domain을 만든 뒤에 domain 폴더가 생기고(제품에서는 turn 시작 때 agent runtime이 만든다, `packages/core/agent-roles/place/place-data.ts`의 `ensureDir`), 그 뒤에 Project Manager가 `kinds.yaml`을 처음 쓴다. test는 그 file tool 대신 직접 쓴다(file tool의 범위는 이 flow의 contract가 아니다).
   1. project: `folder = ${core.run.work}/notes-project`를 만들고 깨진 문서 `notes/a.md`(frontmatter `title: a`만, `status` 없음)를 쓴 뒤 `openProject(core, folder, "notes-project")`.
   2. `fake.script([{ reply: { kind: "text", text: "noted" } }])`(기본 줄. reaction session은 새 session이라 기본 줄이 받는다).
   3. `const before = await runtimePids(core.run.home)`(`tests/support/core/process.ts`), `const domain = await core.call(domainCreate, { name: "notes", title: "Notes", purpose: "Notes kept in this project", owner: { kind: "project", id: project } })`, `before.length > 0`이면 `settle(core, before)`. 근거: active domain 폴더가 agent runtime child의 Deno 권한 폴더라(`runtimeFoldersOf`, `packages/core/main/daemon/place-folders-glue.ts`) core가 1초 polling으로 child를 다시 띄운다. reaction turn이 그 사이에 시작하면 끊긴다.
   4. `Deno.mkdir(domainFolder(core.run.home, domain.id), { recursive: true })` 뒤 `Deno.writeTextFile(domainKindsFile(core.run.home, domain.id), KINDS)`(`packages/protocol/domains/mod.ts`). `KINDS`:
      ```yaml
      kinds:
        - name: note
          summary: a note
          files: [notes/*.md]
          key: file
          fields:
            status:
              type: string
              required: true
      ```
   5. 기다림: `until("domain problem이 열림", ...)`으로 `core.call(problemListDomain, { domain: domain.id, state: "open" })`(`packages/protocol/problems/mod.ts`, route 이름 `problem.list_domain`)이 비지 않을 때까지. 그 다음 `until`로 `agentSessionList({ agent: { role: "project_manager", project } })`의 session 가운데 첫 `receivedMessageList` 메시지의 `from.kind`가 `program`인 것을 찾고 `waitTurnEnd(core, session)`.
4. 단정 셋(서로 다른 곳, 문구는 단정하지 않는다).
   - ledger: 열린 problem의 `violation`이 `{ source: "document", rule: "required", kind: "note", path: "notes/a.md", field: "status" }` 하나다(`message`는 빼고 견준다).
   - route: program이 연 Project Manager session이 하나다(그 turn의 place 정보가 `kind.get`으로 다시 sync해도 같은 위반으로 둘째 session이 열리지 않는다).
   - fake: journal이 요청 하나이고 `mismatch`가 null이다.
5. 먼저 위 순서로 돌려 본다. 위반이 오르지 않고 5의 `until`이 30초 뒤 실패할 것으로 본다. 이유(코드에서 확인한 것): `domain.create`의 `onCommand` → `refreshAll` → `open(domain)`이 domain 폴더가 아직 없을 때 감시를 열어 `startFsWatch`가 그 폴더를 건너뛰고(`fs.ts` 70~74줄), entry는 `incomplete`가 되며, 다시 여는 것은 다음 `WATCH_COMMANDS` command뿐이다. 그래서 처음 쓴 `kinds.yaml`의 변화를 아무도 보지 않고 다음 읽기(sync)까지 problem이 없다. `service.ts` 176줄 주석("PM이 처음 kinds.yaml을 쓸 때 폴더 감시가 이미 열려 있어야 한다")과 kinds.md 흐름 그림과 어긋나므로 제품 bug로 본다(규칙 8).
   - 실패를 확인하면 `packages/core/projects/kinds/host/watch/service.ts`에서 고친다. 추천: `open`이 감시를 열기 전에 domain 폴더를 만든다. `KindsWatchDeps`에 선택 `ensureDir(path)`를 더하고 기본값을 `Deno.mkdir(path, { recursive: true })`로 두어 `packages/core/main/daemon/wiring/kinds.ts`를 고치지 않는다(file system은 인자로 받는다, AGENTS.md). 만들지 못하면 지금처럼 `incomplete`로 둔다. 같은 file의 "domain 폴더는 만들지 않는다" 주석을 고친다. timer로 다시 여는 길은 쓰지 않는다(열 때마다 worker에 `get`과 force sync를 보낸다).
   - kinds.md의 "domain 폴더는 turn을 시작할 때 place 정보를 만들면서 core가 만든다" 줄에 "kind 감시를 열 때도 만든다"를 더하는 것은 소유 밖이라 보고의 "넘길 줄"에 적는다.
   - 다른 이유로 실패하면 `core.logPath`(core stderr)의 `kinds worker:`·`kinds sync` 줄부터 본다(`packages/core/main/daemon/wiring/kinds.ts`가 거기 찍는다). 원인이 `packages/core/main/daemon/wiring/kinds.ts`나 소유 밖이면 고치지 말고 "계약 바꾸기 요청"에 적는다.
   - 고치기 전 코드에서 이 test가 실패하고 고친 뒤 통과하는 것을 보고에 남긴다(규칙 6).

## 끝남

- `deno task check:full`이 통과한다.
- `deno test --allow-all --no-check tests/e2e/kinds_test.ts`가 10번 연속 통과한다(앱 길이 아니라 `e2e:deps`는 필요 없다). 끝난 뒤 `/tmp/lophn-e2e-*`와 core process(`pgrep -f packages/core/main/daemon/main.ts`)가 남지 않는다.
- 시간: file 하나가 10초 안이다.
- 위험 test: "처음 쓴 kind 파일의 문서 위반이 kinds worker를 거쳐 domain problem으로 열리고 그 project의 Project Manager session이 한 번 열린다"(이 e2e). watch를 고쳐도 unit test는 더하지 않는다(이 e2e가 회귀 행이다).

## 보고

- 바꾼 file
- 통과한 check, 10번 돌린 결과와 file 시간, 고치기 전 실패를 확인했는지
- 등록할 것: `project-docs/architecture/testing.md`의 e2e file 목록에 `kinds_test.ts`(lead가 계획 끝에 고친다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: test가 file tool 대신 domain 폴더와 kind 파일을 직접 쓴 것, watch 고침의 모양
- 넘길 줄: kinds.md 한 줄(위 할 일 5)
- 계약 바꾸기 요청: wiring이나 소유 밖을 고쳐야 하면 여기 적는다
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

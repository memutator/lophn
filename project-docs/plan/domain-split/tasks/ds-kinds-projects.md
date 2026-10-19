# ds-kinds-projects

kind 파일의 glob이 가리키는 파일을 "이은 project의 폴더"에서 찾게 한다. domain에 이은 project가 하나면 지금처럼 그 project 폴더 기준이고, 둘 이상이면 glob 앞에 `<project 이름>:`을 붙여 project를 고른다(`lophn:tests/eval/**`). 붙이지 않은 glob은 이은 첫 project 기준이다. kind 글, 감시, index, `kind.*` 응답의 경로도 이 규칙을 따른다.

- 단위: kinds (wave 3)
- 선행: ds-project-registry
- 소유(이 task만 고친다):
  - `packages/protocol/domains/kinds-api.ts`
  - `packages/protocol/domains/kinds-file.ts`
  - `packages/protocol/domains/kinds-file_test.ts`
  - `packages/protocol/domains/kinds-work.ts`
  - `packages/core/domains/kinds`
  - `packages/core/main/daemon/wiring/kinds.ts`
  - `packages/core/agent-roles/skills`
  - `packages/core/agent-roles/tools/kind.ts`
  - `packages/core/agent-roles/tools/kind_test.ts`
  - `packages/core/lophn-agent/prompt-assembly/kind-text.ts`
- 읽을 것:
  - 계획: `project-docs/plan/domain-split/README.md`("정한 것"의 kind glob), `tasks/ds-project-registry.md`(lookup 계약: `domainProjects`, `domainRootsOf`, `activeDomainRoots`)
  - roadmap: `project-docs/products/roadmap/domain.md`의 "project와 domain"("여러 project에 걸치는 domain의 kind glob은 project를 앞에 붙인다")
  - architecture: `project-docs/architecture/kinds.md` 전체(흐름, 지키는 것: glob, 겹침, 감시, 위반 → problem)
  - 코드(R 이름): `packages/protocol/domains/kinds-file.ts`(`folderOfGlob`, `kindWatchFolders`, `folderCovers`, `checkKindsStructure`, `badGlob`), `kinds-work.ts`(`common.roots`), `packages/core/domains/kinds/{worker/files.ts,worker/run.ts,worker/jobs.ts,extract/glob.ts,extract/items.ts,index/scan.ts,check/kinds-file.ts,host/dispatcher.ts,host/handlers.ts,host/watch/{service,detector,types,fs}.ts}`, `packages/core/main/daemon/wiring/kinds.ts`
  - 본보기(test): `packages/core/domains/kinds/worker/files_test.ts`, `packages/core/domains/kinds/check/kinds-file_test.ts`, `packages/protocol/domains/kinds-file_test.ts`
- 계약:
  - 쓰는 것: `ds-project-registry`의 `domainProjects(sql, domain): {id, name, folders}[]`(연결 순서, active만).
  - 내놓는 것: kind glob 문법 `[<project 이름>:]<glob>`, 항목 경로 규칙, worker 요청의 `roots` 모양(아래).

## 정한 것

- glob 문법: `files` 항목은 `<project 이름>:<glob>` 또는 `<glob>`이다. project 이름은 `slugSchema`(소문자·숫자·`-`)이고 `:` 하나로 glob과 가른다. 접두는 이은 project 이름이어야 한다.
- 첫 project가 base다. 붙이지 않은 glob은 이은 첫 project의 폴더들에서 찾고, 첫 project 이름을 붙인 glob은 붙이지 않은 것과 같다(저장·겹침 검사 전에 접두를 떼어 하나로 맞춘다). 같은 glob이 둘이면 `duplicate_glob`이다.
- 항목 `path`: base project의 파일은 지금처럼 project 기준 상대 경로이고, 다른 project의 파일은 `<project 이름>:<상대 경로>`다. 한 project만 이은 domain은 지금과 모든 값이 같다. `kind.key`가 `path`이거나 `file`을 못 뽑을 때의 key도 이 `path`다.
- 칸의 `capture`(path에서 값을 뽑는 패턴)는 접두를 뺀 상대 경로에 맞춘다.
- drive 글자(`C:/…`)를 막는 `badGlob`은 `^[A-Za-z]:[\\/]`일 때만 막게 좁힌다(project 이름이 한 글자여도 `c:glob`이 된다). `..`, 절대 경로, 역슬래시는 접두 뒤 glob에도 그대로 막는다.
- 이어지지 않은 project 이름을 쓴 glob은 `bad_glob` 오류다(그 kind 파일 자체의 오류라 "kind 파일 오류는 그 kind를 쓰지 않는다"는 기존 규칙을 따른다). project 이름이 바뀌어 접두가 틀어지면 같은 오류가 되고 Domain Engineer가 고친다.
- 이은 project가 없으면 roots가 비어 kind는 항목을 못 찾는다(지금 폴더 없는 project와 같다).
- worker는 root를 `{project: 이름, roots: [절대 경로…]}[]`로 받는다(첫 항목이 base). 한 project 안에서 같은 상대 경로가 여러 폴더에 있으면 앞 폴더가 이긴다(지금과 같다).

## 할 일

1. **protocol.** `kinds-file.ts`에서 glob을 `{project: string | null, glob: string}`으로 읽는 함수를 두고 `folderOfGlob`·`kindWatchFolders`·`folderCovers`·`checkKindsStructure`(`bad_glob`, `duplicate_glob`, `glob_overlap` 기준)가 쓴다. `KindWatchFolder`에 `project`(이름 또는 null=base)를 더한다. `kinds-work.ts`의 `common.roots`를 새 모양으로 바꾸고 최대 크기는 유지한다. `kinds-api.ts`의 항목 `path` 설명을 맞춘다. 쓰는 곳(worker, host, watch, test)을 같은 변경에서 고친다(`v2` 이름을 만들지 않는다).
2. **worker.** `worker/files.ts`의 `collect`·`openProjectFiles`가 `{project, roots}[]`를 받아 base project 파일은 상대 경로로, 나머지는 `<이름>:<상대 경로>`로 담는다. 각 root의 safety 규칙(`.git` 건너뜀, 폴더 밖 symlink 거절, 제외 폴더, 예산)은 project마다 그대로 적용한다. `extract/glob.ts`(`kindMatcher`, `matcherFor`)는 접두를 뗀 glob을 같은 namespace의 경로에 맞춘다. `index/scan.ts`·`worker/run.ts`·`worker/jobs.ts`의 root 인자를 바꾼다.
3. **host.** `host/dispatcher.ts`의 `roots(domain)`과 `host/handlers.ts`의 `rootsOf`, `wiring/kinds.ts`(`domainProjects`로 `{project 이름, roots}[]`를 만든다)를 맞춘다. `host/watch/{service,detector,types,fs}.ts`: 감시 root가 project마다 있고, 신호 경로가 어느 project의 root에서 왔는지로 `folderCovers`를 적용한다. 감시를 다시 정하는 command 목록은 `ds-project-registry`가 이미 연결·끊기·project 폴더 변경을 넣었다. 그대로 둔다.
4. **kind 글·tool.** `lophn-agent/prompt-assembly/kind-text.ts`(`buildKindText`, `renderKindText`)와 `agent-roles/tools/kind.ts`(`kind.list`, `kind.check` 설명)에서 glob과 항목 경로가 새 문법으로 나오게 한다. `FolderRead`, `buildKindText`, `renderKindText`의 export 시그니처는 바꾸지 않는다(`ds-scope`의 `place-info.ts`가 쓴다).
5. **내장 skill.** `agent-roles/skills/kinds-yaml/SKILL.md`에 접두 문법과 base 규칙을 짧은 예시(`lophn:tests/eval/**`)로 더한다. 단 project가 하나뿐인 domain은 접두가 필요 없다고 쓴다.
6. **test.** 위험 test만:
    - `worker/files_test.ts`에 추가: 두 project root를 열었을 때 붙이지 않은 glob은 base project 파일만, 접두 glob은 그 project 파일만 담고, 이어지지 않은 project나 `..`가 든 접두 glob은 어떤 파일도 열지 못한다(읽기 시도가 root 밖으로 가지 않는다).
    - `protocol/domains/kinds-file_test.ts`: `badGlob`이 `C:/x`는 막고 `c:x/**`는 접두로 받는다. 접두를 뗀 뒤의 `..`는 막는다.
    - 옛 모양(roots가 문자열 배열)을 전제로 한 test는 지우거나 새 모양으로 옮긴다.

## 끝남

- `deno task check`가 통과한다. core 기동은 `project-docs/plan/tools/lead/boot.sh`로 본다(kinds worker 등록).
- 위험 test: "붙이지 않은 glob은 base project 파일만 연다", "이어지지 않은 project나 `..`를 쓴 접두 glob은 파일을 열지 못한다".
- 남지 않음: `grep -rn "roots: z.array(absolutePathSchema)" packages/protocol`가 0줄이다(옛 `roots` 모양).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 있으면 목록(남이 쓰던 것은 지우지 않는다)
- 정한 것: 접두 문법의 세부, 항목 경로, 오류 문구
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: `domainProjects` 모양 변경이 필요하면 적는다
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: project 이름을 바꾸면 접두가 틀어져 kind 파일이 오류가 되는 것(고치는 것은 Domain Engineer의 몫이다). 그 밖에 안 되는 동작.

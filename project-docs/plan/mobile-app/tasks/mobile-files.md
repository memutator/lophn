# mobile-files

project 폴더의 file 목록과 글 file 읽기를 core route로 짓고 폰 자격에 연다. 폰의 project 화면이 Files 탭과 문서 읽기에 쓴다.

- 단위: core-files (wave 2)
- 선행: mobile-routes
- 소유(이 task만 고친다):
  - `packages/protocol/projects/project-files.ts`
  - `packages/core/projects/files`
  - `packages/protocol/remote/allowlist.ts`
  - `packages/core/remote/host_test.ts`
- 읽을 것:
  - 본보기(같은 project 범위를 지키는 읽기): `packages/protocol/projects/project-search.ts`, `packages/core/projects/search/mod.ts`(`searchScopeOf`: project에 등록된 폴더 밖이면 `invalid_input`)
  - architecture: `project-docs/architecture/remote.md`(폰 자격의 route 목록), `project-docs/boundary-catalog.yaml`과 `module-catalog.yaml`의 project 항목
  - 화면: `tools/wireframes/drafts/phone/workspace.tsx`의 `Files`와 `Reader`
- 계약:
  - 쓰는 것: route 정의 꼴(`defineRead` 등)과 등록 길은 `project-search.ts`가 쓰는 것 그대로
  - 내놓는 것:
    - `project_files/list` (read, actor user): 입력 `{project, path?}`(project 폴더 기준 상대 path, 없으면 root). 출력 `{entries: [{name, kind: "file" | "folder", size, modified_at}]}`. 폴더가 먼저, 이름 순. `.git`과 `node_modules`는 내지 않는다
    - `project_files/read` (read, actor user): 입력 `{project, path}`. 출력 `{text, truncated}`. UTF-8 글 file만, 1 MiB까지(넘으면 앞 1 MiB와 `truncated: true`). 글이 아니면 `invalid_input`
    - 둘 다 폰 allowlist에 든다

## 할 일

1. `packages/protocol/projects/project-files.ts`에 route 둘을 정의하고 `packages/core/projects/files/`에 handler를 짓는다. 등록은 `project-search`가 등록된 곳을 따라 하되 등록 목록 file(`packages/protocol/**/mod.ts`, core 조립 목록)은 lead의 것이니 보고의 "등록할 것"에 적는다. 그 줄이 없으면 check가 안 돌면 그 줄만 최소로 더하고 "넘길 줄"에 적는다.
2. path는 project에 등록된 폴더 안이어야 한다. `..`, 절대 path, 폴더 밖을 가리키는 symlink를 거절한다(`invalid_input`). project가 없으면 `not_found`.
3. 폰 allowlist에 둘을 더하고, 폰 자격으로 부를 때도 범위 검사가 걸리는지 `packages/core/remote/host_test.ts`의 꼴로 확인한다.

## 끝남

- `npm run check:full`과 `project-docs/plan/tools/lead/boot.sh`가 통과한다.
- 위험 test: "project 폴더 밖 path(`..`, 절대 path, 밖을 가리키는 symlink)는 목록도 읽기도 거절한다", "1 MiB를 넘는 file은 잘려 오고 `truncated`가 참이다"
- 지우거나 쓰는 route는 없다(읽기 둘뿐).

- flows catalog: 이 task가 더하거나 지우는 route, CLI 명령, IPC channel, test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 두 route의 입력·출력 예 하나씩, 등록할 것, flows catalog에서 lead가 고칠 것.

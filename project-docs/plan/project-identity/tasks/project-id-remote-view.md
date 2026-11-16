# project-id-remote-view

desktop이 다른 기계(M)의 창을 볼 때 M의 project 가운데 이 컴퓨터의 project와 id가 같은 것을 같은 project로 보인다. 그 project를 열면 기계마다 session 목록을 나란히 보인다(M의 것은 그 창의 core에서, 이 컴퓨터의 것은 shell main을 거쳐 이 컴퓨터의 core에서 읽는다. session은 옮기지 않는다). M에만 있는 project에는 [Clone here], id 없이 remote만 같은 project에는 제안 한 줄을 보인다. 화면 자리는 `desktop-remote`가 지은 다른 기계의 창 안이다.

- 단위: project-id-remote-view (wave 3)
- 선행: project-id-sync, project-id-clone, project-id-screens. 계획 `desktop-remote`가 main에 land된 뒤 띄운다(그 계획의 기계 창, remote preload, `packages/shell/main/desktop/viewer/` 위에 짓는다).
- 소유(이 task만 고친다. lead가 `desktop-remote` land 뒤 아래 "lead가 확인할 path"를 채워 이 줄에 더한다):
  - `packages/shell/renderer/desktop/workspaces/projects/remote-group.ts`(새 file. 묶기 계산)
  - `packages/shell/renderer/desktop/workspaces/projects/remote-group.tsx`(새 file. 묶은 줄, 나란한 session 목록, [Clone here])
  - `packages/shell/ipc/machines.ts`(이 컴퓨터 읽기와 clone 요청의 IPC 모양 두 줄)
  - `packages/design/i18n/catalog/remote-desk.ts`(key만 더한다)
- lead가 확인할 path(`desktop-remote` land 뒤, 그 README "다른 계약" 3~5와 `remote-desk-windows`·`remote-desk-renderer` brief로): remote preload(다른 기계 창의 bridge), shell main에서 기계 창의 IPC를 받고 창으로 기계를 가르는 곳(`ctx.machineOf(webContents)`), 이 컴퓨터의 core를 부르는 shell main의 통로, 다른 기계 창에서 project 목록과 session 목록을 그리는 renderer component. 2026-11-16 이 brief를 쓸 때 `desktop-remote`에는 `remote-desk-client`·`remote-desk-screens` brief만 있어 정하지 못했다.
- 읽을 것:
  - 계획: `project-docs/plan/project-identity/README.md`의 "정한 것"(힌트는 제안만, 한 기계에 한 id), "다른 계획이 기대는 계약" 2·4·5, "계약 바꾸기 요청"의 `desktop-remote` 줄
  - `project-docs/plan/desktop-remote/README.md`의 "정한 것"(한 창은 한 기계, renderer는 기계를 주장하지 못한다, 다른 기계 창에서 project 만들기는 끈다)과 "다른 계획이 기대는 계약" 3~5, land된 뒤의 `project-docs/architecture/remote.md`
  - program: `/home/pyosechang/projects/lophn/reports/multi-machine/program.md`의 "Projects seen across machines", "Rules every plan carries"(여러 기계의 목록은 통째로 받아 한 번에 바꾸고 읽기 실패는 아무것도 지우지 않는다), 정책 14(보기 권한은 관리가 아니다)
  - 비교: `/home/pyosechang/projects/harness-lab/_report/multi-device/paseo.md` 8.3(묶기 view key, 한 host에 같은 key 둘이면 묶지 않음, 이름), `orca.md` 4.1(project 머리줄 아래 host별 줄, "setup-needed")
  - 앞 task의 결과: `packages/protocol/projects/identity.ts`의 `matchProjects`, `ProjectRecord`의 `identity`·`remote`, `project.clone`과 실패의 `details.reason`(`project-id-clone`), `ProjectItem.identity`(`project-id-screens`)
- 계약:
  - 쓰는 것: M의 `project.list`·`ListSessions`(그 창의 core, 기기 allowlist), `matchProjects(local, other)`(이 컴퓨터의 id는 `this:<prj>`, M의 것은 `<M의 mch>:<prj>`), README "계약 바꾸기 요청"의 IPC 둘
  - 내놓는 것: 없음(화면)

## 할 일

1. IPC 둘을 짓는다(`desktop-remote`가 이미 지었으면 그것을 쓴다). 둘 다 다른 기계의 창에서만 받고, shell main이 이 컴퓨터의 core에 사람 자격으로 부른다.
   - `shell:machines-this-read { route: "project.list" | "ListSessions", input }`: 이 두 read만 넘긴다. 다른 route는 거절한다.
   - `shell:machines-clone-here { url, identity, title }`: 이 컴퓨터의 `project.clone`을 부른다. `projects_folder_unset`이면 main이 OS 폴더 선택기를 열고(창은 그 기계 창) 고른 path를 `parent`로 다시 부른다. 결과(성공, `git_auth`의 `details.command`, 그 밖 오류)를 그대로 돌려준다.
2. `remote-group.ts`: 이 컴퓨터와 M의 project 목록(각각 통째로 받은 것)을 `matchProjects`로 묶어 `same`, `remoteOnly`(M에만 있고 id가 있다), `suggested`(remote만 같다)를 만든다. M의 record에 `identity` 칸이 없으면(옛 판) null로 본다. 읽기가 실패한 쪽은 이전 값을 그대로 두고 아무것도 지우지 않는다.
3. M의 창의 project 목록에서:
   - `same`: 줄에 "Also on this computer". 열면 기계마다 session 목록을 나란히(M, 이 컴퓨터). 두 목록은 각자의 core에서 읽고 합치지 않는다. 이 컴퓨터의 session을 누르면 이 컴퓨터의 창에서 연다(`shell:machines-open`). 이름은 각 기계의 title이다(다르면 둘 다).
   - `remoteOnly`: "Not on this computer" [Clone here] → `shell:machines-clone-here { url: remote.url, identity, title }`. `git_auth`면 "Run `<command>` in a terminal on this computer, then try again". `remote`가 없으면 단추 없이 "Not on this computer. It has no git remote to clone from."
   - `suggested`: "Looks like <이 컴퓨터의 title>"와 "Set it up on one computer and commit .lophn-project.json. The other links after git pull." M의 저장소에는 쓰지 않는다(정책 14). 이 컴퓨터 쪽 [Set up]은 두지 않는다: 이 컴퓨터의 창에서 한다.
4. 이 컴퓨터 쪽 읽기가 실패하거나 M이 끊기면 마지막 목록과 묶음을 그대로 보인다.
5. 문구 key를 `remote-desk.ts`에 더하고, `desktop-remote`의 다른 기계 창 gallery page의 fake source로 세 상태를 그린다.

## 끝남

- `npm run check`가 통과한다.
- `npm run wireframes`가 되고 다른 기계 창의 gallery page가 세 상태(같은 project, M에만 있음, remote만 같음)를 그린다.
- 위험 test: "`shell:machines-this-read`는 `project.list`와 `ListSessions` 밖의 route를 거절하고 이 컴퓨터의 창에서 온 요청도 거절한다"(권한 경계. `desktop-remote`의 IPC 거절 test와 같은 층에 표 하나로).
- 남지 않음: 없음.
- flows catalog: 같은 project 묶기와 [Clone here] 줄, IPC 두 줄(area `ipc`, `shell-desktop`)을 `project-docs/flows/`에서 고친다(자기 줄만). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 고친 `desktop-remote`의 file과 줄(넘길 줄), 개발 core 둘(`npm run dev:core`와 `remote-desk-windows`가 더한 두 번째 data root)로 같은 임시 저장소를 두 곳에 등록해 묶음과 [Clone here]를 본 결과, lead가 고칠 목록(`architecture/project-identity.md`의 다른 기계 창 절, `architecture/remote.md`의 IPC 두 줄).

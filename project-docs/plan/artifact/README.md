# artifact: agent가 쓴 HTML 결과를 봉한 탭으로 본다

- 목표:
  - project마다 lophn data 자리 `artifacts/<name>/`에 agent가 쓴 정적 HTML(artifact)을 봉한 view의 탭으로 그린다.
  - artifact 목록을 prompt와 화면에 싣고, 대화 글의 artifact path를 link로 그린다.
  - artifact에 단 annotation을 그 artifact를 쓴 session으로 보낸다.
- 재료:
  - `project-docs/products/roadmap/artifact.md`(이 계획의 본문): "무엇을 만드나" 1~5, "정한 것"
  - `project-docs/products/roadmap/domain.md`: "view와 artifact", "폴더"
  - `project-docs/architecture/annotation.md`, `architecture/browser-tab.md`(browser view registry, `frame-router.ts`), `architecture/place-session.md`(file 범위, rewind 기록), `architecture/appearance.md`
  - `../rea/project/desktop-embeded-browser`의 `src/main/sandbox.js`
- 범위 밖:
  - 이름 바꾸기(project → domain, PM → Domain Engineer, `<data>/projects/` → `<data>/domains/`). 계획 `domain-rename`이 한다.
  - tool을 부르는 view(live view). 인터넷 page의 annotation. 공유와 내보내기. 대화 안에 live로 끼워 그리기(roadmap "하지 않는 것").
  - e2e. 아래 "e2e" 절을 따른다.
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다. task id는 `af-`로 시작한다.
- 단위와 순서: `tasks/*.md`가 정한다.
  - wave 1:
    - `af-artifact-values`: protocol 공용 값
    - `af-sandbox`: 봉한 scheme, path 해석
    - `af-artifact-files`: 목록, source, watch
    - `af-artifact-ipc`: shell IPC·preload 계약, annotate 일반화
    - `af-annotation-target`: annotation target 계약
    - `af-file-scope`: `artifacts/`를 file 범위에
    - `af-wireframes`: Drafts
  - wave 2:
    - `af-artifact-view`: 봉한 view registry
    - `af-artifact-tab`: 탭
    - `af-artifact-sidebar`: sidebar 목록
    - `af-artifact-links`: 대화 link
    - `af-prompt-list`: prompt 목록
    - `af-guide`: 내장 guide
    - `af-annotation-receiver`: 받는 쪽
    - `af-annotation-read`: `annotations.get`
  - wave 3:
    - `af-gallery`: Drafts를 Screens로
    - `af-wording`: 문구 점검
  - **화면 task는 사람 리뷰를 기다린다.** wave 2의 `af-artifact-tab`, `af-artifact-sidebar`, `af-artifact-links`는 사람이 gallery의 Drafts(`af-wireframes`)를 보고 모양을 고른 뒤에 띄운다(ui-design skill). 나머지 wave 2 task는 기다리지 않는다.
- 시작 조건: 계획 `browser-tab`은 land하고 닫혔다(`77bfac2d1`). 이 계획은 다른 계획을 기다리지 않는다. `domain-kinds`, `domain-tools`, `domain-place`와 같이 돈다.

## 정한 것

roadmap `artifact.md`와 `domain.md`의 "정한 것"은 다시 적지 않는다. 지금 코드 이름에 맞춘 것만 적는다.

- **자리:** `<data>/projects/<prj>/artifacts/<name>/`이다. lophn data의 project 층 자리이고, `domain-rename`이 `domains/`로 옮긴다.
- **file 범위**
  - 그 project의 PM과 project place의 Operator가 이 폴더를 쓴다. 지금 표는 `agent-roles/place/place-folders.ts`의 `placeScope` 하나다.
  - 쓰기는 `file.write`·`file.edit`이고 rewind된다. Deno 권한 목록도 같은 표로 만든다.
- **신원:** `{project, name}`이다. `domain-rename`이 `{domain, name}`으로 바꾼다.
- **annotation을 받는 쪽**
  - 그 artifact 폴더에 마지막으로 쓴 session이다. rewind 기록(`rewind_files`, checkpoint의 session)에서 뽑는다.
  - 기록이 없으면 그 project의 PM이 받는다.
  - 사람의 폴더에 있는 `.html`의 annotation도 그 project의 PM이 받는다.
- **`annotations.get`:** project place의 PM과 Operator에게 주고, agent의 project로 거른다.
- **사람의 폴더에 있는 `.html`:** 같은 봉한 view로 그린다. root는 그 파일이 든 폴더다(browser-tab roadmap 3번).
- **test(AGENTS.md "속도")**
  - 위험 test: 봉한 scheme의 path 해석이 `..`, 절대 path, symlink 탈출, realpath가 root 밖인 파일을 거절한다. artifact annotation이 다른 project의 session으로 가지 않는다. PM·Operator 밖의 role이 `artifacts/`를 쓰지 못한다.
  - 죽은 proxy 확인 같은 Electron을 띄우는 check는 만들기 전에 사람에게 묻는다.

## e2e

- 이 계획은 e2e를 돌리지도 고치지도 않는다.
- land는 `LOPHN_LAND_SKIP_E2E=1 project-docs/plan/tools/lead/land.sh artifact`로 돈다.
- `tests/e2e/annotation_test.ts`는 옛 `annotationSend` 입력(`app:`)을 쓰므로 `af-annotation-target` 뒤에 맞지 않는다. 고치지 않고 e2e 다시 쓰기 계획에 넘긴다.

## 같이 도는 계획

`domain-kinds`(`dk-`), `domain-tools`(`dt-`), `domain-place`(`dp-`)가 같이 돈다. 겹치는 file은 아래 표와 같다.
- running task끼리는 `status.py ready`가 가른다.
- land의 rebase 충돌은 두 쪽을 다 남긴다.
- 계획 사이 순서나 계약이 걸리면 planner session `lophn-7e`에게 SendMessage로 묻는다.

| file | 겹치는 계획 |
|---|---|
| `packages/core/agent-roles/place/place-folders.ts` | `domain-kinds`(`kinds.yaml`), `domain-place`(앱 place, skill 자리) |
| `packages/core/agent-roles/place/place-data.ts`, `place-info.ts` | `domain-kinds`(kind 글), `domain-place`(앱 place, 지도) |
| `packages/core/apps/annotations/*`, `packages/protocol/apps/annotation.ts` | `domain-place`(앱 annotation 받는 쪽을 PM으로) |
| `packages/shell/main/app-frame/annotate.ts` | `domain-tools`(app-frame bridge 쪽) |
| `packages/protocol/shell/workspace.ts`(tab kind), shell sidebar·add-tab menu·`use-tab-host-slices.ts`·`editor/model.ts`(`fileKindOf`) | `domain-kinds`(contexts 화면 지움), `domain-place`(앱 place 화면) |
| `packages/core/agent-roles/credentials.ts`(`annotations.get`) | `domain-place`(App Engineer 지움) |
| `packages/shell/main/app-frame/{annotate,registry}.ts`, `main/browser/frame-router.ts`, `main/desktop/{main.ts,wiring/app-views.ts,wiring/annotate.ts}` | `domain-tools`(`dt-shell-bridge`) |
| `packages/shell/renderer/workspace/{workspace.tsx,kinds/host.ts,use-tab-host-slices.ts,sidebar/project-sidebar.tsx}` | `domain-kinds`, `domain-place` |
| `packages/protocol/server/identity.ts`(credential 조건 `project`), `packages/core/agent-roles/credentials.ts` | `domain-place`(`dp-agent-roles-scope`). 두 계획이 같은 이름의 조건을 만들면 하나로 합친다 |
| `packages/core/main/daemon/wiring/router.ts`, `core/apps/annotations/*` | `domain-place`(`dp-place-events`: 앱 annotation 받는 쪽을 PM으로). artifact 쪽은 따로 둔 함수(`sendArtifact`, `deliverArtifact`)라 rebase 때 두 쪽을 다 남긴다 |
| `packages/core/lophn-agent/session/rewind/*` | `domain-place`(`dp-agents-core`) |
| `packages/core/agent-roles/roles/{guides.ts,*/prompt.md}`, `place-info.ts` | `domain-place`(`dp-agent-roles-prompt`) |
| `packages/core/main/agent-runtime/product-driver.ts`, `protocol/lophn-agent/input-tags.ts` | 모두 가능 |
| `packages/design/wording/catalog/*`, `tools/wireframes/pages/index.ts`, `tools/wireframes/{mock/mock-desktop.tsx,drafts/index.tsx}` | 모두 |

- **`app_engineer`:** `af-file-scope`와 `af-annotation-read`는 지금 `app_engineer` 줄을 본다. `domain-place`가 그 role을 지운다. 나중에 land하는 쪽이 맞춘다.

- **runtime 쓰기 권한:** `domain-kinds`와 `domain-place`가 agent runtime의 `<data>/projects` 쓰기(`draftRoot`)를 좁힌다. 그러니 그 넓은 권한에 기대지 않는다. 이 계획의 자리(`artifacts/`, project skill 폴더)는 runtime 쓰기 목록에 따로 더한다. 먼저 land한 쪽 위에서 맞춘다.

## lead가 할 일

- **wave 2를 띄우기 전에:** annotation target 계약과 봉한 scheme의 IPC가 brief와 같은지 본다.
- **merge 때마다:** wording 생성, gallery `pages/index.ts`, 등록 file을 고친다.
  - `af-artifact-values` 뒤: `packages/protocol/projects/mod.ts`에 `export * from "./artifact.ts"`를 더한다.
  - `af-gallery` 뒤: gallery `GROUPS`에 `artifactArea`를 더한다.
- **wave 2 뒤(손으로):** fake model server를 쓰고, 사람의 `~/.lophn`은 건드리지 않는다. `deno task dev`로 roadmap "끝남 기준"을 본다.
  - Operator가 쓴 artifact가 link로 열린다.
  - data 파일을 더하면 다시 load된다.
  - 밖 fetch가 실패한다.
  - annotation이 쓴 session으로 간다.
  - 다시 띄우면 탭이 돌아온다.
- **다 끝나면**
  - `project-docs/architecture/artifact.md`를 새로 쓴다.
  - `architecture/annotation.md`(target과 받는 쪽)를 고친다.
  - changelog 열린 판에 항목을 덧붙인다.
  - `products/roadmap/browser-tab.md`의 3번을 지운다.
  - `products/roadmap/artifact.md`는 남은 몫이 없으면 지운다.
  - worker 보고의 "무겁게 짠 것"과 "알려진 미완 동작"은 `issue` skill대로 올린다.
- **사람에게 묻는 것:** Electron을 띄우는 check를 새로 만들 때. 제품 동작이 roadmap과 달라져야 할 때.

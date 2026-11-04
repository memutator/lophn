# rd-artifacts

artifact를 domain 폴더에서 그릇 자리(`<data>/projects/<prj>/artifacts/`, `<data>/apps/<app>/artifacts/`)로 옮긴다. 신원은 `{domain, name}`에서 그릇과 이름이 된다. annotation, rewind 기록, 열린 tab을 migration한다.

- 단위: artifacts (wave 3)
- 선행: rd-commands.
- 소유(이 task만 고친다):
  - `packages/protocol/domains/artifact.ts`(새 자리로 옮긴다), `packages/protocol/apps/annotation.ts`
  - `packages/core/apps/annotations/**`, `packages/core/main/daemon/wiring/router.ts`, `packages/core/main/daemon/assembly.ts`, 새 wiring file(artifact 옮기기 data step)
  - `packages/core/lophn-agent/session/rewind/**`
  - `packages/core/agent-places/place/{artifact-list,place-folders,place-data,place-info}.ts` (artifact 줄만)
  - `packages/shell/main/artifact/**`, `packages/shell/main/workspace/kinds/artifact.ts`, `packages/shell/main/workspace/place-layout*.ts`
  - `packages/shell/ipc/{artifact,annotation}.ts`
  - `packages/shell/renderer/artifact/**`, `packages/shell/renderer/workspace/sidebar/artifact-panel.tsx`, `packages/shell/renderer/workspace/kinds/artifact.tsx`, `packages/shell/renderer/conversation/message-list/{artifact-text,chat-markdown}.tsx`
- 읽을 것:
  - architecture: `project-docs/architecture/artifact.md`, `project-docs/architecture/annotation.md`, `project-docs/architecture/workspace-layout.md`
  - 선례: `packages/core/apps/releases/schema.ts`(trigger를 내렸다 다시 만드는 step), `packages/core/main/daemon/wiring/assignment-file.ts`(data step)
  - 제품 결정: 계획 README 정한 것 4, 7
- 계약:
  - 쓰는 것: `placeDataFolder(root, place)`(`core/agent-places/place/data-folder.ts`), `domains` 표(mapping)
  - 내놓는 것: artifact 신원 `{project, name} | {app, name}`, layout `schema_version` 9

## 할 일

1. 자리: `<그릇 자리>/artifacts/<name>/index.html`. 그릇 session의 file 범위에 `artifacts/`를 연다(`place-folders.ts`, 지금 domain 폴더를 열던 쪽에게, `workflows/`와 같은 꼴). place 정보의 artifact 목록(`artifact-list.ts`, `place-info.ts` `artifactLines`)과 `place-data.ts`의 domain 폴더 만들기를 바꾼다.
2. 신원: protocol artifact 신원, IPC(`shell/ipc/artifact.ts`), shell main list·source·registry, renderer tab key `artifact:<project|app>:<id>:<name>`, 채팅 link 정규식(`artifact-text.tsx`, `artifactMentions`)을 그릇과 이름으로.
3. annotation: `annotation_batches`를 다시 만드는 schema step(새 id). artifact 행은 `domains` join으로 `app`이나 `project`를 채운다. 받는 쪽(`router.ts` `ownerOfDomain`, `deliverArtifact`)은 그 그릇 place의 lophn session이다(last writer → 입력 session → 새 session 순서는 그대로).
4. rewind: schema step이 `rewind_files.root`의 `.../domains/<dom>/`를 그 domain의 그릇 자리로 바꾼다(trigger를 내렸다 다시 만든다). 옛 checkpoint를 되돌리면 옛 자리에 쓰는 틀린 되돌리기를 막는다. `lastArtifactWriter`를 새 root로.
5. data step(새 wiring, `assembly.ts`에 등록): `domains/<dom>/artifacts/*`를 그 그릇 자리로 옮긴다. 같은 그릇에서 이름이 겹치면 domain 이름이 앞서는 쪽이 이름을 갖고 다른 쪽은 `<name>-<domain 이름>`이다. `<data>/shell/places/*.json` v8의 artifact tab을 새 신원으로 다시 쓰고 v9로 적는다. shell은 v9만 읽는다(판만 올리면 열린 tab이 다 사라진다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "artifact 옮기기가 file을 잃지 않는다(이름 겹침 포함)"
  - "rewind root step 뒤 옛 checkpoint 되돌리기가 새 자리에 쓴다"
- 남지 않음: `grep -rn "domainArtifactsFolder\|DOMAIN_ARTIFACTS_FOLDER\|ownerOfDomain" packages`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.

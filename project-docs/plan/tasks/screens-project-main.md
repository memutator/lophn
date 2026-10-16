# screens-project-main

shell main 쪽 파일 탭 지원을 새로 짠다. contract-shell이 고정한 파일 IPC(`shell:file-*`)의 handler를 `main/editor/`에 구현한다: 경로 하나를 읽고 쓰는 얇은 adapter(project 밖 경로도 허용, 충돌은 디스크 내용 hash 비교만), 폴더 목록, 이미지·pdf 바이트 읽기, 이름 바꾸기, 지우기, 밖에서 바뀐 파일 감시, 창 닫기 guard. 이어서 layout 파일의 탭 kind 값을 파일 경로·place에 놓인 agent 기준으로 맞추고, 현재 보기를 core로 relay하던 길을 지운다. 화면은 없다.

- 단위: screens-project (wave 3)
- 선행: 없음 (R1 remove-documents가 merge된 main에서 시작한다. `main/editor/{restore, create, place}.ts`는 이미 없다. shell-wiring이 `main.ts`를 `wiring/*.ts`로 쪼갰다)
- 소유(이 task만 고친다):
  - `packages/shell/main/editor/` 전체
  - packages/shell/main/workspace/의 file 가운데 `kinds/terminal.ts`(screens-project-terminal)와 `kinds/search.ts`(screens-project-search)를 뺀 것: `packages/shell/main/workspace/app-view-context.ts`, `packages/shell/main/workspace/current-view.ts`, `packages/shell/main/workspace/layout-store.ts`, `packages/shell/main/workspace/layout.ts`, `packages/shell/main/workspace/live-view.ts`, `packages/shell/main/workspace/restore.ts`, `packages/shell/main/workspace/schema.ts`, `packages/shell/main/workspace/view-publish.ts`, `packages/shell/main/workspace/kinds/agent.ts`, `packages/shell/main/workspace/kinds/agents.ts`, `packages/shell/main/workspace/kinds/app-panel.ts`, `packages/shell/main/workspace/kinds/context.ts`, `packages/shell/main/workspace/kinds/contexts.ts`, `packages/shell/main/workspace/kinds/document-editor.ts`, `packages/shell/main/workspace/kinds/kind.ts`, `packages/shell/main/workspace/kinds/registry.ts`, `packages/shell/main/workspace/kinds/values.ts`
  - `packages/shell/main/desktop/wiring/editor.ts`, `wiring/layout.ts` (shell-wiring이 만든 file. 이 단위 몫이다)
- 읽을 것:
  - spec: S4 6장("넣지 않는 것: 앱 화면의 상태" → 현재 보기를 prompt에 주지 않는다), S8 2장(Agent는 role과 place) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`, `place-session.md`
  - inventory: `I1.9#7`(현재 보기 relay 지우기), `I1.10#16`(version 준비와 형식 검사 지우기), `I2.9#1`(main 쪽 `kinds/agent.ts`·`agents.ts`·`kind.ts`·`schema.ts`), `I2.9#2`(layout 저장의 info 탭), `I2.9#3`(문서 탭 kind의 대상이 경로), `I2.10#16`(편집기 파일 adapter), `I2.10#17`(창 닫기 guard)
  - inventory(참고, 다른 단위 몫): `I2.10#9`(지침 파일 편집 길)의 main 쪽 `main/editor/instructions.ts`는 이 폴더에 있으므로 같이 고친다
  - 결정: `../README.md` 3장 #93(편집기의 파일 읽고 쓰기는 shell main이 직접, 충돌은 내용 hash로 안다), #57
  - 계약 file(읽는다): `packages/shell/ipc/files.ts`(채널 `shell:file-list`·`file-read`·`file-read-bytes`·`file-write`·`file-rename`·`file-delete`·`file-watch`·`file-changed`·`file-counts`·`file-close-request`·`file-close-answer`, 상한 `FILE_TEXT_MAX_BYTES`(8MiB)·`FILE_VIEW_MAX_BYTES`(64MiB), 오류 code `invalid_input | forbidden | not_found | conflict | unavailable | unsupported | too_large`), `packages/shell/ipc/folder-picker.ts`(`FILE_PICK_CHANNEL`은 platform 몫), `packages/shell/preload/files-api.ts`, `packages/shell/ipc/instructions.ts`(contract-agent-tools)
  - 지금 코드: `main/editor/file-adapter.ts`(615줄), `core-port.ts`(235줄: core `/v1/files/*` 호출), `ipc.ts`(246줄: 옛 `shell:editor-*`), `instructions.ts`(228줄), `close-guard.ts`(193줄); `main/workspace/{schema.ts(info 탭 `info/versions/contexts`), layout.ts, layout-store.ts, restore.ts, kinds/{agent, agents, app-panel, context, contexts, document-editor, kind, registry, values}.ts, current-view.ts(326줄), live-view.ts(307줄), view-publish.ts(205줄), app-view-context.ts(48줄)}`; `main/desktop/wiring/{editor, layout}.ts`
- 계약:
  - 쓰는 것: 위 계약 file. 채널 이름·schema·오류 code는 그대로 따른다. 경로는 절대 경로 문자열(최대 4096자)이고 정규화, 데이터 root의 `secrets.json` 거절(`forbidden`)은 handler 몫이다(contract-shell).
  - 내놓는 것:
    - `main/editor/file-adapter.ts`: `createFileAdapter(deps)`. list(폴더 한 단계, 이름순), read(UTF-8 글과 sha256 hash), readBytes(이미지·pdf. content type은 확장자로), write(`base_hash`가 지금 내용 hash와 다르면 `conflict`, `null`이면 새 파일이고 이미 있으면 `conflict`), rename(`to`가 이미 있으면 `conflict`), delete, watch(이 창이 보는 경로 전체를 통째로 바꾼다. 밖에서 바뀌면 `{path, hash | null}`을 알린다).
    - `main/editor/ipc.ts`: `registerFilesIpc`와 `removeFilesIpc`. 창 닫기 guard(`file-counts`, `file-close-request`, `file-close-answer`)도 여기서 이어 준다.
    - `wiring/editor.ts`: `register(ctx)`가 위 둘과 `close-guard`를 이어 준다. `main.ts` 조립 목록은 lead 것이다.
    - `main/workspace/kinds/*`: layout 파일의 탭 kind 값. 문서 탭은 `{ kind: "document_editor", key, path }`이고 Agent 탭은 place에 놓인 agent 기준이다.

## 할 일

1. `file-adapter.ts`를 다시 쓴다. 다음 규칙만 둔다.
   - 쓰기는 기대 hash(`base_hash`)가 디스크 내용의 hash와 같을 때만 한다. 다르면 쓰지 않고 `conflict`를 돌려준다. 파일이 아직 없으면 기대 hash가 `null`일 때만 만든다.
   - 쓰기는 같은 폴더의 임시 파일에 쓰고 rename으로 바꾼다(중간에 끊겨도 원본이 남는다). 쓰기가 끝난 hash를 돌려준다.
   - 8MiB가 넘는 글은 `too_large`, 글이 아닌 것은 `unsupported`. 이미지·pdf 바이트는 64MiB까지.
   - project 폴더 안/밖 판정은 두지 않는다(사람이 연 파일은 어디든 된다). 거절하는 것은 데이터 root의 `secrets.json`뿐이다.
   - 판 확정(`end`, `base_version`), 형식 검사(`validate`), 기록 확인, `against: "newest"` 충돌, 같은 `request_key` 재전송 조회(`lookup`)는 새 IPC에 없으므로 만들지 않는다. 결과를 모르는 쓰기는 renderer가 `read`로 hash를 다시 읽어 판단한다.
   근거: `I2.10#16`, `I1.10#16`.
2. `core-port.ts`(core `/v1/files/*` 호출)와 core 통로 의존을 지운다. 어떤 경로든 main이 직접 읽고 쓴다. 근거: `I2.10#16`, 결정 #93.
3. `ipc.ts`를 새 채널로 다시 쓴다. 옛 `shell:editor-*` 채널 등록(`open`, `write`, `lookup`, `current`, `watch`, `release`, `restore`, `create`, `place`)은 걷는다. `file-watch`는 열린 파일 전체 목록을 통째로 바꾸고, 밖(다른 편집기, git)에서 바뀌면 `file-changed`로 알린다(디스크 mtime·hash 비교).
4. `close-guard.ts`를 새 상태 수에 맞춘다. 저장 중 수·쓰기 실패·결과 불명·충돌을 묻는 규칙은 그대로이고 판 확정 단계가 빠져 상태가 줄 뿐이다. 근거: `I2.10#17`.
5. `instructions.ts`를 줄인다. 문서 id로 풀던 것을 없애고, 전역 지침 경로(data root의 `LOPHN.md`)와 project 지침 경로(첫 등록 폴더 바로 아래 `LOPHN.md`)를 돌려준다. 앱 층은 없다. `ipc/instructions.ts`가 고정한 모양에 맞춘다. 근거: `I2.10#9`.
6. `main/workspace/`를 고친다.
   - `schema.ts`의 정보 패널 탭을 `info | contexts`로(versions 없음). 근거: `I2.9#2`.
   - `kinds/document-editor.ts`·`values.ts`: 문서 registry id(`doc_…`)와 `documentExists` 확인을 없애고 경로 문자열(길이 한도만)로 바꾼다. 복원(`restore.ts`)은 경로가 가리키는 파일이 없어도 탭을 지키고 열 때 안내하게 한다(placeholder로 바꾸지 않는다. 지워진 파일은 탭이 열릴 때 "없음" 안내를 보인다). 근거: `I2.9#3`.
   - `kinds/agent.ts`, `kinds/agents.ts`, `kind.ts`: `asg_…` assignment id와 withdraw 검사를 없애고 place에 놓인 agent(contract-calls-places의 `AgentRef` 또는 agent id)를 가리킨다. role 이름 `context_engineer`는 `project_manager`로. 근거: `I2.9#1`.
   - `kinds/contexts.ts`, `kinds/context.ts`는 그대로 두되 `kinds/search.ts`와 얽힌 것은 건드리지 않는다.
7. 현재 보기 relay를 지운다. `current-view.ts`, `live-view.ts`, `view-publish.ts`, `app-view-context.ts`와 `wiring/layout.ts`의 `liveView`·`VIEW_HINT_CHANNEL` 처리·`bindReceive`를 걷는다. `ipc/workspace.ts`의 `VIEW_HINT_CHANNEL`과 `preload/workspace-api.ts`의 힌트 보내기(contract-shell), renderer의 `workspace/view-hint.ts`(screens-project-window)는 이 task가 고치지 않는다. 지울 때 그쪽이 보내는 호출이 남아도 type check가 깨지지 않게 main의 handler만 지운다. 앱 view의 `view_session` query(`main/app-frame/app-protocol.ts`)는 screens-app-space·app-calls 몫이다. 근거: `I1.9#7`.

- (lead가 더함, screens-project-editor가 넘긴 것) shell main의 파일 handler(`shell:file-read`·`file-read-bytes`)는 `modified_at`(epoch ms)을 채운다(`packages/shell/ipc/files.ts`, `387b6040`). `editor/instructions.ts`의 `open`이 지침 파일의 절대 경로 `path`를 채운다(`InstructionsOpened.path`, 지금은 optional이다. 채운 뒤 lead에게 필수로 바꾸기를 요청한다). layout 탭 `document_editor`는 `path`를 싣는다(`protocol/shell/workspace.ts`).

- (lead가 더함, screens-project-window가 넘긴 것) renderer 파일 탭 key는 이제 절대 경로다. `main/workspace/schema.ts`의 `tabKey` 검사가 `/`를 받게 한다. schema가 `information_panel`을 아직 요구해 renderer가 상수 `{open:false, tab:"info"}`를 보낸다. schema에서 걷고 `renderer/workspace/layout-map.ts`의 그 한 줄도 같이 걷는다(추가 소유, lead 승인). Agent 탭은 `agent` 필드(비어 있지 않은 id 문자열)를 쓰고 `assignment`·`hint`는 없다. main 쪽 모양을 이에 맞춘다.

- (lead가 더함, platform-desktop이 넘긴 것) `shell:file-list` handler는 이 task가 `main/editor/`에 짓는다(platform-desktop의 brief에 있던 항목을 옮김). 폴더 먼저, 그다음 이름순(lead 결정), 연결 폴더 밖 경로 거절, 경로 정규화와 밖으로 나가는 symlink 거절. `registerFilesIpc`를 내놓으면 lead가 `main.ts` 조립에 한 줄 넣으니 "등록할 것"에 적는다.

## 끝남

- `deno task check`가 통과한다. (`packages/shell/main`의 check script도 통과한다.)
- 위험 test: "디스크 내용이 기대 hash와 다르면 쓰지 않고 conflict를 돌려주며 원본 파일은 바뀌지 않는다. 쓰기 도중 끊겨도 원본이나 새 내용 둘 중 하나가 온전히 남는다" — `main/editor/file-adapter_test.ts`(임시 폴더, 실패 주입, hash 표 하나).
- 남지 않음: `grep -rn "core-port\|createLiveView\|documentExists\|asg_\|context_engineer\|shell:editor-" packages/shell/main/editor packages/shell/main/workspace packages/shell/main/desktop/wiring/editor.ts packages/shell/main/desktop/wiring/layout.ts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `main.ts` 조립 목록에서 `editor`·`layout` register가 새 시그니처로 불리는지(lead). `ipc/workspace.ts`의 `VIEW_HINT_CHANNEL`과 `preload/workspace-api.ts` 힌트 보내기는 contract 단위 파일이므로 쓰이지 않게 된 것으로 보고만 한다.
- 안 쓰게 된 export: `main/editor/core-port.ts` 전체의 export, `ipc/editor.ts` 전부와 `preload/editor-api.ts`(contract-shell 소유. cleanup이 지운다), `VIEW_HINT_CHANNEL`
- 정한 것: 파일 감시를 어떻게 하는지(fs.watch, 폴링 중 무엇), 지우기가 영구 삭제인 것(wireframe의 확인 문구는 "This removes the file from disk"), 임시 파일 이름 규칙, 지워진 파일을 가리키는 저장된 탭을 열 때의 처리
- 계약 바꾸기 요청(wave 3): `shell:file-*`에 모자란 것이 있으면 여기 적는다

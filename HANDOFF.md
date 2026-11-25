# Handoff: Workflow Export 및 원격 Workflows 탭 수정

## 배경 및 증상

1. **Workflow Export 실패**
   - 프로젝트 사이드바 Workflows 탭에서 `Export to other machine…` 실행 시 바로 실패.
   - 추가로 256 KiB를 넘는 workflow는 `dispatch.ts`의 기본 JSON body 상한(`RPC_JSON_MAX_BYTES`)에 걸려도 구체적인 용량 초과 사유 없이 generic 에러로 떨어짐.
2. **Export 성공 후 원격 VM 프로젝트의 Workflows 탭이 빈 화면으로 멈춤**
   - `ExportWorkflow` / `ImportWorkflow`가 모두 HTTP 200으로 완료된 뒤, 원격 VM(`vmi3768829`)의 Lophn 프로젝트에서 오른쪽 사이드바 Workflows 탭을 열면 `Workflows` 제목만 보이고 본문이 계속 비어 있음(`loaded.state === "loading"` 영구 대기).

---

## 근본 원인 및 수정 내역

### 1차 커밋 (`8f267e3db`) — allowlist, body 크기 제한, 용량 초과 에러 전달

- **Shell main renderer allowlist 누락** (`packages/shell/main/desktop/core/allowlist.ts`)
  - `RENDERER_MEMORY_ROUTES`에 `"memory:workflows/export"`, `"memory:workflows/import"`, `"memory:workflows/set-defaults"` 추가.
  - 회귀 테스트 추가: `packages/shell/main/desktop/terminal-focus_test.ts`.
- **JSON body 상한 확대** (`packages/protocol/workflows/routes.ts`, `packages/protocol/remote/routes.ts`)
  - `workflowImport`에 `body_max_bytes: WORKFLOW_IMPORT_BODY_MAX_BYTES` (8 MiB raw의 base64 + 256 KiB envelope) 설정.
  - `machinesCall`에 `body_max_bytes: REMOTE_FRAME_MAX_BYTES` (16 MiB) 설정.
- **용량 초과 사유 명시 및 UI 전달** (`packages/core/server/request.ts`, `packages/core/server/dispatch.ts`, `packages/core/server/server.ts`, `packages/core/main/daemon/wiring/workflows-files.ts`, `packages/shell/renderer/workspace/source.ts`, `packages/shell/renderer/workspace/core-source.ts`, `packages/shell/renderer/workspace/sidebar/export-workflow-dialog.tsx`, `packages/design/i18n/catalog/workflow.ts`)
  - `dispatch.ts`/`request.ts`에서 body 크기 초과 시 `body exceeds the <N> byte limit for <resource>/<method>`와 `details: { reason: "body_too_large", max_bytes, route }` 반환, `server.ts`에서 `api/body_too_large` warn 로그 기록.
  - `workflows-files.ts`의 크기/파일 수 제한 오류에도 `details.reason` (`too_large`, `too_many_files`) 추가하고, `ExportWorkflowDialog`가 이를 전용 에러 문구로 표시하도록 연결.
  - 회귀 테스트 추가: `packages/core/remote/call_test.ts`.

### 2차 커밋 — 원격 Workflows 탭 `loading` 교착 및 부수 버그 수정

- **`EventClient` `inflight` 교착 해결** (`packages/shell/renderer/desktop/connection/events/client.ts`)
  - 기존 구현은 `connected` 상태에서 `inflight` 배열이 비어 있지 않으면 이미 걸려 있는 조건(`StateChanged`)으로 새로 붙는 구독자(`WorkflowPanel`)도 `inflight.at(-1)`에 줄 세워 두고 새 `watch`도 보내지 않았음. `unsubscribe()`마다 조건 변화 없이 `queueWatch()`를 호출해 `inflight`에 빈 항목을 쌓거나 `ready`가 어긋나면 이후 붙는 구독자가 영구적으로 `ready`를 못 받는 문제가 있었음.
  - `confirmedKeys` + `pendingWatches`로 전환해 이미 서버가 확인한 조건으로 붙는 새 구독자는 다른 `watch`를 기다리지 않고 즉시 `ready`를 받도록 수정. 조건이 바뀌지 않는 `unsubscribe()`에서는 불필요한 `watch`를 보내지 않고, `watch` 실패 시 `pendingWatches`에서 제거하며 `disconnect()` 시 `sentKey`/`confirmedKeys`도 함께 초기화.
  - 회귀 테스트 추가: `packages/shell/renderer/desktop/connection/events/waiting-store_test.ts`.
- **원격 링크 초기 연결 `ready` 소비 레이스 수정** (`packages/core/remote/links.ts`)
  - `connection`이 `state: "ready"`로 바뀔 때 동기 `onPeerReady`가 `CORE_APP_EVENTS`(`capability: null`) `watch`를 `link.asked`에 넣은 직후, 연결 자체의 초기 `ready` 이벤트가 `link.asked.shift()`로 그 항목을 꺼내며 초기 `ready`를 삼키던 문제를 `link.initialReady` 플래그로 분리해 해결.
- **Export 대상 프로젝트 자동 선택 race 수정** (`packages/shell/renderer/workspace/sidebar/export-workflow-dialog.tsx`)
  - `targetProjects`가 `sourceIdentity`보다 먼저 도착해도 사용자가 직접 드롭다운을 바꾸지 않았다면 `sourceIdentity`가 도착했을 때 같은 identity 프로젝트로 자동 선택되도록 `pickedProject` 상태 추가.
- **`DeskSwitcher` workflow 목록 자동 갱신** (`packages/shell/renderer/workspace/workspace-window.tsx`)
  - `useStateChanged(["projects"], () => readWorkflowsRef.current())`를 추가해 import 직후 이미 열려 있던 workspace의 `DeskSwitcher` workflow 목록도 갱신되도록 수정.

---

## 검증 결과

- TypeScript:
  - `npx tsc -p tsconfig.node.json --noEmit` 통과
  - `npx tsc -p packages/design/i18n/tsconfig.json --noEmit` 통과
  - `npx tsc -p packages/shell/renderer/tsconfig.json --noEmit` 통과
  - `npx tsc -p packages/shell/main/tsconfig.json --noEmit` 통과
- 단위 테스트:
  - `packages/core/remote/call_test.ts`, `packages/core/remote/host_test.ts`, `packages/core/workflows/service_test.ts`, `packages/shell/main/desktop/terminal-focus_test.ts`, `packages/shell/renderer/desktop/connection/events/waiting-store_test.ts`, `packages/shell/renderer/desktop/connection/events/acp-updates-store_test.ts` 전부 통과.
- 포맷/flow 검사: `prettier`, `node tools/flows.ts check` 통과.
- 참고: 루트 워크트리에 `packages/core/extensions` 폴더가 `project-docs/module-catalog.yaml`에 미등록 상태라 전체 `npm run check`는 `modules` 단계에서 중단됨(이번 변경과 무관).

---

## 다음 단계 / 배포 시 확인

1. **로컬 데스크톱(shell + core) 재빌드 및 재시작**: 2차 커밋의 `client.ts`·`links.ts` 수정이 반영되도록 로컬 shell과 core를 새 빌드로 띄워 원격 VM 프로젝트의 Workflows 탭이 바로 로드되는지 확인.
2. **원격 VM(`vmi3768829`) 업데이트**: 190 KiB 이상 workflow import 시 `body_max_bytes`(`WORKFLOW_IMPORT_BODY_MAX_BYTES`)가 적용되려면 받는 쪽 VM core도 최신 커밋 반영 필요.
3. **실제 Export 확인**: 로컬에서 원격 VM 프로젝트로 export 후, 원격 VM 프로젝트의 오른쪽 사이드바 `Workflows` 탭과 상단 `DeskSwitcher` 모두에 workflow가 표시되는지 확인.

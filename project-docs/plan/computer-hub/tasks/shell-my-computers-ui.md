# shell-my-computers-ui

- 단위: desktop shell settings/machines/workspace UI & i18n (wave 3)
- 선행: scheduler-and-hub-relay, terminal-clipboard-and-explorer, app-sync-policy-and-keep-both, folder-transfers-and-custody
- 목표: 제어 스위치 문구를 `"Allow controlling this computer"`로 일원화하고, Settings › Remote와 Sync를 통합한 **"My computers"** UI(Hub 토글, Two Promises 배지, per-app sync policy, 수신/전송·staged 설정 검토 및 `permission_rules` 사람 확인 적용, wireframes)를 구현하며, CallBlock/HandoffRow 첨부 표시와 offline `export-workflow-dialog.tsx`(`settings_export/send` 사용)를 완성한다.
- 소유:
  - `packages/shell/renderer/desktop/settings/`
  - `packages/shell/renderer/desktop/machines/`
  - `packages/shell/renderer/workspace/sidebar/export-workflow-dialog.tsx`
  - `packages/shell/renderer/workspace/sidebar/handoff-row.tsx`
  - `packages/shell/renderer/conversation/thread/call-block.tsx`
  - `packages/shell/renderer/desktop/workspaces/projects/handoff-source.ts`
  - `packages/shell/renderer/workspace/core-source.ts`
  - `packages/shell/renderer/workspace/source.ts`
  - `packages/design/i18n/catalog/workspace-settings.ts`
  - `packages/design/i18n/catalog/settings-sync.ts`
  - `packages/design/i18n/catalog/remote-desk.ts`
  - `packages/design/i18n/catalog/workflow.ts`
- 참조:
  - `packages/protocol/folder/transfers.ts`
  - `packages/protocol/folder/settings-export.ts`
  - `packages/protocol/folder/status.ts`
  - `packages/protocol/remote/routes.ts`
  - `packages/core/config/shell-settings.ts`
  - `project-docs/products/roadmap/computer-hub.md`

## 구현

1. **제어 문구 일원화 (`"Allow controlling this computer"`)**:
   - `packages/design/i18n/catalog/workspace-settings.ts` 및 관련 UI/카탈로그에서 기존 `"Allow typing in this computer's terminals"` 문구(과 동일 의미 한국어/영어 표현)를 **"Allow controlling this computer"**(한국어 카탈로그도 일관된 "이 컴퓨터 제어 허용" 톤)로 바꾼다.

2. **통합 Settings › "My computers" (`packages/shell/renderer/desktop/settings/`, `machines/`)**:
   - `computer-hub.md`의 wireframe 및 결정사항에 따라 기존 **Remote**와 **Sync** 설정을 하나의 **"My computers"** 설정 영역으로 합친다(사이드바 nav 레이블/라우팅 일관 정리, 기존 Settings 테스트/스냅샷 정합 유지).
   - **포함 섹션**:
     - **이 컴퓨터 & Hub 스위치**: `remote.enabled`, `remote.hub` 스위치(`remote.hub`가 켜지면 `/v1/*` hub relay listening 상태 표시), `remote.port`, `remote.relay`, `shell.terminal.osc52_clipboard` 제어 토글.
     - **기계 목록 & Two Promises 배지**: 각 컴퓨터의 온라인(`지금 바로` 가능) / 오프라인·Hub 보관(`켜지면 도착`) 상태와 `hub: true` 배지, `Allow controlling this computer` 토글, 초대/합류/제거.
     - **앱 데이터 동기화(`sync.app_policies`)**: `machine/environment`의 앱별 현재 정책(`computers` / `local` / `mixed`) 표시 및 사용자 덮어쓰기 드롭다운(`default` / `computers` / `local`), 충돌 전략 `"둘 다 남김(keep_both)"` / held 항목 표시 및 해결 버튼.
     - **받은 파일(`transfers/list` · `clear`) & 대기 중인 설정(`settings_export/staged` · `apply` · `dismiss`)**:
       - 받은 transfer 목록, `Held at @<Hub>` 상태, `inbox` 열기/정리 버튼.
       - 받은 `stg_` 설정/workflow 배치 검토 카드: 포함된 `agent`, `skill`, `project_command`, `workflow`, `permission_rules` 미리보기. **`permission_rules`나 `locked_fields`가 있으면 명시적 확인 체크박스/버튼(`confirm_permissions: true`)을 거쳐야 적용** 가능.

3. **첨부 표시 (`CallBlock`, `HandoffRow`, `handoff-source.ts`)**:
   - `attachments`가 달린 agent call 및 handoff note에 첨부 파일 이름·크기·`inbox/<trf>/` 전달 상태를 깔끔히 렌더링한다.

4. **Offline 지원 내보내기 다이얼로그 (`export-workflow-dialog.tsx`, `core-source.ts`)**:
   - `export-workflow-dialog.tsx`가 온라인 직접 `workflows/export` → `workflows/import`뿐 아니라 **`settings_export/send`**(오프라인 시 hub 보관 `held_at_hub` 포함)를 써서 대상 컴퓨터(온라인·오프라인 모두)로 workflow와 agent/skill/project_command/permission_rules를 보낼 수 있게 바꾼다. (기존 `workflows/export|import` 호출을 제거해 Wrap-up에서 해당 구식 route를 정리할 수 있게 한다.)

## 완료 기준

- `node packages/shell/renderer/build.ts` 성공
- `node --test packages/shell/renderer/**/*_test.ts` 통과
- `node tools/check-i18n.ts` (있다면) 및 `npm run check` 통과

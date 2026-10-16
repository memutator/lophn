# 소유 지도

어느 단위가 어느 path를 고칠 수 있는지 정한다. 오케스트레이터는 이 지도로 worker에게 소유를 나눠 준다. merge 전에는 worker가 소유 밖 file을 고쳤는지 본다(`orchestrator.md` 5장).

## 규칙

- 한 path는 한 단위만 가진다. 앞쪽이 같은 path가 둘이면 더 긴 path가 이긴다.
  - 예: `packages/core/apps/`는 app-calls지만 `packages/core/apps/tickets/`는 coding-agent다.
- 지울 path도 그 단위의 소유다. 새 file은 그 폴더를 가진 단위의 것이다.
- 소유는 wave를 따라 넘어간다.
  - wave 2의 contract 단위가 가진 path(protocol, port, shell IPC, preload)는 계약 고정 뒤 lead만 고친다.
  - wave 1 단위가 가졌던 path는 그 단위가 merge되면 wave 3 단위가 이어받는다.
  - 예: `packages/base/redaction/`은 wave 1에 remove-documents, wave 3에 platform의 것이다.
- 지도에 없는 path가 필요하면 worker는 고치지 않고 보고한다. 오케스트레이터가 소유를 정해 이 지도를 고친다.
- "(확인)"이 붙은 path는 지금 코드에서 이름이 다를 수 있다. 그 단위의 brief가 실제 path로 바로잡는다.
- **wave는 차례로 연다.**
  - wave N은 wave N-1의 task가 모두 merge된 뒤에 연다.
  - wave 3은 계약 고정 commit도 있어야 연다.
  - wave 안에서는 선행과 소유가 허락하는 만큼 동시에 돈다.
- **wave 1 덜어내기 task는 brief의 "추가 소유"도 고칠 수 있다.** 추가 소유는 지운 것을 쓰던 곳이다.
  - 등록 file에서 지운 것을 가리키는 줄을 빼는 것도 된다.
  - 다른 wave가 돌지 않는 동안이라 부딪치지 않는다.
- **wording catalog는 공용이다.** 대상은 `packages/design/wording/catalog/`과 영역별 `*.placeholders.ts`다.
  - key를 더하는 일은 어느 task나 한다. merge 충돌은 lead가 푼다.
  - key를 지우거나 이름을 바꾸는 일은 그 영역의 단위만 한다(wording-split brief의 영역 표).
  - 이 path는 겹침 검사에서 뺀다. wave 1~3 task가 `packages/design/wording/`에서 고치는 것은 key 더하기와 자기 영역 key 지우기뿐이다.
- **순서로 나눠 쓰는 file.** 아래 file은 여러 단위가 고친다. 선행으로 순서를 걸고, 뒤의 task가 앞의 결과 위에서 고친다.
  - `packages/shell/main/build.ts`(entry 줄): screens-data-secret-input → platform-desktop → screens-app-space-main
  - `packages/shell/main/package.json`(check 인자): check → screens-app-space-main
  - `packages/shell/renderer/build.ts`(entry 줄): ui-chrome-components → screens-data-secret-input
  - `packages/shell/renderer/desktop/dev-seed.ts`(조립 줄): screens-project-sidebar → screens-project-editor
  - `packages/shell/renderer/workspace/workspace.tsx`(한 줄씩): screens-project-window → screens-project-reactions → screens-contexts-overview
  - `packages/shell/renderer/workspace/kinds/context.tsx`(한 줄): screens-project-window → screens-contexts-views

## lead (오케스트레이터)

- `deno.json`, `deno.lock`, 각 package의 `deno.json`(의존성은 worker가 보고하고 lead가 더한다. `deno.json`의 `tasks`는 wave 0에 check가 고친다)
- `packages/protocol/mod.ts`, `packages/protocol/registry.ts`, `packages/protocol/*/mod.ts`의 목록
- `packages/protocol/base/`, `packages/protocol/client/`
- core 조립: core-wiring-split 뒤의 `packages/core/main/daemon/core.ts`, `assembly.ts`, `wiring/context.ts`, `registration.ts`(등록 key 목록)
- shell main 조립: shell-wiring 뒤의 `packages/shell/main/desktop/main.ts`, `packages/shell/main/desktop/wiring/context.ts`
- preload를 모으는 file: `packages/shell/preload/shell.ts`, `shell-api.ts`, `app.ts`
- route 목록: `packages/protocol/*/registry.ts`
- wording 영역 목록과 합치는 file: `packages/design/wording/en.ts`, `packages/design/wording/placeholders.ts`
- `tools/wireframes/`(아래 단위가 가진 폴더 밖: `pages.ts`, `build.ts`, `gallery.tsx`, 공용 compositions file)
- `AGENTS.md`, `project-docs/`

## wave 0: 바닥

### check
- `tools/check.ts`
- `tools/check-deps.ts`
- `tools/deps-blueprint.ts`
- `tools/deps-imports.ts`
- `tools/deps-workspace.ts`
- `tools/worktree-prep.ts`
- `packages/design/style-check/`
- `packages/shell/main/package.json`
- `tools/check-style.ts`
- `tools/check-wording.ts`
- `deno.json`의 `tasks`

### core-wiring
- `packages/core/main/daemon/`
- `packages/core/server/credentials.ts`
- `packages/core/storage/ledger/writer-assembly.ts`

### shell-wiring
- `packages/shell/main/desktop/main.ts`
- `packages/shell/main/desktop/wiring/`

### wording-split
- `packages/design/wording/`

## wave 1: 덜어내기

- wave 1 brief의 "추가 소유"는 lead가 승인했다(2026-10-16). 그 task는 지운 것을 쓰던 곳을 저장소 어디서든 고칠 수 있다. 다만 지운 것을 가리키는 줄만 고친다. brief에 없던 file이 더 걸리면 같은 규칙으로 고치고 보고에 적는다. 같은 wave에서 두 task가 같은 file을 고쳐 rebase가 부딪치면 lead가 푼다.

### remove-documents
- `packages/core/projects/file-tracking/`
- `packages/core/projects/versions/`
- `packages/core/projects/series/`
- `packages/core/projects/addressing/`
- `packages/core/projects/formats/`
- `packages/core/projects/outline-and-search/`
- `packages/core/main/worker/coordinator-entry.ts`
- `packages/core/main/worker/preparation-entry.ts`
- `packages/protocol/projects/address.ts`
- `packages/protocol/projects/document-events.ts`
- `packages/protocol/projects/document-files.ts`
- `packages/protocol/projects/documents.ts`
- `packages/protocol/projects/format-bounds.ts`
- `packages/protocol/projects/format-extraction.ts`
- `packages/protocol/projects/formats.ts`
- `packages/protocol/projects/guides.ts`
- `packages/protocol/projects/history.ts`
- `packages/protocol/projects/outline-entries.ts`
- `packages/protocol/projects/outline.ts`
- `packages/protocol/projects/sections.ts`
- `packages/protocol/projects/series-values.ts`
- `packages/protocol/projects/series.ts`
- `packages/protocol/projects/uploads.ts`
- `packages/protocol/projects/versions.ts`
- `packages/base/redaction/`
- `packages/sdk/format-document/`
- `packages/sdk/cap-save/`
- `packages/shell/renderer/editor/compare/`
- `packages/shell/renderer/editor/versions/` (확인)
- `packages/shell/renderer/editor/problems-gutter/` (확인)
- `packages/shell/renderer/editor/link-picker/`
- `packages/shell/renderer/workspace/tracking/`
- `packages/shell/renderer/desktop/lophn-space/documents/`
- `packages/shell/renderer/desktop/lophn-space/series/`
- `packages/shell/renderer/desktop/lophn-space/organize/`
- `packages/shell/main/editor/restore.ts`
- `packages/shell/main/editor/create.ts`
- `packages/shell/main/editor/place.ts`
- `packages/protocol/projects/openable-format.ts`(새로)
- `tools/questions/option-actions.ts`(새로)

### remove-platform
- `packages/core/notifications/`
- `packages/protocol/notifications/`
- `packages/core/install-and-update/`(단일 instance lock과 data root 검사는 남긴다)
- `packages/protocol/install-and-update/`
- `packages/core/storage/migration/backup.ts` (확인)
- `packages/core/storage/migration/backup-reads.ts` (확인)
- `packages/core/storage/migration/restore.ts` (확인)
- `packages/core/main/worker/restore-entry.ts`
- `packages/core/secrets/export.ts`
- `packages/core/secrets/exchange.ts` (확인)
- `packages/shell/renderer/desktop/lophn-space/things-to-confirm/`
- `packages/shell/renderer/desktop/lophn-space/settings/backup/`
- `packages/shell/renderer/desktop/lophn-space/settings/update/`
- `packages/shell/renderer/desktop/lophn-space/settings/notifications/`
- `packages/shell/renderer/desktop/notification-chip/`
- `packages/shell/main/desktop/os-notification.ts`
- `packages/shell/main/desktop/core/restore.ts`
- `packages/shell/main/desktop/core/restore-ipc.ts`
- `packages/shell/ipc/notifications.ts`
- `packages/shell/ipc/restore.ts`
- `packages/shell/ipc/update.ts`
- `packages/shell/preload/restore-api.ts`
- `packages/core/main/daemon/wiring/notifications.ts`
- `packages/core/main/daemon/wiring/storage-restore.ts`
- `packages/shell/main/desktop/core/update-ipc.ts`
- `packages/shell/main/desktop/wiring/restore-update.ts`

### remove-app-extras
- `packages/core/apps/automations/`
- `packages/core/apps/agent-context/`
- `packages/core/main/worker/export-entry.ts`
- `packages/protocol/apps/agent-context.ts`
- `packages/protocol/lophn-agent/tool-documents.ts`
- `packages/protocol/lophn-agent/visuals.ts`
- `packages/protocol/lophn-agent/visual-source.ts`
- `packages/protocol/lophn-agent/visual-specs.ts`
- `packages/core/lophn-agent/tools/visuals/`
- `packages/core/lophn-agent/tools/series-next-tool.ts` (확인)
- `packages/core/lophn-agent/tools/tool-documents.ts` (확인)
- `packages/sdk/cap-schedule/screen-context.ts`
- `packages/shell/renderer/app-frame/app-detail/automations/`
- `packages/shell/renderer/app-frame/app-detail/tasks/`
- `packages/shell/renderer/app-frame/app-detail/data/`
- `packages/core/lophn-agent/tools/bundles/document.ts`
- `packages/core/lophn-agent/tools/bundles/format.ts`
- `packages/core/lophn-agent/tools/bundles/app-context.ts`
- `packages/core/main/daemon/wiring/apps-export.ts`
- `tools/bundles/handlers.ts`(새로)

## wave 2: 계약

계약 단위는 type, schema, 상수, type-only port만 둔다. 구현은 넣지 않는다(ui-chrome만 예외).

### contract-events
- `packages/protocol/events/`
- `packages/protocol/server/`(`question-option.ts` 제외)
- `packages/shell/ipc/core.ts`
- `packages/shell/ipc/core-api.ts`
- `packages/core/events/ports.ts`
- `packages/shell/preload/core-api.ts`

### contract-approvals
- `packages/protocol/approvals/`
- `packages/protocol/apps/grants.ts`
- `packages/protocol/apps/permissions.ts`
- `packages/protocol/lophn-agent/decision-values.ts`
- `packages/protocol/shell/confirmation.ts`
- `packages/shell/ipc/confirmation.ts`
- `packages/shell/ipc/confirmation-channels.ts`
- `packages/shell/ipc/windowless-confirmation.ts`
- `packages/core/approvals/ports.ts`
- `packages/shell/preload/confirmation.ts`
- `packages/shell/preload/confirmation-open.ts`
- `packages/shell/preload/confirmation-ended.ts`

### contract-calls-places
- `packages/protocol/lophn-agent/handoffs.ts`
- `packages/protocol/lophn-agent/assignments.ts`
- `packages/protocol/lophn-agent/assignment-values.ts`
- `packages/protocol/lophn-agent/sessions.ts`
- `packages/protocol/lophn-agent/agents.ts`
- `packages/protocol/lophn-agent/agent-values.ts`
- `packages/protocol/lophn-agent/reverts.ts`
- `packages/protocol/lophn-agent/runs.ts`
- `packages/protocol/lophn-agent/run-values.ts`
- `packages/protocol/lophn-agent/run-reads.ts`
- `packages/protocol/lophn-agent/run-wait.ts`
- `packages/protocol/lophn-agent/run-blobs.ts`
- `packages/protocol/lophn-agent/messages.ts`
- `packages/protocol/lophn-agent/scope.ts`
- `packages/protocol/projects/projects.ts`
- `packages/protocol/projects/project-routes.ts`
- `packages/protocol/projects/places.ts`
- `packages/protocol/projects/context-api.ts`
- `packages/protocol/projects/context-api-content.ts`
- `packages/protocol/projects/context-contract.ts`
- `packages/protocol/projects/context-work.ts`
- `packages/protocol/projects/search.ts`
- `packages/protocol/projects/values.ts`
- `packages/protocol/projects/files.ts`
- `packages/protocol/projects/file-values.ts`
- `packages/protocol/projects/read.ts`
- `packages/protocol/projects/read-values.ts`
- `packages/protocol/projects/outline-markdown.ts`
- `packages/core/lophn-agent/ports.ts`
- `packages/core/projects/ports.ts`
- `packages/protocol/projects/outline-markdown-sha256.ts`
- `packages/core/router/ports.ts`
- `packages/protocol/lophn-agent/agent-sessions.ts`(새로)
- `packages/protocol/lophn-agent/calls.ts`(새로)
- `packages/protocol/lophn-agent/inputs.ts`(새로)
- `packages/protocol/lophn-agent/operators.ts`(새로)
- `packages/protocol/lophn-agent/places.ts`(새로)
- `packages/protocol/lophn-agent/session-rewinds.ts`(새로)
- `packages/protocol/lophn-agent/turn-blobs.ts`(새로)
- `packages/protocol/lophn-agent/turn-reads.ts`(새로)
- `packages/protocol/lophn-agent/turn-values.ts`(새로)
- `packages/protocol/lophn-agent/turns.ts`(새로)
- `packages/protocol/projects/context-drafts.ts`(새로)
- `packages/protocol/projects/context-outlines.ts`(새로)
- `packages/protocol/projects/project-api.ts`(새로)
- `packages/protocol/projects/project-folders.ts`(새로)
- `packages/protocol/projects/project-search.ts`(새로)

### contract-agent-tools
- `packages/protocol/lophn-agent/tool-calls.ts`
- `packages/protocol/lophn-agent/tool-values.ts`
- `packages/protocol/lophn-agent/commands.ts`
- `packages/protocol/lophn-agent/command-filter.ts`
- `packages/protocol/lophn-agent/questions.ts`
- `packages/protocol/lophn-agent/question-submission.ts`
- `packages/protocol/lophn-agent/question-text.ts`
- `packages/protocol/lophn-agent/message-content.ts`
- `packages/protocol/lophn-agent/instructions.ts`
- `packages/protocol/lophn-agent/skill-settings.ts`
- `packages/protocol/lophn-agent/mcp-settings.ts`
- `packages/protocol/lophn-agent/models.ts`
- `packages/protocol/lophn-agent/model-calls.ts`
- `packages/protocol/lophn-agent/model-call-values.ts`
- `packages/protocol/lophn-agent/model-picker.ts`
- `packages/protocol/lophn-agent/option-axes.ts`
- `packages/protocol/lophn-agent/provider-inputs.ts`
- `packages/protocol/lophn-agent/provider-values.ts`
- `packages/protocol/lophn-agent/providers.ts`
- `packages/protocol/lophn-agent/resolved-model.ts`
- `packages/protocol/lophn-agent/traces.ts`
- `packages/protocol/server/question-option.ts`
- `packages/shell/ipc/instructions.ts`
- `packages/shell/preload/instructions-api.ts`
- `packages/protocol/lophn-agent/ask-tool.ts`(새로)
- `packages/protocol/lophn-agent/context-text.ts`(새로)
- `packages/protocol/lophn-agent/input-tags.ts`(새로)
- `packages/protocol/lophn-agent/tool-catalog.ts`(새로)

### contract-app-calls
- `packages/protocol/apps/apps.ts`
- `packages/protocol/apps/app-start.ts`
- `packages/protocol/apps/blueprint.ts`
- `packages/protocol/apps/blueprint-commands.ts`
- `packages/protocol/apps/blueprint-json.ts`
- `packages/protocol/apps/blueprint-read.ts`
- `packages/protocol/apps/blueprint-schema.ts`
- `packages/protocol/apps/blueprint-scope.ts`
- `packages/protocol/apps/blueprint-types.ts`
- `packages/protocol/apps/blueprint-uses.ts`
- `packages/protocol/apps/blueprint-value.ts`
- `packages/protocol/apps/broker.ts`
- `packages/protocol/apps/channel.ts`
- `packages/protocol/apps/channel-client.ts`
- `packages/protocol/apps/channel-values.ts`
- `packages/protocol/apps/direct-socket.ts`
- `packages/protocol/apps/invocations.ts`
- `packages/protocol/apps/pair-routes.ts`
- `packages/protocol/apps/previews.ts`
- `packages/protocol/apps/runtime.ts`
- `packages/protocol/apps/socket-slots.ts`
- `packages/protocol/shell/app-bridge.ts`
- `packages/protocol/shell/app-bridge-types.ts`
- `packages/protocol/shell/app-frame.ts`
- `packages/sdk/blueprint/`
- `packages/shell/ipc/app-frame.ts`
- `packages/shell/ipc/app-window.ts`
- `packages/shell/ipc/app.ts`
- `packages/core/apps/ports.ts`
- `packages/shell/preload/app-api.ts`
- `packages/shell/preload/views-api.ts`
- `packages/shell/preload/app-window-api.ts`
- `packages/protocol/apps/annotation.ts`(새로)
- `packages/protocol/apps/blueprint`(새로)
- `packages/protocol/apps/calls`(새로)
- `packages/protocol/apps/calls/`
- `packages/protocol/apps/blueprint/`
- `packages/protocol/apps/annotation.ts`
- `packages/core/apps/annotations/ports.ts`
- `packages/shell/ipc/annotation.ts`

### contract-releases-problems
- `packages/protocol/apps/releases.ts`
- `packages/protocol/apps/packages.ts`
- `packages/protocol/apps/package-routes.ts`
- `packages/protocol/problems/`
- `packages/protocol/shell/feedback.ts`
- `packages/shell/ipc/feedback.ts`
- `packages/core/problems/ports.ts`
- `packages/protocol/apps/activation/`
- `packages/protocol/coding-agent/repair-context.ts`
- `packages/shell/preload/feedback-api.ts`

### contract-coding
- `packages/protocol/coding-agent/`
- `packages/shell/ipc/coding.ts`
- `packages/shell/ipc/terminal.ts`
- `packages/shell/preload/coding-api.ts`
- `packages/shell/preload/terminal-api.ts`

### contract-platform
- `packages/protocol/config/`
- `packages/protocol/secrets/`
- `packages/protocol/diagnostics/`
- `packages/protocol/storage/`
- `packages/protocol/supervision/`

### contract-shell
- `packages/protocol/shell/launch.ts`
- `packages/protocol/shell/workspace.ts`
- `packages/protocol/shell/screen-test.ts`
- `packages/shell/ipc/`(위 계약 단위가 가진 file 밖)
- `packages/shell/preload/`(remove-platform이 지운 file 밖)

### ui-chrome
- `packages/design/components/`
- `packages/design/fonts/`
- `packages/design/tokens.ts`
- `packages/design/theme.ts`
- `packages/design/base.css`
- `packages/shell/renderer/desktop/top-bar/`
- `tools/wireframes/frames/chrome/`
- `tools/wireframes/frames/vendors/`
- `packages/design/generated/`
- `packages/shell/renderer/build.ts`
- `packages/sdk/ui-filter/`
- `packages/sdk/ui-layout/`
- `packages/sdk/ui-overlay/`
- `packages/sdk/ui-state/`
- `packages/sdk/ui-action/command-button.tsx`
- `tools/wireframes/main.tsx`
- `tools/wireframes/frames/compositions/`

## wave 3: 구현

- wave 3 task가 자기 module의 내부 모양(type, 함수, 표)을 바꿔 다른 단위 file이 컴파일되지 않으면, 그 file에서 바꾼 것을 쓰는 줄만 최소로 맞춘다(동작은 옛것에 가깝게 두고, 새 모양에 맞추지 못하는 동작은 막힌 채로 둔다). 고친 줄은 보고의 "넘길 줄"에 적고, 그 file의 owner task가 제대로 짓는다. main은 늘 check가 통과해야 한다(lead 결정, 2026-10-16).
- wave 3 brief의 "추가 소유"는 lead가 승인했다(2026-10-16). 그 줄이 말한 범위(한 줄, 한 칸, 그 file만)만 고친다. wording 영역 file(`catalog/<영역>.ts`와 `.placeholders.ts`)은 여러 화면 task가 key를 더한다. 같이 돌아도 되고, rebase에서 부딪치면 lead가 두 쪽 key를 다 남기고 생성을 다시 돌린다.

### events
- `packages/core/events/`
- `packages/core/server/`
- `packages/core/storage/ledger/`
- `packages/core/main/daemon/wiring/server.ts`
- `packages/core/main/daemon/wiring/events.ts`

### approvals
- `packages/core/approvals/`
- `packages/core/apps/permissions/`
- `packages/core/lophn-agent/tool-judgment/`
- `packages/core/main/daemon/wiring/approvals.ts`

### router
- `packages/core/router/`(새로)
- `packages/core/lophn-agent/run-loop/`
- `packages/core/lophn-agent/waiting-and-recovery/`
- `packages/core/lophn-agent/tools/handoff/` (확인)
- `packages/core/main/daemon/wiring/router.ts`
- `packages/core/main/daemon/wiring/lophn-agent-handoff.ts`
- `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`
- `packages/core/lophn-agent/session/message-commands.ts`
- `packages/core/lophn-agent/session/request.ts`
- `packages/core/lophn-agent/waiting/`

### agent-tools
- `packages/core/lophn-agent/tools/`
- `packages/core/main/agent-runtime/`
- `tools/bundles/agent.ts`(새로)
- `tools/bundles/app-context.ts`(새로)
- `tools/bundles/document.ts`(새로)
- `tools/bundles/format.ts`(새로)
- `tools/bundles/metadata.ts`(새로)
- `tools/bundles/problem-interpretation.ts`(새로)
- `tools/bundles/question-actions.ts`(새로)
- `tools/bundles/sdk.ts`(새로)
- `tools/bundles/visual-view.ts`(새로)
- `tools/context-engineer-tools.ts`(새로)
- `tools/context-lookup-tools.ts`(새로)
- `tools/context-route-shapes.ts`(새로)
- `tools/context-search-tools.ts`(새로)
- `tools/context-search.ts`(새로)
- `tools/mod.ts`(새로)
- `tools/toolkit.ts`(새로)

### agent-definition
- `packages/core/lophn-agent/prompt-assembly/`
- `packages/core/lophn-agent/roles/`
- `packages/core/lophn-agent/agents/`
- `packages/core/lophn-agent/extensions/`
- `packages/core/lophn-agent/instructions/`
- `packages/core/lophn-agent/commands/`
- `packages/core/lophn-agent/models/`
- `packages/core/lophn-agent/providers/`
- `packages/core/lophn-agent/usage/`
- `packages/core/lophn-agent/observability/`
- `packages/core/lophn-agent/register.ts`
- `packages/core/lophn-agent/safety/`
- `packages/core/main/daemon/wiring/lophn-agent.ts`
- `packages/core/main/daemon/wiring/lophn-agent-extensions.ts`

### places-sessions
- `packages/core/lophn-agent/session/`
- `packages/core/lophn-agent/assignments/`
- `packages/core/projects/registry/`
- `packages/core/projects/contexts/`
- `packages/core/projects/mod.ts`
- `packages/core/projects/register.ts`
- `packages/core/lophn-agent/places/`
- `packages/core/projects/search/`
- `packages/core/main/daemon/wiring/projects.ts`
- `packages/core/main/daemon/wiring/lophn-agent-session.ts`

### app-calls
- `packages/core/apps/`
- `packages/core/main/app-supervisor/`
- `packages/sdk/cap-fs/`
- `packages/sdk/cap-net/`
- `packages/sdk/cap-secret/`
- `packages/sdk/cap-store/`
- `packages/sdk/ui-action/`
- `packages/shell/main/app-frame/app-call.ts`
- `packages/shell/main/app-frame/app-connection.ts`
- `packages/shell/main/app-frame/app-invoke.ts`
- `packages/shell/main/app-frame/app-ipc.ts`
- `packages/shell/main/app-frame/app-protocol.ts`
- `packages/shell/main/app-frame/binding.ts`
- `packages/shell/main/app-frame/blueprint-source.ts`
- `packages/core/apps/permissions/broker/`
- `packages/core/apps/permissions/flags.ts`
- `packages/sdk/cap-schedule/`
- `packages/sdk/cap-project/`
- `packages/core/main/daemon/wiring/apps.ts`
- `packages/core/main/daemon/wiring/apps-revert.ts`
- `packages/shell/main/desktop/wiring/app-calls.ts`
- `packages/sdk/cap-app-api`(새로)
- `packages/shell/main/app-frame/registry.ts`
- `packages/shell/main/app-frame/view-model.ts`
- `packages/shell/main/app-frame/view-ipc.ts`
- `packages/shell/main/app-frame/view-error.ts`
- `packages/shell/main/app-frame/visibility.ts`
- `packages/shell/main/app-frame/session-policy.ts`
- `packages/shell/main/app-frame/view-closed.ts`
- `packages/sdk/cap-app-api/`

### coding-agent
- `packages/coding-agent/`
- `packages/core/apps/tickets/`
- `packages/shell/main/terminal/`
- `packages/shell/terminal-host/`
- `packages/shell/main/desktop/coding-connection.ts`
- `packages/shell/main/desktop/coding-ipc.ts`
- `packages/core/main/daemon/wiring/apps-tickets.ts`
- `packages/shell/main/desktop/wiring/coding.ts`

### releases-problems
- `packages/core/apps/releases/`
- `packages/core/apps/data/`
- `packages/core/apps/packages/`
- `packages/core/problems/`
- `packages/core/main/worker/`
- `packages/sdk/cap-problem/`
- `packages/core/main/app-supervisor/data-runner.ts`
- `packages/core/main/daemon/wiring/problems.ts`
- `packages/core/main/daemon/wiring/problems-tests.ts`
- `packages/shell/main/desktop/wiring/feedback.ts`

### platform
- `packages/core/config/`
- `packages/core/secrets/`
- `packages/core/diagnostics/`
- `packages/core/supervision/`
- `packages/core/install-and-update/`
- `packages/core/storage/blobs/`
- `packages/core/storage/migration/`
- `packages/base/`
- `packages/shell/main/desktop/`
- `packages/core/main/worker/io.ts`
- `packages/core/main/worker/maintenance-entry.ts`
- `tools/package-linux.ts`
- `tools/verify-linux-install.ts`
- `packages/shell/main/entry.ts`
- `packages/shell/main/build.ts`
- `packages/core/main/daemon/wiring/storage.ts`
- `packages/core/main/daemon/wiring/supervision.ts`
- `packages/core/main/daemon/wiring/diagnostics.ts`
- `packages/core/main/daemon/wiring/config.ts`
- `packages/core/main/daemon/wiring/secrets.ts`
- `packages/shell/main/desktop/wiring/core.ts`
- `packages/shell/main/desktop/wiring/desktop.ts`

### annotation
- `packages/core/apps/annotations/`(새로)
- `packages/shell/main/app-frame/annotate.ts`(새로)
- `packages/shell/main/app-frame/capture.ts`(새로)
- `packages/core/main/daemon/wiring/annotations.ts`
- `packages/shell/main/desktop/wiring/annotate.ts`
- `packages/shell/preload/annotate-api.ts`
- `packages/shell/preload/annotate/`

### screens-data
- `packages/shell/renderer/desktop/connection/`
- `packages/shell/renderer/overlay/`
- `packages/shell/renderer/confirmation/`
- `packages/shell/main/confirmation/`
- `tools/wireframes/frames/compositions/waiting/`
- `packages/shell/renderer/desktop/lophn-space/things-to-confirm/`
- `packages/shell/main/desktop/wiring/confirmation.ts`
- `packages/shell/renderer/secret-input/`
- `packages/shell/main/secret-input/`
- `packages/shell/main/decision-handle/`
- `packages/shell/main/desktop/wiring/secret-input.ts`
- `packages/shell/renderer/desktop/dev-mock/requests.ts`

### screens-conversation
- `packages/shell/renderer/conversation/`
- `packages/shell/renderer/workspace/agent/`
- `tools/wireframes/frames/compositions/agent-tab/`
- `tools/wireframes/frames/compositions/conversation.tsx`
- `tools/wireframes/frames/compositions/agent-chat.tsx`
- `tools/wireframes/frames/compositions/slash-menu.tsx`
- `tools/wireframes/frames/compositions/session-switcher.tsx`
- `tools/wireframes/frames/compositions/model-picker.tsx`
- `tools/wireframes/frames/compositions/agent-pages.tsx`
- `packages/shell/renderer/workspace/visuals/`
- `packages/shell/renderer/desktop/dev-mock/agent.ts`

### screens-project
- `packages/shell/renderer/workspace/`
- `packages/shell/renderer/editor/`
- `packages/shell/renderer/terminal/`
- `packages/shell/main/editor/`
- `packages/shell/main/workspace/`
- `tools/wireframes/frames/compositions/project-files/`
- `tools/wireframes/frames/compositions/project-window.tsx`
- `tools/wireframes/frames/compositions/project-app.tsx`
- `tools/wireframes/frames/compositions/project-pages.tsx`
- `packages/shell/main/desktop/wiring/layout.ts`
- `packages/shell/main/desktop/wiring/editor.ts`
- `tools/wireframes/frames/compositions/documents.tsx`
- `tools/wireframes/frames/compositions/bodies.tsx`

### screens-contexts
- `packages/shell/renderer/workspace/contexts/`
- `tools/wireframes/frames/compositions/contexts/`
- `tools/wireframes/frames/compositions/context-body.tsx`

### screens-agents
- `packages/shell/renderer/workspace/agents/`
- `packages/shell/renderer/desktop/lophn-space/settings/agents/`
- `packages/shell/renderer/desktop/lophn-space/settings/providers/`
- `packages/shell/renderer/desktop/lophn-space/settings/extensions/`
- `tools/wireframes/frames/compositions/agent-setup/`
- `tools/wireframes/frames/compositions/agents-tab.tsx`
- `tools/wireframes/frames/compositions/workspace-settings.tsx`

### screens-app-space
- `packages/shell/renderer/app-frame/`
- `packages/shell/main/app-frame/`
- `tools/wireframes/frames/compositions/app-space/`
- `packages/shell/main/desktop/wiring/app-views.ts`
- `packages/shell/renderer/overlay/feedback/`
- `packages/shell/main/entry-screen-test.ts`
- `packages/shell/main/tsconfig.json`

### screens-workspace
- `packages/shell/renderer/desktop/`
- `packages/shell/renderer/icons/`
- `packages/shell/renderer/entry.tsx`
- `tools/wireframes/frames/compositions/workspace/`
- `tools/wireframes/frames/compositions/workspace-page.tsx`
- `tools/wireframes/frames/compositions/ways-page.tsx`
- `tools/wireframes/frames/compositions/ways.ts`

## 공용 (add-only)

- `packages/design/wording/catalog/`
- `packages/design/wording/*.placeholders.ts`

## wave 4: 통합

### cleanup
- 저장소 전체. 다른 단위가 모두 merge된 뒤 혼자 돈다.

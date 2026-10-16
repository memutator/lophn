# 상태

오케스트레이터만 고친다. `tools/status.py`가 brief에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

계약 고정: a7f8deb6

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `check` | check | 0 | 없음 | merged | check/check | dbc68a3b |  |
| `core-wiring-split` | core-wiring | 0 | core-wiring-trim | merged | core-wiring/core-wiring-split | 705b8207 |  |
| `core-wiring-trim` | core-wiring | 0 | 없음 | merged | core-wiring/core-wiring-trim | 730e64de |  |
| `shell-wiring` | shell-wiring | 0 | 없음 | merged | shell-wiring/shell-wiring | 36146113 |  |
| `wording-split` | wording-split | 0 | 없음 | merged | wording-split/wording-split | dd8d0e36 |  |
| `remove-app-extras-apps` | remove-app-extras | 1 | remove-documents-core, core-wiring, remove-app-extras-tools, remove-documents-sdk | merged | remove-app-extras/remove-app-extras-apps | 8ac9313f |  |
| `remove-app-extras-tools` | remove-app-extras | 1 | core-wiring | merged | remove-app-extras/remove-app-extras-tools | 704c7ba5 |  |
| `remove-app-extras-ui` | remove-app-extras | 1 | remove-platform-renderer | merged | remove-app-extras/remove-app-extras-ui | 70fe1fb6 |  |
| `remove-documents-core` | remove-documents | 1 | remove-documents-move, remove-app-extras-tools, core-wiring | merged | remove-documents/remove-documents-core | 963e410f |  |
| `remove-documents-move` | remove-documents | 1 | core-wiring, remove-app-extras-tools | merged | remove-documents/remove-documents-move | 37d9f0d7 |  |
| `remove-documents-protocol` | remove-documents | 1 | remove-documents-core, remove-documents-sdk, remove-documents-ui, remove-app-extras-tools | merged | remove-documents/remove-documents-protocol | 7c167a7d |  |
| `remove-documents-redaction` | remove-documents | 1 | remove-documents-move, remove-platform-notifications | merged | remove-documents/remove-documents-redaction | dab47f85 |  |
| `remove-documents-sdk` | remove-documents | 1 | 없음 | merged | remove-documents/remove-documents-sdk | d8923e34 |  |
| `remove-documents-ui` | remove-documents | 1 | 없음 | merged | remove-documents/remove-documents-ui | a17a47bb |  |
| `remove-platform-backup` | remove-platform | 1 | remove-platform-shell, remove-platform-notifications | merged | remove-platform/remove-platform-backup | 6803dd63 |  |
| `remove-platform-install` | remove-platform | 1 | remove-platform-backup, core-wiring | merged | remove-platform/remove-platform-install | 44b9fc76 |  |
| `remove-platform-notifications` | remove-platform | 1 | remove-documents-core, remove-platform-renderer, core-wiring | merged | remove-platform/remove-platform-notifications | 50e566cb |  |
| `remove-platform-renderer` | remove-platform | 1 | remove-documents-ui | merged | remove-platform/remove-platform-renderer | 90095884 |  |
| `remove-platform-shell` | remove-platform | 1 | remove-platform-renderer | merged | remove-platform/remove-platform-shell | b2d71086 |  |
| `contract-agent-tools-catalog` | contract-agent-tools | 2 | contract-calls-places | merged | contract-agent-tools/contract-agent-tools-catalog | fa95d7a3 |  |
| `contract-agent-tools-config` | contract-agent-tools | 2 | 없음 | merged | contract-agent-tools/contract-agent-tools-config | 678955c3 |  |
| `contract-app-calls-annotation` | contract-app-calls | 2 | 없음 | merged | contract-app-calls/contract-app-calls-annotation | 56de596e |  |
| `contract-app-calls-api` | contract-app-calls | 2 | contract-releases-problems-problems | merged | contract-app-calls/contract-app-calls-api | bf193c7a |  |
| `contract-app-calls-blueprint` | contract-app-calls | 2 | 없음 | merged | contract-app-calls/contract-app-calls-blueprint | 269c3315 |  |
| `contract-app-calls-ports` | contract-app-calls | 2 | contract-app-calls-api, contract-approvals | merged | contract-app-calls/contract-app-calls-ports | 5e6fb79b |  |
| `contract-app-calls-shell` | contract-app-calls | 2 | 없음 | merged | contract-app-calls/contract-app-calls-shell | 836b7904 |  |
| `contract-approvals` | contract-approvals | 2 | contract-calls-places-calls | merged | contract-approvals/contract-approvals | 2f18618f |  |
| `contract-calls-places-calls` | contract-calls-places | 2 | contract-calls-places-places | merged | contract-calls-places/contract-calls-places-calls | 6530a6ed |  |
| `contract-calls-places-places` | contract-calls-places | 2 | 없음 | merged | contract-calls-places/contract-calls-places-places | 15ac0e6b |  |
| `contract-calls-places-projects` | contract-calls-places | 2 | remove-documents | merged | contract-calls-places/contract-calls-places-projects | 2021c776 |  |
| `contract-calls-places-turns` | contract-calls-places | 2 | contract-calls-places-places | merged | contract-calls-places/contract-calls-places-turns | 6b76b73c |  |
| `contract-coding-adapter` | contract-coding | 2 | 없음 | merged | contract-coding/contract-coding-adapter | 678285a5 |  |
| `contract-coding-routes` | contract-coding | 2 | contract-coding-adapter | merged | contract-coding/contract-coding-routes | 659ea88e |  |
| `contract-events` | contract-events | 2 | contract-approvals, contract-calls-places-calls | merged | contract-events/contract-events | 869a17a3 |  |
| `contract-platform` | contract-platform | 2 | 없음 | merged | contract-platform/contract-platform | 7dd421c5 |  |
| `contract-releases-problems-feedback` | contract-releases-problems | 2 | contract-releases-problems-problems | merged | contract-releases-problems/contract-releases-problems-feedback | 95da422b |  |
| `contract-releases-problems-problems` | contract-releases-problems | 2 | 없음 | merged | contract-releases-problems/contract-releases-problems-problems | e6a8a71f |  |
| `contract-releases-problems-releases` | contract-releases-problems | 2 | 없음 | merged | contract-releases-problems/contract-releases-problems-releases | 785c2be5 |  |
| `contract-shell` | contract-shell | 2 | 없음 | merged | contract-shell/contract-shell | 0e264619 |  |
| `ui-chrome-component-mark` | ui-chrome | 2 | ui-chrome-components | merged | ui-chrome/ui-chrome-component-mark | b0825ed5 |  |
| `ui-chrome-components` | ui-chrome | 2 | 없음 | merged | ui-chrome/ui-chrome-components | 7aa86c12 |  |
| `ui-chrome-top-bar` | ui-chrome | 2 | ui-chrome-components | merged | ui-chrome/ui-chrome-top-bar | a0f02d23 |  |
| `agent-definition-agents` | agent-definition | 3 | agent-definition-roles | merged | agent-definition/agent-definition-agents | f49718b5 |  |
| `agent-definition-extensions` | agent-definition | 3 | 없음 | merged | agent-definition/agent-definition-extensions | 4da65e2d |  |
| `agent-definition-input-tags` | agent-definition | 3 | 없음 | merged | agent-definition/agent-definition-input-tags | b2afb877 |  |
| `agent-definition-instructions` | agent-definition | 3 | 없음 | merged | agent-definition/agent-definition-instructions | 2fb4b936 |  |
| `agent-definition-models` | agent-definition | 3 | 없음 | merged | agent-definition/agent-definition-models | 93a37352 |  |
| `agent-definition-prompt` | agent-definition | 3 | agent-definition-input-tags | merged | agent-definition/agent-definition-prompt | 8d99ad5c |  |
| `agent-definition-register` | agent-definition | 3 | router-calls, router-run-loop-turn, places-sessions-session, approvals-tool-judgment | merged | agent-definition/agent-definition-register | 516742af |  |
| `agent-definition-roles` | agent-definition | 3 | 없음 | merged | agent-definition/agent-definition-roles | 1f56b37e |  |
| `agent-tools-app-api` | agent-tools | 3 | agent-tools-registry | merged | agent-tools/agent-tools-app-api | 352e9f14 |  |
| `agent-tools-call` | agent-tools | 3 | agent-tools-registry | merged | agent-tools/agent-tools-call | 083e5d26 |  |
| `agent-tools-context` | agent-tools | 3 | agent-tools-registry | merged | agent-tools/agent-tools-context | caf74d94 |  |
| `agent-tools-file` | agent-tools | 3 | agent-tools-registry | merged | agent-tools/agent-tools-file | 37adb7c8 |  |
| `agent-tools-registry` | agent-tools | 3 | 없음 | merged | agent-tools/agent-tools-registry | 6c94bbf8 |  |
| `agent-tools-shell-web` | agent-tools | 3 | agent-tools-registry | merged | agent-tools/agent-tools-shell-web | 99df84b1 |  |
| `agent-tools-work` | agent-tools | 3 | agent-tools-registry | merged | agent-tools/agent-tools-work | 17674f46 |  |
| `annotation-core` | annotation | 3 | 없음 | merged | annotation/annotation-core | d506d353 |  |
| `annotation-page` | annotation | 3 | 없음 | merged | annotation/annotation-page | d8eb1b02 |  |
| `annotation-shell` | annotation | 3 | 없음 | merged | annotation/annotation-shell | 0196b489 |  |
| `app-calls-assembly` | app-calls | 3 | app-calls-path, app-calls-invocations, app-calls-rewind, app-calls-process, app-calls-supervisor, app-calls-preview, app-calls-screens | merged | app-calls/app-calls-assembly | 3f2a153d |  |
| `app-calls-invocations` | app-calls | 3 | app-calls-process, app-calls-supervisor | merged | app-calls/app-calls-invocations | 4696d323 |  |
| `app-calls-path` | app-calls | 3 | 없음 | merged | app-calls/app-calls-path | c8bd4064 |  |
| `app-calls-preview` | app-calls | 3 | app-calls-supervisor | merged | routes | 368, | duplicates |
| `app-calls-process` | app-calls | 3 | 없음 | merged | app-calls/app-calls-process | 58703b60 |  |
| `app-calls-rewind` | app-calls | 3 | 없음 | merged | app-calls/app-calls-rewind | 28ade8e4 |  |
| `app-calls-screens` | app-calls | 3 | 없음 | merged | app-calls/app-calls-screens | 78965022 |  |
| `app-calls-shell` | app-calls | 3 | 없음 | merged | app-calls/app-calls-shell | acfc7b98 |  |
| `app-calls-supervisor` | app-calls | 3 | approvals-app-grants | merged | app-calls/app-calls-supervisor | d359d846 |  |
| `approvals-app-grants` | approvals | 3 | 없음 | merged | approvals/approvals-app-grants | 3df94916 |  |
| `approvals-gate` | approvals | 3 | 없음 | merged | approvals/approvals-gate | 4900c979 |  |
| `approvals-requests` | approvals | 3 | approvals-gate | merged | approvals/approvals-requests | 8c97e6d0 |  |
| `approvals-tool-judgment` | approvals | 3 | approvals-requests | merged | approvals/approvals-tool-judgment | 42bdf70f |  |
| `coding-agent-cli` | coding-agent | 3 | 없음 | merged | coding-agent/coding-agent-cli | 3cc8abe3 |  |
| `coding-agent-harness` | coding-agent | 3 | coding-agent-cli | merged | coding-agent/coding-agent-harness | 38a4f62b |  |
| `coding-agent-session` | coding-agent | 3 | coding-agent-tickets | merged | coding-agent/coding-agent-session | e5c029ad |  |
| `coding-agent-settings` | coding-agent | 3 | 없음 | merged | coding-agent/coding-agent-settings | c8129c42 |  |
| `coding-agent-terminal` | coding-agent | 3 | 없음 | merged | coding-agent/coding-agent-terminal | 1ae03dbb |  |
| `coding-agent-tickets` | coding-agent | 3 | 없음 | merged | coding-agent/coding-agent-tickets | f7de4c64 |  |
| `events-bus-gateway` | events | 3 | events-ledger | merged | events/events-bus-gateway | 5e99b50f |  |
| `events-identity` | events | 3 | events-bus-gateway | merged | events/events-identity | ab8978a9 |  |
| `events-ledger` | events | 3 | 없음 | merged | events/events-ledger | fbfb0ee6 |  |
| `events-reactor` | events | 3 | events-ledger, events-bus-gateway | merged | events/events-reactor | 438d8734 |  |
| `places-sessions-contexts-authority` | places-sessions | 3 | 없음 | merged | places-sessions/places-sessions-contexts-authority | 48e20be9 |  |
| `places-sessions-contexts-drafts` | places-sessions | 3 | places-sessions-contexts-authority | merged | places-sessions/places-sessions-contexts-drafts | 12027bafa |  |
| `places-sessions-conversation` | places-sessions | 3 | places-sessions-session | merged | places-sessions/places-sessions-conversation | cbef749c |  |
| `places-sessions-projects` | places-sessions | 3 | 없음 | merged | places-sessions/places-sessions-projects | bedeac64 |  |
| `places-sessions-rewind` | places-sessions | 3 | places-sessions-session, router-run-loop-input | merged | places-sessions/places-sessions-rewind | 367d98e35 |  |
| `places-sessions-search` | places-sessions | 3 | places-sessions-projects | merged | places-sessions/places-sessions-search | 3f0c247bb |  |
| `places-sessions-session` | places-sessions | 3 | 없음 | merged | places-sessions/places-sessions-session | b2a12f79 |  |
| `platform-config` | platform | 3 | platform-secrets | merged | platform/platform-config | 71626c21 |  |
| `platform-desktop` | platform | 3 | screens-data-secret-input, remove-platform, ui-chrome-top-bar, platform-runtime | merged | platform/platform-desktop | 6fb8e731 |  |
| `platform-diagnostics` | platform | 3 | core-wiring | merged | platform/platform-diagnostics | 651a195f6 |  |
| `platform-install` | platform | 3 | coding-agent-cli, platform-runtime | merged | platform/platform-install | 2e58943dd |  |
| `platform-runtime` | platform | 3 | core-wiring, remove-platform, platform-secrets | merged | platform/platform-runtime | 7208838a |  |
| `platform-secrets` | platform | 3 | core-wiring, remove-platform | merged | platform/platform-secrets | 0d0c6535 |  |
| `releases-problems-activation` | releases-problems | 3 | 없음 | merged | releases-problems/releases-problems-activation | 4200c006 |  |
| `releases-problems-bundle` | releases-problems | 3 | releases-problems-activation, releases-problems-packages | merged | releases-problems/releases-problems-bundle | 293e0d88f |  |
| `releases-problems-intake` | releases-problems | 3 | releases-problems-register-split | merged | releases-problems/releases-problems-intake | e44759ad |  |
| `releases-problems-packages` | releases-problems | 3 | 없음 | merged | releases-problems/releases-problems-packages | 92864489 |  |
| `releases-problems-problem-state` | releases-problems | 3 | releases-problems-register-split, releases-problems-intake | merged | releases-problems/releases-problems-problem-state | 641384af |  |
| `releases-problems-register-split` | releases-problems | 3 | 없음 | merged | releases-problems/releases-problems-register-split | 1b173595 |  |
| `releases-problems-repairs` | releases-problems | 3 | releases-problems-register-split, releases-problems-intake, releases-problems-problem-state, releases-problems-tests | merged | releases-problems/releases-problems-repairs | f0c5fac70 |  |
| `releases-problems-template` | releases-problems | 3 | releases-problems-packages, app-calls | merged | releases-problems/releases-problems-template | 0abc69e6f |  |
| `releases-problems-tests` | releases-problems | 3 | releases-problems-register-split | merged | releases-problems/releases-problems-tests | 8f618d2a |  |
| `router-calls` | router | 3 | 없음 | merged | router/router-calls | 67cdf598 |  |
| `router-run-loop-input` | router | 3 | 없음 | merged | router/router-run-loop-input | 3f4a0363 |  |
| `router-run-loop-turn` | router | 3 | router-run-loop-input | merged | router/router-run-loop-turn | 8ff4fdbf |  |
| `router-waiting` | router | 3 | router-run-loop-turn, router-run-loop-input | merged | router/router-waiting | a9a6a206e |  |
| `screens-agents-editor` | screens-agents | 3 | screens-conversation-composer | merged | screens-agents/screens-agents-editor | a883d981 |  |
| `screens-agents-settings` | screens-agents | 3 | screens-agents-editor | merged | screens-agents/screens-agents-settings | 0cfbf805 |  |
| `screens-app-space-detail` | screens-app-space | 3 | 없음 | merged | screens-app-space/screens-app-space-detail | 654341aa |  |
| `screens-app-space-frame` | screens-app-space | 3 | screens-app-space-detail, screens-data-waiting, screens-data-toast, screens-project-terminal | merged | screens-app-space/screens-app-space-frame | 8c5d5790 |  |
| `screens-app-space-main` | screens-app-space | 3 | platform-desktop, screens-data-secret-input | merged | screens-app-space/screens-app-space-main | 629465d9d |  |
| `screens-contexts-overview` | screens-contexts | 3 | screens-project-reactions, screens-project-window, screens-project-search | merged | screens-contexts/screens-contexts-overview | 75393aa4 |  |
| `screens-contexts-views` | screens-contexts | 3 | screens-contexts-overview, screens-data-toast | merged | screens-contexts/screens-contexts-views | cf4304caa |  |
| `screens-conversation-cards` | screens-conversation | 3 | screens-conversation-source, screens-data-waiting | merged | screens-conversation/screens-conversation-cards | 38da4740 |  |
| `screens-conversation-composer` | screens-conversation | 3 | screens-conversation-source, screens-conversation-cards | merged | screens-conversation/screens-conversation-composer | ca9a830f |  |
| `screens-conversation-core-source` | screens-conversation | 3 | screens-conversation-source, screens-data-waiting | merged | screens-conversation/screens-conversation-core-source | 0b3a0126 |  |
| `screens-conversation-sessions` | screens-conversation | 3 | screens-conversation-source | merged | screens-conversation/screens-conversation-sessions | 608d42a0 |  |
| `screens-conversation-source` | screens-conversation | 3 | screens-data-events | merged | screens-conversation/screens-conversation-source | 616e37b8 |  |
| `screens-conversation-thread` | screens-conversation | 3 | screens-conversation-source | merged | screens-conversation/screens-conversation-thread | 42e3ad9c |  |
| `screens-conversation-view` | screens-conversation | 3 | screens-conversation-thread, screens-conversation-cards, screens-conversation-composer, screens-conversation-sessions, screens-conversation-core-source | merged | screens-conversation/screens-conversation-view | be54a797 |  |
| `screens-data-events` | screens-data | 3 | 없음 | merged | screens-data/screens-data-events | 25555fba |  |
| `screens-data-secret-input` | screens-data | 3 | 없음 | merged | screens-data/screens-data-secret-input | 00ad809b |  |
| `screens-data-toast` | screens-data | 3 | screens-data-events, screens-data-waiting | merged | screens-data/screens-data-toast | d27ce46d |  |
| `screens-data-waiting` | screens-data | 3 | screens-data-events | merged | screens-data/screens-data-waiting | 35f39b5d |  |
| `screens-project-editor` | screens-project | 3 | screens-project-sidebar | merged | screens-project/screens-project-editor | 0e652441 |  |
| `screens-project-main` | screens-project | 3 | 없음 | merged | screens-project/screens-project-main | 31aa3a6af |  |
| `screens-project-reactions` | screens-project | 3 | screens-project-window, screens-data-waiting, screens-data-toast, screens-project-terminal | merged | screens-project/screens-project-reactions | 3c0e4895 |  |
| `screens-project-search` | screens-project | 3 | screens-project-sidebar | merged | screens-project/screens-project-search | 6efb0b2c |  |
| `screens-project-sidebar` | screens-project | 3 | 없음 | merged | screens-project/screens-project-sidebar | 8a51ce8f |  |
| `screens-project-terminal` | screens-project | 3 | 없음 | merged | screens-project/screens-project-terminal | 76156528 |  |
| `screens-project-window` | screens-project | 3 | screens-project-sidebar, screens-project-editor, screens-project-terminal, screens-project-search | merged | screens-project/screens-project-window | 11cf296f |  |
| `screens-workspace-screens` | screens-workspace | 3 | screens-workspace-settings, screens-data-waiting | merged | screens-workspace/screens-workspace-screens | ccb2cb38 |  |
| `screens-workspace-settings` | screens-workspace | 3 | 없음 | merged | screens-workspace/screens-workspace-settings | a94be2cf |  |
| `screens-workspace-space` | screens-workspace | 3 | screens-workspace-settings, screens-workspace-screens, screens-app-space-frame, screens-agents-settings, screens-data-events, screens-data-waiting, screens-data-toast, screens-project-window, screens-project-reactions, screens-project-terminal, screens-conversation-view | merged | screens-workspace/screens-workspace-space | a71b5e54c |  |
| `cleanup-comments` | cleanup | 4 | cleanup-names | todo |  |  |  |
| `cleanup-dead` | cleanup | 4 | 없음 | todo |  |  |  |
| `cleanup-names` | cleanup | 4 | cleanup-dead | todo |  |  |  |

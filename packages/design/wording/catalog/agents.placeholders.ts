// catalog/agents.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
import type { agents } from "./agents.ts";

export type AgentsPlaceholders = {
  "agents.button.settings-back": Record<never, never>;
  "agents.button.settings-open-lophn": Record<never, never>;
  "agents.heading.settings-default-model": Record<never, never>;
  "agents.heading.settings-grant-defaults": Record<never, never>;
  "agents.label.providers-custom-key-title": Record<never, never>;
  "agents.label.providers-key-hint": Record<never, never>;
  "agents.label.settings-instructions-path": Record<never, never>;
  "agents.label.settings-lophn-chip": Record<never, never>;
  "agents.label.settings-lophn-grants": {
    apps: "plural";
    agents: "plural";
    settings: "string";
  };
  "agents.label.settings-lophn-model-default": {
    model: "string";
  };
  "agents.label.settings-lophn-model-none": Record<never, never>;
  "agents.label.settings-lophn-model-own": {
    model: "string";
  };
  "agents.notice.providers-custom-key": Record<never, never>;
  "agents.notice.providers-disconnect-body": {
    name: "string";
  };
  "agents.notice.providers-disconnect-failed": Record<never, never>;
  "agents.notice.settings-agents-lead": Record<never, never>;
  "agents.notice.settings-default-model-help": Record<never, never>;
  "agents.notice.settings-grant-defaults-help": Record<never, never>;
  "agents.notice.settings-lophn-purpose": Record<never, never>;
  "agents.notice.settings-tools-elsewhere": Record<never, never>;
  "agents.notice.settings-tools-lead": Record<never, never>;
  "agents.notice.settings-tools-servers": Record<never, never>;
  "agents.notice.settings-tools-skills": Record<never, never>;
  "agents.notice.stored-in-lophn": Record<never, never>;
  "agents.heading.model-for-project": Record<never, never>;
  "agents.label.card-model": {
    layer: "string";
    model: "string";
  };
  "agents.notice.model-for-project": Record<never, never>;
  "agents.notice.skills-project": Record<never, never>;
  "agents.notice.tab-lead": Record<never, never>;
  "agents.button.add-agent": Record<never, never>;
  "agents.button.assign-app": Record<never, never>;
  "agents.button.assign-tools": Record<never, never>;
  "agents.button.choose-icon": Record<never, never>;
  "agents.button.create-operator": Record<never, never>;
  "agents.button.grant-reset": Record<never, never>;
  "agents.button.remove-app": Record<never, never>;
  "agents.button.remove-image": Record<never, never>;
  "agents.button.remove-server": Record<never, never>;
  "agents.empty.grants-agents": Record<never, never>;
  "agents.empty.grants-apps": Record<never, never>;
  "agents.empty.grants-tools": Record<never, never>;
  "agents.heading.grants-agents": Record<never, never>;
  "agents.heading.grants-apps": Record<never, never>;
  "agents.heading.grants-settings": Record<never, never>;
  "agents.heading.grants-tools": Record<never, never>;
  "agents.heading.server-form": Record<never, never>;
  "agents.label.agent-instructions": Record<never, never>;
  "agents.label.ask-ask": Record<never, never>;
  "agents.label.ask-never": Record<never, never>;
  "agents.label.auth-api-key": Record<never, never>;
  "agents.label.auth-bearer": Record<never, never>;
  "agents.label.auth-none": Record<never, never>;
  "agents.label.avatar-preview": Record<never, never>;
  "agents.label.built-in": Record<never, never>;
  "agents.label.defaults-by-effect": Record<never, never>;
  "agents.label.defaults-external": Record<never, never>;
  "agents.label.defaults-read": Record<never, never>;
  "agents.label.defaults-settings": Record<never, never>;
  "agents.label.defaults-write": Record<never, never>;
  "agents.label.effect-external": Record<never, never>;
  "agents.label.effect-read": Record<never, never>;
  "agents.label.effect-settings": Record<never, never>;
  "agents.label.effect-write": Record<never, never>;
  "agents.label.grant-came-default": Record<never, never>;
  "agents.label.grant-changed": Record<never, never>;
  "agents.label.grant-col-allowed": Record<never, never>;
  "agents.label.grant-col-effect": Record<never, never>;
  "agents.label.grant-col-name": Record<never, never>;
  "agents.label.grant-col-status": Record<never, never>;
  "agents.label.grant-col-when": Record<never, never>;
  "agents.label.grant-default": Record<never, never>;
  "agents.label.grant-left-out": Record<never, never>;
  "agents.label.grant-new-in": {
    release: "string";
  };
  "agents.label.grant-when-runs": {
    name: "string";
  };
  "agents.label.grants-apis-summary": {
    used: "number";
    total: "number";
    asking: "plural";
  };
  "agents.label.grants-apps-summary": {
    release: "string";
    used: "number";
    total: "number";
    asking: "plural";
  };
  "agents.label.grants-settings-detail": Record<never, never>;
  "agents.label.grants-settings-name": Record<never, never>;
  "agents.label.grants-target": Record<never, never>;
  "agents.label.grants-tools-summary": {
    used: "number";
    total: "number";
    asking: "plural";
  };
  "agents.label.instructions-head-folder": {
    project: "string";
  };
  "agents.label.instructions-head-placed": {
    project: "string";
  };
  "agents.label.instructions-head-source": {
    project: "string";
    app: "string";
  };
  "agents.label.instructions-head-unknown": Record<never, never>;
  "agents.label.layer-agent": Record<never, never>;
  "agents.label.layer-builtin": Record<never, never>;
  "agents.label.layer-global": Record<never, never>;
  "agents.label.layer-project": Record<never, never>;
  "agents.label.model-by-provider": {
    model: "string";
    provider: "string";
  };
  "agents.label.model-inherit": {
    layer: "string";
    model: "string";
  };
  "agents.label.model-overrides": {
    layer: "string";
  };
  "agents.label.no-model-chosen": Record<never, never>;
  "agents.label.place": Record<never, never>;
  "agents.label.place-choice": {
    name: "string";
    kind: "string";
  };
  "agents.label.place-lophn": Record<never, never>;
  "agents.label.place-named": {
    name: "string";
    kind: "string";
  };
  "agents.label.protected-key": Record<never, never>;
  "agents.label.provider": Record<never, never>;
  "agents.label.role-project-manager": Record<never, never>;
  "agents.label.tab-definition": Record<never, never>;
  "agents.label.tab-grants": Record<never, never>;
  "agents.notice.credential-later": Record<never, never>;
  "agents.notice.grants-after-create": Record<never, never>;
  "agents.notice.grants-apply-now": Record<never, never>;
  "agents.notice.grants-defaults-help": Record<never, never>;
  "agents.notice.grants-lead": {
    name: "string";
  };
  "agents.notice.grants-settings-help": Record<never, never>;
  "agents.notice.grants-tool-effect": Record<never, never>;
  "agents.notice.instructions-help": Record<never, never>;
  "agents.notice.instructions-help-lophn": Record<never, never>;
  "agents.notice.lophn-no-project": Record<never, never>;
  "agents.notice.name-fixed-lophn": Record<never, never>;
  "agents.notice.name-fixed-role": {
    owner: "string";
    role: "string";
  };
  "agents.notice.place-help": Record<never, never>;
  "agents.notice.profile-help": Record<never, never>;
  "agents.notice.protected-key": Record<never, never>;
  "agents.notice.server-name-help": Record<never, never>;
  "agents.notice.skills-agent-only": Record<never, never>;
  "agents.title.change-failed": Record<never, never>;
  "agents.title.delete-failed": Record<never, never>;
  "agents.title.providers-disconnect": {
    name: "string";
  };
  "agents.title.save-conflict": Record<never, never>;
  "agents.title.save-failed": Record<never, never>;
  "agents.title.upload-failed": Record<never, never>;
  "project-workspace.button.add-server": Record<never, never>;
  "project-workspace.button.add-skill": Record<never, never>;
  "project-workspace.button.agent-editor-add-context": Record<never, never>;
  "project-workspace.button.agent-editor-delete": Record<never, never>;
  "project-workspace.button.agent-editor-delete-confirm": Record<never, never>;
  "project-workspace.button.agent-editor-edit-project": Record<never, never>;
  "project-workspace.button.agent-editor-save": Record<never, never>;
  "project-workspace.button.agent-editor-upload-image": Record<never, never>;
  "project-workspace.button.edit-instructions": Record<never, never>;
  "project-workspace.button.new-operator": Record<never, never>;
  "project-workspace.button.open-agent": Record<never, never>;
  "project-workspace.empty.agent-editor-no-contexts": Record<never, never>;
  "project-workspace.empty.agent-editor-no-project": Record<never, never>;
  "project-workspace.empty.no-instructions": Record<never, never>;
  "project-workspace.empty.no-mcp-servers": Record<never, never>;
  "project-workspace.empty.no-skills": Record<never, never>;
  "project-workspace.heading.agent-editor-contexts": Record<never, never>;
  "project-workspace.heading.agent-editor-delete-title": {
    name: "string";
  };
  "project-workspace.heading.agent-editor-mcp": Record<never, never>;
  "project-workspace.heading.agent-editor-model": Record<never, never>;
  "project-workspace.heading.agent-editor-profile": Record<never, never>;
  "project-workspace.heading.agent-editor-skills": Record<never, never>;
  "project-workspace.heading.agents-in-project": {
    project: "string";
  };
  "project-workspace.heading.agents-new-operator": Record<never, never>;
  "project-workspace.heading.instructions": Record<never, never>;
  "project-workspace.heading.mcp-servers": Record<never, never>;
  "project-workspace.heading.skills": Record<never, never>;
  "project-workspace.info.instructions-file": Record<never, never>;
  "project-workspace.label.agent-counts-built-in": {
    skills: "plural";
    mcp: "number";
  };
  "project-workspace.label.agent-counts-operator": {
    contexts: "plural";
    skills: "plural";
    mcp: "number";
  };
  "project-workspace.label.agent-counts-unknown": Record<never, never>;
  "project-workspace.label.agent-editor-icons": Record<never, never>;
  "project-workspace.label.agent-editor-image-file": Record<never, never>;
  "project-workspace.label.agent-editor-instructions": Record<never, never>;
  "project-workspace.label.agent-editor-model-unset": Record<never, never>;
  "project-workspace.label.agent-editor-name": Record<never, never>;
  "project-workspace.label.agent-editor-remove-context": {
    name: "string";
  };
  "project-workspace.label.agent-kind-operator": Record<never, never>;
  "project-workspace.label.agent-no-model": Record<never, never>;
  "project-workspace.label.agents-target": Record<never, never>;
  "project-workspace.label.avatar-icon-apps": Record<never, never>;
  "project-workspace.label.avatar-icon-bookmark": Record<never, never>;
  "project-workspace.label.avatar-icon-compare": Record<never, never>;
  "project-workspace.label.avatar-icon-contexts": Record<never, never>;
  "project-workspace.label.avatar-icon-dock": Record<never, never>;
  "project-workspace.label.avatar-icon-documents": Record<never, never>;
  "project-workspace.label.avatar-icon-edit": Record<never, never>;
  "project-workspace.label.avatar-icon-read": Record<never, never>;
  "project-workspace.label.avatar-icon-roles": Record<never, never>;
  "project-workspace.label.avatar-icon-search": Record<never, never>;
  "project-workspace.label.avatar-icon-series": Record<never, never>;
  "project-workspace.label.avatar-icon-terminal": Record<never, never>;
  "project-workspace.label.instructions-shared": {
    project: "string";
  };
  "project-workspace.label.open-agent-named": {
    name: "string";
  };
  "project-workspace.label.role-app-engineer": Record<never, never>;
  "project-workspace.label.role-lophn": Record<never, never>;
  "project-workspace.label.role-operators": Record<never, never>;
  "project-workspace.notice.agent-editor-delete-body": Record<never, never>;
  "project-workspace.notice.agent-editor-issue": {
    code: "string";
  };
  "project-workspace.notice.agent-editor-model-help": Record<never, never>;
  "project-workspace.notice.agent-editor-save-first": Record<never, never>;
  "project-workspace.notice.agents-change-failed": Record<never, never>;
  "project-workspace.notice.agents-delete-failed": Record<never, never>;
  "project-workspace.notice.agents-save-conflict": Record<never, never>;
  "project-workspace.notice.agents-save-failed": Record<never, never>;
  "project-workspace.notice.agents-upload-failed": Record<never, never>;
  "settings.agents.action-failed": Record<never, never>;
  "settings.agents.intro": Record<never, never>;
  "settings.agents.no-instructions": Record<never, never>;
  "settings.agents.no-options": Record<never, never>;
  "settings.agents.no-servers": Record<never, never>;
  "settings.agents.no-skills": Record<never, never>;
  "settings.agents.options-unknown": Record<never, never>;
  "settings.button.add-folder": Record<never, never>;
  "settings.button.add-server": Record<never, never>;
  "settings.button.add-skill": Record<never, never>;
  "settings.button.cancel-sign-in": Record<never, never>;
  "settings.button.change": Record<never, never>;
  "settings.button.disconnect": Record<never, never>;
  "settings.button.edit": Record<never, never>;
  "settings.button.enter-credential": Record<never, never>;
  "settings.button.new-server": Record<never, never>;
  "settings.button.save": Record<never, never>;
  "settings.button.server-sign-in": Record<never, never>;
  "settings.error.connect-failed": Record<never, never>;
  "settings.error.custom-id": Record<never, never>;
  "settings.error.custom-name": Record<never, never>;
  "settings.error.custom-url": Record<never, never>;
  "settings.extensions.folder-added": {
    name: "string";
  };
  "settings.extensions.folder-failed": Record<never, never>;
  "settings.extensions.intro": Record<never, never>;
  "settings.extensions.no-folders": Record<never, never>;
  "settings.extensions.no-servers": Record<never, never>;
  "settings.extensions.server-added": {
    name: "string";
  };
  "settings.extensions.server-failed": {
    name: "string";
  };
  "settings.heading.add-provider": Record<never, never>;
  "settings.heading.agents-defaults": Record<never, never>;
  "settings.heading.agents-instructions": Record<never, never>;
  "settings.heading.agents-servers": Record<never, never>;
  "settings.heading.agents-skills": Record<never, never>;
  "settings.heading.agents-summaries": Record<never, never>;
  "settings.heading.connected": Record<never, never>;
  "settings.heading.servers": Record<never, never>;
  "settings.heading.skills": Record<never, never>;
  "settings.label.agents-target": Record<never, never>;
  "settings.label.available-target": Record<never, never>;
  "settings.label.custom-id": Record<never, never>;
  "settings.label.custom-key": Record<never, never>;
  "settings.label.custom-name": Record<never, never>;
  "settings.label.custom-provider-hint": Record<never, never>;
  "settings.label.custom-url": Record<never, never>;
  "settings.label.extensions-target": Record<never, never>;
  "settings.label.location": Record<never, never>;
  "settings.label.login-signed-in": Record<never, never>;
  "settings.label.method-opens-browser": Record<never, never>;
  "settings.label.method-paste-key": Record<never, never>;
  "settings.label.method-sign-in": {
    product: "string";
  };
  "settings.label.model-line": {
    name: "string";
    model: "string";
  };
  "settings.label.model-name": Record<never, never>;
  "settings.label.not-chosen": Record<never, never>;
  "settings.label.off": Record<never, never>;
  "settings.label.on-computer": Record<never, never>;
  "settings.label.option-pair": {
    axis: "string";
    value: "string";
  };
  "settings.label.over-web": Record<never, never>;
  "settings.label.providers-target": Record<never, never>;
  "settings.label.role-app-engineer": Record<never, never>;
  "settings.label.role-context-engineer": Record<never, never>;
  "settings.label.role-lophn": Record<never, never>;
  "settings.label.role-operator": Record<never, never>;
  "settings.label.server-address": Record<never, never>;
  "settings.label.server-arguments": Record<never, never>;
  "settings.label.server-auth": Record<never, never>;
  "settings.label.server-header": Record<never, never>;
  "settings.label.server-name": Record<never, never>;
  "settings.label.server-program": Record<never, never>;
  "settings.label.server-transport": Record<never, never>;
  "settings.label.sign-in-how": {
    name: "string";
  };
  "settings.label.status-connected": Record<never, never>;
  "settings.label.status-needs-sign-in": Record<never, never>;
  "settings.label.unavailable-connection": Record<never, never>;
  "settings.notice.custom-id-help": Record<never, never>;
  "settings.notice.custom-key-help": Record<never, never>;
  "settings.notice.custom-key-required": Record<never, never>;
  "settings.notice.custom-lead": Record<never, never>;
  "settings.notice.method-unverified": Record<never, never>;
  "settings.notice.next-run": Record<never, never>;
  "settings.notice.none-connected": Record<never, never>;
  "settings.notice.provider-lead": Record<never, never>;
  "settings.notice.window-opened": Record<never, never>;
  "settings.server.address-help": Record<never, never>;
  "settings.server.arguments-help": Record<never, never>;
  "settings.server.auth-sign-in-absent": Record<never, never>;
  "settings.server.credential-missing": Record<never, never>;
  "settings.server.credential-set": Record<never, never>;
  "settings.server.credential-unknown": Record<never, never>;
  "settings.server.error-header": Record<never, never>;
  "settings.server.error-name": Record<never, never>;
  "settings.server.error-path": Record<never, never>;
  "settings.server.error-taken": Record<never, never>;
  "settings.server.error-url": Record<never, never>;
  "settings.server.name-help": Record<never, never>;
  "settings.server.program-help": Record<never, never>;
  "settings.server.sign-in-busy": Record<never, never>;
  "settings.server.sign-in-failed": {
    name: "string";
  };
  "settings.server.sign-in-needed": Record<never, never>;
  "settings.server.sign-in-not-opened": Record<never, never>;
  "settings.server.sign-in-reason-callback-timeout": Record<never, never>;
  "settings.server.sign-in-reason-exchange-failed": Record<never, never>;
  "settings.server.sign-in-reason-expired": Record<never, never>;
  "settings.server.sign-in-reason-refresh-rejected": Record<never, never>;
  "settings.server.sign-in-reason-state-mismatch": Record<never, never>;
  "settings.server.sign-in-reason-store-failed": Record<never, never>;
  "settings.server.signed-in": Record<never, never>;
  "settings.sign-in.waiting": Record<never, never>;
  "settings.status.plan-access": Record<never, never>;
  "settings.status.sign-in-problem": Record<never, never>;
  "settings.status.usage-limit": Record<never, never>;
  "settings.title.connect-provider": {
    name: "string";
  };
  "settings.title.custom-provider": Record<never, never>;
};

type Area = typeof agents;
type _SameKeys =
  | Exclude<keyof Area, keyof AgentsPlaceholders>
  | Exclude<keyof AgentsPlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;

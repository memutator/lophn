// catalog/workspace-settings.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
import type { workspaceSettings } from "./workspace-settings.ts";

export type WorkspaceSettingsPlaceholders = {
  "settings.backup.app-export-failed": Record<never, never>;
  "settings.backup.app-export-heading": Record<never, never>;
  "settings.backup.app-export-note": Record<never, never>;
  "settings.backup.app-export-ready": Record<never, never>;
  "settings.backup.created": {
    time: "string";
  };
  "settings.backup.created-failed": Record<never, never>;
  "settings.backup.excluded-heading": Record<never, never>;
  "settings.backup.excluded-note": Record<never, never>;
  "settings.backup.expand-unavailable": Record<never, never>;
  "settings.backup.heading": Record<never, never>;
  "settings.backup.intro": Record<never, never>;
  "settings.backup.lost-count": {
    count: "plural";
  };
  "settings.backup.lost-heading": {
    time: "string";
  };
  "settings.backup.lost-none": Record<never, never>;
  "settings.backup.none": Record<never, never>;
  "settings.backup.reconnect": Record<never, never>;
  "settings.backup.reconnect-heading": Record<never, never>;
  "settings.backup.restore-complete": Record<never, never>;
  "settings.backup.restore-failed": Record<never, never>;
  "settings.backup.restore-failed-plan": Record<never, never>;
  "settings.backup.restore-restarted": Record<never, never>;
  "settings.backup.retained": {
    count: "plural";
  };
  "settings.backup.secrets-heading": Record<never, never>;
  "settings.backup.secrets-note": Record<never, never>;
  "settings.backup.secrets-window": Record<never, never>;
  "settings.backup.tab-not-restoreable": Record<never, never>;
  "settings.button.before-restore": Record<never, never>;
  "settings.button.check-security": Record<never, never>;
  "settings.button.choose-package": Record<never, never>;
  "settings.button.connect-with": {
    name: "string";
  };
  "settings.button.detect-again": Record<never, never>;
  "settings.button.export-app": Record<never, never>;
  "settings.button.export-secrets": Record<never, never>;
  "settings.button.import-secrets": Record<never, never>;
  "settings.button.restore-again": Record<never, never>;
  "settings.button.revoke": Record<never, never>;
  "settings.button.stop-and-update": Record<never, never>;
  "settings.check.clean": Record<never, never>;
  "settings.diagnostics.check-failed": Record<never, never>;
  "settings.diagnostics.check-failed-no": Record<never, never>;
  "settings.diagnostics.checked-at": {
    time: "string";
  };
  "settings.diagnostics.clean-row": Record<never, never>;
  "settings.diagnostics.heading": Record<never, never>;
  "settings.diagnostics.intro": Record<never, never>;
  "settings.diagnostics.next-raw-key": Record<never, never>;
  "settings.diagnostics.next-wide-grant": Record<never, never>;
  "settings.diagnostics.raw-failed": Record<never, never>;
  "settings.diagnostics.raw-heading": Record<never, never>;
  "settings.diagnostics.raw-intro": Record<never, never>;
  "settings.diagnostics.raw-key": Record<never, never>;
  "settings.diagnostics.wide-grant": Record<never, never>;
  "settings.error.coding-conflict": Record<never, never>;
  "settings.error.coding-detect": Record<never, never>;
  "settings.error.coding-not-detected": Record<never, never>;
  "settings.error.coding-refused": Record<never, never>;
  "settings.error.coding-revoke-window": Record<never, never>;
  "settings.error.coding-unavailable": Record<never, never>;
  "settings.heading.coding-access": Record<never, never>;
  "settings.heading.coding-agents": Record<never, never>;
  "settings.heading.values": Record<never, never>;
  "settings.intro.screen": Record<never, never>;
  "settings.label.applies": Record<never, never>;
  "settings.label.apply-next-call": Record<never, never>;
  "settings.label.apply-next-work": Record<never, never>;
  "settings.label.apply-now": Record<never, never>;
  "settings.label.backup-target": Record<never, never>;
  "settings.label.checked-at": Record<never, never>;
  "settings.label.coding-check-failed": Record<never, never>;
  "settings.label.coding-check-failed-stage": Record<never, never>;
  "settings.label.coding-check-line": {
    stage: "string";
    result: "string";
  };
  "settings.label.coding-check-ok": Record<never, never>;
  "settings.label.coding-check-unknown": Record<never, never>;
  "settings.label.coding-connections-target": Record<never, never>;
  "settings.label.coding-default-name": {
    name: "string";
  };
  "settings.label.coding-detail-candidate": {
    path: "string";
    source: "string";
  };
  "settings.label.coding-detail-executable": {
    path: "string";
  };
  "settings.label.coding-detail-probe": {
    probe: "string";
    outcome: "string";
  };
  "settings.label.coding-detail-resource": {
    place: "string";
    outcome: "string";
  };
  "settings.label.coding-details": Record<never, never>;
  "settings.label.coding-found": Record<never, never>;
  "settings.label.coding-install-complete": Record<never, never>;
  "settings.label.coding-install-details": Record<never, never>;
  "settings.label.coding-install-error": Record<never, never>;
  "settings.label.coding-install-failed": Record<never, never>;
  "settings.label.coding-install-partial": Record<never, never>;
  "settings.label.coding-not-checked": Record<never, never>;
  "settings.label.coding-not-found": Record<never, never>;
  "settings.label.coding-scope-all": Record<never, never>;
  "settings.label.coding-scope-one-app": {
    name: "string";
  };
  "settings.label.coding-scope-one-app-unknown": Record<never, never>;
  "settings.label.coding-scope-pick-app": Record<never, never>;
  "settings.label.coding-sign-in-not-found": Record<never, never>;
  "settings.label.coding-sign-in-unknown": Record<never, never>;
  "settings.label.coding-signed-in": Record<never, never>;
  "settings.label.coding-stage-connect": Record<never, never>;
  "settings.label.coding-stage-guide": Record<never, never>;
  "settings.label.coding-stage-other": Record<never, never>;
  "settings.label.coding-stage-skills": Record<never, never>;
  "settings.label.coding-stage-tools": Record<never, never>;
  "settings.label.coding-state-active": Record<never, never>;
  "settings.label.coding-state-revoked": Record<never, never>;
  "settings.label.coding-target": Record<never, never>;
  "settings.label.coding-version": {
    version: "string";
  };
  "settings.label.coding-version-unknown": Record<never, never>;
  "settings.label.connection-name": Record<never, never>;
  "settings.label.connection-scope": Record<never, never>;
  "settings.label.default": Record<never, never>;
  "settings.label.general-target": Record<never, never>;
  "settings.label.group-integrations": Record<never, never>;
  "settings.label.group-preferences": Record<never, never>;
  "settings.label.group-system": Record<never, never>;
  "settings.label.harness-claude": Record<never, never>;
  "settings.label.harness-codex": Record<never, never>;
  "settings.label.harness-gemini": Record<never, never>;
  "settings.label.harness-hermes": Record<never, never>;
  "settings.label.harness-openclaw": Record<never, never>;
  "settings.label.harness-opencode": Record<never, never>;
  "settings.label.harness-pi": Record<never, never>;
  "settings.label.integrity": Record<never, never>;
  "settings.label.integrity-failed": Record<never, never>;
  "settings.label.integrity-passed": Record<never, never>;
  "settings.label.nav": Record<never, never>;
  "settings.label.notifications-target": Record<never, never>;
  "settings.label.retained-through": Record<never, never>;
  "settings.label.source": Record<never, never>;
  "settings.label.source-default": Record<never, never>;
  "settings.label.source-you": Record<never, never>;
  "settings.label.state": Record<never, never>;
  "settings.label.state-ready": Record<never, never>;
  "settings.label.tab-agents": Record<never, never>;
  "settings.label.tab-coding": Record<never, never>;
  "settings.label.tab-diagnostics": Record<never, never>;
  "settings.label.tab-extensions": Record<never, never>;
  "settings.label.tab-general": Record<never, never>;
  "settings.label.tab-notifications": Record<never, never>;
  "settings.label.tab-providers": Record<never, never>;
  "settings.label.tab-update": Record<never, never>;
  "settings.label.value-custom": Record<never, never>;
  "settings.label.value-items": {
    count: "plural";
  };
  "settings.label.value-no-default": Record<never, never>;
  "settings.label.value-not-set": Record<never, never>;
  "settings.label.value-off": Record<never, never>;
  "settings.label.value-on": Record<never, never>;
  "settings.label.way-local": Record<never, never>;
  "settings.label.way-sign-in": Record<never, never>;
  "settings.note.coding-checked-again": Record<never, never>;
  "settings.note.coding-checks-unavailable": Record<never, never>;
  "settings.note.coding-connect-note": Record<never, never>;
  "settings.note.coding-connected": {
    name: "string";
  };
  "settings.note.coding-detect-note": Record<never, never>;
  "settings.note.coding-intro": Record<never, never>;
  "settings.note.coding-name-help": Record<never, never>;
  "settings.note.coding-no-connections": Record<never, never>;
  "settings.note.coding-revoke-waiting": Record<never, never>;
  "settings.note.coding-revoked-note": Record<never, never>;
  "settings.note.coding-scope-all-note": Record<never, never>;
  "settings.note.coding-scope-app-note": Record<never, never>;
  "settings.note.coding-start-note": Record<never, never>;
  "settings.notifications.changed": Record<never, never>;
  "settings.notifications.changed-failed": Record<never, never>;
  "settings.notifications.heading": Record<never, never>;
  "settings.notifications.help": Record<never, never>;
  "settings.notifications.intro": Record<never, never>;
  "settings.notifications.label": Record<never, never>;
  "settings.title.screen": Record<never, never>;
  "settings.update.deployment-unverified": Record<never, never>;
  "settings.update.heading": Record<never, never>;
  "settings.update.intro": Record<never, never>;
  "settings.update.new-version": {
    version: "string";
    os: "string";
    current: "string";
  };
  "settings.update.no-package": Record<never, never>;
  "settings.update.package-unreadable": Record<never, never>;
  "settings.update.restart-required": Record<never, never>;
  "settings.update.schema-compatible": Record<never, never>;
  "settings.update.schema-migration": Record<never, never>;
  "settings.update.schema-newer": Record<never, never>;
  "settings.update.stop-failed": Record<never, never>;
  "settings.update.stopped": Record<never, never>;
  "settings.update.system-mismatch": Record<never, never>;
  "settings.usage.loading": Record<never, never>;
};

type Area = typeof workspaceSettings;
type _SameKeys =
  | Exclude<keyof Area, keyof WorkspaceSettingsPlaceholders>
  | Exclude<keyof WorkspaceSettingsPlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;

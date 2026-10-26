// catalog/workspace-settings.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
import type { workspaceSettings } from "./workspace-settings.ts";

export type WorkspaceSettingsPlaceholders = {
  "jobs.button.delete": Record<never, never>;
  "jobs.button.hide-history": Record<never, never>;
  "jobs.button.open-all": Record<never, never>;
  "jobs.button.open-project": Record<never, never>;
  "jobs.button.show-history": Record<never, never>;
  "jobs.empty.list": Record<never, never>;
  "jobs.empty.sidebar": Record<never, never>;
  "jobs.empty.sidebar-ask": Record<never, never>;
  "jobs.error.delete": Record<never, never>;
  "jobs.error.history": Record<never, never>;
  "jobs.error.save": Record<never, never>;
  "jobs.heading.delete": {
    title: "string";
  };
  "jobs.heading.edit": Record<never, never>;
  "jobs.label.action-agent": {
    agent: "string";
  };
  "jobs.label.action-tool": Record<never, never>;
  "jobs.label.action-tool-detail": {
    app: "string";
    tool: "string";
  };
  "jobs.label.action-workflow": Record<never, never>;
  "jobs.label.action-workflow-detail": {
    project: "string";
    workflow: "string";
  };
  "jobs.label.agent-app-engineer": Record<never, never>;
  "jobs.label.agent-lophn": Record<never, never>;
  "jobs.label.agent-operator": Record<never, never>;
  "jobs.label.agent-project-manager": Record<never, never>;
  "jobs.label.at": Record<never, never>;
  "jobs.label.created-by": {
    agent: "string";
  };
  "jobs.label.created-by-place": {
    agent: "string";
    place: "string";
  };
  "jobs.label.every": Record<never, never>;
  "jobs.label.every-days": {
    n: "plural";
  };
  "jobs.label.every-days-at": {
    n: "plural";
    time: "string";
  };
  "jobs.label.every-hours": {
    n: "plural";
  };
  "jobs.label.every-minutes": {
    n: "plural";
  };
  "jobs.label.history": Record<never, never>;
  "jobs.label.if-missed": Record<never, never>;
  "jobs.label.missed-hold": Record<never, never>;
  "jobs.label.missed-option-hold": Record<never, never>;
  "jobs.label.missed-option-run": Record<never, never>;
  "jobs.label.missed-run": Record<never, never>;
  "jobs.label.next": {
    time: "string";
  };
  "jobs.label.not-yet": Record<never, never>;
  "jobs.label.sidebar-tab": Record<never, never>;
  "jobs.label.state-cancelled": Record<never, never>;
  "jobs.label.state-done": Record<never, never>;
  "jobs.label.state-failed": Record<never, never>;
  "jobs.label.state-held": Record<never, never>;
  "jobs.label.state-interrupted": Record<never, never>;
  "jobs.label.state-queued": Record<never, never>;
  "jobs.label.state-running": Record<never, never>;
  "jobs.label.state-skipped": Record<never, never>;
  "jobs.label.target": Record<never, never>;
  "jobs.label.title": Record<never, never>;
  "jobs.label.turned-off": Record<never, never>;
  "jobs.label.unit": Record<never, never>;
  "jobs.label.unit-days": Record<never, never>;
  "jobs.label.unit-hours": Record<never, never>;
  "jobs.label.unit-minutes": Record<never, never>;
  "jobs.label.waiting-decision": Record<never, never>;
  "jobs.note.at-help": Record<never, never>;
  "jobs.note.delete": Record<never, never>;
  "jobs.note.edit-readonly": {
    agent: "string";
  };
  "jobs.note.intro": Record<never, never>;
  "jobs.note.no-history": Record<never, never>;
  "jobs.note.run-cancelled": Record<never, never>;
  "jobs.note.run-done": Record<never, never>;
  "jobs.note.run-done-missed": {
    count: "plural";
  };
  "jobs.note.run-failed": Record<never, never>;
  "jobs.note.run-failed-start": {
    message: "string";
  };
  "jobs.note.run-held": Record<never, never>;
  "jobs.note.run-held-missed": {
    count: "plural";
  };
  "jobs.note.run-interrupted": Record<never, never>;
  "jobs.note.run-queued": Record<never, never>;
  "jobs.note.run-running": Record<never, never>;
  "jobs.note.run-running-missed": {
    count: "plural";
  };
  "jobs.note.run-skipped-overlap": Record<never, never>;
  "jobs.note.run-skipped-person": Record<never, never>;
  "jobs.note.run-skipped-superseded": Record<never, never>;
  "settings.appearance.accent-help": Record<never, never>;
  "settings.appearance.background-help": Record<never, never>;
  "settings.appearance.code-font-help": Record<never, never>;
  "settings.appearance.density-help": Record<never, never>;
  "settings.appearance.font-help": Record<never, never>;
  "settings.appearance.reading-width-help": Record<never, never>;
  "settings.appearance.text-size-help": Record<never, never>;
  "settings.appearance.theme-help": Record<never, never>;
  "settings.button.add-entry": Record<never, never>;
  "settings.button.add-rule": Record<never, never>;
  "settings.button.choose-in-agents": Record<never, never>;
  "settings.button.connect-with": {
    name: "string";
  };
  "settings.button.detect-again": Record<never, never>;
  "settings.button.install-hooks": Record<never, never>;
  "settings.button.remove-entry": {
    item: "string";
  };
  "settings.button.reset-default": Record<never, never>;
  "settings.button.revoke": Record<never, never>;
  "settings.button.run-checks": Record<never, never>;
  "settings.diagnostics.check-failed": Record<never, never>;
  "settings.diagnostics.last-run": {
    time: "string";
  };
  "settings.diagnostics.not-run": Record<never, never>;
  "settings.empty.coding-search": Record<never, never>;
  "settings.empty.general": Record<never, never>;
  "settings.empty.shell-rules": Record<never, never>;
  "settings.error.coding-defaults": Record<never, never>;
  "settings.error.coding-detect": Record<never, never>;
  "settings.error.coding-hooks-install": Record<never, never>;
  "settings.error.font-name": Record<never, never>;
  "settings.error.value-invalid": Record<never, never>;
  "settings.error.value-not-saved": Record<never, never>;
  "settings.error.value-out-of-range": Record<never, never>;
  "settings.error.value-unknown": Record<never, never>;
  "settings.error.value-wrong-type": Record<never, never>;
  "settings.heading.coding-defaults": Record<never, never>;
  "settings.heading.shell-rules-built-in": Record<never, never>;
  "settings.heading.shell-rules-project": {
    name: "string";
  };
  "settings.heading.shell-rules-workspace": Record<never, never>;
  "settings.intro.appearance": Record<never, never>;
  "settings.intro.coding": Record<never, never>;
  "settings.intro.diagnostics": Record<never, never>;
  "settings.intro.general": Record<never, never>;
  "settings.intro.shell-rules": Record<never, never>;
  "settings.label.accent": Record<never, never>;
  "settings.label.accent-blue": Record<never, never>;
  "settings.label.accent-green": Record<never, never>;
  "settings.label.accent-ink": Record<never, never>;
  "settings.label.accent-orange": Record<never, never>;
  "settings.label.accent-purple": Record<never, never>;
  "settings.label.add-entry": Record<never, never>;
  "settings.label.appearance-target": Record<never, never>;
  "settings.label.available": Record<never, never>;
  "settings.label.available-no": Record<never, never>;
  "settings.label.available-yes": Record<never, never>;
  "settings.label.background": Record<never, never>;
  "settings.label.background-cool": Record<never, never>;
  "settings.label.background-neutral": Record<never, never>;
  "settings.label.background-warm": Record<never, never>;
  "settings.label.checked-at": Record<never, never>;
  "settings.label.chosen-default": {
    value: "string";
  };
  "settings.label.code-font": Record<never, never>;
  "settings.label.code-font-jetbrains": Record<never, never>;
  "settings.label.code-font-system": Record<never, never>;
  "settings.label.coding-check-failed": Record<never, never>;
  "settings.label.coding-col-executable": Record<never, never>;
  "settings.label.coding-col-hooks": Record<never, never>;
  "settings.label.coding-col-product": Record<never, never>;
  "settings.label.coding-col-takes-task": Record<never, never>;
  "settings.label.coding-col-turn-end": Record<never, never>;
  "settings.label.coding-default-none": Record<never, never>;
  "settings.label.coding-default-product": Record<never, never>;
  "settings.label.coding-found": Record<never, never>;
  "settings.label.coding-hooks-failed": Record<never, never>;
  "settings.label.coding-hooks-installed": Record<never, never>;
  "settings.label.coding-hooks-missing": Record<never, never>;
  "settings.label.coding-launch-no": Record<never, never>;
  "settings.label.coding-launch-yes": Record<never, never>;
  "settings.label.coding-model": Record<never, never>;
  "settings.label.coding-not-checked": Record<never, never>;
  "settings.label.coding-not-found": Record<never, never>;
  "settings.label.coding-signal-no": Record<never, never>;
  "settings.label.coding-signal-yes": Record<never, never>;
  "settings.label.coding-stage-connect": Record<never, never>;
  "settings.label.coding-target": Record<never, never>;
  "settings.label.coding-version": {
    version: "string";
  };
  "settings.label.coding-version-unknown": Record<never, never>;
  "settings.label.component": Record<never, never>;
  "settings.label.component-agent-runtime": Record<never, never>;
  "settings.label.component-app-runtime": Record<never, never>;
  "settings.label.component-core": Record<never, never>;
  "settings.label.component-ledger": Record<never, never>;
  "settings.label.component-sandbox": Record<never, never>;
  "settings.label.default": Record<never, never>;
  "settings.label.density": Record<never, never>;
  "settings.label.density-comfortable": Record<never, never>;
  "settings.label.density-compact": Record<never, never>;
  "settings.label.font": Record<never, never>;
  "settings.label.font-custom": Record<never, never>;
  "settings.label.font-custom-name": Record<never, never>;
  "settings.label.font-pretendard": Record<never, never>;
  "settings.label.font-system": Record<never, never>;
  "settings.label.general-target": Record<never, never>;
  "settings.label.group-agents": Record<never, never>;
  "settings.label.group-general": Record<never, never>;
  "settings.label.group-system": Record<never, never>;
  "settings.label.shell-action-allow": Record<never, never>;
  "settings.label.shell-action-ask": Record<never, never>;
  "settings.label.shell-action-deny": Record<never, never>;
  "settings.label.shell-rule-action": Record<never, never>;
  "settings.label.shell-rule-pattern": Record<never, never>;
  "settings.label.shell-rules-ask-first": {
    count: "number";
  };
  "settings.label.shell-rules-blocked": {
    count: "number";
  };
  "settings.label.shell-rules-target": Record<never, never>;
  "settings.label.reading-width": Record<never, never>;
  "settings.label.reason": Record<never, never>;
  "settings.label.size-default": Record<never, never>;
  "settings.label.size-large": Record<never, never>;
  "settings.label.size-small": Record<never, never>;
  "settings.label.tab-agents": Record<never, never>;
  "settings.label.tab-appearance": Record<never, never>;
  "settings.label.tab-coding": Record<never, never>;
  "settings.label.tab-diagnostics": Record<never, never>;
  "settings.label.tab-extensions": Record<never, never>;
  "settings.label.tab-general": Record<never, never>;
  "settings.label.tab-jobs": Record<never, never>;
  "settings.label.tab-providers": Record<never, never>;
  "settings.label.tab-shell-rules": Record<never, never>;
  "settings.label.text-size": Record<never, never>;
  "settings.label.theme": Record<never, never>;
  "settings.label.theme-dark": Record<never, never>;
  "settings.label.theme-light": Record<never, never>;
  "settings.label.theme-system": Record<never, never>;
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
  "settings.label.width-narrow": Record<never, never>;
  "settings.label.width-standard": Record<never, never>;
  "settings.label.width-wide": Record<never, never>;
  "settings.note.allowed-max": {
    max: "number";
  };
  "settings.note.allowed-min": {
    min: "number";
  };
  "settings.note.allowed-range": {
    min: "number";
    max: "number";
  };
  "settings.note.coding-default-used": Record<never, never>;
  "settings.note.coding-defaults-saved": Record<never, never>;
  "settings.note.coding-detect-note": Record<never, never>;
  "settings.note.coding-hooks": Record<never, never>;
  "settings.note.coding-model": Record<never, never>;
  "settings.note.coding-signal": Record<never, never>;
  "settings.note.not-set": Record<never, never>;
  "settings.note.shell-rules-built-in": Record<never, never>;
  "settings.note.shell-rules-project": Record<never, never>;
  "settings.note.shell-rules-workspace": Record<never, never>;
  "settings.shell-density.help": Record<never, never>;
  "settings.shell-density.name": Record<never, never>;
  "settings.shell-reading_width.help": Record<never, never>;
  "settings.shell-reading_width.name": Record<never, never>;
  "settings.shell-text_size.help": Record<never, never>;
  "settings.shell-text_size.name": Record<never, never>;
  "settings.shell-theme.help": Record<never, never>;
  "settings.shell-theme.name": Record<never, never>;
  "settings.title.not-set": {
    name: "string";
  };
  "settings.title.screen": Record<never, never>;
};

type Area = typeof workspaceSettings;
type _SameKeys =
  | Exclude<keyof Area, keyof WorkspaceSettingsPlaceholders>
  | Exclude<keyof WorkspaceSettingsPlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;

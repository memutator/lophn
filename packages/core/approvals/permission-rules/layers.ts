import {
  type LocalToolTrustSetting,
  type PermissionRuleLayers,
  type PermissionRulesSetting,
  PRODUCT_FLOOR_RULES,
} from "../../../protocol/approvals/mod.ts";
import type { Workspace } from "../../../protocol/lophn-agent/workspaces.ts";

// 앱 workspace와 Home의 turn은 project 층이 없다. floor와 전역만 본다.
export function permissionRuleLayers(
  value: PermissionRulesSetting,
  workspace: Workspace | null,
): PermissionRuleLayers {
  return {
    floor: PRODUCT_FLOOR_RULES,
    global: value.global,
    project:
      workspace?.kind === "project" ? (value.projects[workspace.id] ?? []) : [],
  };
}

export function isLocalToolTrusted(
  entries: LocalToolTrustSetting,
  path: string,
  sha256: string,
): boolean {
  return entries.some(
    (entry) => entry.path === path && entry.sha256 === sha256,
  );
}

export function withTrustedLocalTool(
  entries: LocalToolTrustSetting,
  path: string,
  sha256: string,
  trustedAt: string,
): LocalToolTrustSetting {
  const filtered = entries.filter((entry) => entry.path !== path);
  return [...filtered, { path, sha256, trusted_at: trustedAt }];
}

export function withoutTrustedLocalTool(
  entries: LocalToolTrustSetting,
  path: string,
): { readonly entries: LocalToolTrustSetting; readonly removed: boolean } {
  const filtered = entries.filter((entry) => entry.path !== path);
  return { entries: filtered, removed: filtered.length !== entries.length };
}

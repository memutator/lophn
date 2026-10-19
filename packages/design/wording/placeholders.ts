// 영역별 placeholder type을 합친다. 손으로 두는 file이고, 영역 type은 generate.ts가 catalog/<영역>.placeholders.ts에 만든다.
// 영역을 더하면 import 한 줄과 `&` 한 칸을 더한다.
import type { AgentsPlaceholders } from "./catalog/agents.placeholders.ts";
import type { AppSpacePlaceholders } from "./catalog/app-space.placeholders.ts";
import type { ArtifactPlaceholders } from "./catalog/artifact.placeholders.ts";
import type { BrowserPlaceholders } from "./catalog/browser.placeholders.ts";
import type { CommonPlaceholders } from "./catalog/common.placeholders.ts";
import type { ConversationPlaceholders } from "./catalog/conversation.placeholders.ts";
import type { DataPlaceholders } from "./catalog/data.placeholders.ts";
import type { DomainPlaceholders } from "./catalog/domain.placeholders.ts";
import type { ProjectPlaceholders } from "./catalog/project.placeholders.ts";
import type { WorkspacePlaceholders } from "./catalog/workspace.placeholders.ts";
import type { WorkspaceSettingsPlaceholders } from "./catalog/workspace-settings.placeholders.ts";
import type { MessageKey } from "./en.ts";

export type PlaceholderKinds =
  & AgentsPlaceholders
  & AppSpacePlaceholders
  & ArtifactPlaceholders
  & BrowserPlaceholders
  & CommonPlaceholders
  & ConversationPlaceholders
  & DataPlaceholders
  & DomainPlaceholders
  & ProjectPlaceholders
  & WorkspacePlaceholders
  & WorkspaceSettingsPlaceholders;

type ValueFor<T> = T extends "plural" | "number" ? number
  : T extends "date" ? Date
  : string;

export type ValuesOf<K extends MessageKey> = {
  [P in keyof PlaceholderKinds[K]]: ValueFor<PlaceholderKinds[K][P]>;
};

export type HasPlaceholders<K extends MessageKey> = [
  keyof PlaceholderKinds[K],
] extends [never] ? false
  : true;

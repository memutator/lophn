// terminal 탭 kind. 복원은 종료된 자리표시이고 PTY를 만들지 않는다(shell/workspace#R7).
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("terminal"),
  key: tabKey,
  project_folder: z.string().min(1).max(4096),
});

export type TerminalLayout = z.infer<typeof layout>;
export type TerminalHint = {
  kind: "terminal";
  key: string;
  project_folder: string;
};
export type TerminalView = {
  kind: "terminal";
  key: string;
  project_folder: string;
  selected: boolean;
};

export const terminalKind = defineTabKind<
  TerminalLayout,
  TerminalHint,
  TerminalView
>({
  kind: "terminal",
  layout,
  // 사람이 새로 시작하기 전까지 PTY를 만들지 않는 종료된 자리표시다.
  restore: (tab) =>
    Promise.resolve({
      kind: "placeholder",
      key: tab.key,
      origin: tab.kind,
      title: tab.project_folder,
      reason: "app_unavailable",
    }),
  hint(raw, key) {
    // 폴더 경로는 참조로 쓰지 않는다. 슬래시 없는 짧은 이름만 받는다.
    const folder = raw.project_folder;
    if (
      typeof folder !== "string" || folder.length === 0 || folder.length > 80 ||
      folder.includes("/") || folder.includes("\\")
    ) return null;
    return { kind: "terminal", key, project_folder: folder };
  },
  scope: () => {},
  view(hint, selected, ctx) {
    if (!ctx.refOk(hint.key) || !ctx.refOk(hint.project_folder)) return null;
    return {
      kind: hint.kind,
      key: hint.key,
      project_folder: ctx.truncate(hint.project_folder),
      selected,
    };
  },
  describe: (view) => view.project_folder,
});

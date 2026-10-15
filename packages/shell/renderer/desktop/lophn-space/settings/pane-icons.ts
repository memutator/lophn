import { Bot, Palette, Zap } from "lucide-react";

import { settingsIcons } from "../../../icons/mod.ts";

// Settings 항목의 아이콘. 전용 아이콘이 `icons/settings.ts`에 생기면 그쪽으로 옮긴다.
export const paneIcons = {
  general: settingsIcons.general,
  appearance: Palette,
  providers: settingsIcons.connections,
  agents: Bot,
  tools: settingsIcons.extensions,
  coding: settingsIcons.coding,
  reactions: Zap,
  diagnostics: settingsIcons.diagnostics,
};

// 긴 글을 앞 몇 줄만 보이고 [Show more]로 펼치는 규칙. 글을 줄로 잘라 보이므로 markdown도 줄 경계에서 자른다.
import { Button } from "@lophn/ui/primitives";
import { type MessageKey, t } from "@lophn/i18n";
import { type ReactElement, useState } from "react";

export function useFold(
  text: string,
  limit: number,
  more: MessageKey = "conversation.button.fold-more",
): { shown: string; toggle: ReactElement | null } {
  const [open, setOpen] = useState(false);
  const lines = text.split("\n");
  if (lines.length <= limit) return { shown: text, toggle: null };
  return {
    shown: open ? text : lines.slice(0, limit).join("\n"),
    toggle: (
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        data-fold-toggle=""
        onClick={() => setOpen(!open)}
      >
        {t(open ? "conversation.button.fold-less" : more)}
      </Button>
    ),
  };
}

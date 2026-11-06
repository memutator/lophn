// thread index의 자료. 눈금 하나가 사람 메시지 하나이고, 숨긴 구간 안과 대기열은 들어오지 않는다(top level만 본다).
import { t } from "@lophn/i18n";
import { tokens } from "@lophn/ui";

import type { ThreadEntry } from "../agent-tab-source.ts";
import { textOfParts } from "../agent-view-model.ts";

export interface IndexItem {
  /** 사람 메시지 id. 대화 node의 `data-message`다. */
  readonly id: string;
  /** 사람이 쓴 글의 첫 줄. 글이 없으면 "Image"·"File"이다. */
  readonly title: string;
  /** 그 뒤 다음 사람 메시지 전까지의 마지막 agent 글. 답이 아직 없으면 null이다. */
  readonly reply: string | null;
  /** bookmark key. harness인데 CLI가 message id를 주지 않았으면 null이다. */
  readonly bookmark: string | null;
}

// hover card에 2줄만 보이므로 긴 답을 markdown으로 파싱하지 않는다.
const REPLY_CHARS = 600;

export function threadIndexOf(
  entries: readonly ThreadEntry[],
  harness: boolean,
): IndexItem[] {
  const items: IndexItem[] = [];
  for (const entry of entries) {
    if (entry.kind !== "message") continue;
    if (entry.actor === "user") {
      const text = textOfParts(entry.parts);
      const line = text.split("\n").find((one) => one.trim() !== "");
      items.push({
        id: entry.id,
        title:
          line?.trim() ??
          t(
            entry.parts.some((part) => part.kind === "image")
              ? "conversation.label.thread-index-image"
              : "conversation.label.thread-index-file",
          ),
        reply: null,
        bookmark: entry.origin ?? (harness ? null : entry.id),
      });
    } else if (entry.actor === "agent" && items.length > 0) {
      const text = textOfParts(entry.parts);
      if (text !== "") {
        items[items.length - 1] = {
          ...items[items.length - 1]!,
          reply: text.slice(0, REPLY_CHARS),
        };
      }
    }
  }
  return items;
}

/** 눈금을 `max`개 안으로 고르게 줄인다. 처음, 끝, `keep`은 남긴다. 원래 순서의 index를 돌려준다. */
export function sampleIndexes(
  count: number,
  max: number,
  keep: ReadonlySet<number>,
): number[] {
  if (count <= max) return Array.from({ length: count }, (_, index) => index);
  const picked = new Set<number>([0, count - 1, ...keep]);
  for (let slot = 0; slot < max; slot += 1) {
    picked.add(Math.round((slot * (count - 1)) / (max - 1)));
  }
  return [...picked].sort((a, b) => a - b);
}

/** 눈금 하나가 차지하는 높이(`--space-5`). css의 눈금 단추 높이와 같다. */
export const RAIL_PITCH = Number.parseFloat(tokens.space[5]);
/** 왼쪽 여백이 이보다 좁으면 눈금이 글 위에 겹치므로 숨긴다. */
export const RAIL_MIN_MARGIN = Number.parseFloat(tokens.space[11]);
/** 맨 위 이만큼은 header 몫이라 "화면에 보인다"에서 뺀다. */
export const RAIL_HEADER = Number.parseFloat(tokens.space[8]);

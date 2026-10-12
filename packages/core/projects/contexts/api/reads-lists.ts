// context API 읽기: context.violations·bundles·glossary.list.
import { ok } from "../../../../base/mod.ts";
import type { ViolationKey } from "../../../../protocol/projects/mod.ts";
import type { ContextApiReads } from "./reads.ts";
import {
  checkReader,
  common,
  compareText,
  notFound,
  pageByKey,
} from "./reads-common.ts";
import type { ContextApiState } from "./state.ts";

type Handlers = Pick<
  ContextApiReads,
  "contextViolations" | "contextBundles" | "glossaryList"
>;

const utf8 = new TextEncoder();

// ASCII 대문자만 소문자로 접는다. 비ASCII 글자는 그대로 둔다.
function foldAscii(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

// UTF-8 byte 순.
function compareBytes(a: string, b: string): number {
  const left = utf8.encode(a);
  const right = utf8.encode(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  }
  return left.length - right.length;
}

const keyText = (key: ViolationKey) =>
  JSON.stringify([key.kind, key.rule, key.path, key.section]);

// 이 context에서 Context Engineer에게 넘긴 적 있는 위반의 키. 넘김 event의 payload에서 모은다.
function handedOffKeys(state: ContextApiState, context: string): Set<string> {
  const keys = new Set<string>();
  for (const event of state.events) {
    if (
      event.type !== "ContextViolationsHandedOff" || event.subject !== context
    ) continue;
    for (const key of event.payload.violations as ViolationKey[]) {
      keys.add(keyText(key));
    }
  }
  return keys;
}

export function createListReads(state: ContextApiState): Handlers {
  const contextViolations: Handlers["contextViolations"] = (
    { actor, input },
  ) => {
    const allowed = checkReader(actor);
    if (!allowed.ok) return allowed;
    if (!state.contexts.has(input.context)) {
      return notFound("context", input.context);
    }
    // 같은 key의 위반이 겹쳐도 순서가 정해지도록 나머지 필드도 키에 넣는다.
    const keyOf = (v: {
      path: string;
      kind: string;
      rule: string | null;
      section: string | null;
      target: string | null;
      type: string | null;
    }) => [
      v.path,
      v.kind,
      v.rule ?? "",
      v.section ?? "",
      v.target ?? "",
      v.type ?? "",
    ];
    const rows = [...(state.violations.get(input.context) ?? [])];
    const keyed = rows.map((row) => ({ row, key: keyOf(row) }));
    keyed.sort((a, b) => {
      for (let i = 0; i < a.key.length; i++) {
        const diff = compareText(a.key[i]!, b.key[i]!);
        if (diff !== 0) return diff;
      }
      return 0;
    });
    const page = pageByKey(
      keyed,
      (item) => item.key,
      `context.violations ${input.context}`,
      input,
    );
    if (!page.ok) return page;
    const handedOff = handedOffKeys(state, input.context);
    return ok({
      context: input.context,
      violations: page.value.items.map(({ row }) => ({
        ...row,
        handed_off: handedOff.has(keyText(row)),
      })),
      as_of_seq: String(state.seq),
      complete: page.value.complete,
      next_cursor: page.value.next_cursor,
    });
  };

  const contextBundles: Handlers["contextBundles"] = ({ actor, input }) => {
    const allowed = checkReader(actor);
    if (!allowed.ok) return allowed;
    if (!state.contexts.has(input.context)) {
      return notFound("context", input.context);
    }
    // 버린 draft는 판 이력이 아니다. 번호 없는 draft가 맨 앞, 번호 있는 판은 내림차순이다.
    const rows = [...state.bundles.values()].filter((bundle) =>
      bundle.context === input.context && bundle.status !== "discarded"
    );
    const keyOf = (bundle: { number: number | null; id: string }) =>
      bundle.number === null
        ? [0, 0, bundle.id]
        : [1, -bundle.number, bundle.id];
    rows.sort((a, b) => {
      const left = keyOf(a);
      const right = keyOf(b);
      return (left[0] as number) - (right[0] as number) ||
        (left[1] as number) - (right[1] as number) ||
        compareText(a.id, b.id);
    });
    const page = pageByKey(
      rows,
      keyOf,
      `context.bundles ${input.context}`,
      input,
    );
    if (!page.ok) return page;
    return ok({
      context: input.context,
      bundles: page.value.items.map(({ content: _content, ...bundle }) => ({
        bundle,
        check: bundle.check === null
          ? null
          : state.checks.get(bundle.check) ?? null,
      })),
      as_of_seq: String(state.seq),
      complete: page.value.complete,
      next_cursor: page.value.next_cursor,
    });
  };

  const glossaryList: Handlers["glossaryList"] = ({ actor, input }) => {
    const allowed = checkReader(actor);
    if (!allowed.ok) return allowed;
    if (!state.contexts.has(input.context)) {
      return notFound("context", input.context);
    }
    const entries = [...state.glossary.values()]
      .filter((entry) => entry.context === input.context)
      .sort((a, b) =>
        compareBytes(foldAscii(a.term), foldAscii(b.term)) ||
        compareText(a.id, b.id)
      );
    return ok({ context: input.context, entries, ...common(state) });
  };

  return { contextViolations, contextBundles, glossaryList };
}

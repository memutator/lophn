// Composition 트리: 개체마다 어느 자료(경로 포함)로 이루어지고 무엇을 가지며 무엇과 이어지는지.
// 경로는 보이고 계약 말은 쓰지 않는다.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.heading.composition-title
//   contexts.label.composition-documents
//   contexts.label.composition-folders
//   contexts.label.composition-from-section
//   contexts.label.composition-has
//   contexts.label.composition-link
//   contexts.label.composition-link-outside
//   contexts.label.composition-links
//   contexts.label.composition-uses
//   common.error.load-failed
// 문구는 context-composition-nodes.ts가 만든다. 이 파일은 읽기와 그리기를 맡는다.
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { t } from "@lophn/wording";

import styles from "./context-composition.module.css";
import {
  type CompositionNode,
  compositionTree,
} from "./context-composition-nodes.ts";
import type { ContextsSource } from "./source.ts";

interface ContextCompositionProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
}

type Load =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "loaded"; readonly root: CompositionNode };

async function load(
  source: ContextsSource,
  context: string,
): Promise<CompositionNode | null> {
  const [overview, contract] = await Promise.all([
    source.overview(context),
    source.contract(context),
  ]);
  if (!overview.ok || !contract.ok) return null;
  return compositionTree(
    overview.value.context,
    contract.value.content,
    overview.value,
  );
}

/** 처음에는 뿌리와 개체 줄이 펼쳐 있다. 개체 아래 줄은 잎이다. */
function initiallyOpen(root: CompositionNode): ReadonlySet<string> {
  return new Set([root.id, ...(root.children ?? []).map((node) => node.id)]);
}

export function ContextComposition(
  { source, context }: ContextCompositionProps,
): ReactNode {
  const [result, setResult] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setResult({ state: "loading" });
    setAttempt((count) => count + 1);
  }, []);

  useEffect(() => {
    let current = true;
    load(source, context).then(
      (root) => {
        if (current) {
          setResult(
            root === null ? { state: "failed" } : { state: "loaded", root },
          );
        }
      },
      () => {
        if (current) setResult({ state: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [source, context, attempt]);

  const title = t("contexts.heading.composition-title");
  return (
    <section className={styles.composition} data-composition>
      <h2 className={styles.title}>{title}</h2>
      <Loading
        loading={result.state === "loading"}
        placeholder={<Skeleton lines={4} />}
      >
        {result.state === "failed" && (
          <ErrorState target={title} onRetry={retry} />
        )}
        {result.state === "loaded" && <Tree root={result.root} />}
      </Loading>
    </section>
  );
}

function Tree({ root }: { readonly root: CompositionNode }): ReactNode {
  const [open, setOpen] = useState(() => initiallyOpen(root));
  const toggle = (id: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <ul
      role="tree"
      aria-label={t("contexts.heading.composition-title")}
      className={styles.tree}
    >
      <Branch node={root} open={open} onToggle={toggle} />
    </ul>
  );
}

function Branch(
  { node, open, onToggle }: {
    readonly node: CompositionNode;
    readonly open: ReadonlySet<string>;
    readonly onToggle: (id: string) => void;
  },
): ReactNode {
  const children = node.children ?? [];
  if (children.length === 0) {
    return (
      <li role="treeitem" className={styles.item}>
        <span className={styles.leaf} data-node-label>{node.label}</span>
      </li>
    );
  }
  const expanded = open.has(node.id);
  return (
    <li role="treeitem" aria-expanded={expanded} className={styles.item}>
      <button
        type="button"
        className={styles.branch}
        onClick={() => onToggle(node.id)}
      >
        <span className={styles.twisty} aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
        <span data-node-label>{node.label}</span>
      </button>
      {expanded && (
        <ul role="group" className={styles.group}>
          {children.map((child) => (
            <Branch
              key={child.id}
              node={child}
              open={open}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

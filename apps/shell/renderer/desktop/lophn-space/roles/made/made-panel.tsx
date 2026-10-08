import { useEffect, useMemo, useState } from "react";
import {
  EmptyState,
  ErrorState,
  lophnSpaceIcons,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { ResultLinks } from "../../../../conversation/result-links.tsx";
import type { ResultLink } from "../../../../conversation/source.ts";
import type { MadeLink, RoleRow, RolesSource } from "../source.ts";
import styles from "../roles.module.css";

export interface MadePanelProps {
  source: RolesSource;
  role: RoleRow;
  connected: number;
  onRead: (document: string, version: string | null) => void;
  onOpenConversation: () => void;
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly links: readonly MadeLink[] };

function linkOf(made: MadeLink): ResultLink {
  return made.version === null
    ? { kind: "document", document: made.document }
    : { kind: "version", document: made.document, version: made.version };
}

// 만든 것. 이 역할이 실제로 만들거나 바꾼 문서다. 4개 이상이면 첫 3개와 남은 개수, 나머지 보기로
// 접는다(shell/desktop#R3). 대화를 한 번도 열지 않아도 같은 결과를 찾아 연다.
export function MadePanel(
  { source, role, connected, onRead, onOpenConversation }: MadePanelProps,
) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void source.made(role).then((result) => {
      if (!live) return;
      setLoaded((previous) =>
        result.ok
          ? { kind: "ready", links: result.value }
          : previous.kind === "ready"
          ? previous
          : { kind: "failed" }
      );
    });
    return () => {
      live = false;
    };
  }, [source, role, connected, attempt]);

  const titles = useMemo(
    () => ({ documentTitle: source.documentTitle }),
    [source],
  );
  return (
    <div className={styles.panel} data-made-panel="">
      {loaded.kind === "failed"
        ? (
          <ErrorState
            target={t("roles.label.target-made")}
            onRetry={() => setAttempt((value) => value + 1)}
          />
        )
        : null}
      {loaded.kind === "ready" && loaded.links.length === 0
        ? (
          <EmptyState
            icon={lophnSpaceIcons.documents}
            message={t("roles.empty.no-made")}
            action={{
              label: t("roles.button.open-conversation"),
              onSelect: onOpenConversation,
            }}
          />
        )
        : null}
      {loaded.kind === "ready" && loaded.links.length > 0
        ? (
          <ResultLinks
            links={loaded.links.map(linkOf)}
            source={titles}
            onOpen={onRead}
          />
        )
        : null}
    </div>
  );
}

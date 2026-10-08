import {
  EmptyState,
  ErrorState,
  Icon,
  iconPixels,
  lophnSpaceIcons,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { roleTitle, STATE_LABEL } from "../labels.ts";
import type { RoleRow } from "../source.ts";
import styles from "../../documents/documents.module.css";

export interface RoleListProps {
  loaded:
    | { readonly kind: "loading" }
    | { readonly kind: "failed" }
    | { readonly kind: "ready"; readonly rows: readonly RoleRow[] };
  names: Readonly<Record<string, string>>;
  current: string | null;
  onOpen: (id: string) => void;
  onRetry: () => void;
}

// 역할 목록. 다른 목록 화면과 같은 열 배치다(shell/desktop#R4). 역할 이름과 붙은 곳, 상태, Preset 이름만
// 보이고 안쪽 구성은 없다.
export function RoleList(
  { loaded, names, current, onOpen, onRetry }: RoleListProps,
) {
  return (
    <div className={styles.section} data-role-list="">
      {loaded.kind === "failed"
        ? <ErrorState target={t("roles.label.target-list")} onRetry={onRetry} />
        : null}
      {loaded.kind === "ready" && loaded.rows.length === 0
        ? (
          <EmptyState
            icon={lophnSpaceIcons.roles}
            message={t("roles.empty.no-roles")}
            action={{ label: t("roles.button.reload"), onSelect: onRetry }}
          />
        )
        : null}
      {loaded.kind === "ready" && loaded.rows.length > 0
        ? (
          <ul className={styles.rows}>
            {loaded.rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={styles.row}
                  data-role={row.id}
                  data-state={row.state}
                  aria-current={row.id === current ? "true" : undefined}
                  onClick={() => onOpen(row.id)}
                >
                  <span className={styles.rowHead}>
                    <Icon
                      icon={lophnSpaceIcons.roles}
                      pixels={iconPixels("base")}
                      className={styles.rowIcon}
                    />
                    <span className={styles.rowTitle}>
                      {roleTitle(row, names)}
                    </span>
                  </span>
                  <span className={styles.meta}>
                    <span>{t(STATE_LABEL[row.state])}</span>
                    {row.presetName === null ? null : (
                      <span>
                        {t("roles.label.list-preset", {
                          name: row.presetName,
                        })}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
        : null}
    </div>
  );
}

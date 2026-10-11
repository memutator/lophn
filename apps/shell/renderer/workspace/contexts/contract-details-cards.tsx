// 개체 카드 하나: 이름·public 표시·kind·경로·문서 수, 그다음 Fields와 Relations(관계가 있을 때만).
import type { ReactNode } from "react";
import { Card } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type {
  FieldLine,
  RelationLine,
  TypeCardModel,
} from "./contract-details-model.ts";
import styles from "./contract-details.module.css";

export function TypeCard(
  { card }: { readonly card: TypeCardModel },
): ReactNode {
  return (
    <div data-type-card={card.name}>
      <Card>
        <div className={styles.cardHead}>
          <h3>{card.name}</h3>
          {card.isPublic
            ? (
              <span className={styles.mark} data-public>
                {t("contexts.label.contract-public")}
              </span>
            )
            : null}
          <span className={styles.chip} data-type-kind>
            {t("contexts.label.contract-kind", { kind: card.kind })}
          </span>
          {card.count === null
            ? null
            : (
              <span className={styles.muted} data-type-count>
                {t("contexts.label.contract-documents", { count: card.count })}
              </span>
            )}
        </div>
        <p className={styles.path} data-type-path>{card.path}</p>
        <h4 className={styles.label}>
          {t("contexts.heading.contract-fields")}
        </h4>
        <ul className={styles.rows} data-fields>
          {card.fields.map((field) => (
            <FieldItem key={field.name} field={field} />
          ))}
        </ul>
        {card.relations.length === 0 ? null : (
          <>
            <h4 className={styles.label}>
              {t("contexts.heading.contract-relations")}
            </h4>
            <ul className={styles.rows} data-relations>
              {card.relations.map((relation) => (
                <RelationItem key={relation.name} relation={relation} />
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

function FieldItem({ field }: { readonly field: FieldLine }): ReactNode {
  return (
    <li>
      {fieldText(field)}
      {field.isPublic
        ? (
          <>
            {" "}
            <span className={styles.mark} data-field-public>
              {t("contexts.label.contract-public")}
            </span>
          </>
        )
        : null}
    </li>
  );
}

function fieldText(field: FieldLine): string {
  if (field.values !== null) {
    return t("contexts.label.contract-field-values", {
      name: field.name,
      values: field.values,
    });
  }
  if (field.section !== null) {
    return t("contexts.label.contract-field-section", {
      name: field.name,
      heading: field.section,
    });
  }
  return field.name;
}

function RelationItem(
  { relation }: { readonly relation: RelationLine },
): ReactNode {
  return (
    <li>
      {t("contexts.label.contract-relation", {
        name: relation.name,
        target: relation.target,
      })}
      {relation.isPublic
        ? (
          <>
            {" "}
            <span className={styles.mark} data-relation-public>
              {t("contexts.label.contract-public")}
            </span>
          </>
        )
        : null}
    </li>
  );
}

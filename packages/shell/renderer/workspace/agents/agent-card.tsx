// 명함의 줄들. 목록 카드와 editor가 같이 쓴다. 명함은 core가 계산해 준 값을 그대로 보인다(목적은 두 화면이 따로 보인다).
import { t } from "@lophn/i18n";
import type { ReactElement } from "react";
import type { AgentCard } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import type { Modality } from "../../../../protocol/lophn-agent/agent-values.ts";
import styles from "./agent-card.module.css";

export const modalityLabel = (modality: Modality): string =>
  modality === "text"
    ? t("agents.label.modality-text")
    : modality === "image"
      ? t("agents.label.modality-image")
      : t("agents.label.modality-file");

const replyLabel = (reply: AgentCard["replies"][number]): string =>
  reply === "none"
    ? t("agents.label.reply-none")
    : reply === "result"
      ? t("agents.label.reply-result")
      : t("agents.label.reply-conversation");

const list = (items: readonly string[]): string => items.join(", ");

export function CardFacts({ card }: { card: AgentCard }): ReactElement {
  return (
    <ul className={styles.facts} data-agent-card-facts="">
      <li data-card-runtime="">
        {t("agents.label.card-runtime", {
          runtime:
            card.runtime === "bare"
              ? t("agents.label.runtime-bare")
              : t("agents.label.runtime-lophn"),
        })}
      </li>
      <li data-card-modality="">
        {t("agents.label.card-modality", {
          input: list(card.modality.input.map(modalityLabel)),
          output: list(card.modality.output.map(modalityLabel)),
        })}
      </li>
      <li data-card-replies="">
        {t("agents.label.card-replies", {
          replies: list(card.replies.map(replyLabel)),
        })}
      </li>
      {card.diff.plus.length === 0 ? null : (
        <li data-card-plus="">
          {t("agents.label.card-plus", { items: list(card.diff.plus) })}
        </li>
      )}
      {card.diff.minus.length === 0 ? null : (
        <li data-card-minus="">
          {t("agents.label.card-minus", { items: list(card.diff.minus) })}
        </li>
      )}
      {card.notes.map((note) => (
        <li key={note} data-card-note="">
          {note}
        </li>
      ))}
    </ul>
  );
}

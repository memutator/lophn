import { createContext, type ReactNode, useContext } from "react";
import { componentMark } from "../../_shared/shared.ts";
import styles from "./card.module.css";

const InsideCard = createContext(false);

export interface CardProps {
  children: ReactNode;
}

// 독립 객체 하나만 카드로 묶는다. 카드 안 카드는 만들지 않는다.
export function Card({ children }: CardProps) {
  if (useContext(InsideCard)) throw new Error("Card cannot be nested");
  return (
    <InsideCard.Provider value>
      <div className={styles.card} {...componentMark("Card")}>{children}</div>
    </InsideCard.Provider>
  );
}

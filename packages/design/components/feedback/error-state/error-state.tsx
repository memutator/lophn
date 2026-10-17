import { CircleX } from "lucide-react";
import { t } from "@lophn/wording";
import { Button } from "../../primitives/button/button.tsx";
import { Icon } from "../../primitives/icon/icon.tsx";
import { componentMark, iconPixels } from "../../_shared/shared.ts";
import styles from "../state.module.css";

export interface ErrorStateProps {
  // 불러오지 못한 대상의 사람 말 이름. 원인은 추측하지 않는다.
  target: string;
  onRetry: () => void;
}

export function ErrorState({ target, onRetry }: ErrorStateProps) {
  return (
    <div
      className={styles.state}
      data-state="error"
      {...componentMark("ErrorState")}
    >
      <Icon
        icon={CircleX}
        pixels={iconPixels("large")}
        className={styles.critical}
      />
      <p className={styles.message}>
        {t("common.error.load-failed", { target })}
      </p>
      <Button onClick={onRetry}>{t("common.button.reload")}</Button>
    </div>
  );
}

import { Component, type ReactNode } from "react";
import { CircleX } from "lucide-react";
import { t } from "@lophn/i18n";
import { Button, Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";

import styles from "./tab-boundary.module.css";

interface Props {
  children: ReactNode;
}

// 탭 본문을 그리다 난 예외를 그 탭 자리에 가둔다. 없으면 한 탭의 throw가 shell 창 전체를 비운다.
// 탭을 바꿔도 이어지지 않게 부르는 쪽이 key={tab.key}를 준다. [Try again]은 본문을 새로 mount한다.
export class TabBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error("tab body failed to render", error);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={styles.failed} data-tab-failed="">
        <Icon
          icon={CircleX}
          pixels={iconPixels("large")}
          className={styles.icon}
        />
        <p className={styles.message}>{t("common.error.show-failed")}</p>
        <Button onClick={() => this.setState({ failed: false })}>
          {t("common.button.retry")}
        </Button>
      </div>
    );
  }
}

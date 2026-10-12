import { Component, type ReactNode } from "react";
import { CircleX } from "lucide-react";
import { t } from "@lophn/wording";
import { Button, Icon, iconPixels } from "@lophn/design/components";
import styles from "./state.module.css";

// 앱 preload가 main world에서 듣는 DOM event다(packages/shell/preload/app-api.ts). detail은 {name, message}다.
export const RENDER_ERROR_EVENT = "lophn:render-error";

export interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

function described(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}

// 앱 화면 root의 오류 경계(apps/sdk#R29). 잡은 render 오류를 window의 event로 넘겨 플랫폼 오류 수집이
// 받게 하고, 빈 화면 대신 한 문장과 [Try again]을 보인다. 원문 오류는 화면에 두지 않는다(shell/wording#R8).
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  // 앱 화면의 window(main world)에 보낸다. 페이지 문서의 defaultView가 그 window다.
  override componentDidCatch(error: unknown): void {
    document.defaultView?.dispatchEvent(
      new CustomEvent(RENDER_ERROR_EVENT, { detail: described(error) }),
    );
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={styles.failed} data-state="error">
        <Icon
          icon={CircleX}
          pixels={iconPixels("large")}
          className={styles.critical}
        />
        <p className={styles.message}>{t("common.error.show-failed")}</p>
        <Button onClick={() => this.setState({ failed: false })}>
          {t("common.button.retry")}
        </Button>
      </div>
    );
  }
}

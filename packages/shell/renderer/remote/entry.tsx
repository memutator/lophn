// phone 화면 bundle의 입구. phone 껍데기가 `globalThis.lophnRemote`(CoreSource)를 넣고 이 page를 연다.
// desktop의 chrome.css(창 끌기, 글 고르기 막기)는 싣지 않는다.
import { createRoot } from "react-dom/client";
import { t } from "@lophn/i18n";
import "@lophn/ui/tokens.css";
import "@lophn/ui/base.css";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { RemoteApp } from "./remote-app.tsx";
import { remoteChat } from "./chat/remote-chat.tsx";
import styles from "./remote.module.css";

declare global {
  interface ImportMeta {
    readonly env: { readonly DEV: boolean };
  }
  // phone 껍데기가 넣는 bridge. 연결, 다시 붙기, `watch` 다시 보내기는 그 뒤의 일이다.
  var lophnRemote: CoreSource | undefined;
}

const bridge = globalThis.lophnRemote;
// build.ts가 prod에서 DEV를 false로 접어 개발용 bridge가 bundle에서 빠진다.
const Dev =
  bridge === undefined && import.meta.env.DEV
    ? (await import("./dev/dev-remote.tsx")).DevRemote
    : null;

const chat = remoteChat();
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    bridge !== undefined ? (
      <RemoteApp source={bridge} chat={chat} />
    ) : Dev !== null ? (
      <Dev chat={chat} />
    ) : (
      <div className={styles.center}>
        <p>{t("remote.notice.no-bridge")}</p>
      </div>
    ),
  );
}

// 개발 build에서 phone 껍데기 없이 연 화면. pairing이 없거나 주소에 `pair`가 있으면 QR 내용을 붙여 넣는 화면을 먼저 보인다.
import { type ComponentType, useMemo, useState } from "react";
import { t } from "@lophn/i18n";
import { Field, Textarea } from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";
import { actionIcons } from "../../icons/action.ts";
import { type RemoteChatProps, RemoteApp } from "../remote-app.tsx";
import styles from "../remote.module.css";
import {
  type DevPairing,
  devBridge,
  pairDev,
  storedPairing,
} from "./bridge.ts";

function Pair({ onPaired }: { onPaired: (pairing: DevPairing) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  return (
    <div className={styles.center}>
      <h1 className={styles.headTitle}>{t("remote.heading.pair")}</h1>
      <p className={styles.headSub}>{t("remote.notice.pair")}</p>
      <Field label={t("remote.label.pairing-text")} error={error}>
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      <Button
        variant="primary"
        icon={actionIcons.connect}
        disabled={busy || text.trim() === ""}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            onPaired(await pairDev(text.trim()));
          } catch (failed) {
            setError(
              failed instanceof SyntaxError ||
                (failed as Error).name === "ZodError"
                ? t("remote.error.pair-invalid")
                : t("remote.error.pair-failed", {
                    reason: (failed as Error).message,
                  }),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("remote.button.pair")}
      </Button>
    </div>
  );
}

export function DevRemote({ chat }: { chat: ComponentType<RemoteChatProps> }) {
  const [pairing, setPairing] = useState(() =>
    new URLSearchParams(location.search).has("pair") ? null : storedPairing(),
  );
  const source = useMemo(
    () => (pairing === null ? null : devBridge(pairing)),
    [pairing],
  );
  return source === null ? (
    <Pair onPaired={setPairing} />
  ) : (
    <RemoteApp source={source} chat={chat} />
  );
}

// 개발 build에서 phone 껍데기 없이 연 화면. pairing이 없거나 주소에 `pair`가 있으면 QR 내용을 붙여 넣는 화면을 먼저 보인다.
// `npm run dev:remote`가 찍는 주소는 `#pair=<QR 내용>`을 실어 열자마자 그 code로 pairing한다.
import { type ComponentType, useEffect, useMemo, useState } from "react";
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

function Pair({
  initial,
  onPaired,
}: {
  initial: string;
  onPaired: (pairing: DevPairing) => void;
}) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const submit = async (value: string) => {
    setBusy(true);
    setError(undefined);
    try {
      onPaired(await pairDev(value));
    } catch (failed) {
      setError(
        failed instanceof SyntaxError || (failed as Error).name === "ZodError"
          ? t("remote.error.pair-invalid")
          : t("remote.error.pair-failed", {
              reason: (failed as Error).message,
            }),
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (initial !== "") void submit(initial);
  }, []);
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
        onClick={() => void submit(text.trim())}
      >
        {t("remote.button.pair")}
      </Button>
    </div>
  );
}

export function DevRemote({ chat }: { chat: ComponentType<RemoteChatProps> }) {
  // code는 한 번만 쓰이므로 읽은 뒤 주소에서 지운다(다시 읽으면 저장한 pairing으로 붙는다).
  const [fromUrl] = useState(() => {
    const value = new URLSearchParams(location.hash.slice(1)).get("pair");
    if (value !== null) history.replaceState(null, "", location.pathname);
    return value ?? "";
  });
  const [pairing, setPairing] = useState(() =>
    fromUrl !== "" || new URLSearchParams(location.search).has("pair")
      ? null
      : storedPairing(),
  );
  const source = useMemo(
    () => (pairing === null ? null : devBridge(pairing)),
    [pairing],
  );
  return source === null ? (
    <Pair initial={fromUrl} onPaired={setPairing} />
  ) : (
    <RemoteApp source={source} chat={chat} />
  );
}

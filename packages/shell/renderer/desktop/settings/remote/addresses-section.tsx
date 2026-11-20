// Settings › Remote › Addresses: `remote.addresses`, the direct addresses (Tailscale names, domains, IPs) that other devices
// try before this computer's own network addresses. The person saves right away; only a lophn agent's change asks first.
import { t } from "@lophn/i18n";
import { Input } from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";
import { Fragment, useCallback, useState } from "react";

import { actionIcons } from "../../../icons/mod.ts";
import { useStateChanged } from "../../connection/core-read.ts";
import styles from "../settings.module.css";
import { validAddress } from "./addresses.ts";
import type { RemoteSettingsSource } from "./source.ts";

/** `at` is the index being edited, `list.length` is a new address. */
type Editing = { readonly at: number; readonly text: string };

export function AddressesSection({ source }: { source: RemoteSettingsSource }) {
  const [list, setList] = useState<readonly string[] | "failed" | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [problem, setProblem] = useState<"invalid" | "not-saved" | null>(null);

  const load = useCallback(() => {
    void source.addresses().then((read) => {
      setList(read.ok ? read.value : "failed");
    });
  }, [source]);
  useStateChanged(["settings"], load);

  if (list === null) return null;
  if (list === "failed") {
    return (
      <p className={styles.notice} data-remote-addresses="failed">
        {t("settings.error.remote-load-failed")}
      </p>
    );
  }

  async function write(next: readonly string[]): Promise<boolean> {
    const saved = await source.setAddresses(next);
    setProblem(saved.ok ? null : "not-saved");
    if (saved.ok) setList(next);
    return saved.ok;
  }

  async function submit(current: readonly string[], draft: Editing) {
    const text = draft.text.trim();
    const others = current.filter((_, index) => index !== draft.at);
    if (!validAddress(text, others)) {
      setProblem("invalid");
      return;
    }
    const next = [...current];
    next[draft.at] = text;
    if (await write(next)) setEditing(null);
  }

  const form = (current: readonly string[], draft: Editing) => (
    <li className={styles.line} data-remote-address-form="">
      <div className={styles.lineMain}>
        <Input
          aria-label={t("settings.label.remote-address")}
          placeholder={t("settings.placeholder.remote-address")}
          value={draft.text}
          autoFocus
          data-remote-address-input=""
          onChange={(event) => {
            setProblem(null);
            setEditing({ ...draft, text: event.target.value });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit(current, draft);
            if (event.key === "Escape") {
              setEditing(null);
              setProblem(null);
            }
          }}
        />
        {problem === null ? null : (
          <p className={styles.rejected} role="alert">
            {t(
              problem === "invalid"
                ? "settings.error.remote-address-invalid"
                : "settings.error.remote-addresses-not-saved",
            )}
          </p>
        )}
      </div>
      <div className={styles.lineControl}>
        <div className={styles.actions}>
          <Button
            onClick={() => {
              setEditing(null);
              setProblem(null);
            }}
          >
            {t("settings.button.cancel")}
          </Button>
          <Button
            variant="primary"
            icon={actionIcons.save}
            data-remote-address-save=""
            onClick={() => void submit(current, draft)}
          >
            {t("settings.button.save")}
          </Button>
        </div>
      </div>
    </li>
  );

  return (
    <div data-remote-addresses="">
      <p className={styles.lineHelp}>{t("settings.note.remote-addresses")}</p>
      <ul className={styles.lines}>
        {list.map((address, index) =>
          editing?.at === index ? (
            <Fragment key={address}>{form(list, editing)}</Fragment>
          ) : (
            <li
              key={address}
              className={styles.line}
              data-remote-address={address}
            >
              <div className={styles.lineMain}>
                <span className={`${styles.lineName} ${styles.mono}`}>
                  {address}
                </span>
              </div>
              <div className={styles.lineControl}>
                <div className={styles.actions}>
                  <Button
                    icon={actionIcons.remove}
                    data-remote-address-remove=""
                    onClick={() =>
                      void write(list.filter((_, at) => at !== index))
                    }
                  >
                    {t("settings.button.remote-address-remove")}
                  </Button>
                  <Button
                    icon={actionIcons.edit}
                    data-remote-address-edit=""
                    onClick={() => {
                      setProblem(null);
                      setEditing({ at: index, text: address });
                    }}
                  >
                    {t("settings.button.remote-address-edit")}
                  </Button>
                </div>
              </div>
            </li>
          ),
        )}
        {editing?.at === list.length ? form(list, editing) : null}
      </ul>
      {editing === null && problem === "not-saved" ? (
        <p className={styles.rejected} role="alert">
          {t("settings.error.remote-addresses-not-saved")}
        </p>
      ) : null}
      {list.length === 0 && editing === null ? (
        <p className={styles.lineHelp} data-remote-addresses-empty="">
          {t("settings.note.remote-addresses-empty")}
        </p>
      ) : null}
      {editing === null ? (
        <Button
          icon={actionIcons.add}
          data-remote-address-add=""
          disabled={list.length >= 16}
          onClick={() => {
            setProblem(null);
            setEditing({ at: list.length, text: "" });
          }}
        >
          {t("settings.button.remote-address-add")}
        </Button>
      ) : null}
    </div>
  );
}

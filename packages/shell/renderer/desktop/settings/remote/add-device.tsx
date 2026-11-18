// Settings › Remote의 Add a device. [Invite a phone]·[Invite a computer]는 초대장을 바로 내고 QR, "Show as text", 끝나는 때,
// [New invite]를 보인다. 새 기기의 터미널 입력(기본 켬)과, 컴퓨터면 수명(이 컴퓨터와 같은 때 켜질 수 없으면 7일, 기본 30분)을 같은
// 자리에서 바꾸고, 바꾸면 그 값으로 새 초대장을 낸다. 초대장이 보이는 동안 명단에 새 기기가 서면 초대장을 닫는다.
// [Join with an invite]는 다른 컴퓨터가 보인 글을 붙여 이 컴퓨터가 그 명단에 든다.
import { formatRelativeTime, t } from "@lophn/i18n";
import { Field, Switch, Textarea } from "@lophn/ui/input";
import { Toast } from "@lophn/ui/overlay";
import { Button, CopyButton } from "@lophn/ui/primitives";
import { systemClipboard } from "@lophn/ui/shared";
import { useEffect, useState } from "react";

import { actionIcons, modalityIcons } from "../../../icons/mod.ts";
import styles from "../settings.module.css";
import { QrCode } from "./qr-code.tsx";
import remoteStyles from "./remote.module.css";
import type {
  JoinOutcome,
  RemoteDevice,
  RemoteInvite,
  RemoteSettingsSource,
} from "./source.ts";

type Kind = "phone" | "computer";

type Invite =
  | { readonly state: "idle" }
  // 켠 직후에는 core가 listener를 여는 중이라 초대장을 못 낸다(`unavailable`). 그동안 기다리며 다시 부른다.
  | { readonly state: "starting"; readonly kind: Kind }
  | { readonly state: "failed"; readonly kind: Kind }
  | {
      readonly state: "shown";
      readonly kind: Kind;
      readonly invite: RemoteInvite;
      /** 초대장을 낼 때 있던 기기. 이 밖의 기기가 보이면 들어온 것이다. */
      readonly known: ReadonlySet<string>;
    };

type Join =
  | { readonly state: "closed" }
  | {
      readonly state: "open";
      readonly busy: boolean;
      readonly failed: Extract<JoinOutcome, { ok: false }>["reason"] | null;
    };

const START_TRIES = 5;
const START_WAIT_MS = 1000;
// 이보다 짧게 남으면 분:초로 센다. 긴 초대장은 "in 7 days"로 말한다.
const COUNTDOWN_MS = 60 * 60 * 1000;

const JOIN_ERRORS = {
  invalid_text: "settings.error.remote-join-invalid-text",
  expired: "settings.error.remote-join-expired",
  used: "settings.error.remote-join-used",
  untrusted: "settings.error.remote-join-untrusted",
  removed: "settings.error.remote-join-removed",
  this_computer: "settings.error.remote-join-this-computer",
  id_taken: "settings.error.remote-join-id-taken",
  key_taken: "settings.error.remote-join-key-taken",
  unavailable: "settings.error.remote-join-unavailable",
  failed: "settings.error.remote-join-failed",
} as const;

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function remainingText(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function AddDevice({
  source,
  devices,
  reload,
}: {
  source: RemoteSettingsSource;
  devices: readonly RemoteDevice[] | "failed" | null;
  reload: () => Promise<unknown>;
}) {
  const [invite, setInvite] = useState<Invite>({ state: "idle" });
  const [terminalInput, setTerminalInput] = useState(true);
  const [long, setLong] = useState(false);
  // 카메라를 못 쓰는 폰과 다른 컴퓨터는 초대장의 글을 붙여 넣는다. 한 번 펼치면 새 초대장에도 펼친 채다.
  const [asText, setAsText] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [joined, setJoined] = useState<string | null>(null);
  const [join, setJoin] = useState<Join>({ state: "closed" });
  const [text, setText] = useState("");
  const [joinNotice, setJoinNotice] = useState<"joined" | "pending" | null>(
    null,
  );

  // 초대장이 보이는 동안 남은 시간을 1초마다 센다.
  useEffect(() => {
    if (invite.state !== "shown") return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [invite]);

  // 초대장이 보이는 동안 다시 읽은 명단에 새 기기가 있으면 들어온 것이다.
  useEffect(() => {
    if (invite.state !== "shown" || devices === null || devices === "failed")
      return;
    const fresh = devices.find((one) => !invite.known.has(one.id));
    if (fresh === undefined) return;
    setInvite({ state: "idle" });
    setJoined(fresh.name);
  }, [invite, devices]);

  async function makeInvite(
    kind: Kind,
    typing = terminalInput,
    lasting = long,
  ): Promise<void> {
    setInvite({ state: "starting", kind });
    setJoin({ state: "closed" });
    const known = new Set(
      devices === null || devices === "failed"
        ? []
        : devices.map((one) => one.id),
    );
    for (let attempt = 1; attempt <= START_TRIES; attempt += 1) {
      const made = await source.invite({
        kind,
        terminalInput: typing,
        lifetime: kind === "computer" && lasting ? "long" : "short",
      });
      if (made.ok) {
        setNow(Date.now());
        setInvite({ state: "shown", kind, invite: made.value, known });
        return;
      }
      if (made.code !== "unavailable" || attempt === START_TRIES) break;
      await delay(START_WAIT_MS);
    }
    setInvite({ state: "failed", kind });
  }

  async function sendJoin(): Promise<void> {
    setJoin({ state: "open", busy: true, failed: null });
    const outcome = await source.join(text.trim());
    if (!outcome.ok) {
      setJoin({ state: "open", busy: false, failed: outcome.reason });
      return;
    }
    setJoin({ state: "closed" });
    setText("");
    setJoinNotice(outcome.pending ? "pending" : "joined");
    await reload();
  }

  const kind = invite.state === "idle" ? null : invite.kind;

  return (
    <>
      {joined === null ? null : (
        <div className={styles.toastSlot} data-remote-joined="">
          <Toast
            title={t("settings.notice.remote-device-joined", { name: joined })}
            duration="brief"
            onClose={() => setJoined(null)}
          />
        </div>
      )}
      <ul className={styles.lines}>
        {kind === null ? null : (
          <>
            <li className={styles.line} data-remote-row="invite-terminal-input">
              <div className={styles.lineMain}>
                <span className={styles.lineName}>
                  {t("settings.label.remote-invite-terminal-input")}
                </span>
                <span className={styles.lineHelp}>
                  {t("settings.note.remote-invite-terminal-input")}
                </span>
              </div>
              <div className={styles.endSlot}>
                <Switch
                  label={t(
                    terminalInput
                      ? "settings.label.value-on"
                      : "settings.label.value-off",
                  )}
                  checked={terminalInput}
                  onCheckedChange={(on) => {
                    setTerminalInput(on);
                    // 보이는 초대장은 옛 값으로 낸 것이라 새 값으로 바꾼다.
                    void makeInvite(kind, on);
                  }}
                />
              </div>
            </li>
            {kind !== "computer" ? null : (
              <li className={styles.line} data-remote-row="invite-long">
                <div className={styles.lineMain}>
                  <span className={styles.lineName}>
                    {t("settings.label.remote-invite-long")}
                  </span>
                  <span className={styles.lineHelp}>
                    {t("settings.note.remote-invite-long")}
                  </span>
                </div>
                <div className={styles.endSlot}>
                  <Switch
                    label={t(
                      long
                        ? "settings.label.value-on"
                        : "settings.label.value-off",
                    )}
                    checked={long}
                    onCheckedChange={(on) => {
                      setLong(on);
                      void makeInvite(kind, terminalInput, on);
                    }}
                  />
                </div>
              </li>
            )}
          </>
        )}
        {inviteLine()}
        {joinLine()}
      </ul>
    </>
  );

  function inviteLine() {
    switch (invite.state) {
      case "idle":
        return (
          <li className={styles.line} data-remote-invite="idle">
            <div className={styles.lineMain}>
              <span className={styles.lineHelp}>
                {t("settings.note.remote-add")}
              </span>
            </div>
            <div className={styles.lineControl}>
              <div className={styles.actions}>
                <Button
                  icon={actionIcons.add}
                  data-remote-invite-phone=""
                  onClick={() => void makeInvite("phone")}
                >
                  {t("settings.button.remote-invite-phone")}
                </Button>
                <Button
                  icon={actionIcons.add}
                  data-remote-invite-computer=""
                  onClick={() => void makeInvite("computer")}
                >
                  {t("settings.button.remote-invite-computer")}
                </Button>
              </div>
            </div>
          </li>
        );
      case "starting":
        return (
          <li className={styles.line} data-remote-invite="starting">
            <div className={styles.lineMain}>
              <span className={styles.lineHelp}>
                {t("settings.notice.remote-starting")}
              </span>
            </div>
          </li>
        );
      case "failed":
        return (
          <li className={styles.line} data-remote-invite="failed">
            <div className={styles.lineMain}>
              <p className={styles.rejected} role="alert">
                {t("settings.error.remote-invite-failed")}
              </p>
            </div>
            <div className={styles.lineControl}>
              <div className={styles.actions}>
                <Button onClick={() => setInvite({ state: "idle" })}>
                  {t("settings.button.cancel")}
                </Button>
                <Button
                  icon={actionIcons.retry}
                  onClick={() => void makeInvite(invite.kind)}
                >
                  {t("common.button.retry")}
                </Button>
              </div>
            </div>
          </li>
        );
      case "shown": {
        const left = Date.parse(invite.invite.expiresAt) - now;
        return (
          <li
            className={styles.line}
            data-remote-invite="shown"
            data-remote-invite-kind={invite.kind}
          >
            <div className={styles.lineMain}>
              {left > 0 ? (
                <>
                  <QrCode
                    text={invite.invite.text}
                    label={t("settings.label.remote-qr")}
                  />
                  <span className={styles.lineName}>
                    {left < COUNTDOWN_MS
                      ? t("settings.label.remote-expires", {
                          time: remainingText(left),
                        })
                      : t("settings.label.remote-expires-later", {
                          time: formatRelativeTime(
                            new Date(invite.invite.expiresAt),
                            new Date(now),
                          ),
                        })}
                  </span>
                  <span className={styles.lineHelp}>
                    {t(
                      invite.kind === "phone"
                        ? "settings.note.remote-invite-phone"
                        : "settings.note.remote-invite-computer",
                    )}
                  </span>
                  {asText ? (
                    <div className={remoteStyles.asText}>
                      <code className={remoteStyles.text} data-remote-text="">
                        {invite.invite.text}
                      </code>
                      <CopyButton
                        text={invite.invite.text}
                        label={t("common.button.copy")}
                        clipboard={systemClipboard}
                      />
                    </div>
                  ) : (
                    <div>
                      <Button
                        size="sm"
                        icon={modalityIcons.text}
                        data-remote-show-text=""
                        onClick={() => setAsText(true)}
                      >
                        {t("settings.button.remote-show-text")}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <span className={styles.notice} data-remote-expired="">
                  {t("settings.notice.remote-expired")}
                </span>
              )}
            </div>
            <div className={styles.lineControl}>
              <div className={styles.actions}>
                <Button onClick={() => setInvite({ state: "idle" })}>
                  {t("settings.button.cancel")}
                </Button>
                <Button
                  icon={actionIcons.refresh}
                  data-remote-new-invite=""
                  onClick={() => void makeInvite(invite.kind)}
                >
                  {t("settings.button.remote-new-invite")}
                </Button>
              </div>
            </div>
          </li>
        );
      }
    }
  }

  function joinLine() {
    if (join.state === "closed") {
      return (
        <li className={styles.line} data-remote-join-line="closed">
          <div className={styles.lineMain}>
            <span className={styles.lineHelp}>
              {t("settings.note.remote-join-start")}
            </span>
            {joinNotice === null ? null : (
              <p className={styles.notice} data-remote-join-notice={joinNotice}>
                {t(
                  joinNotice === "pending"
                    ? "settings.notice.remote-join-pending"
                    : "settings.notice.remote-join-done",
                )}
              </p>
            )}
          </div>
          <div className={styles.lineControl}>
            <Button
              icon={actionIcons.connect}
              data-remote-join-open=""
              onClick={() => {
                setJoinNotice(null);
                setJoin({ state: "open", busy: false, failed: null });
              }}
            >
              {t("settings.button.remote-join")}
            </Button>
          </div>
        </li>
      );
    }
    return (
      <li className={styles.line} data-remote-join-line="open">
        <div className={styles.lineMain}>
          <Field
            label={t("settings.label.remote-invite-text")}
            help={t("settings.note.remote-join")}
            {...(join.failed === null
              ? {}
              : { error: t(JOIN_ERRORS[join.failed]) })}
          >
            <Textarea
              data-remote-join-text=""
              rows={4}
              value={text}
              autoFocus
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
        </div>
        <div className={styles.lineControl}>
          <div className={styles.actions}>
            <Button
              onClick={() => {
                setJoin({ state: "closed" });
                setText("");
              }}
            >
              {t("settings.button.cancel")}
            </Button>
            <Button
              variant="primary"
              icon={actionIcons.connect}
              data-remote-join-send=""
              disabled={join.busy || text.trim() === ""}
              onClick={() => void sendJoin()}
            >
              {t("settings.button.remote-join-send")}
            </Button>
          </div>
        </div>
      </li>
    );
  }
}

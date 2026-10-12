import { type ReactNode, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { waysOf } from "../model.ts";
import type {
  AuthWay,
  CustomProviderInput,
  ProviderDefinitionRow,
  ProviderSettingsSource,
  WindowOutcome,
} from "./settings-source.ts";
import styles from "./connect-dialog.module.css";

export interface ConnectDialogProps {
  source: ProviderSettingsSource;
  /** 연결할 정의. null이면 닫혀 있다. */
  definition: ProviderDefinitionRow | null;
  onClose: () => void;
  /** 연결을 시작했거나 Custom provider를 등록한 뒤 부른다. 목록이 다시 읽는다. */
  onConnected: () => void;
}

// Connect dialog. 내장 정의는 "Connect <이름>" 제목 아래 그 정의가 지원하는 로그인
// 방법을 고르게 하고(model 단계는 없다), custom 정의는 "Custom provider" 제목의 form(Provider ID,
// Display name, Base URL, "Add an API key (optional)")과 [Cancel] [Connect]를 보인다. 인증 없음은 고르는
// 방법이 아니다: 직접 만든 provider의 이 컴퓨터 주소에 key를 더하지 않으면 그것이다.
// API key 값은 이 form이 받지 않는다. 고르면 보호 창이 열린다.
export function ConnectDialog(props: ConnectDialogProps): ReactNode {
  // 정의가 바뀌면 입력과 오류를 새로 시작하도록 key를 정의로 둔다.
  return props.definition === null ? null : (
    <OpenDialog
      key={props.definition.key}
      {...props}
      definition={props.definition}
    />
  );
}

type Props = ConnectDialogProps & { definition: ProviderDefinitionRow };

function OpenDialog(props: Props): ReactNode {
  return props.definition.custom
    ? <CustomDialog {...props} />
    : <MethodDialog {...props} />;
}

function MethodDialog(
  { source, definition, onClose, onConnected }: Props,
): ReactNode {
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function choose(way: Exclude<AuthWay, "none">): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const started = await source.connect(definition.key, way);
    setBusy(false);
    if (!started.ok) {
      setFailed(true);
      return;
    }
    onConnected();
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("settings.title.connect-provider", { name: definition.name })}
      actions={<Button onClick={onClose}>{t("settings.button.cancel")}</Button>}
    >
      <p className={styles.lead}>
        {t("settings.label.sign-in-how", { name: definition.name })}
      </p>
      <ul className={styles.methods}>
        {waysOf(definition.ways).map((way) => (
          <li key={way}>
            <MethodButton
              definition={definition}
              way={way}
              busy={busy}
              onChoose={() => void choose(way)}
            />
          </li>
        ))}
      </ul>
      {failed
        ? (
          <p
            className={styles.notice}
            role="status"
            data-notice="connect-failed"
          >
            {t("settings.error.connect-failed")}
          </p>
        )
        : null}
    </Dialog>
  );
}

function MethodButton(
  { definition, way, busy, onChoose }: {
    definition: ProviderDefinitionRow;
    way: Exclude<AuthWay, "none">;
    busy: boolean;
    onChoose: () => void;
  },
): ReactNode {
  // 공식 로그인은 lophn 이름으로 허용된 것이 확인되지 않았으면 고를 수 없다.
  const blocked = way === "oauth" && definition.signIn?.verified !== true;
  return (
    <button
      type="button"
      className={styles.method}
      data-method={way}
      disabled={blocked || busy}
      onClick={onChoose}
    >
      <span data-method-name="">{methodName(definition, way)}</span>
      <span className={styles.methodHint} data-method-hint="">
        {blocked ? t("settings.notice.method-unverified") : methodHint(way)}
      </span>
    </button>
  );
}

function methodName(
  definition: ProviderDefinitionRow,
  way: Exclude<AuthWay, "none">,
): string {
  switch (way) {
    case "oauth":
      return t("settings.label.method-sign-in", {
        product: definition.signIn?.product ?? definition.name,
      });
    case "api_key":
      return t("settings.label.way-api-key");
  }
}

function methodHint(way: Exclude<AuthWay, "none">): string {
  switch (way) {
    case "oauth":
      return t("settings.label.method-opens-browser");
    case "api_key":
      return t("settings.label.method-paste-key");
  }
}

const ID_SHAPE = /^[a-z0-9_-]+$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https 주소이거나 이 컴퓨터(127.0.0.1·::1·localhost)의 http 주소만 받는다. */
function baseUrlOk(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol === "https:") return url.hostname !== "";
  return url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
}

/** 웹 주소는 key 없이 연결할 수 없다. 인증 없음은 이 컴퓨터의 주소에만 있다. */
function needsKey(value: string): boolean {
  return value.trim().startsWith("https://");
}

function CustomDialog(
  { source, onClose, onConnected }: Props,
): ReactNode {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [withKey, setWithKey] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const idOk = ID_SHAPE.test(id);
  const nameOk = name.trim() !== "";
  const urlOk = baseUrlOk(baseUrl);
  const keyMissing = urlOk && needsKey(baseUrl) && !withKey;
  const valid = idOk && nameOk && urlOk && !keyMissing;

  async function connect(): Promise<void> {
    if (!valid || busy) return;
    setBusy(true);
    setFailed(false);
    const input: CustomProviderInput = {
      id,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      withKey,
    };
    const registered: WindowOutcome = await source.registerCustom(input);
    setBusy(false);
    if (!registered.ok) {
      setFailed(true);
      return;
    }
    onConnected();
    onClose();
  }

  // 오류는 사람이 그 칸에 무언가 쓴 뒤에만 보인다. 빈 칸은 [Connect]가 꺼져 있는 것으로 충분하다.
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("settings.title.custom-provider")}
      width="wide"
      actions={
        <>
          <Button onClick={onClose}>{t("settings.button.cancel")}</Button>
          <Button
            variant="primary"
            disabled={!valid || busy}
            onClick={() => void connect()}
          >
            {t("settings.button.connect")}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <p className={styles.formLead}>{t("settings.notice.custom-lead")}</p>
        <Field
          label={t("settings.label.custom-id")}
          help={t("settings.notice.custom-id-help")}
          error={id !== "" && !idOk ? t("settings.error.custom-id") : undefined}
        >
          <Input
            value={id}
            autoComplete="off"
            onChange={(event) => setId(event.currentTarget.value)}
          />
        </Field>
        <Field
          label={t("settings.label.custom-name")}
          error={name !== "" && !nameOk
            ? t("settings.error.custom-name")
            : undefined}
        >
          <Input
            value={name}
            autoComplete="off"
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </Field>
        <Field
          label={t("settings.label.custom-url")}
          error={baseUrl !== "" && !urlOk
            ? t("settings.error.custom-url")
            : undefined}
        >
          <Input
            value={baseUrl}
            autoComplete="off"
            onChange={(event) => setBaseUrl(event.currentTarget.value)}
          />
        </Field>
        <Checkbox
          label={t("settings.label.custom-key")}
          checked={withKey}
          onCheckedChange={setWithKey}
        />
        {keyMissing
          ? (
            <p className={styles.keyNote} data-notice="key-required">
              {t("settings.notice.custom-key-required")}
            </p>
          )
          : null}
        {withKey
          ? (
            <p className={styles.keyNote}>
              {t("settings.notice.custom-key-help")}
            </p>
          )
          : null}
        {failed
          ? (
            <p
              className={styles.notice}
              role="status"
              data-notice="connect-failed"
            >
              {t("settings.error.connect-failed")}
            </p>
          )
          : null}
      </div>
    </Dialog>
  );
}

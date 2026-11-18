import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Input, Select } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";
import { actionIcons } from "../../../icons/mod.ts";

import {
  CUSTOM_ID_SHAPE,
  customBaseUrl,
  customNeedsKey,
} from "../../../../../protocol/lophn-agent/custom-provider.ts";
import { ProtectedKeyNote } from "../../../workspace/agents/editor/parts.tsx";
import { useOptionalEventClient } from "../../connection/events/hooks.tsx";
import { useScopeMachineItem } from "../../machines/context.tsx";
import { waysOf } from "../model.ts";
import { ProviderName } from "./provider-name.tsx";
import {
  type AuthWay,
  CUSTOM_PROTOCOLS,
  type CustomProtocol,
  type CustomProviderInput,
  type ProviderDefinitionRow,
  type ProviderSettingsSource,
  type WindowOutcome,
} from "./settings-source.ts";
import styles from "./connect-dialog.module.css";

interface ConnectDialogProps {
  source: ProviderSettingsSource;
  /** 연결할 정의. null이면 닫혀 있다. */
  definition: ProviderDefinitionRow | null;
  onClose: () => void;
  /** 연결을 시작했거나 Custom provider를 등록한 뒤 부른다. 목록이 다시 읽는다. */
  onConnected: () => void;
}

// Connect dialog. 내장 정의는 "Connect <이름>" 제목 아래 그 정의가 지원하는 로그인 방법을 고르게 하고(model
// 단계는 없다), 구독 로그인을 고르면 browser에서 마칠 때까지 기다림을 보인다(device code면 그 code를 크게).
// custom 정의는 "Custom provider" 제목의 form(Provider ID, Display name, API, Base URL)과
// [Cancel] [Connect]를 보인다. API key 값은 이 form이 받지 않는다: 웹 주소는 보호 창이 key를 받아 core가 잇고, 이 컴퓨터의
// 주소는 key 없이 바로 연결한다. 인증 없음은 고르는 방법이 아니다.
// 다른 기계의 범위에서는 device code 로그인만 단추다. 그 기계의 browser로 돌아와야 하는 로그인은 그 자리에 까닭 한 줄을 둔다.
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
  return props.definition.custom ? (
    <CustomDialog {...props} />
  ) : (
    <MethodDialog {...props} />
  );
}

/** 고르기 화면 아래에 보일 실패. 구독 로그인의 거절과 기한 지남은 따로 알린다. */
type Failure = "connect-failed" | "sign-in-refused" | "sign-in-expired";

function failureOf(code: string): Failure {
  if (code === "forbidden") return "sign-in-refused";
  if (code === "not_found") return "sign-in-expired";
  return "connect-failed";
}

function MethodDialog({
  source,
  definition,
  onClose,
  onConnected,
}: Props): ReactNode {
  const [failed, setFailed] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  // 구독 로그인을 기다리는 동안의 device code. 기다리지 않으면 undefined다.
  const [waiting, setWaiting] = useState<{ userCode: string | null }>();
  const signIn = useRef<AbortController | null>(null);
  // core가 기다리는 로그인의 상태를 따라갈 event 연결이다.
  const events = useOptionalEventClient();
  // 창이 닫히면 기다리던 로그인을 그만둔다.
  useEffect(() => () => signIn.current?.abort(), []);

  async function choose(way: Exclude<AuthWay, "none">): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    const stop = new AbortController();
    signIn.current = stop;
    const started =
      way === "oauth"
        ? await source.connect(definition.key, way, {
            signal: stop.signal,
            started: (info) => setWaiting(info),
            events,
          })
        : await source.connect(definition.key, way);
    signIn.current = null;
    if (stop.signal.aborted) return;
    setBusy(false);
    setWaiting(undefined);
    if (!started.ok) {
      if (started.code !== "cancelled") setFailed(failureOf(started.code));
      return;
    }
    onConnected();
    onClose();
  }

  function close(): void {
    signIn.current?.abort();
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={t("settings.title.connect-provider", { name: definition.name })}
      actions={<Button onClick={close}>{t("settings.button.cancel")}</Button>}
    >
      {waiting === undefined ? (
        <MethodsBody
          definition={definition}
          busy={busy}
          failed={failed}
          onChoose={(way) => void choose(way)}
        />
      ) : (
        <WaitingBody definition={definition} userCode={waiting.userCode} />
      )}
    </Dialog>
  );
}

/** 구독 로그인을 기다리는 동안 보이는 본문. */
function WaitingBody({
  definition,
  userCode,
}: {
  definition: ProviderDefinitionRow;
  userCode: string | null;
}): ReactNode {
  return (
    <div className={styles.stack}>
      <ProviderName name={definition.name} />
      {userCode === null ? (
        <p className={styles.lead}>
          {t("settings.notice.sign-in-browser", {
            product: definition.signIn?.product ?? definition.name,
          })}
        </p>
      ) : (
        <>
          <p className={styles.lead}>{t("settings.notice.sign-in-code")}</p>
          <p className={styles.code} data-user-code="">
            {userCode}
          </p>
        </>
      )}
      <p className={styles.lead} role="status">
        {t("settings.status.sign-in-waiting")}
      </p>
    </div>
  );
}

/** 로그인 방법 고르기. 연결 창과 gallery의 정적 창이 같이 쓴다. */
function MethodsBody({
  definition,
  busy = false,
  failed = null,
  onChoose = () => {},
}: {
  definition: ProviderDefinitionRow;
  busy?: boolean;
  failed?: Failure | null;
  onChoose?: (way: Exclude<AuthWay, "none">) => void;
}): ReactNode {
  const machine = useScopeMachineItem();
  return (
    <div className={styles.stack}>
      <ProviderName name={definition.name} />
      <p className={styles.lead}>
        {t("settings.label.sign-in-how", { name: definition.name })}
      </p>
      <ul className={styles.methods}>
        {waysOf(definition.ways).map((way) => (
          <li key={way}>
            {machine !== null &&
            way === "oauth" &&
            definition.signIn?.deviceCode !== true ? (
              <p className={styles.lead} data-method-elsewhere={way}>
                {t("machines.notice.sign-in-there", {
                  product: definition.signIn?.product ?? definition.name,
                  name: machine.name,
                })}
              </p>
            ) : (
              <MethodButton
                definition={definition}
                way={way}
                busy={busy}
                onChoose={() => onChoose(way)}
              />
            )}
          </li>
        ))}
      </ul>
      {failed === null ? null : (
        <p className={styles.notice} role="status" data-notice={failed}>
          {t(`settings.error.${failed}`)}
        </p>
      )}
    </div>
  );
}

function MethodButton({
  definition,
  way,
  busy,
  onChoose,
}: {
  definition: ProviderDefinitionRow;
  way: Exclude<AuthWay, "none">;
  busy: boolean;
  onChoose: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className={styles.method}
      data-method={way}
      disabled={busy}
      onClick={onChoose}
    >
      <span data-method-name="">{methodName(definition, way)}</span>
      <span className={styles.methodHint} data-method-hint="">
        {methodHint(way)}
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
      return t("agents.label.providers-key-hint");
  }
}

const baseUrlOk = (value: string): boolean => customBaseUrl(value) !== null;
const needsKey = (value: string): boolean => customNeedsKey(value.trim());

/** Custom provider form의 값. API key는 여기 없다. */
interface CustomFields {
  readonly id: string;
  readonly name: string;
  readonly protocol: CustomProtocol;
  readonly baseUrl: string;
}

/** Custom provider form. 연결 창과 gallery의 정적 창이 같이 쓴다. 오류는 사람이 그 칸에 무언가 쓴 뒤에만 보인다. */
function CustomProviderBody({
  fields,
  failed = false,
  onChange = () => {},
}: {
  fields: CustomFields;
  failed?: boolean;
  onChange?: (fields: CustomFields) => void;
}): ReactNode {
  const idOk = CUSTOM_ID_SHAPE.test(fields.id);
  const urlOk = baseUrlOk(fields.baseUrl);
  // http는 core가 있는 기계 자신의 주소만 된다. 다른 기계의 범위에서는 그 기계다.
  const machine = useScopeMachineItem();
  return (
    <div className={styles.form}>
      <p className={styles.formLead}>{t("settings.notice.custom-lead")}</p>
      <Field
        label={t("settings.label.custom-id")}
        help={t("settings.notice.custom-id-help")}
        error={
          fields.id !== "" && !idOk ? t("settings.error.custom-id") : undefined
        }
      >
        <Input
          value={fields.id}
          data-custom-field="id"
          autoComplete="off"
          onChange={(event) =>
            onChange({ ...fields, id: event.currentTarget.value })
          }
        />
      </Field>
      <Field
        label={t("settings.label.custom-name")}
        error={
          fields.name !== "" && fields.name.trim() === ""
            ? t("settings.error.custom-name")
            : undefined
        }
      >
        <Input
          value={fields.name}
          data-custom-field="name"
          autoComplete="off"
          onChange={(event) =>
            onChange({ ...fields, name: event.currentTarget.value })
          }
        />
      </Field>
      <Field label={t("settings.label.custom-api")}>
        <Select
          value={fields.protocol}
          onValueChange={(value) =>
            onChange({ ...fields, protocol: value as CustomProtocol })
          }
          options={CUSTOM_PROTOCOLS.map((protocol) => ({
            value: protocol,
            label: t(`settings.label.api-${protocol}`),
          }))}
        />
      </Field>
      <Field
        label={t("settings.label.custom-url")}
        help={t("settings.notice.custom-url-help")}
        error={
          fields.baseUrl !== "" && !urlOk
            ? machine === null
              ? t("settings.error.custom-url")
              : t("machines.error.custom-url", { name: machine.name })
            : undefined
        }
      >
        <Input
          value={fields.baseUrl}
          data-custom-field="url"
          autoComplete="off"
          onChange={(event) =>
            onChange({ ...fields, baseUrl: event.currentTarget.value })
          }
        />
      </Field>
      {needsKey(fields.baseUrl) ? (
        <ProtectedKeyNote
          title={t("agents.label.providers-custom-key-title")}
          text={t("agents.notice.providers-custom-key")}
        />
      ) : null}
      {failed ? (
        <p className={styles.notice} role="status" data-notice="connect-failed">
          {t("settings.error.connect-failed")}
        </p>
      ) : null}
    </div>
  );
}

function CustomDialog({ source, onClose, onConnected }: Props): ReactNode {
  const [fields, setFields] = useState<CustomFields>({
    id: "",
    name: "",
    protocol: "openai-chat-completions",
    baseUrl: "",
  });
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const valid =
    CUSTOM_ID_SHAPE.test(fields.id) &&
    fields.name.trim() !== "" &&
    baseUrlOk(fields.baseUrl);

  async function connect(): Promise<void> {
    if (!valid || busy) return;
    setBusy(true);
    setFailed(false);
    const input: CustomProviderInput = {
      id: fields.id,
      name: fields.name.trim(),
      baseUrl: fields.baseUrl.trim(),
      protocol: fields.protocol,
      // 웹 주소는 key 없이 연결할 수 없다. key는 연결한 뒤 보호 창이 받는다.
      withKey: needsKey(fields.baseUrl),
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
            icon={actionIcons.connect}
            disabled={!valid || busy}
            onClick={() => void connect()}
          >
            {t("settings.button.connect")}
          </Button>
        </>
      }
    >
      <CustomProviderBody
        fields={fields}
        failed={failed}
        onChange={setFields}
      />
    </Dialog>
  );
}

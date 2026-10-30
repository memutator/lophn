// agent 층에서 MCP server를 더하는 form. 이름·연결 방식·실행이나 주소·로그인 방식과 OAuth의 issuer·client id·scopes만
// 받고 key·token·client secret 값은 받지 않는다. 값은 더한 뒤 보호 입력으로 받는다(ProtectedKeyNote). 설정 화면의
// 전역 server 추가도 이 form을 쓴다.
import { useEffect, useRef, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Input, Select, Textarea } from "@lophn/ui/input";
import { t } from "@lophn/wording";

import type { McpServer } from "../../../../../protocol/lophn-agent/mcp-settings.ts";
import { commonIcons } from "../../../icons/mod.ts";
import { ProtectedKeyNote } from "./parts.tsx";
import styles from "./agent-editor.module.css";

type Transport = "stdio" | "http";
type Auth = "none" | "bearer" | "api_key" | "oauth2";

const NAME = /^[A-Za-z0-9_-]{1,32}$/;
const EXECUTABLE = /^(\/|[A-Za-z]:\\).+/;
const URL = /^(https:\/\/\S+|http:\/\/(127\.0\.0\.1|\[::1\])(:\d+)?(\/\S*)?)$/;
const ISSUER = /^https:\/\/\S+$/;
const HEADER = /^[A-Za-z0-9-]{1,64}$/;
const CALL_TIMEOUT_MS = 60_000;

/** 사람이 쓴 scope 목록이다. 공백이나 쉼표로 가른다. */
function splitScopes(value: string): string[] {
  return value.split(/[\s,]+/).filter((one) => one !== "");
}

interface ServerFormProps {
  /** credential 이름 `mcp.<scope>.<server>`의 scope. 전역은 `global`, agent 정의 층은 그 agent의 id다. */
  readonly scope: string;
  /** 이미 있는 이름. 같은 이름은 받지 않는다. */
  readonly taken: readonly string[];
  readonly onAdd: (server: McpServer) => void;
  readonly onCancel: () => void;
  /** 열릴 때 화면 가운데로 스크롤한다. */
  readonly scrollIntoView?: boolean;
}

function serverOf(
  scope: string,
  fields: {
    name: string;
    transport: Transport;
    executable: string;
    args: string;
    url: string;
    auth: Auth;
    header: string;
    issuer: string;
    clientId: string;
    scopes: string;
  },
): McpServer {
  const base = {
    name: fields.name,
    enabled: true,
    call_timeout_ms: CALL_TIMEOUT_MS,
  };
  if (fields.transport === "stdio") {
    return {
      ...base,
      transport: "stdio",
      stdio: {
        executable: fields.executable,
        args: fields.args.split("\n").filter((line) => line !== ""),
        cwd: null,
        env: {},
      },
    };
  }
  // 값은 보호 입력이 받는다. 설정에는 `secrets.json`의 이름만 남는다.
  const credential = { secret: `mcp.${scope}.${fields.name}` };
  return {
    ...base,
    transport: "http",
    http: {
      url: fields.url,
      headers: {},
      auth:
        fields.auth === "none"
          ? { kind: "none" }
          : fields.auth === "bearer"
            ? { kind: "bearer", credential }
            : fields.auth === "api_key"
              ? { kind: "api_key", credential, header_name: fields.header }
              : {
                  kind: "oauth2",
                  issuer: fields.issuer,
                  client_id: fields.clientId,
                  // public client는 값이 없어도 된다. 없으면 client secret 없이 교환한다.
                  client_credential: {
                    secret: `mcp.${scope}.${fields.name}.client`,
                  },
                  scopes: splitScopes(fields.scopes),
                },
    },
  };
}

export function ServerForm({
  scope,
  taken,
  onAdd,
  onCancel,
  scrollIntoView = false,
}: ServerFormProps) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<Transport>("stdio");
  const [executable, setExecutable] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<Auth>("none");
  const [header, setHeader] = useState("");
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [scopes, setScopes] = useState("");
  const [tried, setTried] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollIntoView) root.current?.scrollIntoView({ block: "center" });
  }, [scrollIntoView]);

  const nameError = !NAME.test(name)
    ? t("settings.server.error-name")
    : taken.includes(name)
      ? t("settings.server.error-taken")
      : undefined;
  const targetError =
    transport === "stdio"
      ? EXECUTABLE.test(executable)
        ? undefined
        : t("settings.server.error-path")
      : URL.test(url)
        ? undefined
        : t("settings.server.error-url");
  const headerError =
    transport === "http" && auth === "api_key" && !HEADER.test(header)
      ? t("settings.server.error-header")
      : undefined;
  const oauth2 = transport === "http" && auth === "oauth2";
  const scopeList = splitScopes(scopes);
  const issuerError =
    oauth2 && !ISSUER.test(issuer)
      ? t("settings.server.error-issuer")
      : undefined;
  const clientIdError =
    oauth2 && (clientId === "" || clientId.length > 200)
      ? t("settings.server.error-client-id")
      : undefined;
  const scopesError =
    oauth2 &&
    (scopeList.length > 32 || scopeList.some((one) => one.length > 128))
      ? t("settings.server.error-scopes")
      : undefined;
  const invalid =
    nameError !== undefined ||
    targetError !== undefined ||
    headerError !== undefined ||
    issuerError !== undefined ||
    clientIdError !== undefined ||
    scopesError !== undefined;
  // 이름이 겹치는 것은 치는 도중에도 바로 알린다.
  const dup = name !== "" && taken.includes(name);

  return (
    <div ref={root} className={styles.serverForm} data-server-form="">
      <h3 className={styles.serverFormTitle}>
        {t("agents.heading.server-form")}
      </h3>
      <Field
        label={t("settings.label.server-name")}
        help={t("agents.notice.server-name-help")}
        error={
          dup || (tried && nameError !== undefined) ? nameError : undefined
        }
      >
        <Input
          value={name}
          autoComplete="off"
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </Field>
      <div data-server-field="transport">
        <Field label={t("settings.label.server-transport")}>
          <Select
            options={[
              { value: "stdio", label: t("settings.label.on-computer") },
              { value: "http", label: t("settings.label.over-web") },
            ]}
            value={transport}
            onValueChange={(value) => setTransport(value as Transport)}
          />
        </Field>
      </div>
      {transport === "stdio" ? (
        <>
          <Field
            label={t("settings.label.server-program")}
            help={t("settings.server.program-help")}
            error={tried ? targetError : undefined}
          >
            <Input
              value={executable}
              onChange={(event) => setExecutable(event.currentTarget.value)}
            />
          </Field>
          <Field
            label={t("settings.label.server-arguments")}
            help={t("settings.server.arguments-help")}
          >
            <Textarea
              rows={3}
              value={args}
              onChange={(event) => setArgs(event.currentTarget.value)}
            />
          </Field>
        </>
      ) : (
        <>
          <Field
            label={t("settings.label.server-address")}
            help={t("settings.server.address-help")}
            error={tried ? targetError : undefined}
          >
            <Input
              value={url}
              onChange={(event) => setUrl(event.currentTarget.value)}
            />
          </Field>
          <div data-server-field="auth">
            <Field label={t("settings.label.server-auth")}>
              <Select
                options={[
                  { value: "none", label: t("agents.label.auth-none") },
                  { value: "bearer", label: t("agents.label.auth-bearer") },
                  { value: "api_key", label: t("agents.label.auth-api-key") },
                  { value: "oauth2", label: t("agents.label.auth-oauth2") },
                ]}
                value={auth}
                onValueChange={(value) => setAuth(value as Auth)}
              />
            </Field>
          </div>
          {auth === "api_key" ? (
            <Field
              label={t("settings.label.server-header")}
              error={tried ? headerError : undefined}
            >
              <Input
                value={header}
                onChange={(event) => setHeader(event.currentTarget.value)}
              />
            </Field>
          ) : null}
          {auth === "oauth2" ? (
            <>
              <Field
                label={t("settings.label.server-issuer")}
                help={t("settings.server.issuer-help")}
                error={tried ? issuerError : undefined}
              >
                <Input
                  data-server-field="issuer"
                  value={issuer}
                  onChange={(event) => setIssuer(event.currentTarget.value)}
                />
              </Field>
              <Field
                label={t("settings.label.server-client-id")}
                error={tried ? clientIdError : undefined}
              >
                <Input
                  data-server-field="client-id"
                  value={clientId}
                  onChange={(event) => setClientId(event.currentTarget.value)}
                />
              </Field>
              <Field
                label={t("settings.label.server-scopes")}
                help={t("settings.server.scopes-help")}
                error={tried ? scopesError : undefined}
              >
                <Input
                  data-server-field="scopes"
                  value={scopes}
                  onChange={(event) => setScopes(event.currentTarget.value)}
                />
              </Field>
            </>
          ) : null}
        </>
      )}
      {transport === "http" && auth !== "none" ? (
        <ProtectedKeyNote
          title={t(
            auth === "oauth2"
              ? "agents.label.protected-secret"
              : "agents.label.protected-key",
          )}
          text={t("agents.notice.protected-key")}
        />
      ) : (
        <p className={styles.note}>{t("agents.notice.credential-later")}</p>
      )}
      <div className={styles.formActions}>
        <Button onClick={onCancel}>{t("common.button.cancel")}</Button>
        <Button
          variant="primary"
          icon={commonIcons.add}
          onClick={() => {
            setTried(true);
            if (invalid) return;
            onAdd(
              serverOf(scope, {
                name,
                transport,
                executable,
                args,
                url,
                auth,
                header,
                issuer,
                clientId,
                scopes,
              }),
            );
          }}
        >
          {t("settings.button.add-server")}
        </Button>
      </div>
    </div>
  );
}

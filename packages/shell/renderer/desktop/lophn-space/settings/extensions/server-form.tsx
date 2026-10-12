// 도구 server 추가(flow add-agent-extension 2). 이름·방식(이 컴퓨터에서 실행 / 웹으로 연결)·정확한 실행
// 또는 주소·인증 방식을 정한다. credential 값은 이 칸이 받지 않는다. 추가한 뒤 보호 창에 넣는다.
// 공식 로그인 방식은 아직 실행 통로가 없어 고르지 못하게 두고 이유를 보인다.
import { useState } from "react";
import {
  Button,
  Field,
  Input,
  Select,
  Textarea,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import {
  argsOf,
  validExecutable,
  validHeader,
  validServerName,
  validServerUrl,
} from "../model.ts";
import type { NewServer } from "../source.ts";
import styles from "../settings.module.css";

export interface ServerFormProps {
  /** 이미 등록한 이름. 같은 이름은 받지 않는다. */
  taken: readonly string[];
  busy: boolean;
  onAdd: (server: NewServer) => void;
}

type Transport = "stdio" | "http";
type Auth = "none" | "bearer" | "api_key";

export function ServerForm({ taken, busy, onAdd }: ServerFormProps) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<Transport>("stdio");
  const [executable, setExecutable] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<Auth>("none");
  const [header, setHeader] = useState("");
  const [tried, setTried] = useState(false);

  const nameError = name === "" || !validServerName(name)
    ? t("settings.server.error-name")
    : taken.includes(name)
    ? t("settings.server.error-taken")
    : undefined;
  const targetError = transport === "stdio"
    ? validExecutable(executable) ? undefined : t("settings.server.error-path")
    : validServerUrl(url)
    ? undefined
    : t("settings.server.error-url");
  const headerError = transport === "http" && auth === "api_key" &&
      !validHeader(header)
    ? t("settings.server.error-header")
    : undefined;
  const invalid = nameError !== undefined || targetError !== undefined ||
    headerError !== undefined;

  function add(): void {
    setTried(true);
    if (invalid) return;
    onAdd(
      transport === "stdio"
        ? { transport, name, executable, args: argsOf(args) }
        : {
          transport,
          name,
          url,
          auth,
          header: auth === "api_key" ? header : null,
        },
    );
  }

  return (
    <form
      className={styles.form}
      data-server-form=""
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <Field
        label={t("settings.label.server-name")}
        help={t("settings.server.name-help")}
        error={tried ? nameError : undefined}
      >
        <Input
          value={name}
          autoComplete="off"
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </Field>
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
      {transport === "stdio"
        ? (
          <>
            <Field
              label={t("settings.label.server-program")}
              help={t("settings.server.program-help")}
              error={tried ? targetError : undefined}
            >
              <Input
                value={executable}
                autoComplete="off"
                onChange={(event) => setExecutable(event.currentTarget.value)}
              />
            </Field>
            <Field
              label={t("settings.label.server-arguments")}
              help={t("settings.server.arguments-help")}
            >
              <Textarea
                value={args}
                rows={3}
                onChange={(event) => setArgs(event.currentTarget.value)}
              />
            </Field>
          </>
        )
        : (
          <>
            <Field
              label={t("settings.label.server-address")}
              help={t("settings.server.address-help")}
              error={tried ? targetError : undefined}
            >
              <Input
                value={url}
                autoComplete="off"
                onChange={(event) => setUrl(event.currentTarget.value)}
              />
            </Field>
            <Field
              label={t("settings.label.server-auth")}
              help={t("settings.server.auth-sign-in-absent")}
            >
              <Select
                options={[
                  { value: "none", label: t("settings.label.auth-none") },
                  { value: "bearer", label: t("settings.label.auth-bearer") },
                  {
                    value: "api_key",
                    label: t("settings.label.auth-api-key"),
                  },
                  {
                    value: "oauth2",
                    label: t("settings.label.auth-sign-in"),
                    disabled: true,
                  },
                ]}
                value={auth}
                onValueChange={(value) => setAuth(value as Auth)}
              />
            </Field>
            {auth === "api_key"
              ? (
                <Field
                  label={t("settings.label.server-header")}
                  error={tried ? headerError : undefined}
                >
                  <Input
                    value={header}
                    autoComplete="off"
                    onChange={(event) => setHeader(event.currentTarget.value)}
                  />
                </Field>
              )
              : null}
          </>
        )}
      <div className={styles.actions}>
        <Button
          size="sm"
          type="submit"
          data-action="add-server"
          disabled={busy}
        >
          {t("settings.button.add-server")}
        </Button>
      </div>
    </form>
  );
}

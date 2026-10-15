// secret 보호 입력. 확인 창 틀에서 떼어 shell이 따로 띄우는 작은 창 하나다. provider key, MCP server credential,
// 앱 secret이 쓴다. 값은 보이지 않고, 저장하면 이름과 설정 여부만 남는다.
import { useState } from "react";

import { Button, Field, Input } from "@lophn/design/components";

import styles from "./waiting.module.css";

export type SecretKind = "provider" | "mcp" | "app";

const COPY: Record<
  SecretKind,
  { title: string; name: string; label: string; where: string }
> = {
  provider: {
    title: "Enter provider key",
    name: "OpenAI",
    label: "API key",
    where: "Provider",
  },
  mcp: {
    title: "Enter MCP server credential",
    name: "mail",
    label: "Access token",
    where: "MCP server",
  },
  app: {
    title: "Enter app secret",
    name: "PAYMENTS_KEY",
    label: "Value",
    where: "Orders app",
  },
};

export interface SecretInputProps {
  readonly kind: SecretKind;
  /** 칸에 이미 값을 넣은 채 시작한다(점으로만 보인다). */
  readonly filled?: boolean;
  /** 이미 설정돼 있다. 저장하면 값을 바꾼다. */
  readonly configured?: boolean;
}

export function SecretInput(
  { kind, filled = false, configured = false }: SecretInputProps,
) {
  const copy = COPY[kind];
  const [value, setValue] = useState(filled ? "sk-example-0000000000" : "");
  return (
    <div className={styles.stage}>
      <div
        className={styles.secretWindow}
        role="dialog"
        aria-label={copy.title}
      >
        <div className={styles.secretBar}>lophn</div>
        <div className={styles.secretBody}>
          <h1 className={styles.secretTitle}>{copy.title}</h1>
          <p className={styles.secretText}>
            {copy.where}: <span className={styles.secretName}>{copy.name}</span>
            {configured ? ". Already set. Saving replaces the value." : null}
          </p>
          <Field
            label={copy.label}
            help="The value goes straight to lophn. It is never shown in the app or in a conversation. Only the name and whether it is set are kept."
          >
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
            />
          </Field>
          <div className={styles.secretActions}>
            <Button variant="ghost">Cancel</Button>
            <Button variant="primary" disabled={value === ""}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

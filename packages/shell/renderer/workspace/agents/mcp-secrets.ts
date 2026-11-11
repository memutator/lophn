// MCP http server 설정이 secret 이름으로 가리키는 자리들. 보호 입력 창으로 값을 넣는 단추가 이 목록으로 그려진다.
import { t } from "@lophn/i18n";

import type { McpSecret } from "./views.ts";

/** 이 모양은 contract의 McpServer와 Settings가 읽는 McpServerValue가 같이 만족한다. */
interface McpSecretRefs {
  readonly transport: string;
  readonly http?: {
    readonly headers?: Readonly<
      Record<string, { readonly secret?: string; readonly value?: string }>
    >;
    readonly auth: {
      readonly kind: string;
      readonly credential?: { readonly secret: string };
      readonly client_credential?: { readonly secret: string } | null;
    };
  };
}

export function secretsOf(
  server: McpSecretRefs,
  isSet: (name: string) => boolean | null = () => null,
): McpSecret[] {
  const http = server.http;
  if (http === undefined) return [];
  const found: { name: string; label: string }[] = [];
  const { auth } = http;
  if (auth.credential !== undefined) {
    found.push({
      name: auth.credential.secret,
      label: t("agents.label.secret-value"),
    });
  }
  if (auth.client_credential != null) {
    found.push({
      name: auth.client_credential.secret,
      label: t("agents.label.secret-client"),
    });
  }
  for (const [header, entry] of Object.entries(http.headers ?? {})) {
    if (entry.secret === undefined) continue;
    found.push({
      name: entry.secret,
      label: t("agents.label.secret-header", { name: header }),
    });
  }
  return found.map((one) => ({ ...one, set: isSet(one.name) }));
}

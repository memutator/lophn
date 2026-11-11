import { err, ok, type Result } from "../../../base/mod.ts";
import { appsSecretValue } from "../../../protocol/apps/mod.ts";
import {
  SECRET_SEND_OP,
  type SecretAttachPort,
  type SecretDestination,
  type SecretValue,
} from "../../../protocol/secrets/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import type { KnownSecretMatch } from "../../storage/ledger/mod.ts";
import { isLoopbackHost } from "./broker/net-fetch.ts";

// supervisor가 지금 쥔 live 자식 하나. 자식이 없으면 null이다.
type LiveChild = {
  release: string | null;
  mode: string;
  process_nonce: string;
};

const FORBIDDEN = {
  code: "forbidden" as const,
  message: "secret 전송을 허용하지 않는다",
};

// `apps.secret_value`. supervisor가 앱의 외부 요청에 인증 값을 붙일 때 값을 한 번 받는다. 호출한 supervisor가
// 지금 보는 live 자식과 맞을 때만, 그리고 `secretAttach`가 현재 grant(선언 ∩ active grant ∩ 목적지)로 다시
// 판정해 통과할 때만 값이 나간다. 값은 알려진 값 registry가 전부 알고 있을 때만 주어(모르는 값은 redaction이
// 지우지 못한다) 응답 본문 밖 어디에도 남지 않는다.
export function secretValueHandler(deps: {
  attach: SecretAttachPort;
  known: () => KnownSecretMatch | undefined;
  observe(app: string): Promise<Result<LiveChild | null>>;
  // 값을 보내기 직전에 부른다(앱 OAuth의 refresh). undefined면 할 일이 없다. 실패하면 값을 보내지 않는다.
  prepare?(input: {
    app: string;
    name: string;
  }): Promise<Result<void> | undefined>;
  // 값이 없거나(not_found) 앱 OAuth에 sign-in이 필요해서(conflict) 값을 못 주었을 때 부른다. 그 호출의 실패가 빈 자리를 싣게 한다.
  missing?(input: { invocation: string; app: string; name: string }): void;
}): MemoryHandler {
  return async (caller, body) => {
    const parsed = appsSecretValue.input.safeParse(body);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "secret value input is invalid",
      });
    }
    const input = parsed.data;
    const { process, task } = caller.conditions;
    if (process === undefined || task === undefined) return err(FORBIDDEN);

    const child = await deps.observe(input.app);
    if (!child.ok) return child;
    if (
      child.value === null ||
      child.value.mode !== "live" ||
      child.value.release !== input.release ||
      child.value.process_nonce !== input.process_nonce
    ) {
      return err(FORBIDDEN);
    }

    const destination = destinationOf(input.destination);
    if (destination === undefined) return err(FORBIDDEN);

    // 값을 건네는 호출자는 supervisor이고 앱은 대신하는 대상이다. 앱은 conditions가 정한다.
    const context: AuthenticatedContext = {
      principal: caller.principal,
      actor: "machine",
      scope: {
        operations: [SECRET_SEND_OP],
        targets: { process, task },
      },
      conditions: { process, task, app: input.app, release: input.release },
      credential_ref: caller.credential_ref,
    };
    const prepared = await deps.prepare?.({
      app: input.app,
      name: input.name,
    });
    const lacking = () => {
      if (input.invocation !== undefined) {
        deps.missing?.({
          invocation: input.invocation,
          app: input.app,
          name: input.name,
        });
      }
    };
    if (prepared !== undefined && !prepared.ok) {
      if (prepared.error.code === "conflict") lacking();
      return prepared;
    }
    let value: SecretValue | undefined;
    const sent = await deps.attach.send(
      {
        context,
        use: { name: input.name, destination },
        operation: appsSecretValue.name,
        body: {},
      },
      (loaded) => {
        value = loaded;
        return Promise.resolve(ok({ sent: true }));
      },
    );
    if (!sent.ok) {
      if (sent.error.code === "not_found") lacking();
      return sent;
    }
    const text =
      typeof value === "string"
        ? value
        : value === undefined
          ? ""
          : new TextDecoder().decode(value);
    value = undefined;
    if (text === "" || !wholly(deps.known(), text)) {
      return err({
        code: "unavailable",
        message: "secret cannot be delivered safely",
      });
    }
    return ok({ value: text });
  };
}

// http는 loopback host만이다(secretAllowed가 같은 규칙으로 한 번 더 본다).
function destinationOf(one: {
  scheme: "http" | "https";
  host: string;
  port: number;
}): SecretDestination | undefined {
  const host = one.host.toLowerCase();
  if (one.scheme === "http" && !isLoopbackHost(host)) return undefined;
  const bracketed = host.includes(":") ? `[${host}]` : host;
  let origin: string;
  try {
    origin = new URL(`${one.scheme}://${bracketed}:${one.port}`).origin;
  } catch {
    return undefined;
  }
  return one.scheme === "https"
    ? { kind: "https", origin }
    : { kind: "loopback_http", origin };
}

function wholly(known: KnownSecretMatch | undefined, text: string): boolean {
  if (known === undefined || !known.ready) return false;
  const found = known.match(text);
  return (
    found !== undefined && found.index === 0 && found.length === text.length
  );
}

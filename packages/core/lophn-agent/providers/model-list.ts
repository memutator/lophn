// custom provider가 `GET {endpoint}/models`로 알려 주는 model 목록을 읽어 `credential.reported_models`에 둔다.
// 읽는 때는 provider를 붙인 직후와 사람이 RefreshProviderModels를 부를 때다. login.ts처럼 writer queue 앞의
// 처리기다: 발급자 network를 기다리는 동안 ledger transaction이 열려 있을 수 없다.
// 읽기가 실패하면 저장하지 않으므로 앞 목록이 그대로다. 연결 직후 읽기에 다시 읽기는 없다: runtime은 모든 host로
// 나갈 수 있어 새 주소도 바로 닿는다. 실패하면 사람의 refresh가 다시 읽는다. 요청은 ChatGPT 목록과 같은 발급자 요청 대기열로 나간다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  connectProvider,
  type ProviderRecord,
  recordProviderModels,
  refreshProviderModels,
  refreshProviderModelsInputSchema,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { SecretStorePort } from "../../../protocol/secrets/secret-file.ts";
import type { CommandSuccess, Writer } from "../../storage/ledger/mod.ts";
import type { IssuerFetch } from "./oauth.ts";
import { providerSecretName } from "./oauth-secrets.ts";
import { customModelsEndpoint, readReportedModels } from "./reported-models.ts";

export type ProviderModelListDeps = {
  http: IssuerFetch;
  secrets: Pick<SecretStorePort, "get">;
  readProvider(
    ctx: AuthenticatedContext,
    provider: string,
  ): Promise<Result<ProviderRecord | null>>;
  newKey(): string;
};

export function withProviderModelList(
  writer: Writer,
  deps: ProviderModelListDeps,
): Writer {
  const unavailable = (message: string) =>
    err({ code: "unavailable" as const, message });

  async function refresh(
    ctx: AuthenticatedContext,
    id: string,
  ): Promise<Result<{ provider: ProviderRecord }>> {
    const read = await deps.readProvider(ctx, id);
    if (!read.ok) return read;
    const provider = read.value;
    if (provider === null) {
      return err({ code: "not_found", message: "provider not found" });
    }
    const endpoint = customModelsEndpoint(provider);
    if (endpoint === null) {
      return err({
        code: "invalid_input",
        message: "this provider does not report its model list",
      });
    }
    let access: string | null = null;
    if (provider.credential.kind === "api_key") {
      // key는 endpoint와 같은 origin으로만 간다. 요청 header에만 두고 오류와 결과에는 싣지 않는다.
      if (new URL(endpoint).origin !== new URL(provider.endpoint).origin) {
        return unavailable("the model list address is not the endpoint");
      }
      const key = deps.secrets.get(providerSecretName(provider.id));
      if (!key.ok) return unavailable("the provider key is missing");
      access = key.value;
    }
    const models = await readReportedModels(deps.http, endpoint, access);
    if (models === null) return unavailable("could not read the model list");
    // 기다리는 사이 revision이 바뀌었을 수 있어 저장 직전에 다시 읽는다.
    const latest = await deps.readProvider(ctx, id);
    if (!latest.ok) return latest;
    if (latest.value === null) {
      return err({ code: "not_found", message: "provider not found" });
    }
    const recorded = await writer.command(ctx, {
      command: recordProviderModels.name,
      input: { provider: id, models },
      idempotency_key: deps.newKey(),
      compare: { revision: latest.value.revision },
      prepared: [],
    });
    if (!recorded.ok) return recorded;
    return ok(recorded.value.result as { provider: ProviderRecord });
  }

  return {
    ...writer,
    async command(ctx, envelope): Promise<Result<CommandSuccess>> {
      if (envelope.command === refreshProviderModels.name) {
        const parsed = refreshProviderModelsInputSchema.safeParse(
          envelope.input,
        );
        if (!parsed.success) {
          return err({
            code: "invalid_input",
            message: "refresh models input is wrong",
          });
        }
        const done = await refresh(ctx, parsed.data.provider);
        return done.ok
          ? ok({
              result: done.value,
              replayed: false,
              first_seq: null,
              last_seq: null,
            })
          : done;
      }
      const done = await writer.command(ctx, envelope);
      if (done.ok && envelope.command === connectProvider.name) {
        const { provider } = done.value.result as { provider: ProviderRecord };
        // 연결 결과를 기다리게 하지 않고 뒤에서 읽는다.
        if (customModelsEndpoint(provider) !== null) {
          void refresh(ctx, provider.id).catch(() => {});
        }
      }
      return done;
    },
  };
}

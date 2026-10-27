// domain 쓰기의 core 호출. project 창(WorkspaceSource)과 앱 공간(AppDetailSource)이 같은 command를 쓰므로 한 곳에 둔다.
import {
  domainArchive,
  domainCreate,
  domainUnarchive,
} from "../../../../protocol/domains/domains.ts";
import { commandCall } from "../../command-call.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import type { DomainActions, DomainOpResult } from "../source.ts";

const failed = (reply: {
  error?: { code: string; message: string };
}): DomainOpResult => ({
  ok: false,
  code: reply.error?.code ?? "internal",
  message: reply.error?.message ?? "",
});

export function coreDomainActions(core: CoreSource): DomainActions {
  // archive·unarchive는 지금 revision을 비교한다. 사람이 목록을 본 뒤 바뀌었으면 core가 conflict로 답한다.
  async function move(
    route: typeof domainArchive | typeof domainUnarchive,
    domain: string,
  ): Promise<DomainOpResult> {
    const read = await core.call({
      kind: "read",
      resource: "domains",
      method: "get",
      body: { domain },
    });
    if (!read.ok) return failed(read);
    const revision = (read.value as { domain: { revision: string } }).domain
      .revision;
    const reply = await core.call(
      commandCall(route, {
        input: { domain },
        compare: { base_revision: revision },
        key: `domain-${route.method}-${crypto.randomUUID()}`,
      }),
    );
    return reply.ok ? { ok: true } : failed(reply);
  }

  return {
    async createDomain(owner, draft) {
      const reply = await core.call(
        commandCall(domainCreate, {
          input: { ...draft, owner: { kind: owner.kind, id: owner.id } },
          compare: {},
          key: `domain-create-${crypto.randomUUID()}`,
        }),
      );
      return reply.ok ? { ok: true } : failed(reply);
    },
    archiveDomain: (domain) => move(domainArchive, domain),
    unarchiveDomain: (domain) => move(domainUnarchive, domain),
  };
}

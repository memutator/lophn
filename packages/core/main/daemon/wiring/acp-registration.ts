// ACP의 team 등록 file이다. writer·reader Worker가 import한다. 항목의 session 순번을 저장하는 표와 그 command뿐이다.
import { ok } from "../../../../base/mod.ts";
import { acpItemsAllocate } from "../../../../protocol/acp/routes.ts";
import type { CommandDefinition } from "../../../../protocol/server/mod.ts";
import type { SchemaStep } from "../../../../protocol/server/mod.ts";

// seq는 항목이 대화에 든 차례로 session마다 1부터 이어 붙인다. data는 기록에서 다시 만들 수 없는 항목(승인 결과)의
// 내용이다. 기록 쪽 행(messages, tool_calls, turns)은 건드리지 않고, 순번이 없는 옛 기록은 snapshot을 처음 읽을 때
// 시각 순서로 받는다.
const acpSchemaSteps: readonly SchemaStep[] = [
  {
    id: "acp.items.tables",
    sql: `
create table acp_items (
  session text not null references sessions (id) on delete cascade,
  id text not null,
  seq integer not null check (seq >= 1),
  kind text not null check (kind in ('message', 'tool', 'approval', 'notice')),
  turn text,
  at text not null,
  data text check (data is null or json_valid(data)),
  primary key (session, id),
  unique (session, seq)
) strict;`,
  },
];

const allocate: CommandDefinition<typeof acpItemsAllocate> = {
  route: acpItemsAllocate,
  handle(tx, _ctx, input) {
    const head = tx.sql.get(
      "select coalesce(max(seq), 0) as seq from acp_items where session = ?",
      [input.session],
    );
    let next = Number(head?.["seq"] ?? 0);
    const items: { id: string; seq: number }[] = [];
    for (const item of input.items) {
      const known = tx.sql.get(
        "select seq from acp_items where session = ? and id = ?",
        [input.session, item.id],
      );
      if (known !== undefined) {
        items.push({ id: item.id, seq: Number(known["seq"]) });
        continue;
      }
      next += 1;
      tx.sql.run(
        `insert into acp_items (session, id, seq, kind, turn, at, data)
         values (?, ?, ?, ?, ?, ?, ?)`,
        [
          input.session,
          item.id,
          next,
          item.kind,
          item.turn,
          item.at,
          item.data,
        ],
      );
      items.push({ id: item.id, seq: next });
    }
    return ok({ items });
  },
};

export function createCoreRegistration() {
  return { schemaSteps: acpSchemaSteps, commands: [allocate] };
}

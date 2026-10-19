import type { Sql } from "../../../../protocol/server/mod.ts";

// artifact(artifacts 폴더 안 `<name>/`)에 마지막으로 쓴 session이다. root는 그 폴더의 realpath이고 project마다 다르므로
// 같은 이름이 다른 project에 있어도 섞이지 않는다. 되돌려진 쓰기는 마지막으로 쓴 것이 아니다. 그 session이 열려
// 있는 그 project의 PM·Operator가 아니면 받는 쪽이 될 수 없다. `like`는 `%`·`_`를 특수 문자로 읽어서 접두사는 substr로 비교한다.
export function lastArtifactWriter(
  sql: Pick<Sql, "get">,
  input: { root: string; name: string },
): { session: string } | null {
  const prefix = `${input.name}/`;
  const row = sql.get(
    `select c.session as session
       from rewind_files f
       join checkpoints c on c.message = f.checkpoint
       join sessions s on s.id = c.session
      where f.root = ? and substr(f.path, 1, ?) = ? and f.reverted_by is null
        and s.lifecycle = 'open' and s.place_kind = 'project'
        and s.role in ('project_manager', 'operator')
      order by f.seq desc
      limit 1`,
    [input.root, prefix.length, prefix],
  );
  return row === undefined ? null : { session: String(row.session) };
}

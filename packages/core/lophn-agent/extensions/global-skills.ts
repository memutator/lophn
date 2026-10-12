import { err, ok, type Result } from "../../../base/mod.ts";
import { globalSkillsRead } from "../../../protocol/lophn-agent/mod.ts";
import type {
  Output,
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import type { ReadSql } from "./place-store.ts";
import {
  listSkillsSync,
  type SkillSources,
  type SyncSkillFiles,
} from "./skills-sync.ts";

// 전역(Workspace) 층의 skill 목록을 사람 화면에 준다(concern lophn-agent/extensions R1, R32; open-issues
// shell/desktop#Q22). 자리 폴더는 보지 않는다: 자리 skill은 place-extension-settings가 맡는다. 끈 skill도 목록에 남고
// enabled만 false라서 화면이 다시 켤 수 있다. 끈 이름은 지금 발견되지 않는 것까지 그대로 돌려준다(R30).

// 다른 concern의 값을 읽는 길이다. 정본은 각 concern(platform/settings)이고 여기서는 읽기만 한다.
export type GlobalSkillLookups = {
  // 전역 층의 skill 출처다: 등록 폴더·개인 보관소·동봉 폴더.
  skillSources(): Omit<SkillSources, "place">;
  // 전역에서 끈 skill의 정확한 이름이다.
  skillsOff(): readonly string[];
};

export type GlobalSkillDeps = {
  skillFiles: SyncSkillFiles;
  lookups(sql: ReadSql): GlobalSkillLookups;
};

export function createGlobalSkillReads(deps: GlobalSkillDeps): {
  read: ReadDefinition<typeof globalSkillsRead>;
} {
  return {
    read: {
      route: globalSkillsRead,
      handle(
        snapshot: ReadSnapshot,
        _ctx: RequestContext,
      ): Result<Output<typeof globalSkillsRead>> {
        const lookups = deps.lookups(snapshot.sql);
        const off = lookups.skillsOff();
        let listing: ReturnType<typeof listSkillsSync>;
        try {
          listing = listSkillsSync(deps.skillFiles, {
            ...lookups.skillSources(),
            place: null,
          });
        } catch {
          return err({
            code: "unavailable",
            message: "global skills could not be listed",
          });
        }
        return ok({
          skills: listing.entries.flatMap((entry) =>
            entry.source_kind === "place" ? [] : [{
              name: entry.name,
              description: entry.description,
              source_kind: entry.source_kind,
              enabled: !off.includes(entry.name),
            }]
          ),
          skills_off: [...off],
          shadowed: [...listing.shadowed],
          skipped: [...listing.skipped],
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}

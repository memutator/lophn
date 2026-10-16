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

// 옛 `ReadGlobalSkills` handler다(concern lophn-agent/extensions). register.ts가 `ReadSkills`(skills-handler.ts)로
// 바꾸면 이 file을 지운다. 전역 층과 내장 skill만 보이고 출처 말은 옛 말로 옮긴다(내장은 bundled, 나머지는 registered).

export type GlobalSkillLookups = {
  skillSources(): Omit<SkillSources, "project">;
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
          listing = listSkillsSync(
            deps.skillFiles,
            { ...lookups.skillSources(), project: null },
            { role: null, off },
          );
        } catch {
          return err({
            code: "unavailable",
            message: "global skills could not be listed",
          });
        }
        return ok({
          skills: listing.entries.map((entry) => ({
            name: entry.name,
            description: entry.description,
            source_kind: entry.source === "builtin"
              ? "bundled" as const
              : "registered" as const,
            enabled: entry.enabled,
          })),
          skills_off: [...off],
          shadowed: [],
          skipped: [...listing.skipped],
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}

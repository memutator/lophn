import type { SchemaStep } from "../../../protocol/server/mod.ts";

// sessions.skip을 4단계 sessions.permission_mode로 옮기고, turns.mode의 옛 'skip' 값을 'attended'로 바꾼다.
// turns.mode는 시작 뒤 immutability·terminal trigger가 막으므로 두 trigger를 잠시 내렸다가 같은 모양으로 다시 둔다.
// WIRINGS 맨 뒤 wiring의 schemaStepsAfterTeams 끝에서 잇는다(schema-steps.lock.json).
export const SESSION_PERMISSION_MODE_SCHEMA_STEP_ID =
  "lophn-agent.session-permission-mode";

export const sessionPermissionModeSchemaSteps: readonly SchemaStep[] = [
  {
    id: SESSION_PERMISSION_MODE_SCHEMA_STEP_ID,
    sql: `
alter table sessions add column permission_mode text not null default 'workspace'
  check (permission_mode in ('read_only', 'ask', 'workspace', 'full'));
update sessions set permission_mode = 'full' where skip = 1;
drop trigger turns_started_immutable;
drop trigger turns_finished_terminal;
update turns set mode = 'attended' where mode = 'skip';
create trigger turns_started_immutable
before update of basis, started_at, limits, mode on turns
begin
  select raise(abort, 'turn basis, start, limits and mode are fixed once started');
end;
create trigger turns_finished_terminal
before update on turns
when old.state = 'finished'
begin
  select raise(abort, 'a finished turn is never reopened');
end;`,
  },
];

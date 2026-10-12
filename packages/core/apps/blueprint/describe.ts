// blueprint가 사람과 agent에게 무엇을 설명하는지, 비어 있는 자리가 어디인지 본다
// (apps/blueprint#R2). 구조가 맞는지(`validateBlueprint`)와 실제 test 통과(problems/tests)와는
// 다른 근거이고 이 파일은 설명의 빈자리만 센다.
import type { Blueprint, InputSchema } from "./mod.ts";

function blank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

function inputGaps(path: string, schema: InputSchema, gaps: string[]): void {
  if (blank(schema.description)) gaps.push(path);
  if (schema.properties !== undefined) {
    for (const [name, child] of Object.entries(schema.properties)) {
      inputGaps(`${path}.${name}`, child, gaps);
    }
  }
  if (schema.items !== undefined) inputGaps(`${path}[]`, schema.items, gaps);
}

// 설명이 없거나 빈 자리의 경로. 화면의 이름·시작 위치·크기, command의 이름·설명·입력 항목의
// 뜻과 선택값, automation의 이름(켜고 끄는 화면에서 보이는 이름)을 본다.
export function descriptionGaps(blueprint: Blueprint): string[] {
  const gaps: string[] = [];
  if (blank(blueprint.name)) gaps.push("name");
  if (blank(blueprint.description)) gaps.push("description");
  for (const screen of blueprint.screens) {
    if (blank(screen.label)) gaps.push(`screens.${screen.key}.label`);
    if (blank(screen.path)) gaps.push(`screens.${screen.key}.path`);
    if (screen.sizes.length === 0) gaps.push(`screens.${screen.key}.sizes`);
  }
  for (const command of blueprint.commands) {
    if (blank(command.label)) gaps.push(`commands.${command.key}.label`);
    if (blank(command.description)) {
      gaps.push(`commands.${command.key}.description`);
    }
    if (command.input !== null) {
      inputGaps(`commands.${command.key}.input`, command.input, gaps);
    }
  }
  for (const task of blueprint.automatic_tasks) {
    if (blank(task.label)) gaps.push(`automatic_tasks.${task.key}.label`);
  }
  return gaps.sort();
}

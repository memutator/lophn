// blueprint가 사람과 agent에게 무엇을 설명하는지, 비어 있는 자리가 어디인지 본다
// 구조가 맞는지(`validateBlueprint`)와 실제 test 통과(problems/tests)와는
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

// 설명이 없거나 빈 자리의 경로. 화면의 이름·시작 위치·크기, tool의 이름·설명·입력과 출력 항목의
// 뜻과 선택값을 본다. 입력 항목은 `tools.<name>.inputSchema.<필드>` 꼴이다.
export function descriptionGaps(blueprint: Blueprint): string[] {
  const gaps: string[] = [];
  if (blank(blueprint.name)) gaps.push("name");
  if (blank(blueprint.description)) gaps.push("description");
  for (const screen of blueprint.screens) {
    if (blank(screen.label)) gaps.push(`screens.${screen.key}.label`);
    if (blank(screen.path)) gaps.push(`screens.${screen.key}.path`);
    if (screen.sizes.length === 0) gaps.push(`screens.${screen.key}.sizes`);
  }
  for (const tool of blueprint.tools) {
    if (blank(tool.title)) gaps.push(`tools.${tool.name}.title`);
    if (blank(tool.description)) gaps.push(`tools.${tool.name}.description`);
    if (tool.inputSchema !== null) {
      inputGaps(`tools.${tool.name}.inputSchema`, tool.inputSchema, gaps);
    }
    if (tool.outputSchema !== undefined) {
      inputGaps(`tools.${tool.name}.outputSchema`, tool.outputSchema, gaps);
    }
  }
  return gaps.sort();
}

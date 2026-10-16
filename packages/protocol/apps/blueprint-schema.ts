// 의존성 없는 blueprint 정본.
// Zod·Deno·node·npm·jsr·IO·앱 코드 실행이 없다.
// no-input hash의 정규 JSON null은 command·schema·release 결합을 대신하지 않는다.

import {
  asJson,
  defineOwn,
  exactKeys,
  INPUT_KEYS,
  INPUT_TYPES,
  type InputSchema,
  type InputType,
  integerBound,
  invalid,
  isObject,
  type JsonObject,
  type JsonValue,
  lengthOf,
  matchesType,
  numberBound,
  ownKeys,
  rejectSurrogate,
  sameJson,
  type ValidationResult,
} from "./blueprint-types.ts";
import { normalizeJson } from "./blueprint-json.ts";

function validateSchemaNode(
  value: unknown,
  path: string,
  seen?: Set<object>,
): ValidationResult<InputSchema> {
  const root = seen === undefined;
  const visiting = seen ?? new Set<object>();
  if (!isObject(value)) return invalid(`${path} must be an object`);
  if (root && asJson(value) === undefined) {
    return invalid(`${path} schema is not JSON`);
  }
  if (visiting.has(value)) return invalid(`${path} schema is cyclic`);
  visiting.add(value);
  const unexpected = exactKeys(value, INPUT_KEYS, ["type"]);
  if (unexpected) return invalid(`${path} ${unexpected}`);
  const type = value.type;
  if (typeof type !== "string" || !INPUT_TYPES.has(type as InputType)) {
    return invalid(`${path} has an unsupported type`);
  }
  const schema: InputSchema = { type: type as InputType };
  if (Object.hasOwn(value, "description")) {
    if (
      typeof value.description !== "string" ||
      rejectSurrogate(value.description)
    ) {
      return invalid(`${path} description must be a string`);
    }
    schema.description = value.description;
  }
  const objectOnly = ["properties", "required", "additionalProperties"];
  const arrayOnly = ["items", "minItems", "maxItems"];
  const stringOnly = ["minLength", "maxLength"];
  const numberOnly = ["minimum", "maximum"];
  for (
    const key of [...objectOnly, ...arrayOnly, ...stringOnly, ...numberOnly]
  ) {
    const allowed = type === "object"
      ? objectOnly
      : type === "array"
      ? arrayOnly
      : type === "string"
      ? stringOnly
      : type === "integer" || type === "number"
      ? numberOnly
      : [];
    if (Object.hasOwn(value, key) && !allowed.includes(key)) {
      return invalid(`${path}.${key} is not valid for ${type}`);
    }
  }
  if (type === "object") {
    const properties: { [key: string]: InputSchema } = {};
    if (Object.hasOwn(value, "properties")) {
      if (!isObject(value.properties)) {
        return invalid(`${path}.properties must be an object`);
      }
      const names = ownKeys(value.properties);
      if (!names) return invalid(`${path}.properties has an unsupported key`);
      for (const name of names) {
        const property = validateSchemaNode(
          value.properties[name],
          `${path}.properties.${name}`,
          visiting,
        );
        if (!property.ok) return property;
        defineOwn(properties, name, property.value);
      }
    }
    schema.properties = Object.fromEntries(
      Object.keys(properties).sort().map((name) => [name, properties[name]]),
    );
    if (Object.hasOwn(value, "required")) {
      if (
        !Array.isArray(value.required) ||
        value.required.some((item) => typeof item !== "string")
      ) {
        return invalid(`${path}.required must be strings`);
      }
      const required = value.required as string[];
      if (new Set(required).size !== required.length) {
        return invalid(`${path}.required has a duplicate`);
      }
      if (required.some((name) => !Object.hasOwn(schema.properties!, name))) {
        return invalid(`${path}.required names an unknown property`);
      }
      schema.required = [...required].sort();
    }
    if (
      Object.hasOwn(value, "additionalProperties") &&
      value.additionalProperties !== false
    ) {
      return invalid(`${path}.additionalProperties must be false`);
    }
    schema.additionalProperties = false;
  }
  if (type === "array") {
    if (!Object.hasOwn(value, "items")) {
      return invalid(`${path}.items is required`);
    }
    const items = validateSchemaNode(value.items, `${path}.items`, visiting);
    if (!items.ok) return items;
    schema.items = items.value;
    for (const key of ["minItems", "maxItems"] as const) {
      if (!Object.hasOwn(value, key)) continue;
      const bound = integerBound(value[key]);
      if (bound === undefined) {
        return invalid(`${path}.${key} must be a safe integer`);
      }
      schema[key] = bound;
    }
    if (
      schema.minItems !== undefined && schema.maxItems !== undefined &&
      schema.minItems > schema.maxItems
    ) {
      return invalid(`${path} item bounds are inverted`);
    }
  }
  if (type === "string") {
    for (const key of ["minLength", "maxLength"] as const) {
      if (!Object.hasOwn(value, key)) continue;
      const bound = integerBound(value[key]);
      if (bound === undefined) {
        return invalid(`${path}.${key} must be a safe integer`);
      }
      schema[key] = bound;
    }
    if (
      schema.minLength !== undefined && schema.maxLength !== undefined &&
      schema.minLength > schema.maxLength
    ) {
      return invalid(`${path} length bounds are inverted`);
    }
  }
  if (type === "integer" || type === "number") {
    for (const key of ["minimum", "maximum"] as const) {
      if (!Object.hasOwn(value, key)) continue;
      const bound = numberBound(value[key]);
      if (bound === undefined) return invalid(`${path}.${key} must be finite`);
      schema[key] = bound;
    }
    if (
      schema.minimum !== undefined && schema.maximum !== undefined &&
      schema.minimum > schema.maximum
    ) {
      return invalid(`${path} numeric bounds are inverted`);
    }
  }
  const bare: InputSchema = { ...schema };
  delete bare.enum;
  delete bare.default;
  if (Object.hasOwn(value, "enum")) {
    if (!Array.isArray(value.enum) || value.enum.length === 0) {
      return invalid(`${path}.enum must be nonempty`);
    }
    if (visiting.has(value.enum)) return invalid(`${path}.enum is cyclic`);
    visiting.add(value.enum);
    const choices: JsonValue[] = [];
    for (const choice of value.enum) {
      const copied = asJson(choice);
      if (copied === undefined) return invalid(`${path}.enum is not JSON`);
      const checked = checkValue(bare, copied, `${path}.enum`);
      if (!checked.ok) return checked;
      if (choices.some((existing) => sameJson(existing, checked.value))) {
        return invalid(`${path}.enum has a duplicate`);
      }
      choices.push(checked.value);
    }
    visiting.delete(value.enum);
    schema.enum = choices;
  }
  if (Object.hasOwn(value, "default")) {
    if (typeof value.default === "object" && value.default !== null) {
      if (visiting.has(value.default)) {
        return invalid(`${path}.default is cyclic`);
      }
    }
    const copied = asJson(value.default);
    if (copied === undefined) return invalid(`${path}.default is not JSON`);
    const checked = checkValue(
      { ...bare, enum: schema.enum },
      copied,
      `${path}.default`,
    );
    if (!checked.ok) return checked;
    schema.default = checked.value;
  }
  visiting.delete(value);
  return { ok: true, value: schema };
}

function checkValue(
  schema: InputSchema,
  value: JsonValue,
  path: string,
): ValidationResult<JsonValue> {
  if (!matchesType(schema.type, value)) {
    return invalid(`${path} has the wrong type`);
  }
  if (schema.type === "string" && typeof value === "string") {
    const length = lengthOf(value);
    if (schema.minLength !== undefined && length < schema.minLength) {
      return invalid(`${path} is shorter than minLength`);
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      return invalid(`${path} is longer than maxLength`);
    }
  }
  if (
    (schema.type === "integer" || schema.type === "number") &&
    typeof value === "number"
  ) {
    if (schema.type === "integer" && !Number.isSafeInteger(value)) {
      return invalid(`${path} is not a safe integer`);
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      return invalid(`${path} is below minimum`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return invalid(`${path} is above maximum`);
    }
  }
  if (schema.type === "array" && Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return invalid(`${path} has too few items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return invalid(`${path} has too many items`);
    }
    const items: JsonValue[] = [];
    for (const [index, item] of value.entries()) {
      const checked = checkValue(schema.items!, item, `${path}[${index}]`);
      if (!checked.ok) return checked;
      items.push(checked.value);
    }
    const itemsValue: JsonValue = items;
    if (
      schema.enum && !schema.enum.some((choice) => sameJson(choice, itemsValue))
    ) {
      return invalid(`${path} is outside enum`);
    }
    return { ok: true, value: items };
  }
  if (schema.type === "object" && isObject(value)) {
    const input = asJson(value);
    if (!input || Array.isArray(input) || input === null) {
      return invalid(`${path} is not a plain object`);
    }
    const source = input as JsonObject;
    const properties = schema.properties ?? {};
    for (const key of Object.keys(source)) {
      if (!Object.hasOwn(properties, key)) {
        return invalid(`${path}.${key} is not declared`);
      }
    }
    const output: JsonObject = {};
    for (const key of Object.keys(properties).sort()) {
      if (Object.hasOwn(source, key)) {
        const checked = checkValue(
          properties[key]!,
          source[key]!,
          `${path}.${key}`,
        );
        if (!checked.ok) return checked;
        defineOwn(output, key, checked.value);
      } else if (Object.hasOwn(properties[key]!, "default")) {
        defineOwn(output, key, properties[key]!.default as JsonValue);
      } else if (schema.required?.includes(key)) {
        return invalid(`${path}.${key} is required`);
      }
    }
    const objectValue: JsonValue = output;
    if (
      schema.enum &&
      !schema.enum.some((choice) => sameJson(choice, objectValue))
    ) {
      return invalid(`${path} is outside enum`);
    }
    return { ok: true, value: output };
  }
  const normalized = normalizeJson(value);
  if (
    schema.enum && !schema.enum.some((choice) => sameJson(choice, normalized))
  ) {
    return invalid(`${path} is outside enum`);
  }
  return { ok: true, value: normalized };
}

export function validateInput(
  schema: InputSchema | null,
  value?: unknown,
): ValidationResult<JsonValue | undefined> {
  if (schema === null) {
    return value === undefined
      ? { ok: true, value: undefined }
      : invalid("command accepts no input");
  }
  const parsed = validateSchemaNode(schema, "input");
  if (!parsed.ok) return parsed;
  const supplied = value === undefined && Object.hasOwn(parsed.value, "default")
    ? parsed.value.default
    : value;
  if (supplied === undefined) return invalid("input is required");
  const copied = asJson(supplied);
  if (copied === undefined) return invalid("input is not JSON");
  return checkValue(parsed.value, copied, "input");
}


// A deliberately small JSON Schema checker — enough for the subset our contract files use:
// type (incl. union arrays), required, properties, additionalProperties, enum, items.
//
// Why not a real validator: adding ajv for seven fixtures is weight the repo does not need, and a
// partial checker that ANNOUNCES its limits is safer than one that silently ignores keywords it
// does not implement. Unsupported keywords are reported, never skipped quietly.

const SUPPORTED = new Set([
  "$schema", "$id", "title", "description", "type", "required", "properties",
  "additionalProperties", "enum", "items", "format", "default",
]);

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "number" && Number.isInteger(value) ? "integer" : typeof value;
}

function matchesType(value, expected) {
  const types = Array.isArray(expected) ? expected : [expected];
  const actual = typeOf(value);
  return types.some((type) => type === actual || (type === "number" && actual === "integer"));
}

/**
 * @returns {string[]} human-readable problems; empty means conforming.
 */
export function validateAgainstSchema(value, schema, path = "$") {
  const problems = [];

  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED.has(keyword) && !keyword.startsWith("x-")) {
      problems.push(`${path}: schema uses unsupported keyword "${keyword}" — this checker ignores it.`);
    }
  }

  if (schema.type && !matchesType(value, schema.type)) {
    problems.push(`${path}: expected ${[].concat(schema.type).join("|")}, got ${typeOf(value)}.`);
    return problems; // further checks would be noise
  }

  if (schema.enum && !schema.enum.includes(value)) {
    problems.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}.`);
  }

  if (typeOf(value) === "object") {
    for (const key of schema.required ?? []) {
      if (!(key in value)) problems.push(`${path}.${key}: required property is missing.`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in value) problems.push(...validateAgainstSchema(value[key], child, `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        // `_fixture` is our own provenance annotation, never part of the wire payload.
        if (key === "_fixture") continue;
        if (!(key in (schema.properties ?? {}))) problems.push(`${path}.${key}: not allowed by the schema.`);
      }
    }
  }

  if (typeOf(value) === "array" && schema.items) {
    for (const [index, item] of value.entries()) {
      problems.push(...validateAgainstSchema(item, schema.items, `${path}[${index}]`));
    }
  }

  return problems;
}

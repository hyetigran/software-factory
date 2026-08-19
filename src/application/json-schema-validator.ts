type Schema = Record<string, unknown>;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resolveReference(root: Schema, reference: string): Schema {
  if (!reference.startsWith("#/"))
    throw new TypeError("Unsupported schema ref");
  let current: unknown = root;
  for (const token of reference.slice(2).split("/")) {
    current =
      object(current)?.[token.replaceAll("~1", "/").replaceAll("~0", "~")];
  }
  const resolved = object(current);
  if (resolved === null)
    throw new TypeError(`Unknown schema ref: ${reference}`);
  return resolved;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateNode(value: unknown, schema: Schema, root: Schema): boolean {
  if (typeof schema.$ref === "string") {
    return validateNode(value, resolveReference(root, schema.$ref), root);
  }
  if ("const" in schema && !equal(value, schema.const)) return false;
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((item) => equal(item, value))
  ) {
    return false;
  }
  if (schema.type === "object") {
    const record = object(value);
    if (record === null) return false;
    const properties = object(schema.properties) ?? {};
    if (
      Array.isArray(schema.required) &&
      schema.required.some((key) => typeof key !== "string" || !(key in record))
    ) {
      return false;
    }
    if (
      schema.additionalProperties === false &&
      Object.keys(record).some((key) => !(key in properties))
    ) {
      return false;
    }
    return Object.entries(record).every(([key, nested]) => {
      const child = object(properties[key]);
      return child === null || validateNode(nested, child, root);
    });
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      return false;
    }
    if (
      schema.uniqueItems === true &&
      new Set(value.map((item) => JSON.stringify(item))).size !== value.length
    ) {
      return false;
    }
    const items = object(schema.items);
    return (
      items === null || value.every((item) => validateNode(item, items, root))
    );
  }
  if (schema.type === "string") {
    return (
      typeof value === "string" &&
      (typeof schema.minLength !== "number" ||
        value.length >= schema.minLength) &&
      (typeof schema.maxLength !== "number" ||
        value.length <= schema.maxLength) &&
      (typeof schema.pattern !== "string" ||
        new RegExp(schema.pattern, "u").test(value))
    );
  }
  if (schema.type === "integer") {
    return (
      Number.isInteger(value) &&
      (typeof schema.minimum !== "number" ||
        (value as number) >= schema.minimum)
    );
  }
  return true;
}

export function assertJsonSchema(value: unknown, schema: unknown): void {
  const root = object(schema);
  if (root === null || !validateNode(value, root, root)) {
    throw new TypeError("Artifact does not satisfy its normative JSON schema");
  }
}

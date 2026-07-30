import { createHash } from "node:crypto";

import { invariant } from "./errors.js";

// 业务身份必须与对象字段插入顺序无关，因此统一规范化后再序列化和计算哈希。
export function canonicalize(value, path = "$") {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    invariant(
      Number.isFinite(value),
      "INVALID_CANONICAL_NUMBER",
      `Canonical JSON cannot contain a non-finite number at ${path}`,
    );
    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  }

  invariant(
    typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype,
    "INVALID_CANONICAL_VALUE",
    `Canonical JSON requires plain objects at ${path}`,
  );

  const result = {};
  for (const key of Object.keys(value).sort()) {
    invariant(
      value[key] !== undefined,
      "INVALID_CANONICAL_VALUE",
      `Canonical JSON cannot contain undefined at ${path}.${key}`,
    );
    result[key] = canonicalize(value[key], `${path}.${key}`);
  }
  return result;
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  const content =
    typeof value === "string" || Buffer.isBuffer(value)
      ? value
      : canonicalStringify(value);
  return createHash("sha256").update(content).digest("hex");
}

export function stableId(prefix, value, length = 24) {
  // 稳定 ID 来自精确内容，同一主体在重启或换机器后仍得到同一个标识符。
  return `${prefix}-${sha256(value).slice(0, length)}`;
}

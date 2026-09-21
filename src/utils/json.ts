/**
 * JSON 解析与 unknown 收窄工具集。
 *
 * `JSON.parse` 的返回类型是 `any`：只要对它做一次属性访问，`any` 就会一路扩散到
 * 后面每一处读写，在官方审核用的 eslint 规则集里刷出成片的
 * `no-unsafe-member-access` / `no-unsafe-assignment` / `no-unsafe-call`。
 *
 * 这里把入口统一收敛成 `unknown`，再用显式收窄（`typeof` / `Array.isArray`）
 * 把值取出来——调用方拿到的是确定的类型，也就不会再有 unsafe 传播。
 * 外部 API 的响应都用这套工具处理，别直接 `JSON.parse(...).xxx`。
 */

/** 解析 JSON 文本；失败返回 undefined（对应「这一行不是合法 JSON，跳过」的场景）。 */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** 解析 JSON 文本；失败抛出 SyntaxError（对应「解析失败就该中断」的场景）。 */
export function parseJsonOrThrow(text: string): unknown {
  return JSON.parse(text) as unknown;
}

/** 收窄成普通对象；数组 / null / 原始值一律返回空对象。 */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 收窄成数组；非数组返回空数组。元素仍是 unknown，需逐个再收窄。 */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/** 读取文本字段：字符串原样返回，数字/布尔转成字符串，其余回落默认值。 */
export function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

/** 读取数字字段：只有有限数字才算数，其余回落默认值。 */
export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 把响应里的 error 字段转成可读文本（字符串原样，对象尽量序列化）。 */
export function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/** 把任意抛出物归一化成 Error，保证抛出去的总是 Error 实例。 */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(errorText(value) || "unknown error");
}

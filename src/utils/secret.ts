import { App } from "obsidian";
import type { ModelLink } from "../settings";

const MODEL_KEY_PREFIX = "smartnotes-model";
const WEB_KEY_PREFIX = "smartnotes-web";

/**
 * 为模型链接生成一个合规的 keychain secret ID。
 * Obsidian SecretStorage 要求 ID 为小写字母、数字和横线。
 */
export function modelLinkSecretId(linkId: string): string {
  return `${MODEL_KEY_PREFIX}-${sanitizeSecretId(linkId)}`;
}

/**
 * 清理字符串，使其符合 Obsidian SecretStorage 的 ID 规范：
 * 仅保留小写字母、数字和横线；连续非法字符替换为单个横线；
 * 去掉首尾横线；最终为空时返回 "default"。
 */
export function sanitizeSecretId(raw: string): string {
  return (
    raw
      .toLowerCase()
      // 将非 [a-z0-9-] 字符替换为横线
      .replace(/[^a-z0-9-]+/g, "-")
      // 合并连续横线
      .replace(/-+/g, "-")
      // 去掉首尾横线
      .replace(/^-|-$/g, "") || "default"
  );
}

/**
 * 从 Obsidian keychain 读取模型链接对应的实际 API Key。
 * 返回 null 表示未配置或找不到。
 */
export function resolveModelLinkApiKey(
  app: App,
  link: ModelLink
): string | null {
  if (!link.apiKeyRef) return null;
  return app.secretStorage.getSecret(link.apiKeyRef);
}

/**
 * 将明文 API Key 迁移到 Obsidian keychain。
 *
 * 仅当 link 仍带有旧字段 `apiKey` 且尚未设置 `apiKeyRef` 时执行：
 * 1. 用 link.id 生成 deterministic secret ID 写入 keychain
 * 2. 设置 link.apiKeyRef
 * 3. 删除 link.apiKey（避免继续保存在 data.json）
 *
 * 该函数是同步的：SecretStorage.getSecret/setSecret 在 Obsidian 中为同步 API。
 */
export function migrateModelLinkApiKeyToKeychain(
  app: App,
  link: ModelLink & { apiKey?: string }
): void {
  const legacyKey = (link as unknown as Record<string, unknown>).apiKey;
  if (typeof legacyKey === "string" && legacyKey && !link.apiKeyRef) {
    const secretId = modelLinkSecretId(link.id);
    app.secretStorage.setSecret(secretId, legacyKey);
    link.apiKeyRef = secretId;
    delete (link as unknown as Record<string, unknown>).apiKey;
  }
}

/**
 * 为联网搜索 provider 的明文密钥生成确定性 keychain secret ID。
 * 形如 `smartnotes-web-<provider>-<n>`，便于用户识别与迁移幂等。
 */
export function webKeySecretId(provider: string, n: number): string {
  return `${WEB_KEY_PREFIX}-${sanitizeSecretId(provider)}-${n}`;
}

/**
 * 把明文密钥迁移到 Obsidian keychain，返回单个引用 ID。
 * 仅保留第一个非空密钥（UI 已改为单密钥配置），写入确定性 ID
 * `<provider>-1`；调用方应把返回的 ID 存入 settings 的 `<provider>ApiKeyRef`
 * 字段（data.json 只保留引用，不保留明文）。
 */
export function migrateWebApiKeysToKeychain(
  app: App,
  provider: "tavily" | "serper" | "brave",
  keys: string[]
): string | null {
  const first = (Array.isArray(keys) ? keys : [])
    .find((k) => typeof k === "string" && k);
  if (!first) return null;
  const id = webKeySecretId(provider, 1);
  app.secretStorage.setSecret(id, first);
  return id;
}

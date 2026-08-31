import {
  type AiNoteAgentSettings,
  DEFAULT_SETTINGS,
  genId,
  type ModelLink,
  type ProviderType,
  type RoleInfo,
  migrateModelLinkApiKeyToKeychain,
} from "./settings";
import { t } from "./i18n";
import { App } from "obsidian";
import { migrateWebApiKeysToKeychain } from "./utils/secret";

/**
 * 设置迁移：把旧版扁平字段（单一 provider / customInstructions）
 * 迁移到新结构（modelLinks / roles），并做 defaultModelLinkId / defaultRoleId 兜底。
 * 直接修改传入的 settings 对象（mutation），无返回值。
 *
 * 迁移项：
 * 1. 旧版单一 provider 扁平配置 → 单条模型链接（modelLinks）
 * 2. defaultModelLinkId 指向不存在链接时回退到列表第一个
 * 3. 旧版单一 customInstructions → 单条「默认角色」（roles）
 * 4. defaultRoleId 指向不存在角色时回退到列表第一个
 *
 * @param loaded 从 data.json 加载的原始数据（merge 前）
 * @param settings 已与 DEFAULT_SETTINGS 合并的设置对象，迁移结果写回此处
 */
export function migrateSettings(
  loaded: Record<string, any>,
  settings: AiNoteAgentSettings,
  app: App
): void {
  // ── 迁移 1：旧版单一 provider 扁平配置 → 单条模型链接 ──
  if (!settings.modelLinks || settings.modelLinks.length === 0) {
    const hasLegacy =
      loaded.provider ||
      loaded.openaiApiKey ||
      loaded.openaiBaseUrl ||
      loaded.ollamaBaseUrl ||
      loaded.openaiModel ||
      loaded.ollamaModel;
    if (hasLegacy) {
      const isOllama = loaded.provider === "ollama";
      const modelId = isOllama ? loaded.ollamaModel : loaded.openaiModel;
      const link: ModelLink & { apiKey?: string } = {
        id: genId(),
        name: t("settings.modelLinks.legacyName"),
        type: (isOllama ? "ollama" : "openai") as ProviderType,
        baseUrl: isOllama
          ? loaded.ollamaBaseUrl || DEFAULT_SETTINGS.ollamaBaseUrl
          : loaded.openaiBaseUrl || DEFAULT_SETTINGS.openaiBaseUrl,
        apiKey: loaded.openaiApiKey || "",
        models: modelId ? [modelId] : [],
      };
      // 旧版 openaiApiKey 从 data.json 迁移到 Obsidian keychain
      migrateModelLinkApiKeyToKeychain(app, link);
      delete (link as unknown as Record<string, unknown>).apiKey;
      settings.modelLinks = [link];
      settings.defaultModelLinkId = link.id;
    } else {
      settings.modelLinks = [];
      settings.defaultModelLinkId = "";
    }
  }

  // ── 兜底 1：defaultModelLinkId 指向不存在的链接时，回退到列表第一个 ──
  if (
    settings.modelLinks.length > 0 &&
    !settings.modelLinks.some((l) => l.id === settings.defaultModelLinkId)
  ) {
    settings.defaultModelLinkId = settings.modelLinks[0].id;
  }

  // ── 迁移 1b：已有 modelLinks 中的明文 apiKey → Obsidian keychain ──
  for (const link of settings.modelLinks) {
    migrateModelLinkApiKeyToKeychain(
      app,
      link as ModelLink & { apiKey?: string }
    );
  }

  // ── 迁移 3：旧版联网搜索密钥（tavily/serper/brave）→ 单值 keychain 引用 ──
  // 兼容三种历史形态，统一收敛为单个 <provider>ApiKeyRef 引用：
  //   a) 明文数组 tavilyApiKeys（最早版本）→ 写入 keychain，取第一个
  //   b) 引用数组 tavilyApiKeyRefs（上轮 keychain 化遗留）→ 直接取第一个
  //   c) 当前单值 tavilyApiKeyRef → 保持不变
  const webProviders: Array<"tavily" | "serper" | "brave"> = [
    "tavily",
    "serper",
    "brave",
  ];
  for (const prov of webProviders) {
    const refField = `${prov}ApiKeyRef` as
      | "tavilyApiKeyRef"
      | "serperApiKeyRef"
      | "braveApiKeyRef";
    const settingsAny = settings as unknown as Record<string, string>;
    // 已是单值引用且非空 → 无需处理
    if (settingsAny[refField]) continue;

    // b) 上轮遗留的引用数组：第一个元素本身就是 keychain ID
    const legacyRefs = (loaded as Record<string, unknown>)[
      `${prov}ApiKeyRefs`
    ];
    if (
      Array.isArray(legacyRefs) &&
      legacyRefs.length > 0 &&
      typeof legacyRefs[0] === "string" &&
      legacyRefs[0]
    ) {
      settingsAny[refField] = legacyRefs[0];
      continue;
    }

    // a) 最早的明文数组 → 迁入 keychain，取第一个
    const legacyKeys = (loaded as Record<string, unknown>)[
      `${prov}ApiKeys`
    ];
    if (Array.isArray(legacyKeys) && legacyKeys.length > 0) {
      const ref = migrateWebApiKeysToKeychain(
        app,
        prov,
        legacyKeys as string[]
      );
      if (ref) settingsAny[refField] = ref;
    }
  }
  // 安全清理：删除由 Object.assign 带入 settings 的旧数组字段，否则下次
  // saveSettings 会把它们重新写回 data.json，导致「保存多个密钥」的残留。
  delete (settings as unknown as Record<string, unknown>).tavilyApiKeyRefs;
  delete (settings as unknown as Record<string, unknown>).serperApiKeyRefs;
  delete (settings as unknown as Record<string, unknown>).braveApiKeyRefs;
  delete (settings as unknown as Record<string, unknown>).tavilyApiKeys;
  delete (settings as unknown as Record<string, unknown>).serperApiKeys;
  delete (settings as unknown as Record<string, unknown>).braveApiKeys;

  // ── 迁移 2：旧版单一 customInstructions（系统指令）→ 单条「默认角色」──
  if (!settings.roles || settings.roles.length === 0) {
    const legacy = loaded.customInstructions;
    if (legacy && legacy.trim()) {
      const role: RoleInfo = {
        id: genId(),
        name: t("settings.roles.legacyName"),
        prompt: legacy.trim(),
      };
      settings.roles = [role];
      settings.defaultRoleId = role.id;
    } else {
      settings.roles = [];
      settings.defaultRoleId = "";
    }
  }

  // ── 兜底 2：defaultRoleId 指向不存在的角色时，回退到列表第一个 ──
  if (
    settings.roles.length > 0 &&
    !settings.roles.some((r) => r.id === settings.defaultRoleId)
  ) {
    settings.defaultRoleId = settings.roles[0].id;
  }

  // ── 安全清理：旧版明文 openaiApiKey 已迁移到 keychain ──
  // loadSettings 用 Object.assign 把旧 data.json 的明文 openaiApiKey 一并带入
  // settings 对象；迁移后该值已写入 keychain，此处必须清空，否则下次 saveSettings
  // 会把它重新写回 data.json，导致明文密钥泄露。
  settings.openaiApiKey = "";
}

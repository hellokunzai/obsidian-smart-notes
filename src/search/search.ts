import { App, requestUrl } from "obsidian";
import { t } from "../i18n";

/**
 * 联网搜索模块。
 *
 * 设计原则（与文件/ Skill 的「显式控制」风格一致）：
 * - 默认不进行任何联网操作，仅当用户在对话中显式开启「联网搜索」时才调用外部 API；
 * - 支持多个常用 Provider：Tavily / Serper / Brave / SearXNG；
 * - 每个 API Key 类 Provider 仅支持单个密钥（由 UI 控制）；SearXNG 实例仍可多选。
 */

/** 单条搜索结果（已归一化）。 */
export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

/** 搜索 Provider 标识。 */
export type SearchProviderId = "tavily" | "serper" | "brave" | "searxng";

/** 可配置密钥/实例集合。 */
export interface SearchProviderConfig {
  /** 全局总开关 */
  enabled: boolean;
  /** 当前选中的 provider */
  provider: SearchProviderId;
  /** Tavily API Key 引用（Obsidian keychain 中的 secret ID，单密钥） */
  tavilyApiKeyRef: string;
  /** Serper API Key 引用（单密钥） */
  serperApiKeyRef: string;
  /** Brave API Key 引用（单密钥） */
  braveApiKeyRef: string;
  /** SearXNG 实例地址（可多个，https://host；非密钥，明文配置） */
  searxngInstances: string[];
  /** 单次最大结果数 */
  maxResults: number;
  /** 单条结果摘要的字符上限 */
  maxCharsPerResult: number;
}

/**
 * 搜索 Provider 接口。
 * @param query 查询词
 * @param keys  凭据数组（API Key 或实例 URL）
 * @param max   最大结果数
 */
interface WebSearchProvider {
  search(query: string, keys: string[], max: number): Promise<SearchResult[]>;
}

/** Tavily：POST https://api.tavily.com/search */
class TavilyProvider implements WebSearchProvider {
  async search(query: string, keys: string[], max: number): Promise<SearchResult[]> {
    let lastErr: unknown = null;
    for (const key of keys) {
      try {
        const resp = await requestUrl({
          url: "https://api.tavily.com/search",
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: key,
            query,
            max_results: max,
            search_depth: "basic",
            include_answer: false,
          }),
        });
        if (resp.status !== 200) {
          lastErr = new Error(t("settings.test.httpError", { status: String(resp.status) }));
          continue;
        }
        const data = resp.json;
        if (data?.error) {
          lastErr = new Error(String(data.error));
          continue;
        }
        const results: any[] = data?.results ?? [];
        return results
          .map((r) => ({
            title: String(r.title ?? ""),
            url: String(r.url ?? ""),
            content: String(r.content ?? ""),
          }))
          .filter((r) => r.url);
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    return [];
  }
}

/** Serper：POST https://google.serper.dev/search + X-API-KEY */
class SerperProvider implements WebSearchProvider {
  async search(query: string, keys: string[], max: number): Promise<SearchResult[]> {
    let lastErr: unknown = null;
    for (const key of keys) {
      try {
        const resp = await requestUrl({
          url: "https://google.serper.dev/search",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": key,
          },
          body: JSON.stringify({ q: query, num: max }),
        });
        if (resp.status !== 200) {
          lastErr = new Error(t("settings.test.httpError", { status: String(resp.status) }));
          continue;
        }
        const data = resp.json;
        if (data?.error) {
          lastErr = new Error(String(data.error));
          continue;
        }
        const organic: any[] = data?.organic ?? [];
        return organic
          .slice(0, max)
          .map((r) => ({
            title: String(r.title ?? ""),
            url: String(r.link ?? ""),
            content: String(r.snippet ?? ""),
          }))
          .filter((r) => r.url);
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    return [];
  }
}

/** Brave：GET https://api.search.brave.com/res/v1/web/search + X-Subscription-Token */
class BraveProvider implements WebSearchProvider {
  async search(query: string, keys: string[], max: number): Promise<SearchResult[]> {
    let lastErr: unknown = null;
    for (const key of keys) {
      try {
        const resp = await requestUrl({
          url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
            query
          )}&count=${max}`,
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": key,
          },
        });
        if (resp.status !== 200) {
          lastErr = new Error(t("settings.test.httpError", { status: String(resp.status) }));
          continue;
        }
        const data = resp.json;
        if (data?.error) {
          lastErr = new Error(String(data.error));
          continue;
        }
        const web: any = data?.web ?? {};
        const items: any[] = web?.results ?? [];
        return items
          .slice(0, max)
          .map((r) => ({
            title: String(r.title ?? ""),
            url: String(r.url ?? ""),
            content: String(r.description ?? ""),
          }))
          .filter((r) => r.url);
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    return [];
  }
}

/** SearXNG：GET {instance}/search?format=json */
class SearXNGProvider implements WebSearchProvider {
  async search(query: string, keys: string[], max: number): Promise<SearchResult[]> {
    let lastErr: unknown = null;
    for (const base of keys) {
      const baseUrl = base.replace(/\/+$/, "");
      try {
        const resp = await requestUrl({
          url: `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json`,
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (resp.status !== 200) {
          lastErr = new Error(t("settings.test.httpError", { status: String(resp.status) }));
          continue;
        }
        const data = resp.json;
        if (data?.error) {
          lastErr = new Error(String(data.error));
          continue;
        }
        const items: any[] = data?.results ?? [];
        return items
          .slice(0, max)
          .map((r) => ({
            title: String(r.title ?? ""),
            url: String(r.url ?? ""),
            content: String(r.content ?? r.snippet ?? ""),
          }))
          .filter((r) => r.url);
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    return [];
  }
}

const PROVIDERS: Record<SearchProviderId, WebSearchProvider> = {
  tavily: new TavilyProvider(),
  serper: new SerperProvider(),
  brave: new BraveProvider(),
  searxng: new SearXNGProvider(),
};

/**
 * 联网搜索服务：根据配置选 provider，调用对应搜索。
 * API Key 类 provider 仅使用单个密钥；SearXNG 仍支持多实例轮询。
 */
export class WebSearchService {
  constructor(private app: App, private config: SearchProviderConfig) {}

  /** 当前是否配置了至少一个可用的凭据。 */
  hasCredentials(): boolean {
    const keys = this.keysForProvider(this.config.provider);
    return keys.length > 0;
  }

  /** 把单个 keychain 引用 ID 解析为实际密钥。 */
  private resolveRef(ref: string): string | null {
    return ref ? this.app.secretStorage.getSecret(ref) : null;
  }

  private keysForProvider(p: SearchProviderId): string[] {
    switch (p) {
      case "tavily": {
        const key = this.resolveRef(this.config.tavilyApiKeyRef);
        return key ? [key] : [];
      }
      case "serper": {
        const key = this.resolveRef(this.config.serperApiKeyRef);
        return key ? [key] : [];
      }
      case "brave": {
        const key = this.resolveRef(this.config.braveApiKeyRef);
        return key ? [key] : [];
      }
      case "searxng":
        return this.config.searxngInstances;
    }
  }

  /** 执行一次搜索，返回归一化结果（已截断单条内容到上限）。 */
  async search(query: string): Promise<SearchResult[]> {
    if (!this.config.enabled) return [];
    const keys = this.keysForProvider(this.config.provider);
    if (keys.length === 0) return [];
    const provider = PROVIDERS[this.config.provider];
    let results: SearchResult[];
    try {
      results = await provider.search(query, keys, this.config.maxResults);
    } catch {
      return [];
    }
    const cap = this.config.maxCharsPerResult;
    return results.map((r) => ({
      ...r,
      content: r.content.length > cap ? r.content.slice(0, cap) + "…" : r.content,
    }));
  }

  /**
   * 测试指定 provider 的凭据是否可用。
   * 凭据无效（HTTP 非 200 / 响应含 error 字段 / 网络错误）时抛出带原因的错误。
   */
  async testConnection(providerId: SearchProviderId): Promise<boolean> {
    const keys = this.keysForProvider(providerId);
    if (keys.length === 0) throw new Error(t("settings.test.noKey"));
    const provider = PROVIDERS[providerId];
    await provider.search("test", keys, 1);
    return true;
  }
}

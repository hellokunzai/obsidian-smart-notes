import {
  Plugin,
  Notice,
  TFile,
  WorkspaceLeaf,
  MarkdownView,
  addIcon,
  Modal,
  TextComponent,
  ButtonComponent,
  requestUrl,
  Events,
  type RequestUrlResponse,
} from "obsidian";
import {
  DEFAULT_SETTINGS,
  AiNoteAgentSettingTab,
  type AiNoteAgentSettings,
  genId,
} from "./settings";
import {
  createProvider,
  type AIProvider,
  type ChatMessage,
} from "./ai/provider";
import { optimizeNote } from "./optimize/optimizer";
import { OptimizeModal } from "./optimize/previewModal";
import {
  createRealtimeExtension,
  autopromptAtCursor,
} from "./editor/autoprompt";
import { initI18n, t } from "./i18n";
import { CHAT_VIEW_TYPE, ChatView } from "./view/chatView";
import { ensureAiFolder } from "./utils/aiFolder";
import { rebuildProfileMemory } from "./memory/profileMemory";

const ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3"/></svg>`;

export default class AiNoteAgentPlugin extends Plugin {
  settings: AiNoteAgentSettings;
  /** 设置变更事件总线（用于通知已打开的视图刷新 UI）。 */
  settingsEvents = new Events();
  private provider!: AIProvider;
  private memoryRebuildTimeout?: number;

  async onload() {
    await this.loadSettings();
    this.provider = createProvider(this.settings);
    initI18n(this.app);

    addIcon("vault-mind", ICON_SVG);

    // 自动在 vault 根目录生成 AI 数据文件夹（记忆 + skills）
    void ensureAiFolder(this);

    // 后台静默整理长期画像记忆：读取全部会话历史，生成/更新 memory/MEMORY.md 与 memory/yyyy-mm-dd.md
    this.memoryRebuildTimeout = window.setTimeout(
      () => void rebuildProfileMemory(this),
      3000
    );

    this.addSettingTab(new AiNoteAgentSettingTab(this.app, this));

    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));

    // Realtime inline autoprompt editor extension
    this.registerEditorExtension(createRealtimeExtension(this));

    this.addRibbonIcon("vault-mind", t("plugin.name"), () => {
      void this.openChatView();
    });

    this.addCommand({
      id: "optimize-current",
      name: t("cmd.optimizeCurrent"),
      checkCallback: (checking) => {
        if (!this.settings.optimizeCurrentEnabled) return false;
        const active = this.app.workspace.getActiveFile();
        if (!active || active.extension !== "md") return false;
        if (!checking) {
          void this.runWithNotice(t("notice.optimizing"), () =>
            this.optimizeCommand(active)
          );
        }
        return true;
      },
    });

    this.addCommand({
      id: "autoprompt",
      name: t("cmd.autoprompt"),
      checkCallback: (checking) => {
        if (!this.settings.realtimeEnabled) return false;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !view.editor) return false;
        if (!checking) {
          const editor = view.editor;
          void this.runWithNotice(t("notice.thinking"), () =>
            autopromptAtCursor(this, editor)
          );
        }
        return true;
      },
    });

    this.addCommand({
      id: "open-chat",
      name: t("cmd.openChat"),
      checkCallback: (checking) => {
        if (!this.settings.chatPanelEnabled) return false;
        if (!checking) {
          const active = this.app.workspace.getActiveFile();
          void this.openChatView(
            active instanceof TFile ? active : undefined
          );
        }
        return true;
      },
    });

    this.addCommand({
      id: "generate-frontmatter",
      name: t("cmd.generateFrontmatter"),
      checkCallback: (checking) => {
        const active = this.app.workspace.getActiveFile();
        if (!active || active.extension !== "md") return false;
        if (!this.settings.frontmatterGenerationEnabled) return false;
        if (!checking) {
          void this.runWithNotice(t("notice.generatingFrontmatter"), () =>
            this.generateFrontmatterCommand(active)
          );
        }
        return true;
      },
    });

    this.addCommand({
      id: "fetch-web-content",
      name: t("cmd.fetchWebContent"),
      checkCallback: (checking) => {
        if (!this.settings.fetchWebContentEnabled) return false;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !view.editor) return false;
        if (!checking) {
          new FetchWebContentModal(this.app, async (url) => {
            void this.runWithNotice(t("notice.fetchingWebContent"), () =>
              this.fetchWebContentCommand(view.editor, url)
            );
          }).open();
        }
        return true;
      },
    });
  }

  private async openChatView(file?: TFile): Promise<void> {
    const { workspace } = this.app;

    // If the view already exists in the workspace, reveal it.
    const existing = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (existing.length > 0) {
      const leaf = existing[0];
      await workspace.revealLeaf(leaf);
      if (file && this.settings.addCurrentNoteToChat) {
        const view = leaf.view;
        if (view instanceof ChatView) {
          await view.attachCurrentNote(file);
        }
      }
      return;
    }

    // Otherwise create a new leaf on the right sidebar.
    const rightLeaf = workspace.getRightLeaf(false);
    if (!rightLeaf) {
      new Notice(t("view.openFailed"));
      return;
    }
    await rightLeaf.setViewState({
      type: CHAT_VIEW_TYPE,
      active: true,
    });
    await workspace.revealLeaf(rightLeaf);
    if (file && this.settings.addCurrentNoteToChat) {
      const view = rightLeaf.view;
      if (view instanceof ChatView) {
        await view.attachCurrentNote(file);
      }
    }
  }

  onunload() {
    // registerEditorExtension / addCommand resources are cleaned up automatically
    if (this.memoryRebuildTimeout) {
      window.clearTimeout(this.memoryRebuildTimeout);
    }
  }

  getProvider(): AIProvider {
    return this.provider;
  }

  async loadSettings() {
    const loaded = (await this.loadData()) as Record<string, any>;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

    // 迁移：旧的单一 provider 扁平配置 → 单条模型链接
    if (!this.settings.modelLinks || this.settings.modelLinks.length === 0) {
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
        const link = {
          id: genId(),
          name: t("settings.modelLinks.legacyName"),
          type: (isOllama ? "ollama" : "openai") as "openai" | "ollama",
          baseUrl: isOllama
            ? loaded.ollamaBaseUrl || DEFAULT_SETTINGS.ollamaBaseUrl
            : loaded.openaiBaseUrl || DEFAULT_SETTINGS.openaiBaseUrl,
          apiKey: loaded.openaiApiKey || "",
          models: modelId ? [modelId] : [],
        };
        this.settings.modelLinks = [link];
        this.settings.defaultModelLinkId = link.id;
      } else {
        this.settings.modelLinks = [];
        this.settings.defaultModelLinkId = "";
      }
    }

    // 兜底：defaultModelLinkId 指向不存在的链接时，回退到列表第一个
    if (
      this.settings.modelLinks.length > 0 &&
      !this.settings.modelLinks.some(
        (l) => l.id === this.settings.defaultModelLinkId
      )
    ) {
      this.settings.defaultModelLinkId = this.settings.modelLinks[0].id;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.provider = createProvider(this.settings);
    // 通知已打开的视图（如对话面板）刷新依赖设置的 UI
    this.settingsEvents.trigger("settings-changed");
  }

  private async runWithNotice(msg: string, fn: () => Promise<void>) {
    const notice = new Notice(msg, 0);
    try {
      await fn();
      notice.hide();
      new Notice(t("notice.done"));
    } catch (e) {
      notice.hide();
      new Notice(t("notice.error", { error: (e as Error).message }));
    }
  }

  private async optimizeCommand(file: TFile) {
    const notice = new Notice(t("notice.optimizing"), 0);
    try {
      const content = await this.app.vault.read(file);
      const optimized = await optimizeNote(
        this,
        content,
        this.settings.linkFormat,
        this.settings.linkType
      );
      notice.hide();
      new OptimizeModal(this.app, content, optimized, async (text) => {
        await this.app.vault.modify(file, text);
        new Notice(t("notice.noteUpdated"));
      }).open();
    } catch (e) {
      notice.hide();
      new Notice(t("notice.error", { error: (e as Error).message }));
    }
  }

  private async generateFrontmatterCommand(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const body = content.replace(
      /^---\s*[\r\n]+[\s\S]*?[\r\n]+---\s*[\r\n]*/,
      ""
    );

    const systemPrompt =
      this.settings.frontmatterTemplate.trim() || t("frontmatter.systemPrompt");
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: body },
    ];

    const response = await this.provider.complete(messages, {
      maxTokens: this.settings.maxTokens,
      temperature: this.settings.temperature,
    });

    let yaml = response.trim();
    if (yaml.startsWith("```")) {
      yaml = yaml.replace(/^```[^\n]*\n?/, "").replace(/\n?```\s*$/, "");
      yaml = yaml.trim();
    }
    const hasDelimiters = yaml.startsWith("---") && yaml.includes("\n---");
    const yamlBlock = hasDelimiters ? yaml : `---\n${yaml}\n---`;

    await this.app.vault.modify(file, `${yamlBlock}\n${body}`);
  }

  private async fetchWebContentCommand(
    editor: import("obsidian").Editor,
    url: string
  ): Promise<void> {
    const file = this.app.workspace.getActiveFile() || undefined;
    const markdown = await fetchWebContentAsMarkdown(url, {
      saveImages: this.settings.fetchWebContentSaveImages,
      linkFormat: this.settings.fetchWebContentImageLinkFormat,
      linkType: this.settings.fetchWebContentImageLinkType,
      app: this.app,
      baseFile: file,
    });
    const cursor = editor.getCursor();
    editor.replaceRange(`\n${markdown}\n`, cursor);
  }
}

interface FetchWebContentOptions {
  saveImages: boolean;
  linkFormat: "wikilink" | "markdown";
  linkType: "shortest" | "relative" | "absolute";
  app: import("obsidian").App;
  baseFile?: import("obsidian").TFile;
}

/** 从 URL 拉取网页并转换为简易 Markdown。 */
async function fetchWebContentAsMarkdown(
  url: string,
  options?: FetchWebContentOptions
): Promise<string> {
  const browserHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en-US,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "max-age=0",
    "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
  };

  let resp: RequestUrlResponse;
  try {
    resp = await requestUrl({ url, method: "GET", headers: browserHeaders });
  } catch (e) {
    const status =
      typeof e === "object" && e !== null && "status" in e
        ? (e as { status: number }).status
        : undefined;
    const msg =
      status === 521
        ? "目标网站返回 521（Cloudflare Web Server Is Down），被反爬虫/机器人检测拦截。可尝试用手机浏览器打开该页后复制正文粘贴，或使用 Jina AI 等阅读器链接。"
        : status
        ? `目标网站返回 HTTP ${status}，拒绝访问。`
        : `网络请求失败：${(e as Error).message}`;
    throw new Error(msg);
  }

  if (resp.status >= 400) {
    const msg =
      resp.status === 521
        ? "目标网站返回 521（Cloudflare Web Server Is Down），被反爬虫/机器人检测拦截。可尝试用手机浏览器打开该页后复制正文粘贴，或使用 Jina AI 等阅读器链接。"
        : `目标网站返回 HTTP ${resp.status}，拒绝访问。`;
    throw new Error(msg);
  }

  const html = resp.text;

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch?.[1]?.trim() ?? "";

  // 处理图片：保存本地或保留远程链接
  let bodyHtml = html;
  if (options?.saveImages && options.app) {
    bodyHtml = await downloadAndReplaceImages(html, url, options);
  } else {
    bodyHtml = replaceRemoteImages(html, url);
  }

  // 移除 script/style/noscript/head 等标签及其内容
  let body = bodyHtml
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

  // 将常见块级标签替换为换行，便于阅读
  body = body
    .replace(/<\/(p|div|h[1-6]|li|br|tr|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");

  // 移除所有剩余标签
  body = body.replace(/<[^>]+>/g, " ");

  // 解码常见 HTML 实体
  body = body
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // 压缩空白
  body = body.replace(/\s+/g, " ").trim();

  const header = title ? `# ${title}\n\n` : "";
  const source = `\n\n> 来源：${url}`;
  return `${header}${body}${source}`;
}

/** 不保存图片时，把 <img> 替换为远程 Markdown 图片链接，保留原图可访问。 */
function replaceRemoteImages(html: string, baseUrl: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcMatch) return "";
    let src = srcMatch[1].trim();
    if (!src || src.startsWith("data:")) return "";
    try {
      src = new URL(src, baseUrl).toString();
    } catch {
      // 保持原值
    }
    const altMatch = tag.match(/\balt=["']([^"']*)["']/i);
    const alt = altMatch ? altMatch[1] : "";
    return `![${alt}](${src})`;
  });
}

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/tiff": "tiff",
};

function mimeToExt(mime: string): string | undefined {
  return MIME_EXT[mime.toLowerCase()];
}

/** 计算从 fromFilePath 到 toFilePath 的相对路径（Unix 风格）。 */
function getRelativePath(fromFilePath: string, toFilePath: string): string {
  const fromParts = fromFilePath.split("/");
  fromParts.pop(); // 去掉文件名
  const toParts = toFilePath.split("/");
  let i = 0;
  while (
    i < fromParts.length &&
    i < toParts.length &&
    fromParts[i] === toParts[i]
  ) {
    i++;
  }
  const up = fromParts.length - i;
  const down = toParts.slice(i);
  return [...Array(up).fill(".."), ...down].join("/");
}

/** 把网页中的图片下载到本地附件目录，并替换为本地 Markdown 图片链接。 */
async function downloadAndReplaceImages(
  html: string,
  baseUrl: string,
  options: FetchWebContentOptions
): Promise<string> {
  const { app, linkFormat, linkType, baseFile } = options;
  const imgTags = html.match(/<img\b[^>]*>/gi) || [];
  let result = html;

  for (const tag of imgTags) {
    const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcMatch) {
      result = result.replace(tag, "");
      continue;
    }
    let src = srcMatch[1].trim();
    if (!src || src.startsWith("data:")) {
      result = result.replace(tag, "");
      continue;
    }

    let absUrl: string;
    try {
      absUrl = new URL(src, baseUrl).toString();
    } catch {
      result = result.replace(tag, "");
      continue;
    }

    try {
      const resp = await requestUrl({
        url: absUrl,
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "Referer": baseUrl,
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
      });
      if (resp.status >= 400 || !resp.arrayBuffer) {
        result = result.replace(tag, "");
        continue;
      }

      const buffer = resp.arrayBuffer;
      // 推导文件名
      const urlPath = new URL(absUrl).pathname;
      let baseName =
        decodeURIComponent(urlPath.split("/").pop() || "") || "image";
      if (!/\.[a-z0-9]{1,5}$/i.test(baseName)) {
        const mime =
          (resp.headers && resp.headers["content-type"]) || "";
        const ext = mimeToExt(mime) || "jpg";
        baseName = `${baseName}.${ext}`;
      }

      const attachPath = await app.fileManager.getAvailablePathForAttachment(
        baseName
      );
      await app.vault.createBinary(attachPath, buffer);

      // 生成链接
      const fileName = attachPath.split("/").pop() || baseName;
      const altMatch = tag.match(/\balt=["']([^"']*)["']/i);
      const alt = altMatch ? altMatch[1] : fileName;

      let link: string;
      if (linkFormat === "wikilink") {
        if (linkType === "shortest") {
          link = `![[${fileName}]]`;
        } else if (linkType === "relative" && baseFile) {
          const rel = getRelativePath(baseFile.path, attachPath);
          link = `![[${rel}]]`;
        } else {
          link = `![[/${attachPath}]]`;
        }
      } else {
        if (linkType === "shortest") {
          link = `![${alt}](${fileName})`;
        } else if (linkType === "relative" && baseFile) {
          const rel = getRelativePath(baseFile.path, attachPath);
          link = `![${alt}](${rel})`;
        } else {
          link = `![${alt}](/${attachPath})`;
        }
      }

      result = result.replace(tag, link);
    } catch {
      result = result.replace(tag, "");
    }
  }

  return result;
}

/** 输入 URL 的模态框。 */
class FetchWebContentModal extends Modal {
  private url = "";

  constructor(
    app: import("obsidian").App,
    private onSubmit: (url: string) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: t("modal.fetchWebContent.title") });

    new TextComponent(contentEl)
      .setPlaceholder(t("modal.fetchWebContent.urlPlaceholder"))
      .onChange((v) => {
        this.url = v.trim();
      });

    const buttonRow = contentEl.createEl("div", {
      cls: "ana-modal-button-row",
    });

    new ButtonComponent(buttonRow)
      .setButtonText(t("modal.fetchWebContent.cancel"))
      .onClick(() => this.close());

    new ButtonComponent(buttonRow)
      .setButtonText(t("modal.fetchWebContent.fetch"))
      .setCta()
      .onClick(() => {
        this.close();
        if (this.url) {
          this.onSubmit(this.url);
        }
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

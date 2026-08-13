import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  DropdownComponent,
  ToggleComponent,
  setIcon,
} from "obsidian";
import type AiNoteAgentPlugin from "./main";
import { t } from "./i18n";
import { ModelLinkModal } from "./modelLinkModal";
import { loadMemoryFile, saveMemoryFile, rebuildProfileMemory } from "./memory/profileMemory";
import { listSkills, type SkillEntry } from "./skills/skills";
import { getSkillsDir } from "./utils/aiFolder";

export type ProviderType = "openai" | "ollama";

/** 一条模型链接：对应一个 AI 后端（如 DeepSeek、Ollama、OpenRouter），可挂多个模型。 */
export interface ModelLink {
  id: string;
  /** 链接名称，用户可见且不可重复。 */
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  /** 该链接下可使用的模型 ID 列表（支持多个）。 */
  models: string[];
  /** 该链接的最大 Token 数（不填则使用全局默认值）。 */
  maxTokens?: number;
  /** 该链接的温度参数（不填则使用全局默认值）。 */
  temperature?: number;
}

/** 生成短随机 id，用于模型链接唯一标识。 */
export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export interface AiNoteAgentSettings {
  provider: ProviderType;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  // ===== 模型链接（多链接）=====
  // 取代上面的单 provider 扁平字段；运行时使用 defaultModelLinkId 指向的链接
  modelLinks: ModelLink[];
  defaultModelLinkId: string;
  maxTokens: number;
  temperature: number;
  realtimeEnabled: boolean;
  realtimeDebounceMs: number;
  // 是否启用「优化当前笔记」命令
  optimizeCurrentEnabled: boolean;
  // 内部链接格式：wikilink 或 markdown
  linkFormat: "wikilink" | "markdown";
  // 内部链接路径类型：尽可能短 / 相对当前笔记 / 绝对 vault 根路径
  linkType: "shortest" | "relative" | "absolute";
  // 是否启用「打开 AI 对话面板」命令
  chatPanelEnabled: boolean;
  // 打开 AI 对话面板时是否自动把当前 Markdown 笔记作为附件加入
  addCurrentNoteToChat: boolean;
  // 是否启用「生成 Frontmatter」命令
  frontmatterGenerationEnabled: boolean;
  // Frontmatter 生成模板（留空则使用默认 system prompt）
  frontmatterTemplate: string;
  // 是否启用「拉取网页内容」命令
  fetchWebContentEnabled: boolean;
  // 拉取网页时是否把图片下载到本地
  fetchWebContentSaveImages: boolean;
  // 拉取网页时图片引用的内部链接类型
  fetchWebContentImageLinkType: "shortest" | "relative" | "absolute";
  // 拉取网页时图片引用的内部链接格式
  fetchWebContentImageLinkFormat: "wikilink" | "markdown";
  // 自定义指令：注入到所有 AI 功能的 system prompt
  customInstructions: string;
  // vault 根目录中用于存放记忆与 skill 的文件夹名称
  aiFolderName: string;
  // 长期画像记忆：总开关（关闭后不整理、不注入）
  memoryProfileEnabled: boolean;
  // 长期画像记忆：AI 自动提取的维度（每行一个）
  memoryProfileCategories: string;
  // 对话：是否把知识库路径索引（仅路径）注入 system prompt，让 AI 知道库里有哪些文件
  includeVaultIndex: boolean;
  // 对话：单文件注入到上下文的内容字符上限（防止超大文件撑爆 token）
  chatContextMaxChars: number;
  // 对话：是否启用 skill 功能（对话框「Skill 技能」按钮 + skill 内容注入）
  skillsEnabled: boolean;
  // 对话：全局默认启用的 skill（skills/ 目录下的 .md 相对路径）；新会话继承此列表
  defaultSkills: string[];
  // ===== 联网搜索 =====
  // 全局总开关
  webSearchEnabled: boolean;
  // 当前选中的 provider
  webSearchProvider: "tavily" | "serper" | "brave" | "searxng";
  // 各 provider 的多凭据（API Key 或实例地址）
  tavilyApiKeys: string[];
  serperApiKeys: string[];
  braveApiKeys: string[];
  searxngInstances: string[];
  // 单次最大结果数
  webSearchMaxResults: number;
  // 单条结果摘要字符上限
  webSearchMaxCharsPerResult: number;
  // 是否在 prompt 中要求 AI 用 [n] 标注来源
  webSearchShowCitations: boolean;
}

export const DEFAULT_SETTINGS: AiNoteAgentSettings = {
  provider: "openai",
  openaiApiKey: "",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3",
  modelLinks: [],
  defaultModelLinkId: "",
  maxTokens: 1024,
  temperature: 0.3,
  realtimeEnabled: false,
  realtimeDebounceMs: 800,
  optimizeCurrentEnabled: true,
  linkFormat: "wikilink",
  linkType: "shortest",
  chatPanelEnabled: true,
  addCurrentNoteToChat: true,
  frontmatterGenerationEnabled: true,
  frontmatterTemplate: "",
  fetchWebContentEnabled: true,
  fetchWebContentSaveImages: false,
  fetchWebContentImageLinkType: "shortest",
  fetchWebContentImageLinkFormat: "wikilink",
  customInstructions: "",
  aiFolderName: ".vaultmind",
  memoryProfileEnabled: true,
  memoryProfileCategories:
    "职业\n技术栈\n输出偏好\n项目背景\n习惯\n重要事实\n待办事项",
  includeVaultIndex: true,
  chatContextMaxChars: 8000,
  skillsEnabled: true,
  defaultSkills: [],
  webSearchEnabled: false,
  webSearchProvider: "tavily",
  tavilyApiKeys: [],
  serperApiKeys: [],
  braveApiKeys: [],
  searxngInstances: [],
  webSearchMaxResults: 5,
  webSearchMaxCharsPerResult: 1500,
  webSearchShowCitations: true,
};

interface SettingsSection {
  id: string;
  titleKey: string;
  descKey?: string;
  icon: string;
  render: (bodyEl: HTMLElement) => void;
}

export class AiNoteAgentSettingTab extends PluginSettingTab {
  plugin: AiNoteAgentPlugin;
  private memorySaveTimer: number | null = null;

  constructor(app: App, plugin: AiNoteAgentPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const sections: SettingsSection[] = [
      {
        id: "provider",
        titleKey: "settings.section.provider",
        descKey: "settings.section.provider.desc",
        icon: "settings",
        render: (el) => this.renderProviderTab(el),
      },
      {
        id: "autoprompt",
        titleKey: "settings.section.autoprompt",
        descKey: "settings.section.autoprompt.desc",
        icon: "mouse-pointer-click",
        render: (el) => this.renderAutopromptTab(el),
      },
      {
        id: "memoryChat",
        titleKey: "settings.section.memoryChat",
        descKey: "settings.section.memoryChat.desc",
        icon: "messages-square",
        render: (el) => this.renderMemoryChatTab(el),
      },
      {
        id: "skills",
        titleKey: "settings.section.skills",
        descKey: "settings.section.skills.desc",
        icon: "puzzle",
        render: (el) => this.renderSkillsTab(el),
      },
      {
        id: "web",
        titleKey: "settings.section.web",
        descKey: "settings.section.web.desc",
        icon: "globe",
        render: (el) => this.renderWebTab(el),
      },
    ];

    const tabsEl = containerEl.createEl("div", { cls: "ana-settings-tabs" });
    const panelsEl = containerEl.createEl("div", {
      cls: "ana-settings-panels",
    });

    const tabButtons: HTMLElement[] = [];
    const panels: HTMLElement[] = [];
    let activeIndex = 0;

    const activate = (idx: number) => {
      activeIndex = idx;
      tabButtons.forEach((btn, i) => {
        btn.toggleClass("is-active", i === idx);
      });
      panels.forEach((panel, i) => {
        panel.style.display = i === idx ? "block" : "none";
      });
    };

    sections.forEach((sec, idx) => {
      const btn = tabsEl.createEl("button", {
        cls: "ana-settings-tab",
      });
      const iconEl = btn.createSpan({ cls: "ana-settings-tab-icon" });
      setIcon(iconEl, sec.icon);
      btn.createSpan({
        cls: "ana-settings-tab-text",
        text: t(sec.titleKey),
      });
      btn.addEventListener("click", () => activate(idx));
      tabButtons.push(btn);

      const panel = panelsEl.createEl("div", { cls: "ana-settings-panel" });
      const body = panel.createEl("div", { cls: "ana-settings-panel-body" });
      sec.render(body);
      panels.push(panel);
    });

    activate(0);
  }

  // ===== 标签页：模型配置 =====
  private renderProviderTab(bodyEl: HTMLElement): void {
    // --- 数据存储（置顶）---
    this.createGroupHeader(bodyEl, "settings.providerGroup.storage");

    new Setting(bodyEl)
      .setName(t("settings.aiFolderName.name"))
      .setDesc(t("settings.aiFolderName.desc"))
      .addText((t2) =>
        t2
          .setPlaceholder(".vaultmind")
          .setValue(this.plugin.settings.aiFolderName)
          .inputEl.addEventListener("blur", async () => {
            const name = t2.inputEl.value.trim();
            if (name && name !== this.plugin.settings.aiFolderName) {
              this.plugin.settings.aiFolderName = name;
              await this.plugin.saveSettings();
            }
          })
      );

    // --- 模型链接（多链接列表）---
    this.createGroupHeader(bodyEl, "settings.providerGroup.link");

    // 添加模型链接按钮
    new Setting(bodyEl)
      .setName(t("settings.modelLinks.add.name"))
      .setDesc(t("settings.modelLinks.add.desc"))
      .addButton((btn) => {
        btn.setButtonText(t("settings.modelLinks.add.button")).setCta();
        btn.onClick(() => {
          new ModelLinkModal(this.app, this.plugin, null, () =>
            this.display()
          ).open();
        });
      });

    // 搜索框
    let searchQuery = "";
    new Setting(bodyEl)
      .setName(t("settings.modelLinks.search.name"))
      .setDesc(t("settings.modelLinks.search.desc"))
      .addText((input) => {
        input.setPlaceholder(t("settings.modelLinks.search.placeholder"));
        input.onChange((v) => {
          searchQuery = v;
          this.renderModelLinkList(listContainer, searchQuery);
        });
      });

    // 列表容器
    const listContainer = bodyEl.createEl("div", {
      cls: "ana-model-link-list",
    });
    this.renderModelLinkList(listContainer, "");
  }

  /**
   * 渲染模型链接列表（表格样式，支持按名称搜索过滤）。
   * 表头：名称 | 类型 | Base URL | 模型 | 操作
   */
  private renderModelLinkList(container: HTMLElement, query: string): void {
    container.empty();
    const links = this.plugin.settings.modelLinks;
    const q = query.trim().toLowerCase();
    const filtered = q
      ? links.filter((l) => l.name.toLowerCase().includes(q))
      : links;

    if (filtered.length === 0) {
      container.createEl("div", {
        cls: "ana-model-link-empty",
        text: q
          ? t("settings.modelLinks.searchNoResults")
          : t("settings.modelLinks.empty"),
      });
      return;
    }

    const table = container.createEl("table", {
      cls: "ana-model-link-table",
    });
    const thead = table.createEl("thead");
    const htr = thead.createEl("tr");
    htr.createEl("th", { text: t("settings.modelLinks.table.name") });
    htr.createEl("th", { text: t("settings.modelLinks.table.type") });
    htr.createEl("th", { text: t("settings.modelLinks.table.url") });
    htr.createEl("th", { text: t("settings.modelLinks.table.models") });
    htr.createEl("th", {
      text: t("settings.modelLinks.table.actions"),
      cls: "ana-model-link-col-actions",
    });

    const tbody = table.createEl("tbody");
    for (const link of filtered) {
      const tr = tbody.createEl("tr");
      const isDefault = link.id === this.plugin.settings.defaultModelLinkId;

      // 名称列（含默认徽标）
      const tdName = tr.createEl("td", { cls: "ana-model-link-col-name" });
      tdName.createEl("span", { cls: "ana-model-link-name", text: link.name });
      if (isDefault) {
        tdName.createEl("span", {
          cls: "ana-model-link-default-badge",
          text: t("settings.modelLinks.defaultBadge"),
        });
      }

      // 类型列
      tr.createEl("td", {
        cls: "ana-model-link-col-type",
        text:
          link.type === "ollama"
            ? t("settings.provider.ollama")
            : t("settings.provider.openai"),
      });

      // URL 列
      tr.createEl("td", { cls: "ana-model-link-col-url", text: link.baseUrl });

      // 模型列（标签）：内部包一层 flex 容器，保持 td 为默认表格单元格
      const tdModels = tr.createEl("td", { cls: "ana-model-link-col-models" });
      const modelsWrap = tdModels.createEl("div", {
        cls: "ana-model-link-models-wrap",
      });
      if (link.models.length === 0) {
        modelsWrap.createEl("span", {
          cls: "ana-model-link-tag-empty",
          text: t("settings.modelLinks.noModel"),
        });
      } else {
        for (const m of link.models) {
          modelsWrap.createEl("span", { cls: "ana-model-link-tag", text: m });
        }
      }

      // 操作列
      const tdActions = tr.createEl("td", {
        cls: "ana-model-link-col-actions",
      });

      const defaultBtn = tdActions.createEl("button", {
        cls: "ana-model-link-btn",
        text: isDefault
          ? t("settings.modelLinks.defaultActive")
          : t("settings.modelLinks.setDefault"),
      });
      defaultBtn.toggleClass("is-active", isDefault);
      defaultBtn.addEventListener("click", async () => {
        this.plugin.settings.defaultModelLinkId = link.id;
        await this.plugin.saveSettings();
        this.renderModelLinkList(container, query);
      });

      const editBtn = tdActions.createEl("button", {
        cls: "ana-model-link-btn",
        text: t("settings.modelLinks.edit"),
      });
      editBtn.addEventListener("click", () => {
        new ModelLinkModal(this.app, this.plugin, link, () =>
          this.display()
        ).open();
      });

      const delBtn = tdActions.createEl("button", {
        cls: "ana-model-link-btn danger",
        text: t("settings.modelLinks.delete"),
      });
      delBtn.addEventListener("click", async () => {
        this.plugin.settings.modelLinks =
          this.plugin.settings.modelLinks.filter((l) => l.id !== link.id);
        if (this.plugin.settings.defaultModelLinkId === link.id) {
          this.plugin.settings.defaultModelLinkId =
            this.plugin.settings.modelLinks[0]?.id ?? "";
        }
        await this.plugin.saveSettings();
        this.display();
      });
    }
  }

  // ===== 标签页：会话与记忆 =====
  private renderMemoryChatTab(bodyEl: HTMLElement): void {
    // --- 系统指令 ---
    this.createGroupHeader(bodyEl, "settings.memoryGroup.system");

    new Setting(bodyEl)
      .setName(t("settings.customInstructions.name"))
      .setDesc(t("settings.customInstructions.desc"))
      .addTextArea((ta) => {
        ta
          .setPlaceholder(t("settings.customInstructions.placeholder"))
          .setValue(this.plugin.settings.customInstructions)
          .onChange(async (v) => {
            this.plugin.settings.customInstructions = v;
            await this.plugin.saveSettings();
          });
        ta.inputEl.rows = 3;
      });

    // --- 知识库 ---
    this.createGroupHeader(bodyEl, "settings.memoryGroup.knowledge");

    const includeVaultIndexSetting = new Setting(bodyEl)
      .setName(t("settings.includeVaultIndex.name"))
      .setDesc(t("settings.includeVaultIndex.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.includeVaultIndex)
          .onChange(async (v) => {
            this.plugin.settings.includeVaultIndex = v;
            await this.plugin.saveSettings();
            maxCharsSetting.setDisabled(!v);
          })
      );

    const maxCharsSetting = new Setting(bodyEl)
      .setName(t("settings.chatContextMaxChars.name"))
      .setDesc(t("settings.chatContextMaxChars.desc"))
      .setDisabled(!this.plugin.settings.includeVaultIndex)
      .addText((t2) =>
        t2
          .setPlaceholder("8000")
          .setValue(String(this.plugin.settings.chatContextMaxChars))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.chatContextMaxChars = n;
              await this.plugin.saveSettings();
            }
          })
      );

    // --- 用户画像 ---
    this.createGroupHeader(bodyEl, "settings.memoryGroup.profile");

    let categoriesSetting: Setting | undefined;
    let memoryFileSetting: Setting | undefined;

    new Setting(bodyEl)
      .setName(t("settings.memoryProfileEnabled.name"))
      .setDesc(t("settings.memoryProfileEnabled.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.memoryProfileEnabled)
          .onChange(async (v) => {
            this.plugin.settings.memoryProfileEnabled = v;
            categoriesSetting?.setDisabled(!v);
            memoryFileSetting?.setDisabled(!v);
            await this.plugin.saveSettings();
            if (v) {
              // 开启时立即在后台触发一次整理，避免用户等到下次重启
              void rebuildProfileMemory(this.plugin);
            }
          })
      );

    categoriesSetting = new Setting(bodyEl)
      .setName(t("settings.memoryProfileCategories.name"))
      .setDesc(t("settings.memoryProfileCategories.desc"))
      .addTextArea((ta) => {
        ta
          .setPlaceholder(t("settings.memoryProfileCategories.placeholder"))
          .setValue(this.plugin.settings.memoryProfileCategories)
          .onChange(async (v) => {
            this.plugin.settings.memoryProfileCategories = v;
            await this.plugin.saveSettings();
          });
        ta.inputEl.rows = 5;
      })
      .setDisabled(!this.plugin.settings.memoryProfileEnabled);

    memoryFileSetting = new Setting(bodyEl)
      .setName(t("settings.memoryFile.name"))
      .setDesc(t("settings.memoryFile.desc"))
      .addTextArea((ta) => {
        ta.setPlaceholder(t("settings.memoryFile.placeholder"))
          .setValue("")
          .onChange((v) => {
            if (this.memorySaveTimer !== null) {
              window.clearTimeout(this.memorySaveTimer);
            }
            this.memorySaveTimer = window.setTimeout(() => {
              void saveMemoryFile(this.plugin, "MEMORY.md", v);
            }, 500);
          });
        ta.inputEl.rows = 8;
        void loadMemoryFile(this.plugin, "MEMORY.md").then((content) => {
          ta.setValue(content);
        });
      })
      .setDisabled(!this.plugin.settings.memoryProfileEnabled);
  }

  // ===== 标签页：交互设置 =====
  private renderAutopromptTab(bodyEl: HTMLElement): void {
    // --- AI 对话面板 ---
    this.createGroupHeader(bodyEl, "settings.autopromptGroup.chat");

    let addCurrentNoteSetting: Setting | undefined;
    new Setting(bodyEl)
      .setName(t("settings.chatPanel.name"))
      .setDesc(t("settings.chatPanel.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.chatPanelEnabled)
          .onChange(async (v) => {
            this.plugin.settings.chatPanelEnabled = v;
            addCurrentNoteSetting?.setDisabled(!v);
            await this.plugin.saveSettings();
          })
      );

    addCurrentNoteSetting = new Setting(bodyEl)
      .setName(t("settings.addCurrentNoteToChat.name"))
      .setDesc(t("settings.addCurrentNoteToChat.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.addCurrentNoteToChat)
          .onChange(async (v) => {
            this.plugin.settings.addCurrentNoteToChat = v;
            await this.plugin.saveSettings();
          })
      )
      .setDisabled(!this.plugin.settings.chatPanelEnabled);

    // --- 自动提示 ---
    this.createGroupHeader(bodyEl, "settings.autopromptGroup.autoprompt");

    let debounceSetting: Setting | undefined;
    new Setting(bodyEl)
      .setName(t("settings.realtime.name"))
      .setDesc(t("settings.realtime.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.realtimeEnabled)
          .onChange(async (v) => {
            this.plugin.settings.realtimeEnabled = v;
            debounceSetting?.setDisabled(!v);
            await this.plugin.saveSettings();
          })
      );

    debounceSetting = new Setting(bodyEl)
      .setName(t("settings.debounce.name"))
      .setDesc(t("settings.debounce.desc"))
      .addText((t2) =>
        t2
          .setPlaceholder("800")
          .setValue(String(this.plugin.settings.realtimeDebounceMs))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.realtimeDebounceMs = n;
              await this.plugin.saveSettings();
            }
          })
      )
      .setDisabled(!this.plugin.settings.realtimeEnabled);

    // --- 笔记优化 ---
    this.createGroupHeader(bodyEl, "settings.autopromptGroup.optimize");

    let linkTypeSetting: Setting | undefined;
    let linkFormatSetting: Setting | undefined;
    new Setting(bodyEl)
      .setName(t("settings.optimizeCurrent.name"))
      .setDesc(t("settings.optimizeCurrent.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.optimizeCurrentEnabled)
          .onChange(async (v) => {
            this.plugin.settings.optimizeCurrentEnabled = v;
            linkTypeSetting?.setDisabled(!v);
            linkFormatSetting?.setDisabled(!v);
            await this.plugin.saveSettings();
          })
      );

    linkTypeSetting = new Setting(bodyEl)
      .setName(t("settings.linkType.name"))
      .setDesc(t("settings.linkType.desc"))
      .addDropdown((dd: DropdownComponent) =>
        dd
          .addOption("shortest", t("settings.linkType.shortest"))
          .addOption("relative", t("settings.linkType.relative"))
          .addOption("absolute", t("settings.linkType.absolute"))
          .setValue(this.plugin.settings.linkType)
          .onChange(async (v) => {
            this.plugin.settings.linkType = v as
              | "shortest"
              | "relative"
              | "absolute";
            await this.plugin.saveSettings();
          })
      )
      .setDisabled(!this.plugin.settings.optimizeCurrentEnabled);

    linkFormatSetting = new Setting(bodyEl)
      .setName(t("settings.linkFormat.name"))
      .setDesc(t("settings.linkFormat.desc"))
      .addDropdown((dd: DropdownComponent) =>
        dd
          .addOption("wikilink", t("settings.linkFormat.wikilink"))
          .addOption("markdown", t("settings.linkFormat.markdown"))
          .setValue(this.plugin.settings.linkFormat)
          .onChange(async (v) => {
            this.plugin.settings.linkFormat = v as "wikilink" | "markdown";
            await this.plugin.saveSettings();
          })
      )
      .setDisabled(!this.plugin.settings.optimizeCurrentEnabled);

    // --- 生成 Frontmatter ---
    this.createGroupHeader(bodyEl, "settings.autopromptGroup.frontmatter");

    let frontmatterTemplateSetting: Setting | undefined;
    new Setting(bodyEl)
      .setName(t("settings.frontmatterGeneration.name"))
      .setDesc(t("settings.frontmatterGeneration.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.frontmatterGenerationEnabled)
          .onChange(async (v) => {
            this.plugin.settings.frontmatterGenerationEnabled = v;
            frontmatterTemplateSetting?.setDisabled(!v);
            await this.plugin.saveSettings();
          })
      );

    frontmatterTemplateSetting = new Setting(bodyEl)
      .setName(t("settings.frontmatterTemplate.name"))
      .setDesc(t("settings.frontmatterTemplate.desc"))
      .addTextArea((ta) => {
        ta
          .setPlaceholder(t("settings.frontmatterTemplate.placeholder"))
          .setValue(this.plugin.settings.frontmatterTemplate)
          .onChange(async (v) => {
            this.plugin.settings.frontmatterTemplate = v;
            await this.plugin.saveSettings();
          });
        ta.inputEl.rows = 5;
      })
      .setDisabled(!this.plugin.settings.frontmatterGenerationEnabled);

    // --- 拉取网页内容（测试） ---
    this.createGroupHeader(bodyEl, "settings.autopromptGroup.webContent");

    new Setting(bodyEl)
      .setName(t("settings.fetchWebContent.name"))
      .setDesc(t("settings.fetchWebContent.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.fetchWebContentEnabled)
          .onChange(async (v) => {
            this.plugin.settings.fetchWebContentEnabled = v;
            await this.plugin.saveSettings();
          })
      );

    let webLinkTypeSetting: Setting | undefined;
    let webLinkFormatSetting: Setting | undefined;

    new Setting(bodyEl)
      .setName(t("settings.fetchWebContent.saveImages.name"))
      .setDesc(t("settings.fetchWebContent.saveImages.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.fetchWebContentSaveImages)
          .onChange(async (v) => {
            this.plugin.settings.fetchWebContentSaveImages = v;
            webLinkTypeSetting?.setDisabled(!v);
            webLinkFormatSetting?.setDisabled(!v);
            await this.plugin.saveSettings();
          })
      );

    webLinkTypeSetting = new Setting(bodyEl)
      .setName(t("settings.fetchWebContent.linkType.name"))
      .setDesc(t("settings.fetchWebContent.linkType.desc"))
      .addDropdown((dd: DropdownComponent) =>
        dd
          .addOption("shortest", t("settings.linkType.shortest"))
          .addOption("relative", t("settings.linkType.relative"))
          .addOption("absolute", t("settings.linkType.absolute"))
          .setValue(this.plugin.settings.fetchWebContentImageLinkType)
          .onChange(async (v) => {
            this.plugin.settings.fetchWebContentImageLinkType = v as
              | "shortest"
              | "relative"
              | "absolute";
            await this.plugin.saveSettings();
          })
      )
      .setDisabled(!this.plugin.settings.fetchWebContentSaveImages);

    webLinkFormatSetting = new Setting(bodyEl)
      .setName(t("settings.fetchWebContent.linkFormat.name"))
      .setDesc(t("settings.fetchWebContent.linkFormat.desc"))
      .addDropdown((dd: DropdownComponent) =>
        dd
          .addOption("wikilink", t("settings.linkFormat.wikilink"))
          .addOption("markdown", t("settings.linkFormat.markdown"))
          .setValue(this.plugin.settings.fetchWebContentImageLinkFormat)
          .onChange(async (v) => {
            this.plugin.settings.fetchWebContentImageLinkFormat = v as
              | "wikilink"
              | "markdown";
            await this.plugin.saveSettings();
          })
      )
      .setDisabled(!this.plugin.settings.fetchWebContentSaveImages);
  }

  // ===== 标签页：联网搜索 =====
  private renderWebTab(bodyEl: HTMLElement): void {
    let providerSetting: Setting | undefined;
    let keysSetting: Setting | undefined;
    let maxResultsSetting: Setting | undefined;
    let maxCharsSetting: Setting | undefined;
    let citationsSetting: Setting | undefined;
    const webEnabled = this.plugin.settings.webSearchEnabled;

    new Setting(bodyEl)
      .setName(t("settings.webSearchEnabled.name"))
      .setDesc(t("settings.webSearchEnabled.desc"))
      .addToggle((t2) =>
        t2
          .setValue(webEnabled)
          .onChange(async (v) => {
            this.plugin.settings.webSearchEnabled = v;
            providerSetting?.setDisabled(!v);
            keysSetting?.setDisabled(!v);
            maxResultsSetting?.setDisabled(!v);
            maxCharsSetting?.setDisabled(!v);
            citationsSetting?.setDisabled(!v);
            await this.plugin.saveSettings();
          })
      );

    providerSetting = new Setting(bodyEl)
      .setName(t("settings.webSearchProvider.name"))
      .setDesc(t("settings.webSearchProvider.desc"))
      .addDropdown((dd) =>
        dd
          .addOption("tavily", "Tavily")
          .addOption("serper", "Serper (Google)")
          .addOption("brave", "Brave Search")
          .addOption("searxng", "SearXNG")
          .setValue(this.plugin.settings.webSearchProvider)
          .onChange(async (v) => {
            this.plugin.settings.webSearchProvider = v as
              | "tavily"
              | "serper"
              | "brave"
              | "searxng";
            await this.plugin.saveSettings();
            this.display();
          })
      )
      .setDisabled(!webEnabled);

    // 根据当前选中的 provider 显示对应的多凭据输入框
    const prov = this.plugin.settings.webSearchProvider;
    keysSetting = new Setting(bodyEl)
      .setName(t(`settings.webKeys.${prov}.name`))
      .setDesc(t(`settings.webKeys.${prov}.desc`));
    keysSetting.addTextArea((ta) =>
      ta
        .setPlaceholder(t(`settings.webKeys.${prov}.placeholder`))
        .setValue(
          (prov === "tavily"
            ? this.plugin.settings.tavilyApiKeys
            : prov === "serper"
            ? this.plugin.settings.serperApiKeys
            : prov === "brave"
            ? this.plugin.settings.braveApiKeys
            : this.plugin.settings.searxngInstances
          ).join("\n")
        )
        .onChange(async (v) => {
          const arr = v
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          if (prov === "tavily") this.plugin.settings.tavilyApiKeys = arr;
          else if (prov === "serper") this.plugin.settings.serperApiKeys = arr;
          else if (prov === "brave") this.plugin.settings.braveApiKeys = arr;
          else this.plugin.settings.searxngInstances = arr;
          await this.plugin.saveSettings();
        })
    );
    (keysSetting.components[0] as any)?.inputEl?.addClass("ana-settings-keys");
    keysSetting.setDisabled(!webEnabled);

    maxResultsSetting = new Setting(bodyEl)
      .setName(t("settings.webSearchMaxResults.name"))
      .setDesc(t("settings.webSearchMaxResults.desc"))
      .addText((t2) =>
        t2
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.webSearchMaxResults))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.webSearchMaxResults = n;
              await this.plugin.saveSettings();
            }
          })
      )
      .setDisabled(!webEnabled);

    maxCharsSetting = new Setting(bodyEl)
      .setName(t("settings.webSearchMaxChars.name"))
      .setDesc(t("settings.webSearchMaxChars.desc"))
      .addText((t2) =>
        t2
          .setPlaceholder("1500")
          .setValue(String(this.plugin.settings.webSearchMaxCharsPerResult))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.webSearchMaxCharsPerResult = n;
              await this.plugin.saveSettings();
            }
          })
      )
      .setDisabled(!webEnabled);

    citationsSetting = new Setting(bodyEl)
      .setName(t("settings.webSearchShowCitations.name"))
      .setDesc(t("settings.webSearchShowCitations.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.webSearchShowCitations)
          .onChange(async (v) => {
            this.plugin.settings.webSearchShowCitations = v;
            await this.plugin.saveSettings();
          })
      )
      .setDisabled(!webEnabled);
  }

  // ===== 标签页：Skill 技能 =====
  private renderSkillsTab(bodyEl: HTMLElement): void {
    const plugin = this.plugin;
    let query = "";

    // 顶层：启用技能 总开关
    new Setting(bodyEl)
      .setName(t("settings.skillsEnabled.name"))
      .setDesc(t("settings.skillsEnabled.desc"))
      .addToggle((t2) =>
        t2
          .setValue(plugin.settings.skillsEnabled)
          .onChange(async (v) => {
            plugin.settings.skillsEnabled = v;
            await plugin.saveSettings();
            void renderSkillsList();
          })
      );

    // 顶层：刷新
    new Setting(bodyEl)
      .setName(t("settings.defaultSkills.refresh.name"))
      .setDesc(
        t("settings.defaultSkills.pathHint", { path: getSkillsDir(plugin) })
      )
      .addButton((btn) => {
        btn.setIcon("refresh-cw");
        btn.setTooltip(t("settings.defaultSkills.refresh.tooltip"));
        btn.onClick(() => {
          void renderSkillsList();
        });
      });

    // 顶层：搜索
    new Setting(bodyEl)
      .setName(t("settings.defaultSkills.search.name"))
      .setDesc(t("settings.defaultSkills.search.desc"))
      .addText((input) => {
        input.setPlaceholder(t("settings.defaultSkills.search.placeholder"));
        input.onChange((v) => {
          query = v.trim().toLowerCase();
          void renderSkillsList();
        });
      });

    // 列表容器
    const listContainer = bodyEl.createEl("div", { cls: "ana-skills-list" });

    const renderSkillsList = async (): Promise<void> => {
      // 全局关闭「启用技能」时，列表整体变只读（半透明 + 禁止交互）
      listContainer.toggleClass("is-disabled", !plugin.settings.skillsEnabled);
      listContainer.empty();
      listContainer.createEl("div", {
        text: t("settings.defaultSkills.loading"),
        cls: "ana-settings-skills-loading",
      });
      let skills: SkillEntry[] = [];
      try {
        skills = await listSkills(plugin, this.app);
      } catch {
        skills = [];
      }
      listContainer.empty();

      if (skills.length === 0) {
        listContainer.createEl("div", {
          text: t("settings.defaultSkills.empty"),
          cls: "ana-settings-skills-empty",
        });
        return;
      }

      const q = query;
      const filtered = q
        ? skills.filter(
            (s) =>
              s.name.toLowerCase().includes(q) ||
              s.path.toLowerCase().includes(q)
          )
        : skills;

      if (filtered.length === 0) {
        listContainer.createEl("div", {
          text: t("settings.defaultSkills.search.noResults"),
          cls: "ana-settings-skills-empty",
        });
        return;
      }

      const table = listContainer.createEl("table", {
        cls: "ana-skills-table",
      });
      const thead = table.createEl("thead");
      const htr = thead.createEl("tr");
      htr.createEl("th", { text: t("settings.defaultSkills.table.name") });
      htr.createEl("th", { text: t("settings.defaultSkills.table.path") });
      htr.createEl("th", {
        text: t("settings.defaultSkills.table.enabled"),
        cls: "ana-skills-col-toggle",
      });

      const tbody = table.createEl("tbody");
      for (const sk of filtered) {
        const tr = tbody.createEl("tr");
        tr.createEl("td", { cls: "ana-skills-col-name", text: sk.name });
        tr.createEl("td", { cls: "ana-skills-col-path", text: sk.path });
        const tdToggle = tr.createEl("td", { cls: "ana-skills-col-toggle" });
        const toggle = new ToggleComponent(tdToggle);
        toggle.setValue(plugin.settings.defaultSkills.includes(sk.path));
        toggle.setDisabled(!plugin.settings.skillsEnabled);
        toggle.onChange(async (v) => {
          const arr = plugin.settings.defaultSkills.slice();
          const has = arr.includes(sk.path);
          if (v && !has) arr.push(sk.path);
          else if (!v && has)
            plugin.settings.defaultSkills = arr.filter((p) => p !== sk.path);
          else plugin.settings.defaultSkills = arr;
          await plugin.saveSettings();
        });
      }
    };

    void renderSkillsList();
  }

  /** 在面板内创建一个小型分组标题。 */
  private createGroupHeader(containerEl: HTMLElement, titleKey: string): void {
    containerEl.createEl("div", {
      cls: "ana-settings-group-title",
      text: t(titleKey),
    });
  }
}

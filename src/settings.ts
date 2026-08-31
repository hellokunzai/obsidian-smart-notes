import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  DropdownComponent,
  ToggleComponent,
  setIcon,
} from "obsidian";
import { sanitizeSecretId } from "./utils/secret";
import type AiNoteAgentPlugin from "./main";
import { t } from "./i18n";
import { ModelLinkModal, SecretPickerModal } from "./modelLinkModal";
import { RoleInfoModal } from "./roleInfoModal";
import { loadMemoryFile, saveMemoryFile, rebuildProfileMemory } from "./memory/profileMemory";
import { WebSearchService } from "./search/search";
import { listSkills, type SkillEntry } from "./skills/skills";
import { uploadSkillFromZip } from "./skills/uploadSkill";
import { renderAvatar } from "./avatar";
import { getSkillsDir } from "./utils/aiFolder";

export type ProviderType = "openai" | "ollama";

/** 一条模型链接：对应一个 AI 后端（如 DeepSeek、Ollama、OpenRouter），可挂多个模型。 */
export interface ModelLink {
  id: string;
  /** 链接名称，用户可见且不可重复。 */
  name: string;
  type: ProviderType;
  baseUrl: string;
  /**
   * Obsidian 钥匙串中对应密钥的引用 ID。
   * 实际 API Key 不再保存到 data.json，而是通过此 ID 从 keychain 读取。
   */
  apiKeyRef?: string;
  /** 该链接下可使用的模型 ID 列表（支持多个）。 */
  models: string[];
  /** 该链接的最大 Token 数（不填则使用全局默认值）。 */
  maxTokens?: number;
  /** 该链接的温度参数（不填则使用全局默认值）。 */
  temperature?: number;
}

/** 从 Obsidian keychain 读取模型链接对应的实际 API Key。 */
export { resolveModelLinkApiKey } from "./utils/secret";

/**
 * 将模型链接的明文 API Key 迁移到 Obsidian keychain（一次性兼容处理）。
 * 直接修改传入的 link 对象。
 */
export { migrateModelLinkApiKeyToKeychain } from "./utils/secret";

/** 生成短随机 id，用于模型链接 / 角色信息唯一标识。 */
export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 一条角色信息：名称 + 提示词，可设为默认并注入所有 AI 功能的 system prompt。 */
export interface RoleInfo {
  id: string;
  /** 角色名称，用户可见且不可重复。 */
  name: string;
  /** 角色提示词（立场 / 语气 / 职责描述），注入 system prompt。 */
  prompt: string;
  /**
   * 角色头像（可选）：
   *  - 缺省 / 空 → 自动显示名字首字母色块
   *  - 内置 emoji 预设 → 直接存储 emoji 字符
   *  - vault 内图片 → 存储相对路径（渲染走 getResourcePath）
   *  - 用户上传图片 → 存储 `data:image/...;base64,...`
   */
  avatar?: string;
}

/**
 * 取角色提示词；未传入 roleId 时取全局默认角色，传入时取指定角色。
 * 未配置对应角色时返回空串。用于把角色设定注入 system prompt。
 * @param settings 设置对象
 * @param roleId 可选，指定角色 id；不传则使用全局默认角色（settings.defaultRoleId）
 */
export function getActiveRolePrompt(
  settings: AiNoteAgentSettings,
  roleId?: string
): string {
  // 关闭「启用角色功能」后，连默认角色也不再注入 system prompt
  if (!settings.rolesEnabled) return "";
  const id = roleId ?? settings.defaultRoleId;
  if (!id) return "";
  const role = settings.roles.find((r) => r.id === id);
  return role ? role.prompt : "";
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
  // 是否在 AI 回复上方展示推理模型的「思考过程」（仅模型返回 reasoning_content 时生效）
  showReasoning: boolean;
  // 是否启用「生成 Frontmatter」命令
  frontmatterGenerationEnabled: boolean;
  // Frontmatter 生成模板（留空则使用默认 system prompt）
  frontmatterTemplate: string;
  // vault 根目录中用于存放记忆与 skill 的文件夹名称
  aiFolderName: string;
  // 长期画像记忆：总开关（关闭后不整理、不注入）
  memoryProfileEnabled: boolean;
  // 长期画像记忆：AI 自动提取的维度（每行一个）
  memoryProfileCategories: string;
  // 长期画像记忆：注入 system prompt 前截断到的字符数（防止无限膨胀撑爆 token）
  profileMemoryMaxChars: number;
  // 对话：是否启用文件选择功能（对话框「添加文件/文件夹」按钮）
  fileSelectionEnabled: boolean;
  // 对话：是否把知识库路径索引（仅路径）注入 system prompt，让 AI 知道库里有哪些文件
  includeVaultIndex: boolean;
  // 对话：知识库路径索引最多注入的文件数（防止大库撑爆 token）；0 = 不限制
  vaultIndexMaxFiles: number;
  // 对话：单文件注入到上下文的内容字符上限（防止超大文件撑爆 token）
  chatContextMaxChars: number;
  // 对话：历史消息窗口（仅发送最近 N 条历史；更早的压缩为摘要注入）。0 = 不限制（发送全部历史）
  historyMaxMessages: number;
  // 对话：流式响应活动超时（秒）。只要收到任意 SSE chunk（content / reasoning）就重置计时器；
  // 连续 N 秒无数据才判定为超时。默认 60 秒，最小 10 秒。
  chatActivityTimeout: number;
  // 对话：是否启用 Frontmatter 索引（仅元数据，不含正文），让 AI 通过属性了解库内结构
  includeFrontmatterIndex: boolean;
  // 对话：Frontmatter 索引最多注入的文件数（防止大库撑爆 token）；0 = 不限制
  frontmatterIndexMaxFiles: number;
  // 对话：Frontmatter 索引要包含的属性白名单（每行/逗号分隔一个；留空表示全部）
  frontmatterIndexKeys: string;
  // 对话：Frontmatter 索引中单属性值字符上限（防止长字段撑爆 token）
  frontmatterIndexMaxChars: number;
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
  // ===== 角色信息 =====
  // 取代旧的单一 customInstructions（系统指令）；支持多条角色，任选其一作为默认
  roles: RoleInfo[];
  // 当前默认角色 id（其提示词注入所有 AI 功能）；为空表示不注入任何角色
  defaultRoleId: string;
  // 角色信息：是否在 AI 对话框显示「角色」按钮（总开关）
  rolesEnabled: boolean;
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
  realtimeDebounceMs: 1500,
  optimizeCurrentEnabled: true,
  linkFormat: "wikilink",
  linkType: "shortest",
  chatPanelEnabled: true,
  addCurrentNoteToChat: false,
  showReasoning: true,
  frontmatterGenerationEnabled: true,
  frontmatterTemplate: "",
  aiFolderName: ".smartnotes",
  memoryProfileEnabled: true,
  memoryProfileCategories: "",
  profileMemoryMaxChars: 4000,
  fileSelectionEnabled: true,
  includeVaultIndex: false,
  vaultIndexMaxFiles: 200,
  chatContextMaxChars: 8000,
  historyMaxMessages: 20,
  chatActivityTimeout: 60,
  includeFrontmatterIndex: false,
  frontmatterIndexMaxFiles: 200,
  frontmatterIndexKeys: "",
  frontmatterIndexMaxChars: 500,
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
  roles: [],
  defaultRoleId: "",
  rolesEnabled: true,
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
  /** 当前设置页选中的 tab 索引，display() 重绘后恢复，避免弹窗操作后跳回第一页。 */
  private activeTabIndex = 0;

  constructor(app: App, plugin: AiNoteAgentPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const previousActiveIndex = this.activeTabIndex;

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
        id: "knowledge",
        titleKey: "settings.section.knowledge",
        descKey: "settings.section.knowledge.desc",
        icon: "file-text",
        render: (el) => this.renderKnowledgeTab(el),
      },
      {
        id: "profile",
        titleKey: "settings.section.profile",
        descKey: "settings.section.profile.desc",
        icon: "user-round",
        render: (el) => this.renderProfileTab(el),
      },
      {
        id: "roles",
        titleKey: "settings.section.roles",
        descKey: "settings.section.roles.desc",
        icon: "user",
        render: (el) => this.renderRolesTab(el),
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
      this.activeTabIndex = idx;
      tabButtons.forEach((btn, i) => {
        btn.toggleClass("is-active", i === idx);
      });
      panels.forEach((panel, i) => {
        panel.classList.toggle("is-active", i === idx);
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

    activate(previousActiveIndex);
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
          .setPlaceholder(".smartnotes")
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
   * 表头：名称 | 类型 | 模型 | 操作
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
    htr.createEl("th", { cls: "ana-model-link-col-name", text: t("settings.modelLinks.table.name") });
    htr.createEl("th", { cls: "ana-model-link-col-type", text: t("settings.modelLinks.table.type") });
    htr.createEl("th", { cls: "ana-model-link-col-models", text: t("settings.modelLinks.table.models") });
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

      // 模型列（标签）
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

      // 操作列（图标按钮）
      const tdActions = tr.createEl("td", {
        cls: "ana-model-link-col-actions",
      });

      // 设为默认按钮
      const defaultBtn = tdActions.createEl("button", {
        cls: "ana-model-link-action-btn" + (isDefault ? " is-active" : ""),
      });
      defaultBtn.setAttribute("aria-label", isDefault
          ? t("settings.modelLinks.defaultActive")
          : t("settings.modelLinks.setDefault"));
      setIcon(defaultBtn, "star");
      defaultBtn.addEventListener("click", async () => {
        this.plugin.settings.defaultModelLinkId = link.id;
        await this.plugin.saveSettings();
        this.renderModelLinkList(container, query);
      });

      // 编辑按钮
      const editBtn = tdActions.createEl("button", {
        cls: "ana-model-link-action-btn",
      });
      editBtn.setAttribute("aria-label", t("settings.modelLinks.edit"));
      setIcon(editBtn, "pencil");
      editBtn.addEventListener("click", () => {
        new ModelLinkModal(this.app, this.plugin, link, () =>
          this.display()
        ).open();
      });

      // 删除按钮
      const delBtn = tdActions.createEl("button", {
        cls: "ana-model-link-action-btn danger",
      });
      delBtn.setAttribute("aria-label", t("settings.modelLinks.delete"));
      setIcon(delBtn, "trash");
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

  /**
   * 渲染角色信息列表（表格样式，支持按名称搜索过滤）。
   * 表头：名称 | 提示词摘要 | 操作（设为默认 / 编辑 / 删除）
   */
  private renderRoleList(container: HTMLElement, query: string): void {
    container.empty();
    const roles = this.plugin.settings.roles;
    const q = query.trim().toLowerCase();
    const filtered = q
      ? roles.filter((r) => r.name.toLowerCase().includes(q))
      : roles;

    if (filtered.length === 0) {
      container.createEl("div", {
        cls: "ana-model-link-empty",
        text: q
          ? t("settings.roles.searchNoResults")
          : t("settings.roles.empty"),
      });
      return;
    }

    const table = container.createEl("table", {
      cls: "ana-model-link-table",
    });
    const thead = table.createEl("thead");
    const htr = thead.createEl("tr");
    htr.createEl("th", { text: t("settings.roles.table.name") });
    htr.createEl("th", {
      text: t("settings.roles.table.actions"),
      cls: "ana-model-link-col-actions",
    });

    const tbody = table.createEl("tbody");
    for (const role of filtered) {
      const tr = tbody.createEl("tr");
      const isDefault = role.id === this.plugin.settings.defaultRoleId;

      // 名称列（头像 + 名称 + 默认徽标合并在一格）
      // 注意：renderAvatar 会把容器本身变成圆形头像（border-radius:50% + overflow:hidden），
      // 因此在 <td> 内再套一层 div 作为头像容器，保持 <td> 为正常表格单元格；
      // 头像/名称/徽标放在一个 inline-flex 行容器内，整体垂直居中。
      const tdName = tr.createEl("td", { cls: "ana-model-link-col-name" });
      const nameRow = tdName.createDiv({ cls: "ana-role-list-name-row" });
      const avatarWrap = nameRow.createDiv({ cls: "ana-role-list-avatar" });
      renderAvatar(this.app, avatarWrap, role, 24);
      nameRow.createEl("span", { cls: "ana-model-link-name", text: role.name });
      if (isDefault) {
        nameRow.createEl("span", {
          cls: "ana-model-link-default-badge",
          text: t("settings.roles.defaultBadge"),
        });
      }

      // 操作列（图标按钮）
      const tdActions = tr.createEl("td", {
        cls: "ana-model-link-col-actions",
      });

      // 设为默认按钮
      const defaultBtn = tdActions.createEl("button", {
        cls: "ana-model-link-action-btn" + (isDefault ? " is-active" : ""),
      });
      defaultBtn.setAttribute("aria-label", isDefault
          ? t("settings.roles.defaultActive")
          : t("settings.roles.setDefault"));
      setIcon(defaultBtn, "star");
      defaultBtn.addEventListener("click", async () => {
        this.plugin.settings.defaultRoleId = role.id;
        await this.plugin.saveSettings();
        this.renderRoleList(container, query);
      });

      // 编辑按钮
      const editBtn = tdActions.createEl("button", {
        cls: "ana-model-link-action-btn",
      });
      editBtn.setAttribute("aria-label", t("settings.roles.edit"));
      setIcon(editBtn, "pencil");
      editBtn.addEventListener("click", () => {
        new RoleInfoModal(this.app, this.plugin, role, () =>
          this.display()
        ).open();
      });

      // 删除按钮
      const delBtn = tdActions.createEl("button", {
        cls: "ana-model-link-action-btn danger",
      });
      delBtn.setAttribute("aria-label", t("settings.roles.delete"));
      setIcon(delBtn, "trash");
      delBtn.addEventListener("click", async () => {
        this.plugin.settings.roles = this.plugin.settings.roles.filter(
          (r) => r.id !== role.id
        );
        if (this.plugin.settings.defaultRoleId === role.id) {
          this.plugin.settings.defaultRoleId =
            this.plugin.settings.roles[0]?.id ?? "";
        }
        await this.plugin.saveSettings();
        this.display();
      });
    }
  }

  // ===== 标签页：知识库 =====
  private renderKnowledgeTab(bodyEl: HTMLElement): void {
    // --- 文件 ---
    this.createGroupHeader(bodyEl, "settings.knowledgeGroup.files");

    // 启用文件选择功能
    new Setting(bodyEl)
      .setName(t("settings.fileSelectionEnabled.name"))
      .setDesc(t("settings.fileSelectionEnabled.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.fileSelectionEnabled)
          .onChange(async (v) => {
            this.plugin.settings.fileSelectionEnabled = v;
            await this.plugin.saveSettings();
          })
      );

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
            vaultIndexMaxFilesSetting?.setDisabled(!v);
          })
      );

    const vaultIndexMaxFilesSetting = new Setting(bodyEl)
      .setName(t("settings.vaultIndexMaxFiles.name"))
      .setDesc(t("settings.vaultIndexMaxFiles.desc"))
      .setDisabled(!this.plugin.settings.includeVaultIndex)
      .addText((t2) => {
        t2.inputEl.type = "number";
        t2.inputEl.min = "0";
        t2.inputEl.step = "1";
        t2.inputEl.inputMode = "numeric";
        t2.setPlaceholder("200")
          .setValue(String(this.plugin.settings.vaultIndexMaxFiles))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n >= 0) {
              this.plugin.settings.vaultIndexMaxFiles = n;
              await this.plugin.saveSettings();
            }
          });
      });

    const maxCharsSetting = new Setting(bodyEl)
      .setName(t("settings.chatContextMaxChars.name"))
      .setDesc(t("settings.chatContextMaxChars.desc"))
      .setDisabled(!this.plugin.settings.includeVaultIndex)
      .addText((t2) => {
        t2.inputEl.type = "number";
        t2.inputEl.min = "1";
        t2.inputEl.step = "1";
        t2.inputEl.inputMode = "numeric";
        t2.setPlaceholder("8000")
          .setValue(String(this.plugin.settings.chatContextMaxChars))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.chatContextMaxChars = n;
              await this.plugin.saveSettings();
            }
          });
      });

    // --- 属性 ---
    this.createGroupHeader(bodyEl, "settings.knowledgeGroup.props");
    let fmKeysSetting: Setting | undefined;
    let fmMaxCharsSetting: Setting | undefined;
    let fmMaxFilesSetting: Setting | undefined;

    new Setting(bodyEl)
      .setName(t("settings.includeFrontmatterIndex.name"))
      .setDesc(t("settings.includeFrontmatterIndex.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.includeFrontmatterIndex)
          .onChange(async (v) => {
            this.plugin.settings.includeFrontmatterIndex = v;
            fmKeysSetting?.setDisabled(!v);
            fmMaxCharsSetting?.setDisabled(!v);
            fmMaxFilesSetting?.setDisabled(!v);
            await this.plugin.saveSettings();
          })
      );

    fmKeysSetting = new Setting(bodyEl)
      .setName(t("settings.frontmatterIndexKeys.name"))
      .setDesc(t("settings.frontmatterIndexKeys.desc"))
      .setClass("ana-setting-textarea-full")
      .addTextArea((ta) => {
        ta
          .setPlaceholder(t("settings.frontmatterIndexKeys.placeholder"))
          .setValue(this.plugin.settings.frontmatterIndexKeys)
          .onChange(async (v) => {
            this.plugin.settings.frontmatterIndexKeys = v;
            await this.plugin.saveSettings();
          });
        ta.inputEl.rows = 4;
      })
      .setDisabled(!this.plugin.settings.includeFrontmatterIndex);

    fmMaxCharsSetting = new Setting(bodyEl)
      .setName(t("settings.frontmatterIndexMaxChars.name"))
      .setDesc(t("settings.frontmatterIndexMaxChars.desc"))
      .addText((t2) => {
        t2.inputEl.type = "number";
        t2.inputEl.min = "1";
        t2.inputEl.step = "1";
        t2.inputEl.inputMode = "numeric";
        t2.setPlaceholder("500")
          .setValue(String(this.plugin.settings.frontmatterIndexMaxChars))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.frontmatterIndexMaxChars = n;
              await this.plugin.saveSettings();
            }
          });
      })
      .setDisabled(!this.plugin.settings.includeFrontmatterIndex);

    fmMaxFilesSetting = new Setting(bodyEl)
      .setName(t("settings.frontmatterIndexMaxFiles.name"))
      .setDesc(t("settings.frontmatterIndexMaxFiles.desc"))
      .addText((t2) => {
        t2.inputEl.type = "number";
        t2.inputEl.min = "0";
        t2.inputEl.step = "1";
        t2.inputEl.inputMode = "numeric";
        t2.setPlaceholder("200")
          .setValue(String(this.plugin.settings.frontmatterIndexMaxFiles))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n >= 0) {
              this.plugin.settings.frontmatterIndexMaxFiles = n;
              await this.plugin.saveSettings();
            }
          });
      })
      .setDisabled(!this.plugin.settings.includeFrontmatterIndex);

  }

  // ===== 标签页：用户画像 =====
  private renderProfileTab(bodyEl: HTMLElement): void {
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
      .setClass("ana-setting-textarea-full")
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
      .setClass("ana-setting-textarea-full")
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

    new Setting(bodyEl)
      .setName(t("settings.profileMemoryMaxChars.name"))
      .setDesc(t("settings.profileMemoryMaxChars.desc"))
      .setDisabled(!this.plugin.settings.memoryProfileEnabled)
      .addText((t2) => {
        t2.inputEl.type = "number";
        t2.inputEl.min = "1";
        t2.inputEl.step = "1";
        t2.inputEl.inputMode = "numeric";
        t2.setPlaceholder("4000")
          .setValue(String(this.plugin.settings.profileMemoryMaxChars))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.profileMemoryMaxChars = n;
              await this.plugin.saveSettings();
            }
          });
      });

  }

  // ===== 标签页：角色信息 =====
  private renderRolesTab(bodyEl: HTMLElement): void {
    // 顶层：启用角色功能 总开关
    new Setting(bodyEl)
      .setName(t("settings.rolesEnabled.name"))
      .setDesc(t("settings.rolesEnabled.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.rolesEnabled)
          .onChange(async (v) => {
            this.plugin.settings.rolesEnabled = v;
            await this.plugin.saveSettings();
          })
      );

    // 添加角色按钮
    new Setting(bodyEl)
      .setName(t("settings.roles.add.name"))
      .setDesc(t("settings.roles.add.desc"))
      .addButton((btn) => {
        btn.setButtonText(t("settings.roles.add.button")).setCta();
        btn.onClick(() => {
          new RoleInfoModal(this.app, this.plugin, null, () =>
            this.display()
          ).open();
        });
      });

    // 搜索框
    let roleSearchQuery = "";
    new Setting(bodyEl)
      .setName(t("settings.roles.search.name"))
      .setDesc(t("settings.roles.search.desc"))
      .addText((input) => {
        input.setPlaceholder(t("settings.roles.search.placeholder"));
        input.onChange((v) => {
          roleSearchQuery = v;
          this.renderRoleList(roleListContainer, roleSearchQuery);
        });
      });

    // 列表容器
    const roleListContainer = bodyEl.createEl("div", {
      cls: "ana-model-link-list",
    });
    this.renderRoleList(roleListContainer, "");
  }

  // ===== 标签页：交互设置 =====
  private renderAutopromptTab(bodyEl: HTMLElement): void {
    // --- AI 对话面板 ---
    this.createGroupHeader(bodyEl, "settings.autopromptGroup.chat");

    new Setting(bodyEl)
      .setName(t("settings.chatPanel.name"))
      .setDesc(t("settings.chatPanel.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.chatPanelEnabled)
          .onChange(async (v) => {
            try {
              this.plugin.settings.chatPanelEnabled = v;
              await this.plugin.saveSettings();
              // 同步三类入口：ribbon 图标、命令面板命令、已打开的 ChatView
              this.plugin.refreshChatPanelAccess();
            } catch (e) {
              console.error("[Smart Notes] failed to save chatPanelEnabled:", e);
              new Notice(t("settings.saveError"));
            }
          })
      );

    // 「是否把当前笔记添加到对话框」与父 toggle 解耦：
    // 父开关 chatPanelEnabled 关闭时，子开关的 input 曾被 setDisabled(true)，
    // 导致磁盘值 addCurrentNoteToChat=true 时用户点击无反应（HTML disabled 原生屏蔽 click），
    // 表现为"按钮无法关闭"。子开关的运行时行为已在 main.ts 用
    // `if (this.settings.chatPanelEnabled && this.settings.addCurrentNoteToChat)` 守护，
    // 父子 toggle 各自独立管理即可。
    new Setting(bodyEl)
      .setName(t("settings.addCurrentNoteToChat.name"))
      .setDesc(t("settings.addCurrentNoteToChat.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.addCurrentNoteToChat)
          .onChange(async (v) => {
            try {
              this.plugin.settings.addCurrentNoteToChat = v;
              await this.plugin.saveSettings();
            } catch (e) {
              console.error("[Smart Notes] failed to save addCurrentNoteToChat:", e);
              new Notice(t("settings.saveError"));
            }
          })
      );

    new Setting(bodyEl)
      .setName(t("settings.showReasoning.name"))
      .setDesc(t("settings.showReasoning.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.showReasoning)
          .onChange(async (v) => {
            try {
              this.plugin.settings.showReasoning = v;
              await this.plugin.saveSettings();
            } catch (e) {
              console.error("[Smart Notes] failed to save showReasoning:", e);
              new Notice(t("settings.saveError"));
            }
          })
      );

    new Setting(bodyEl)
      .setName(t("settings.historyMaxMessages.name"))
      .setDesc(t("settings.historyMaxMessages.desc"))
      .addText((t2) => {
        t2.inputEl.type = "number";
        t2.inputEl.min = "0";
        t2.inputEl.step = "1";
        t2.inputEl.inputMode = "numeric";
        t2.setPlaceholder("20")
          .setValue(String(this.plugin.settings.historyMaxMessages))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n >= 0) {
              this.plugin.settings.historyMaxMessages = n;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(bodyEl)
      .setName(t("settings.chatActivityTimeout.name"))
      .setDesc(t("settings.chatActivityTimeout.desc"))
      .addText((t2) => {
        t2.inputEl.type = "number";
        t2.inputEl.min = "10";
        t2.inputEl.step = "10";
        t2.inputEl.inputMode = "numeric";
        t2.setPlaceholder("60")
          .setValue(String(this.plugin.settings.chatActivityTimeout))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n >= 10) {
              this.plugin.settings.chatActivityTimeout = n;
              await this.plugin.saveSettings();
            }
          });
      });

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
      .addText((t2) => {
        t2.inputEl.type = "number";
        t2.inputEl.min = "1";
        t2.inputEl.step = "1";
        t2.inputEl.inputMode = "numeric";
        t2.setPlaceholder("800")
          .setValue(String(this.plugin.settings.realtimeDebounceMs))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.realtimeDebounceMs = n;
              await this.plugin.saveSettings();
            }
          });
      })
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
      .setClass("ana-setting-textarea-full")
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
  }

  // ===== 标签页：联网搜索 =====

  /** 获取当前 provider 的第一个秘钥（兼容数组数据模型） */
  private getCurrentWebKey(
    prov: "tavily" | "serper" | "brave" | "searxng"
  ): string {
    const arr =
      prov === "tavily"
        ? this.plugin.settings.tavilyApiKeys
        : prov === "serper"
        ? this.plugin.settings.serperApiKeys
        : prov === "brave"
        ? this.plugin.settings.braveApiKeys
        : this.plugin.settings.searxngInstances;
    return arr.length > 0 ? arr[0] : "";
  }

  /** 设置当前 provider 的秘钥（替换整个数组为单元素） */
  private setWebKey(
    prov: "tavily" | "serper" | "brave" | "searxng",
    secret: string
  ): void {
    const arr = secret ? [secret] : [];
    if (prov === "tavily") this.plugin.settings.tavilyApiKeys = arr;
    else if (prov === "serper") this.plugin.settings.serperApiKeys = arr;
    else if (prov === "brave") this.plugin.settings.braveApiKeys = arr;
    else this.plugin.settings.searxngInstances = arr;
  }

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

    // 根据当前选中的 provider 显示对应的秘钥选择按钮
    const prov = this.plugin.settings.webSearchProvider;
    const currentWebKey = this.getCurrentWebKey(prov);

    keysSetting = new Setting(bodyEl)
      .setName(t(`settings.webKeys.${prov}.name`))
      .setDesc(t(`settings.webKeys.${prov}.desc`))
      .setClass("ana-setting-key-row");

    // 按钮行：选择/修改秘钥
    const webKeyBtnRow = keysSetting.controlEl.createEl("div", {
      cls: "ana-model-link-key-btn-row",
    });

    const selectKeyBtn = webKeyBtnRow.createEl("button", {
      cls: "ana-model-link-btn",
      text: currentWebKey
        ? t("settings.modelLinks.modal.modifyKey")
        : t("settings.modelLinks.modal.selectKey"),
    });
    selectKeyBtn.addEventListener("click", () => {
      // 每次点击都重新读取当前已保存的值，避免闭包引用初始渲染时的旧值
      new SecretPickerModal(
        this.app,
        this.getCurrentWebKey(prov),
        async (secret) => {
          this.setWebKey(prov, secret);
          selectKeyBtn.textContent = secret
            ? t("settings.modelLinks.modal.modifyKey")
            : t("settings.modelLinks.modal.selectKey");
          await this.plugin.saveSettings();
        }
      ).open();
    });

    // 测试连接按钮
    const webTestBtn = webKeyBtnRow.createEl("button", {
      cls: "ana-model-link-btn",
      text: t("settings.test.button"),
    });
    webTestBtn.addEventListener("click", async () => {
      const key = this.getCurrentWebKey(prov);
      if (!key) {
        new Notice(t("settings.test.noKey"));
        return;
      }
      webTestBtn.disabled = true;
      webTestBtn.textContent = t("settings.test.testing");
      try {
        const svc = new WebSearchService({
          enabled: true,
          provider: prov,
          tavilyApiKeys: this.plugin.settings.tavilyApiKeys,
          serperApiKeys: this.plugin.settings.serperApiKeys,
          braveApiKeys: this.plugin.settings.braveApiKeys,
          searxngInstances: this.plugin.settings.searxngInstances,
          maxResults: this.plugin.settings.webSearchMaxResults,
          maxCharsPerResult: this.plugin.settings.webSearchMaxCharsPerResult,
        });
        await svc.testConnection(prov, key);
        new Notice(t("settings.test.success"));
      } catch (e) {
        new Notice(
          t("settings.test.failure", { error: (e as Error).message })
        );
      } finally {
        webTestBtn.disabled = false;
        webTestBtn.textContent = t("settings.test.button");
      }
    });

    keysSetting.setDisabled(!webEnabled);

    maxResultsSetting = new Setting(bodyEl)
      .setName(t("settings.webSearchMaxResults.name"))
      .setDesc(t("settings.webSearchMaxResults.desc"))
      .addText((t2) => {
        t2.inputEl.type = "number";
        t2.inputEl.min = "1";
        t2.inputEl.step = "1";
        t2.inputEl.inputMode = "numeric";
        t2.setPlaceholder("5")
          .setValue(String(this.plugin.settings.webSearchMaxResults))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.webSearchMaxResults = n;
              await this.plugin.saveSettings();
            }
          });
      })
      .setDisabled(!webEnabled);

    maxCharsSetting = new Setting(bodyEl)
      .setName(t("settings.webSearchMaxChars.name"))
      .setDesc(t("settings.webSearchMaxChars.desc"))
      .addText((t2) => {
        t2.inputEl.type = "number";
        t2.inputEl.min = "1";
        t2.inputEl.step = "1";
        t2.inputEl.inputMode = "numeric";
        t2.setPlaceholder("1500")
          .setValue(String(this.plugin.settings.webSearchMaxCharsPerResult))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.webSearchMaxCharsPerResult = n;
              await this.plugin.saveSettings();
            }
          });
      })
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

    // 顶层：上传 skill zip（同时放置刷新按钮）
    new Setting(bodyEl)
      .setName(t("settings.skills.upload.name"))
      .setDesc(
        t("settings.skills.upload.desc") +
          " " +
          t("settings.defaultSkills.pathHint", { path: getSkillsDir(plugin) })
      )
      .addButton((btn) => {
        btn.setButtonText(t("settings.skills.upload.button"));
        btn.onClick(() => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".zip,application/zip,application/x-zip-compressed";
          input.addEventListener("change", async () => {
            const file = input.files?.[0];
            if (!file) return;
            const result = await uploadSkillFromZip(plugin, file);
            new Notice(result.message);
            if (result.success) {
              void renderSkillsList();
            }
          });
          input.click();
        });
      })
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
          if (v && !has) {
            arr.push(sk.path);
          } else if (!v && has) {
            const idx = arr.indexOf(sk.path);
            if (idx >= 0) arr.splice(idx, 1);
          }
          plugin.settings.defaultSkills = arr;
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

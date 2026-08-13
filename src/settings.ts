import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  DropdownComponent,
  setIcon,
} from "obsidian";
import type AiNoteAgentPlugin from "./main";
import { t } from "./i18n";
import { createProvider } from "./ai/provider";
import { loadMemoryFile, saveMemoryFile } from "./memory/profileMemory";
import { listSkills, type SkillEntry } from "./skills/skills";
import { getSkillsDir } from "./utils/aiFolder";

export type ProviderType = "openai" | "ollama";

export interface AiNoteAgentSettings {
  provider: ProviderType;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  maxTokens: number;
  temperature: number;
  realtimeEnabled: boolean;
  realtimeDebounceMs: number;
  // 自定义指令：注入到所有 AI 功能的 system prompt
  customInstructions: string;
  // vault 根目录中用于存放记忆与 skill 的文件夹名称
  aiFolderName: string;
  // 长期画像记忆：AI 自动提取的维度（每行一个）
  memoryProfileCategories: string;
  // 对话：是否把知识库路径索引（仅路径）注入 system prompt，让 AI 知道库里有哪些文件
  includeVaultIndex: boolean;
  // 对话：单文件注入到上下文的内容字符上限（防止超大文件撑爆 token）
  chatContextMaxChars: number;
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
  maxTokens: 1024,
  temperature: 0.3,
  realtimeEnabled: false,
  realtimeDebounceMs: 800,
  customInstructions: "",
  aiFolderName: ".vaultmind",
  memoryProfileCategories:
    "职业\n技术栈\n输出偏好\n项目背景\n习惯\n重要事实\n待办事项",
  includeVaultIndex: true,
  chatContextMaxChars: 8000,
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
    // --- 模型链接 ---
    this.createGroupHeader(bodyEl, "settings.providerGroup.link");

    new Setting(bodyEl)
      .setName(t("settings.provider.name"))
      .setDesc(t("settings.provider.desc"))
      .addDropdown((dd: DropdownComponent) =>
        dd
          .addOption("openai", t("settings.provider.openai"))
          .addOption("ollama", t("settings.provider.ollama"))
          .setValue(this.plugin.settings.provider)
          .onChange(async (v) => {
            this.plugin.settings.provider = v as ProviderType;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.provider === "openai") {
      new Setting(bodyEl)
        .setName(t("settings.openaiBaseUrl.name"))
        .setDesc(t("settings.openaiBaseUrl.desc"))
        .addText((t2) =>
          t2
            .setPlaceholder("https://api.openai.com/v1")
            .setValue(this.plugin.settings.openaiBaseUrl)
            .onChange(async (v) => {
              this.plugin.settings.openaiBaseUrl = v.trim();
              await this.plugin.saveSettings();
            })
        );
      new Setting(bodyEl)
        .setName(t("settings.openaiKey.name"))
        .setDesc(t("settings.openaiKey.desc"))
        .addText((t2) =>
          t2
            .setPlaceholder("sk-...")
            .setValue(this.plugin.settings.openaiApiKey)
            .onChange(async (v) => {
              this.plugin.settings.openaiApiKey = v.trim();
              await this.plugin.saveSettings();
            })
        );
      new Setting(bodyEl)
        .setName(t("settings.openaiModel.name"))
        .setDesc(t("settings.openaiModel.desc"))
        .addText((t2) =>
          t2
            .setPlaceholder("gpt-4o-mini")
            .setValue(this.plugin.settings.openaiModel)
            .onChange(async (v) => {
              this.plugin.settings.openaiModel = v.trim();
              await this.plugin.saveSettings();
            })
        );
    } else {
      new Setting(bodyEl)
        .setName(t("settings.ollamaBaseUrl.name"))
        .setDesc(t("settings.ollamaBaseUrl.desc"))
        .addText((t2) =>
          t2
            .setPlaceholder("http://localhost:11434")
            .setValue(this.plugin.settings.ollamaBaseUrl)
            .onChange(async (v) => {
              this.plugin.settings.ollamaBaseUrl = v.trim();
              await this.plugin.saveSettings();
            })
        );
      new Setting(bodyEl)
        .setName(t("settings.ollamaModel.name"))
        .setDesc(t("settings.ollamaModel.desc"))
        .addText((t2) =>
          t2
            .setPlaceholder("llama3")
            .setValue(this.plugin.settings.ollamaModel)
            .onChange(async (v) => {
              this.plugin.settings.ollamaModel = v.trim();
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(bodyEl)
      .setName(t("settings.test.name"))
      .setDesc(t("settings.test.desc"))
      .addButton((btn) => {
        btn.setButtonText(t("settings.test.button")).onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText(t("settings.test.testing"));
          try {
            const provider = createProvider(this.plugin.settings);
            await provider.complete(
              [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: "Reply only with ok." },
              ],
              { maxTokens: 10, temperature: 0 }
            );
            new Notice(t("settings.test.success"));
          } catch (e) {
            new Notice(
              t("settings.test.failure", { error: (e as Error).message })
            );
          } finally {
            btn.setDisabled(false);
            btn.setButtonText(t("settings.test.button"));
          }
        });
      });

    // --- 模型参数 ---
    this.createGroupHeader(bodyEl, "settings.providerGroup.params");

    new Setting(bodyEl)
      .setName(t("settings.maxTokens.name"))
      .setDesc(t("settings.maxTokens.desc"))
      .addText((t2) =>
        t2
          .setPlaceholder("1024")
          .setValue(String(this.plugin.settings.maxTokens))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.maxTokens = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(bodyEl)
      .setName(t("settings.temperature.name"))
      .setDesc(t("settings.temperature.desc"))
      .addText((t2) =>
        t2
          .setPlaceholder("0.3")
          .setValue(String(this.plugin.settings.temperature))
          .onChange(async (v) => {
            const n = parseFloat(v);
            if (!isNaN(n) && n >= 0 && n <= 2) {
              this.plugin.settings.temperature = n;
              await this.plugin.saveSettings();
            }
          })
      );

    // --- 数据存储 ---
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

    new Setting(bodyEl)
      .setName(t("settings.includeVaultIndex.name"))
      .setDesc(t("settings.includeVaultIndex.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.includeVaultIndex)
          .onChange(async (v) => {
            this.plugin.settings.includeVaultIndex = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(bodyEl)
      .setName(t("settings.chatContextMaxChars.name"))
      .setDesc(t("settings.chatContextMaxChars.desc"))
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

    new Setting(bodyEl)
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
      });

    new Setting(bodyEl)
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
      });
  }

  // ===== 标签页：实时自动提示 =====
  private renderAutopromptTab(bodyEl: HTMLElement): void {
    new Setting(bodyEl)
      .setName(t("settings.realtime.name"))
      .setDesc(t("settings.realtime.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.realtimeEnabled)
          .onChange(async (v) => {
            this.plugin.settings.realtimeEnabled = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(bodyEl)
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
      );
  }

  // ===== 标签页：联网搜索 =====
  private renderWebTab(bodyEl: HTMLElement): void {
    new Setting(bodyEl)
      .setName(t("settings.webSearchEnabled.name"))
      .setDesc(t("settings.webSearchEnabled.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.webSearchEnabled)
          .onChange(async (v) => {
            this.plugin.settings.webSearchEnabled = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(bodyEl)
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
      );

    // 根据当前选中的 provider 显示对应的多凭据输入框
    const prov = this.plugin.settings.webSearchProvider;
    const keySetting = new Setting(bodyEl)
      .setName(t(`settings.webKeys.${prov}.name`))
      .setDesc(t(`settings.webKeys.${prov}.desc`));
    keySetting.addTextArea((ta) =>
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
    (keySetting.components[0] as any)?.inputEl?.addClass("ana-settings-keys");

    new Setting(bodyEl)
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
      );

    new Setting(bodyEl)
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
      );

    new Setting(bodyEl)
      .setName(t("settings.webSearchShowCitations.name"))
      .setDesc(t("settings.webSearchShowCitations.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.webSearchShowCitations)
          .onChange(async (v) => {
            this.plugin.settings.webSearchShowCitations = v;
            await this.plugin.saveSettings();
          })
      );
  }

  // ===== 标签页：Skill 技能 =====
  private renderSkillsTab(bodyEl: HTMLElement): void {
    this.renderDefaultSkills(bodyEl);
  }

  /** 在面板内创建一个小型分组标题。 */
  private createGroupHeader(containerEl: HTMLElement, titleKey: string): void {
    containerEl.createEl("div", {
      cls: "ana-settings-group-title",
      text: t(titleKey),
    });
  }

  /** 渲染全局默认 skill 开关列表（异步加载 skills/ 目录）。 */
  private async renderDefaultSkills(containerEl: HTMLElement): Promise<void> {
    const listEl = containerEl.createEl("div", { cls: "ana-settings-skills" });
    listEl.createEl("div", {
      text: t("settings.defaultSkills.loading"),
      cls: "ana-settings-skills-loading",
    });
    let skills: SkillEntry[] = [];
    try {
      skills = await listSkills(this.plugin, this.app);
    } catch {
      skills = [];
    }
    listEl.empty();

    listEl.createEl("div", {
      text: t("settings.defaultSkills.pathHint", { path: getSkillsDir(this.plugin) }),
      cls: "ana-settings-skills-path",
    });

    if (skills.length === 0) {
      listEl.createEl("div", {
        text: t("settings.defaultSkills.empty"),
        cls: "ana-settings-skills-empty",
      });
      return;
    }
    for (const sk of skills) {
      new Setting(listEl)
        .setName(sk.name)
        .setDesc(sk.path)
        .addToggle((t2) =>
          t2
            .setValue(this.plugin.settings.defaultSkills.includes(sk.path))
            .onChange(async (v) => {
              const arr = this.plugin.settings.defaultSkills.filter(
                (p) => typeof p === "string"
              );
              const has = arr.includes(sk.path);
              if (v && !has) arr.push(sk.path);
              if (!v && has) {
                this.plugin.settings.defaultSkills = arr.filter(
                  (p) => p !== sk.path
                );
              } else {
                this.plugin.settings.defaultSkills = arr;
              }
              await this.plugin.saveSettings();
            })
        );
    }
  }
}

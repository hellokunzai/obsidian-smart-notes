import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  DropdownComponent,
} from "obsidian";
import type AiNoteAgentPlugin from "./main";
import { t } from "./i18n";
import { createProvider } from "./ai/provider";
import { ensureAiFolder } from "./utils/aiFolder";
import { listSkills, type SkillEntry } from "./skills/skills";

export type ProviderType = "openai" | "ollama";
export type LinkStyle = "relative" | "wikilink";

export interface AiNoteAgentSettings {
  provider: ProviderType;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  maxTokens: number;
  temperature: number;
  linkStyle: LinkStyle;
  autoLink: boolean;
  enrichProperties: boolean;
  realtimeEnabled: boolean;
  realtimeDebounceMs: number;
  relatedPerNote: number;
  // 自定义指令：注入到所有 AI 功能的 system prompt
  customInstructions: string;
  // 对话记忆：是否在 vault 中持久化聊天历史
  enableMemory: boolean;
  // 记忆保留的最大消息条数（防止 token 膨胀）
  maxMemoryMessages: number;
  // vault 根目录中用于存放记忆与 skill 的文件夹名称
  aiFolderName: string;
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
  linkStyle: "relative",
  autoLink: true,
  enrichProperties: true,
  realtimeEnabled: false,
  realtimeDebounceMs: 800,
  relatedPerNote: 5,
  customInstructions: "",
  enableMemory: true,
  maxMemoryMessages: 20,
  aiFolderName: "AI-Note-Agent",
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

export class AiNoteAgentSettingTab extends PluginSettingTab {
  plugin: AiNoteAgentPlugin;

  constructor(app: App, plugin: AiNoteAgentPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ===== AI 后端 =====
    const providerBody = this.createSection(
      containerEl,
      "settings.section.provider",
      "settings.section.provider.desc"
    );

    new Setting(providerBody)
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
      new Setting(providerBody)
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
      new Setting(providerBody)
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
      new Setting(providerBody)
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
      new Setting(providerBody)
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
      new Setting(providerBody)
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

    new Setting(providerBody)
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

    // ===== 模型参数 =====
    const modelBody = this.createSection(
      containerEl,
      "settings.section.modelParams",
      "settings.section.modelParams.desc"
    );

    new Setting(modelBody)
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

    new Setting(modelBody)
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

    // ===== 链接与关联 =====
    const linksBody = this.createSection(
      containerEl,
      "settings.section.links",
      "settings.section.links.desc"
    );

    new Setting(linksBody)
      .setName(t("settings.linkStyle.name"))
      .setDesc(t("settings.linkStyle.desc"))
      .addDropdown((dd: DropdownComponent) =>
        dd
          .addOption("relative", t("settings.linkStyle.relative"))
          .addOption("wikilink", t("settings.linkStyle.wikilink"))
          .setValue(this.plugin.settings.linkStyle)
          .onChange(async (v) => {
            this.plugin.settings.linkStyle = v as LinkStyle;
            await this.plugin.saveSettings();
          })
      );

    new Setting(linksBody)
      .setName(t("settings.autoLink.name"))
      .setDesc(t("settings.autoLink.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.autoLink)
          .onChange(async (v) => {
            this.plugin.settings.autoLink = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(linksBody)
      .setName(t("settings.relatedPerNote.name"))
      .setDesc(t("settings.relatedPerNote.desc"))
      .addText((t2) =>
        t2
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.relatedPerNote))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.relatedPerNote = n;
              await this.plugin.saveSettings();
            }
          })
      );

    // ===== 笔记增强 =====
    const enrichBody = this.createSection(
      containerEl,
      "settings.section.enrichment",
      "settings.section.enrichment.desc"
    );

    new Setting(enrichBody)
      .setName(t("settings.enrich.name"))
      .setDesc(t("settings.enrich.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.enrichProperties)
          .onChange(async (v) => {
            this.plugin.settings.enrichProperties = v;
            await this.plugin.saveSettings();
          })
      );

    // ===== 实时自动提示 =====
    const promptBody = this.createSection(
      containerEl,
      "settings.section.autoprompt",
      "settings.section.autoprompt.desc"
    );

    new Setting(promptBody)
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

    new Setting(promptBody)
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

    // ===== AI 行为 =====
    const behaviorBody = this.createSection(
      containerEl,
      "settings.section.behavior",
      "settings.section.behavior.desc"
    );

    new Setting(behaviorBody)
      .setName(t("settings.customInstructions.name"))
      .setDesc(t("settings.customInstructions.desc"))
      .addTextArea((ta) =>
        ta
          .setPlaceholder(t("settings.customInstructions.placeholder"))
          .setValue(this.plugin.settings.customInstructions)
          .onChange(async (v) => {
            this.plugin.settings.customInstructions = v;
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText(t("settings.customInstructions.reset"))
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.customInstructions = "";
            await this.plugin.saveSettings();
            this.display();
          })
      );

    // ===== 对话记忆 =====
    const memoryBody = this.createSection(
      containerEl,
      "settings.section.memory",
      "settings.section.memory.desc"
    );

    new Setting(memoryBody)
      .setName(t("settings.enableMemory.name"))
      .setDesc(t("settings.enableMemory.desc"))
      .addToggle((t2) =>
        t2
          .setValue(this.plugin.settings.enableMemory)
          .onChange(async (v) => {
            this.plugin.settings.enableMemory = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(memoryBody)
      .setName(t("settings.maxMemoryMessages.name"))
      .setDesc(t("settings.maxMemoryMessages.desc"))
      .addText((t2) =>
        t2
          .setPlaceholder("20")
          .setValue(String(this.plugin.settings.maxMemoryMessages))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.maxMemoryMessages = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(memoryBody)
      .setName(t("settings.aiFolderName.name"))
      .setDesc(t("settings.aiFolderName.desc"))
      .addText((t2) =>
        t2
          .setPlaceholder("AI-Note-Agent")
          .setValue(this.plugin.settings.aiFolderName)
          .onChange(async (v) => {
            const name = v.trim();
            if (name) {
              this.plugin.settings.aiFolderName = name;
              await this.plugin.saveSettings();
            }
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText(t("settings.aiFolderName.create"))
          .onClick(async () => {
            btn.setDisabled(true);
            try {
              await ensureAiFolder(this.plugin);
              new Notice(t("settings.aiFolderName.created"));
            } catch (e) {
              new Notice(t("notice.error", { error: (e as Error).message }));
            } finally {
              btn.setDisabled(false);
            }
          })
      );

    // ===== AI 对话上下文 =====
    const chatBody = this.createSection(
      containerEl,
      "settings.section.chat",
      "settings.section.chat.desc"
    );

    new Setting(chatBody)
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

    new Setting(chatBody)
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

    // ===== Skill 技能 =====
    const skillsBody = this.createSection(
      containerEl,
      "settings.section.skills",
      "settings.section.skills.desc"
    );
    this.renderDefaultSkills(skillsBody);

    // ===== 联网搜索 =====
    const webBody = this.createSection(
      containerEl,
      "settings.section.web",
      "settings.section.web.desc"
    );

    new Setting(webBody)
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

    new Setting(webBody)
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
    const keySetting = new Setting(webBody)
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

    new Setting(webBody)
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

    new Setting(webBody)
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

    new Setting(webBody)
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

  /** 创建一个设置分组（带标题与可选描述），返回用于放置 Setting 的容器。 */
  private createSection(
    containerEl: HTMLElement,
    titleKey: string,
    descKey?: string
  ): HTMLElement {
    const section = containerEl.createEl("div", { cls: "ana-settings-section" });
    const header = section.createEl("div", {
      cls: "ana-settings-section-header",
    });
    header.createEl("h3", { text: t(titleKey), cls: "ana-settings-h3" });
    if (descKey) {
      header.createEl("p", { text: t(descKey), cls: "ana-settings-section-desc" });
    }
    return section.createEl("div", { cls: "ana-settings-section-body" });
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

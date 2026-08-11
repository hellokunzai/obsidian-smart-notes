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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    if (this.plugin.settings.provider === "openai") {
      new Setting(containerEl)
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
      new Setting(containerEl)
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
      new Setting(containerEl)
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
      new Setting(containerEl)
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
      new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName(t("settings.debounce.name"))
      .setDesc(t("settings.debounce.desc"))
      .addText((t2) =>
        t2
          .setPlaceholder("800")
          .setValue(String(this.plugin.settings.realtimeDebounceMs))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n)) {
              this.plugin.settings.realtimeDebounceMs = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName(t("settings.relatedPerNote.name"))
      .setDesc(t("settings.relatedPerNote.desc"))
      .addText((t2) =>
        t2
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.relatedPerNote))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n)) {
              this.plugin.settings.relatedPerNote = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName(t("settings.maxTokens.name"))
      .setDesc(t("settings.maxTokens.desc"))
      .addText((t2) =>
        t2
          .setPlaceholder("1024")
          .setValue(String(this.plugin.settings.maxTokens))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n)) {
              this.plugin.settings.maxTokens = n;
              await this.plugin.saveSettings();
            }
          })
      );

    containerEl.createEl("h3", { text: t("settings.section.behavior"), cls: "ana-settings-h3" });

    new Setting(containerEl)
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

    containerEl.createEl("h3", { text: t("settings.section.memory"), cls: "ana-settings-h3" });

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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
  }
}

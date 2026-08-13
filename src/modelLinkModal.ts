import {
  App,
  Modal,
  Setting,
  DropdownComponent,
  TextComponent,
  ButtonComponent,
  Notice,
} from "obsidian";
import type AiNoteAgentPlugin from "./main";
import type { ModelLink, ProviderType } from "./settings";
import { genId } from "./settings";
import { createProviderFromLink } from "./ai/provider";
import { t } from "./i18n";

/**
 * 添加 / 编辑单条模型链接的弹窗。
 * 字段：链接名称（必填且唯一）、链接类型、Base URL、API Key、模型名称（多模型标签）。
 * 支持「测试连接」（基于当前草稿配置，不依赖已保存数据）。
 */
export class ModelLinkModal extends Modal {
  private name = "";
  private type: ProviderType = "openai";
  private baseUrl = "";
  private apiKey = "";
  private models: string[] = [];
  private maxTokens = "";
  private temperature = "";
  private showApiKey = false;

  // 动态区域（随链接类型变化）与标签编辑器
  private dynamicEl!: HTMLElement;
  private tagsEl!: HTMLElement;
  private renderTags!: () => void;

  constructor(
    app: App,
    private plugin: AiNoteAgentPlugin,
    private editing: ModelLink | null,
    private onSaved: () => void
  ) {
    super(app);
    if (editing) {
      this.name = editing.name;
      this.type = editing.type;
      this.baseUrl = editing.baseUrl;
      this.apiKey = editing.apiKey;
      this.models = editing.models.slice();
      this.maxTokens = editing.maxTokens != null ? String(editing.maxTokens) : "";
      this.temperature = editing.temperature != null ? String(editing.temperature) : "";
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ana-model-link-modal");

    contentEl.createEl("h2", {
      text: this.editing
        ? t("settings.modelLinks.modal.editTitle")
        : t("settings.modelLinks.modal.addTitle"),
    });

    // 链接类型（置顶）
    new Setting(contentEl)
      .setName(t("settings.provider.name"))
      .setDesc(t("settings.provider.desc"))
      .addDropdown((dd: DropdownComponent) => {
        dd.addOption("openai", t("settings.provider.openai"))
          .addOption("ollama", t("settings.provider.ollama"))
          .setValue(this.type)
          .onChange((v) => {
            this.type = v as ProviderType;
            this.renderDynamic();
          });
      });

    // 链接名称（必填、唯一）
    new Setting(contentEl)
      .setName(t("settings.modelLinks.modal.name"))
      .setDesc(t("settings.modelLinks.modal.nameDesc"))
      .addText((tc: TextComponent) => {
        tc.setPlaceholder(t("settings.modelLinks.modal.namePlaceholder"));
        tc.setValue(this.name);
        tc.onChange((v) => {
          this.name = v;
        });
      });

    // 动态区域：Base URL / API Key / 模型（随类型变化）
    this.dynamicEl = contentEl.createEl("div");
    this.renderDynamic();

    // 最大 Token 数（可选，不填使用全局默认值）
    new Setting(contentEl)
      .setName(t("settings.maxTokens.name"))
      .setDesc(t("settings.modelLinks.modal.maxTokensDesc"))
      .addText((tc: TextComponent) => {
        tc.setPlaceholder(
          String(this.plugin.settings.maxTokens) +
            " " +
            t("settings.modelLinks.modal.useGlobalDefault")
        );
        tc.setValue(this.maxTokens);
        tc.onChange((v) => {
          this.maxTokens = v.trim();
        });
      });

    // Temperature（可选，不填使用全局默认值）
    new Setting(contentEl)
      .setName(t("settings.temperature.name"))
      .setDesc(t("settings.modelLinks.modal.temperatureDesc"))
      .addText((tc: TextComponent) => {
        tc.setPlaceholder(
          String(this.plugin.settings.temperature) +
            " " +
            t("settings.modelLinks.modal.useGlobalDefault")
        );
        tc.setValue(this.temperature);
        tc.onChange((v) => {
          this.temperature = v.trim();
        });
      });

    // 测试连接
    new Setting(contentEl)
      .setName(t("settings.test.name"))
      .setDesc(t("settings.test.desc"))
      .addButton((btn) => {
        btn.setButtonText(t("settings.test.button"));
        btn.onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText(t("settings.test.testing"));
          try {
            const link = this.buildLink("");
            const provider = createProviderFromLink(link);
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

    // 底部按钮
    const footer = contentEl.createEl("div", {
      cls: "ana-modal-button-row",
    });
    new ButtonComponent(footer)
      .setButtonText(t("modal.cancel"))
      .onClick(() => this.close());
    new ButtonComponent(footer)
      .setButtonText(
        this.editing
          ? t("settings.modelLinks.modal.save")
          : t("settings.modelLinks.modal.add")
      )
      .setCta()
      .onClick(() => void this.save());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** 根据当前链接类型渲染 Base URL / API Key / 模型区域。 */
  private renderDynamic(): void {
    this.dynamicEl.empty();

    if (this.type === "openai") {
      new Setting(this.dynamicEl)
        .setName(t("settings.openaiBaseUrl.name"))
        .setDesc(t("settings.openaiBaseUrl.desc"))
        .addText((tc: TextComponent) => {
          tc.setPlaceholder("https://api.openai.com/v1");
          tc.setValue(this.baseUrl);
          tc.onChange((v) => {
            this.baseUrl = v.trim();
          });
        });

      const keySetting = new Setting(this.dynamicEl)
        .setName(t("settings.openaiKey.name"))
        .setDesc(t("settings.openaiKey.desc"))
        .addText((tc: TextComponent) => {
          tc.setPlaceholder("sk-...");
          tc.setValue(this.apiKey);
          tc.inputEl.type = this.showApiKey ? "text" : "password";
          tc.onChange((v) => {
            this.apiKey = v.trim();
          });
        });

      // 显示 / 隐藏 API Key 的小按钮
      const toggle = keySetting.controlEl.createEl("button", {
        cls: "ana-model-link-btn",
        text: this.showApiKey
          ? t("settings.modelLinks.modal.hideKey")
          : t("settings.modelLinks.modal.showKey"),
      });
      toggle.addEventListener("click", () => {
        this.showApiKey = !this.showApiKey;
        const input = keySetting.controlEl.querySelector(
          "input"
        ) as HTMLInputElement | null;
        if (input) input.type = this.showApiKey ? "text" : "password";
        toggle.textContent = this.showApiKey
          ? t("settings.modelLinks.modal.hideKey")
          : t("settings.modelLinks.modal.showKey");
      });
    } else {
      new Setting(this.dynamicEl)
        .setName(t("settings.ollamaBaseUrl.name"))
        .setDesc(t("settings.ollamaBaseUrl.desc"))
        .addText((tc: TextComponent) => {
          tc.setPlaceholder("http://localhost:11434");
          tc.setValue(this.baseUrl);
          tc.onChange((v) => {
            this.baseUrl = v.trim();
          });
        });
    }

    // 模型名称（多模型标签输入）
    const modelSetting = new Setting(this.dynamicEl)
      .setName(t("settings.modelLinks.modal.models"))
      .setDesc(t("settings.modelLinks.modal.modelsDesc"));

    // 输入行（标签右侧：输入框 + 添加按钮）
    const inputRow = modelSetting.controlEl.createEl("div", {
      cls: "ana-model-link-input-row",
    });
    const input = inputRow.createEl("input", {
      cls: "ana-model-link-tag-input",
      type: "text",
    });
    input.placeholder = t("settings.modelLinks.modal.modelPlaceholder");
    input.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Enter" || ke.key === ",") {
        e.preventDefault();
        this.addModelsFromInput(input);
      }
    });
    const addBtn = inputRow.createEl("button", {
      cls: "ana-model-link-btn",
      text: t("settings.modelLinks.modal.addModel"),
    });
    addBtn.addEventListener("click", () => this.addModelsFromInput(input));

    // 标签展示行（整个设置行下方，独立一行）
    this.tagsEl = this.dynamicEl.createEl("div", {
      cls: "ana-model-link-tags-editor",
    });
    this.renderTags = () => {
      this.tagsEl.empty();
      for (const m of this.models) {
        const tag = this.tagsEl.createEl("span", {
          cls: "ana-model-link-tag",
          text: m,
        });
        const x = tag.createEl("span", {
          cls: "ana-model-link-tag-x",
          text: "×",
        });
        x.addEventListener("click", () => {
          this.models = this.models.filter((x) => x !== m);
          this.renderTags();
        });
      }
    };
    this.renderTags();
  }

  private addModelsFromInput(input: HTMLInputElement): void {
    const parts = input.value
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of parts) {
      if (!this.models.includes(p)) {
        this.models.push(p);
      }
    }
    input.value = "";
    this.renderTags();
  }

  /** 由当前草稿状态构造 ModelLink（name 缺省时用占位名）。 */
  private buildLink(id: string): ModelLink {
    const isOllama = this.type === "ollama";
    return {
      id,
      name: this.name.trim() || t("settings.modelLinks.modal.untitled"),
      type: this.type,
      baseUrl: this.baseUrl.trim() || (isOllama ? "http://localhost:11434" : "https://api.openai.com/v1"),
      apiKey: this.apiKey.trim(),
      models: this.models.map((m) => m.trim()).filter(Boolean),
      maxTokens: this.maxTokens ? parseInt(this.maxTokens, 10) || undefined : undefined,
      temperature: this.temperature ? parseFloat(this.temperature) || undefined : undefined,
    };
  }

  private async save(): Promise<void> {
    const name = this.name.trim();
    if (!name) {
      new Notice(t("settings.modelLinks.modal.nameRequired"));
      return;
    }
    const conflict = this.plugin.settings.modelLinks.some(
      (l) => l.name === name && l.id !== this.editing?.id
    );
    if (conflict) {
      new Notice(t("settings.modelLinks.modal.nameDuplicate"));
      return;
    }

    if (this.editing) {
      const idx = this.plugin.settings.modelLinks.findIndex(
        (l) => l.id === this.editing!.id
      );
      if (idx >= 0) {
        this.plugin.settings.modelLinks[idx] = this.buildLink(this.editing.id);
      }
    } else {
      const link = this.buildLink(genId());
      this.plugin.settings.modelLinks.push(link);
      // 若还没有默认链接，自动把第一条设为默认
      if (!this.plugin.settings.defaultModelLinkId) {
        this.plugin.settings.defaultModelLinkId = link.id;
      }
    }

    await this.plugin.saveSettings();
    this.onSaved();
    this.close();
  }
}

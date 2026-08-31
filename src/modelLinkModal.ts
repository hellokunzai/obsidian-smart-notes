import {
  App,
  Modal,
  Setting,
  DropdownComponent,
  TextComponent,
  ButtonComponent,
  Notice,
  setIcon,
} from "obsidian";
import type AiNoteAgentPlugin from "./main";
import type { ModelLink, ProviderType } from "./settings";
import { genId, migrateModelLinkApiKeyToKeychain } from "./settings";
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
  /** 指向 Obsidian keychain 中 secret 的引用 ID。 */
  private apiKeyRef = "";
  private models: string[] = [];
  private maxTokens = "";
  private temperature = "";

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
      // 兼容旧数据：若 data.json 仍保存明文 apiKey，先迁移到 Obsidian keychain
      migrateModelLinkApiKeyToKeychain(this.app, editing as ModelLink & { apiKey?: string });
      this.apiKeyRef = editing.apiKeyRef ?? "";
      this.models = editing.models.slice();
      this.maxTokens = editing.maxTokens != null ? String(editing.maxTokens) : "0";
      this.temperature = editing.temperature != null ? String(editing.temperature) : "0.3";
    } else {
      this.maxTokens = "0";
      this.temperature = "0.3";
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
    let nameInputEl: HTMLInputElement | null = null;
    new Setting(contentEl)
      .setName(t("settings.modelLinks.modal.name"))
      .setDesc(t("settings.modelLinks.modal.nameDesc"))
      .addText((tc: TextComponent) => {
        nameInputEl = tc.inputEl;
        tc.setPlaceholder(t("settings.modelLinks.modal.namePlaceholder"));
        tc.setValue(this.name);
        tc.onChange((v) => {
          this.name = v;
        });
      });

    // 动态区域：Base URL / API Key / 模型（随类型变化）
    this.dynamicEl = contentEl.createEl("div");
    this.renderDynamic();

    // 最大 Token 数（可选，留空使用全局默认值；填 0 表示无限制）
    let maxTokensInputEl: HTMLInputElement | null = null;
    new Setting(contentEl)
      .setName(t("settings.maxTokens.name"))
      .setDesc(t("settings.modelLinks.modal.maxTokensDesc"))
      .addText((tc: TextComponent) => {
        maxTokensInputEl = tc.inputEl;
        tc.inputEl.type = "number";
        tc.inputEl.min = "0";
        tc.inputEl.step = "1";
        tc.inputEl.inputMode = "numeric";
        tc.inputEl.addClass("ana-modal-input-full");
        tc.setPlaceholder(String(this.plugin.settings.maxTokens));
        tc.setValue(this.maxTokens);
        tc.onChange((v) => {
          this.maxTokens = v.trim();
        });
      });

    // Temperature（可选，不填使用全局默认值）
    let temperatureInputEl: HTMLInputElement | null = null;
    new Setting(contentEl)
      .setName(t("settings.temperature.name"))
      .setDesc(t("settings.modelLinks.modal.temperatureDesc"))
      .addText((tc: TextComponent) => {
        temperatureInputEl = tc.inputEl;
        tc.inputEl.type = "number";
        tc.inputEl.min = "0";
        tc.inputEl.max = "2";
        tc.inputEl.step = "0.1";
        tc.inputEl.inputMode = "decimal";
        tc.inputEl.addClass("ana-modal-input-full");
        tc.setPlaceholder(String(this.plugin.settings.temperature));
        tc.setValue(this.temperature);
        tc.onChange((v) => {
          this.temperature = v.trim();
        });
      });

    // 等 DOM 布局完成后，把两个数字输入框的 max-width 同步为「链接名称」输入框的宽度
    requestAnimationFrame(() => {
      if (nameInputEl && maxTokensInputEl && temperatureInputEl) {
        const nameWidth = nameInputEl.offsetWidth;
        if (nameWidth > 0) {
          maxTokensInputEl.style.setProperty(
            "max-width",
            `${nameWidth}px`,
            "important"
          );
          temperatureInputEl.style.setProperty(
            "max-width",
            `${nameWidth}px`,
            "important"
          );
        }
      }
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
        .setClass("ana-setting-key-row");

      // 按钮行：选择/修改秘钥 + 测试连接（并排显示）
      const btnRow = keySetting.controlEl.createEl("div", {
        cls: "ana-model-link-key-btn-row",
      });

      /** 根据当前密钥状态更新选择按钮文字 */
      const updateSelectBtnText = () => {
        selectBtn.textContent = this.apiKeyRef
          ? t("settings.modelLinks.modal.modifyKey")
          : t("settings.modelLinks.modal.selectKey");
      };

      // 选择/修改秘钥按钮（动态文字）
      const selectBtn = btnRow.createEl("button", {
        cls: "ana-model-link-btn",
      });
      updateSelectBtnText();
      selectBtn.addEventListener("click", () => {
        // returnId 模式下 SecretPickerModal 按 secret ID 预选中，因此传入 apiKeyRef
        new SecretPickerModal(
          this.app,
          this.apiKeyRef,
          (secretId) => {
            this.apiKeyRef = secretId;
            updateSelectBtnText();
          },
          { returnId: true }
        ).open();
      });

      // 测试连接按钮
      const testBtn = btnRow.createEl("button", {
        cls: "ana-model-link-btn",
        text: t("settings.test.button"),
      });
      testBtn.addEventListener("click", async () => {
        // 未配置任何模型时直接提示，避免发送 model:"" 的无效请求（服务端返回 400）
        if (this.models.length === 0) {
          new Notice(t("settings.test.noModel"));
          return;
        }
        testBtn.disabled = true;
        testBtn.textContent = t("settings.test.testing");
        try {
          const link = this.buildLink("");
          const provider = createProviderFromLink(this.app, link);
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
          testBtn.disabled = false;
          testBtn.textContent = t("settings.test.button");
        }
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
      .setDesc(t("settings.modelLinks.modal.modelsDesc"))
      .setClass("ana-setting-textarea-full");

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
    const link: ModelLink = {
      id,
      name: this.name.trim() || t("settings.modelLinks.modal.untitled"),
      type: this.type,
      baseUrl: this.baseUrl.trim() || (isOllama ? "http://localhost:11434" : "https://api.openai.com/v1"),
      models: this.models.map((m) => m.trim()).filter(Boolean),
      maxTokens: this.maxTokens
        ? parseInt(this.maxTokens, 10) || 0
        : undefined,
      temperature: this.temperature ? parseFloat(this.temperature) || undefined : undefined,
    };
    if (this.apiKeyRef) {
      link.apiKeyRef = this.apiKeyRef;
    }
    return link;
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

/**
 * 秘钥选择弹窗：从 Obsidian 钥匙串（SecretStorage）中选择已有密钥。
 * 样式对齐 Obsidian 设置页「钥匙串」列表：
 *   - 顶部搜索框过滤
 *   - 单选列表（名称 + 已选徽标 + 查看/删除按钮）
 *   - 底部「添加密钥」+ 保存/取消
 */
export class SecretPickerModal extends Modal {
  private selectedId: string | null = null;
  private searchQuery = "";
  private searchInput!: HTMLInputElement;
  private listContainer!: HTMLElement;
  /** 内联添加表单容器（搜索框下方、列表上方） */
  private addFormEl!: HTMLElement;
  /** 保存按钮引用（原生按钮，确保点击事件可靠） */
  private saveBtnEl!: HTMLButtonElement;
  /** 当前展开查看的密钥 ID（null = 无展开） */
  private expandedId: string | null = null;

  constructor(
    app: App,
    private currentKey: string,
    private onConfirm: (secret: string) => void,
    private options?: { returnId?: boolean }
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ana-model-link-modal");
    contentEl.addClass("ana-secret-picker-modal");

    // 标题
    contentEl.createEl("h2", {
      text: t("settings.modelLinks.modal.secretPicker.title"),
    });

    // 搜索框
    const searchWrap = contentEl.createEl("div", {
      cls: "ana-secret-picker-search",
    });
    this.searchInput = searchWrap.createEl("input", {
      type: "text",
      cls: "ana-secret-picker-search-input",
    });
    this.searchInput.placeholder =
      t("settings.modelLinks.modal.secretPicker.search");
    this.searchInput.addEventListener("input", () => {
      this.searchQuery = this.searchInput.value.trim();
      this.renderList();
    });

    // 内联添加表单容器（默认隐藏）
    this.addFormEl = contentEl.createEl("div", {
      cls: "ana-secret-picker-add-form",
    });

    // 密钥列表容器
    this.listContainer = contentEl.createEl("div", {
      cls: "ana-secret-picker-list",
    });

    // 如果当前已有关联密钥，尝试预选中
    // returnId 模式下 currentKey 是 secret ID，直接按 id 匹配；
    // 非 returnId 模式下 currentKey 是密钥值，需读取 secret 值匹配。
    if (this.currentKey) {
      const allIds = this.app.secretStorage.listSecrets();
      for (const id of allIds) {
        const match = this.options?.returnId
          ? id === this.currentKey
          : this.app.secretStorage.getSecret(id) === this.currentKey;
        if (match) {
          this.selectedId = id;
          break;
        }
      }
    }

    this.renderList();

    // 底部按钮行
    const footer = contentEl.createEl("div", {
      cls: "ana-secret-picker-footer",
    });
    // 左侧：添加密钥
    const addBtn = footer.createEl("button", {
      cls: "ana-secret-picker-add-btn",
      text: t("settings.modelLinks.modal.secretPicker.addNew"),
    });
    addBtn.addEventListener("click", () => this.showAddSecret());
    // 右侧：取消 + 保存（原生按钮确保点击可靠）
    const btnGroup = footer.createEl("div", {
      cls: "ana-secret-picker-btn-group",
    });
    const cancelBtn = btnGroup.createEl("button", {
      cls: "ana-secret-picker-add-cancel",
      text: t("modal.cancel"),
    });
    cancelBtn.addEventListener("click", () => this.close());

    /** 保存按钮引用，供后续启用/禁用 */
    this.saveBtnEl = btnGroup.createEl("button", {
      cls: "ana-secret-picker-add-confirm",
      text: t("settings.modelLinks.modal.secretPicker.confirm"),
      attr: { type: "button" },
    });
    this.saveBtnEl.disabled = !this.selectedId;
    this.saveBtnEl.addEventListener("click", () => {
      if (this.selectedId) {
        if (this.options?.returnId) {
          this.onConfirm(this.selectedId);
        } else {
          const val = this.app.secretStorage.getSecret(this.selectedId);
          this.onConfirm(val ?? "");
        }
      }
      this.close();
    });

    // 聚焦搜索框
    setTimeout(() => this.searchInput.focus(), 50);
  }

  /** 渲染密钥列表（带搜索过滤）。 */
  private renderList(): void {
    this.listContainer.empty();
    let ids = this.app.secretStorage.listSecrets();
    const q = this.searchQuery.toLowerCase();
    if (q) {
      ids = ids.filter((id) => id.toLowerCase().includes(q));
    }
    if (ids.length === 0) {
      this.listContainer.createEl("div", {
        cls: "ana-secret-picker-empty",
        text: q
          ? t("settings.modelLinks.modal.secretPicker.noMatch")
          : t("settings.modelLinks.modal.secretPicker.empty"),
      });
      return;
    }
    for (const id of ids) {
      const row = this.listContainer.createEl("div", {
        cls: "ana-secret-picker-row",
      });
      const isSelected = id === this.selectedId;

      // 单选按钮
      const radio = row.createEl("input", {
        type: "radio",
        cls: "ana-secret-picker-radio",
      });
      radio.name = "secret-picker";
      radio.value = id;
      radio.checked = isSelected;
      radio.addEventListener("change", () => {
        this.selectedId = id;
        this.renderList();
        // 启用保存按钮
        if (this.saveBtnEl) this.saveBtnEl.disabled = false;
      });

      // 名称 + 徽标区
      const info = row.createEl("div", { cls: "ana-secret-picker-info" });
      info.createEl("span", { cls: "ana-secret-picker-name", text: id });
      if (isSelected) {
        info.createEl("span", {
          cls: "ana-secret-picker-selected-badge",
          text: t("settings.modelLinks.modal.secretPicker.selected"),
        });
      }

      // 操作按钮：查看 + 删除
      const actions = row.createEl("div", {
        cls: "ana-secret-picker-actions",
      });
      // 查看（行内展开密钥值）
      const viewBtn = actions.createEl("button", {
        cls: "ana-secret-picker-action-btn",
        attr: { "aria-label": t("settings.modelLinks.modal.secretPicker.view") },
      });
      setIcon(viewBtn, "eye");
      viewBtn.addEventListener("click", () => {
        this.expandedId = this.expandedId === id ? null : id;
        this.renderList();
      });

      // 行内展开区域（显示完整密钥值）
      if (this.expandedId === id) {
        const val = this.app.secretStorage.getSecret(id);
        const expandEl = row.createEl("div", {
          cls: "ana-secret-picker-expanded",
          text: val || t("settings.modelLinks.modal.secretPicker.noValue"),
        });
        row.addClass("is-expanded");
      }
      // 删除（设为空字符串来清除）
      const delBtn = actions.createEl("button", {
        cls: "ana-secret-picker-action-btn danger",
        attr: { "aria-label": t("settings.modelLinks.modal.secretPicker.delete") },
      });
      setIcon(delBtn, "trash");
      delBtn.addEventListener("click", async () => {
        try {
          this.app.secretStorage.setSecret(id, "");
          if (this.selectedId === id) this.selectedId = null;
          this.renderList();
          new Notice(t("settings.modelLinks.modal.secretPicker.deleted"));
        } catch (e) {
          new Notice(String(e));
        }
      });
    }
  }

  /** 在搜索框与列表之间展开/收起内联添加表单。 */
  private showAddSecret(): void {
    // 已展开则忽略（或可改为切换）
    if (this.addFormEl.children.length > 0) return;

    this.addFormEl.empty();
    this.addFormEl.addClass("ana-add-form-visible");
    this.addFormEl.removeClass("ana-add-form-hidden");

    let nameVal = "";
    let secretVal = "";
    const nameInput = this.addFormEl.createEl("input", {
      type: "text",
      cls: "ana-secret-picker-add-input",
    });
    nameInput.placeholder = t(
      "settings.modelLinks.modal.secretPicker.addNamePlaceholder"
    );
    nameInput.addEventListener("input", () => {
      nameVal = nameInput.value.trim().toLowerCase();
    });

    const valueInput = this.addFormEl.createEl("input", {
      type: "password",
      cls: "ana-secret-picker-add-input",
    });
    valueInput.placeholder =
      t("settings.modelLinks.modal.secretPicker.addValue");
    valueInput.addEventListener("input", () => {
      secretVal = valueInput.value.trim();
    });

    // 右侧按钮：添加 + 取消
    const btnRow = this.addFormEl.createEl("div", {
      cls: "ana-secret-picker-add-btn-row",
    });

    const confirmBtn = btnRow.createEl("button", {
      cls: "ana-secret-picker-add-confirm",
      text: t("settings.modelLinks.modal.secretPicker.confirm"),
    });
    confirmBtn.disabled = true;
    // 实时启用/禁用
    const checkValid = () => {
      confirmBtn.disabled = !nameVal || !secretVal;
    };
    nameInput.addEventListener("input", checkValid);
    valueInput.addEventListener("input", checkValid);

    confirmBtn.addEventListener("click", async () => {
      if (!nameVal || !secretVal) return;
      try {
        this.app.secretStorage.setSecret(nameVal, secretVal);
        this.selectedId = nameVal;
        this.hideAddForm();
        this.renderList();
        // 启用保存按钮
        if (this.saveBtnEl) this.saveBtnEl.disabled = false;
        new Notice(t("settings.modelLinks.modal.secretPicker.added"));
      } catch (e) {
        new Notice(String(e));
      }
    });

    const cancelBtn = btnRow.createEl("button", {
      cls: "ana-secret-picker-add-cancel",
      text: t("modal.cancel"),
    });
    cancelBtn.addEventListener("click", () => this.hideAddForm());

    // 聚焦名称输入框
    setTimeout(() => nameInput.focus(), 50);
  }

  /** 收起内联添加表单。 */
  private hideAddForm(): void {
    this.addFormEl.empty();
    this.addFormEl.addClass("ana-add-form-hidden");
    this.addFormEl.removeClass("ana-add-form-visible");
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

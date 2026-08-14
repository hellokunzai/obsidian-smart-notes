import {
  App,
  Modal,
  Setting,
  TextComponent,
  ButtonComponent,
  Notice,
} from "obsidian";
import type AiNoteAgentPlugin from "./main";
import type { RoleInfo } from "./settings";
import { genId } from "./settings";
import { t } from "./i18n";

/**
 * 添加 / 编辑单条角色信息的弹窗。
 * 字段：角色名称（必填且唯一）、角色提示词（多行文本框）。
 * 新增 / 编辑两用：传 null 表示新增，传 RoleInfo 表示编辑。
 */
export class RoleInfoModal extends Modal {
  private name = "";
  private prompt = "";

  constructor(
    app: App,
    private plugin: AiNoteAgentPlugin,
    private editing: RoleInfo | null,
    private onSaved: () => void
  ) {
    super(app);
    if (editing) {
      this.name = editing.name;
      this.prompt = editing.prompt;
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ana-role-modal");

    contentEl.createEl("h2", {
      text: this.editing
        ? t("settings.roles.modal.editTitle")
        : t("settings.roles.modal.addTitle"),
    });

    // 角色名称（必填、唯一）
    new Setting(contentEl)
      .setName(t("settings.roles.modal.name"))
      .setDesc(t("settings.roles.modal.nameDesc"))
      .addText((tc: TextComponent) => {
        tc.setPlaceholder(t("settings.roles.modal.namePlaceholder"));
        tc.setValue(this.name);
        tc.onChange((v) => {
          this.name = v;
        });
      });

    // 角色提示词（多行）
    new Setting(contentEl)
      .setName(t("settings.roles.modal.prompt"))
      .setDesc(t("settings.roles.modal.promptDesc"))
      .addTextArea((ta) => {
        ta.setPlaceholder(t("settings.roles.modal.promptPlaceholder"));
        ta.setValue(this.prompt);
        ta.inputEl.rows = 6;
        ta.onChange((v) => {
          this.prompt = v;
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
          ? t("settings.roles.modal.save")
          : t("settings.roles.modal.add")
      )
      .setCta()
      .onClick(() => void this.save());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** 由当前草稿状态构造 RoleInfo（name 缺省时用占位名）。 */
  private buildRole(id: string): RoleInfo {
    return {
      id,
      name: this.name.trim() || t("settings.roles.modal.untitled"),
      prompt: this.prompt,
    };
  }

  private async save(): Promise<void> {
    const name = this.name.trim();
    if (!name) {
      new Notice(t("settings.roles.modal.nameRequired"));
      return;
    }
    const conflict = this.plugin.settings.roles.some(
      (r) => r.name === name && r.id !== this.editing?.id
    );
    if (conflict) {
      new Notice(t("settings.roles.modal.nameDuplicate"));
      return;
    }

    if (this.editing) {
      const idx = this.plugin.settings.roles.findIndex(
        (r) => r.id === this.editing!.id
      );
      if (idx >= 0) {
        this.plugin.settings.roles[idx] = this.buildRole(this.editing.id);
      }
    } else {
      const role = this.buildRole(genId());
      this.plugin.settings.roles.push(role);
      // 若还没有默认角色，自动把第一条设为默认
      if (!this.plugin.settings.defaultRoleId) {
        this.plugin.settings.defaultRoleId = role.id;
      }
    }

    await this.plugin.saveSettings();
    this.onSaved();
    this.close();
  }
}

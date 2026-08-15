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
import { renderAvatar } from "./avatar";

/**
 * 添加 / 编辑单条角色信息的弹窗。
 * 字段：头像（点击上传 / 走首字母 fallback）、角色名称（必填且唯一）、角色提示词（多行文本框）。
 * 新增 / 编辑两用：传 null 表示新增，传 RoleInfo 表示编辑。
 */
export class RoleInfoModal extends Modal {
  private name = "";
  private prompt = "";
  private avatar: string | undefined = undefined;

  // 头像编辑区 DOM 引用
  private avatarTriggerEl!: HTMLElement;
  private fileInput!: HTMLInputElement;

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
      this.avatar = editing.avatar;
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

    // ===== 头像编辑区：点击上传 =====
    this.renderAvatarEditor(contentEl);

    // 角色名称（必填、唯一）
    new Setting(contentEl)
      .setName(t("settings.roles.modal.name"))
      .setDesc(t("settings.roles.modal.nameDesc"))
      .addText((tc: TextComponent) => {
        tc.setPlaceholder(t("settings.roles.modal.namePlaceholder"));
        tc.setValue(this.name);
        tc.onChange((v) => {
          this.name = v;
          // 名字变化会影响首字母 fallback 色块，实时刷新预览
          this.refreshAvatar();
        });
      });

    // 角色提示词（多行）
    new Setting(contentEl)
      .setName(t("settings.roles.modal.prompt"))
      .setDesc(t("settings.roles.modal.promptDesc"))
      .setClass("ana-setting-textarea-full")
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
      avatar: this.avatar,
    };
  }

  /**
   * 渲染头像编辑区：单一大圆形头像（可点击 / 键盘触发上传）。
   * - 未上传时显示首字母 fallback（与列表/对话框一致）
   * - 已上传时显示上传图片
   * - 悬停时通过 ::after 叠加"上传"提示
   */
  private renderAvatarEditor(parent: HTMLElement): void {
    const block = parent.createDiv({ cls: "ana-role-avatar-block" });

    this.avatarTriggerEl = block.createDiv({
      cls: "ana-role-avatar-upload",
    });
    this.avatarTriggerEl.setAttribute("role", "button");
    this.avatarTriggerEl.setAttribute("tabindex", "0");
    this.avatarTriggerEl.setAttribute(
      "aria-label",
      t("settings.roles.modal.avatar.uploadAria")
    );
    this.refreshAvatar();

    const triggerUpload = () => this.fileInput.click();
    this.avatarTriggerEl.addEventListener("click", triggerUpload);
    this.avatarTriggerEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        triggerUpload();
      }
    });

    // 隐藏的 <input type="file"> 负责真实文件选择
    this.fileInput = block.createEl("input", {
      cls: "ana-role-avatar-file-input",
      attr: { type: "file", accept: "image/*" },
    }) as HTMLInputElement;
    this.fileInput.addEventListener("change", () => this.onFileChosen());

    // 说明文字
    block.createEl("p", {
      cls: "ana-role-avatar-hint",
      text: t("settings.roles.modal.avatar.hint"),
    });
  }

  /** 用当前 name + avatar 重新渲染头像大圆。 */
  private refreshAvatar(): void {
    renderAvatar(
      this.app,
      this.avatarTriggerEl,
      { name: this.name || "?", avatar: this.avatar },
      64
    );
  }

  /** 用户选完文件：读为 base64 存入 avatar 并重绘。 */
  private onFileChosen(): void {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl === "string" && dataUrl.startsWith("data:image")) {
        this.avatar = dataUrl;
        this.refreshAvatar();
      } else {
        new Notice(t("settings.roles.modal.avatar.invalid"));
      }
      this.fileInput.value = "";
    };
    reader.onerror = () => {
      new Notice(t("settings.roles.modal.avatar.readError"));
      this.fileInput.value = "";
    };
    reader.readAsDataURL(file);
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
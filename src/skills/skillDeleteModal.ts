import { App, Modal } from "obsidian";
import { t } from "../i18n";
import type { SkillTarget } from "./skills";

/**
 * 「删除 Skill」二次确认框。
 *
 * 为什么不用 `window.confirm`：它无法展示**要删的确切路径**，而这个路径正是
 * 用户判断「删的是哪一个套件」的唯一依据——套件名可能重名，删除又是把整个
 * 文件夹移入回收站、不可撤销。
 *
 * 结果通过回调回报而非返回 Promise：调用方在回调里 resolve 自己造的 Promise，
 * Modal 不持有 resolve，因此无论用户点按钮、按 Esc 还是点遮罩关闭，结果都会
 * 恰好回报一次（见 `finish()` 的去重）。
 */
export class SkillDeleteConfirmModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private target: SkillTarget,
    private onResult: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", {
      text: t("settings.defaultSkills.deleteConfirm.title"),
    });
    contentEl.createEl("p", {
      text: this.target.isFolder
        ? t("settings.defaultSkills.deleteConfirm.descFolder")
        : t("settings.defaultSkills.deleteConfirm.descFile"),
    });
    // 显示确切路径：套件名可能重名，路径是用户唯一能确认删对了的依据
    contentEl.createDiv({
      cls: "ana-skill-delete-path",
      text: this.target.path,
    });

    const actions = contentEl.createDiv({ cls: "ana-skill-delete-actions" });
    const cancel = actions.createEl("button", {
      text: t("settings.defaultSkills.deleteConfirm.cancel"),
    });
    cancel.addEventListener("click", () => {
      this.finish(false);
      this.close();
    });
    const confirm = actions.createEl("button", {
      cls: "mod-warning",
      text: t("settings.defaultSkills.deleteConfirm.confirm"),
    });
    confirm.addEventListener("click", () => {
      this.finish(true);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    // 按 Esc / 点遮罩关闭 = 取消；若已通过按钮回报过，这里会被去重掉
    this.finish(false);
  }

  /** 只回报一次结果，避免「点删除 → onClose 又回报一次取消」把结果覆盖掉。 */
  private finish(confirmed: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.onResult(confirmed);
  }
}

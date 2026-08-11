import { Modal, App } from "obsidian";
import { t } from "../i18n";

export class OptimizeModal extends Modal {
  private applied = false;

  constructor(
    app: App,
    private original: string,
    private optimized: string,
    private onApply: (text: string) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t("modal.title") });

    const container = contentEl.createDiv({ cls: "ana-optimize-container" });
    const row = container.createDiv({ cls: "ana-optimize-row" });

    const colO = row.createDiv({ cls: "ana-optimize-col" });
    colO.createEl("h4", { text: t("modal.original") });
    const taO = colO.createEl("textarea", { cls: "ana-optimize-textarea" });
    taO.value = this.original;
    taO.disabled = true;

    const colN = row.createDiv({ cls: "ana-optimize-col" });
    colN.createEl("h4", { text: t("modal.optimized") });
    const taN = colN.createEl("textarea", { cls: "ana-optimize-textarea" });
    taN.value = this.optimized;

    const actions = container.createDiv({ cls: "ana-optimize-actions" });
    const cancel = actions.createEl("button", { text: t("modal.cancel") });
    cancel.addEventListener("click", () => this.close());
    const apply = actions.createEl("button", {
      text: t("modal.apply"),
      cls: "mod-cta",
    });
    apply.addEventListener("click", () => {
      this.applied = true;
      this.onApply(taN.value);
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

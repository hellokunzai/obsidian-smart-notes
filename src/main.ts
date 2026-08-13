import { Plugin, Notice, TFile, WorkspaceLeaf, addIcon } from "obsidian";
import {
  DEFAULT_SETTINGS,
  AiNoteAgentSettingTab,
  type AiNoteAgentSettings,
} from "./settings";
import { createProvider, type AIProvider } from "./ai/provider";
import { optimizeNote } from "./optimize/optimizer";
import { OptimizeModal } from "./optimize/previewModal";
import {
  createRealtimeExtension,
  autopromptAtCursor,
} from "./editor/autoprompt";
import { initI18n, t } from "./i18n";
import { CHAT_VIEW_TYPE, ChatView } from "./view/chatView";
import { ensureAiFolder, migrateAiFolder } from "./utils/aiFolder";
import { rebuildProfileMemory } from "./memory/profileMemory";

const ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3"/></svg>`;

export default class AiNoteAgentPlugin extends Plugin {
  settings: AiNoteAgentSettings;
  private provider!: AIProvider;
  private memoryRebuildTimeout?: number;
  /** 上一次保存的 AI 数据目录名，用于检测用户是否修改了数据存储路径。 */
  private lastAiFolderName: string = DEFAULT_SETTINGS.aiFolderName;

  async onload() {
    await this.loadSettings();
    this.provider = createProvider(this.settings);
    initI18n(this.app);

    addIcon("vault-mind", ICON_SVG);

    // 自动在 vault 根目录生成 AI 数据文件夹（记忆 + skills）
    void ensureAiFolder(this);

    // 后台静默整理长期画像记忆：读取全部会话历史，生成/更新 memory/MEMORY.md 与 memory/yyyy-mm-dd.md
    this.memoryRebuildTimeout = window.setTimeout(
      () => void rebuildProfileMemory(this),
      3000
    );

    this.addSettingTab(new AiNoteAgentSettingTab(this.app, this));

    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));

    // Realtime inline autoprompt editor extension
    this.registerEditorExtension(createRealtimeExtension(this));

    this.addRibbonIcon("vault-mind", t("plugin.name"), () => {
      void this.openChatView();
    });

    this.addCommand({
      id: "optimize-current",
      name: t("cmd.optimizeCurrent"),
      editorCallback: async (editor, ctx) => {
        const file = ctx.file;
        if (!(file instanceof TFile)) {
          new Notice(t("notice.openNoteFirst"));
          return;
        }
        await this.optimizeCommand(file);
      },
    });

    this.addCommand({
      id: "autoprompt",
      name: t("cmd.autoprompt"),
      editorCallback: async (editor, ctx) => {
        await this.runWithNotice(t("notice.thinking"), () =>
          autopromptAtCursor(this, editor)
        );
      },
    });

    this.addCommand({
      id: "open-chat",
      name: t("cmd.openChat"),
      callback: async () => {
        await this.openChatView();
      },
    });
  }

  private async openChatView(): Promise<void> {
    const { workspace } = this.app;

    // If the view already exists in the workspace, reveal it.
    const existing = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (existing.length > 0) {
      const leaf = existing[0];
      await workspace.revealLeaf(leaf);
      return;
    }

    // Otherwise create a new leaf on the right sidebar.
    const rightLeaf = workspace.getRightLeaf(false);
    if (!rightLeaf) {
      new Notice(t("view.openFailed"));
      return;
    }
    await rightLeaf.setViewState({
      type: CHAT_VIEW_TYPE,
      active: true,
    });
    await workspace.revealLeaf(rightLeaf);
  }

  onunload() {
    // registerEditorExtension / addCommand resources are cleaned up automatically
    if (this.memoryRebuildTimeout) {
      window.clearTimeout(this.memoryRebuildTimeout);
    }
  }

  getProvider(): AIProvider {
    return this.provider;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.lastAiFolderName = this.settings.aiFolderName;
  }

  async saveSettings() {
    const oldFolder = this.lastAiFolderName;
    await this.saveData(this.settings);

    // 若用户修改了数据存储路径，自动迁移旧目录下的 skills/memory/sessions
    if (this.settings.aiFolderName !== oldFolder) {
      try {
        await migrateAiFolder(this, oldFolder, this.settings.aiFolderName);
        this.lastAiFolderName = this.settings.aiFolderName;
        new Notice(t("notice.aiFolderMigrated", { path: this.settings.aiFolderName }));
      } catch (e) {
        console.error("Failed to migrate AI folder:", e);
        new Notice(
          t("notice.aiFolderMigrateFailed", {
            error: (e as Error).message,
          })
        );
      }
    }

    this.provider = createProvider(this.settings);
  }

  private async runWithNotice(msg: string, fn: () => Promise<void>) {
    const notice = new Notice(msg, 0);
    try {
      await fn();
      notice.hide();
      new Notice(t("notice.done"));
    } catch (e) {
      notice.hide();
      new Notice(t("notice.error", { error: (e as Error).message }));
    }
  }

  private async optimizeCommand(file: TFile) {
    const notice = new Notice(t("notice.optimizing"), 0);
    try {
      const content = await this.app.vault.read(file);
      const optimized = await optimizeNote(this, content);
      notice.hide();
      new OptimizeModal(this.app, content, optimized, async (text) => {
        await this.app.vault.modify(file, text);
        new Notice(t("notice.noteUpdated"));
      }).open();
    } catch (e) {
      notice.hide();
      new Notice(t("notice.error", { error: (e as Error).message }));
    }
  }
}

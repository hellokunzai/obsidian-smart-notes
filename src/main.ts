import { Plugin, Notice, TFile, WorkspaceLeaf, MarkdownView, addIcon } from "obsidian";
import {
  DEFAULT_SETTINGS,
  AiNoteAgentSettingTab,
  type AiNoteAgentSettings,
} from "./settings";
import {
  createProvider,
  type AIProvider,
  type ChatMessage,
} from "./ai/provider";
import { optimizeNote } from "./optimize/optimizer";
import { OptimizeModal } from "./optimize/previewModal";
import {
  createRealtimeExtension,
  autopromptAtCursor,
} from "./editor/autoprompt";
import { initI18n, t } from "./i18n";
import { CHAT_VIEW_TYPE, ChatView } from "./view/chatView";
import { ensureAiFolder } from "./utils/aiFolder";
import { rebuildProfileMemory } from "./memory/profileMemory";

const ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3"/></svg>`;

export default class AiNoteAgentPlugin extends Plugin {
  settings: AiNoteAgentSettings;
  private provider!: AIProvider;
  private memoryRebuildTimeout?: number;

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
      checkCallback: (checking) => {
        if (!this.settings.optimizeCurrentEnabled) return false;
        const active = this.app.workspace.getActiveFile();
        if (!active || active.extension !== "md") return false;
        if (!checking) {
          void this.runWithNotice(t("notice.optimizing"), () =>
            this.optimizeCommand(active)
          );
        }
        return true;
      },
    });

    this.addCommand({
      id: "autoprompt",
      name: t("cmd.autoprompt"),
      checkCallback: (checking) => {
        if (!this.settings.realtimeEnabled) return false;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !view.editor) return false;
        if (!checking) {
          const editor = view.editor;
          void this.runWithNotice(t("notice.thinking"), () =>
            autopromptAtCursor(this, editor)
          );
        }
        return true;
      },
    });

    this.addCommand({
      id: "open-chat",
      name: t("cmd.openChat"),
      checkCallback: (checking) => {
        if (!this.settings.chatPanelEnabled) return false;
        if (!checking) {
          const active = this.app.workspace.getActiveFile();
          void this.openChatView(
            active instanceof TFile ? active : undefined
          );
        }
        return true;
      },
    });

    this.addCommand({
      id: "generate-frontmatter",
      name: t("cmd.generateFrontmatter"),
      checkCallback: (checking) => {
        const active = this.app.workspace.getActiveFile();
        if (!active || active.extension !== "md") return false;
        if (!this.settings.frontmatterGenerationEnabled) return false;
        if (!checking) {
          void this.runWithNotice(t("notice.generatingFrontmatter"), () =>
            this.generateFrontmatterCommand(active)
          );
        }
        return true;
      },
    });
  }

  private async openChatView(file?: TFile): Promise<void> {
    const { workspace } = this.app;

    // If the view already exists in the workspace, reveal it.
    const existing = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (existing.length > 0) {
      const leaf = existing[0];
      await workspace.revealLeaf(leaf);
      if (file && this.settings.addCurrentNoteToChat) {
        const view = leaf.view;
        if (view instanceof ChatView) {
          await view.attachCurrentNote(file);
        }
      }
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
    if (file && this.settings.addCurrentNoteToChat) {
      const view = rightLeaf.view;
      if (view instanceof ChatView) {
        await view.attachCurrentNote(file);
      }
    }
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
  }

  async saveSettings() {
    await this.saveData(this.settings);
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
      const optimized = await optimizeNote(
        this,
        content,
        this.settings.linkFormat
      );
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

  private async generateFrontmatterCommand(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const body = content.replace(
      /^---\s*[\r\n]+[\s\S]*?[\r\n]+---\s*[\r\n]*/,
      ""
    );

    const systemPrompt =
      this.settings.frontmatterTemplate.trim() || t("frontmatter.systemPrompt");
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: body },
    ];

    const response = await this.provider.complete(messages, {
      maxTokens: this.settings.maxTokens,
      temperature: this.settings.temperature,
    });

    let yaml = response.trim();
    if (yaml.startsWith("```")) {
      yaml = yaml.replace(/^```[^\n]*\n?/, "").replace(/\n?```\s*$/, "");
      yaml = yaml.trim();
    }
    const hasDelimiters = yaml.startsWith("---") && yaml.includes("\n---");
    const yamlBlock = hasDelimiters ? yaml : `---\n${yaml}\n---`;

    await this.app.vault.modify(file, `${yamlBlock}\n${body}`);
  }
}

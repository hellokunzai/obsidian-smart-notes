import {
  Plugin,
  Notice,
  TFile,
  WorkspaceLeaf,
  MarkdownView,
  addIcon,
  Events,
} from "obsidian";
import {
  DEFAULT_SETTINGS,
  AiNoteAgentSettingTab,
  type AiNoteAgentSettings,
} from "./settings";
import {
  createProvider,
  getActiveModelLink,
  resolveLinkParams,
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
import { migrateSettings } from "./migrate";

/**
 * 斜杠命令触发文本清理。两处用途语义不同，故保留为两个具名常量集中管理：
 *  - SLASH_TRIGGER_LINE：匹配「行首以斜杠命令起始」的整行（可能带参数/正文），
 *    用于编辑器内定位并删除残留触发文本（如 /sm）。
 *  - SLASH_TRIGGER_STANDALONE：匹配「整行仅为一个斜杠命令、无参数无正文」的行，
 *    用于从请求正文兜底清除，避免被送入 AI。
 */
const SLASH_TRIGGER_LINE = /^(\s*\/[a-zA-Z0-9\u4e00-\u9fff]+.*)$/;
const SLASH_TRIGGER_STANDALONE = /^[ \t]*\/[a-zA-Z0-9\u4e00-\u9fff]+[ \t]*$/gm;

const ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3"/></svg>`;

export default class AiNoteAgentPlugin extends Plugin {
  settings: AiNoteAgentSettings;
  /** 设置变更事件总线（用于通知已打开的视图刷新 UI）。 */
  settingsEvents = new Events();
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
    // loadData() returns null when data.json doesn't exist (first install)
    const loaded = ((await this.loadData()) as Record<string, any>) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
    // 迁移旧版扁平字段 → modelLinks / roles，并做 defaultId 兜底
    migrateSettings(loaded, this.settings);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.provider = createProvider(this.settings);
    // 通知已打开的视图（如对话面板）刷新依赖设置的 UI
    this.settingsEvents.trigger("settings-changed");
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
        this.settings.linkFormat,
        this.settings.linkType
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
    // 优先使用编辑器实时内容：vault.read 读的是磁盘文件，可能尚未落盘、
    // 仍包含用户用于唤醒命令的斜杠触发文本（如 /sm），会被误送进 AI。
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    let content = editor
      ? editor.getValue()
      : await this.app.vault.read(file);

    // 若编辑器里仍残留斜杠命令触发文本（如 /sm），从编辑器中删除，避免用户可见残留
    if (editor) {
      const pos = editor.getCursor();
      const lineContent = editor.getLine(pos.line);
      // 匹配行首斜杠命令：/ 后跟字母/数字/汉字（Obsidian slash command 触发模式）
      const match = lineContent.match(SLASH_TRIGGER_LINE);
      if (match) {
        editor.replaceRange(
          "",
          { line: pos.line, ch: 0 },
          { line: pos.line, ch: lineContent.length }
        );
        // 编辑器已删除触发文本，刷新 content
        content = editor.getValue();
      }
    }

    // 兜底：清除正文中任何残留的斜杠命令触发（如 /sm），确保不会被送入 AI
    content = content.replace(SLASH_TRIGGER_STANDALONE, "");

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

    const activeLink = getActiveModelLink(this.settings);
    const params = resolveLinkParams(activeLink, this.settings);
    const response = await this.provider.complete(messages, {
      maxTokens: params.maxTokens,
      temperature: params.temperature,
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

import {
  ItemView,
  WorkspaceLeaf,
  TFile,
  MarkdownView,
  Notice,
} from "obsidian";
import type AiNoteAgentPlugin from "../main";
import { t } from "../i18n";
import { ChatMessage } from "../ai/provider";
import { buildSystemPrompt } from "../ai/prompt";
import { loadMemory, saveMemory, clearMemory } from "../utils/aiFolder";

export const CHAT_VIEW_TYPE = "ai-note-agent-chat";

/** 对话历史消息：仅 user / assistant（system 每次动态构造，不持久化）。 */
type ConversationMessage = { role: "user" | "assistant"; content: string };

export class ChatView extends ItemView {
  private plugin: AiNoteAgentPlugin;
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private isStreaming = false;
  // 对话历史（仅 user/assistant，不含 system），用于多轮上下文与持久化
  private conversationHistory: ConversationMessage[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: AiNoteAgentPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t("view.title");
  }

  getIcon(): string {
    return "ai-note-agent";
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("ana-chat-view");

    const header = container.createEl("div", { cls: "ana-chat-header" });
    header.createEl("span", { text: t("view.title"), cls: "ana-chat-title" });

    const clearBtn = header.createEl("button", {
      cls: "ana-chat-header-btn",
    });
    clearBtn.setText(t("view.clear"));
    clearBtn.addEventListener("click", () => {
      void this.clearMessages();
    });

    this.messagesEl = container.createEl("div", {
      cls: "ana-chat-messages",
    });

    // 加载持久化记忆（vault 中的 AI 文件夹）
    if (this.plugin.settings.enableMemory) {
      try {
        this.conversationHistory = (await loadMemory(this.plugin)) as ConversationMessage[];
      } catch {
        this.conversationHistory = [];
      }
    } else {
      this.conversationHistory = [];
    }

    if (this.conversationHistory.length > 0) {
      for (const m of this.conversationHistory) {
        this.addMessage(m.role, m.content);
      }
      new Notice(
        t("view.memoryLoaded", { count: this.conversationHistory.length })
      );
    } else {
      this.addAssistantMessage(t("view.welcome"));
    }

    const footer = container.createEl("div", { cls: "ana-chat-footer" });

    this.inputEl = footer.createEl("textarea", {
      cls: "ana-chat-input",
      attr: { placeholder: t("view.placeholder"), rows: "2" },
    });

    this.inputEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && !evt.shiftKey) {
        evt.preventDefault();
        void this.handleSend();
      }
    });

    this.sendBtn = footer.createEl("button", {
      cls: "ana-chat-send mod-cta",
    });
    this.sendBtn.setText(t("view.send"));
    this.sendBtn.addEventListener("click", () => {
      void this.handleSend();
    });
  }

  async onClose(): Promise<void> {
    // 视图关闭时保留内存中的历史，记忆已随每次回复落盘
  }

  private async clearMessages(): Promise<void> {
    this.conversationHistory = [];
    if (this.plugin.settings.enableMemory) {
      try {
        await clearMemory(this.plugin);
      } catch {
        // 忽略清空失败
      }
    }
    this.messagesEl.empty();
    this.addAssistantMessage(t("view.welcome"));
  }

  private addMessage(role: "user" | "assistant", text: string): HTMLElement {
    const row = this.messagesEl.createEl("div", {
      cls: `ana-chat-message ana-chat-message-${role}`,
    });
    const bubble = row.createEl("div", { cls: "ana-chat-bubble" });
    const content = bubble.createEl("div", { cls: "ana-chat-text" });
    content.setText(text);
    this.scrollToBottom();
    return content;
  }

  private addUserMessage(text: string): void {
    this.addMessage("user", text);
  }

  private addAssistantMessage(text: string): HTMLElement {
    return this.addMessage("assistant", text);
  }

  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private async handleSend(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text || this.isStreaming) return;

    this.inputEl.value = "";
    this.addUserMessage(text);
    // 记录用户消息到历史（纯文本，不含动态笔记上下文）
    this.conversationHistory.push({ role: "user", content: text });

    const system = this.buildSystem();
    const noteContext = await this.getNoteContext();
    // 当前轮次 user 消息：附加活动笔记上下文（不写入持久化历史）
    const currentUser: ChatMessage = {
      role: "user",
      content: noteContext ? `${text}\n\n${noteContext}` : text,
    };

    // 历史去掉刚加入的当前 user，附加上带笔记上下文的当前 user
    const historyForApi = this.recentHistory().slice(0, -1);
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...historyForApi,
      currentUser,
    ];

    const assistantContentEl = this.addAssistantMessage("");
    this.isStreaming = true;
    this.setInputDisabled(true);

    try {
      const provider = this.plugin.getProvider();
      const reply = await provider.complete(messages, {
        maxTokens: this.plugin.settings.maxTokens,
        temperature: this.plugin.settings.temperature,
      });
      assistantContentEl.setText(reply);
      this.conversationHistory.push({ role: "assistant", content: reply });
      await this.persistHistory();
    } catch (e) {
      assistantContentEl.setText(
        t("view.error", { error: (e as Error).message })
      );
      // 出错时回滚刚加入的用户消息，避免污染历史
      this.conversationHistory.pop();
    } finally {
      this.isStreaming = false;
      this.setInputDisabled(false);
      this.scrollToBottom();
    }
  }

  private setInputDisabled(disabled: boolean): void {
    this.inputEl.disabled = disabled;
    this.sendBtn.disabled = disabled;
    this.sendBtn.setText(disabled ? t("view.thinking") : t("view.send"));
  }

  /** 最近 maxMemoryMessages 条历史（滑动窗口），用于对话上下文与持久化。 */
  private recentHistory(): ChatMessage[] {
    const limit = this.plugin.settings.maxMemoryMessages;
    const hist = this.conversationHistory;
    return hist.slice(Math.max(0, hist.length - limit));
  }

  private async persistHistory(): Promise<void> {
    if (!this.plugin.settings.enableMemory) return;
    try {
      await saveMemory(this.plugin, this.recentHistory());
    } catch {
      // 记忆写入失败不应影响对话
    }
  }

  /** 构造 system prompt：基础助手提示 + 用户自定义指令。 */
  private buildSystem(): string {
    const base =
      "You are an AI assistant embedded in Obsidian. Help the user with their notes and questions. Keep answers concise and actionable unless asked otherwise.";
    return buildSystemPrompt(this.plugin.settings.customInstructions, base);
  }

  /** 读取当前活动笔记内容，作为当前轮次的可选上下文。 */
  private async getNoteContext(): Promise<string> {
    const activeFile = this.getActiveNote();
    if (!activeFile) return "";
    try {
      const content = await this.plugin.app.vault.cachedRead(activeFile);
      return `--- Active note context ---\nTitle: ${activeFile.basename}\nPath: ${activeFile.path}\n${content.slice(0, 4000)}`;
    } catch {
      return "";
    }
  }

  private getActiveNote(): TFile | null {
    const leaf = this.plugin.app.workspace.getMostRecentLeaf();
    if (!leaf) return null;
    const view = leaf.view;
    if (view instanceof MarkdownView) {
      return view.file ?? null;
    }
    const file = this.plugin.app.workspace.getActiveFile();
    return file instanceof TFile ? file : null;
  }
}

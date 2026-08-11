import {
  ItemView,
  WorkspaceLeaf,
  TFile,
  MarkdownView,
  Notice,
} from "obsidian";
import type AiNoteAgentPlugin from "../main";
import { t } from "../i18n";

export const CHAT_VIEW_TYPE = "ai-note-agent-chat";

export class ChatView extends ItemView {
  private plugin: AiNoteAgentPlugin;
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private isStreaming = false;

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
    clearBtn.addEventListener("click", () => this.clearMessages());

    this.messagesEl = container.createEl("div", {
      cls: "ana-chat-messages",
    });

    this.addAssistantMessage(t("view.welcome"));

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
    // nothing to clean up manually
  }

  private clearMessages(): void {
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

    const context = await this.buildContext();
    const assistantContentEl = this.addAssistantMessage("");
    this.isStreaming = true;
    this.setInputDisabled(true);

    try {
      const provider = this.plugin.getProvider();
      const reply = await provider.complete(
        [
          {
            role: "system",
            content: context.system,
          },
          { role: "user", content: context.user },
        ],
        {
          maxTokens: this.plugin.settings.maxTokens,
          temperature: this.plugin.settings.temperature,
        }
      );
      assistantContentEl.setText(reply);
    } catch (e) {
      assistantContentEl.setText(
        t("view.error", { error: (e as Error).message })
      );
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

  private async buildContext(): Promise<{ system: string; user: string }> {
    const activeFile = this.getActiveNote();
    let noteContext = "";
    if (activeFile) {
      try {
        const content = await this.plugin.app.vault.cachedRead(activeFile);
        noteContext = `\n\n--- Active note context ---\nTitle: ${activeFile.basename}\nPath: ${activeFile.path}\n${content.slice(0, 4000)}`;
      } catch {
        // ignore read errors
      }
    }

    const system = `You are an AI assistant embedded in Obsidian. Help the user with their notes and questions. Keep answers concise and actionable unless asked otherwise.${noteContext ? " The user has an active note; its content is provided below." : ""}`;
    return { system, user: noteContext };
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

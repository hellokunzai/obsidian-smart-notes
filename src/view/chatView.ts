import {
  ItemView,
  WorkspaceLeaf,
  TFile,
  TFolder,
  Notice,
  Modal,
  Setting,
  ButtonComponent,
} from "obsidian";
import type AiNoteAgentPlugin from "../main";
import { t } from "../i18n";
import { ChatMessage } from "../ai/provider";
import { buildSystemPrompt } from "../ai/prompt";
import {
  loadSessions,
  saveSessions,
  createSession,
  type Session,
  type AttachmentRef,
} from "../utils/aiFolder";
import { buildKnowledgeIndex, buildAttachmentContext } from "../context/knowledge";

export const CHAT_VIEW_TYPE = "ai-note-agent-chat";

export class ChatView extends ItemView {
  private plugin: AiNoteAgentPlugin;

  // 多会话状态
  private sessions: Session[] = [];
  private activeId: string | null = null;

  // DOM 引用
  private sidebarEl!: HTMLElement;
  private sessionListEl!: HTMLElement;
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private attachmentsEl!: HTMLElement;

  private isStreaming = false;
  private sidebarCollapsed = false;

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

  /** 当前会话（可能为 undefined，当无任何会话时由 ensureActiveSession 兜底创建）。 */
  private get activeSession(): Session | undefined {
    return this.sessions.find((s) => s.id === this.activeId);
  }

  async onOpen(): Promise<void> {
    const data = await loadSessions(this.plugin);
    this.sessions = data.sessions;
    this.activeId = data.activeSessionId;

    // 兼容：没有任何会话时创建一个空白会话
    if (this.sessions.length === 0) {
      const s = createSession(t("view.defaultTitle"));
      this.sessions.push(s);
      this.activeId = s.id;
    } else if (!this.activeSession) {
      this.activeId = this.sessions[0].id;
    }

    this.renderLayout();

    if (this.plugin.settings.enableMemory && this.sessions.length > 0) {
      new Notice(t("view.sessionsLoaded", { count: this.sessions.length }));
    }
  }

  async onClose(): Promise<void> {
    // 视图关闭时保留内存中的多会话状态，记忆已随时落盘
  }

  // ================= 布局 =================

  private renderLayout(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("ana-chat-view");

    const body = container.createEl("div", { cls: "ana-chat-body" });

    // 侧栏（会话历史）
    this.sidebarEl = body.createEl("div", { cls: "ana-chat-sidebar" });
    this.renderSidebar();

    // 右侧主区
    const main = body.createEl("div", { cls: "ana-chat-main" });

    const header = main.createEl("div", { cls: "ana-chat-header" });

    const leftGroup = header.createEl("div", { cls: "ana-chat-header-left" });
    const toggleBtn = leftGroup.createEl("button", {
      cls: "ana-chat-header-btn",
      attr: { "aria-label": t("view.toggleSidebar") },
    });
    toggleBtn.setText("≡");
    toggleBtn.addEventListener("click", () => this.toggleSidebar());

    const titleEl = leftGroup.createEl("span", {
      text: t("view.title"),
      cls: "ana-chat-title",
    });
    void titleEl;

    const rightGroup = header.createEl("div", { cls: "ana-chat-header-right" });

    const newBtn = rightGroup.createEl("button", {
      cls: "ana-chat-header-btn",
    });
    newBtn.setText(t("view.newSession"));
    newBtn.addEventListener("click", () => void this.newSession());

    const clearBtn = rightGroup.createEl("button", {
      cls: "ana-chat-header-btn",
    });
    clearBtn.setText(t("view.clearCurrent"));
    clearBtn.addEventListener("click", () => void this.clearCurrentSession());

    this.messagesEl = main.createEl("div", { cls: "ana-chat-messages" });

    // 附件栏（位于聊天框上方，可显式附加文件/文件夹）
    this.attachmentsEl = main.createEl("div", { cls: "ana-chat-attachments" });
    this.renderAttachments();

    const footer = main.createEl("div", { cls: "ana-chat-footer" });
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
    this.sendBtn.addEventListener("click", () => void this.handleSend());

    this.renderMessages();
  }

  // ================= 侧栏 =================

  private renderSidebar(): void {
    this.sidebarEl.empty();

    const head = this.sidebarEl.createEl("div", { cls: "ana-chat-sidebar-head" });
    head.createEl("span", {
      text: t("view.history"),
      cls: "ana-chat-sidebar-title",
    });
    const newBtn = head.createEl("button", {
      cls: "ana-chat-sidebar-new",
      attr: { "aria-label": t("view.newSession") },
    });
    newBtn.setText("+");
    newBtn.addEventListener("click", () => void this.newSession());

    this.sessionListEl = this.sidebarEl.createEl("div", {
      cls: "ana-chat-session-list",
    });
    this.renderSessionList();
  }

  private renderSessionList(): void {
    this.sessionListEl.empty();

    if (this.sessions.length === 0) {
      this.sessionListEl.createEl("div", {
        text: t("view.noSessions"),
        cls: "ana-chat-session-empty",
      });
      return;
    }

    // 按更新时间倒序展示
    const ordered = [...this.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const s of ordered) {
      const item = this.sessionListEl.createEl("div", {
        cls:
          "ana-chat-session-item" +
          (s.id === this.activeId ? " is-active" : ""),
      });
      item.addEventListener("click", () => void this.selectSession(s.id));

      const label = item.createEl("span", {
        text: s.title || t("view.defaultTitle"),
        cls: "ana-chat-session-label",
      });
      label.setAttribute("title", s.title || t("view.defaultTitle"));

      const actions = item.createEl("div", { cls: "ana-chat-session-actions" });

      const renameBtn = actions.createEl("button", {
        cls: "ana-chat-session-action",
        attr: { "aria-label": t("view.renameSession") },
      });
      renameBtn.setText("✎");
      renameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.renameSession(s);
      });

      const delBtn = actions.createEl("button", {
        cls: "ana-chat-session-action ana-chat-session-del",
        attr: { "aria-label": t("view.deleteSession") },
      });
      delBtn.setText("🗑");
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.confirmDeleteSession(s);
      });
    }
  }

  private toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    this.sidebarEl.toggleClass("is-collapsed", this.sidebarCollapsed);
  }

  // ================= 会话操作 =================

  private async newSession(): Promise<void> {
    const s = createSession(t("view.defaultTitle"));
    this.sessions.push(s);
    this.activeId = s.id;
    await this.persist();
    this.renderSessionList();
    this.renderMessages();
    this.renderAttachments();
    this.inputEl.focus();
  }

  private async selectSession(id: string): Promise<void> {
    if (id === this.activeId) return;
    this.activeId = id;
    await this.persist();
    this.renderSessionList();
    this.renderMessages();
    this.renderAttachments();
  }

  private renameSession(s: Session): void {
    const modal = new Modal(this.plugin.app);
    modal.titleEl.setText(t("view.renameSession"));
    let input: HTMLInputElement;
    new Setting(modal.contentEl)
      .setName(t("view.sessionTitle"))
      .addText((text) => {
        input = text.inputEl;
        text.inputEl.value = s.title;
        text.inputEl.focus();
      });
    new ButtonComponent(modal.contentEl)
      .setButtonText(t("modal.apply"))
      .setCta()
      .onClick(async () => {
        const v = (input?.value ?? "").trim() || t("view.defaultTitle");
        s.title = v;
        s.updatedAt = Date.now();
        modal.close();
        await this.persist();
        this.renderSessionList();
        if (s.id === this.activeId) this.renderMessages();
      });
    modal.open();
  }

  private confirmDeleteSession(s: Session): void {
    const modal = new Modal(this.plugin.app);
    modal.titleEl.setText(t("view.deleteSession"));
    modal.contentEl.createEl("p", { text: t("view.confirmDelete", { title: s.title }) });

    const btns = modal.contentEl.createEl("div", { cls: "ana-chat-modal-actions" });
    new ButtonComponent(btns)
      .setButtonText(t("modal.cancel"))
      .onClick(() => modal.close());
    new ButtonComponent(btns)
      .setButtonText(t("view.deleteSession"))
      .setWarning()
      .onClick(async () => {
        modal.close();
        this.sessions = this.sessions.filter((x) => x.id !== s.id);
        if (this.activeId === s.id) {
          const next = this.sessions[0];
          if (next) {
            this.activeId = next.id;
          } else {
            const fresh = createSession(t("view.defaultTitle"));
            this.sessions.push(fresh);
            this.activeId = fresh.id;
          }
        }
        await this.persist();
        this.renderSessionList();
        this.renderMessages();
        this.renderAttachments();
      });
    modal.open();
  }

  private async clearCurrentSession(): Promise<void> {
    const s = this.activeSession;
    if (!s) return;
    s.messages = [];
    s.attachments = [];
    s.title = t("view.defaultTitle");
    s.updatedAt = Date.now();
    await this.persist();
    this.renderMessages();
    this.renderSessionList();
    this.renderAttachments();
  }

  // ================= 附件栏 =================

  /** 渲染附件栏：chips 展示当前会话附加的文件/文件夹 + 添加/清空按钮。 */
  private renderAttachments(): void {
    this.attachmentsEl.empty();
    const s = this.activeSession;
    if (!s) return;

    const list = this.attachmentsEl.createEl("div", { cls: "ana-chat-attach-list" });

    for (let i = 0; i < s.attachments.length; i++) {
      const ref = s.attachments[i];
      const chip = list.createEl("div", { cls: "ana-chat-chip" });
      const icon = ref.type === "folder" ? "📁" : "📄";
      chip.createSpan({ text: `${icon} ${ref.path}`, cls: "ana-chat-chip-label" });
      const x = chip.createEl("button", {
        cls: "ana-chat-chip-x",
        attr: { "aria-label": t("view.removeAttachment") },
      });
      x.setText("×");
      x.addEventListener("click", () => void this.removeAttachment(i));
    }

    const actions = this.attachmentsEl.createEl("div", { cls: "ana-chat-attach-actions" });
    const addBtn = actions.createEl("button", { cls: "ana-chat-header-btn" });
    addBtn.setText(`+ ${t("view.addAttachment")}`);
    addBtn.addEventListener("click", () => this.openAttachmentPicker());

    if (s.attachments.length > 0) {
      const clearBtn = actions.createEl("button", { cls: "ana-chat-header-btn" });
      clearBtn.setText(t("view.clearAttachments"));
      clearBtn.addEventListener("click", () => void this.clearAttachments());
    }
  }

  private async addAttachments(refs: AttachmentRef[]): Promise<void> {
    const s = this.activeSession;
    if (!s) return;
    const existing = new Set(s.attachments.map((a) => `${a.type}:${a.path}`));
    let added = 0;
    for (const ref of refs) {
      const key = `${ref.type}:${ref.path}`;
      if (!existing.has(key)) {
        s.attachments.push(ref);
        existing.add(key);
        added++;
      }
    }
    if (added === 0) {
      new Notice(t("view.noNewAttachment"));
      return;
    }
    s.updatedAt = Date.now();
    await this.persist();
    this.renderAttachments();
  }

  private async removeAttachment(index: number): Promise<void> {
    const s = this.activeSession;
    if (!s) return;
    s.attachments.splice(index, 1);
    s.updatedAt = Date.now();
    await this.persist();
    this.renderAttachments();
  }

  private async clearAttachments(): Promise<void> {
    const s = this.activeSession;
    if (!s) return;
    s.attachments = [];
    s.updatedAt = Date.now();
    await this.persist();
    this.renderAttachments();
  }

  /** 打开附件选择器：可搜索的库内文件夹/Markdown 文件多选列表。 */
  private openAttachmentPicker(): void {
    const s = this.activeSession;
    if (!s) return;
    new AttachmentPickerModal(this.plugin.app, this.plugin, (refs) =>
      void this.addAttachments(refs)
    ).open();
  }

  // ================= 消息渲染 =================

  private renderMessages(): void {
    this.messagesEl.empty();
    const s = this.activeSession;
    if (!s || s.messages.length === 0) {
      this.addAssistantMessage(t("view.welcome"));
      return;
    }
    for (const m of s.messages) {
      this.addMessage(m.role, m.content);
    }
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

  // ================= 发送 =================

  private async handleSend(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text || this.isStreaming) return;
    let s = this.activeSession;
    if (!s) {
      await this.newSession();
      s = this.activeSession;
      if (!s) return;
    }

    this.inputEl.value = "";
    this.addUserMessage(text);
    s.messages.push({ role: "user", content: text });
    s.updatedAt = Date.now();

    const system = this.buildSystem();
    // 仅按用户显式附加的附件 + 消息中点名的文件读取内容（不自动加载任何文件）
    const noteContext = await buildAttachmentContext(
      this.plugin.app,
      s.attachments,
      text,
      this.plugin.settings.chatContextMaxChars
    );
    const currentUser: ChatMessage = {
      role: "user",
      content: noteContext ? `${text}\n\n${noteContext}` : text,
    };

    // 滑动窗口：仅取最近 maxMemoryMessages 条用于上下文（不含当前这条刚加的）
    const limit = this.plugin.settings.maxMemoryMessages;
    const tail = s.messages.slice(Math.max(0, s.messages.length - 1 - limit), -1);
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...tail,
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

      // 首条助手回复后，用首句 user 消息命名会话（仅当仍为默认标题）
      const isFirstAssistant = !s!.messages.some((m) => m.role === "assistant");
      s!.messages.push({ role: "assistant", content: reply });
      s!.updatedAt = Date.now();
      if (isFirstAssistant && (s!.title === t("view.defaultTitle") || !s!.title)) {
        const firstUser = s!.messages.find((m) => m.role === "user");
        if (firstUser) {
          s!.title =
            firstUser.content.slice(0, 30).replace(/\s+/g, " ").trim() ||
            t("view.defaultTitle");
        }
      }
      await this.persist();
      this.renderSessionList();
    } catch (e) {
      assistantContentEl.setText(t("view.error", { error: (e as Error).message }));
      // 出错时回滚刚加入的用户消息，避免污染历史
      s!.messages.pop();
      s!.updatedAt = Date.now();
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

  /** 持久化整个多会话文件（含当前激活会话 id）。 */
  private async persist(): Promise<void> {
    if (!this.plugin.settings.enableMemory) return;
    try {
      await saveSessions(this.plugin, {
        version: 2,
        activeSessionId: this.activeId,
        sessions: this.sessions,
      });
    } catch {
      // 记忆写入失败不应影响对话
    }
  }

  /** 构造 system prompt：基础助手提示 + 用户自定义指令 + 知识库路径索引（仅路径）。 */
  private buildSystem(): string {
    const base =
      "You are an AI assistant embedded in Obsidian. Help the user with their notes and questions. Keep answers concise and actionable unless asked otherwise. Note: you can see the vault's file paths via the knowledge base index, but file contents are only provided when the user explicitly attaches them or references them by name.";
    const sys = buildSystemPrompt(this.plugin.settings.customInstructions, base);
    const index = buildKnowledgeIndex(
      this.plugin.app,
      this.plugin.settings.includeVaultIndex
    );
    if (index) {
      return `${sys}\n\n${index}`;
    }
    return sys;
  }
}

/**
 * 附件选择器：展示库内所有文件夹与 Markdown 文件，支持搜索与多选。
 * 确认后将选中的 file/folder 引用回传给回调。
 */
class AttachmentPickerModal extends Modal {
  private plugin: AiNoteAgentPlugin;
  private onSubmit: (refs: AttachmentRef[]) => void;
  private selected = new Map<string, AttachmentRef>();
  private listEl!: HTMLElement;
  private searchEl!: HTMLInputElement;
  private allEntries: { type: "file" | "folder"; path: string; name: string }[] = [];

  constructor(
    app: import("obsidian").App,
    plugin: AiNoteAgentPlugin,
    onSubmit: (refs: AttachmentRef[]) => void
  ) {
    super(app);
    this.plugin = plugin;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ana-picker");
    this.titleEl.setText(t("view.picker.title"));

    contentEl.createEl("p", {
      text: t("view.picker.desc"),
      cls: "ana-picker-desc",
    });

    // 搜索框
    this.searchEl = contentEl.createEl("input", {
      cls: "ana-picker-search",
      attr: { type: "text", placeholder: t("view.picker.searchPlaceholder") },
    });
    this.searchEl.addEventListener("input", () => this.renderList());

    // 列表容器
    this.listEl = contentEl.createEl("div", { cls: "ana-picker-list" });

    // 收集所有文件夹与 Markdown 文件
    this.allEntries = [];
    for (const af of this.app.vault.getAllLoadedFiles()) {
      if (af instanceof TFolder) {
        this.allEntries.push({ type: "folder", path: af.path, name: af.name + "/" });
      } else if (af instanceof TFile && af.extension === "md") {
        this.allEntries.push({ type: "file", path: af.path, name: af.name });
      }
    }
    this.allEntries.sort((a, b) => a.path.localeCompare(b.path));

    this.renderList();

    // 操作按钮
    const btns = contentEl.createEl("div", { cls: "ana-chat-modal-actions" });
    new ButtonComponent(btns)
      .setButtonText(t("modal.cancel"))
      .onClick(() => this.close());
    new ButtonComponent(btns)
      .setButtonText(t("view.picker.confirm"))
      .setCta()
      .onClick(() => {
        const refs = Array.from(this.selected.values());
        this.close();
        this.onSubmit(refs);
      });

    this.scope.register([], "Escape", () => this.close());
  }

  private renderList(): void {
    this.listEl.empty();
    const q = this.searchEl.value.trim().toLowerCase();
    const filtered = q
      ? this.allEntries.filter((e) => e.path.toLowerCase().includes(q))
      : this.allEntries;

    if (filtered.length === 0) {
      this.listEl.createEl("div", {
        text: t("view.picker.empty"),
        cls: "ana-picker-empty",
      });
      return;
    }

    for (const e of filtered) {
      const key = `${e.type}:${e.path}`;
      const row = this.listEl.createEl("label", { cls: "ana-picker-row" });
      const cb = row.createEl("input", { attr: { type: "checkbox" } });
      cb.checked = this.selected.has(key);
      cb.addEventListener("change", () => {
        if (cb.checked) {
          this.selected.set(key, { type: e.type, path: e.path });
        } else {
          this.selected.delete(key);
        }
      });
      const icon = e.type === "folder" ? "📁" : "📄";
      row.createSpan({ text: `${icon} ${e.path}`, cls: "ana-picker-name" });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

import {
  ItemView,
  WorkspaceLeaf,
  TFile,
  TFolder,
  Notice,
  Modal,
  Setting,
  ButtonComponent,
  setIcon,
  MarkdownRenderer,
  Component,
} from "obsidian";
import type AiNoteAgentPlugin from "../main";
import { t } from "../i18n";
import { ChatMessage } from "../ai/provider";
import { buildSystemPrompt } from "../ai/prompt";
import { getActiveRolePrompt } from "../settings";
import {
  loadSessionsIndex,
  loadSessionFile,
  saveSessionsIndex,
  saveSessionFile,
  deleteSessionFile,
  sessionToMeta,
  createSession,
  type Session,
  type AttachmentRef,
  type SessionMeta,
  type SessionsIndex,
} from "../utils/aiFolder";
import { buildKnowledgeIndex, buildAttachmentContext } from "../context/knowledge";
import { buildSkillContext, listSkills, type SkillEntry } from "../skills/skills";
import { WebSearchService, type SearchProviderConfig } from "../search/search";
import { buildWebSearchContext } from "../search/prompt";
import { getProfileMemoryContext } from "../memory/profileMemory";
import {
  getActiveModelLink,
  createProviderFromLink,
  resolveLinkParams,
} from "../ai/provider";

export const CHAT_VIEW_TYPE = "ai-note-agent-chat";

/** 启动时预加载的最近会话数量；其余会话在点击时再懒加载。 */
const RECENT_SESSION_COUNT = 10;

export class ChatView extends ItemView {
  private plugin: AiNoteAgentPlugin;

  // 多会话状态
  private sessions: Session[] = [];
  private activeId: string | null = null;
  /** 已加载完整内容的会话 id（其余会话仅在内存保留索引元数据占位）。 */
  private loadedIds = new Set<string>();
  /** 每个会话的磁盘索引元数据快照（用于未加载会话的 messageCount 等）。 */
  private metaSnapshot = new Map<string, SessionMeta>();

  // DOM 引用
  private sidebarEl!: HTMLElement;
  private sessionListEl!: HTMLElement;
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private inputWrapEl!: HTMLElement;
  private chipsEl!: HTMLElement;
  private resizeHandleEl!: HTMLElement;
  private webToggleBtn!: HTMLButtonElement;
  private attachBtn!: HTMLButtonElement;
  private skillBtn!: HTMLButtonElement;
  /** 角色选择按钮（点击弹出选择弹窗） */
  private roleBtn!: HTMLButtonElement;
  /** 模型选择按钮（点击弹出选择弹窗） */
  private modelBtn!: HTMLButtonElement;
  /** 当前选中的模型显示标签（位于模型按钮与发送按钮之间） */
  private modelLabelEl!: HTMLElement;
  /** 当前选中的模型值（格式 linkId|modelName，与旧 select.value 一致） */
  private selectedModelValue = "";
  /** 当前选中的角色 id（仅影响当前对话视图，不保存为全局默认） */
  private selectedRoleId = "";

  private isStreaming = false;
  private sidebarCollapsed = true;

  // 流式渲染状态
  private pendingRender = false;
  private isRenderingMarkdown = false;
  private renderFrameId: number | null = null;
  private streamingRawContent = "";
  private streamingContentEl: HTMLElement | null = null;
  private streamingCursorEl: HTMLElement | null = null;
  private streamingTokenEl: HTMLElement | null = null;

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
    return "vault-mind";
  }

  /** 当前会话（可能为 undefined，当无任何会话时由 ensureActiveSession 兜底创建）。 */
  private get activeSession(): Session | undefined {
    return this.sessions.find((s) => s.id === this.activeId);
  }

  async onOpen(): Promise<void> {
    const index = await loadSessionsIndex(this.plugin);
    this.metaSnapshot.clear();
    for (const m of index.sessions) this.metaSnapshot.set(m.id, m);

    // 内存中先全部作为索引占位（messages 等为空，点击时再懒加载）
    this.sessions = index.sessions.map((m) => ({
      id: m.id,
      title: m.title,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      messages: [],
      attachments: [],
      skills: [],
      webSearch: false,
    }));
    this.activeId = index.activeSessionId;
    this.loadedIds.clear();

    // 加载最近 N 个会话的完整内容（按 updatedAt 倒序）
    const ordered = [...index.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    const recent = ordered.slice(0, RECENT_SESSION_COUNT);
    // 保证当前激活会话一定被加载（它可能不在最近 N 个之内）
    if (this.activeId) {
      const activeMeta = ordered.find((m) => m.id === this.activeId);
      if (activeMeta && !recent.includes(activeMeta)) recent.unshift(activeMeta);
    }
    for (const m of recent) {
      const full = await loadSessionFile(this.plugin, m.id);
      if (full) {
        this.replaceSession(full);
        this.loadedIds.add(m.id);
      }
    }

    // 兜底：若记录的激活会话文件损坏/缺失导致未加载成功，回退到最近一个已成功加载的会话
    if (this.activeId && !this.loadedIds.has(this.activeId)) {
      const firstLoaded = recent.find((m) => this.loadedIds.has(m.id));
      if (firstLoaded) this.activeId = firstLoaded.id;
    }

    // 兼容：没有任何会话时创建一个空白会话（继承全局默认 skill）
    if (this.sessions.length === 0) {
      const s = createSession(
        t("view.defaultTitle"),
        this.plugin.settings.defaultSkills
      );
      this.sessions.push(s);
      this.activeId = s.id;
      this.loadedIds.add(s.id);
      await this.persist();
    } else if (!this.activeSession) {
      // active 指向了不存在/未加载的会话：取最近的一个并确保加载
      const first = ordered[0];
      this.activeId = first.id;
      if (!this.loadedIds.has(first.id)) {
        const full = await loadSessionFile(this.plugin, first.id);
        if (full) {
          this.replaceSession(full);
          this.loadedIds.add(first.id);
        }
      }
    }

    // 初始化当前选中的模型与角色为全局默认值
    this.initDefaultModelAndRole();

    this.renderLayout();

    // 设置变更时刷新底部工具栏（如 🌐 按钮的启用/禁用态）
    this.registerEvent(
      this.plugin.settingsEvents.on("settings-changed", () => this.renderActions())
    );

    if (this.sessions.length > 0) {
      new Notice(t("view.sessionsLoaded", { count: this.sessions.length }));
    }
  }

  /** 用完整会话数据替换内存中同 id 的占位对象（不存在则追加）。 */
  private replaceSession(full: Session): void {
    const i = this.sessions.findIndex((s) => s.id === full.id);
    if (i >= 0) this.sessions[i] = full;
    else this.sessions.push(full);
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
    this.sidebarEl.toggleClass("is-collapsed", this.sidebarCollapsed);

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
      attr: { "aria-label": t("view.newSession") },
    });
    setIcon(newBtn, "plus");
    newBtn.addEventListener("click", () => void this.newSession());

    const clearBtn = rightGroup.createEl("button", {
      cls: "ana-chat-header-btn",
      attr: { "aria-label": t("view.clearCurrent") },
    });
    setIcon(clearBtn, "trash");
    clearBtn.addEventListener("click", () => void this.clearCurrentSession());

    this.messagesEl = main.createEl("div", { cls: "ana-chat-messages" });

    const footer = main.createEl("div", { cls: "ana-chat-footer" });

    // 文件入口：位于输入框上方（附件 / Skill / 联网搜索）
    const attachRow = footer.createEl("div", { cls: "ana-chat-attach-row" });
    this.attachBtn = attachRow.createEl("button", {
      cls: "ana-chat-action ana-chat-attach-action",
      attr: { "aria-label": t("view.addAttachment") },
    });
    setIcon(this.attachBtn, "paperclip");
    this.attachBtn.addEventListener("click", () => this.openAttachmentPicker());

    // Skill 按钮（附件右侧）
    this.skillBtn = attachRow.createEl("button", {
      cls: "ana-chat-action",
      attr: { "aria-label": t("view.manageSkills") },
    });
    setIcon(this.skillBtn, "puzzle");
    this.skillBtn.addEventListener("click", () => this.openSkillPicker());

    // 联网搜索开关（Skill 右侧）
    this.webToggleBtn = attachRow.createEl("button", {
      cls: "ana-chat-action",
      attr: { "aria-label": t("view.webToggle") },
    });
    setIcon(this.webToggleBtn, "globe");
    this.webToggleBtn.addEventListener("click", () => void this.toggleWebSearch());

    // 输入区：包裹层 + 底部操作栏
    const inputArea = footer.createEl("div", { cls: "ana-chat-input-area" });

    this.inputWrapEl = inputArea.createEl("div", { cls: "ana-chat-input-wrap" });
    // 顶部 6px 拖拽条：方便鼠标调整输入框高度
    this.resizeHandleEl = this.inputWrapEl.createEl("div", {
      cls: "ana-chat-resize-handle",
      prepend: true,
    });
    this.chipsEl = this.inputWrapEl.createEl("div", { cls: "ana-chat-chips" });
    this.inputEl = this.inputWrapEl.createEl("textarea", {
      cls: "ana-chat-input",
      attr: { placeholder: t("view.placeholder"), rows: "2" },
    });
    this.inputEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && !evt.shiftKey) {
        evt.preventDefault();
        void this.handleSend();
      }
    });

    // 输入框内底部工具栏：模型/角色选择（左）+ 模型名标签 + 发送（右）
    const inputBar = this.inputWrapEl.createEl("div", { cls: "ana-chat-input-bar" });

    // 左侧按钮组：模型选择 + 角色选择
    const leftActions = inputBar.createEl("div", { cls: "ana-chat-input-actions-left" });

    // 模型选择按钮
    this.modelBtn = leftActions.createEl("button", {
      cls: "ana-chat-model-btn",
      attr: { "aria-label": t("view.modelSelect") },
    });
    setIcon(this.modelBtn, "sparkle");
    this.modelBtn.addEventListener("click", () => void this.openModelPicker());

    // 角色选择按钮
    this.roleBtn = leftActions.createEl("button", {
      cls: "ana-chat-model-btn",
      attr: { "aria-label": t("view.roleSelect") },
    });
    setIcon(this.roleBtn, "user");
    this.roleBtn.addEventListener("click", () => void this.openRolePicker());

    // 右侧：模型名称标签 + 发送按钮
    const rightActions = inputBar.createEl("div", { cls: "ana-chat-input-actions-right" });

    // 模型名称标签（发送按钮左侧）
    this.modelLabelEl = rightActions.createEl("span", {
      cls: "ana-chat-model-label",
    });
    this.renderModelSelect();

    this.sendBtn = rightActions.createEl("button", {
      cls: "ana-chat-send",
      attr: { "aria-label": t("view.send") },
    });
    setIcon(this.sendBtn, "send");
    this.sendBtn.addEventListener("click", () => void this.handleSend());

    this.renderChips();
    this.renderActions();
    this.renderMessages();
    this.attachResizeDrag();
  }

  /** 顶部 6px 拖拽条：按住拖动调整输入框高度，向上拖变高，最低 60px。 */
  private attachResizeDrag(): void {
    const handle = this.resizeHandleEl;
    const input = this.inputEl;
    const MIN = 60;
    let startY = 0;
    let startH = 0;
    let originalUserSelect = "";

    const onMove = (e: PointerEvent) => {
      const delta = startY - e.clientY; // 向上拖动为正
      const newH = Math.max(MIN, startH + delta);
      input.style.height = `${newH}px`;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = originalUserSelect;
    };

    handle.addEventListener("pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      startY = e.clientY;
      startH = input.offsetHeight;
      originalUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
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
    const s = createSession(
      t("view.defaultTitle"),
      this.plugin.settings.defaultSkills
    );
    this.sessions.push(s);
    this.activeId = s.id;
    this.loadedIds.add(s.id);
    await this.persist();
    this.renderSessionList();
    this.renderMessages();
    this.renderChips();
    this.renderActions();
    this.inputEl.focus();
  }

  private async selectSession(id: string): Promise<void> {
    if (id === this.activeId) return;
    // 目标会话若尚未加载完整内容，则懒加载其独立文件
    if (!this.loadedIds.has(id)) {
      const full = await loadSessionFile(this.plugin, id);
      if (full) {
        this.replaceSession(full);
        this.loadedIds.add(id);
      }
    }
    this.activeId = id;
    await this.persist();
    this.renderSessionList();
    this.renderMessages();
    this.renderChips();
    this.renderActions();
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
        this.metaSnapshot.delete(s.id);
        this.loadedIds.delete(s.id);
        await deleteSessionFile(this.plugin, s.id);
        if (this.activeId === s.id) {
          const next = this.sessions[0];
          if (next) {
            this.activeId = next.id;
          } else {
            const fresh = createSession(
              t("view.defaultTitle"),
              this.plugin.settings.defaultSkills
            );
            this.sessions.push(fresh);
            this.activeId = fresh.id;
          }
        }
        await this.persist();
        this.renderSessionList();
        this.renderMessages();
        this.renderChips();
        this.renderActions();
      });
    modal.open();
  }

  private async clearCurrentSession(): Promise<void> {
    const s = this.activeSession;
    if (!s) return;
    s.messages = [];
    s.attachments = [];
    s.skills = [];
    s.title = t("view.defaultTitle");
    s.updatedAt = Date.now();
    await this.persist();
    this.renderMessages();
    this.renderSessionList();
    this.renderChips();
    this.renderActions();
  }

  // ================= Chips（显示在输入框内部） =================

  /** 渲染所有已选上下文 chip（附件 + skill）到输入框内部。 */
  private renderChips(): void {
    this.chipsEl.empty();
    const s = this.activeSession;
    if (!s) return;

    for (let i = 0; i < s.attachments.length; i++) {
      const ref = s.attachments[i];
      const chip = this.chipsEl.createEl("div", { cls: "ana-chat-chip" });
      const icon = ref.type === "folder" ? "folder" : "file-text";
      const iconSpan = chip.createSpan({ cls: "ana-chat-chip-icon" });
      setIcon(iconSpan, icon);
      chip.createSpan({ text: ref.path, cls: "ana-chat-chip-label" });
      const x = chip.createEl("button", {
        cls: "ana-chat-chip-x",
        attr: { "aria-label": t("view.removeAttachment") },
      });
      x.setText("×");
      x.addEventListener("click", () => void this.removeAttachment(i));
    }

    for (let i = 0; i < s.skills.length; i++) {
      const path = s.skills[i];
      const chip = this.chipsEl.createEl("div", {
        cls: "ana-chat-chip ana-chat-chip-skill",
      });
      const iconSpan = chip.createSpan({ cls: "ana-chat-chip-icon" });
      setIcon(iconSpan, "puzzle");
      chip.createSpan({ text: path, cls: "ana-chat-chip-label" });
      const x = chip.createEl("button", {
        cls: "ana-chat-chip-x",
        attr: { "aria-label": t("view.removeSkill") },
      });
      x.setText("×");
      x.addEventListener("click", () => void this.removeSkill(i));
    }
  }

  /** 打开对话面板时，自动把当前 Markdown 笔记作为附件加入当前会话。 */
  async attachCurrentNote(file: TFile): Promise<void> {
    const s = this.activeSession;
    if (!s || file.extension !== "md") return;
    const ref: AttachmentRef = { type: "file", path: file.path };
    const key = `${ref.type}:${ref.path}`;
    const existing = new Set(s.attachments.map((a) => `${a.type}:${a.path}`));
    if (existing.has(key)) return;
    s.attachments.push(ref);
    s.updatedAt = Date.now();
    await this.persist();
    this.renderChips();
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
    this.renderChips();
  }

  private async removeAttachment(index: number): Promise<void> {
    const s = this.activeSession;
    if (!s) return;
    s.attachments.splice(index, 1);
    s.updatedAt = Date.now();
    await this.persist();
    this.renderChips();
  }

  private async clearAttachments(): Promise<void> {
    const s = this.activeSession;
    if (!s) return;
    s.attachments = [];
    s.updatedAt = Date.now();
    await this.persist();
    this.renderChips();
  }

  /** 打开附件选择器：可搜索的库内文件夹/Markdown 文件多选列表。 */
  private openAttachmentPicker(): void {
    const s = this.activeSession;
    if (!s) return;
    new AttachmentPickerModal(this.plugin.app, this.plugin, (refs) =>
      void this.addAttachments(refs)
    ).open();
  }

  // ================= Skill 操作 =================

  private async addSkills(paths: string[]): Promise<void> {
    const s = this.activeSession;
    if (!s) return;
    const set = new Set(s.skills);
    let added = 0;
    for (const p of paths) {
      if (!set.has(p)) {
        s.skills.push(p);
        set.add(p);
        added++;
      }
    }
    if (added === 0) {
      new Notice(t("view.noNewSkill"));
      return;
    }
    s.updatedAt = Date.now();
    await this.persist();
    this.renderChips();
  }

  private async removeSkill(index: number): Promise<void> {
    const s = this.activeSession;
    if (!s) return;
    s.skills.splice(index, 1);
    s.updatedAt = Date.now();
    await this.persist();
    this.renderChips();
  }

  private async clearSkills(): Promise<void> {
    const s = this.activeSession;
    if (!s) return;
    s.skills = [];
    s.updatedAt = Date.now();
    await this.persist();
    this.renderChips();
  }

  /** 打开 skill 选择器：列出 skills/ 下所有 skill，支持搜索与多选。 */
  private openSkillPicker(): void {
    const s = this.activeSession;
    if (!s) return;
    new SkillPickerModal(
      this.plugin.app,
      this.plugin,
      s.skills,
      (paths) => void this.addSkills(paths)
    ).open();
  }

  // ================= 模型选择 =================

  /** 打开对话框时，将当前模型与角色初始化为全局默认值。 */
  private initDefaultModelAndRole(): void {
    const { settings } = this.plugin;

    // 默认模型
    const link = settings.modelLinks.find(
      (l) => l.id === settings.defaultModelLinkId
    );
    if (link && link.models.length > 0) {
      this.selectedModelValue = `${link.id}|${link.models[0]}`;
    } else if (settings.modelLinks.length > 0) {
      const first = settings.modelLinks[0];
      this.selectedModelValue = `${first.id}|${first.models[0]}`;
    } else {
      this.selectedModelValue = "";
    }

    // 默认角色：以全局默认角色为初始选中，无效则兜底到第一个（仅当前视图，不写全局）
    if (
      settings.roles.length > 0 &&
      settings.roles.some((r) => r.id === settings.defaultRoleId)
    ) {
      this.selectedRoleId = settings.defaultRoleId;
    } else if (settings.roles.length > 0) {
      this.selectedRoleId = settings.roles[0].id;
    } else {
      this.selectedRoleId = "";
    }
  }

  /** 渲染模型选择状态：更新标签文本显示当前选中模型与角色。 */
  private renderModelSelect(): void {
    const links = this.plugin.settings.modelLinks;
    if (links.length === 0 || !this.selectedModelValue) {
      this.modelLabelEl.setText(t("view.noModel"));
      return;
    }
    const pipeIdx = this.selectedModelValue.indexOf("|");
    if (pipeIdx < 0) {
      this.modelLabelEl.setText(t("view.noModel"));
      return;
    }
    const linkId = this.selectedModelValue.slice(0, pipeIdx);
    const modelName = this.selectedModelValue.slice(pipeIdx + 1);
    const link = links.find((l) => l.id === linkId);
    if (!link || !link.models.includes(modelName)) {
      this.modelLabelEl.setText(t("view.noModel"));
      return;
    }

    const role = this.plugin.settings.roles.find(
      (r) => r.id === this.selectedRoleId
    );
    const roleName = role ? role.name : t("view.noRole");
    this.modelLabelEl.setText(`${modelName}/${roleName}`);
  }

  /** 打开模型选择弹窗。 */
  private openModelPicker(): void {
    new ModelPickerModal(
      this.plugin.app,
      this.plugin,
      this.selectedModelValue,
      (value) => {
        this.selectedModelValue = value;
        this.renderModelSelect();
      }
    ).open();
  }

  // ================= 角色选择 =================

  /** 打开角色选择弹窗。 */
  private openRolePicker(): void {
    new RolePickerModal(
      this.plugin.app,
      this.plugin,
      this.selectedRoleId,
      (roleId) => {
        this.selectedRoleId = roleId;
        this.renderModelSelect();
      }
    ).open();
  }

  // ================= 联网搜索开关 =================

  /** 渲染图标按钮：更新各图标 active 状态与 tooltip。 */
  private renderActions(): void {
    const s = this.activeSession;
    if (!s) return;

    this.attachBtn.classList.toggle("is-active", s.attachments.length > 0);
    this.skillBtn.classList.toggle("is-active", s.skills.length > 0);

    // 全局关闭「启用技能」时隐藏 Skill 按钮，开启时才显示
    this.skillBtn.style.display = this.plugin.settings.skillsEnabled ? "" : "none";

    const globallyEnabled = this.plugin.settings.webSearchEnabled;
    // 全局关闭时隐藏 🌐 按钮，开启时才显示
    this.webToggleBtn.style.display = globallyEnabled ? "" : "none";

    const on = s.webSearch;
    this.webToggleBtn.classList.toggle("is-active", on);
    this.webToggleBtn.setAttribute(
      "title",
      on ? t("view.webOn") : t("view.webOff")
    );
  }

  private async toggleWebSearch(): Promise<void> {
    const s = this.activeSession;
    if (!s) return;
    s.webSearch = !s.webSearch;
    s.updatedAt = Date.now();
    this.renderActions();
    await this.persist();

    // 开启时若未配置凭据，给出提示
    if (s.webSearch) {
      const cfg = this.buildSearchConfig();
      if (!new WebSearchService(cfg).hasCredentials()) {
        new Notice(t("view.webNoCredentials"));
      }
    }
  }

  /** 从当前插件设置构造搜索配置。 */
  private buildSearchConfig(): SearchProviderConfig {
    const st = this.plugin.settings;
    return {
      enabled: st.webSearchEnabled,
      provider: st.webSearchProvider,
      tavilyApiKeys: st.tavilyApiKeys,
      serperApiKeys: st.serperApiKeys,
      braveApiKeys: st.braveApiKeys,
      searxngInstances: st.searxngInstances,
      maxResults: st.webSearchMaxResults,
      maxCharsPerResult: st.webSearchMaxCharsPerResult,
    };
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
      this.addMessage(m.role, m.content, m.usage);
    }
  }

  private addMessage(
    role: "user" | "assistant",
    text: string,
    usage?: import("../ai/provider").TokenUsage
  ): { contentEl: HTMLElement; bubbleEl: HTMLElement; rowEl: HTMLElement } {
    const row = this.messagesEl.createEl("div", {
      cls: `ana-chat-message ana-chat-message-${role}`,
    });
    const bubble = row.createEl("div", { cls: "ana-chat-bubble" });
    const content = bubble.createEl("div", { cls: "ana-chat-text" });

    if (role === "assistant") {
      void this.renderMarkdown(content, text);
      if (usage) {
        this.renderTokenUsage(bubble, usage);
      }
    } else {
      content.setText(text);
    }

    this.scrollToBottom();
    return { contentEl: content, bubbleEl: bubble, rowEl: row };
  }

  private addUserMessage(text: string): void {
    this.addMessage("user", text);
  }

  private addAssistantMessage(
    text: string,
    usage?: import("../ai/provider").TokenUsage
  ): HTMLElement {
    return this.addMessage("assistant", text, usage).contentEl;
  }

  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  // ================= Markdown 渲染 =================

  /** 使用 Obsidian 内置渲染器将 Markdown 渲染到指定元素。 */
  private async renderMarkdown(el: HTMLElement, text: string): Promise<void> {
    el.empty();
    if (!text.trim()) {
      return;
    }
    try {
      await MarkdownRenderer.renderMarkdown(text, el, "", this as Component);
    } catch {
      // 渲染失败时回退到纯文本
      el.setText(text);
    }
  }

  // ================= Token 消耗提示 =================

  /** 在气泡底部渲染 token 消耗信息。 */
  private renderTokenUsage(
    bubbleEl: HTMLElement,
    usage: import("../ai/provider").TokenUsage
  ): void {
    const existing = bubbleEl.querySelector(".ana-chat-token-usage");
    if (existing) existing.remove();

    const footer = bubbleEl.createEl("div", {
      cls: "ana-chat-token-usage",
      text: this.formatTokenUsage(usage),
    });
    footer.setAttribute("aria-label", t("view.tokensHint"));
  }

  private formatTokenUsage(
    usage: import("../ai/provider").TokenUsage
  ): string {
    const isEstimate =
      usage.promptTokens === 0 &&
      usage.completionTokens === 0 &&
      usage.totalTokens > 0;
    const prefix = isEstimate ? t("view.tokensEstimated") : t("view.tokens");
    return `${prefix}: ${usage.totalTokens}`;
  }

  /** 按字符数粗略估算 token 数（用于接口未返回 usage 时）。 */
  private estimateTokens(text: string): number {
    // 中文按字，英文按词，取一个保守估计
    const cnChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const nonCn = text.length - cnChars;
    return Math.ceil(cnChars + nonCn / 4);
  }

  // ================= 流式渲染 =================

  /** 标记需要重新渲染流式内容，并通过 requestAnimationFrame 节流。 */
  private scheduleStreamingRender(): void {
    this.pendingRender = true;
    if (this.renderFrameId !== null) return;

    this.renderFrameId = window.requestAnimationFrame(() => {
      this.renderFrameId = null;
      if (!this.pendingRender) return;
      this.pendingRender = false;
      void this.renderStreaming();
    });
  }

  /** 实际执行流式 Markdown 渲染，串行避免重入导致内容闪烁。 */
  private async renderStreaming(): Promise<void> {
    if (this.isRenderingMarkdown) {
      this.pendingRender = true;
      return;
    }
    if (!this.streamingContentEl) return;

    this.isRenderingMarkdown = true;
    this.streamingContentEl.removeClass("ana-chat-typing");
    try {
      await this.renderMarkdown(
        this.streamingContentEl,
        this.streamingRawContent
      );
      this.appendStreamingCursor();
      this.scrollToBottom();
    } finally {
      this.isRenderingMarkdown = false;
      if (this.pendingRender) {
        this.pendingRender = false;
        void this.renderStreaming();
      }
    }
  }

  private clearStreamingRender(): void {
    this.pendingRender = false;
    if (this.renderFrameId !== null) {
      window.cancelAnimationFrame(this.renderFrameId);
      this.renderFrameId = null;
    }
  }

  private appendStreamingCursor(): void {
    if (!this.streamingContentEl) return;
    this.removeStreamingCursor();
    this.streamingCursorEl = this.streamingContentEl.createEl("span", {
      cls: "ana-chat-streaming-cursor",
      text: "▍",
    });
  }

  private removeStreamingCursor(): void {
    if (this.streamingCursorEl) {
      this.streamingCursorEl.remove();
      this.streamingCursorEl = null;
    }
  }

  private clearStreamingState(): void {
    this.clearStreamingRender();
    this.removeStreamingCursor();
    this.streamingContentEl = null;
    this.streamingRawContent = "";
    this.streamingTokenEl = null;
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

    const system = await this.buildSystem();
    // 仅按用户显式附加的附件 + 消息中点名的文件读取内容（不自动加载任何文件）
    const noteContext = await buildAttachmentContext(
      this.plugin.app,
      s.attachments,
      text,
      this.plugin.settings.chatContextMaxChars
    );

    // 联网搜索：仅当前会话显式开启、且全局启用并已配置凭据时才调用外部 API
    let webContext = "";
    if (s.webSearch && this.plugin.settings.webSearchEnabled) {
      try {
        const svc = new WebSearchService(this.buildSearchConfig());
        if (svc.hasCredentials()) {
          const results = await svc.search(text);
          webContext = buildWebSearchContext(
            results,
            this.plugin.settings.webSearchShowCitations
          );
          if (results.length === 0) {
            this.addInlineError(t("view.webNoResults"));
          }
        } else {
          this.addInlineError(t("view.webNoCredentials"));
        }
      } catch (e) {
        this.addInlineError(t("view.webError", { error: (e as Error).message }));
      }
    }

    const extra = [noteContext, webContext].filter((x) => x).join("\n\n");
    const currentUser: ChatMessage = {
      role: "user",
      content: extra ? `${text}\n\n${extra}` : text,
    };

    // 将会话全部历史消息（不含当前这条刚加的）注入上下文
    const tail = s.messages.slice(0, -1);
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...tail,
      currentUser,
    ];

    const assistantContentEl = this.addAssistantMessage("");
    this.isStreaming = true;
    this.setInputDisabled(true);
    // 显示加载动画（打字指示器）
    this.showTypingIndicator(assistantContentEl);

    this.streamingContentEl = assistantContentEl;
    this.streamingRawContent = "";

    try {
      // 用当前选中的模型创建 provider（value 格式：linkId|modelName）
      const raw = this.selectedModelValue || "";
      const pipeIdx = raw.indexOf("|");
      let provider: import("../ai/provider").AIProvider;
      let selectedLink: import("../settings").ModelLink | undefined;
      if (pipeIdx >= 0) {
        const linkId = raw.slice(0, pipeIdx);
        const modelName = raw.slice(pipeIdx + 1);
        selectedLink = this.plugin.settings.modelLinks.find(
          (l) => l.id === linkId
        );
        if (selectedLink) {
          const linkWithModel = { ...selectedLink, models: [modelName] };
          provider = createProviderFromLink(linkWithModel);
        } else {
          provider = this.plugin.getProvider();
        }
      } else {
        provider = this.plugin.getProvider();
      }

      // 带超时的流式请求（默认 60 秒），避免不可达模型导致无限挂起
      const paramLink =
        selectedLink ??
        getActiveModelLink(this.plugin.settings) ??
        this.plugin.settings.modelLinks[0];
      const params = resolveLinkParams(paramLink, this.plugin.settings);
      const result = await this.withTimeout(
        provider.stream(
          messages,
          {
            maxTokens: params.maxTokens,
            temperature: params.temperature,
          },
          (chunk) => {
            this.streamingRawContent += chunk.content;
            this.scheduleStreamingRender();
          }
        ),
        60_000
      );

      // 流式结束：最终渲染并显示 token 消耗
      this.clearStreamingRender();
      this.removeStreamingCursor();
      const reply = result.content;
      await this.renderMarkdown(this.streamingContentEl!, reply);

      // 若接口未返回 usage，按字符粗略估算
      let usage = result.usage;
      if (!usage && reply.length > 0) {
        const promptText = messages.map((m) => m.content).join("\n");
        const promptTokens = this.estimateTokens(promptText);
        const completionTokens = this.estimateTokens(reply);
        usage = {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: promptTokens + completionTokens,
        };
      }
      if (usage && usage.totalTokens > 0) {
        this.renderTokenUsage(
          this.streamingContentEl!.closest(".ana-chat-bubble") as HTMLElement,
          usage
        );
      }

      // 首条助手回复后，用首句 user 消息命名会话（仅当仍为默认标题）
      const isFirstAssistant = !s!.messages.some((m) => m.role === "assistant");
      s!.messages.push({ role: "assistant", content: reply, usage });
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
      this.clearStreamingState();
      const bubble = assistantContentEl.closest(".ana-chat-bubble") as HTMLElement;
      bubble.addClass("ana-chat-bubble-error");
      assistantContentEl.empty();
      assistantContentEl.setText(t("view.error", { error: (e as Error).message }));
      // 出错时回滚刚加入的用户消息，避免污染历史
      s!.messages.pop();
      s!.updatedAt = Date.now();
    } finally {
      this.isStreaming = false;
      this.clearStreamingState();
      this.setInputDisabled(false);
      this.scrollToBottom();
    }
  }

  /** 在对话中插入一条不带 Markdown 渲染的内联错误提示。 */
  private addInlineError(text: string): void {
    const { contentEl, bubbleEl } = this.addMessage("assistant", "");
    bubbleEl.addClass("ana-chat-bubble-error");
    contentEl.setText(text);
  }

  private setInputDisabled(disabled: boolean): void {
    this.inputEl.disabled = disabled;
    this.sendBtn.disabled = disabled;
    this.sendBtn.setAttr("aria-label", disabled ? t("view.thinking") : t("view.send"));
    setIcon(this.sendBtn, disabled ? "loader" : "send");
  }

  /** 给 Promise 添加超时限制，超时后 reject 以避免不可达模型导致 UI 无限挂起。 */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(t("view.timeout")));
      }, ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });
  }

  /** 在助手消息气泡中显示「思考中」跳点动画。 */
  private showTypingIndicator(contentEl: HTMLElement): void {
    contentEl.addClass("ana-chat-typing");
    contentEl.createEl("span", { cls: "ana-chat-typing-text", text: t("view.thinking") });
    const dots = contentEl.createEl("span", { cls: "ana-chat-typing-dots" });
    for (let i = 0; i < 3; i++) dots.createEl("span", { cls: "ana-chat-typing-dot" });
  }

  /** 移除助手消息气泡中的「思考中」跳点动画。 */
  private hideTypingIndicator(contentEl: HTMLElement): void {
    contentEl.removeClass("ana-chat-typing");
    contentEl.empty();
  }

  /** 持久化会话：始终写 index.json；仅写已加载会话的独立文件（未加载的不覆盖磁盘）。 */
  private async persist(): Promise<void> {
    try {
      const index: SessionsIndex = {
        version: 3,
        activeSessionId: this.activeId,
        sessions: this.sessions.map((s) =>
          this.loadedIds.has(s.id)
            ? sessionToMeta(s)
            : (this.metaSnapshot.get(s.id) ?? {
                id: s.id,
                title: s.title,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
                messageCount: 0,
              })
        ),
      };
      await saveSessionsIndex(this.plugin, index);
      // 仅把已加载会话的完整内容写回磁盘；未加载会话磁盘文件保持不变
      for (const s of this.sessions) {
        if (this.loadedIds.has(s.id)) {
          await saveSessionFile(this.plugin, s);
        }
      }
    } catch (e) {
      // 记忆写入失败不应影响对话，但需记录以便排查
      console.error("[Vault Mind] 会话持久化失败", e);
    }
  }

  /** 构造 system prompt：基础助手提示 + 用户自定义指令 + 知识库索引 + skill 上下文。 */
  private async buildSystem(): Promise<string> {
    const base =
      "You are an AI assistant embedded in Obsidian. Help the user with their notes and questions. Keep answers concise and actionable unless asked otherwise. Note: you can see the vault's file paths and available skill names via the knowledge base index / skill index, but file/skill contents are only provided when the user explicitly attaches them, references them, or activates them.";
    const sys = buildSystemPrompt(
      getActiveRolePrompt(this.plugin.settings, this.selectedRoleId),
      base
    );
    const parts: string[] = [sys];

    if (this.plugin.settings.includeVaultIndex) {
      const index = buildKnowledgeIndex(
        this.plugin.app,
        this.plugin.settings.includeVaultIndex
      );
      if (index) parts.push(index);
    }

    // skill 上下文（索引 + 启用内容）
    const s = this.activeSession;
    const skillContext = await buildSkillContext(
      this.plugin,
      this.plugin.app,
      s ? s.skills : [],
      this.plugin.settings.chatContextMaxChars
    );
    if (skillContext) parts.push(skillContext);

    // 长期画像记忆：让 AI 了解用户背景与偏好
    const profileContext = await getProfileMemoryContext(this.plugin);
    if (profileContext) parts.push(profileContext);

    return parts.join("\n\n");
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

/**
 * Skill 选择器：列出 skills/ 下所有 skill，支持搜索与多选。
 * 勾选的 skill 路径回传给回调。可预先勾选当前已启用的 skill。
 */
class SkillPickerModal extends Modal {
  private plugin: AiNoteAgentPlugin;
  private initialSelected: string[];
  private onSubmit: (paths: string[]) => void;
  private selected = new Set<string>();
  private listEl!: HTMLElement;
  private searchEl!: HTMLInputElement;
  private all: SkillEntry[] = [];

  constructor(
    app: import("obsidian").App,
    plugin: AiNoteAgentPlugin,
    initialSelected: string[],
    onSubmit: (paths: string[]) => void
  ) {
    super(app);
    this.plugin = plugin;
    this.initialSelected = initialSelected;
    this.onSubmit = onSubmit;
    this.selected = new Set(initialSelected);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ana-picker");
    this.titleEl.setText(t("view.skillPicker.title"));

    contentEl.createEl("p", {
      text: t("view.skillPicker.desc"),
      cls: "ana-picker-desc",
    });

    this.searchEl = contentEl.createEl("input", {
      cls: "ana-picker-search",
      attr: { type: "text", placeholder: t("view.skillPicker.searchPlaceholder") },
    });
    this.searchEl.addEventListener("input", () => this.renderList());

    this.listEl = contentEl.createEl("div", { cls: "ana-picker-list" });

    try {
      this.all = await listSkills(this.plugin, this.app);
    } catch {
      this.all = [];
    }
    this.renderList();

    const btns = contentEl.createEl("div", { cls: "ana-chat-modal-actions" });
    new ButtonComponent(btns)
      .setButtonText(t("modal.cancel"))
      .onClick(() => this.close());
    new ButtonComponent(btns)
      .setButtonText(t("view.skillPicker.confirm"))
      .setCta()
      .onClick(() => {
        const paths = Array.from(this.selected);
        this.close();
        this.onSubmit(paths);
      });

    this.scope.register([], "Escape", () => this.close());
  }

  private renderList(): void {
    this.listEl.empty();
    const q = this.searchEl.value.trim().toLowerCase();
    const filtered = q
      ? this.all.filter(
          (e) => e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q)
        )
      : this.all;

    if (filtered.length === 0) {
      this.listEl.createEl("div", {
        text: t("view.skillPicker.empty"),
        cls: "ana-picker-empty",
      });
      return;
    }

    for (const e of filtered) {
      const row = this.listEl.createEl("label", { cls: "ana-picker-row" });
      const cb = row.createEl("input", { attr: { type: "checkbox" } });
      cb.checked = this.selected.has(e.path);
      cb.addEventListener("change", () => {
        if (cb.checked) this.selected.add(e.path);
        else this.selected.delete(e.path);
      });
      row.createSpan({ text: `🧩 ${e.name}`, cls: "ana-picker-name" });
      const pathSpan = row.createEl("span", {
        text: e.path,
        cls: "ana-picker-path",
      });
      void pathSpan;
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * 模型选择器：按链接分组展示所有可用模型，支持搜索与单选。
 * 选中后回传 value（格式 linkId|modelName）。
 */
class ModelPickerModal extends Modal {
  private plugin: AiNoteAgentPlugin;
  private currentValue: string;
  private onSelect: (value: string) => void;
  private listEl!: HTMLElement;
  private searchEl!: HTMLInputElement;

  constructor(
    app: import("obsidian").App,
    plugin: AiNoteAgentPlugin,
    currentValue: string,
    onSelect: (value: string) => void
  ) {
    super(app);
    this.plugin = plugin;
    this.currentValue = currentValue;
    this.onSelect = onSelect;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ana-picker");
    this.titleEl.setText(t("view.modelPicker.title"));

    contentEl.createEl("p", {
      text: t("view.modelPicker.desc"),
      cls: "ana-picker-desc",
    });

    this.searchEl = contentEl.createEl("input", {
      cls: "ana-picker-search",
      attr: { type: "text", placeholder: t("view.modelPicker.searchPlaceholder") },
    });
    this.searchEl.addEventListener("input", () => this.renderList());

    this.listEl = contentEl.createEl("div", { cls: "ana-picker-list" });
    this.renderList();

    // 操作按钮
    const btns = contentEl.createEl("div", { cls: "ana-chat-modal-actions" });
    new ButtonComponent(btns)
      .setButtonText(t("modal.cancel"))
      .onClick(() => this.close());

    this.scope.register([], "Escape", () => this.close());
  }

  /** 收集所有链接的模型为扁平列表。 */
  private getItems(): { value: string; label: string; linkName: string; modelName: string }[] {
    const items: { value: string; label: string; linkName: string; modelName: string }[] = [];
    for (const link of this.plugin.settings.modelLinks) {
      for (const m of link.models) {
        items.push({
          value: `${link.id}|${m}`,
          label: `${link.name}/${m}`,
          linkName: link.name,
          modelName: m,
        });
      }
    }
    return items;
  }

  private renderList(): void {
    this.listEl.empty();
    const all = this.getItems();
    if (all.length === 0) {
      this.listEl.createEl("div", {
        text: t("view.modelPicker.empty"),
        cls: "ana-picker-empty",
      });
      return;
    }
    const q = this.searchEl.value.trim().toLowerCase();
    const filtered = q ? all.filter((i) => i.label.toLowerCase().includes(q)) : all;

    for (const item of filtered) {
      const isSelected = item.value === this.currentValue;
      const row = this.listEl.createEl("div", {
        cls: "ana-picker-row" + (isSelected ? " is-selected" : ""),
      });

      // 左侧：图标 + 链接名/模型名
      const nameEl = row.createSpan({
        text: `✨ ${item.label}`,
        cls: "ana-picker-name",
      });
      void nameEl;

      // 右侧：链接名（灰色路径风格）
      const pathEl = row.createEl("span", {
        text: item.linkName,
        cls: "ana-picker-path",
      });
      void pathEl;

      row.addEventListener("click", () => {
        this.onSelect(item.value);
        this.close();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * 角色选择器：列出所有角色，支持搜索与单选。
 * 选中后仅更新当前对话的角色（selectedRoleId），不写全局默认。
 */
class RolePickerModal extends Modal {
  private plugin: AiNoteAgentPlugin;
  private currentId: string;
  private onSelect: (roleId: string) => void;
  private listEl!: HTMLElement;
  private searchEl!: HTMLInputElement;

  constructor(
    app: import("obsidian").App,
    plugin: AiNoteAgentPlugin,
    currentId: string,
    onSelect: (roleId: string) => void
  ) {
    super(app);
    this.plugin = plugin;
    this.currentId = currentId;
    this.onSelect = onSelect;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ana-picker");
    this.titleEl.setText(t("view.rolePicker.title"));

    contentEl.createEl("p", {
      text: t("view.rolePicker.desc"),
      cls: "ana-picker-desc",
    });

    this.searchEl = contentEl.createEl("input", {
      cls: "ana-picker-search",
      attr: { type: "text", placeholder: t("view.rolePicker.searchPlaceholder") },
    });
    this.searchEl.addEventListener("input", () => this.renderList());

    this.listEl = contentEl.createEl("div", { cls: "ana-picker-list" });
    this.renderList();

    const btns = contentEl.createEl("div", { cls: "ana-chat-modal-actions" });
    new ButtonComponent(btns)
      .setButtonText(t("modal.cancel"))
      .onClick(() => this.close());

    this.scope.register([], "Escape", () => this.close());
  }

  private renderList(): void {
    this.listEl.empty();
    const roles = this.plugin.settings.roles;
    const currentId = this.currentId;

    if (roles.length === 0) {
      this.listEl.createEl("div", {
        text: t("view.rolePicker.empty"),
        cls: "ana-picker-empty",
      });
      return;
    }

    const q = this.searchEl.value.trim().toLowerCase();
    const filtered = q
      ? roles.filter((r) => r.name.toLowerCase().includes(q))
      : roles;

    if (filtered.length === 0) {
      this.listEl.createEl("div", {
        text: t("view.rolePicker.noResults"),
        cls: "ana-picker-empty",
      });
      return;
    }

    for (const role of filtered) {
      const isSelected = role.id === currentId;
      const row = this.listEl.createEl("div", {
        cls: "ana-picker-row" + (isSelected ? " is-selected" : ""),
      });

      row.createSpan({
        text: role.name,
        cls: "ana-picker-name",
      });

      row.addEventListener("click", () => {
        this.onSelect(role.id);
        this.close();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

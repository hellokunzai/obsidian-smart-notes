import {
  Plugin,
  Notice,
  TFile,
  MarkdownView,
  Menu,
  addIcon,
  Events,
  type Editor,
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
import {
  CHAT_VIEW_TYPE,
  ChatView,
  SIDEBAR_COLLAPSE_ICON,
  SIDEBAR_COLLAPSE_SVG,
  SIDEBAR_EXPAND_ICON,
  SIDEBAR_EXPAND_SVG,
} from "./view/chatView";
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

/**
 * Frontmatter 模板按行识别：设置里每行写一个字段名（兼容逗号分隔）。
 * 这组字段直接作为设置输入框的初始内容（可编辑），
 * 需与 settings.ts 中 DEFAULT_SETTINGS 的 frontmatterTemplate 保持一致。
 */
const DEFAULT_FRONTMATTER_TEMPLATE = "title\ndate\ntags\ncategory\nsummary\nkeywords";

/**
 * 「要索引的属性」默认白名单，直接作为设置输入框的初始内容（可编辑）。
 * 需与 settings.ts 中 DEFAULT_SETTINGS 的 frontmatterIndexKeys 保持一致；
 * 运行时留空仍表示索引所有非空属性（用户手动清空输入框即可恢复）。
 */
const DEFAULT_FRONTMATTER_INDEX_KEYS = "tags\ncategory\nsummary";

/**
 * 一次命令调用的现场。可用性判定与执行体看到同一份上下文，
 * 避免「判定时算的是活动文件、执行时又重新取一次」导致的不一致。
 */
interface CommandContext {
  file: TFile | null;
  editor: Editor | null;
  view: MarkdownView | null;
}

/**
 * 命令单一数据源：命令面板（checkCallback）与编辑器右键菜单都从这张表生成，
 * 避免「可用性判定」和「执行体」在两处各写一遍后漂移。
 */
interface CommandSpec {
  id: string;
  nameKey: string;
  /** true：onload 时无条件注册；false：由 refreshChatPanelAccess 按开关动态注册/移除。 */
  alwaysRegistered: boolean;
  isAvailable(ctx: CommandContext): boolean;
  run(ctx: CommandContext): void | Promise<void>;
}

const ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3"/></svg>`;

export default class AiNoteAgentPlugin extends Plugin {
  settings: AiNoteAgentSettings;
  /** 设置变更事件总线（用于通知已打开的视图刷新 UI）。 */
  settingsEvents = new Events();
  private provider!: AIProvider;
  private memoryRebuildTimeout?: number;
  /**
   * Ribbon 图标 DOM 引用，用于在关闭 chatPanelEnabled 时移除。
   * null 表示尚未添加或已主动 remove。
   */
  private ribbonEl: HTMLElement | null = null;
  /** 二级菜单能力探测结果缓存：null = 尚未探测（运行期不会变，探一次即可）。 */
  private submenuProbe: boolean | null = null;

  /**
   * 同步「打开 AI 对话面板」入口的总开关。
   * 同时管理：左栏 ribbon 图标、命令面板命令、已打开的 ChatView。
   * 仅靠 addCommand + checkCallback 不能解决「命令面板全部命令视图下 checkCallback 不会被求值」的问题；
   * 而且用户期望 toggle off 后不应有任何入口（包括已打开的视图）。
   * public 是给 settings.ts 中 chatPanelEnabled.onChange 调用以同步 UI 状态。
   */
  refreshChatPanelAccess(): void {
    const enabled = !!this.settings.chatPanelEnabled;
    const fullCmdId = `${this.manifest.id}:open-chat`;

    // 1) 命令面板命令：总是先移除再按开关决定是否重新注册（幂等）
    try {
      const commands = (
        this.app as unknown as {
          commands?: { removeCommand(id: string): void };
        }
      ).commands;
      commands?.removeCommand(fullCmdId);
    } catch {
      // 重复移除或尚未注册时静默忽略
    }

    // 2) Ribbon 图标：先 remove 旧 DOM 再决定是否重新创建
    if (this.ribbonEl) {
      try {
        this.ribbonEl.remove();
      } catch {
        // ignore
      }
      this.ribbonEl = null;
    }

    // 3) 已打开的 ChatView：toggle off → 强制 detach 所有 chat view leaves
    if (!enabled) {
      const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
      for (const leaf of leaves) {
        // detach 不会调用 view 的 onClose 之外的清理，足够满足"关闭入口"诉求
        leaf.detach();
      }
    }

    // 重新注册入口
    if (!enabled) return;
    this.ribbonEl = this.addRibbonIcon("smart-notes", t("plugin.name"), () => {
      void this.openChatView();
    });
    const openChat = this.commandSpecs().find((s) => s.id === "open-chat");
    if (openChat) this.addSpecCommand(openChat);
  }

  async onload() {
    await this.loadSettings();
    this.provider = createProvider(this.app, this.settings);
    initI18n(this.app);

    addIcon("smart-notes", ICON_SVG);
    addIcon(SIDEBAR_COLLAPSE_ICON, SIDEBAR_COLLAPSE_SVG);
    addIcon(SIDEBAR_EXPAND_ICON, SIDEBAR_EXPAND_SVG);

    // 自动在 vault 根目录生成 AI 数据文件夹（记忆 + skills）
    void ensureAiFolder(this);

    // 后台静默整理长期画像记忆：读取全部会话历史，生成/更新 memory/MEMORY.md 与 memory/yyyy-mm-dd.md
    // 仅当「更新方式 = 启动时更新」才在启动后自动整理；「对话时更新」改由每次对话结束触发。
    if (this.settings.memoryProfileEnabled && this.settings.profileUpdateMode === "startup") {
      this.memoryRebuildTimeout = window.setTimeout(
        () => void rebuildProfileMemory(this),
        3000
      );
    }

    this.addSettingTab(new AiNoteAgentSettingTab(this.app, this));

    // 视图类型始终注册，否则 toggle off → on 后无法再次打开 ChatView
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));

    // Realtime inline autoprompt editor extension
    this.registerEditorExtension(createRealtimeExtension(this));

    // ribbon / open-chat 命令入口由 refreshChatPanelAccess 统一管控（toggle off 时不创建）
    this.refreshChatPanelAccess();

    // 命令面板与斜杠菜单入口
    this.registerSpecCommands();

    // 编辑器右键菜单：父项「Smart Notes」+ 二级菜单
    this.registerEditorContextMenu();
  }

  private async openChatView(file?: TFile): Promise<void> {
    // 若开关关闭，禁止通过任何遗留入口打开
    if (!this.settings.chatPanelEnabled) {
      new Notice(t("settings.chatPanel.desc"));
      return;
    }
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
    const loaded = ((await this.loadData()) as Record<string, unknown>) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
    // 迁移旧版扁平字段 → modelLinks / roles，并做 defaultId 兜底
    migrateSettings(loaded, this.settings, this.app);
    // Frontmatter 模板 / 要索引的属性：旧配置里的空值一次性回填为默认内容并落盘，
    // 保证设置输入框始终展示可编辑的真实内容（而非占位符）。
    if (!this.settings.frontmatterTemplate?.trim()) {
      this.settings.frontmatterTemplate = DEFAULT_FRONTMATTER_TEMPLATE;
      await this.saveSettings();
    }
    if (!this.settings.frontmatterIndexKeys?.trim()) {
      this.settings.frontmatterIndexKeys = DEFAULT_FRONTMATTER_INDEX_KEYS;
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.provider = createProvider(this.app, this.settings);
    // 通知已打开的视图（如对话面板）刷新依赖设置的 UI
    try {
      this.settingsEvents.trigger("settings-changed");
    } catch (e) {
      console.error("[Smart Notes] settings-changed listener failed:", e);
    }
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

    // 模板识别方式：每行一个 Frontmatter 字段（兼容逗号分隔），
    // 由字段列表拼装 system prompt；不设默认回退——
    // 空值会在插件加载时被回填为默认字段，此处为空说明用户手动清空了模板。
    const fields = this.settings.frontmatterTemplate
      .split(/[\n,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (fields.length === 0) {
      new Notice(t("frontmatter.emptyTemplate"));
      return;
    }
    const systemPrompt = `${t("frontmatter.promptHeader")}\n${fields.join(", ")}\n${t("frontmatter.promptFooter")}`;
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: body },
    ];

    const activeLink = getActiveModelLink(this.settings);
    const params = resolveLinkParams(activeLink, this.settings);
    const response = (await this.provider.complete(messages, {
      maxTokens: params.maxTokens,
      temperature: params.temperature,
    })).content;

    let yaml = response.trim();
    if (yaml.startsWith("```")) {
      yaml = yaml.replace(/^```[^\n]*\n?/, "").replace(/\n?```\s*$/, "");
      yaml = yaml.trim();
    }
    const hasDelimiters = yaml.startsWith("---") && yaml.includes("\n---");
    const yamlBlock = hasDelimiters ? yaml : `---\n${yaml}\n---`;

    // 兜底：强制将 date 字段设为今天（AI 可能按笔记内容生成历史日期）
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    let finalYaml = yamlBlock;
    if (/^date:\s*.+$/m.test(finalYaml)) {
      finalYaml = finalYaml.replace(/^date:\s*.+$/m, `date: ${today}`);
    } else {
      finalYaml = finalYaml.replace(/^---\n/, `---\ndate: ${today}\n`);
    }

    await this.app.vault.modify(file, `${finalYaml}\n${body}`);
  }

  // ----------------------------------------------------------- 命令表 / 右键菜单

  /**
   * 命令单一数据源：命令面板、斜杠菜单、编辑器右键菜单三处都从这张表生成。
   * 新增命令时只在这里加一条，三处入口自动同步「可用性判定 + 执行体」。
   */
  private commandSpecs(): CommandSpec[] {
    return [
      {
        id: "optimize-current",
        nameKey: "cmd.optimizeCurrent",
        alwaysRegistered: true,
        isAvailable: (ctx) =>
          !!this.settings.optimizeCurrentEnabled && ctx.file?.extension === "md",
        run: (ctx) => {
          // optimizeCommand 内部自带常驻 Notice（完成后 hide 并打开对比弹窗）
          // 与 try/catch 错误提示，这里不能再套 runWithNotice，否则会同时弹出两个「正在优化笔记……」
          if (ctx.file) void this.optimizeCommand(ctx.file);
        },
      },
      {
        id: "autoprompt",
        nameKey: "cmd.autoprompt",
        alwaysRegistered: true,
        isAvailable: (ctx) => !!this.settings.realtimeEnabled && !!ctx.editor,
        run: (ctx) => {
          const editor = ctx.editor;
          if (!editor) return;
          void this.runWithNotice(t("notice.thinking"), () =>
            autopromptAtCursor(this, editor)
          );
        },
      },
      {
        id: "open-chat",
        nameKey: "cmd.openChat",
        // 由 refreshChatPanelAccess 按开关动态注册/移除，避免关闭后仍出现在「全部命令」视图里
        alwaysRegistered: false,
        isAvailable: () => !!this.settings.chatPanelEnabled,
        run: (ctx) => {
          void this.openChatView(ctx.file ?? undefined);
        },
      },
      {
        id: "generate-frontmatter",
        nameKey: "cmd.generateFrontmatter",
        alwaysRegistered: true,
        isAvailable: (ctx) =>
          !!this.settings.frontmatterGenerationEnabled &&
          ctx.file?.extension === "md",
        run: (ctx) => {
          const file = ctx.file;
          if (file) {
            void this.runWithNotice(t("notice.generatingFrontmatter"), () =>
              this.generateFrontmatterCommand(file)
            );
          }
        },
      },
    ];
  }

  /** 命令面板路径的上下文：以当前活动文件 / 活动 Markdown 视图为准。 */
  private activeCommandContext(): CommandContext {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return {
      file: this.app.workspace.getActiveFile() ?? view?.file ?? null,
      editor: view?.editor ?? null,
      view,
    };
  }

  /** 把一条 spec 注册成命令（命令面板与斜杠菜单共用这一条注册路径）。 */
  private addSpecCommand(spec: CommandSpec): void {
    this.addCommand({
      id: spec.id,
      name: t(spec.nameKey),
      checkCallback: (checking) => {
        const ctx = this.activeCommandContext();
        if (!spec.isAvailable(ctx)) return false;
        if (!checking) void spec.run(ctx);
        return true;
      },
    });
  }

  private registerSpecCommands(): void {
    for (const spec of this.commandSpecs()) {
      if (spec.alwaysRegistered) this.addSpecCommand(spec);
    }
  }

  /**
   * 探测 MenuItem.setSubmenu 是否可用。
   * 该方法不在 Obsidian 官方 typings 里（未公开 API），只能运行时试探：
   * 用一个不会入场的 Menu 试调一次，确认拿到的确实是能 addItem 的子菜单对象。
   * 探测结果缓存在实例上——运行期不会变，没必要每次右键都试。
   */
  private supportsSubmenu(): boolean {
    if (this.submenuProbe === null) {
      let supported = false;
      try {
        new Menu().addItem((item) => {
          const fn = (item as unknown as { setSubmenu?: () => unknown })
            .setSubmenu;
          if (typeof fn !== "function") return;
          const sub = fn.call(item) as { addItem?: unknown } | undefined;
          supported = !!sub && typeof sub.addItem === "function";
        });
      } catch (e) {
        console.error("[Smart Notes] 二级菜单能力探测失败，将降级为平铺菜单：", e);
        supported = false;
      }
      this.submenuProbe = supported;
    }
    return this.submenuProbe;
  }

  /**
   * 编辑器右键菜单：父项「Smart Notes」+ 二级菜单（4 条命令）。
   * 探测不到 setSubmenu 时整体降级为平铺在同一层——宁可丑一点，也不让移动端/旧版丢功能。
   */
  private registerEditorContextMenu(): void {
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) => {
        const specs = this.commandSpecs();
        const ctx: CommandContext = {
          editor,
          file: info.file ?? null,
          view: info instanceof MarkdownView ? info : null,
        };

        if (!this.supportsSubmenu()) {
          this.addMenuItems(menu, specs, ctx, true);
          return;
        }

        let populated = false;
        menu.addItem((item) => {
          item.setTitle(t("plugin.name")).setIcon("smart-notes");
          try {
            // 见 supportsSubmenu：setSubmenu 未公开，返回值才是子菜单 Menu
            const submenu = (
              item as unknown as { setSubmenu: () => Menu }
            ).setSubmenu();
            if (submenu && typeof submenu.addItem === "function") {
              this.addMenuItems(submenu, specs, ctx, false);
              populated = true;
            }
          } catch (e) {
            console.error("[Smart Notes] 二级菜单创建失败，降级为平铺菜单：", e);
          }
        });
        // 万一子菜单没建成，父项会变成点不动的空壳，这里补一次平铺保证功能可达
        if (!populated) this.addMenuItems(menu, specs, ctx, true);
      })
    );
  }

  /**
   * 往菜单里逐条加命令项。
   * @param prefix 平铺降级时补「插件名: 」前缀——四项混在编辑器原生菜单里，靠前缀标明归属；
   *               二级菜单里父项已表达归属，无需前缀。
   */
  private addMenuItems(
    menu: Menu,
    specs: CommandSpec[],
    ctx: CommandContext,
    prefix: boolean
  ): void {
    for (const spec of specs) {
      const title = t(spec.nameKey);
      menu.addItem((item) =>
        item
          .setTitle(prefix ? `${t("plugin.name")}: ${title}` : title)
          .setDisabled(!spec.isAvailable(ctx))
          .onClick(() => void spec.run(ctx))
      );
    }
  }
}

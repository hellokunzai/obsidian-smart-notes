import { Menu } from "obsidian";
import { t } from "../i18n";

/** 长按判定阈值（毫秒）：低于它的按下-抬起仍按普通点击处理。 */
const LONG_PRESS_MS = 500;
/** 按下后手指移动超过这个像素数就认为是在滚动列表，取消长按。 */
const LONG_PRESS_MOVE_TOLERANCE = 8;
/**
 * 长按已经弹过菜单后，抑制原生 contextmenu 的窗口（毫秒）。
 *
 * Android WebView 里长按会**同时**触发 pointer 事件与原生 `contextmenu`，
 * 两套入口不做互斥就会叠出两个菜单。
 */
const NATIVE_MENU_SUPPRESS_MS = 800;

/** 构建会话行菜单所需的回调。 */
export interface SessionRowMenuOptions {
  /**
   * 是否已处于批量操作模式。
   * 为 true 时菜单整体换形（只留「退出批量操作」）——批量态下点整行是勾选、
   * 不再是切换会话，此时再摆出「重命名 / 删除会话」只会让人以为删的是当前这条。
   */
  batchMode: boolean;
  /** 选中「重命名会话」。 */
  onRename: () => void;
  /** 选中「删除会话」（二次确认由调用方负责）。 */
  onDelete: () => void;
  /** 选中「批量操作」：进入多选态。 */
  onBatch: () => void;
  /** 选中「退出批量操作」。 */
  onExitBatch: () => void;
}

/**
 * 构建会话列表某一行的菜单。
 *
 * 普通态顺序：重命名 → 批量操作 → 分隔线 → 删除（挂 `setWarning(true)`，
 * 主题会给它 --text-error 配色，与本插件设置页 skill 行的菜单
 * （`skills/skillRowMenu.ts`）保持同一套约定）。
 * 批量态顺序：只有「退出批量操作」一条 —— 它是除 Esc 之外唯一的退出口。
 *
 * 拆成独立函数而不是内联在 chatView 里：菜单项的构成 / 顺序 / 图标
 * 正是静态检查查不出、又最容易被后续重构悄悄改坏的部分，
 * 独立出来才能在离线冒烟测试里断言「有哪些项、什么顺序、点下去调了什么」。
 */
export function buildSessionRowMenu(opts: SessionRowMenuOptions): Menu {
  const menu = new Menu();

  if (opts.batchMode) {
    menu.addItem((item) =>
      item.setTitle(t("view.exitBatch")).setIcon("x").onClick(opts.onExitBatch)
    );
    return menu;
  }

  menu.addItem((item) =>
    item
      .setTitle(t("view.renameSession"))
      .setIcon("pencil")
      .onClick(opts.onRename)
  );
  menu.addItem((item) =>
    item
      .setTitle(t("view.batchActions"))
      .setIcon("list-checks")
      .onClick(opts.onBatch)
  );
  menu.addSeparator();
  menu.addItem((item) =>
    item
      .setTitle(t("view.deleteSession"))
      .setIcon("trash-2")
      .setWarning(true)
      .onClick(opts.onDelete)
  );
  return menu;
}

/** 给会话行绑定交互所需的选项。 */
export interface SessionRowTriggerOptions {
  /**
   * 是否启用长按触发。移动端为 true；桌面端只认右键——
   * 桌面端鼠标长按按住不动会先触发文字选择，再弹出菜单反而干扰。
   */
  enableLongPress: boolean;
  /** 普通点击：选中该会话。长按弹出菜单时**不会**触发它。 */
  onSelect: () => void;
  /**
   * 弹出菜单时调用，返回本次要展示的菜单。
   * 做成工厂而不是传一个现成的 Menu：每次弹出都应该是全新实例，
   * 复用同一个实例会让上一次的 `onHide` 回调与父元素标记串味。
   */
  createMenu: () => Menu;
}

/**
 * 给会话行绑定「右键 / 长按 → 菜单」，并顺带接管普通点击。
 *
 * 两条入口：
 *  - 桌面端：`contextmenu`（鼠标右键）。
 *  - 移动端：自己实现长按（pointerdown + 计时器）。iOS WebView 的长按**不会**
 *    派发 `contextmenu`（只会弹系统 callout）；Android WebView 虽然会派发，
 *    但只要按下时开始了文字选择就不派发。两套都实现、再用时间戳互相抑制，
 *    才能保证「恰好弹一个菜单」。
 *
 * 菜单定位统一用**鼠标/触摸的 client 坐标**：`Menu.showAtMouseEvent` 内部就是
 * `showAtPosition({ x: evt.clientX, y: evt.clientY })`（已核对 obsidian.asar），
 * 所以长按传 client 坐标与右键走的是同一条路径。`doc` 取行的 ownerDocument，
 * 让菜单弹在**该行所在的那个窗口**（弹出式窗口里不会跑到主窗口上）。
 */
export function attachSessionRowTrigger(
  el: HTMLElement,
  opts: SessionRowTriggerOptions
): void {
  let timer: number | null = null;
  /** 长按弹出菜单后紧随的那次 click 要丢掉，否则会顺带把会话切过去。 */
  let suppressNextClick = false;
  /** 最近一次长按弹出菜单的时刻，用于抑制 Android 上重复的原生 contextmenu。 */
  let longPressFiredAt = 0;
  let originX = 0;
  let originY = 0;

  const cancelLongPress = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const openMenu = (x: number, y: number): void => {
    const menu = opts.createMenu();
    el.classList.add("is-menu-open");
    menu.onHide(() => el.classList.remove("is-menu-open"));
    menu.showAtPosition({ x, y }, el.ownerDocument);
  };

  el.addEventListener("click", () => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    opts.onSelect();
  });

  el.addEventListener("contextmenu", (evt: MouseEvent) => {
    cancelLongPress();
    evt.preventDefault();
    // 长按已经弹过一次了（Android 会两套都触发），这里不再重复
    if (Date.now() - longPressFiredAt < NATIVE_MENU_SUPPRESS_MS) return;
    evt.stopPropagation();
    openMenu(evt.clientX, evt.clientY);
  });

  if (!opts.enableLongPress) return;

  el.addEventListener("pointerdown", (evt: PointerEvent) => {
    // 鼠标不参与长按（右键已经覆盖了桌面端）
    if (evt.pointerType === "mouse") return;
    // 新的一次按下，上一次长按留下的点击抑制作废
    suppressNextClick = false;
    cancelLongPress();
    originX = evt.clientX;
    originY = evt.clientY;
    timer = window.setTimeout(() => {
      timer = null;
      longPressFiredAt = Date.now();
      suppressNextClick = true;
      openMenu(originX, originY);
    }, LONG_PRESS_MS);
  });

  el.addEventListener("pointermove", (evt: PointerEvent) => {
    if (timer === null) return;
    if (
      Math.abs(evt.clientX - originX) > LONG_PRESS_MOVE_TOLERANCE ||
      Math.abs(evt.clientY - originY) > LONG_PRESS_MOVE_TOLERANCE
    ) {
      cancelLongPress();
    }
  });

  el.addEventListener("pointerup", cancelLongPress);
  el.addEventListener("pointercancel", cancelLongPress);
  el.addEventListener("pointerleave", cancelLongPress);
}

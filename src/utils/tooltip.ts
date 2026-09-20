import { setTooltip } from "obsidian";

/**
 * 本插件所有悬停提示共用的类名。
 *
 * Obsidian 的提示气泡是挂在 `document.body` 上的**单例元素**（`.tooltip`），
 * 所以主题或自定义 CSS 片段一旦改了 `.tooltip`（加描边、换成主题色文字之类），
 * 全库所有提示都会跟着变——也包括本插件的。
 *
 * 给触发元素设 `data-tooltip-classes` 后，Obsidian 显示提示时会把这里列出的类
 * 加到那个 tooltip 元素上（已核对 obsidian.asar：hover 时 `bv()` 读取该属性 →
 * `kv(el, text, { classes })` → `tooltipEl.addClasses(classes)`），
 * 于是 styles.css 里的 `.tooltip.ana-tooltip` 只命中本插件的提示，
 * 不会把别处的提示一起改掉。
 */
export const TOOLTIP_CLASS = "ana-tooltip";

/**
 * 设置悬停提示，观感与 Obsidian 原生 tooltip 一致（对应 styles.css 的
 * `.tooltip.ana-tooltip`）。
 *
 * 走官方 `setTooltip()`：它同时会写 `aria-label`（无障碍读屏照常可用）与
 * `data-tooltip-classes`。`TooltipOptions.classes` 自 Obsidian 1.8.7 起提供，
 * 本项目 manifest 的 `minAppVersion` 高于它，不必做版本兜底。
 *
 * 提示文案里**能 i18n 的部分**由调用方用 `t()` 取好再传进来 —— 键写成字面量才会被
 * i18n 静态检查扫到；纯用户数据（会话标题、模型名之类）原样传入即可。
 */
export function applyTooltip(el: HTMLElement, text: string): void {
  setTooltip(el, text, { classes: [TOOLTIP_CLASS] });
}

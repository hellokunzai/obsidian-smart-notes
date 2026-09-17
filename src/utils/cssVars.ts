/**
 * CSS 自定义属性的写入薄封装。
 *
 * 为什么不用 `el.setCssProps(...)`：那是 **Obsidian 1.13.0 才有的 API**，而本插件
 * `minAppVersion` 是 1.11.4 —— 1.11.x / 1.12.x 客户端上会抛
 * `setCssProps is not a function`，且官方 d.ts 里它**没有 `@since` 标记**，
 * `obsidianmd/no-unsupported-api` 规则永远查不出来（`tsc` 也查不出）。
 *
 * 这里用 `style.setProperty` 做等价实现：两者对 `--` 开头的自定义属性行为一致
 * （都是写内联自定义属性），消费端 styles.css 用 `var(--x, 默认值)` 兜底。
 * 值以变量/模板串传入，不会落入 `obsidianmd/no-static-styles-assignment` 的射程。
 */
export function setCssVars(el: HTMLElement, vars: Record<string, string>): void {
  for (const key in vars) {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      el.style.setProperty(key, vars[key]);
    }
  }
}

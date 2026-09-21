/**
 * DOM 事件辅助工具。
 */

/**
 * 给 DOM 元素挂载 async 事件处理器。
 *
 * `addEventListener` 期望的监听器返回 void，直接传 async 函数会返回 Promise
 * （typescript-eslint 的 no-misused-promises 会据此告警）。这里统一把返回值
 * 丢弃，既保留「异步处理器」的写法，又不触发规则。
 */
export function addAsyncListener(
  el: HTMLElement,
  type: string,
  handler: () => void | Promise<void>
): void {
  el.addEventListener(type, () => {
    void handler();
  });
}

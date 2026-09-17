/**
 * 设置页标签栏的「溢出 → 左右滚动箭头」判定。
 *
 * 刻意做成纯函数：这里全部是可以脱离 Obsidian / 浏览器跑的算术，
 * 离线冒烟测试见 `.workbuddy/smoke/tabs-nav.test.js`。
 * DOM 侧只负责把量出来的数字喂进来、把结果落成 CSS 类。
 */

/** 一次几何读数，单位都是 px。 */
export interface TabsGeometry {
  /** 标签自然总宽（首标签左缘 → 末标签右缘），不含 CSS 占位伪元素。 */
  natural: number;
  /** 标签条可用宽（内容盒宽度）。 */
  avail: number;
  /** 当前滚动位置。 */
  scrollLeft: number;
  /** 还能往右滚多少。 */
  maxScroll: number;
}

/** 视作「已到尽头」的容差，以及「是否溢出」的容差。 */
const EDGE_EPSILON = 1;

/**
 * 标签自然总宽。
 *
 * 不用 `scrollWidth`：溢出时两端会由 `::before` / `::after` 撑出箭头占位，
 * 那部分宽度会混进 `scrollWidth`，于是「加了占位 → 更溢出 → 永远摘不掉占位」自锁。
 * 首末标签的矩形与滚动位置、占位都无关，两种方案的门槛因此完全一致。
 */
export function naturalTabsWidth(
  first: { left: number; right: number } | undefined,
  last: { left: number; right: number } | undefined
): number {
  if (!first || !last) return 0;
  return Math.max(0, last.right - first.left);
}

/** 标签装不下 → 两端出现箭头。放得下时为 false，一条箭头规则都不生效。 */
export function isTabsOverflowing(geo: TabsGeometry): boolean {
  return geo.natural - geo.avail > EDGE_EPSILON;
}

/**
 * 该方向的箭头是否已到头。
 *
 * 到头 = 该侧没有更多内容可滚 → 变淡 + 不可点，但**仍然显示**：
 * 两端常显、只随滚动位置改变强弱，用户一眼就知道这条可以左右翻。
 * 没有溢出时不显示箭头，所以这里一并返回 true（不可点）。
 */
export function isTabNavBlocked(geo: TabsGeometry, dir: -1 | 1): boolean {
  if (!isTabsOverflowing(geo)) return true;
  return dir < 0
    ? geo.scrollLeft <= EDGE_EPSILON
    : geo.scrollLeft >= geo.maxScroll - EDGE_EPSILON;
}

/** 点一次箭头滚多远：默认翻一屏；最小 80px 保证窄面板下也看得出位移。 */
export function tabScrollStep(dir: -1 | 1, availWidth: number): number {
  return dir * Math.max(80, availWidth - 60);
}

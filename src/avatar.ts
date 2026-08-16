import { App, TFile } from "obsidian";
import type { RoleInfo } from "./settings";

/**
 * 内置预设头像（emoji）。点击即选中，存储值为该 emoji 字符本身。
 * 仅用 emoji 是为了零文件 IO、跨设备一致；用户可额外从 vault 选图或上传。
 */
export const AVATAR_PRESETS: string[] = [
  "🤖", "📚", "💡", "🎯", "🧠", "⚡",
  "🦊", "🐱", "🌟", "🔥", "🌈", "🍀",
];

/** 12 色调色板：用于名字首字母 fallback 色块（饱和、在深浅主题都可读）。 */
const AVATAR_PALETTE = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#06b6d4", "#3b82f6", "#6366f1",
  "#8b5cf6", "#ec4899",
];

/** 将头像尺寸(px)映射到预设 CSS 类名，避免内联 style。 */
function pickAvatarSizeClass(size: number): string | null {
  if (size >= 64) return "ana-avatar--s64";
  if (size >= 56) return "ana-avatar--s56";
  if (size >= 48) return "ana-avatar--s48";
  if (size >= 40) return "ana-avatar--s40";
  if (size >= 36) return "ana-avatar--s36";
  if (size >= 32) return "ana-avatar--s32";
  if (size >= 28) return "ana-avatar--s28";
  if (size >= 24) return "ana-avatar--s24";
  // 极小尺寸回退：用最近的类或交由 CSS 默认
  return "ana-avatar--s24";
}

/**
 * FNV-1a 哈希：把名字映射到稳定色块（同名恒定同色）。
 * 用 32 位无符号乘法（Math.imul）避免 JS 大数精度问题。
 */
export function hashColor(name: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

/** 该值是否为内置 emoji 预设（存储值即 emoji 字符本身）。 */
export function isPresetAvatar(value: string): boolean {
  return AVATAR_PRESETS.includes(value);
}

/** 该值是否为图片来源（data URI 或 vault 内图片相对路径）。 */
export function isImageAvatar(value: string): boolean {
  return value.startsWith("data:") || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(value);
}

/**
 * 把头像渲染进 container（container 会被清空后写入）。
 *
 * 优先级：
 *  - emoji 预设         → 文本节点
 *  - 图片（base64 / vault 相对路径）→ <img>（vault 文件被删除时降级为色块）
 *  - 缺省 / 其他        → 名字首字母色块（fallback）
 *
 * @param app     Obsidian App 实例（用于解析 vault 图片路径）
 * @param container 目标容器元素（会被 addClass "ana-avatar" 并内联尺寸）
 * @param role    角色（只需 name + 可选 avatar）
 * @param size    直径（px）
 */
export function renderAvatar(
  app: App,
  container: HTMLElement,
  role: Pick<RoleInfo, "name" | "avatar">,
  size: number
): void {
  container.empty();
  container.addClass("ana-avatar");
  // 通过预设尺寸类驱动宽高（避免内联 style）
  const sizeCls = pickAvatarSizeClass(size);
  if (sizeCls) container.addClass(sizeCls);
  container.setAttribute("aria-hidden", "true"); // 与文字名一同出现时避免读屏重复播报

  const value = role.avatar ?? "";
  const name = role.name || "?";

  // 1) 内置 emoji 预设
  if (value && isPresetAvatar(value)) {
    container.createSpan({ cls: "ana-avatar-emoji", text: value });
    container.addClass("ana-avatar--has-emoji");
    return;
  }

  // 2) 图片：base64 直出；vault 相对路径经 getResourcePath 解析
  let imgSrc: string | null = null;
  if (value && isImageAvatar(value)) {
    if (value.startsWith("data:")) {
      imgSrc = value;
    } else {
      const file = app.vault.getAbstractFileByPath(value);
      if (file instanceof TFile) {
        imgSrc = app.vault.getResourcePath(file);
      }
    }
  }

  if (imgSrc) {
    container.createEl("img", {
      cls: "ana-avatar-img",
      attr: { src: imgSrc, alt: name, loading: "lazy" },
    });
    return;
  }

  // 3) fallback：首字母色块
  const ch = Array.from(name)[0]?.toUpperCase() ?? "?";
  container.createSpan({ cls: "ana-avatar-letter", text: ch });
  container.addClass("ana-avatar--letter");
  // 背景色由名字哈希动态决定，通过 CSS 变量注入（避免直接 .style.background=）
  container.style.setProperty("--ana-avatar-bg", hashColor(name));
}

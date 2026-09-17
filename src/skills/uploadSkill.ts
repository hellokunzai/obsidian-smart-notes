import { unzipSync } from "fflate";
import { Vault } from "obsidian";
import type AiNoteAgentPlugin from "../main";
import { getSkillsDir, ensureFolder } from "../utils/aiFolder";
import { t } from "../i18n";

const MAX_ENTRIES = 1000;

/**
 * 把 fflate 解出的 Uint8Array 复制成独立的 ArrayBuffer。
 *
 * zip 里既有文本也有二进制（图片 / 字体 / 二进制脚本），必须按原始字节写盘。
 * 早先走 `adapter.write(path, strFromU8(content))` 的字符串通道：内容会先按 UTF-8
 * 解码再编码，非法字节序列被替换成 U+FFFD，写出来的图片/字体全部损坏。
 * 另外 fflate 的切片可能只是大 buffer 上的视图，必须按 byteOffset 截取，
 * 否则会把整块未用数据一起写出去。
 */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength
  ) as ArrayBuffer;
}

export interface UploadSkillResult {
  success: boolean;
  message: string;
  installedPath?: string;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "-");
}

function basenameWithoutExt(filename: string): string {
  const base = filename.slice(filename.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * 将用户选择的 skill zip 包解压到 AI 文件夹的 skills/ 目录。
 *
 * 目录策略：
 * - 若 zip 根目录恰好只有一个顶层文件夹，且该文件夹下存在 SKILL.md，
 *   则直接把这个文件夹作为 skill 套件解压到 skills/ 下。
 * - 否则（zip 根目录直接是文件，或有多个顶层文件夹），用 zip 文件名创建
 *   一个文件夹，把所有内容放进去。
 *
 * 安全措施：拒绝路径穿越（../）、跳过隐藏文件/Mac 元数据、限制条目数。
 */
export async function uploadSkillFromZip(
  plugin: AiNoteAgentPlugin,
  file: File
): Promise<UploadSkillResult> {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    return { success: false, message: t("notice.skillUpload.invalidFormat") };
  }

  let entries: Record<string, Uint8Array>;
  try {
    const arrayBuffer = await file.arrayBuffer();
    entries = unzipSync(new Uint8Array(arrayBuffer));
  } catch (e) {
    // 读文件与解压都会抛（文件被占用/移动、包损坏），一并兜在这里。
    // 不能让异常冒到事件回调之外——那样连 Notice 都弹不出来，只表现为「点了没反应」。
    return {
      success: false,
      message: t("notice.skillUpload.extractFailed", {
        error: (e as Error).message,
      }),
    };
  }

  const paths = Object.keys(entries);
  if (paths.length === 0) {
    return { success: false, message: t("notice.skillUpload.empty") };
  }
  if (paths.length > MAX_ENTRIES) {
    return {
      success: false,
      message: t("notice.skillUpload.tooManyEntries", {
        count: String(MAX_ENTRIES),
      }),
    };
  }

  for (const p of paths) {
    // 按路径段判断穿越：p.includes("..") 会把 "foo..bar.md" 这种合法文件名也拒掉
    if (p.split(/[\\/]/).includes("..") || p.startsWith("/")) {
      return { success: false, message: t("notice.skillUpload.unsafePath") };
    }
  }

  const vault = plugin.app.vault;
  const skillsDir = getSkillsDir(plugin);

  // 收集每个条目的第一级目录/文件名
  const firstParts = paths
    .map((p) => {
      const trimmed = p.replace(/^\//, "");
      const idx = trimmed.indexOf("/");
      return idx >= 0 ? trimmed.slice(0, idx) : trimmed;
    })
    .filter(Boolean);
  const uniqueRoots = Array.from(new Set(firstParts));

  // 判断是否为「单顶层文件夹 + 内含 SKILL.md」结构
  const singleRootName =
    uniqueRoots.length === 1 && uniqueRoots[0]
      ? uniqueRoots[0]
      : undefined;
  const hasSkillMd =
    singleRootName !== undefined &&
    paths.some((p) => p.replace(/^\//, "") === `${singleRootName}/SKILL.md`);

  let targetFolder: string;
  let stripRoot = false;

  if (singleRootName && hasSkillMd) {
    targetFolder = `${skillsDir}/${sanitizeFilename(singleRootName)}`;
    stripRoot = true;
  } else {
    const folderName = sanitizeFilename(basenameWithoutExt(file.name));
    targetFolder = `${skillsDir}/${folderName}`;
    stripRoot = false;
  }

  try {
    await ensureFolder(vault, targetFolder);
  } catch (e) {
    return {
      success: false,
      message: t("notice.skillUpload.mkdirFailed", {
        error: (e as Error).message,
      }),
    };
  }

  let writtenCount = 0;
  try {
    for (const [path, content] of Object.entries(entries)) {
      const normalized = path.replace(/^\//, "");

      // 跳过目录条目、隐藏文件、Mac OS X 元数据
      if (
        normalized.endsWith("/") ||
        normalized.startsWith("__MACOSX/") ||
        normalized.split("/").some((part) => part.startsWith("."))
      ) {
        continue;
      }

      let relativePath = normalized;
      if (stripRoot && singleRootName) {
        const prefix = `${singleRootName}/`;
        if (normalized.startsWith(prefix)) {
          relativePath = normalized.slice(prefix.length);
        }
      }

      if (!relativePath) continue;

      const destPath = `${targetFolder}/${relativePath}`;
      const lastSlash = destPath.lastIndexOf("/");
      if (lastSlash > 0) {
        const parentDir = destPath.slice(0, lastSlash);
        await ensureFolder(vault, parentDir);
      }

      // 按原始字节写盘，不走 adapter.write 的字符串通道（原因见 toArrayBuffer）
      await vault.adapter.writeBinary(destPath, toArrayBuffer(content));
      writtenCount++;
    }
  } catch (e) {
    return {
      success: false,
      message: t("notice.skillUpload.writeFailed", {
        error: (e as Error).message,
      }),
    };
  }

  return {
    success: true,
    message: t("notice.skillUpload.success", {
      count: String(writtenCount),
    }),
    installedPath: targetFolder,
  };
}

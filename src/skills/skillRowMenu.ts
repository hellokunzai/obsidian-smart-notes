import { App, Menu, Platform } from "obsidian";
import { t } from "../i18n";
import { revealSkillInFileManager, type SkillTarget } from "./skills";

/** 构建某一行「更多操作」菜单所需的上下文。 */
export interface SkillRowMenuOptions {
  app: App;
  /** 已解析好的可操作目标（套件文件夹 / 根级 SKILL.md）。 */
  target: SkillTarget;
  /** skills/ 目录路径，作为根级 SKILL.md 的「打开文件夹」兜底。 */
  skillsDir: string;
  /** 用户确认删除后执行。 */
  onDelete: () => void;
}

/**
 * 构建 skill 行的「更多操作」菜单。
 *
 * 顺序与参考图一致：打开文件夹在上、删除在下，中间一条分隔线把危险操作隔开
 * （删除项挂 `setWarning(true)`，主题会给它 --text-error 配色）。
 *
 * 拆成独立函数而不是内联在设置页里的原因：菜单项的构成 / 顺序 / 平台分支
 * 正是静态检查查不出、又最容易被后续重构悄悄改坏的部分——独立出来才能在
 * 离线冒烟测试里断言「有哪些项、什么顺序、点下去调了什么」。
 */
export function buildSkillRowMenu(opts: SkillRowMenuOptions): Menu {
  const { app, target, skillsDir, onDelete } = opts;
  const menu = new Menu();

  // 「打开文件夹」只在桌面端出现：skill 位于 <AI 文件夹>/skills/（vault 隐藏
  // 目录，Obsidian 文件浏览器不索引这类目录），移动端没有可用的系统文件管理器。
  // 与其放一个点了没反应的死项，不如不出现。
  if (Platform.isDesktopApp) {
    menu.addItem((item) =>
      item
        .setTitle(t("settings.defaultSkills.rowMenu.openFolder"))
        .setIcon("folder-open")
        .onClick(() => {
          // 文件夹套件直接定位它自己；根级 SKILL.md 没有套件文件夹，
          // 退而定位 skills/ 目录（那也是用户唯一能看到它的地方）
          revealSkillInFileManager(
            app,
            target.isFolder ? target.path : skillsDir
          );
        })
    );
    menu.addSeparator();
  }

  menu.addItem((item) =>
    item
      .setTitle(t("settings.defaultSkills.rowMenu.delete"))
      .setIcon("trash-2")
      .setWarning(true)
      .onClick(onDelete)
  );

  return menu;
}

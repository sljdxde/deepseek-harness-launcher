// 测试专用的跨平台「建链接」助手。
//
// Windows 上普通 symlink 需要管理员权限或开发者模式，普通用户建不了
// （EPERM）；目录 junction（reparse point）任何用户都能建，语义上也够用：
// 解析出来同样是「链接指向另一个目录」，Node 的 fs/lstat 认它是目录。
//
// 生产侧（windows/internal/assets/pluginlinks_windows.go）也是同一套降级：
// symlink → junction → 复制目录。测试要跟生产同一套语义，否则
// 「Windows 上安装插件能不能被识别」这种问题根本测不出来。
import { symlink, lstat, readlink, rm, mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const isWindows = process.platform === 'win32';

/** 建一个指向 target 的目录链接（Windows 用 junction，其他用 symlink）。 */
export async function linkDir(target, linkPath) {
  await mkdir(dirname(linkPath), { recursive: true });
  if (isWindows) {
    try {
      await symlink(target, linkPath, 'junction');
      return 'junction';
    } catch (error) {
      // junction 也不可用时（少见：跨卷、无权限）退回复制目录。
      await copyDir(target, linkPath);
      return 'copy';
    }
  }
  await symlink(target, linkPath, 'dir');
  return 'symlink';
}

/** 建一个指向 target 的文件链接（Windows 下没有免权限的文件链接，退回复制）。 */
export async function linkFile(target, linkPath) {
  await mkdir(dirname(linkPath), { recursive: true });
  if (isWindows) {
    await copyFile(target, linkPath);
    return 'copy';
  }
  await symlink(target, linkPath, 'file');
  return 'symlink';
}

/**
 * 建一个**悬空**链接（指向不存在的目标）——用来模拟「装坏了的残留」。
 * Windows 的 junction 不允许悬空（目标必须存在），所以这里写一个
 * 指向不存在路径的 junction：Windows 会接受，读取时表现为「找不到」。
 */
export async function linkDangling(target, linkPath) {
  await mkdir(dirname(linkPath), { recursive: true });
  if (isWindows) {
    await symlink(target, linkPath, 'junction');
    return 'junction';
  }
  await symlink(target, linkPath);
  return 'symlink';
}

async function copyDir(src, dst) {
  await mkdir(dst, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) await copyDir(from, to);
    else await copyFile(from, to);
  }
}

/** 链接目标（读不出来时返回 null——junction 的 readlink 在 Windows 上要特殊处理）。 */
export async function readLinkTarget(linkPath) {
  try {
    return await readlink(linkPath);
  } catch {
    return null;
  }
}

/** 这个路径是不是「链接」（symlink 或 junction）。 */
export async function isLink(path) {
  try {
    const info = await lstat(path);
    return info.isSymbolicLink();
  } catch {
    return false;
  }
}

/** 这个路径存不存在（跟随链接；悬空链接返回 false）。 */
export async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** 删掉一个链接（不管它是 symlink 还是 junction）。 */
export async function removeLink(path) {
  await rm(path, { recursive: true, force: true });
}

export { isWindows };

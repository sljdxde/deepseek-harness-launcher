#!/usr/bin/env python3
"""停用 dsh 运行时的插件兼容性判定（启动 / 更新 / 安装三条路径）。

背景：启动器仓库里的静态扫描与更新门禁移除后，`dsh plugin add` 仍会在装前
预检、装后复核，任何 engines.dsh / peerDependencies 与运行时不符都会
`installation rejected` 并回滚。这两处判定（以及启动期 skip bundle、插件市场
标 incompatible）全部走 @deepseek-ai/dsh-app-boot 的
`evaluatePluginCompatibility`，在这里一处停用即可覆盖。

改的是 ~/.dsh/runtime/node_modules 下的运行时文件，不在本仓库内，也不在 git
里：dsh 本体升级会覆盖它们，升级后需要重跑本脚本。脚本幂等，每个文件只备份
一次，重复执行不会叠加补丁。

不需要重启常驻的 dsh web 进程：`dsh plugin add` 每次都是新起的 CLI 子进程，
会重新加载补丁后的模块。已加载 host 侧模块的旧进程在下次重启 dsh 后自然生效。
"""
from pathlib import Path
from datetime import datetime
import sys

ROOT = Path.home() / ".dsh/runtime/node_modules/@deepseek-ai"
MARK = "dsh-no-plugin-compat"

# (相对路径, 原文, 补丁后文本)。原文必须精确命中一次，否则整轮不写盘。
PATCHES = [
    (
        "dsh-app-boot/lib/index.js",
        "function evaluatePluginCompatibility(manifest, exemptions = {}, runtimeVersion = getDshRuntimeVersion()) {\n"
        "\truntimeVersionOf(runtimeVersion);",
        "function evaluatePluginCompatibility(manifest, exemptions = {}, runtimeVersion = getDshRuntimeVersion()) {\n"
        "\t// dsh-no-plugin-compat: 插件兼容性检测已整体停用（启动 / 更新 / 安装）。\n"
        "\t// 保留下方原始实现但早退返回「全部满足」；重跑 scripts/disable-dsh-plugin-compat.py 可恢复/重打。\n"
        "\treturn void 0;\n"
        "\truntimeVersionOf(runtimeVersion);",
    ),
    (
        "dsh-plugin-manager/lib/types/operations.js",
        "        for (const raw of namedSpecs(args)) {",
        "        // dsh-no-plugin-compat: 跳过装前的联网 manifest 兼容性预检（顺带省掉一次 pnpm view）。\n"
        "        for (const raw of []) {",
    ),
    (
        "dsh-plugin-manager/lib/index.js",
        "\t\tfor (const raw of namedSpecs(args)) try {",
        "\t\t// dsh-no-plugin-compat: 跳过装前的联网 manifest 兼容性预检（顺带省掉一次 pnpm view）。\n"
        "\t\tfor (const raw of []) try {",
    ),
]


def main() -> int:
    if not ROOT.is_dir():
        print(f"runtime 目录不存在：{ROOT}", file=sys.stderr)
        return 1

    # 先全部校验，避免改到一半才发现某个版本结构变了。
    plans = []
    for rel, old, new in PATCHES:
        path = ROOT / rel
        if not path.is_file():
            print(f"缺少文件：{path}", file=sys.stderr)
            return 1
        text = path.read_text(encoding="utf-8")
        if MARK in text:
            plans.append((path, None, None, "already patched"))
            continue
        count = text.count(old)
        if count != 1:
            print(f"锚点命中 {count} 次（期望 1 次），拒绝改写：{path}", file=sys.stderr)
            return 1
        plans.append((path, text, text.replace(old, new, 1), "patch"))

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    for path, _old_text, new_text, action in plans:
        if action == "already patched":
            print(f"跳过（已打补丁）: {path}")
            continue
        backup = path.with_name(path.name + f".bak-{stamp}")
        if not any(path.parent.glob(path.name + ".bak-*")):
            backup.write_bytes(path.read_bytes())
            print(f"备份: {backup}")
        path.write_text(new_text, encoding="utf-8")
        print(f"已打补丁: {path}")

    print("完成：插件兼容性判定已停用。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

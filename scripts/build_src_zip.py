#!/usr/bin/env python3
"""重建 battle-forge-app-src.zip（GitHub Pages 部署源码包）
结构：battle-forge/ 根目录，包含 src/public/scripts(st集成与测试资产)/.github/configs/download 交付包
运行: python3 scripts/build_src_zip.py
"""
import os
import zipfile

BASE = "/home/z/my-project"
OUT = os.path.join(BASE, "download", "battle-forge-app-src.zip")

INCLUDE_DIRS = [
    "src",
    "public",
    "scripts/ai-probe.ts",
    "scripts/build-embed-harness.py",
    "scripts/e2e-datalayer.sh",
    "scripts/e2e-initiative.sh",
    "scripts/test-fixtures/dmmsg.txt",
    "scripts/engine-tests.ts",
    "scripts/adversarial-tests.ts",
    "scripts/semantics-tests.ts",
    "scripts/st-pipeline-sim.mjs",
    "scripts/plan-probe.ts",
    "scripts/generate_st_package.py",
    "scripts/build_src_zip.py",
    ".github",
    "st-integration",
    "prisma",
    "download/battle-forge-st-pack",
]
INCLUDE_FILES = [
    "package.json",
    "README.md",
    ".gitignore",
    "next.config.ts",
    "tsconfig.json",
    "eslint.config.mjs",
    "postcss.config.mjs",
    "tailwind.config.ts",
    "components.json",
]

EXCLUDE_PARTS = {"node_modules", ".next", "__pycache__", ".git"}

def main() -> None:
    entries: list[str] = []
    for inc in INCLUDE_DIRS:
        full = os.path.join(BASE, inc)
        if os.path.isfile(full):
            entries.append(inc)
            continue
        for root, dirs, files in os.walk(full):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_PARTS]
            for f in files:
                rel = os.path.relpath(os.path.join(root, f), BASE)
                entries.append(rel)
    for f in INCLUDE_FILES:
        if os.path.exists(os.path.join(BASE, f)):
            entries.append(f)

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel in sorted(set(entries)):
            src = os.path.join(BASE, rel)
            z.write(src, os.path.join("battle-forge", rel))

    size = os.path.getsize(OUT)
    with zipfile.ZipFile(OUT) as z:
        n = len([x for x in z.namelist() if not x.endswith("/")])
    print(f"✅ {OUT} ({size/1024:.0f} KB, {n} files)")

if __name__ == "__main__":
    main()

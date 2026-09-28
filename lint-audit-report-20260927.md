# ESLint 报告 — `npm run lint` 的 78 个报错审计

日期：2026-09-27 ｜ 命令：`npm run lint`（实际执行 `eslint .`，全仓库范围）

## 结论（TL;DR）

**78 个报错里没有一个是本次 3D 棋子改动引入的。** 真实源码错误仅 3 个（其中 2 个是 shadcn/ui 脚手架模板自带，1 个是校验页固有写法）；其余 75 个全部来自 `.engtest`/`.engtest_run` 测试缓存产物，属于应当被 lint 忽略的噪音。

本次改动的文件（`src/components/battle/token3d/`、`src/components/battle/BattleMapIso.tsx`）**0 报错**。

## 按规则分布

| 数量 | 规则 | 性质 |
|---:|---|---|
| 75 | `@typescript-eslint/no-require-imports` | 测试缓存产物噪音 |
| 3 | `react-hooks/set-state-in-effect` | 真实源码（2 个模板固有 + 1 个校验页） |

## 按文件分布

| 数量 | 文件 | 归类 |
|---:|---|---|
| 56 | `.engtest_run/**`（编译出的 CommonJS 引擎副本 + 测试） | 测试运行时缓存，**应加入 lint ignores** |
| 19 | `.engtest/*.js`、`scripts/*.js`（regression-test / houserule-tests） | CommonJS 测试工具脚本 |
| 1 | `src/hooks/use-mobile.ts:14` | shadcn/ui 模板固有 |
| 1 | `src/components/ui/carousel.tsx:98` | shadcn/ui 模板固有 |
| 1 | `src/app/emblem-preview/page.tsx:51` | 3D 校验页（旧版同样写法） |

## 建议修复

### 1. 消除 75 个噪音（一行配置）

`.engtest`/`.engtest_run` 是引擎测试的临时编译产物，不应纳入源码 lint。在 `eslint.config.mjs:47` 的 `ignores` 数组中追加：

```js
ignores: [
  "node_modules/**", ".next/**", "out/**", "build/**",
  "next-env.d.ts", "examples/**", "skills",
  ".engtest/**", ".engtest_run/**",   // ← 新增：引擎测试缓存产物
],
```

改完后 `npm run lint` 将从 78 → 3。若希望归零，可再决定是否把 `scripts/*.js`（手写 CommonJS 测试）一并忽略或改成 ESM——这些是工具脚本，不影响应用构建，建议保留现状仅忽略缓存目录。

### 2. 三条真实源码错误说明

均为 `react-hooks/set-state-in-effect`（React 新规则：避免在 effect 体里同步 setState，防止级联渲染）：

- **`src/hooks/use-mobile.ts:14`、`src/components/ui/carousel.tsx:98`** — shadcn/ui 官方模板代码，全社区普遍存在此写法，功能正确（挂载时读一次视口/同步轮播状态）。除非升级 shadcn 模板，不建议自行改动，可选择对该两文件加 eslint 局部豁免。
- **`src/app/emblem-preview/page.tsx:51`** — `emblem-preview` 是不参与生产的临时校验页（旧版页面同样写法、同样报错），`setReady(true)` 仅控制地图组件挂载时机，无性能影响。随下次校验页重构顺手处理即可。

## 与本次 3D 改动的关系

本次交付新增/修改：`token3d/builders.ts`、`token3d/stage.ts`、`BattleMapIso.tsx`、`emblem-preview/page.tsx`、`package.json`（+three 依赖）。其中除校验页那条固有写法外，其余全部零 lint 问题；TypeScript 全量类型检查（`tsc --noEmit`）通过；回归测试 84 项 + 引擎测试 266 项全绿。

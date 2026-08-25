# tests/ — V10b 功能测试台（TB）

EDA 风格的功能验证：像 testbench 驱动 DUT 一样，用无头浏览器驱动游戏页面。

## 运行

```powershell
node tests/tb.mjs          # 本地模式：起临时 HTTP 服务测仓库当前文件
node tests/tb.mjs --live   # 线上模式：测 https://foxxy777.github.io/music-games-demo/
```

- 零 npm 依赖（Node ≥21，用内置 WebSocket）
- 自动拉起独立无头 Edge（临时 profile + 独立调试端口，不碰 OpenClaw 托管的 18802）
- AudioContext 用桩替换（时序确定、不依赖声卡）；WAV 资产单独走 fetch 校验 RIFF/WAVE 头

## 覆盖的"测试点"

| # | 测试 | 断言要点 |
|---|------|----------|
| T0 | 无 JS 报错 | 页面级 error 收集器为空 |
| T1 | 键盘渲染 | 7 键、Do~Si 顺序、音名 4C~4B、斯克里亚宾色相变量 |
| T2 | 音频资产 | 14 个 WAV 全部 200 + RIFF/WAVE 头 + 大小合理（防 08-24 那种错素材混入的结构性回归） |
| T3 | 开局状态机 | startGame → listening → repeating，题长=难度，进度点数正确 |
| T4 | 答对流程 | 逐键点击 → 交卷按钮解锁 → 得分 100 / combo+1 / 判定字 / 下一轮按钮出现 |
| T5 | 答错流程 | combo 清零、判定字、正确答案 reveal 闪现、状态栏给答案 |
| T6 | 撤销/清空/重听回归 | 撤销清空状态正确；重听题目不清空已按答案（08-24 修复项）；播我的答案不影响作答 |
| T7 | 布局不变量 | 舞台 16:9、7 键等宽、键排占行宽 ≥95%、图片区 ≥50% 高 |
| T8 | 手机缩放 | 888×444 视口下舞台等比缩放不出界、键 CSS 宽度仍可点（>40px） |

退出码非 0 = 有 FAIL。以后改完代码跑一遍再 push，等于自带 QA。

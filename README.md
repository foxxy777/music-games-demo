# music-games-demo · V11 音符对撞（线上 DEMO）

**线上地址：** https://foxxy777.github.io/music-games-demo/

当前版本：**V11 音波对撞卡牌原型**（2026-09-01 起为唯一在线版本）

- 玩法：7 唱名横轨对撞，杀戮尖塔式抽卡/能量/敌人意图，do+mi+sol 大三和弦共鸣
- 布局：手机竖屏自动切换竖版（点一下看说明、再点一下打出）；桌面/横屏为原版布局
- 音效：Web Audio 实时合成，零资产
- 源码与设计文档：`E:\git_repo\music-games\v11\`（主力仓 foxxy777/music-games）

## 旧版本

小星星五线谱版等旧版本已于 2026-09-01 下线（大爷指示全力转 V11），
完整存档见 git tag `legacy-v10-final` / `score-display-v1-2026-08-30` / `initial-v1-2026-08-24`。

## 本地测试

```
node tests/serve.mjs           # 本地静态服务 127.0.0.1:8117
node tests/smoke.mjs           # 横屏冒烟 9 项
node tests/portrait_check.mjs  # 竖屏手机适配 12 项（需 Edge CDP 127.0.0.1:18802）
```

# Ace Badminton

Zepp OS `API_LEVEL 4.2` 羽毛球运动扩展项目，面向 `subType = 92`。

## 当前实现

- 运动扩展入口：`data-widget`
- 目标运动：羽毛球
- 目标设备优先适配：Amazfit Active 2 NFC Round（圆屏 `466 x 466`）
- 实时指标：挥拍次数、最大拍速、正手/反手、上手/下手/平抽挡、最长连拍、时长、卡路里、心率
- 分析指标：爆发、进攻、对抗、耐力、活跃 五维雷达图

## 目录

```txt
app.json
app.js
page/widget/index.js
utils/badminton-engine.js
```

## 说明

- Zepp 官方运动扩展当前是单页形态，因此项目采用单页内 `实时 / 分析` 点击切换。
- 挥拍、拍速、球型和雷达图目前基于加速度计 + 陀螺仪的启发式算法，不是官方底层识别结果；阈值和分类规则应结合你的真机挥拍数据继续校准。
- 运动总结会在 `onPause / onDestroy` 时持久化为最近一次分析结果，便于再次进入扩展时查看。

## 开发

```bash
npm install
zeus dev
```

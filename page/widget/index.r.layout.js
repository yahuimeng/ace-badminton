// ============================================================
// 圆形屏幕布局 (466×466) - Active 2 NFC
// ============================================================
export const LAYOUT_W = 466
export const LAYOUT_H = 466

// ---- 顶部：时长 ----
export const durStyle = {
  x: 0, y: 10, w: 466, h: 75,
  textSize: 56,
}

// ---- 第1行：最高速度 ----
export const spdStyle = {
  x: 68, y: 93, w: 170, h: 58,      // 数值
  labelX: 68, labelY: 151, labelH: 32,  // 标签+单位
  textSize: 44,
  labelSize: 18,
}

// ---- 第1行：频率 ----
export const freqStyle = {
  x: 228, y: 93, w: 170, h: 58,
  labelX: 228, labelY: 151, labelH: 32,
  textSize: 44,
  labelSize: 18,
}

// ---- 第2行：挥拍 ----
export const swgStyle = {
  x: 68, y: 211, w: 170, h: 58,
  labelX: 68, labelY: 269, labelH: 32,
  textSize: 44,
  labelSize: 18,
}

// ---- 第2行：连拍 ----
export const rallyStyle = {
  x: 228, y: 211, w: 170, h: 58,
  labelX: 228, labelY: 269, labelH: 32,
  textSize: 44,
  labelSize: 18,
}

// ---- 第3行：正手 ----
export const fhStyle = {
  x: 68, y: 329, w: 170, h: 58,
  labelX: 68, labelY: 387, labelH: 32,
  textSize: 44,
  labelSize: 18,
}

// ---- 第3行：反手 ----
export const bhStyle = {
  x: 228, y: 329, w: 170, h: 58,
  labelX: 228, labelY: 387, labelH: 32,
  textSize: 44,
  labelSize: 18,
}

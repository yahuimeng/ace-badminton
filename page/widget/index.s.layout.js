// ============================================================
// 矩形屏幕布局 (390×450) - Active 2 Square
// 状态栏已隐藏，可用全屏，高度 450px
// ============================================================
export const LAYOUT_W = 390
export const LAYOUT_H = 450

// ---- 顶部：时长 ----
export const durStyle = {
  x: 0, y: 15, w: 390, h: 50,
  textSize: 42,
}

// ---- 第1行：最高速度 ----
export const spdStyle = {
  x: 25, y: 90, w: 160, h: 50,
  labelX: 25, labelY: 140, labelH: 28,
  textSize: 36,
  labelSize: 16,
}

// ---- 第1行：频率 ----
export const freqStyle = {
  x: 205, y: 90, w: 160, h: 50,
  labelX: 205, labelY: 140, labelH: 28,
  textSize: 36,
  labelSize: 16,
}

// ---- 第2行：挥拍 ----
export const swgStyle = {
  x: 25, y: 200, w: 160, h: 50,
  labelX: 25, labelY: 250, labelH: 28,
  textSize: 36,
  labelSize: 16,
}

// ---- 第2行：连拍 ----
export const rallyStyle = {
  x: 205, y: 200, w: 160, h: 50,
  labelX: 205, labelY: 250, labelH: 28,
  textSize: 36,
  labelSize: 16,
}

// ---- 第3行：正手 ----
export const fhStyle = {
  x: 25, y: 310, w: 160, h: 50,
  labelX: 25, labelY: 360, labelH: 28,
  textSize: 36,
  labelSize: 16,
}

// ---- 第3行：反手 ----
export const bhStyle = {
  x: 205, y: 310, w: 160, h: 50,
  labelX: 205, labelY: 360, labelH: 28,
  textSize: 36,
  labelSize: 16,
}

import { Accelerometer, FREQ_MODE_HIGH, Gyroscope } from '@zos/sensor'
import { getText } from '@zos/i18n'
import { log } from '@zos/utils'
import { localStorage } from '@zos/storage'
import hmUI, { align, createWidget, prop, text_style, widget, setStatusBarVisible, sport_data, edit_widget_group_type, getSportData } from '@zos/ui'
import { createEngine } from '../../utils/badminton-engine'

const logger = log.getLogger('ace-badminton-widget')

// ============================================================
// 持久化存储键名
// ============================================================
const STORAGE_KEY = 'ace_badminton_session'

// ============================================================
// 暂停检测配置
// ============================================================
const PAUSE_CHECK_INTERVAL_MS = 1000  // 每秒检查一次
const PAUSE_THRESHOLD_S = 10          // DURATION_NET 超过 10 秒不变 = 暂停

// ============================================================
// 颜色常量
// ============================================================
const C_YELLOW = 0xfacc15
const C_RED    = 0xf87171
const C_GREEN  = 0x4ade80
const C_BLUE   = 0x60a5fa
const C_ORANGE = 0xfb923c
const C_GRAY   = 0x999999
const C_BG     = 0x0d0d1a

// ============================================================
// 导入布局配置 (官方 zosLoader 模式)
// ============================================================
import {
  LAYOUT_W,
  LAYOUT_H,
  durStyle,
  spdStyle,
  freqStyle,
  swgStyle,
  rallyStyle,
  fhStyle,
  bhStyle,
} from 'zosLoader:./index.[pf].layout.js'

// ============================================================
// DataWidget
// 时长用官方 SPORT_DATA DURATION_NET（暂停时自动停止）
// 其他数据全部自己计算
// ============================================================
DataWidget({
  state: {
    refs: {},
    widgets: [],
  },

  onInit() {
    // 初始化传感器实例
    this.accel = new Accelerometer()
    this.gyro  = new Gyroscope()

    // 每次进入都清空数据，重新开始
    localStorage.removeItem(STORAGE_KEY)
    this.engine = createEngine()

    // 状态标志
    this._lastDuration = 0
    this._lastMotionTs = 0
    this._isPaused = false
    this._pauseCheckTimer = null
    this._pageWidgets = []

    logger.info('onInit: data cleared, started fresh')
  },

  build() {
    // 隐藏矩形屏幕的状态栏
    setStatusBarVisible(false)
    this._buildPage()
    this._updateFromEngine()
  },

  onResume() {
    // 检查是否从暂停恢复
    this._checkPauseStatus()

    // 启动传感器（如果运动中）
    if (!this._isPaused) {
      this._startSensor()
    }

    // 启动暂停检测计时器
    this._startPauseTimer()
  },

  onPause() {
    // 停止传感器（暂停时不计算）
    this._stopSensor()
    // 停止暂停检测计时器
    this._stopPauseTimer()
  },

  onDestroy() {
    this._stopSensor()
    this._stopPauseTimer()
    this._clearPage()
    // 退出页面时保存数据（包含当前 duration 用于新运动检测）
    this._saveToStorage()
  },

  // ============================================================
  // 公开方法：结束运动，清除所有数据
  // ============================================================
  endWorkout() {
    this.engine.reset()
    this._clearStorage()
    // 重置 UI 显示
    const r = this.state.refs
    if (r.spd)    r.spd.setProperty(prop.MORE, { text: '0' })
    if (r.freq)   r.freq.setProperty(prop.MORE, { text: '0' })
    if (r.swg)    r.swg.setProperty(prop.MORE, { text: '0' })
    if (r.rally)  r.rally.setProperty(prop.MORE, { text: '0' })
    if (r.fh)     r.fh.setProperty(prop.MORE, { text: '0' })
    if (r.bh)     r.bh.setProperty(prop.MORE, { text: '0' })
    logger.info('Workout ended, all data cleared')
  },

  _stopSensor() {
    try {
      this.accel.offChange()
      this.accel.stop()
      this.gyro.offChange()
      this.gyro.stop()
    } catch(e) {}
  },

  _startSensor() {
    try {
      const mv = () => this._onMotion()
      this.accel.onChange(mv)
      this.accel.setFreqMode(FREQ_MODE_HIGH)
      this.accel.start()
      this.gyro.onChange(mv)
      this.gyro.setFreqMode(FREQ_MODE_HIGH)
      this.gyro.start()
      logger.info('Sensors started')
    } catch(e) {
      logger.warn('sensor start fail', e)
    }
  },

  // ============================================================
  // 获取当前运动净时长（秒）
  // ============================================================
  _getSportDuration() {
    try {
      const data = getSportData({ edit_id: 1 })
      // 直接取 duration 字段
      if (data && data.duration !== undefined) {
        return data.duration
      }
    } catch(e) {
      logger.warn('getSportDuration failed', e)
    }
    return 0
  },

  // ============================================================
  // 检查暂停状态
  // 如果当前时长超过 10 秒不变，认为是暂停
  // ============================================================
  _checkPauseStatus() {
    const currentDuration = this._getSportDuration()

    if (currentDuration > 0 && this._lastDuration > 0) {
      if (currentDuration <= this._lastDuration) {
        // 时长没变化或减少 = 暂停
        if (!this._isPaused) {
          this._isPaused = true
          this._stopSensor()
          logger.info('Workout paused')
        }
      } else {
        // 时长增加 = 运动中
        if (this._isPaused) {
          this._isPaused = false
          this._startSensor()
          logger.info('Workout resumed')
        }
      }
    }

    this._lastDuration = currentDuration
  },

  // ============================================================
  // 启动暂停检测计时器
  // ============================================================
  _startPauseTimer() {
    this._stopPauseTimer()  // 先停止旧的
    this._pauseCheckTimer = setTimeout(function tick(self) {
      self._checkPauseStatus()
      self._pauseCheckTimer = setTimeout(tick, PAUSE_CHECK_INTERVAL_MS, self)
    }, PAUSE_CHECK_INTERVAL_MS, this)
  },

  // ============================================================
  // 停止暂停检测计时器
  // ============================================================
  _stopPauseTimer() {
    if (this._pauseCheckTimer) {
      clearTimeout(this._pauseCheckTimer)
      this._pauseCheckTimer = null
    }
  },

  _saveToStorage() {
    try {
      const state = this.engine.saveState()
      // 保存当前 duration 用于新运动检测
      state.lastDuration = this._getSportDuration()
      // Zepp OS localStorage 可能需要手动序列化
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch(e) {
      logger.warn('save to storage failed', e)
    }
  },

  _loadFromStorage() {
    try {
      const data = localStorage.getItem(STORAGE_KEY)
      if (data) return JSON.parse(data)
    } catch(e) {}
    return null
  },

  _clearStorage() {
    try {
      localStorage.removeItem(STORAGE_KEY)
      logger.info('Session cleared from storage')
    } catch(e) {}
  },

  _clearPage() {
    this._pageWidgets.forEach(w => { try { hmUI.deleteWidget(w) } catch(e) {} })
    this._pageWidgets = []
    this.state.refs = {}
  },

  _w(widgetType, options) {
    const w = createWidget(widgetType, options)
    this._pageWidgets.push(w)
    return w
  },

  _updateFromEngine() {
    const m = this.engine.buildMetrics({
      durationSeconds: 0,
      calories: 0,
      currentHeartRate: 0,
    })
    const r = this.state.refs
    if (r.spd)    r.spd.setProperty(prop.MORE, { text: String(m.maxSpeed) })
    if (r.freq)   r.freq.setProperty(prop.MORE, { text: String(m.swingsPerMinute) })
    if (r.swg)    r.swg.setProperty(prop.MORE, { text: String(m.totalSwings) })
    if (r.rally)  r.rally.setProperty(prop.MORE, { text: String(m.longestRally) })
    if (r.fh)     r.fh.setProperty(prop.MORE, { text: String(m.forehandCount) })
    if (r.bh)     r.bh.setProperty(prop.MORE, { text: String(m.backhandCount) })

    // 实时保存到持久化存储
    this._saveToStorage()
  },

  _buildPage() {
    const s = this.state

    // 深色背景
    this._w(widget.FILL_RECT, { x: 0, y: 0, w: LAYOUT_W, h: LAYOUT_H, color: C_BG })

    // ---- 顶部：时长 (官方 SPORT_DATA - 暂停时自动停止) ----
    this._w(widget.SPORT_DATA, {
      edit_id: 1,
      category: edit_widget_group_type.SPORTS,
      default_type: sport_data.DURATION_NET,
      x: durStyle.x, y: durStyle.y, w: durStyle.w, h: durStyle.h,
      text_size: durStyle.textSize,
      text_color: C_YELLOW,
    })

    // ---- 最高速度 (自己计算) ----
    s.refs.spd = this._w(widget.TEXT, {
      x: spdStyle.x, y: spdStyle.y, w: spdStyle.w, h: spdStyle.h,
      color: C_RED, text_size: spdStyle.textSize,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
      text_style: text_style.NONE, text: '--',
    })
    // 标签 + 单位
    this._w(widget.TEXT, {
      x: spdStyle.labelX, y: spdStyle.labelY, w: spdStyle.w, h: spdStyle.labelH,
      color: C_GRAY, text_size: spdStyle.labelSize,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
      text_style: text_style.NONE, text: getText('maxSpeed') + ' km/h',
    })

    // ---- 频率 (自己计算) ----
    s.refs.freq = this._w(widget.TEXT, {
      x: freqStyle.x, y: freqStyle.y, w: freqStyle.w, h: freqStyle.h,
      color: C_BLUE, text_size: freqStyle.textSize,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
      text_style: text_style.NONE, text: '--',
    })
    // 标签 + 单位
    this._w(widget.TEXT, {
      x: freqStyle.labelX, y: freqStyle.labelY, w: freqStyle.w, h: freqStyle.labelH,
      color: C_GRAY, text_size: freqStyle.labelSize,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
      text_style: text_style.NONE, text: getText('frequency') + ' /min',
    })

    // ---- 挥拍 (自己计算) ----
    s.refs.swg = this._w(widget.TEXT, {
      x: swgStyle.x, y: swgStyle.y, w: swgStyle.w, h: swgStyle.h,
      color: C_GREEN, text_size: swgStyle.textSize,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
      text_style: text_style.NONE, text: '--',
    })
    this._w(widget.TEXT, {
      x: swgStyle.labelX, y: swgStyle.labelY, w: swgStyle.w, h: swgStyle.labelH,
      color: C_GRAY, text_size: swgStyle.labelSize,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
      text_style: text_style.NONE, text: getText('swings'),
    })

    // ---- 连拍 (自己计算) ----
    s.refs.rally = this._w(widget.TEXT, {
      x: rallyStyle.x, y: rallyStyle.y, w: rallyStyle.w, h: rallyStyle.h,
      color: C_ORANGE, text_size: rallyStyle.textSize,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
      text_style: text_style.NONE, text: '--',
    })
    this._w(widget.TEXT, {
      x: rallyStyle.labelX, y: rallyStyle.labelY, w: rallyStyle.w, h: rallyStyle.labelH,
      color: C_GRAY, text_size: rallyStyle.labelSize,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
      text_style: text_style.NONE, text: getText('rally'),
    })

    // ---- 正手 (自己计算) ----
    s.refs.fh = this._w(widget.TEXT, {
      x: fhStyle.x, y: fhStyle.y, w: fhStyle.w, h: fhStyle.h,
      color: C_GREEN, text_size: fhStyle.textSize,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
      text_style: text_style.NONE, text: '--',
    })
    this._w(widget.TEXT, {
      x: fhStyle.labelX, y: fhStyle.labelY, w: fhStyle.w, h: fhStyle.labelH,
      color: C_GRAY, text_size: fhStyle.labelSize,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
      text_style: text_style.NONE, text: getText('forehand'),
    })

    // ---- 反手 (自己计算) ----
    s.refs.bh = this._w(widget.TEXT, {
      x: bhStyle.x, y: bhStyle.y, w: bhStyle.w, h: bhStyle.h,
      color: C_BLUE, text_size: bhStyle.textSize,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
      text_style: text_style.NONE, text: '--',
    })
    this._w(widget.TEXT, {
      x: bhStyle.labelX, y: bhStyle.labelY, w: bhStyle.w, h: bhStyle.labelH,
      color: C_GRAY, text_size: bhStyle.labelSize,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
      text_style: text_style.NONE, text: getText('backhand'),
    })

    // ---- 四角切圆（覆盖最上层，用黑色遮住四角）----
    const CR = 24  // 圆角半径
    this._w(widget.CIRCLE, { center_x: 0,        center_y: 0,        radius: CR, color: 0x000000 })
    this._w(widget.CIRCLE, { center_x: LAYOUT_W,  center_y: 0,        radius: CR, color: 0x000000 })
    this._w(widget.CIRCLE, { center_x: 0,        center_y: LAYOUT_H,  radius: CR, color: 0x000000 })
    this._w(widget.CIRCLE, { center_x: LAYOUT_W,  center_y: LAYOUT_H,  radius: CR, color: 0x000000 })
  },

  _onMotion() {
    try {
      const now = Date.now()
      if (now - this._lastMotionTs < 50) return
      this._lastMotionTs = now

      const accelData = this.accel.getCurrent()
      const gyroData  = this.gyro.getCurrent()

      if (!accelData || !gyroData) return
      if (typeof accelData.x !== 'number' || typeof gyroData.x !== 'number') return

      const action = this.engine.ingestMotion(accelData, gyroData, now)
      if (action) this._updateFromEngine()
    } catch(e) {}
  },
})

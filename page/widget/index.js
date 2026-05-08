import { Accelerometer, FREQ_MODE_HIGH, Gyroscope } from '@zos/sensor'
import { getText } from '@zos/i18n'
import { log } from '@zos/utils'
import { localStorage } from '@zos/storage'
import { getSportData } from '@zos/sport'
import hmUI, { align, createWidget, prop, text_style, widget, setStatusBarVisible, sport_data, edit_widget_group_type } from '@zos/ui'
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
    logger.info('>>> onInit START')
    try {
      logger.info('>>> new Accelerometer()')
      this.accel = new Accelerometer()
      logger.info('>>> new Gyroscope()')
      this.gyro  = new Gyroscope()
      logger.info('>>> localStorage.removeItem()')
      localStorage.removeItem(STORAGE_KEY)
      logger.info('>>> createEngine()')
      this.engine = createEngine()
      logger.info('>>> init state vars')
      this._lastDuration = 0
      this._lastMotionTs = 0
      this._isPaused = false
      this._pauseCheckTimer = null
      this._pageWidgets = []
      logger.info('>>> onInit END')
    } catch(e) {
      logger.error('>>> onInit ERROR: ' + e.message)
    }
  },

  build() {
    logger.info('>>> build START')
    try {
      logger.info('>>> setStatusBarVisible(false)')
      setStatusBarVisible(false)
    } catch(e) {
      logger.error('>>> setStatusBarVisible ERROR: ' + e.message)
    }
    try {
      logger.info('>>> _buildPage()')
      this._buildPage()
    } catch(e) {
      logger.error('>>> _buildPage ERROR: ' + e.message)
    }
    try {
      logger.info('>>> _updateFromEngine()')
      this._updateFromEngine()
    } catch(e) {
      logger.error('>>> _updateFromEngine ERROR: ' + e.message)
    }
    logger.info('>>> build END')
  },

  onResume() {
    logger.info('>>> onResume START')
    try {
      logger.info('>>> _checkPauseStatus()')
      this._checkPauseStatus()
    } catch(e) {
      logger.error('>>> _checkPauseStatus ERROR: ' + e.message)
    }
    try {
      if (!this._isPaused) {
        logger.info('>>> _startSensor()')
        this._startSensor()
      }
    } catch(e) {
      logger.error('>>> _startSensor ERROR: ' + e.message)
    }
    try {
      logger.info('>>> _startPauseTimer()')
      this._startPauseTimer()
    } catch(e) {
      logger.error('>>> _startPauseTimer ERROR: ' + e.message)
    }
    logger.info('>>> onResume END')
  },

  onPause() {
    logger.info('>>> onPause START')
    try { this._stopSensor() } catch(e) { logger.error('>>> _stopSensor ERROR: ' + e.message) }
    try { this._stopPauseTimer() } catch(e) { logger.error('>>> _stopPauseTimer ERROR: ' + e.message) }
    logger.info('>>> onPause END')
  },

  onDestroy() {
    logger.info('>>> onDestroy START')
    try { this._stopSensor() } catch(e) { logger.error('>>> _stopSensor ERROR: ' + e.message) }
    try { this._stopPauseTimer() } catch(e) { logger.error('>>> _stopPauseTimer ERROR: ' + e.message) }
    try { this._clearPage() } catch(e) { logger.error('>>> _clearPage ERROR: ' + e.message) }
    try { this._saveToStorage() } catch(e) { logger.error('>>> _saveToStorage ERROR: ' + e.message) }
    logger.info('>>> onDestroy END')
  },

  // ============================================================
  // 公开方法：结束运动，清除所有数据
  // ============================================================
  endWorkout() {
    logger.info('>>> endWorkout START')
    try {
      this.engine.reset()
      this._clearStorage()
      const r = this.state.refs
      if (r.spd)    r.spd.setProperty(prop.MORE, { text: '0' })
      if (r.freq)   r.freq.setProperty(prop.MORE, { text: '0' })
      if (r.swg)    r.swg.setProperty(prop.MORE, { text: '0' })
      if (r.rally)  r.rally.setProperty(prop.MORE, { text: '0' })
      if (r.fh)     r.fh.setProperty(prop.MORE, { text: '0' })
      if (r.bh)     r.bh.setProperty(prop.MORE, { text: '0' })
    } catch(e) {
      logger.error('>>> endWorkout ERROR: ' + e.message)
    }
    logger.info('>>> endWorkout END')
  },

  _stopSensor() {
    try {
      logger.info('>>> _stopSensor: offChange & stop')
      this.accel.offChange()
      this.accel.stop()
      this.gyro.offChange()
      this.gyro.stop()
    } catch(e) {
      logger.error('>>> _stopSensor ERROR: ' + e.message)
    }
  },

  _startSensor() {
    try {
      logger.info('>>> _startSensor START')
      const mv = () => this._onMotion()
      this.accel.onChange(mv)
      this.accel.setFreqMode(FREQ_MODE_HIGH)
      this.accel.start()
      this.gyro.onChange(mv)
      this.gyro.setFreqMode(FREQ_MODE_HIGH)
      this.gyro.start()
      logger.info('>>> Sensors started')
    } catch(e) {
      logger.error('>>> _startSensor ERROR: ' + e.message)
    }
  },

  // ============================================================
  // 获取当前运动净时长（秒）
  // ============================================================
  _getSportDuration() {
    try {
      logger.info('>>> _getSportDuration START')
      const data = getSportData({ edit_id: 1 })
      if (data && data.duration !== undefined) {
        logger.info('>>> _getSportDuration: ' + data.duration)
        return data.duration
      }
    } catch(e) {
      logger.error('>>> _getSportDuration ERROR: ' + e.message)
    }
    return 0
  },

  // ============================================================
  // 检查暂停状态
  // ============================================================
  _checkPauseStatus() {
    try {
      logger.info('>>> _checkPauseStatus START')
      const currentDuration = this._getSportDuration()
      logger.info('>>> currentDuration: ' + currentDuration + ', _lastDuration: ' + this._lastDuration + ', _isPaused: ' + this._isPaused)

      if (currentDuration > 0 && this._lastDuration > 0) {
        if (currentDuration <= this._lastDuration) {
          if (!this._isPaused) {
            this._isPaused = true
            this._stopSensor()
            logger.info('>>> Workout paused')
          }
        } else {
          if (this._isPaused) {
            this._isPaused = false
            this._startSensor()
            logger.info('>>> Workout resumed')
          }
        }
      }
      this._lastDuration = currentDuration
      logger.info('>>> _checkPauseStatus END')
    } catch(e) {
      logger.error('>>> _checkPauseStatus ERROR: ' + e.message)
    }
  },

  // ============================================================
  // 启动暂停检测计时器
  // ============================================================
  _startPauseTimer() {
    try {
      logger.info('>>> _startPauseTimer START')
      this._stopPauseTimer()
      this._pauseCheckTimer = setTimeout(function tick(self) {
        self._checkPauseStatus()
        self._pauseCheckTimer = setTimeout(tick, PAUSE_CHECK_INTERVAL_MS, self)
      }, PAUSE_CHECK_INTERVAL_MS, this)
      logger.info('>>> _startPauseTimer END')
    } catch(e) {
      logger.error('>>> _startPauseTimer ERROR: ' + e.message)
    }
  },

  // ============================================================
  // 停止暂停检测计时器
  // ============================================================
  _stopPauseTimer() {
    try {
      logger.info('>>> _stopPauseTimer START')
      if (this._pauseCheckTimer) {
        clearTimeout(this._pauseCheckTimer)
        this._pauseCheckTimer = null
      }
      logger.info('>>> _stopPauseTimer END')
    } catch(e) {
      logger.error('>>> _stopPauseTimer ERROR: ' + e.message)
    }
  },

  _saveToStorage() {
    try {
      logger.info('>>> _saveToStorage START')
      const state = this.engine.saveState()
      state.lastDuration = this._getSportDuration()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      logger.info('>>> _saveToStorage END')
    } catch(e) {
      logger.error('>>> _saveToStorage ERROR: ' + e.message)
    }
  },

  _clearStorage() {
    try {
      logger.info('>>> _clearStorage START')
      localStorage.removeItem(STORAGE_KEY)
      logger.info('>>> _clearStorage END')
    } catch(e) {
      logger.error('>>> _clearStorage ERROR: ' + e.message)
    }
  },

  _clearPage() {
    try {
      logger.info('>>> _clearPage START')
      this._pageWidgets.forEach(w => { try { hmUI.deleteWidget(w) } catch(e) {} })
      this._pageWidgets = []
      this.state.refs = {}
      logger.info('>>> _clearPage END')
    } catch(e) {
      logger.error('>>> _clearPage ERROR: ' + e.message)
    }
  },

  _w(widgetType, options) {
    try {
      const w = createWidget(widgetType, options)
      this._pageWidgets.push(w)
      return w
    } catch(e) {
      logger.error('>>> _w ERROR (' + widgetType + '): ' + e.message)
      return null
    }
  },

  _updateFromEngine() {
    try {
      logger.info('>>> _updateFromEngine START')
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
      this._saveToStorage()
      logger.info('>>> _updateFromEngine END')
    } catch(e) {
      logger.error('>>> _updateFromEngine ERROR: ' + e.message)
    }
  },

  _buildPage() {
    logger.info('>>> _buildPage START')
    const s = this.state

    try {
      logger.info('>>> FILL_RECT bg')
      this._w(widget.FILL_RECT, { x: 0, y: 0, w: LAYOUT_W, h: LAYOUT_H, color: C_BG })
    } catch(e) { logger.error('>>> FILL_RECT ERROR: ' + e.message) }

    try {
      logger.info('>>> SPORT_DATA duration')
      this._w(widget.SPORT_DATA, {
        edit_id: 1,
        category: edit_widget_group_type.SPORTS,
        default_type: sport_data.DURATION_NET,
        x: durStyle.x, y: durStyle.y, w: durStyle.w, h: durStyle.h,
        text_size: durStyle.textSize,
        text_color: C_YELLOW,
      })
    } catch(e) { logger.error('>>> SPORT_DATA ERROR: ' + e.message) }

    try {
      logger.info('>>> TEXT spd value')
      s.refs.spd = this._w(widget.TEXT, {
        x: spdStyle.x, y: spdStyle.y, w: spdStyle.w, h: spdStyle.h,
        color: C_RED, text_size: spdStyle.textSize,
        align_h: align.CENTER_H, align_v: align.CENTER_V,
        text_style: text_style.NONE, text: '--',
      })
    } catch(e) { logger.error('>>> TEXT spd ERROR: ' + e.message) }

    try {
      logger.info('>>> TEXT spd label')
      this._w(widget.TEXT, {
        x: spdStyle.labelX, y: spdStyle.labelY, w: spdStyle.w, h: spdStyle.labelH,
        color: C_GRAY, text_size: spdStyle.labelSize,
        align_h: align.CENTER_H, align_v: align.CENTER_V,
        text_style: text_style.NONE, text: getText('maxSpeed') + ' km/h',
      })
    } catch(e) { logger.error('>>> TEXT spd label ERROR: ' + e.message) }

    try {
      logger.info('>>> TEXT freq value')
      s.refs.freq = this._w(widget.TEXT, {
        x: freqStyle.x, y: freqStyle.y, w: freqStyle.w, h: freqStyle.h,
        color: C_BLUE, text_size: freqStyle.textSize,
        align_h: align.CENTER_H, align_v: align.CENTER_V,
        text_style: text_style.NONE, text: '--',
      })
    } catch(e) { logger.error('>>> TEXT freq ERROR: ' + e.message) }

    try {
      logger.info('>>> TEXT freq label')
      this._w(widget.TEXT, {
        x: freqStyle.labelX, y: freqStyle.labelY, w: freqStyle.w, h: freqStyle.labelH,
        color: C_GRAY, text_size: freqStyle.labelSize,
        align_h: align.CENTER_H, align_v: align.CENTER_V,
        text_style: text_style.NONE, text: getText('frequency') + ' /min',
      })
    } catch(e) { logger.error('>>> TEXT freq label ERROR: ' + e.message) }

    try {
      logger.info('>>> TEXT swg value')
      s.refs.swg = this._w(widget.TEXT, {
        x: swgStyle.x, y: swgStyle.y, w: swgStyle.w, h: swgStyle.h,
        color: C_GREEN, text_size: swgStyle.textSize,
        align_h: align.CENTER_H, align_v: align.CENTER_V,
        text_style: text_style.NONE, text: '--',
      })
    } catch(e) { logger.error('>>> TEXT swg ERROR: ' + e.message) }

    try {
      logger.info('>>> TEXT swg label')
      this._w(widget.TEXT, {
        x: swgStyle.labelX, y: swgStyle.labelY, w: swgStyle.w, h: swgStyle.labelH,
        color: C_GRAY, text_size: swgStyle.labelSize,
        align_h: align.CENTER_H, align_v: align.CENTER_V,
        text_style: text_style.NONE, text: getText('swings'),
      })
    } catch(e) { logger.error('>>> TEXT swg label ERROR: ' + e.message) }

    try {
      logger.info('>>> TEXT rally value')
      s.refs.rally = this._w(widget.TEXT, {
        x: rallyStyle.x, y: rallyStyle.y, w: rallyStyle.w, h: rallyStyle.h,
        color: C_ORANGE, text_size: rallyStyle.textSize,
        align_h: align.CENTER_H, align_v: align.CENTER_V,
        text_style: text_style.NONE, text: '--',
      })
    } catch(e) { logger.error('>>> TEXT rally ERROR: ' + e.message) }

    try {
      logger.info('>>> TEXT rally label')
      this._w(widget.TEXT, {
        x: rallyStyle.labelX, y: rallyStyle.labelY, w: rallyStyle.w, h: rallyStyle.labelH,
        color: C_GRAY, text_size: rallyStyle.labelSize,
        align_h: align.CENTER_H, align_v: align.CENTER_V,
        text_style: text_style.NONE, text: getText('rally'),
      })
    } catch(e) { logger.error('>>> TEXT rally label ERROR: ' + e.message) }

    try {
      logger.info('>>> TEXT fh value')
      s.refs.fh = this._w(widget.TEXT, {
        x: fhStyle.x, y: fhStyle.y, w: fhStyle.w, h: fhStyle.h,
        color: C_GREEN, text_size: fhStyle.textSize,
        align_h: align.CENTER_H, align_v: align.CENTER_V,
        text_style: text_style.NONE, text: '--',
      })
    } catch(e) { logger.error('>>> TEXT fh ERROR: ' + e.message) }

    try {
      logger.info('>>> TEXT fh label')
      this._w(widget.TEXT, {
        x: fhStyle.labelX, y: fhStyle.labelY, w: fhStyle.w, h: fhStyle.labelH,
        color: C_GRAY, text_size: fhStyle.labelSize,
        align_h: align.CENTER_H, align_v: align.CENTER_V,
        text_style: text_style.NONE, text: getText('forehand'),
      })
    } catch(e) { logger.error('>>> TEXT fh label ERROR: ' + e.message) }

    try {
      logger.info('>>> TEXT bh value')
      s.refs.bh = this._w(widget.TEXT, {
        x: bhStyle.x, y: bhStyle.y, w: bhStyle.w, h: bhStyle.h,
        color: C_BLUE, text_size: bhStyle.textSize,
        align_h: align.CENTER_H, align_v: align.CENTER_V,
        text_style: text_style.NONE, text: '--',
      })
    } catch(e) { logger.error('>>> TEXT bh ERROR: ' + e.message) }

    try {
      logger.info('>>> TEXT bh label')
      this._w(widget.TEXT, {
        x: bhStyle.labelX, y: bhStyle.labelY, w: bhStyle.w, h: bhStyle.labelH,
        color: C_GRAY, text_size: bhStyle.labelSize,
        align_h: align.CENTER_H, align_v: align.CENTER_V,
        text_style: text_style.NONE, text: getText('backhand'),
      })
    } catch(e) { logger.error('>>> TEXT bh label ERROR: ' + e.message) }

    logger.info('>>> _buildPage END')
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
    } catch(e) {
      logger.error('>>> _onMotion ERROR: ' + e.message)
    }
  },
})

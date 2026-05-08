// ============================================================
// 阈值标定说明 (基于 OSF 羽毛球挥拍数据集 100人×30次分析, 2026-04-28)
// 数据集: osf.io/4uy38 (doi:10.17605/OSF.IO/4UY38)
// Zepp OS 单位: accel = cm/s², gyro = °/s
// ============================================================

// 硬件采样情况（Amazfit Active 2 NFC, Zepp OS 3.x）：
// - FREQ_MODE_HIGH: 50 Hz（每 20ms 一个样本）
// - FREQ_MODE_NORMAL: 25 Hz（每 40ms 一个样本）
// - 一次正常挥拍（150ms）约 7-8 个采样点，阈值需适配

// 加速度阈值 (cm/s²)
// Zepp 手表加速度计量程通常是 ±16g = 15696 cm/s²
// OSF 数据均值 18086 cm/s² (≈18.4g)，但手腕戴手表挥幅受限
// 设置 3g = 2943 cm/s²，50Hz 采样下正常挥拍（7-8 个点）应能触发
const SWING_ACCEL_THRESHOLD_RAW = 3000    // 普通挥拍: ≥3g
const SWING_ACCEL_THRESHOLD_HIGH = 6000  // 高速检测: ≥6g（杀球/扣杀）
const SWING_ACCEL_THRESHOLD_VERY_HIGH = 10000 // 极限检测: ≥10g（暴力重扣）

// 陀螺仪阈值 (°/s)
// OSF 数据: 挥拍峰值均值 240°/s, P90 614°/s
// 手腕挥拍通常 100-400°/s
const SWING_GYRO_THRESHOLD = 80      // °/s
const SWING_GYRO_THRESHOLD_HIGH = 150 // °/s 高速检测
const COOLDOWN_MS = 600             // 冷却时间：跳过往后收回的动作（约 300-500ms），只计往前击球
const RALLY_GAP_MS = 3000   // 回合间隔阈值(ms)：3秒内算连续，3秒以上算回合结束
const SAMPLE_BUFFER_MS = 1400  // 缓冲区：50Hz 下约 70 个点
const ANALYSIS_WINDOW_MS = 400 // 分析窗口：50Hz 下约 20 个点，足够捕获峰值
const STROKE_BINS = {
  overhead: '上手球',
  underhand: '下手球',
  drive: '平抽挡',
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function round(value, digits = 0) {
  const factor = Math.pow(10, digits)
  return Math.round(value * factor) / factor
}

function safeDiv(a, b) {
  return b ? a / b : 0
}

// ============================================================
// 速度估算公式
// 输入: accelPeak_cm (cm/s²), gyroPeak_deg (°/s)
// 输出: 拍速 km/h（估算值，仅供相对比较，不是真实球速）
//
// 注意：这是手腕 IMU 估算值，与真实球速有相关性但非精确测量
// 手腕挥拍速度通常比球速低，估算值范围 30-150 km/h 较合理
// ============================================================
function calcSpeed(accelPeak_cm, gyroPeak_deg) {
  const accel_g = accelPeak_cm / 981.0
  const speed_m_s = 0.5 * (gyroPeak_deg / 100) + 2.0 * Math.max(0, accel_g - 1.0)
  const speed_kmh = speed_m_s * 3.6
  return round(clamp(speed_kmh, 30, 200), 1)
}

function createEmptySession() {
  return {
    startedAt: Date.now(),
    lastSampleAt: 0,
    lastSwingAt: 0,
    totalSwings: 0,
    maxSpeed: 0,
    currentRally: 0,
    longestRally: 0,
    swingDurations: [],
    activeMilliseconds: 0,
    forehandCount: 0,
    backhandCount: 0,
    strokeTypes: {
      overhead: 0,
      underhand: 0,
      drive: 0,
    },
    heartRateSamples: [],
    intensitySamples: [],
    maxHeartRate: 0,
    rawSamples: [],
    recentActions: [],
    lastAction: null,
  }
}

function getWindowSamples(samples, timestamp) {
  const windowStart = timestamp - ANALYSIS_WINDOW_MS
  return samples.filter((sample) => sample.timestamp >= windowStart && sample.timestamp <= timestamp)
}

function calcFeatureSet(windowSamples) {
  const base = {
    accelPeak: 0,
    gyroPeak: 0,
    minAccelZ: Infinity,
    maxAccelZ: -Infinity,
    meanGyroZ: 0,
    meanGyroY: 0,
    meanAccelX: 0,
    meanAccelY: 0,
    meanAccelZ: 0,
    maxGyroX: -Infinity,
    minGyroX: Infinity,
    maxGyroY: -Infinity,
    maxGyroZ: -Infinity,
    minGyroZ: Infinity,
    // X轴时序分析：正反手判断关键
    gyroXPositiveSum: 0,   // 正向外展累计（正手倾向）
    gyroXNegativeSum: 0,   // 负向内收累计（反手倾向）
    gyroXTurnPoint: 0,     // 转向点位置 0-1（0=开始就转向，1=一直正向）
    gyroXTurnMagnitude: 0, // 转向幅度（内收有多强）
    // Y轴时序分析：区分正手立腕 vs 反手内收
    gyroYNegDuringNegX: 0, // X轴负向期间的Y轴均值（判断负向是立腕还是内收）
    gyroYAtNegXStart: 0,   // X轴负向开始时的Y轴值
    wristLiftDetected: 0,  // 是否检测到立腕动作（Y轴正向峰值）
  }

  if (!windowSamples.length) {
    return {
      ...base,
      swingPlaneScore: 0,
      verticalScore: 0,
    }
  }

  let accelXSum = 0
  let accelYSum = 0
  let accelZSum = 0
  let gyroYSum = 0
  let gyroZSum = 0
  let gyroXPositiveSum = 0
  let gyroXNegativeSum = 0
  let firstNegativeIdx = -1
  let lastNegativeIdx = -1
  // Y轴时序分析
  let gyroYSumDuringNegX = 0  // X轴负向期间的Y轴累计
  let gyroYDuringNegXCount = 0
  let gyroYAtNegXStart = 0    // X轴负向开始时的Y轴值
  let gyroYPositiveSum = 0     // Y轴正向累计（立腕）
  let gyroYPositiveMax = 0     // Y轴正向峰值
  let gyroYPositiveMaxIdx = -1 // Y轴正向峰值位置
  let inNegXPhase = false

  windowSamples.forEach((sample, idx) => {
    base.accelPeak = Math.max(base.accelPeak, sample.accelMag)
    base.gyroPeak = Math.max(base.gyroPeak, sample.gyroMag)
    base.minAccelZ = Math.min(base.minAccelZ, sample.accel.z)
    base.maxAccelZ = Math.max(base.maxAccelZ, sample.accel.z)
    base.maxGyroX = Math.max(base.maxGyroX, sample.gyro.x)
    base.minGyroX = Math.min(base.minGyroX, sample.gyro.x)
    base.maxGyroY = Math.max(base.maxGyroY, sample.gyro.y)
    base.maxGyroZ = Math.max(base.maxGyroZ, sample.gyro.z)
    base.minGyroZ = Math.min(base.minGyroZ, sample.gyro.z)
    accelXSum += sample.accel.x
    accelYSum += sample.accel.y
    accelZSum += sample.accel.z
    gyroYSum += sample.gyro.y
    gyroZSum += sample.gyro.z

    // X轴时序分析
    if (sample.gyro.x > 0) {
      gyroXPositiveSum += sample.gyro.x
      // X轴转正向时，记录立腕状态
      if (inNegXPhase && gyroYAtNegXStart === 0) {
        gyroYAtNegXStart = sample.gyro.y
      }
      inNegXPhase = false
    } else {
      gyroXNegativeSum += Math.abs(sample.gyro.x)
      if (firstNegativeIdx < 0) firstNegativeIdx = idx
      lastNegativeIdx = idx
      // 记录X轴负向期间的Y轴值
      gyroYSumDuringNegX += sample.gyro.y
      gyroYDuringNegXCount++
      inNegXPhase = true
    }

    // Y轴时序分析：检测立腕动作
    if (sample.gyro.y > 0) {
      gyroYPositiveSum += sample.gyro.y
      if (sample.gyro.y > gyroYPositiveMax) {
        gyroYPositiveMax = sample.gyro.y
        gyroYPositiveMaxIdx = idx
      }
    }
  })

  base.meanAccelX = accelXSum / windowSamples.length
  base.meanAccelY = accelYSum / windowSamples.length
  base.meanAccelZ = accelZSum / windowSamples.length
  base.meanGyroY = gyroYSum / windowSamples.length
  base.meanGyroZ = gyroZSum / windowSamples.length
  base.swingPlaneScore = round(Math.abs(base.meanAccelX) + Math.abs(base.meanAccelY), 2)
  base.verticalScore = round(base.maxAccelZ - base.minAccelZ, 2)

  // X轴时序分析结果
  base.gyroXPositiveSum = gyroXPositiveSum
  base.gyroXNegativeSum = gyroXNegativeSum
  base.gyroXTurnMagnitude = gyroXNegativeSum  // 转向幅度 = 负向累计

  // 转向点：如果有负向运动，转向点在负向结束的位置
  // 0=开始就转向，1=一直正向
  if (lastNegativeIdx >= 0 && windowSamples.length > 0) {
    base.gyroXTurnPoint = lastNegativeIdx / (windowSamples.length - 1)
  } else {
    base.gyroXTurnPoint = 1.0  // 完全没有负向，全程正向
  }

  // Y轴时序分析结果
  base.gyroYNegDuringNegX = gyroYDuringNegXCount > 0 ? gyroYSumDuringNegX / gyroYDuringNegXCount : 0
  base.gyroYAtNegXStart = gyroYAtNegXStart
  // 立腕检测：Y轴正向峰值 > 50°/s 且 Y轴正向总量 > 200
  base.wristLiftDetected = (gyroYPositiveMax > 50 && gyroYPositiveSum > 200) ? 1 : 0

  return base
}

// ============================================================
// 正反手判断（旋前/旋后生物力学版）
//
// 核心生物力学原理：
// - 正手击球：腕关节旋前（Pronation），拇指向下，Z轴正向峰值主导
// - 反手击球：腕关节旋后（Supination），拇指向外，Z轴负向峰值主导
//
// 判断优先级：
// 1. Z轴旋后信号（|minGyroZ| vs maxGyroZ）— 最直接的生物力学信号
// 2. 手臂内收（meanAccelX 负向）— 反手穿越身体中线的特征
// 3. X轴内收比例 — 辅助确认
// ============================================================
function classifyHand(features) {
  const totalX = (features.gyroXPositiveSum || 0) + (features.gyroXNegativeSum || 0)

  // X轴运动太弱，无法判断 → 默认正手
  if (totalX < 100) return 'forehand'

  // ========================================
  // 第一优先级：Z轴旋前/旋后方向
  // 正手：旋前 → maxGyroZ 更大
  // 反手：旋后 → |minGyroZ| 更大
  // ========================================
  const zPronation  = features.maxGyroZ || 0               // 旋前峰值（正）
  const zSupination = Math.abs(features.minGyroZ || 0)      // 旋后峰值（负轴取绝对值）

  // 旋后明显强于旋前 → 反手
  if (zSupination > zPronation * 1.4 && zSupination > 60) {
    return 'backhand'
  }

  // 旋前明显强于旋后 → 正手（不再往下走）
  if (zPronation > zSupination * 1.4 && zPronation > 60) {
    return 'forehand'
  }

  // ========================================
  // 第二优先级：手臂内收（越身体中线）
  // 反手时手臂向内穿越，meanAccelX 偏负（右手佩戴）
  // ========================================
  const armCrossBody = (features.meanAccelX || 0) < -150  // cm/s²

  if (armCrossBody) {
    // 内收 + Z轴旋后倾向 → 反手
    if (zSupination >= zPronation * 0.8) return 'backhand'
  }

  // ========================================
  // 第三优先级：X轴内收比例（兜底）
  // ========================================
  const negRatio = (features.gyroXNegativeSum || 0) / totalX
  const turnPoint = features.gyroXTurnPoint || 1

  if (negRatio > 0.35 && turnPoint < 0.8) {
    return 'backhand'
  }

  return 'forehand'
}

// ============================================================
// 击球类型分类
// 基于 OSF 数据集分析，单位为 Zepp OS 原生单位 (cm/s², °/s)
// overhead: 上手球（高远球/杀球），AccelZ 向上（正值大）
// underhand: 下手球（挑球/放球），AccelZ 向下（负值大）
// drive: 平抽挡，水平挥拍为主
// ============================================================
function classifyStroke(features) {
  // 转换到 g 单位以便于判断 (1g = 981 cm/s²)
  const maxAccelZ_g = features.maxAccelZ / 981.0
  const minAccelZ_g = features.minAccelZ / 981.0
  const meanGyroY_deg = features.meanGyroY  // 已是 °/s
  const verticalScore_g = features.verticalScore / 981.0  // g

  // 上旋（高手球）: Z轴正向大加速度 或 Y轴正旋转
  // OSF 数据: maxAccelZ 可达 ±39g，故用 ±5g 作为上手判断
  if (maxAccelZ_g > 5 || meanGyroY_deg > 100 || verticalScore_g > 10) {
    return 'overhead'
  }

  // 下手球: Z轴负向大加速度 或 Y轴负旋转
  if (minAccelZ_g < -5 || meanGyroY_deg < -80) {
    return 'underhand'
  }

  return 'drive'
}

// ============================================================
// 击球置信度 (0-100)
// 基于特征值的相对强度，归一化后转换
// ============================================================
function buildConfidence(features, stroke) {
  const maxAccelZ_g = Math.abs(features.maxAccelZ) / 981.0
  const minAccelZ_g = Math.abs(features.minAccelZ) / 981.0
  const verticalScore_g = features.verticalScore / 981.0
  const gyroPeak_deg = features.gyroPeak  // °/s

  if (stroke === 'overhead') {
    // 置信度：高加速度 + 高角速度 = 高置信
    const score = clamp((maxAccelZ_g * 5 + gyroPeak_deg * 0.05 + verticalScore_g * 2) / 2, 40, 99)
    return round(score, 0)
  }

  if (stroke === 'underhand') {
    const score = clamp((minAccelZ_g * 5 + Math.abs(features.meanGyroY) * 0.06) / 2, 40, 99)
    return round(score, 0)
  }

  // drive: 水平挥拍置信度
  const swingScore = features.swingPlaneScore / 981.0
  const score = clamp((swingScore * 3 + gyroPeak_deg * 0.05) / 2, 40, 99)
  return round(score, 0)
}

function buildAction(features, timestamp) {
  const stroke = classifyStroke(features)
  const hand = classifyHand(features)
  const speed = calcSpeed(features.accelPeak, features.gyroPeak)
  const confidence = buildConfidence(features, stroke)

  return {
    timestamp,
    hand,
    stroke,
    speed,
    confidence,
    features: {
      accelPeak: round(features.accelPeak, 2),
      gyroPeak: round(features.gyroPeak, 2),
      maxAccelZ: round(features.maxAccelZ, 2),
      minAccelZ: round(features.minAccelZ, 2),
      meanGyroY: round(features.meanGyroY, 2),
      meanGyroZ: round(features.meanGyroZ, 2),
      swingPlaneScore: round(features.swingPlaneScore, 2),
      verticalScore: round(features.verticalScore, 2),
      // X轴时序
      gyroXPosSum: round(features.gyroXPositiveSum, 0),
      gyroXNegSum: round(features.gyroXNegativeSum, 0),
      gyroXTurnPt: round(features.gyroXTurnPoint, 2),
      // Y轴时序（新增）
      gyroYNegDuringNegX: round(features.gyroYNegDuringNegX, 1),
      wristLift: features.wristLiftDetected,
    },
  }
}

function appendRecentAction(session, action) {
  session.lastAction = action
  session.recentActions.push(action)
  if (session.recentActions.length > 24) {
    session.recentActions.shift()
  }
}

export function createEngine(initialState = null) {
  // 过滤掉 UI 层状态字段，只保留 engine 需要的字段
  const { lastDuration, ...engineState } = initialState || {}

  const session = engineState ? { ...createEmptySession(), ...engineState } : createEmptySession()

  return {
    session,

    ingestHeartRate(value) {
      if (!value || value <= 0) return
      session.heartRateSamples.push(value)
      session.maxHeartRate = Math.max(session.maxHeartRate, value)
      if (session.heartRateSamples.length > 1200) {
        session.heartRateSamples.shift()
      }
    },

    ingestMotion(accel, gyro, timestamp = Date.now()) {
      const accelMag = Math.sqrt(accel.x * accel.x + accel.y * accel.y + accel.z * accel.z)
      const gyroMag = Math.sqrt(gyro.x * gyro.x + gyro.y * gyro.y + gyro.z * gyro.z)
      const sample = {
        timestamp,
        accel,
        gyro,
        accelMag,
        gyroMag,
      }

      session.lastSampleAt = timestamp
      session.rawSamples.push(sample)
      session.rawSamples = session.rawSamples.filter((item) => timestamp - item.timestamp <= SAMPLE_BUFFER_MS)
      session.intensitySamples.push(round(accelMag + gyroMag * 0.6, 2))
      if (session.intensitySamples.length > 1800) {
        session.intensitySamples.shift()
      }

      // 归一化加速度 mag 到 1g = 981 cm/s²，用于统一判断
      const accel_g = accelMag / 981.0
      // 三级检测：普通挥拍 / 高速 / 极限
      // 关键：陀螺仪必须始终满足最低阈值
      let isSwingCandidate = false
      if (accel_g >= (SWING_ACCEL_THRESHOLD_RAW / 981.0) && gyroMag >= SWING_GYRO_THRESHOLD) {
        isSwingCandidate = true  // 普通挥拍
      } else if (accel_g >= (SWING_ACCEL_THRESHOLD_HIGH / 981.0) && gyroMag >= SWING_GYRO_THRESHOLD_HIGH) {
        isSwingCandidate = true  // 高速杀球
      } else if (accel_g >= (SWING_ACCEL_THRESHOLD_VERY_HIGH / 981.0) && gyroMag >= SWING_GYRO_THRESHOLD_HIGH) {
        isSwingCandidate = true  // 极限动作
      }

      const inCooldown = timestamp - session.lastSwingAt < COOLDOWN_MS
      if (inCooldown || !isSwingCandidate) {
        return null
      }

      const windowSamples = getWindowSamples(session.rawSamples, timestamp)
      const features = calcFeatureSet(windowSamples)
      const action = buildAction(features, timestamp)
      const delta = session.lastSwingAt ? timestamp - session.lastSwingAt : 0

      session.totalSwings += 1
      session.maxSpeed = Math.max(session.maxSpeed, action.speed)
      session.lastSwingAt = timestamp
      session.activeMilliseconds += clamp(delta || 600, 250, 1400)

      if (action.hand === 'forehand') {
        session.forehandCount += 1
      } else {
        session.backhandCount += 1
      }

      session.strokeTypes[action.stroke] += 1

      if (delta > 0) {
        session.swingDurations.push(delta)
        if (session.swingDurations.length > 200) {
          session.swingDurations.shift()
        }
      }

      if (delta > 0 && delta <= RALLY_GAP_MS) {
        session.currentRally += 1
      } else {
        session.currentRally = 1
      }

      session.longestRally = Math.max(session.longestRally, session.currentRally)
      appendRecentAction(session, action)

      return action
    },

    // ============================================================
    // 持久化：保存当前状态（用于 localStorage）
    // ============================================================
    saveState() {
      return {
        startedAt: session.startedAt,
        lastSampleAt: session.lastSampleAt,
        lastSwingAt: session.lastSwingAt,
        totalSwings: session.totalSwings,
        maxSpeed: session.maxSpeed,
        currentRally: session.currentRally,
        longestRally: session.longestRally,
        activeMilliseconds: session.activeMilliseconds,
        forehandCount: session.forehandCount,
        backhandCount: session.backhandCount,
        strokeTypes: { ...session.strokeTypes },
        recentActions: session.recentActions.slice(-10),  // 只保存最近10条
      }
    },

    // ============================================================
    // 重置会话（运动结束时调用）
    // ============================================================
    reset() {
      const fresh = createEmptySession()
      Object.assign(session, fresh)
    },

    getDebugSnapshot() {
      return {
        sampleCount: session.rawSamples.length,
        lastAction: session.lastAction,
        recentActions: session.recentActions.slice(-5),
      }
    },

    buildMetrics(workout = {}) {
      const durationSeconds = workout.durationSeconds || Math.floor((Date.now() - session.startedAt) / 1000)
      const avgHeartRate = round(
        safeDiv(
          session.heartRateSamples.reduce((sum, value) => sum + value, 0),
          session.heartRateSamples.length,
        ),
      )
      const swingsPerMinute = round(safeDiv(session.totalSwings * 60, Math.max(durationSeconds, 1)), 1)
      const avgGap = round(
        safeDiv(
          session.swingDurations.reduce((sum, value) => sum + value, 0),
          session.swingDurations.length,
        ),
      )
      const activeRatio = clamp(safeDiv(session.activeMilliseconds, Math.max(durationSeconds * 1000, 1)), 0, 1)
      const overheadRatio = safeDiv(session.strokeTypes.overhead, Math.max(session.totalSwings, 1))
      const underhandRatio = safeDiv(session.strokeTypes.underhand, Math.max(session.totalSwings, 1))
      const driveRatio = safeDiv(session.strokeTypes.drive, Math.max(session.totalSwings, 1))
      const forehandRatio = safeDiv(session.forehandCount, Math.max(session.totalSwings, 1))
      const balanceRatio = 1 - Math.abs(session.forehandCount - session.backhandCount) / Math.max(session.totalSwings, 1)

      // 归一化: 将值映射到 [0, 1]，超出范围截断
      function norm(value, minVal, maxVal) {
        return clamp(safeDiv(value - minVal, maxVal - minVal), 0, 1)
      }

      // 击球多样性: 三种球路越均匀越高 (0=单一 → 1=完美三等分)
      const strokeCounts = [session.strokeTypes.overhead, session.strokeTypes.underhand, session.strokeTypes.drive]
      const totalStrokes = session.strokeTypes.overhead + session.strokeTypes.underhand + session.strokeTypes.drive
      const strokeDiversity = totalStrokes > 0
        ? 1 - (strokeCounts.reduce((max, c) => Math.max(max, safeDiv(c, totalStrokes)), 0) - 1 / 3) / (2 / 3)
        : 0

      const radar = {
        // 爆发力: 最大拍速为主 (估算范围 30-200 km/h) + 挥拍节奏 + 心率峰值
        burst: round(clamp(
          norm(session.maxSpeed, 30, 200) * 50 +
          norm(swingsPerMinute, 5, 35) * 25 +
          norm(session.maxHeartRate, 110, 180) * 25,
          15, 99)),

        // 进攻性: 上手球占比 + 正手偏好 + 挥拍频率
        offense: round(clamp(
          norm(overheadRatio, 0.1, 0.65) * 40 +
          norm(forehandRatio, 0.3, 0.8) * 25 +
          norm(swingsPerMinute, 5, 30) * 20 +
          norm(session.maxSpeed, 30, 200) * 15,
          15, 99)),

        // 对抗能力: 连拍 + 正反手均衡 + 击球多样性
        rally: round(clamp(
          norm(session.longestRally, 2, 15) * 30 +
          norm(balanceRatio, 0.3, 1) * 25 +
          norm(strokeDiversity, 0, 1) * 25 +
          norm(session.currentRally, 1, 10) * 20,
          15, 99)),

        // 耐力: 运动时长 (5~60分钟) + 平均心率 + 活跃比
        endurance: round(clamp(
          norm(durationSeconds, 300, 3600) * 35 +
          norm(avgHeartRate, 100, 170) * 30 +
          norm(activeRatio, 0.1, 0.7) * 20 +
          norm(session.totalSwings, 30, 600) * 15,
          15, 99)),

        // 活跃度: 挥拍频率 + 活跃时间占比 + 总挥拍量
        activity: round(clamp(
          norm(swingsPerMinute, 5, 35) * 35 +
          norm(activeRatio, 0.1, 0.7) * 30 +
          norm(session.totalSwings, 30, 600) * 35,
          15, 99)),
      }

      return {
        startedAt: session.startedAt,
        durationSeconds,
        calories: workout.calories || 0,
        currentHeartRate: workout.currentHeartRate || avgHeartRate || 0,
        avgHeartRate,
        maxHeartRate: session.maxHeartRate,
        totalSwings: session.totalSwings,
        swingsPerMinute,
        maxSpeed: round(session.maxSpeed, 1),
        forehandCount: session.forehandCount,
        backhandCount: session.backhandCount,
        strokeTypes: {
          [STROKE_BINS.overhead]: session.strokeTypes.overhead,
          [STROKE_BINS.underhand]: session.strokeTypes.underhand,
          [STROKE_BINS.drive]: session.strokeTypes.drive,
        },
        longestRally: session.longestRally,
        currentRally: session.currentRally,
        avgGapMs: avgGap,
        radar,
        lastAction: session.lastAction,
      }
    },
  }
}

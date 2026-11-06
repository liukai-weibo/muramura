/**
 * 天气只用于手记页顶部的展示，是外部只读数据：
 * 不落库、不进备份、不参与任何业务判断。
 */

/** 今天 + 未来 6 天，一共 7 天。 */
export const WEATHER_FORECAST_DAY_COUNT = 7

/** 当前实况。 */
export interface WeatherCurrent {
  /** 观测时刻，已按上海时区格式化为 ISO 字符串。 */
  observedAt: string
  /** 摄氏度。 */
  temperature: number
  /** WMO 天气现象码，见 `describeWeatherCode`。 */
  weatherCode: number
}

/** 一天的预报。 */
export interface WeatherDay {
  /** `YYYY-MM-DD`，上海时区当天。 */
  date: string
  weatherCode: number
  /** 当日最高，摄氏度。 */
  temperatureMax: number
  /** 当日最低，摄氏度。 */
  temperatureMin: number
}

/** 一次完整读取的结果。 */
export interface WeatherForecast {
  timezone: string
  /** 本地取到数据的时刻，界面用它显示「刚刚更新」。 */
  fetchedAt: string
  current: WeatherCurrent
  days: WeatherDay[]
}

/** 城市选择结果（来自地理编码，只用于取经纬度）。 */
export interface WeatherCity {
  id: string
  name: string
  region: string
  country: string
  latitude: number
  longitude: number
}

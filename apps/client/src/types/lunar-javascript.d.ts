declare module 'lunar-javascript' {
  interface LunarDate {
    getMonth(): number
    getDay(): number
    getJieQi(): string | undefined
  }

  interface SolarDate {
    getLunar(): LunarDate
  }

  export const Solar: {
    fromDate(date: Date): SolarDate
  }
}

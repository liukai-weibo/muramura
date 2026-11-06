import { z, createRoute } from '@hono/zod-openapi'
import { commonErrorResponses, createOpenApiApp, jsonError, jsonSuccess } from '../openapi'
import { validationError } from '../errors'
import { fetchWeatherForecast, searchWeatherCities } from '../../weather/open-meteo'

/**
 * 手记页的天气：只做外部天气的代理，不写库、不进备份。
 *
 * 放在认证之后，因为只有登录后在写手记的人才需要看天气；缓存由上游模块负责。
 */
const currentSchema = z.object({
  observedAt: z.string(),
  temperature: z.number(),
  weatherCode: z.number(),
})

const daySchema = z.object({
  date: z.string(),
  weatherCode: z.number(),
  temperatureMax: z.number(),
  temperatureMin: z.number(),
})

const forecastSchema = z.object({
  timezone: z.string(),
  fetchedAt: z.string(),
  current: currentSchema,
  days: z.array(daySchema),
})

const citySchema = z.object({
  id: z.string(),
  name: z.string(),
  region: z.string(),
  country: z.string(),
  latitude: z.number(),
  longitude: z.number(),
})

const coordinateSchema = z.string().regex(/^-?\d{1,3}(\.\d+)?$/)

function readCoordinate(value: string | undefined, limit: number, label: string): number {
  const parsed = Number(value)
  if (!coordinateSchema.safeParse(value).success || !Number.isFinite(parsed) || Math.abs(parsed) > limit) {
    throw validationError(`${label}不合法`)
  }
  return parsed
}

export function createWeatherRoutes() {
  return createOpenApiApp()
    .openapi(
      createRoute({
        method: 'get',
        path: '/forecast',
        tags: ['Weather'],
        summary: '七天天气',
        description: '按经纬度取当前实况与今天起 7 天的预报；上游不可用时返回 503。',
        request: {
          query: z.object({
            latitude: coordinateSchema,
            longitude: coordinateSchema,
          }),
        },
        responses: {
          200: jsonSuccess(forecastSchema, '天气'),
          400: commonErrorResponses[400],
          401: commonErrorResponses[401],
          503: jsonError('天气服务暂时不可用', 'UPSTREAM_UNAVAILABLE'),
        },
      }),
      async context => {
        const query = context.req.query()
        const latitude = readCoordinate(query.latitude, 90, '纬度')
        const longitude = readCoordinate(query.longitude, 180, '经度')
        return context.json(await fetchWeatherForecast(latitude, longitude), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/cities',
        tags: ['Weather'],
        summary: '城市检索',
        description: '按城市名（中文或拼音）检索候选城市，用于天气设置里选城市。',
        request: {
          query: z.object({ query: z.string().min(1).max(60) }),
        },
        responses: {
          200: jsonSuccess(z.array(citySchema), '候选城市'),
          400: commonErrorResponses[400],
          401: commonErrorResponses[401],
          503: jsonError('天气服务暂时不可用', 'UPSTREAM_UNAVAILABLE'),
        },
      }),
      async context => {
        const query = context.req.query('query')?.trim() ?? ''
        if (!query) throw validationError('请输入城市名')
        return context.json(await searchWeatherCities(query), 200)
      },
    )
}

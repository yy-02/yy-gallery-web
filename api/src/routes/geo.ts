import { Hono } from 'hono'
import { db, countries, prefectures, cities, photos } from '../db'
import { eq, sql, count } from 'drizzle-orm'
import { success, error } from '../lib/response'
import { transformCountry } from '../lib/transform'

const app = new Hono()

// GET /geo/ip - 获取用户IP所在国家
app.get('/ip', async (c) => {
  const cfCountry = c.req.header('cf-ipcountry')
  const vercelCountry = c.req.header('x-vercel-ip-country')
  const country = cfCountry || vercelCountry || 'US'
  
  return success(c, country)
})

// GET /geo/countries - 获取国家列表
app.get('/countries', async (c) => {
  try {
    const results = await db.select().from(countries)
    return success(c, results.map(transformCountry))
  } catch (e) {
    console.error(e)
    return error(c, 'Failed to fetch countries')
  }
})

// GET /geo/prefectures - 获取都道府县列表
app.get('/prefectures', async (c) => {
  try {
    const countryId = c.req.query('country_id')
    
    let whereClause = undefined
    if (countryId) {
      whereClause = eq(prefectures.countryId, Number(countryId))
    }

    const prefectureList = await db
      .select()
      .from(prefectures)
      .leftJoin(countries, eq(prefectures.countryId, countries.id))
      .where(whereClause)

    const citiesList = await db.select().from(cities)

    const photosCount = await db
      .select({
        cityId: photos.cityId,
        count: count(),
      })
      .from(photos)
      .groupBy(photos.cityId)

    const photosCountMap = new Map(
      photosCount.map((p) => [p.cityId, Number(p.count)])
    )

    const result = prefectureList.map((row) => {
      const prefCities = citiesList.filter(
        (city) => city.prefectureId === row.prefectures.id
      )

      const citiesWithCount = prefCities.map((city) => ({
        id: city.id,
        name: city.name,
        prefecture: {
          id: row.prefectures.id,
          name: row.prefectures.name,
          country: row.countries ? transformCountry(row.countries) : null,
        },
        photos_count: photosCountMap.get(city.id) ?? 0,
      }))

      const totalPhotos = citiesWithCount.reduce(
        (sum, city) => sum + city.photos_count,
        0
      )

      return {
        id: row.prefectures.id,
        name: row.prefectures.name,
        country: row.countries ? transformCountry(row.countries) : null,
        photos_count: totalPhotos,
        cities: citiesWithCount,
      }
    })

    return success(c, result)
  } catch (e) {
    console.error(e)
    return error(c, 'Failed to fetch prefectures')
  }
})

// GET /geo/prefecture - 获取单个都道府县详情
app.get('/prefecture', async (c) => {
  try {
    const id = Number(c.req.query('id'))
    if (!id) {
      return error(c, 'Missing prefecture id', 400)
    }

    const results = await db
      .select()
      .from(prefectures)
      .leftJoin(countries, eq(prefectures.countryId, countries.id))
      .where(eq(prefectures.id, id))
      .limit(1)

    if (results.length === 0) {
      return error(c, 'Prefecture not found', 404)
    }

    const row = results[0]
    
    const citiesList = await db
      .select()
      .from(cities)
      .where(eq(cities.prefectureId, id))

    const photosCount = await db
      .select({
        cityId: photos.cityId,
        count: count(),
      })
      .from(photos)
      .where(
        sql`${photos.cityId} IN (${sql.join(
          citiesList.map((c) => sql`${c.id}`),
          sql`, `
        )})`
      )
      .groupBy(photos.cityId)

    const photosCountMap = new Map(
      photosCount.map((p) => [p.cityId, Number(p.count)])
    )

    const citiesWithCount = citiesList.map((city) => ({
      id: city.id,
      name: city.name,
      prefecture: {
        id: row.prefectures.id,
        name: row.prefectures.name,
        country: row.countries ? transformCountry(row.countries) : null,
      },
      photos_count: photosCountMap.get(city.id) ?? 0,
    }))

    const totalPhotos = citiesWithCount.reduce(
      (sum, city) => sum + city.photos_count,
      0
    )

    return success(c, {
      id: row.prefectures.id,
      name: row.prefectures.name,
      country: row.countries ? transformCountry(row.countries) : null,
      photos_count: totalPhotos,
      cities: citiesWithCount,
    })
  } catch (e) {
    console.error(e)
    return error(c, 'Failed to fetch prefecture')
  }
})

export { app as geoRouter }

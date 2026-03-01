import { Hono } from 'hono'
import { db, photos, cameras, lenses, cities, places, prefectures, countries, manufactures, authors } from '../db'
import { eq, desc, sql, and } from 'drizzle-orm'
import { success, error } from '../lib/response'
import { transformPhoto } from '../lib/transform'

const app = new Hono()

// GET /photos/all - 获取照片列表
app.get('/all', async (c) => {
  try {
    const page = Number(c.req.query('page') || 1)
    const limit = Number(c.req.query('limit') || 20)
    const prefectureId = c.req.query('prefecture_id')
    const cityId = c.req.query('city_id')
    const offset = (page - 1) * limit

    let whereClause = undefined
    if (cityId) {
      whereClause = eq(photos.cityId, Number(cityId))
    } else if (prefectureId) {
      const cityIds = await db
        .select({ id: cities.id })
        .from(cities)
        .where(eq(cities.prefectureId, Number(prefectureId)))
      
      if (cityIds.length > 0) {
        whereClause = sql`${photos.cityId} IN (${sql.join(cityIds.map(c => sql`${c.id}`), sql`, `)})`
      }
    }

    const results = await db
      .select()
      .from(photos)
      .leftJoin(authors, eq(photos.authorId, authors.id))
      .leftJoin(cameras, eq(photos.cameraId, cameras.id))
      .leftJoin(manufactures, eq(cameras.manufactureId, manufactures.id))
      .leftJoin(lenses, eq(photos.lensId, lenses.id))
      .leftJoin(cities, eq(photos.cityId, cities.id))
      .leftJoin(prefectures, eq(cities.prefectureId, prefectures.id))
      .leftJoin(countries, eq(prefectures.countryId, countries.id))
      .leftJoin(places, eq(photos.placeId, places.id))
      .where(whereClause)
      .orderBy(desc(photos.datetime))
      .limit(limit)
      .offset(offset)

    const transformed = results.map((row) => {
      const photo = {
        ...row.photos,
        author: row.authors,
        camera: row.cameras ? { ...row.cameras, manufacture: row.manufactures } : null,
        lens: row.lenses ? { ...row.lenses, manufacture: row.manufactures } : null,
        city: row.cities
          ? {
              ...row.cities,
              prefecture: row.prefectures
                ? { ...row.prefectures, country: row.countries }
                : null,
            }
          : null,
        place: row.places,
      }
      return transformPhoto(photo)
    })

    return success(c, transformed)
  } catch (e) {
    console.error(e)
    return error(c, 'Failed to fetch photos')
  }
})

// GET /photos/get - 获取单张照片详情
app.get('/get', async (c) => {
  try {
    const id = Number(c.req.query('id'))
    if (!id) {
      return error(c, 'Missing photo id', 400)
    }

    const results = await db
      .select()
      .from(photos)
      .leftJoin(authors, eq(photos.authorId, authors.id))
      .leftJoin(cameras, eq(photos.cameraId, cameras.id))
      .leftJoin(manufactures, eq(cameras.manufactureId, manufactures.id))
      .leftJoin(lenses, eq(photos.lensId, lenses.id))
      .leftJoin(cities, eq(photos.cityId, cities.id))
      .leftJoin(prefectures, eq(cities.prefectureId, prefectures.id))
      .leftJoin(countries, eq(prefectures.countryId, countries.id))
      .leftJoin(places, eq(photos.placeId, places.id))
      .where(eq(photos.id, id))
      .limit(1)

    if (results.length === 0) {
      return error(c, 'Photo not found', 404)
    }

    const row = results[0]
    const photo = {
      ...row.photos,
      author: row.authors,
      camera: row.cameras ? { ...row.cameras, manufacture: row.manufactures } : null,
      lens: row.lenses ? { ...row.lenses, manufacture: row.manufactures } : null,
      city: row.cities
        ? {
            ...row.cities,
            prefecture: row.prefectures
              ? { ...row.prefectures, country: row.countries }
              : null,
          }
        : null,
      place: row.places,
    }

    return success(c, transformPhoto(photo))
  } catch (e) {
    console.error(e)
    return error(c, 'Failed to fetch photo')
  }
})

// GET /photos/lucky - 随机获取一张照片ID
app.get('/lucky', async (c) => {
  try {
    const result = await db
      .select({ id: photos.id })
      .from(photos)
      .orderBy(sql`RANDOM()`)
      .limit(1)

    if (result.length === 0) {
      return error(c, 'No photos found', 404)
    }

    return success(c, result[0].id)
  } catch (e) {
    console.error(e)
    return error(c, 'Failed to fetch random photo')
  }
})

// GET /photos/cluster - 获取照片聚类数据
app.get('/cluster', async (c) => {
  try {
    const countryId = c.req.query('country_id')

    let whereClause = eq(photos.hasLocation, true)
    
    if (countryId) {
      const prefectureIds = await db
        .select({ id: prefectures.id })
        .from(prefectures)
        .where(eq(prefectures.countryId, Number(countryId)))
      
      const cityIds = await db
        .select({ id: cities.id })
        .from(cities)
        .where(sql`${cities.prefectureId} IN (${sql.join(prefectureIds.map(p => sql`${p.id}`), sql`, `)})`)
      
      if (cityIds.length > 0) {
        whereClause = and(
          eq(photos.hasLocation, true),
          sql`${photos.cityId} IN (${sql.join(cityIds.map(c => sql`${c.id}`), sql`, `)})`
        )!
      }
    }

    const results = await db
      .select({
        id: photos.id,
        longitude: photos.longitude,
        latitude: photos.latitude,
        thumbUrl: photos.thumbUrl,
        cityId: photos.cityId,
      })
      .from(photos)
      .where(whereClause)

    const clusterItems = results.map((photo) => ({
      id: photo.id,
      coordinate: photo.longitude && photo.latitude
        ? { longitude: photo.longitude, latitude: photo.latitude }
        : undefined,
      thumb_file: { url: photo.thumbUrl ?? '', width: 0, height: 0 },
      clustering_identifier: `city_${photo.cityId ?? 0}`,
    }))

    return success(c, clusterItems)
  } catch (e) {
    console.error(e)
    return error(c, 'Failed to fetch cluster data')
  }
})

export { app as photosRouter }

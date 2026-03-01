import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

type Bindings = {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  MAPBOX_TOKEN?: string
  MAPKIT_PRIVATE_KEY?: string
  MAPKIT_KEY_ID?: string
  MAPKIT_TEAM_ID?: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())

const getSupabase = (c: { env: Bindings }): SupabaseClient => {
  return createClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY)
}

const success = <T>(payload: T) => ({
  code: 0,
  payload,
  success: true,
})

const error = (message: string, code: number = 500) => ({
  code,
  payload: message,
  success: false,
})

app.get('/', (c) => {
  return c.json({
    name: 'YY Gallery API',
    version: '1.0.0',
    runtime: 'Cloudflare Workers',
    env_check: {
      supabase_url_set: !!c.env.SUPABASE_URL,
      supabase_key_set: !!c.env.SUPABASE_ANON_KEY,
      supabase_url_preview: c.env.SUPABASE_URL ? c.env.SUPABASE_URL.substring(0, 30) + '...' : 'NOT SET',
    }
  })
})

app.get('/debug/test-db', async (c) => {
  try {
    const supabase = getSupabase(c)
    const { data, error: err } = await supabase.from('countries').select('*')
    
    if (err) {
      return c.json({
        success: false,
        error: err.message,
        code: err.code,
        details: err.details,
        hint: err.hint,
      })
    }
    
    return c.json({
      success: true,
      count: data?.length ?? 0,
      data: data,
    })
  } catch (e: any) {
    return c.json({
      success: false,
      error: e.message,
      stack: e.stack,
    })
  }
})

app.get('/photos/all', async (c) => {
  try {
    const supabase = getSupabase(c)
    const page = Number(c.req.query('page') || 1)
    const limit = Number(c.req.query('limit') || 20)
    const offset = (page - 1) * limit
    const prefectureId = c.req.query('prefecture_id')
    const cityId = c.req.query('city_id')

    let query = supabase
      .from('photos')
      .select(`
        *,
        cameras (*, manufactures (*)),
        lenses (*, manufactures (*)),
        cities (*, prefectures (*, countries (*)))
      `)
      .order('datetime', { ascending: false })
      .range(offset, offset + limit - 1)

    if (cityId) {
      query = query.eq('city_id', Number(cityId))
    } else if (prefectureId) {
      const { data: cities } = await supabase
        .from('cities')
        .select('id')
        .eq('prefecture_id', Number(prefectureId))
      
      if (cities && cities.length > 0) {
        query = query.in('city_id', cities.map(c => c.id))
      }
    }

    const { data: photos, error: err } = await query

    if (err) throw err

    const transformed = (photos || []).map((photo: any) => ({
      id: photo.id,
      title: photo.title,
      description: photo.description,
      metadata: {
        has_location: photo.has_location ?? false,
        datetime: photo.datetime ?? new Date().toISOString(),
        exposure_time: photo.exposure_time,
        exposure_time_rat: photo.exposure_time_rat,
        f_number: photo.f_number,
        photographic_sensitivity: photo.photographic_sensitivity,
        focal_length: photo.focal_length,
        timezone: photo.timezone,
        location: photo.has_location && photo.longitude && photo.latitude
          ? { longitude: photo.longitude, latitude: photo.latitude }
          : undefined,
        camera: photo.cameras ? {
          id: photo.cameras.id,
          model: photo.cameras.model,
          manufacture: photo.cameras.manufactures || { id: 0, name: 'Unknown' },
          general_name: photo.cameras.general_name,
        } : undefined,
        lens: photo.lenses ? {
          id: photo.lenses.id,
          model: photo.lenses.model,
          manufacture: photo.lenses.manufactures || { id: 0, name: 'Unknown' },
        } : undefined,
        city: photo.cities ? {
          id: photo.cities.id,
          name: photo.cities.name,
          photos_count: 0,
          prefecture: photo.cities.prefectures ? {
            id: photo.cities.prefectures.id,
            name: photo.cities.prefectures.name,
            country: photo.cities.prefectures.countries || null,
            cities: [],
          } : null,
        } : undefined,
      },
      thumb_file: {
        url: photo.thumb_url ?? '',
        width: photo.thumb_width ?? 0,
        height: photo.thumb_height ?? 0,
      },
      medium_file: photo.medium_url ? {
        url: photo.medium_url,
        width: photo.medium_width ?? 0,
        height: photo.medium_height ?? 0,
      } : undefined,
      large_file: photo.large_url ? {
        url: photo.large_url,
        width: photo.large_width ?? 0,
        height: photo.large_height ?? 0,
      } : undefined,
    }))

    return c.json(success(transformed), 200, {
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    })
  } catch (e) {
    console.error(e)
    return c.json(error('Failed to fetch photos'), 500)
  }
})

app.get('/photos/get', async (c) => {
  try {
    const supabase = getSupabase(c)
    const id = Number(c.req.query('id'))
    if (!id) {
      return c.json(error('Missing photo id', 400), 400)
    }

    const { data: photo, error: err } = await supabase
      .from('photos')
      .select(`
        *,
        cameras (*, manufactures (*)),
        lenses (*, manufactures (*)),
        cities (*, prefectures (*, countries (*))),
        places (*)
      `)
      .eq('id', id)
      .single()

    if (err || !photo) {
      return c.json(error('Photo not found', 404), 404)
    }

    return c.json(success({
      id: photo.id,
      title: photo.title,
      description: photo.description,
      description_zh: photo.description_zh,
      description_en: photo.description_en,
      metadata: {
        has_location: photo.has_location ?? false,
        datetime: photo.datetime ?? new Date().toISOString(),
        exposure_time: photo.exposure_time,
        exposure_time_rat: photo.exposure_time_rat,
        f_number: photo.f_number,
        photographic_sensitivity: photo.photographic_sensitivity,
        focal_length: photo.focal_length,
        timezone: photo.timezone,
        altitude: photo.altitude,
        location: photo.has_location && photo.longitude && photo.latitude
          ? { longitude: photo.longitude, latitude: photo.latitude }
          : undefined,
        camera: photo.cameras ? {
          id: photo.cameras.id,
          model: photo.cameras.model,
          manufacture: photo.cameras.manufactures || { id: 0, name: 'Unknown' },
          general_name: photo.cameras.general_name,
        } : undefined,
        lens: photo.lenses ? {
          id: photo.lenses.id,
          model: photo.lenses.model,
          manufacture: photo.lenses.manufactures || { id: 0, name: 'Unknown' },
        } : undefined,
        city: photo.cities ? {
          id: photo.cities.id,
          name: photo.cities.name,
          photos_count: 0,
          prefecture: photo.cities.prefectures ? {
            id: photo.cities.prefectures.id,
            name: photo.cities.prefectures.name,
            country: photo.cities.prefectures.countries || null,
            cities: [],
          } : null,
        } : undefined,
        place: photo.places ? {
          id: photo.places.id,
          name: photo.places.name,
          geom: {
            longitude: photo.places.longitude ?? 0,
            latitude: photo.places.latitude ?? 0,
          },
        } : undefined,
      },
      thumb_file: {
        url: photo.thumb_url ?? '',
        width: photo.thumb_width ?? 0,
        height: photo.thumb_height ?? 0,
      },
      medium_file: photo.medium_url ? {
        url: photo.medium_url,
        width: photo.medium_width ?? 0,
        height: photo.medium_height ?? 0,
      } : undefined,
      large_file: photo.large_url ? {
        url: photo.large_url,
        width: photo.large_width ?? 0,
        height: photo.large_height ?? 0,
      } : undefined,
      hdr_file: photo.hdr_url ? {
        url: photo.hdr_url,
        width: photo.hdr_width ?? 0,
        height: photo.hdr_height ?? 0,
      } : undefined,
    }))
  } catch (e) {
    console.error(e)
    return c.json(error('Failed to fetch photo'), 500)
  }
})

app.get('/photos/lucky', async (c) => {
  try {
    const supabase = getSupabase(c)
    
    const { count } = await supabase
      .from('photos')
      .select('*', { count: 'exact', head: true })

    if (!count || count === 0) {
      return c.json(error('No photos found', 404), 404)
    }

    const randomOffset = Math.floor(Math.random() * count)
    
    const { data: photos } = await supabase
      .from('photos')
      .select('id')
      .range(randomOffset, randomOffset)
      .limit(1)

    if (!photos || photos.length === 0) {
      return c.json(error('No photos found', 404), 404)
    }

    return c.json(success(photos[0].id))
  } catch (e) {
    console.error(e)
    return c.json(error('Failed to fetch random photo'), 500)
  }
})

app.get('/photos/cluster', async (c) => {
  try {
    const supabase = getSupabase(c)
    const countryId = c.req.query('country_id')

    let query = supabase
      .from('photos')
      .select('id, longitude, latitude, thumb_url, city_id')
      .eq('has_location', true)

    if (countryId) {
      const { data: prefectures } = await supabase
        .from('prefectures')
        .select('id')
        .eq('country_id', Number(countryId))
      
      if (prefectures && prefectures.length > 0) {
        const { data: cities } = await supabase
          .from('cities')
          .select('id')
          .in('prefecture_id', prefectures.map(p => p.id))
        
        if (cities && cities.length > 0) {
          query = query.in('city_id', cities.map(c => c.id))
        }
      }
    }

    const { data: photos, error: err } = await query

    if (err) throw err

    const clusterItems = (photos || []).map((photo: any) => ({
      id: photo.id,
      coordinate: photo.longitude && photo.latitude
        ? { longitude: photo.longitude, latitude: photo.latitude }
        : undefined,
      thumb_file: { url: photo.thumb_url ?? '', width: 0, height: 0 },
      clustering_identifier: `city_${photo.city_id ?? 0}`,
    }))

    return c.json(success(clusterItems))
  } catch (e) {
    console.error(e)
    return c.json(error('Failed to fetch cluster data'), 500)
  }
})

app.get('/geo/ip', async (c) => {
  const country = c.req.header('cf-ipcountry') || 'US'
  return c.json(success(country))
})

app.get('/geo/countries', async (c) => {
  try {
    const supabase = getSupabase(c)
    const { data: countries, error: err } = await supabase
      .from('countries')
      .select('*')

    if (err) throw err

    return c.json(success((countries || []).map((country: any) => ({
      id: country.id,
      name: country.name,
      code: country.code,
      center: country.center ?? [0, 0],
      extent: country.extent ?? [0, 0, 0, 0],
      zoom: country.zoom ?? [1, 1, 1],
    }))), 200, {
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    })
  } catch (e) {
    console.error(e)
    return c.json(error('Failed to fetch countries'), 500)
  }
})

app.get('/geo/prefectures', async (c) => {
  try {
    const supabase = getSupabase(c)
    const countryId = c.req.query('country_id')

    let query = supabase
      .from('prefectures')
      .select('*, countries (*)')

    if (countryId) {
      query = query.eq('country_id', Number(countryId))
    }

    const { data: prefectures, error: err } = await query

    if (err) throw err

    const { data: cities } = await supabase.from('cities').select('*')
    
    const result = (prefectures || []).map((pref: any) => ({
      id: pref.id,
      name: pref.name,
      country: pref.countries ? {
        id: pref.countries.id,
        name: pref.countries.name,
        code: pref.countries.code,
        center: pref.countries.center ?? [0, 0],
        extent: pref.countries.extent ?? [0, 0, 0, 0],
        zoom: pref.countries.zoom ?? [1, 1, 1],
      } : null,
      photos_count: 0,
      cities: (cities || [])
        .filter((c: any) => c.prefecture_id === pref.id)
        .map((c: any) => ({
          id: c.id,
          name: c.name,
          photos_count: 0,
        })),
    }))

    return c.json(success(result), 200, {
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    })
  } catch (e) {
    console.error(e)
    return c.json(error('Failed to fetch prefectures'), 500)
  }
})

app.get('/geo/prefecture', async (c) => {
  try {
    const supabase = getSupabase(c)
    const id = Number(c.req.query('id'))
    
    if (!id) {
      return c.json(error('Missing prefecture id', 400), 400)
    }

    const { data: pref, error: err } = await supabase
      .from('prefectures')
      .select('*, countries (*)')
      .eq('id', id)
      .single()

    if (err || !pref) {
      return c.json(error('Prefecture not found', 404), 404)
    }

    const { data: cities } = await supabase
      .from('cities')
      .select('*')
      .eq('prefecture_id', id)

    return c.json(success({
      id: pref.id,
      name: pref.name,
      country: pref.countries ? {
        id: pref.countries.id,
        name: pref.countries.name,
        code: pref.countries.code,
        center: pref.countries.center ?? [0, 0],
        extent: pref.countries.extent ?? [0, 0, 0, 0],
        zoom: pref.countries.zoom ?? [1, 1, 1],
      } : null,
      photos_count: 0,
      cities: (cities || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        photos_count: 0,
      })),
    }))
  } catch (e) {
    console.error(e)
    return c.json(error('Failed to fetch prefecture'), 500)
  }
})

app.get('/mapbox/token', async (c) => {
  const token = c.env.MAPBOX_TOKEN
  if (!token) {
    return c.json(error('Mapbox token not configured', 500), 500)
  }
  return c.json(success(token))
})

app.get('/mapkit-js/token', async (c) => {
  const privateKeyPem = c.env.MAPKIT_PRIVATE_KEY
  const keyId = c.env.MAPKIT_KEY_ID
  const teamId = c.env.MAPKIT_TEAM_ID

  if (!privateKeyPem || !keyId || !teamId) {
    return c.json(error('MapKit credentials not configured', 500), 500)
  }

  try {
    const header = {
      alg: 'ES256',
      typ: 'JWT',
      kid: keyId,
    }

    const now = Math.floor(Date.now() / 1000)
    const payload = {
      iss: teamId,
      iat: now,
      exp: now + 3600,
      origin: c.req.header('origin') || '*',
    }

    const base64urlEncode = (data: string) => {
      return btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    }

    const base64Header = base64urlEncode(JSON.stringify(header))
    const base64Payload = base64urlEncode(JSON.stringify(payload))
    const unsignedToken = `${base64Header}.${base64Payload}`

    // Parse PEM key for Web Crypto API
    const pemContents = privateKeyPem
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s/g, '')
    
    const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0))
    
    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      binaryKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey,
      new TextEncoder().encode(unsignedToken)
    )

    // Convert signature to base64url
    const signatureArray = new Uint8Array(signature)
    const signatureBase64 = btoa(String.fromCharCode(...signatureArray))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    const token = `${unsignedToken}.${signatureBase64}`
    return c.json(success(token))
  } catch (e) {
    console.error('Failed to generate MapKit token:', e)
    return c.json(error('Failed to generate token', 500), 500)
  }
})

// ==================== Animals API ====================

app.get('/animals/all', async (c) => {
  try {
    const supabase = getSupabase(c)
    const { data: animals, error: err } = await supabase
      .from('animals')
      .select('*')
      .order('name_zh', { ascending: true })

    if (err) throw err

    return c.json(success(animals || []), 200, {
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    })
  } catch (e) {
    console.error(e)
    return c.json(error('Failed to fetch animals'), 500)
  }
})

app.get('/animals/photos', async (c) => {
  try {
    const supabase = getSupabase(c)
    const pageSize = Number(c.req.query('page_size') || 20)
    const lastDatetime = c.req.query('last_datetime')
    const animalId = c.req.query('animal_id')

    let query = supabase
      .from('animal_photos')
      .select(`
        *,
        animals (*),
        cameras (*, manufactures (*)),
        lenses (*, manufactures (*)),
        cities (*, prefectures (*, countries (*)))
      `)
      .order('datetime', { ascending: false })
      .limit(pageSize)

    if (lastDatetime) {
      query = query.lt('datetime', lastDatetime)
    }

    if (animalId) {
      query = query.eq('animal_id', Number(animalId))
    }

    const { data: photos, error: err } = await query

    if (err) throw err

    const transformed = (photos || []).map((photo: any) => ({
      id: photo.id,
      animal: photo.animals ? {
        id: photo.animals.id,
        name_zh: photo.animals.name_zh,
        name_en: photo.animals.name_en,
        scientific_name: photo.animals.scientific_name,
        description_zh: photo.animals.description_zh,
        description_en: photo.animals.description_en,
        category: photo.animals.category,
      } : null,
      description_zh: photo.description_zh,
      description_en: photo.description_en,
      metadata: {
        has_location: photo.has_location ?? false,
        datetime: photo.datetime ?? new Date().toISOString(),
        exposure_time: photo.exposure_time,
        exposure_time_rat: photo.exposure_time_rat,
        f_number: photo.f_number,
        photographic_sensitivity: photo.photographic_sensitivity,
        focal_length: photo.focal_length,
        timezone: photo.timezone,
        location: photo.has_location && photo.longitude && photo.latitude
          ? { longitude: photo.longitude, latitude: photo.latitude }
          : undefined,
        camera: photo.cameras ? {
          id: photo.cameras.id,
          model: photo.cameras.model,
          manufacture: photo.cameras.manufactures || { id: 0, name: 'Unknown' },
          general_name: photo.cameras.general_name,
        } : undefined,
        lens: photo.lenses ? {
          id: photo.lenses.id,
          model: photo.lenses.model,
          manufacture: photo.lenses.manufactures || { id: 0, name: 'Unknown' },
        } : undefined,
        city: photo.cities ? {
          id: photo.cities.id,
          name: photo.cities.name,
          photos_count: 0,
          prefecture: photo.cities.prefectures ? {
            id: photo.cities.prefectures.id,
            name: photo.cities.prefectures.name,
            country: photo.cities.prefectures.countries || null,
            cities: [],
          } : null,
        } : undefined,
      },
      thumb_file: {
        url: photo.thumb_url ?? '',
        width: photo.thumb_width ?? 0,
        height: photo.thumb_height ?? 0,
      },
      medium_file: photo.medium_url ? {
        url: photo.medium_url,
        width: photo.medium_width ?? 0,
        height: photo.medium_height ?? 0,
      } : undefined,
      large_file: photo.large_url ? {
        url: photo.large_url,
        width: photo.large_width ?? 0,
        height: photo.large_height ?? 0,
      } : undefined,
    }))

    return c.json(success(transformed), 200, {
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    })
  } catch (e) {
    console.error(e)
    return c.json(error('Failed to fetch animal photos'), 500)
  }
})

app.get('/animals/photo', async (c) => {
  try {
    const supabase = getSupabase(c)
    const id = Number(c.req.query('id'))
    if (!id) {
      return c.json(error('Missing photo id', 400), 400)
    }

    const { data: photo, error: err } = await supabase
      .from('animal_photos')
      .select(`
        *,
        animals (*),
        cameras (*, manufactures (*)),
        lenses (*, manufactures (*)),
        cities (*, prefectures (*, countries (*))),
        places (*)
      `)
      .eq('id', id)
      .single()

    if (err || !photo) {
      return c.json(error('Animal photo not found', 404), 404)
    }

    return c.json(success({
      id: photo.id,
      animal: photo.animals ? {
        id: photo.animals.id,
        name_zh: photo.animals.name_zh,
        name_en: photo.animals.name_en,
        scientific_name: photo.animals.scientific_name,
        description_zh: photo.animals.description_zh,
        description_en: photo.animals.description_en,
        category: photo.animals.category,
      } : null,
      description_zh: photo.description_zh,
      description_en: photo.description_en,
      metadata: {
        has_location: photo.has_location ?? false,
        datetime: photo.datetime ?? new Date().toISOString(),
        exposure_time: photo.exposure_time,
        exposure_time_rat: photo.exposure_time_rat,
        f_number: photo.f_number,
        photographic_sensitivity: photo.photographic_sensitivity,
        focal_length: photo.focal_length,
        timezone: photo.timezone,
        altitude: photo.altitude,
        location: photo.has_location && photo.longitude && photo.latitude
          ? { longitude: photo.longitude, latitude: photo.latitude }
          : undefined,
        camera: photo.cameras ? {
          id: photo.cameras.id,
          model: photo.cameras.model,
          manufacture: photo.cameras.manufactures || { id: 0, name: 'Unknown' },
          general_name: photo.cameras.general_name,
        } : undefined,
        lens: photo.lenses ? {
          id: photo.lenses.id,
          model: photo.lenses.model,
          manufacture: photo.lenses.manufactures || { id: 0, name: 'Unknown' },
        } : undefined,
        city: photo.cities ? {
          id: photo.cities.id,
          name: photo.cities.name,
          photos_count: 0,
          prefecture: photo.cities.prefectures ? {
            id: photo.cities.prefectures.id,
            name: photo.cities.prefectures.name,
            country: photo.cities.prefectures.countries || null,
            cities: [],
          } : null,
        } : undefined,
        place: photo.places ? {
          id: photo.places.id,
          name: photo.places.name,
          geom: {
            longitude: photo.places.longitude ?? 0,
            latitude: photo.places.latitude ?? 0,
          },
        } : undefined,
      },
      thumb_file: {
        url: photo.thumb_url ?? '',
        width: photo.thumb_width ?? 0,
        height: photo.thumb_height ?? 0,
      },
      medium_file: photo.medium_url ? {
        url: photo.medium_url,
        width: photo.medium_width ?? 0,
        height: photo.medium_height ?? 0,
      } : undefined,
      large_file: photo.large_url ? {
        url: photo.large_url,
        width: photo.large_width ?? 0,
        height: photo.large_height ?? 0,
      } : undefined,
      hdr_file: photo.hdr_url ? {
        url: photo.hdr_url,
        width: photo.hdr_width ?? 0,
        height: photo.hdr_height ?? 0,
      } : undefined,
    }))
  } catch (e) {
    console.error(e)
    return c.json(error('Failed to fetch animal photo'), 500)
  }
})

export default app

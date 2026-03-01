import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { corsMiddleware } from './middleware/cors'
import { cacheControl, noCache } from './middleware/cache'
import { photosRouter } from './routes/photos'
import { geoRouter } from './routes/geo'
import { uploadRouter } from './routes/upload'
import { mapboxRouter, mapkitRouter } from './routes/maptoken'
import 'dotenv/config'

const app = new Hono()

app.use('*', logger())
app.use('*', corsMiddleware)
app.use('*', prettyJSON())

app.use('/photos/*', cacheControl(300))
app.use('/geo/*', cacheControl(3600))
app.use('/upload/*', noCache)

app.get('/', (c) => {
  return c.json({
    name: 'YY Gallery API',
    version: '1.0.0',
    endpoints: [
      'GET /photos/all',
      'GET /photos/get?id=',
      'GET /photos/lucky',
      'GET /photos/cluster',
      'GET /geo/ip',
      'GET /geo/countries',
      'GET /geo/prefectures',
      'GET /geo/prefecture?id=',
      'GET /mapbox/token',
      'GET /mapkit-js/token',
      'POST /upload',
      'POST /upload/batch',
    ],
  })
})

app.route('/photos', photosRouter)
app.route('/geo', geoRouter)
app.route('/upload', uploadRouter)
app.route('/mapbox', mapboxRouter)
app.route('/mapkit-js', mapkitRouter)

app.notFound((c) => {
  return c.json({ code: 404, payload: 'Not Found', success: false }, 404)
})

app.onError((err, c) => {
  console.error('Error:', err)
  return c.json({ code: 500, payload: 'Internal Server Error', success: false }, 500)
})

export default app

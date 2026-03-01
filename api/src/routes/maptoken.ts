import { Hono } from 'hono'
import { success, error } from '../lib/response'

const app = new Hono()

// GET /mapbox/token - 获取 Mapbox Token
app.get('/token', async (c) => {
  const token = process.env.MAPBOX_TOKEN
  if (!token) {
    return error(c, 'Mapbox token not configured', 500)
  }
  return success(c, token)
})

export { app as mapboxRouter }

// Apple MapKit Token 生成器
const mapkitApp = new Hono()

mapkitApp.get('/token', async (c) => {
  const privateKey = process.env.MAPKIT_PRIVATE_KEY
  const keyId = process.env.MAPKIT_KEY_ID
  const teamId = process.env.MAPKIT_TEAM_ID

  if (!privateKey || !keyId || !teamId) {
    return error(c, 'MapKit credentials not configured', 500)
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

    const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url')
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url')
    
    const { createSign } = await import('crypto')
    const sign = createSign('SHA256')
    sign.update(`${base64Header}.${base64Payload}`)
    const signature = sign.sign(privateKey, 'base64url')

    const token = `${base64Header}.${base64Payload}.${signature}`
    return success(c, token)
  } catch (e) {
    console.error('Failed to generate MapKit token:', e)
    return error(c, 'Failed to generate token', 500)
  }
})

export { mapkitApp as mapkitRouter }

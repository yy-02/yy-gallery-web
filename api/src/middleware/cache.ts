import type { MiddlewareHandler } from 'hono'

export const cacheControl = (maxAge: number = 300): MiddlewareHandler => {
  return async (c, next) => {
    await next()
    
    if (c.req.method === 'GET' && c.res.status === 200) {
      c.res.headers.set('Cache-Control', `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}`)
      c.res.headers.set('CDN-Cache-Control', `max-age=${maxAge}`)
      c.res.headers.set('Cloudflare-CDN-Cache-Control', `max-age=${maxAge}`)
    }
  }
}

export const noCache: MiddlewareHandler = async (c, next) => {
  await next()
  c.res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
}

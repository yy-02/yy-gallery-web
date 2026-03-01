import type { Context } from 'hono'

export interface ApiResponse<T> {
  code: number
  payload: T
  success: boolean
}

export function success<T>(c: Context, payload: T) {
  return c.json<ApiResponse<T>>({
    code: 0,
    payload,
    success: true,
  })
}

export function error(c: Context, message: string, code: number = 500) {
  return c.json<ApiResponse<string>>(
    {
      code,
      payload: message,
      success: false,
    },
    code
  )
}

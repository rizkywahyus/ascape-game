/**
 * Where the game server lives. Same origin by default (dev proxy, nginx in docker-compose); set VITE_SERVER_URL
 * when the static client and the server are deployed to different hosts.
 */
const SERVER_ORIGIN = (import.meta.env.VITE_SERVER_URL ?? '').replace(/\/+$/, '')

export function apiUrl(path: string): string {
  return `${SERVER_ORIGIN}${path}`
}

export function gameSocketUrl(token: string | null): string {
  const base = SERVER_ORIGIN || location.origin
  const url = new URL('/ws', base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  if (token) url.searchParams.set('token', token)
  return url.toString()
}

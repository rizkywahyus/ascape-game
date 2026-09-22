import { apiUrl } from '../net/serverUrl'

/** REST client for /api. Shapes mirror the server's controllers. */

export interface Profile {
  id: string
  username: string
  glyph: string
  color: string
}

export interface LeaderboardEntry {
  username: string
  glyph: string
  color: string
  matches: number
  wins: number
  score: number
  monsterWins: number
  survivorEscapes: number
}

export type LeaderboardKind = 'overall' | 'monster' | 'survivor'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export class Api {
  private readonly token: () => string | null

  constructor(token: () => string | null) {
    this.token = token
  }

  me(): Promise<Profile> {
    return this.request<Profile>('GET', '/api/me')
  }

  updateMe(changes: Partial<Pick<Profile, 'username' | 'glyph' | 'color'>>): Promise<Profile> {
    return this.request<Profile>('PATCH', '/api/me', changes)
  }

  leaderboard(kind: LeaderboardKind): Promise<LeaderboardEntry[]> {
    return this.request<LeaderboardEntry[]>('GET', `/api/leaderboard?kind=${kind}&limit=10`)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    const token = this.token()
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetch(apiUrl(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { message?: string; detail?: string } | null
      throw new ApiError(response.status, detail?.detail ?? detail?.message ?? `${method} ${path} failed (${response.status})`)
    }
    return (await response.json()) as T
  }
}

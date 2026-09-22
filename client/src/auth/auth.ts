import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase Auth wrapper. When the VITE_SUPABASE_* variables are missing the game runs in "offline guest" mode:
 * no token is sent and the server must allow unauthenticated connections.
 */
export class Auth {
  private readonly client: SupabaseClient | null
  private session: Session | null = null

  constructor() {
    const url = import.meta.env.VITE_SUPABASE_URL
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    this.client = url && key ? createClient(url, key) : null
    this.client?.auth.onAuthStateChange((_event, session) => {
      this.session = session
    })
  }

  get enabled(): boolean {
    return this.client !== null
  }

  /** Restores a stored session (including one arriving via a magic-link redirect). */
  async restore(): Promise<boolean> {
    if (!this.client) return false
    const { data, error } = await this.client.auth.getSession()
    if (error) throw new Error(`Could not restore session: ${error.message}`)
    this.session = data.session
    return this.session !== null
  }

  async playAsGuest(): Promise<void> {
    const { data, error } = await this.requireClient().auth.signInAnonymously()
    if (error) throw new Error(guestErrorMessage(error.message))
    this.session = data.session
  }

  async sendMagicLink(email: string): Promise<void> {
    const { error } = await this.requireClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.pathname },
    })
    if (error) throw new Error(error.message)
  }

  async signOut(): Promise<void> {
    await this.client?.auth.signOut()
    this.session = null
  }

  /** Current access token; supabase-js refreshes it in the background. */
  accessToken(): string | null {
    return this.session?.access_token ?? null
  }

  isAnonymous(): boolean {
    return this.session?.user.is_anonymous ?? false
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw new Error('Supabase is not configured')
    return this.client
  }
}

function guestErrorMessage(message: string): string {
  return /anonymous/i.test(message)
    ? 'Guest play is disabled on this server (Supabase: enable anonymous sign-ins).'
    : message
}

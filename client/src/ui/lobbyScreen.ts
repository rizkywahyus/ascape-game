import type { RolePreference } from '../net/protocol'
import { ApiError, type Api, type LeaderboardKind, type Profile } from './api'
import { errorText } from './authScreen'
import { el, panel } from './dom'
import { LOGO } from './logo'

export interface LobbyCallbacks {
  onPlay(rolePreference: RolePreference): void
  onSignOut(): void
}

const ROLE_LABELS: Record<RolePreference, string> = {
  survivor: '@ survivor',
  monster: 'M monster',
  any: '? either',
}

const LEADERBOARD_LABELS: Record<LeaderboardKind, string> = {
  overall: 'overall',
  monster: 'monster wins',
  survivor: 'escapes',
}

/** Main menu: profile look, role preference, find match, leaderboards. */
export function showLobbyScreen(
  root: HTMLElement,
  api: Api,
  signedIn: boolean,
  initialRole: RolePreference,
  callbacks: LobbyCallbacks,
): void {
  let role = initialRole

  const roleButtons = (Object.keys(ROLE_LABELS) as RolePreference[]).map((option) => {
    const button = el('button', {}, ROLE_LABELS[option])
    button.addEventListener('click', () => {
      role = option
      roleButtons.forEach((other) => other.classList.toggle('selected', other === button))
    })
    button.classList.toggle('selected', option === role)
    return button
  })
  const playButton = el('button', { class: 'primary' }, 'Find match ▶')
  playButton.addEventListener('click', () => callbacks.onPlay(role))

  const signOut = el('button', {}, signedIn ? 'Sign out' : 'Back')
  signOut.addEventListener('click', () => callbacks.onSignOut())

  root.replaceChildren(
    el(
      'div',
      { class: 'screen' },
      el('pre', { class: 'logo' }, LOGO),
      el(
        'div',
        { class: 'columns' },
        panel(
          'play',
          el('p', { class: 'hint' }, 'preferred role (bots fill the other slots):'),
          el('div', { class: 'row' }, ...roleButtons),
          el('div', { class: 'row', style: 'margin-top: 12px' }, playButton, signOut),
          el(
            'p',
            { class: 'hint' },
            'survivor: WASD · Shift sprint · hold E repair/revive/heal · E hide · F light · Q rock · Space skill check',
          ),
          el(
            'p',
            { class: 'hint' },
            'monster: WASD · Space attack · hold E take downed · E search locker · Shift lunge · R sonar · T trap · Esc menu',
          ),
        ),
        signedIn ? profilePanel(api) : panel('profile', el('p', { class: 'hint' }, 'Sign in to pick a name and look.')),
      ),
      leaderboardPanel(api),
    ),
  )
  playButton.focus()
}

function profilePanel(api: Api): HTMLElement {
  const message = el('p', { class: 'message' }, 'loading…')
  const username = el('input', { maxlength: '24', 'aria-label': 'username' })
  const glyph = el('input', { maxlength: '1', 'aria-label': 'glyph', style: 'flex: 0 0 3em; text-align: center' })
  const color = el('input', { type: 'color', 'aria-label': 'colour' })
  const preview = el('span', { class: 'preview' })
  const save = el('button', {}, 'Save')
  const updatePreview = () => {
    preview.textContent = glyph.value || '@'
    preview.style.color = color.value
  }
  glyph.addEventListener('input', updatePreview)
  color.addEventListener('input', updatePreview)

  const fill = (profile: Profile) => {
    username.value = profile.username
    glyph.value = profile.glyph
    color.value = profile.color
    updatePreview()
  }
  api
    .me()
    .then((profile) => {
      fill(profile)
      message.textContent = ''
    })
    .catch((error) => {
      message.textContent = errorText(error)
      message.className = 'message error'
    })

  save.addEventListener('click', async () => {
    save.disabled = true
    try {
      fill(await api.updateMe({ username: username.value.trim(), glyph: glyph.value, color: color.value }))
      message.textContent = 'saved · used from your next match'
      message.className = 'message ok'
    } catch (error) {
      message.textContent = error instanceof ApiError ? error.message : errorText(error)
      message.className = 'message error'
    } finally {
      save.disabled = false
    }
  })

  return panel(
    'profile',
    el('div', { class: 'row' }, el('label', {}, 'name'), username),
    el('div', { class: 'row', style: 'margin-top: 8px' }, el('label', {}, 'look'), glyph, color, preview, save),
    message,
  )
}

function leaderboardPanel(api: Api): HTMLElement {
  const body = el('tbody')
  const tabs = (Object.keys(LEADERBOARD_LABELS) as LeaderboardKind[]).map((kind) => {
    const tab = el('button', {}, LEADERBOARD_LABELS[kind])
    tab.addEventListener('click', () => load(kind, tab))
    return tab
  })

  const load = async (kind: LeaderboardKind, tab: HTMLButtonElement) => {
    tabs.forEach((other) => other.classList.toggle('selected', other === tab))
    body.replaceChildren(row('loading…'))
    try {
      const entries = await api.leaderboard(kind)
      body.replaceChildren(
        ...(entries.length === 0
          ? [row('no finished matches yet')]
          : entries.map((entry, index) => {
              const glyph = el('span', {}, entry.glyph)
              glyph.style.color = entry.color
              const value = kind === 'monster' ? entry.monsterWins : kind === 'survivor' ? entry.survivorEscapes : entry.score
              return el(
                'tr',
                {},
                el('td', { class: 'num' }, String(index + 1)),
                el('td', {}, glyph, ' ', entry.username),
                el('td', { class: 'num' }, String(entry.matches)),
                el('td', { class: 'num' }, String(value)),
              )
            })),
      )
    } catch (error) {
      body.replaceChildren(row(errorText(error)))
    }
  }
  void load('overall', tabs[0])

  return panel(
    'leaderboard',
    el('div', { class: 'row' }, ...tabs),
    el(
      'table',
      { style: 'margin-top: 8px' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { class: 'num' }, '#'),
          el('th', {}, 'player'),
          el('th', { class: 'num' }, 'games'),
          el('th', { class: 'num' }, 'score'),
        ),
      ),
      body,
    ),
  )
}

function row(text: string): HTMLTableRowElement {
  return el('tr', {}, el('td', { colspan: '4', class: 'hint' }, text))
}

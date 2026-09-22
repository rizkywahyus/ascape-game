import type { Auth } from '../auth/auth'
import { el, howItWorks, menuHeader, panel } from './dom'

/** Sign-in: anonymous guest play or an email magic link. Resolves once a session exists. */
export function showAuthScreen(root: HTMLElement, auth: Auth): Promise<void> {
  return new Promise((resolve) => {
    const message = el('p', { class: 'message' })
    const setMessage = (text: string, kind: 'error' | 'ok' | '' = '') => {
      message.textContent = text
      message.className = `message ${kind}`
    }

    const guestButton = el('button', { class: 'primary' }, 'Play as guest')
    guestButton.addEventListener('click', async () => {
      guestButton.disabled = true
      setMessage('Signing in…')
      try {
        await auth.playAsGuest()
        resolve()
      } catch (error) {
        setMessage(errorText(error), 'error')
        guestButton.disabled = false
      }
    })

    const email = el('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'email', required: '' })
    const form = el('form', { class: 'row' }, email, el('button', { type: 'submit' }, 'Send magic link'))
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      setMessage('Sending…')
      try {
        await auth.sendMagicLink(email.value.trim())
        setMessage('Check your inbox and open the link in this browser.', 'ok')
      } catch (error) {
        setMessage(errorText(error), 'error')
      }
    })

    root.replaceChildren(
      el(
        'div',
        { class: 'screen' },
        ...menuHeader(),
        howItWorks(),
        panel(
          'sign in',
          el('div', { class: 'row' }, guestButton, el('span', { class: 'hint' }, 'no account needed')),
          el('p', { class: 'hint' }, 'or keep your name, look and stats with an email link:'),
          form,
          message,
        ),
      ),
    )
  })
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

import { LOGO } from './logo'

type Child = Node | string | null | undefined | false

/** Class of the empty box where small screens show the attract scene (see SceneRenderer.renderAttract). */
export const ATTRACT_STAGE_CLASS = 'attract-stage'

/** Tiny DOM builder. Text is always inserted as text nodes, so user-provided strings cannot inject HTML. */
type Props = Record<string, string | ((event: Event) => void)>

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'function') {
      element.addEventListener(key.replace(/^on/, ''), value)
    } else {
      element.setAttribute(key, value)
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    element.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return element
}

/** A panel with an ASCII title bar: ┌─ title ─────┐ */
export function panel(title: string, ...children: Child[]): HTMLElement {
  return el('section', { class: 'panel' }, el('h2', { class: 'panel-title' }, `┌─ ${title} `), ...children)
}

/**
 * Logo and tagline, then the stage: on small screens the menu covers the whole page, so the attract scene is
 * drawn inside this box instead of beside the panels. It stays empty (and hidden) on wide screens.
 */
export function menuHeader(): HTMLElement[] {
  return [
    el('pre', { class: 'logo' }, LOGO),
    el('p', { class: 'tagline' }, 'A multiplayer horror game drawn in ASCII. 1 monster · 4 survivors · 1 way out.'),
    el('div', { class: ATTRACT_STAGE_CLASS, 'aria-hidden': 'true' }),
  ]
}

/** The three-line explanation shown on every menu screen, next to the live attract scene. */
export function howItWorks(): HTMLElement {
  const line = (glyph: string, kind: string, text: string) => [
    el('dt', { class: kind }, glyph),
    el('dd', {}, text),
  ]
  return panel(
    'how it works',
    el(
      'dl',
      { class: 'how' },
      ...line('@', 'survivor', '4 survivors repair 5 of the 7 generators, then escape through the gate.'),
      ...line('M', 'monster', 'The monster hunts them in the dark: two hits down a survivor, then it carries them off.'),
      ...line('!', 'warn', 'Light and noise give you away — flashlights, sprinting and repairs can be seen or heard.'),
    ),
  )
}

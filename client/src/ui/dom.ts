type Child = Node | string | null | undefined | false

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

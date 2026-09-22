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

import { describe, expect, it } from 'vitest'
import { viewportOrigin } from './camera'

describe('viewportOrigin', () => {
  it('centres a map smaller than the view', () => {
    expect(viewportOrigin(3, 10, 20)).toBe(-5)
  })

  it('follows the focus in the middle of a large map', () => {
    expect(viewportOrigin(50, 100, 20)).toBe(40)
  })

  it('clamps at the start and end of the map', () => {
    expect(viewportOrigin(2, 100, 20)).toBe(0)
    expect(viewportOrigin(98, 100, 20)).toBe(80)
  })
})

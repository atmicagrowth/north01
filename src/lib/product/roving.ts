/**
 * **Roving-focus arithmetic for the page's three radio groups.**
 *
 * A `role="radiogroup"` is a promise about the keyboard, not a label. ARIA 1.2 gives the group **one**
 * tab stop and requires the arrow keys to move between its options — so a component that renders
 * `role="radio"` with a roving `tabIndex` and no arrow handler has built a control that a keyboard
 * user can *see* and cannot *reach*: every option but one carries `tabIndex={-1}`, and nothing moves
 * focus to them. On the size row it is worse than that, because before a size is chosen **no** option
 * is selected, so every option is `-1` and the whole control is skipped by Tab.
 *
 * Pure, because index arithmetic that wraps is exactly the kind of thing that is off by one in the
 * direction nobody clicks. `pnpm verify:product` walks all of it.
 *
 * Shared by the colour row, the size row and the gallery thumbnails, which are the same pattern at
 * three sizes.
 */

export type RovingKey = 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'End' | 'Home'

const ROVING_KEYS: readonly string[] = [
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
]

export function isRovingKey(key: string): key is RovingKey {
  return ROVING_KEYS.includes(key)
}

/**
 * Where focus goes next.
 *
 * **Both axes move**, because these rows wrap: `flex-wrap` turns one row of sizes into two on a
 * narrow screen, and a customer whose sizes have wrapped will reach for Down before Right. ARIA 1.2
 * permits either pair for a radio group and says nothing about honouring only one; honouring only
 * one would mean the control works at 1440px and not at 390px.
 *
 * Wrapping is deliberate — from the last option, Right returns to the first. A radio group is a
 * closed set, and dead-ending on the last size gives no signal that the row has ended.
 *
 * `current` of `-1` means focus is not on any option yet; a forward key then lands on the first and
 * a backward key on the last.
 */
export function rovingIndex(current: number, count: number, key: RovingKey): number {
  if (count <= 0) {
    return -1
  }

  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return current < 0 || current >= count - 1 ? 0 : current + 1
    case 'ArrowLeft':
    case 'ArrowUp':
      return current <= 0 ? count - 1 : current - 1
    case 'Home':
      return 0
    case 'End':
      return count - 1
  }
}

/**
 * Which option carries the group's single tab stop.
 *
 * The selected one — and when nothing is selected, the first, so the group is reachable at all.
 * That case is not hypothetical: the size row renders with no selection every time a product page is
 * opened without `?size=`, which is every time anybody arrives from the shop.
 */
export function tabbableIndex(selectedIndex: number): number {
  return selectedIndex >= 0 ? selectedIndex : 0
}

/**
 * **Turning a `SizeGuides` document into a table.**
 *
 * This was inside `size-guide-dialog.tsx`, and its docblock made a specific promise — *"the cells are
 * looked up by label rather than by position, so a row that lists its measurements in a different
 * order still lands in the right columns"* — that nothing could check, because the rule lived in a
 * component. Phase 13's second sweep moved it here, which is where every other rule in this project
 * lives: a pure module a harness can import.
 *
 * The promise is worth keeping, and it is not hypothetical. `SizeGuides` stores measurements **per
 * row**, as an array of `{ label, value }`, with nothing forcing two rows to agree on order or on
 * which measurements they carry. An editor filling in five rows by hand will eventually type Length
 * before Chest, and a positional read would then print one row's lengths under the other rows'
 * chests — numbers that look right and are wrong, on the page a customer uses to decide what fits.
 */

/** The minimum shape a caller must supply. Structural, so fixtures cost nothing. */
export type SizeGuideRow = {
  id?: null | string
  measurements?: null | { label?: null | string; value?: null | string }[]
  size?: null | string
}

export type SizeGuideTable = {
  /** Measurement labels, in the order the header renders them. */
  columns: string[]
  rows: {
    /** One entry per column, aligned by label. `null` where the row has no such measurement. */
    cells: (null | string)[]
    key: string
    size: string
  }[]
}

const text = (value: null | string | undefined): null | string => value?.trim() || null

/**
 * **The header comes from the first usable row; every cell is then found by label.**
 *
 * Two decisions, and both are about what happens when the data is ragged:
 *
 * - **A row with no size is dropped.** It cannot be labelled, so it would render a blank row header
 *   with numbers beside it — a line of measurements belonging to nothing.
 * - **A missing measurement is an empty cell, never a shift.** Looking cells up by label means a row
 *   that omits Length renders a gap under Length, rather than sliding Chest into Length's column and
 *   leaving the last one blank. The second failure is invisible; the first is obvious.
 *
 * Duplicate labels within a row collapse to the first, because two columns with the same heading are
 * not a table a reader can use.
 */
export function sizeGuideTable(rows: SizeGuideRow[]): SizeGuideTable {
  const usable = rows.filter((row) => text(row.size))

  const columns = [
    ...new Set(
      (usable[0]?.measurements ?? [])
        .map((measurement) => text(measurement.label))
        .filter((label): label is string => label !== null),
    ),
  ]

  return {
    columns,
    rows: usable.map((row, index) => {
      const size = text(row.size) as string

      return {
        cells: columns.map(
          (column) =>
            text(
              (row.measurements ?? []).find((measurement) => text(measurement.label) === column)
                ?.value,
            ) ?? null,
        ),
        key: text(row.id) ?? `${size}-${index}`,
        size,
      }
    }),
  }
}

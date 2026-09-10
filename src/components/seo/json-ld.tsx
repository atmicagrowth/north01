/**
 * **A JSON-LD block, escaped.**
 *
 * `<script type="application/ld+json">` is raw-text content: the browser does not parse entities
 * inside it, and it ends at the first literal `</script`. That makes `dangerouslySetInnerHTML` the
 * only way to render it — and makes escaping non-optional, because every value in this payload comes
 * from the database. A product named `</script><script>…` would otherwise close the block and open a
 * real one.
 *
 * `JSON.stringify` does not escape `<`, so it is done here: `\u003c` is the same character to a JSON
 * parser and is not `<` to an HTML tokeniser, which is exactly the property needed. `&` and `>` go
 * with it because the same trick works through `<!--`, an old but real parser quirk.
 *
 * `U+2028` and `U+2029` are escaped as well. They are valid in JSON strings and were line
 * terminators in JavaScript before ES2019 — cheap insurance, and the reason every serious serialiser
 * does it.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data)
    .replace(/</g, '\u003c')
    .replace(/>/g, '\u003e')
    .replace(/&/g, '\u0026')
    .replace(/\u2028/g, '\u2028')
    .replace(/\u2029/g, '\u2029')

  return (
    <script
      /* A raw-text element; the payload is escaped immediately above. */
      dangerouslySetInnerHTML={{ __html: json }}
      type="application/ld+json"
    />
  )
}

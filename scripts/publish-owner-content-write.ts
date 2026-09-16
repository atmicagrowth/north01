/**
 * **Write the owner's support and legal copy into the live shop** — `pnpm content:publish:write`.
 *
 * A separate file from the dry run, not a flag on it: `payload run` forwards no arguments, so a flag
 * would be ignored and the safe command would have been the dangerous one (`scripts/reindex.ts`
 * records the measurement). Read `scripts/content/publish-owner-content.ts` before running this.
 */

import { publishOwnerContent } from './content/publish-owner-content'

await publishOwnerContent({ write: true })

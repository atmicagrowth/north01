/**
 * **What `pnpm content:publish` would change in the live shop, without changing it.**
 *
 * See `scripts/content/publish-owner-content.ts` for what it covers and why it exists. This entry
 * point writes nothing; `scripts/publish-owner-content-write.ts` is the one that does.
 */

import { publishOwnerContent } from './content/publish-owner-content'

await publishOwnerContent({ write: false })

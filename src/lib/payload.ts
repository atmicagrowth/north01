import 'server-only'

import config from '@payload-config'
import { getPayload } from 'payload'
import type { Payload } from 'payload'

/**
 * The Local API handle, for server code that talks to Payload without going through HTTP.
 *
 * `getPayload` memoises on `globalThis`, so this is a lookup after the first call rather than a
 * second Payload instance and a second connection pool — which is the whole reason a helper exists
 * instead of every caller doing `getPayload({ config })` and hoping.
 *
 * **The Local API defaults to `overrideAccess: true`.** Everything it does runs past the rules in
 * `payload/access/`, so a caller that means "as this customer" has to say so explicitly:
 * `{ overrideAccess: false, user }`. That is the default posture in `lib/auth/`, and where it is not,
 * the call site says why.
 */
export const getPayloadClient = (): Promise<Payload> => getPayload({ config })

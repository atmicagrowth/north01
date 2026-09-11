import type { Access, Payload } from 'payload'

import { isStaff } from './index'

/**
 * **Payload's own collections are staff-only** — plan §34.1d, audit R1-18.
 *
 * `payload-locked-documents` (which staff member is editing what) and `payload-preferences` (each
 * admin user's panel settings) are created by Payload itself during config sanitisation, after every
 * plugin has run, with an access rule of `Boolean(user)`. This project has **two** auth collections,
 * so a signed-in *customer* satisfies that rule: over REST a shopper could list the locks — learning
 * who on the team was editing which order — plant a lock on a staff document, delete a colleague's
 * lock, and write preferences. Plan §7.1b: *"Customers may NOT … access Payload Admin."*
 *
 * Nothing in the config can reach them before they exist, so the access is narrowed once Payload is
 * initialised (`onInit`). Access functions are read from `collection.config.access` on every request,
 * so the change holds for every request after it. Preferences keep their own per-user scoping; staff
 * is required on top of it, never instead of it.
 */
export function restrictInternalCollections(payload: Payload): void {
  const locks = payload.collections['payload-locked-documents']?.config

  if (locks) {
    locks.access = {
      ...locks.access,
      create: isStaff,
      delete: isStaff,
      read: isStaff,
      update: isStaff,
    }
  }

  const preferences = payload.collections['payload-preferences']?.config

  if (preferences) {
    const staffAnd =
      (original: Access | undefined): Access =>
      async (args) =>
        (await isStaff(args)) === true ? (original ? original(args) : true) : false

    preferences.access = {
      ...preferences.access,
      create: staffAnd(preferences.access.create),
      delete: staffAnd(preferences.access.delete),
      read: staffAnd(preferences.access.read),
      update: staffAnd(preferences.access.update),
    }
  }
}

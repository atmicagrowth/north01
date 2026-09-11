import { describe, expect, it, vi } from 'vitest'

/*
 * `courier.ts` reads the environment tier at import. The function under test is pure, so the two
 * modules that would need real configuration are stubbed rather than configured.
 */
vi.mock('@/lib/env.server', () => ({
  appEnv: 'development',
  integrationStatus: () => 'missing',
  requireIntegration: () => ({}),
  serverEnv: {},
}))
vi.mock('@/lib/email/resend', () => ({ buildCourier: () => null }))

const { usableReplyTo } = await import('@/lib/email/courier')

/**
 * **Phase 36, audit DOC-02** — the seed stored `help@north01.example` as the contact address and
 * every order email offered it as the reply-to. A reserved domain cannot receive mail, so it is
 * dropped: no reply-to is better than one that bounces.
 */
describe('usableReplyTo', () => {
  it('drops the address the seed used to store', () => {
    expect(usableReplyTo('help@north01.example')).toBeNull()
  })

  it.each([
    'a@shop.test',
    'a@x.invalid',
    'a@host.localhost',
    'a@example.com',
    'a@mail.example.org',
    'A@NORTH01.EXAMPLE',
    /* The bare reserved names themselves (RFC 6761) — sweep 1 found the pattern needed a leading dot. */
    'help@localhost',
    'help@example',
  ])('drops the reserved domain in %s', (address) => {
    expect(usableReplyTo(address)).toBeNull()
  })

  it('keeps a real address, trimmed', () => {
    expect(usableReplyTo('  help@north01.com ')).toBe('help@north01.com')
  })

  it('does not mistake a lookalike for a reserved name', () => {
    expect(usableReplyTo('help@myexample.com')).toBe('help@myexample.com')
  })

  it.each([null, undefined, '', 'not-an-address', 'a@'])('returns null for %p', (value) => {
    expect(usableReplyTo(value)).toBeNull()
  })
})

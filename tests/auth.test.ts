import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Prisma } from '@prisma/client'
import { authenticateUser, registerUser, verifyPassword } from '../lib/auth'
import { db } from '../lib/db'
import { createAccount, getDashboard } from '../lib/finance'

test('registration stores salted hashes, enforces unique nicknames, and isolates financial data', async () => {
  const suffix = crypto.randomUUID().slice(0, 16)
  const firstNickname = `member-${suffix}`
  const secondNickname = `other-${suffix}`
  const password = 'a-private-password-123'
  const userIds: string[] = []

  try {
    const firstId = await registerUser(firstNickname, password)
    const secondId = await registerUser(secondNickname, password)
    userIds.push(firstId, secondId)

    const [first, second] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: firstId } }),
      db.user.findUniqueOrThrow({ where: { id: secondId } }),
    ])
    assert.notEqual(first.passwordHash, password)
    assert.notEqual(first.passwordHash, second.passwordHash)
    assert.equal(await verifyPassword(password, first.passwordHash), true)
    assert.equal(await verifyPassword('wrong-password', first.passwordHash), false)
    assert.equal(await authenticateUser(firstNickname.toUpperCase(), password), firstId)
    assert.equal(await authenticateUser(firstNickname, 'wrong-password'), null)
    assert.equal(await authenticateUser('missing-member', password), null)

    await assert.rejects(
      registerUser(`  ${firstNickname.toUpperCase()}  `, password),
      error => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
    )

    await createAccount(firstId, { name: '仅用户一可见', type: 'available', initialBalanceCents: 75_00n })
    const [firstDashboard, secondDashboard] = await Promise.all([
      getDashboard(firstId),
      getDashboard(secondId),
    ])
    assert.equal(firstDashboard.overview.availableCents, 75_00)
    assert.equal(secondDashboard.overview.availableCents, 0)
    assert.equal(secondDashboard.accounts.length, 0)
  } finally {
    await db.user.deleteMany({ where: { id: { in: userIds } } })
  }
})

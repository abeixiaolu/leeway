import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { db } from '../lib/db'
import {
  createAccount,
  createFixedExpense,
  createRecord,
  deleteRecord,
  getDashboard,
  materializeRecurringCharges,
  setDefaultExpenseAccount,
  updateBudget,
  updateFixedExpense,
  updateRecord,
} from '../lib/finance'

let userId: string

beforeEach(async () => {
  const nickname = `test-${crypto.randomUUID()}`
  const user = await db.user.create({
    data: {
      nickname,
      nicknameKey: nickname.toLowerCase(),
      passwordHash: 'test-only',
    },
  })
  userId = user.id
})

afterEach(async () => {
  await db.user.delete({ where: { id: userId } })
})

test('daily spending uses the default account and resets the allowance each month', async () => {
  const cash = await createAccount(userId, { name: '现金', type: 'available', initialBalanceCents: 100_00n })
  const card = await createAccount(userId, { name: '银行卡', type: 'available', initialBalanceCents: 200_00n })
  await setDefaultExpenseAccount(userId, card)
  await updateBudget(userId, { defaultAllowanceCents: 50_00n, month: '2026-08', monthAllowanceCents: 20_00n })

  const record = await createRecord(userId, { type: 'expense', amountCents: 60_00n, note: '午餐', date: '2026-08-31' })
  const august = await getDashboard(userId, new Date('2026-08-31T12:00:00+08:00'))
  assert.equal(august.accounts.find(account => account.id === cash)?.balanceCents, 100_00)
  assert.equal(august.accounts.find(account => account.id === card)?.balanceCents, 140_00)
  assert.equal(august.overview.allowanceRemainingCents, -40_00)

  const september = await getDashboard(userId, new Date('2026-09-01T12:00:00+08:00'))
  assert.equal(september.overview.allowanceRemainingCents, 50_00)
  await updateRecord(userId, record, { type: 'expense', amountCents: 10_00n, note: '更正', date: '2026-09-01' })
  const corrected = await getDashboard(userId, new Date('2026-09-01T12:00:00+08:00'))
  assert.equal(corrected.overview.allowanceRemainingCents, 40_00)
  assert.equal(corrected.accounts.find(account => account.id === card)?.balanceCents, 190_00)
  await deleteRecord(userId, record)
  assert.equal((await getDashboard(userId, new Date('2026-09-01T12:00:00+08:00'))).accounts.find(account => account.id === card)?.balanceCents, 200_00)
})

test('income, investment value changes, and transfers affect distinct totals', async () => {
  const cash = await createAccount(userId, { name: '现金', type: 'available', initialBalanceCents: 100_00n })
  const fund = await createAccount(userId, { name: '基金', type: 'investment', initialBalanceCents: 200_00n })
  await createRecord(userId, { type: 'income', incomeType: 'salary', accountId: cash, amountCents: 50_00n, date: '2026-09-02' })
  await createRecord(userId, { type: 'income', incomeType: 'investment', accountId: fund, amountCents: 20_00n, date: '2026-09-02' })
  await createRecord(userId, { type: 'value_change', accountId: fund, amountCents: -30_00n, date: '2026-09-02' })
  await createRecord(userId, { type: 'transfer', accountId: cash, toAccountId: fund, amountCents: 40_00n, date: '2026-09-02' })

  const dashboard = await getDashboard(userId, new Date('2026-09-03T12:00:00+08:00'))
  assert.equal(dashboard.overview.availableCents, 110_00)
  assert.equal(dashboard.overview.investmentCents, 230_00)
  assert.equal(dashboard.overview.monthlyIncomeCents, 70_00)
  assert.equal(dashboard.overview.dailySpentCents, 0)
  assert.equal(dashboard.overview.netWorthCents, 340_00)
})

test('a short-month fixed charge is posted once and may make cash negative', async () => {
  const cash = await createAccount(userId, { name: '现金', type: 'available', initialBalanceCents: 10_00n })
  const expenseId = await createFixedExpense(userId, { name: '房租', amountCents: 50_00n, day: 31 })
  await db.fixedExpense.update({ where: { id: expenseId }, data: { createdAt: new Date('2026-02-01T00:00:00+08:00'), updatedAt: new Date('2026-02-01T00:00:00+08:00') } })
  const now = new Date('2026-02-28T12:00:00+08:00')

  await materializeRecurringCharges(userId, now)
  await materializeRecurringCharges(userId, now)
  const dashboard = await getDashboard(userId, now)
  assert.equal(dashboard.accounts.find(account => account.id === cash)?.balanceCents, -40_00)
  assert.equal(dashboard.overview.fixedSpentCents, 50_00)
  assert.equal(dashboard.overview.dailySpentCents, 0)
  assert.equal(dashboard.overview.runwayMonths, 0)
  const charges = await db.transaction.findMany({ where: { userId, fixedExpenseId: expenseId } })
  assert.equal(charges.length, 1)
  assert.equal(charges[0].fixedMonth, '2026-02')
})

test('debt principal reduces only debt and cannot exceed the outstanding balance', async () => {
  await createAccount(userId, { name: '现金', type: 'available', initialBalanceCents: 100_00n })
  const debt = await createAccount(userId, { name: '借款', type: 'debt', initialBalanceCents: 80_00n })
  const expenseId = await createFixedExpense(userId, { name: '月供', amountCents: 20_00n, day: 1, isDebtRepayment: true })
  await db.fixedExpense.update({ where: { id: expenseId }, data: { createdAt: new Date('2026-09-01T00:00:00+08:00'), updatedAt: new Date('2026-09-01T00:00:00+08:00') } })
  const now = new Date('2026-09-03T12:00:00+08:00')
  await materializeRecurringCharges(userId, now)
  const repayment = await db.transaction.findFirstOrThrow({ where: { userId, fixedExpenseId: expenseId } })
  await createRecord(userId, { type: 'principal', accountId: debt, repaymentTransactionId: repayment.id, amountCents: 15_00n, date: '2026-09-01' })

  const dashboard = await getDashboard(userId, now)
  assert.equal(dashboard.overview.availableCents, 80_00)
  assert.equal(dashboard.overview.debtCents, 65_00)
  assert.equal(dashboard.overview.fixedSpentCents, 20_00)
  await assert.rejects(createRecord(userId, { type: 'principal', accountId: debt, repaymentTransactionId: repayment.id, amountCents: 66_00n, date: '2026-09-01' }))
})

test('a retried manual submission creates one record', async () => {
  await createAccount(userId, { name: '现金', type: 'available', initialBalanceCents: 100_00n })
  const input = { type: 'expense' as const, amountCents: 12_34n, note: '午餐', date: '2026-09-04', requestId: crypto.randomUUID() }
  const first = await createRecord(userId, input)
  const retry = await createRecord(userId, input)

  assert.equal(retry, first)
  assert.equal(await db.transaction.count({ where: { userId, type: 'DAILY_EXPENSE' } }), 1)
  assert.equal((await getDashboard(userId, new Date('2026-09-04T12:00:00+08:00'))).overview.availableCents, 87_66)
})

test('editing an older expense keeps its original account after changing the default', async () => {
  const original = await createAccount(userId, { name: '旧卡', type: 'available', initialBalanceCents: 100_00n })
  const next = await createAccount(userId, { name: '新卡', type: 'available', initialBalanceCents: 100_00n })
  const record = await createRecord(userId, { type: 'expense', amountCents: 10_00n, note: '午餐', date: '2026-09-04' })
  await setDefaultExpenseAccount(userId, next)
  await updateRecord(userId, record, { type: 'expense', amountCents: 20_00n, note: '更正', date: '2026-09-04' })

  const dashboard = await getDashboard(userId, new Date('2026-09-04T12:00:00+08:00'))
  assert.equal(dashboard.accounts.find(account => account.id === original)?.balanceCents, 80_00)
  assert.equal(dashboard.accounts.find(account => account.id === next)?.balanceCents, 100_00)
})

test('a user cannot edit another user’s record or use their account', async () => {
  const second = await db.user.create({ data: { nickname: `test-${crypto.randomUUID()}`, nicknameKey: `key-${crypto.randomUUID()}`, passwordHash: 'test-only' } })
  try {
    const account = await createAccount(userId, { name: '现金', type: 'available', initialBalanceCents: 100_00n })
    const record = await createRecord(userId, { type: 'income', incomeType: 'salary', accountId: account, amountCents: 10_00n, date: '2026-09-04' })
    await assert.rejects(updateRecord(second.id, record, { type: 'income', incomeType: 'salary', accountId: account, amountCents: 20_00n, date: '2026-09-04' }))
    await assert.rejects(createRecord(second.id, { type: 'income', incomeType: 'salary', accountId: account, amountCents: 20_00n, date: '2026-09-04' }))
    assert.equal((await getDashboard(userId, new Date('2026-09-04T12:00:00+08:00'))).overview.availableCents, 110_00)
    assert.equal((await getDashboard(second.id, new Date('2026-09-04T12:00:00+08:00'))).overview.availableCents, 0)
  } finally {
    await db.user.delete({ where: { id: second.id } })
  }
})

test('runway uses available funds and planned spending without offsetting income', async () => {
  const account = await createAccount(userId, { name: '现金', type: 'available', initialBalanceCents: 600_00n })
  const investment = await createAccount(userId, { name: '基金', type: 'investment', initialBalanceCents: 600_00n })
  await updateBudget(userId, { defaultAllowanceCents: 100_00n, runwayTargetMonths: 8 })
  await createRecord(userId, { type: 'income', incomeType: 'salary', accountId: account, amountCents: 100_00n, date: '2026-09-04' })
  await createRecord(userId, { type: 'value_change', accountId: investment, amountCents: 100_00n, date: '2026-09-04' })

  const dashboard = await getDashboard(userId, new Date('2026-09-04T12:00:00+08:00'))
  assert.equal(dashboard.overview.plannedSpendingCents, 100_00)
  assert.equal(dashboard.overview.runwayMonths, 7)
  assert.equal(dashboard.overview.runwayTargetMonths, 8)
  assert.equal(dashboard.overview.investmentCents, 700_00)
})

test('editing a fixed expense keeps the old charge and applies the new amount next month', async () => {
  await createAccount(userId, { name: '现金', type: 'available', initialBalanceCents: 100_00n })
  const expenseId = await createFixedExpense(userId, { name: '房租', amountCents: 10_00n, day: 1 })
  await db.fixedExpense.update({ where: { id: expenseId }, data: { createdAt: new Date('2026-09-01T00:00:00+08:00'), updatedAt: new Date('2026-09-01T00:00:00+08:00') } })

  await updateFixedExpense(userId, expenseId, { name: '新房租', amountCents: 20_00n, day: 15, active: true })
  const september = await getDashboard(userId, new Date('2026-09-29T12:00:00+08:00'))
  assert.equal(september.overview.fixedSpentCents, 10_00)
  const october = await getDashboard(userId, new Date('2026-10-15T12:00:00+08:00'))
  assert.equal(october.overview.fixedSpentCents, 20_00)
  assert.equal(october.overview.availableCents, 70_00)
  const charges = await db.transaction.findMany({ where: { userId, fixedExpenseId: expenseId }, orderBy: { fixedMonth: 'asc' } })
  assert.deepEqual(charges.map(charge => [charge.fixedMonth, charge.amountCents, charge.note]), [
    ['2026-09', 10_00n, '房租'],
    ['2026-10', 20_00n, '新房租'],
  ])
})

test('principal requires a snapshotted debt repayment, not rent', async () => {
  await createAccount(userId, { name: '现金', type: 'available', initialBalanceCents: 100_00n })
  const debt = await createAccount(userId, { name: '借款', type: 'debt', initialBalanceCents: 80_00n })
  const rentId = await createFixedExpense(userId, { name: '房租', amountCents: 30_00n, day: 1 })
  const loanId = await createFixedExpense(userId, { name: '月供', amountCents: 20_00n, day: 1, isDebtRepayment: true })
  const start = new Date('2026-09-01T00:00:00+08:00')
  await db.fixedExpense.updateMany({ where: { id: { in: [rentId, loanId] } }, data: { createdAt: start, updatedAt: start } })
  await materializeRecurringCharges(userId, new Date('2026-09-03T12:00:00+08:00'))
  const rent = await db.transaction.findFirstOrThrow({ where: { userId, fixedExpenseId: rentId } })
  const loan = await db.transaction.findFirstOrThrow({ where: { userId, fixedExpenseId: loanId } })
  assert.equal(rent.isDebtRepayment, false)
  assert.equal(loan.isDebtRepayment, true)
  await updateFixedExpense(userId, loanId, { name: '月供', amountCents: 20_00n, day: 1, active: true, isDebtRepayment: false })
  assert.equal((await db.transaction.findUniqueOrThrow({ where: { id: loan.id } })).isDebtRepayment, true)
  await assert.rejects(createRecord(userId, {
    type: 'principal', accountId: debt, repaymentTransactionId: rent.id,
    amountCents: 10_00n, date: '2026-09-01',
  }))
  await createRecord(userId, {
    type: 'principal', accountId: debt, repaymentTransactionId: loan.id,
    amountCents: 10_00n, date: '2026-09-01',
  })
  assert.equal((await getDashboard(userId, new Date('2026-09-03T12:00:00+08:00'))).overview.debtCents, 70_00)
})

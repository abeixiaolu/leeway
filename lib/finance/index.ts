import type { TransactionType } from '@prisma/client'
import { db } from '@/lib/db'

export type AccountKind = 'available' | 'investment' | 'debt'
export type RecordKind = 'expense' | 'income' | 'transfer' | 'value_change' | 'principal'
export type RecordInput = {
  type: RecordKind
  amountCents: bigint
  note?: string
  date: string
  accountId?: string
  toAccountId?: string
  incomeType?: 'salary' | 'investment'
  repaymentTransactionId?: string
  requestId?: string
}

const accountTypes = { available: 'AVAILABLE', investment: 'INVESTMENT', debt: 'DEBT' } as const
const recordTypes = {
  expense: 'DAILY_EXPENSE', income: 'SALARY_INCOME', transfer: 'TRANSFER',
  value_change: 'INVESTMENT_CHANGE', principal: 'DEBT_PRINCIPAL',
} as const
const maxSafe = BigInt(Number.MAX_SAFE_INTEGER)

function cents(value: bigint) {
  if (value > maxSafe || value < -maxSafe) throw new Error('金额超出可显示范围')
  return Number(value)
}

function chinaParts(now: Date) {
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() }
}

export function chinaDate(now = new Date()) {
  const { year, month, day } = chinaParts(now)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function dateAtChinaMidnight(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期格式无效')
  const [year, month, day] = value.split('-').map(Number)
  const result = new Date(Date.UTC(year, month - 1, day, -8))
  if (chinaDate(result) !== value) throw new Error('日期无效')
  return result
}

function monthOf(date: Date) { return chinaDate(date).slice(0, 7) }
function monthString(year: number, month: number) { return `${year}-${String(month).padStart(2, '0')}` }
function dueDate(year: number, month: number, day: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return dateAtChinaMidnight(`${monthString(year, month)}-${String(Math.min(day, last)).padStart(2, '0')}`)
}
function cleanName(name: string) {
  const value = name.trim()
  if (!value || value.length > 80) throw new Error('名称需为 1–80 个字符')
  return value
}
function requirePositive(value: bigint) {
  if (value <= 0n || value > maxSafe) throw new Error('金额必须大于零')
}
function requireNonnegative(value: bigint) {
  if (value < 0n || value > maxSafe) throw new Error('金额不能为负')
}

function applyBalance(balances: Map<string, bigint>, tx: { type: string; accountId: string | null; toAccountId: string | null; amountCents: bigint }) {
  const add = (id: string | null, delta: bigint) => { if (id) balances.set(id, (balances.get(id) ?? 0n) + delta) }
  if (tx.type === 'DAILY_EXPENSE' || tx.type === 'FIXED_EXPENSE' || tx.type === 'DEBT_PRINCIPAL') add(tx.accountId, -tx.amountCents)
  else if (tx.type === 'TRANSFER') { add(tx.accountId, -tx.amountCents); add(tx.toAccountId, tx.amountCents) }
  else add(tx.accountId, tx.amountCents)
}

async function accountBalances(userId: string, client: typeof db = db, excludeRecordId?: string) {
  const [accounts, records] = await Promise.all([
    client.account.findMany({ where: { userId } }),
    client.transaction.findMany({ where: { userId, ...(excludeRecordId ? { id: { not: excludeRecordId } } : {}) } }),
  ])
  const balances = new Map(accounts.map(account => [account.id, account.initialBalanceCents]))
  for (const record of records) applyBalance(balances, record)
  return { accounts, records, balances }
}

export async function createAccount(userId: string, input: { name: string; type: AccountKind; initialBalanceCents: bigint }) {
  if (!(input.type in accountTypes)) throw new Error('账户类型无效')
  requireNonnegative(input.initialBalanceCents)
  return db.$transaction(async tx => {
    const account = await tx.account.create({ data: { userId, name: cleanName(input.name), type: accountTypes[input.type], initialBalanceCents: input.initialBalanceCents } })
    if (input.type === 'available') {
      await tx.user.updateMany({ where: { id: userId, defaultExpenseAccountId: null }, data: { defaultExpenseAccountId: account.id } })
    }
    return account.id
  })
}

export async function updateAccount(userId: string, id: string, input: { name: string }) {
  const result = await db.account.updateMany({ where: { id, userId }, data: { name: cleanName(input.name) } })
  if (!result.count) throw new Error('账户不存在')
}

export async function deleteAccount(userId: string, id: string) {
  await db.$transaction(async tx => {
    const account = await tx.account.findFirst({ where: { id, userId } })
    if (!account) throw new Error('账户不存在')
    const used = await tx.transaction.count({ where: { userId, OR: [{ accountId: id }, { toAccountId: id }] } })
    if (used) throw new Error('此账户已有记录，不能删除')
    if ((await tx.user.findUniqueOrThrow({ where: { id: userId } })).defaultExpenseAccountId === id) {
      const replacement = await tx.account.findFirst({ where: { userId, type: 'AVAILABLE', id: { not: id } }, orderBy: { createdAt: 'asc' } })
      if (!replacement && await tx.fixedExpense.count({ where: { userId, active: true } })) throw new Error('请先停用固定支出或保留一个可用资金账户')
      await tx.user.update({ where: { id: userId }, data: { defaultExpenseAccountId: replacement?.id ?? null } })
    }
    await tx.account.delete({ where: { id } })
  })
}

export async function setDefaultExpenseAccount(userId: string, accountId: string) {
  await materializeRecurringCharges(userId)
  const account = await db.account.findFirst({ where: { id: accountId, userId, type: 'AVAILABLE' } })
  if (!account) throw new Error('请选择可用资金账户')
  await db.user.update({ where: { id: userId }, data: { defaultExpenseAccountId: accountId } })
}

async function validatedRecord(userId: string, input: RecordInput, client: typeof db, excludeRecordId?: string, originalExpenseAccountId?: string) {
  if (!(input.type in recordTypes)) throw new Error('记录类型无效')
  if (input.type === 'value_change') {
    if (!input.amountCents || input.amountCents > maxSafe || input.amountCents < -maxSafe) throw new Error('请输入非零价值变动')
  } else requirePositive(input.amountCents)
  const occurredAt = dateAtChinaMidnight(input.date)
  if (occurredAt > new Date()) throw new Error('不能记录未来日期')
  const user = await client.user.findUniqueOrThrow({ where: { id: userId } })
  const accountId = input.type === 'expense' ? (originalExpenseAccountId ?? user.defaultExpenseAccountId) : input.accountId
  if (!accountId) throw new Error('请先设置默认消费账户')
  const account = await client.account.findFirst({ where: { id: accountId, userId } })
  if (!account) throw new Error('账户不存在')
  const asset = account.type === 'AVAILABLE' || account.type === 'INVESTMENT'
  if (input.type === 'expense' && account.type !== 'AVAILABLE') throw new Error('消费账户必须是可用资金账户')
  if (input.type === 'income' && !asset) throw new Error('收入只能进入资产账户')
  if (input.type === 'income' && input.incomeType !== 'salary' && input.incomeType !== 'investment') throw new Error('收入类型无效')
  if (input.type === 'value_change' && account.type !== 'INVESTMENT') throw new Error('请选择投资账户')
  if (input.type === 'transfer' && !asset) throw new Error('转账只能使用资产账户')
  if (input.type === 'principal' && account.type !== 'DEBT') throw new Error('请选择借贷账户')
  let toAccountId: string | null = null
  if (input.type === 'transfer') {
    if (!input.toAccountId || input.toAccountId === accountId) throw new Error('请选择不同的转入账户')
    const to = await client.account.findFirst({ where: { id: input.toAccountId, userId, type: { in: ['AVAILABLE', 'INVESTMENT'] } } })
    if (!to) throw new Error('转入账户无效')
    toAccountId = to.id
  }
  let repaymentTransactionId: string | null = null
  if (input.type === 'principal') {
    if (!input.repaymentTransactionId) throw new Error('请选择对应的固定还款')
    const repayment = await client.transaction.findFirst({ where: { id: input.repaymentTransactionId, userId, type: 'FIXED_EXPENSE' } })
    if (!repayment || monthOf(repayment.occurredAt) !== input.date.slice(0, 7)) throw new Error('本金记录必须对应同月固定还款')
    repaymentTransactionId = repayment.id
    const existingPrincipal = await client.transaction.aggregate({ where: { userId, type: 'DEBT_PRINCIPAL', repaymentTransactionId, ...(excludeRecordId ? { id: { not: excludeRecordId } } : {}) }, _sum: { amountCents: true } })
    if ((existingPrincipal._sum.amountCents ?? 0n) + input.amountCents > repayment.amountCents) throw new Error('偿还本金不能超过该笔还款')
    const { balances } = await accountBalances(userId, client, excludeRecordId)
    if ((balances.get(accountId) ?? 0n) < input.amountCents) throw new Error('偿还本金不能超过未偿余额')
  }
  return {
    userId, type: (input.type === 'income' ? (input.incomeType === 'investment' ? 'INVESTMENT_INCOME' : 'SALARY_INCOME') : recordTypes[input.type]) as TransactionType,
    amountCents: input.amountCents, occurredAt, note: input.note?.trim() || null,
    accountId, toAccountId, repaymentTransactionId,
  }
}

export async function createRecord(userId: string, input: RecordInput) {
  const requestId = input.requestId?.trim() || null
  if (requestId && requestId.length > 80) throw new Error('请求标识无效')
  try {
    return await db.$transaction(async tx => {
      if (requestId) {
        const existing = await tx.transaction.findFirst({ where: { userId, requestId } })
        if (existing) return existing.id
      }
      const data = await validatedRecord(userId, input, tx as typeof db)
      const record = await tx.transaction.create({ data: { ...data, requestId } })
      return record.id
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (requestId) {
      const existing = await db.transaction.findFirst({ where: { userId, requestId } })
      if (existing) return existing.id
    }
    throw error
  }
}

export async function updateRecord(userId: string, id: string, input: RecordInput) {
  await db.$transaction(async tx => {
    const old = await tx.transaction.findFirst({ where: { id, userId } })
    if (!old || old.type === 'FIXED_EXPENSE') throw new Error('此记录不能修改')
    const data = await validatedRecord(userId, input, tx as typeof db, id, old.type === 'DAILY_EXPENSE' && input.type === 'expense' ? old.accountId ?? undefined : undefined)
    await tx.transaction.update({ where: { id }, data })
    if (old.type === 'DEBT_PRINCIPAL' && (old.accountId !== data.accountId || data.type !== 'DEBT_PRINCIPAL')) {
      const { balances } = await accountBalances(userId, tx as typeof db)
      if (old.accountId && (balances.get(old.accountId) ?? 0n) < 0n) throw new Error('修改后借贷余额不能为负')
    }
  }, { isolationLevel: 'Serializable' })
}

export async function deleteRecord(userId: string, id: string) {
  await db.$transaction(async tx => {
    const old = await tx.transaction.findFirst({ where: { id, userId } })
    if (!old || old.type === 'FIXED_EXPENSE') throw new Error('此记录不能删除')
    await tx.transaction.delete({ where: { id } })
  })
}

export async function materializeRecurringCharges(userId: string, now = new Date()) {
  const [user, expenses] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId } }),
    db.fixedExpense.findMany({ where: { userId, active: true } }),
  ])
  if (!expenses.length) return
  const current = chinaParts(now)
  for (const expense of expenses) {
    const start = chinaParts(expense.createdAt)
    for (let year = start.year, month = start.month; year < current.year || (year === current.year && month <= current.month);) {
      const due = dueDate(year, month, expense.dayOfMonth)
      if (due >= expense.createdAt && due >= expense.updatedAt && due <= now) {
        if (!user.defaultExpenseAccountId) throw new Error('请先设置默认消费账户')
        await db.transaction.createMany({ data: [{
          userId, type: 'FIXED_EXPENSE', amountCents: expense.amountCents,
          occurredAt: due, note: expense.name, accountId: user.defaultExpenseAccountId,
          fixedExpenseId: expense.id, fixedMonth: monthString(year, month),
        }], skipDuplicates: true })
      }
      month += 1
      if (month === 13) { year += 1; month = 1 }
    }
  }
}

export async function createFixedExpense(userId: string, input: { name: string; amountCents: bigint; day: number }) {
  requirePositive(input.amountCents)
  if (!Number.isInteger(input.day) || input.day < 1 || input.day > 31) throw new Error('扣款日需为 1–31')
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
  if (!user.defaultExpenseAccountId) throw new Error('请先设置默认消费账户')
  return (await db.fixedExpense.create({ data: { userId, name: cleanName(input.name), amountCents: input.amountCents, dayOfMonth: input.day, active: true } })).id
}

export async function updateFixedExpense(userId: string, id: string, input: { name: string; amountCents: bigint; day: number; active: boolean }) {
  await materializeRecurringCharges(userId)
  requirePositive(input.amountCents)
  if (!Number.isInteger(input.day) || input.day < 1 || input.day > 31) throw new Error('扣款日需为 1–31')
  if (input.active && !(await db.user.findUniqueOrThrow({ where: { id: userId } })).defaultExpenseAccountId) throw new Error('请先设置默认消费账户')
  const result = await db.fixedExpense.updateMany({ where: { id, userId }, data: { name: cleanName(input.name), amountCents: input.amountCents, dayOfMonth: input.day, active: input.active } })
  if (!result.count) throw new Error('固定支出不存在')
}

export async function deleteFixedExpense(userId: string, id: string) {
  await materializeRecurringCharges(userId)
  const result = await db.fixedExpense.updateMany({ where: { id, userId }, data: { active: false } })
  if (!result.count) throw new Error('固定支出不存在')
}

export async function updateBudget(userId: string, input: { defaultAllowanceCents?: bigint; month?: string; monthAllowanceCents?: bigint; runwayTargetMonths?: number }) {
  if (input.defaultAllowanceCents !== undefined) requireNonnegative(input.defaultAllowanceCents)
  if (input.monthAllowanceCents !== undefined) requireNonnegative(input.monthAllowanceCents)
  if (input.runwayTargetMonths !== undefined && (!Number.isInteger(input.runwayTargetMonths) || input.runwayTargetMonths < 1 || input.runwayTargetMonths > 120)) throw new Error('安全月数目标需为 1–120')
  if (input.monthAllowanceCents !== undefined && (!input.month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month))) throw new Error('月份格式无效')
  await db.$transaction(async tx => {
    if (input.defaultAllowanceCents !== undefined || input.runwayTargetMonths !== undefined) {
      await tx.user.update({ where: { id: userId }, data: {
        ...(input.defaultAllowanceCents !== undefined ? { monthlyAllowanceCents: input.defaultAllowanceCents } : {}),
        ...(input.runwayTargetMonths !== undefined ? { safetyMonthsTarget: input.runwayTargetMonths } : {}),
      } })
    }
    if (input.monthAllowanceCents !== undefined && input.month) {
      await tx.monthlyAllowance.upsert({ where: { userId_month: { userId, month: input.month } }, create: { userId, month: input.month, amountCents: input.monthAllowanceCents }, update: { amountCents: input.monthAllowanceCents } })
    }
  })
}

export async function getDashboard(userId: string, now = new Date()) {
  await materializeRecurringCharges(userId, now)
  const month = monthString(chinaParts(now).year, chinaParts(now).month)
  const [user, ledger, fixedExpenses, allowance] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId } }),
    accountBalances(userId),
    db.fixedExpense.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    db.monthlyAllowance.findUnique({ where: { userId_month: { userId, month } } }),
  ])
  const accounts = ledger.accounts.map(account => ({ id: account.id, name: account.name, type: account.type.toLowerCase() as AccountKind, balanceCents: cents(ledger.balances.get(account.id) ?? 0n) }))
  const records = ledger.records.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).map(record => ({
    id: record.id,
    type: record.type === 'DAILY_EXPENSE' ? 'expense' : record.type === 'FIXED_EXPENSE' ? 'fixed_expense' : record.type === 'SALARY_INCOME' || record.type === 'INVESTMENT_INCOME' ? 'income' : record.type === 'INVESTMENT_CHANGE' ? 'value_change' : record.type === 'TRANSFER' ? 'transfer' : 'principal',
    amountCents: cents(record.amountCents), note: record.note ?? '', date: chinaDate(record.occurredAt),
    accountId: record.accountId, fromAccountId: record.accountId, toAccountId: record.toAccountId,
    incomeType: record.type === 'INVESTMENT_INCOME' ? 'investment' : record.type === 'SALARY_INCOME' ? 'salary' : null,
    repaymentTransactionId: record.repaymentTransactionId,
  }))
  let available = 0n, investment = 0n, debt = 0n
  for (const account of ledger.accounts) {
    const balance = ledger.balances.get(account.id) ?? 0n
    if (account.type === 'AVAILABLE') available += balance
    else if (account.type === 'INVESTMENT') investment += balance
    else debt += balance
  }
  let monthlyIncome = 0n, dailySpent = 0n, fixedSpent = 0n
  for (const record of ledger.records) {
    if (monthOf(record.occurredAt) !== month) continue
    if (record.type === 'SALARY_INCOME' || record.type === 'INVESTMENT_INCOME') monthlyIncome += record.amountCents
    else if (record.type === 'DAILY_EXPENSE') dailySpent += record.amountCents
    else if (record.type === 'FIXED_EXPENSE') fixedSpent += record.amountCents
  }
  const allowanceCents = allowance?.amountCents ?? user.monthlyAllowanceCents
  const planned = allowanceCents + fixedExpenses.filter(expense => expense.active).reduce((sum, expense) => sum + expense.amountCents, 0n)
  const runwayMonths = planned === 0n ? null : available <= 0n ? 0 : Number(available) / Number(planned)
  return {
    accounts, records,
    fixedExpenses: fixedExpenses.map(expense => ({ id: expense.id, name: expense.name, amountCents: cents(expense.amountCents), day: expense.dayOfMonth, active: expense.active })),
    defaultExpenseAccountId: user.defaultExpenseAccountId,
    monthlyAllowanceCents: cents(user.monthlyAllowanceCents), defaultAllowanceCents: cents(user.monthlyAllowanceCents), runwayTargetMonths: user.safetyMonthsTarget, currentMonth: month,
    overview: {
      availableCents: cents(available), investmentCents: cents(investment), debtCents: cents(debt), netWorthCents: cents(available + investment - debt),
      monthlyIncomeCents: cents(monthlyIncome), dailySpentCents: cents(dailySpent), fixedSpentCents: cents(fixedSpent),
      allowanceCents: cents(allowanceCents), allowanceRemainingCents: cents(allowanceCents - dailySpent), plannedSpendingCents: cents(planned),
      runwayMonths, runwayTargetMonths: user.safetyMonthsTarget,
    },
  }
}

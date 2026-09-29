'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import {
  chinaDate, createAccount, updateAccount, deleteAccount, setDefaultExpenseAccount,
  createRecord, updateRecord, deleteRecord, createFixedExpense, updateFixedExpense,
  deleteFixedExpense, updateBudget,
  type AccountKind, type RecordInput, type RecordKind,
} from '@/lib/finance'

type Result = { ok: true } | { ok: false; error: string }

function field(form: FormData, name: string) { return String(form.get(name) ?? '').trim() }
function money(form: FormData, name: string): bigint {
  const value = field(form, name)
  if (!/^-?\d+(\.\d{1,2})?$/.test(value)) throw new Error('请输入精确到分的金额')
  const negative = value.startsWith('-')
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.')
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('金额过大')
  return negative ? -result : result
}
function optionalMoney(form: FormData, name: string) { return field(form, name) ? money(form, name) : undefined }
function integer(form: FormData, name: string) {
  const value = field(form, name)
  if (!/^\d+$/.test(value)) throw new Error('请输入有效整数')
  return Number(value)
}
function optionalId(form: FormData, name: string) { return field(form, name) || undefined }
function recordInput(form: FormData): RecordInput {
  const type = field(form, 'type') as RecordKind
  return {
    type,
    amountCents: money(form, 'amount'),
    note: field(form, 'note'),
    date: field(form, 'date') || chinaDate(),
    accountId: optionalId(form, type === 'transfer' ? 'fromAccountId' : 'accountId'),
    toAccountId: optionalId(form, 'toAccountId'),
    incomeType: field(form, 'incomeType') === 'investment' ? 'investment' : 'salary',
    repaymentTransactionId: optionalId(form, 'repaymentTransactionId'),
    requestId: optionalId(form, 'requestId'),
  }
}
async function run(work: (userId: string) => Promise<unknown>): Promise<Result> {
  const { id } = await requireUser()
  try {
    await work(id)
    revalidatePath('/')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '操作失败，请稍后重试' }
  }
}

export async function createAccountAction(form: FormData): Promise<Result> {
  return run(userId => createAccount(userId, { name: field(form, 'name'), type: field(form, 'type') as AccountKind, initialBalanceCents: money(form, 'initialAmount') }))
}
export async function updateAccountAction(form: FormData): Promise<Result> {
  return run(userId => updateAccount(userId, field(form, 'id'), { name: field(form, 'name') }))
}
export async function deleteAccountAction(form: FormData): Promise<Result> {
  return run(userId => deleteAccount(userId, field(form, 'id')))
}
export async function setDefaultExpenseAccountAction(form: FormData): Promise<Result> {
  return run(userId => setDefaultExpenseAccount(userId, field(form, 'accountId')))
}
export async function createRecordAction(form: FormData): Promise<Result> {
  return run(userId => createRecord(userId, recordInput(form)))
}
export async function updateRecordAction(form: FormData): Promise<Result> {
  return run(userId => updateRecord(userId, field(form, 'id'), recordInput(form)))
}
export async function deleteRecordAction(form: FormData): Promise<Result> {
  return run(userId => deleteRecord(userId, field(form, 'id')))
}
export async function createFixedExpenseAction(form: FormData): Promise<Result> {
  return run(userId => createFixedExpense(userId, { name: field(form, 'name'), amountCents: money(form, 'amount'), day: integer(form, 'day') }))
}
export async function updateFixedExpenseAction(form: FormData): Promise<Result> {
  return run(userId => updateFixedExpense(userId, field(form, 'id'), { name: field(form, 'name'), amountCents: money(form, 'amount'), day: integer(form, 'day'), active: field(form, 'active') === 'true' }))
}
export async function deleteFixedExpenseAction(form: FormData): Promise<Result> {
  return run(userId => deleteFixedExpense(userId, field(form, 'id')))
}
export async function updateBudgetAction(form: FormData): Promise<Result> {
  return run(userId => updateBudget(userId, {
    defaultAllowanceCents: optionalMoney(form, 'defaultAllowance'),
    month: optionalId(form, 'month'),
    monthAllowanceCents: optionalMoney(form, 'monthAllowance'),
    runwayTargetMonths: field(form, 'runwayTarget') ? integer(form, 'runwayTarget') : undefined,
  }))
}

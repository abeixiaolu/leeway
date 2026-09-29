import { timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { materializeRecurringCharges } from '@/lib/finance'

export const dynamic = 'force-dynamic'

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(request.headers.get('authorization') ?? '')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function GET(request: Request) {
  if (!authorized(request)) return new Response('Unauthorized', { status: 401 })

  const now = new Date()
  let cursor: string | undefined
  let processed = 0
  try {
    while (true) {
      const users = await db.user.findMany({
        where: { fixedExpenses: { some: { active: true } } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      if (!users.length) break
      for (const user of users) {
        await materializeRecurringCharges(user.id, now)
        processed += 1
      }
      cursor = users.at(-1)?.id
    }
    return Response.json({ processed })
  } catch (error) {
    console.error('Recurring charge job failed', error)
    return new Response('Recurring charge job failed', { status: 500 })
  }
}

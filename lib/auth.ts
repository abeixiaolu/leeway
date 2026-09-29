import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'

const scrypt = promisify(scryptCallback)
const cookieName = 'leeway_session'
const sessionLifetimeSeconds = 60 * 60 * 24 * 30

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = (await scrypt(password, salt, 64)) as Buffer
  return `${salt}:${hash.toString('hex')}`
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, encodedHash] = storedHash.split(':')
  if (!salt || !encodedHash || !/^[0-9a-f]{128}$/.test(encodedHash)) return false
  const expected = Buffer.from(encodedHash, 'hex')
  const actual = (await scrypt(password, salt, expected.length)) as Buffer
  return timingSafeEqual(actual, expected)
}

export function normalizeNickname(value: string): { nickname: string; nicknameKey: string } {
  const nickname = value.normalize('NFKC').trim()
  return { nickname, nicknameKey: nickname.toLocaleLowerCase('zh-CN') }
}

export async function registerUser(nicknameInput: string, password: string): Promise<string> {
  const { nickname, nicknameKey } = normalizeNickname(nicknameInput)
  if (nickname.length < 2 || nickname.length > 30 || password.length < 10 || password.length > 200) {
    throw new Error('INVALID_REGISTRATION')
  }
  const user = await db.user.create({
    data: { nickname, nicknameKey, passwordHash: await hashPassword(password) },
    select: { id: true },
  })
  return user.id
}

export async function authenticateUser(nicknameInput: string, password: string): Promise<string | null> {
  const { nicknameKey } = normalizeNickname(nicknameInput)
  if (!nicknameKey || !password) return null
  const user = await db.user.findUnique({
    where: { nicknameKey },
    select: { id: true, passwordHash: true },
  })
  if (!user || !(await verifyPassword(password, user.passwordHash))) return null
  return user.id
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + sessionLifetimeSeconds * 1000),
    },
  })
  ;(await cookies()).set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: sessionLifetimeSeconds,
  })
}

export async function getUser(): Promise<{ id: string; nickname: string } | null> {
  const token = (await cookies()).get(cookieName)?.value
  if (!token) return null
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { expiresAt: true, user: { select: { id: true, nickname: true } } },
  })
  if (!session || session.expiresAt <= new Date()) return null
  return session.user
}

export async function requireUser(): Promise<{ id: string; nickname: string }> {
  const user = await getUser()
  if (!user) redirect('/login')
  return user
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(cookieName)?.value
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } })
  cookieStore.delete(cookieName)
}

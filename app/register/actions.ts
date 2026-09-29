'use server'

import { Prisma } from '@prisma/client'
import { redirect } from 'next/navigation'
import { createSession, registerUser } from '@/lib/auth'

export async function register(formData: FormData): Promise<void> {
  const nickname = String(formData.get('nickname') ?? '')
  const password = String(formData.get('password') ?? '')
  let userId: string
  try {
    userId = await registerUser(nickname, password)
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_REGISTRATION') {
      redirect('/register?error=invalid')
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      redirect('/register?error=taken')
    }
    throw error
  }

  await createSession(userId)
  redirect('/')
}

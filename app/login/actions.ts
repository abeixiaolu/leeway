'use server'

import { redirect } from 'next/navigation'
import { authenticateUser, createSession } from '@/lib/auth'

export async function login(formData: FormData): Promise<void> {
  const nickname = String(formData.get('nickname') ?? '')
  const password = String(formData.get('password') ?? '')
  const userId = await authenticateUser(nickname, password)
  if (!userId) redirect('/login?error=invalid')

  await createSession(userId)
  redirect('/')
}

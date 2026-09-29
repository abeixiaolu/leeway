import Link from 'next/link'
import { getUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { login } from './actions'
import styles from './auth.module.css'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  if (await getUser()) redirect('/')
  const { error } = await searchParams

  return (
    <main className={styles.shell}>
      <section className={styles.panel}>
        <Link className={styles.brand} href="/">LEEWAY</Link>
        <p className={styles.eyebrow}>PERSONAL FINANCE</p>
        <h1>欢迎回来</h1>
        <p className={styles.intro}>用昵称和私人密码，进入你的财务空间。</p>
        <form action={login} className={styles.form}>
          <label htmlFor="nickname">昵称</label>
          <input id="nickname" name="nickname" autoComplete="username" required maxLength={30} />
          <label htmlFor="password">私人密码</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          {error && <p className={styles.error} role="alert">昵称或密码不正确。</p>}
          <button type="submit">进入财务空间</button>
        </form>
        <p className={styles.footer}>还没有空间？<Link href="/register">创建一个</Link></p>
      </section>
    </main>
  )
}

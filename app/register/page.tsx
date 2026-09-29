import Link from 'next/link'
import { getUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { register } from './actions'
import styles from '../login/auth.module.css'

export default async function RegisterPage({
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
        <p className={styles.eyebrow}>YOUR OWN SPACE</p>
        <h1>创建财务空间</h1>
        <p className={styles.intro}>从这里开始，把资产、支出和储备放在一处看清楚。</p>
        <form action={register} className={styles.form}>
          <label htmlFor="nickname">昵称</label>
          <input id="nickname" name="nickname" autoComplete="username" minLength={2} maxLength={30} required />
          <span className={styles.hint}>2–30 个字符，作为登录时的身份。</span>
          <label htmlFor="password">私人密码</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} maxLength={200} required />
          <span className={styles.hint}>至少 10 个字符。请妥善保存：当前版本没有密码找回功能。</span>
          {error && <p className={styles.error} role="alert">{error === 'taken' ? '这个昵称已被使用，请换一个。' : '请检查昵称和密码是否符合要求。'}</p>}
          <button type="submit">创建空间</button>
        </form>
        <p className={styles.footer}>已有空间？<Link href="/login">登录</Link></p>
      </section>
    </main>
  )
}

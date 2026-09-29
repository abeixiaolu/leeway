import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { logout } from "@/app/logout/actions";
import { getDashboard } from "@/lib/finance";
import {
  createAccountAction,
  setDefaultExpenseAccountAction,
  createRecordAction,
  updateRecordAction,
  deleteRecordAction,
  createFixedExpenseAction,
  updateFixedExpenseAction,
  deleteFixedExpenseAction,
  updateBudgetAction,
} from "./actions";

const money = (cents: number) =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100);
const amount = (cents: number) => (cents / 100).toFixed(2);
const typeLabel: Record<string, string> = {
  expense: "日常支出", income: "收入", transfer: "转账", value_change: "投资价值变动", principal: "偿还本金", fixed_expense: "固定支出",
};
const accountLabel: Record<string, string> = { available: "可用资金", investment: "投资资产", debt: "借贷" };
const chinaDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
type AccountView = { id: string; name: string; type: string; balanceCents: number };
type RecordView = { id: string; type: string; amountCents: number; note: string | null; date: string; accountId?: string | null; fromAccountId?: string | null; toAccountId?: string | null; incomeType?: string | null; repaymentTransactionId?: string | null };
type FixedExpenseView = { id: string; name: string; amountCents: number; day: number; active: boolean };

function Field({ label, name, type = "text", defaultValue, min, max, step, required = true, placeholder, children }: {
  label: string; name: string; type?: string; defaultValue?: string | number; min?: string | number; max?: string | number; step?: string; required?: boolean; placeholder?: string; children?: React.ReactNode;
}) {
  return <label className="field"><span className="field-label">{label}</span>{children ?
    <select name={name} defaultValue={defaultValue} required={required}>{children}</select> :
    <input name={name} type={type} defaultValue={defaultValue} min={min} max={max} step={step} required={required} placeholder={placeholder} />}</label>;
}

function AccountOptions({ accounts, includeInvestment = true }: { accounts: Array<{ id: string; name: string; type: string }>; includeInvestment?: boolean }) {
  return <>{accounts.filter(account => account.type === "available" || (includeInvestment && account.type === "investment")).map(account => <option value={account.id} key={account.id}>{account.name} · {accountLabel[account.type]}</option>)}</>;
}

export default async function Home() {
  const user = await requireUser();
  const data = await getDashboard(user.id);
  const accounts: AccountView[] = data.accounts;
  const records: RecordView[] = data.records;
  const fixedExpenses: FixedExpenseView[] = data.fixedExpenses;
  const { overview } = data;
  const assets = accounts.filter(account => account.type !== "debt");
  const available = accounts.filter(account => account.type === "available");
  const investments = accounts.filter(account => account.type === "investment");
  const debts = accounts.filter(account => account.type === "debt");
  const month = data.currentMonth;
  const today = chinaDate();
  const runway = overview.runwayMonths;
  const target = data.runwayTargetMonths;
  const runwayGood = runway !== null && runway >= target;
  const expenseRecords = records.filter(record => record.type === "expense" && record.date.slice(0, 7) === month);
  const otherRecords = records.filter(record => record.type !== "expense");
  const fixedCharges = records.filter(record => record.type === "fixed_expense");
  const salaryIncomeCents = records.filter(record => record.type === "income" && record.incomeType === "salary" && record.date.slice(0, 7) === month).reduce((sum, record) => sum + record.amountCents, 0);
  const investmentIncomeCents = records.filter(record => record.type === "income" && record.incomeType === "investment" && record.date.slice(0, 7) === month).reduce((sum, record) => sum + record.amountCents, 0);
  const defaultAccount = available.find(account => account.id === data.defaultExpenseAccountId);

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#top"><span className="brand-mark">↗</span>leeway</a>
      <nav className="nav" aria-label="主导航">
        <span className="nav-label">PERSONAL FINANCE</span>
        <a href="#overview">财务概览</a><a href="#daily">日常记账</a><a href="#accounts">账户资产</a><a href="#records">全部记录</a><a href="#planning">月度计划</a>
      </nav>
      <div className="side-foot"><strong>{user.nickname}</strong>仅你可查看与修改这份财务记录<form action={logout}><button className="logout-button" type="submit">退出登录</button></form></div>
    </aside>
    <main id="top" className="main">
      <header className="topbar"><div><p className="eyebrow">你的财务空间</p><h1 className="page-title">每一笔，都心中有数。</h1><p className="subtle">资金、计划和安全距离，一眼看清。</p></div><span className="today">{today} · 中国时间</span></header>

      <section id="overview" className="section" aria-labelledby="overview-title"><div className="section-head"><div><h2 id="overview-title">财务概览</h2><p>当前账户余额与 {month} 收支</p></div></div>
        <div className="overview-grid">
          <div className="metric primary"><div className="metric-label">可用资金</div><div className={`metric-value ${overview.availableCents < 0 ? "negative" : ""}`}>{money(overview.availableCents)}</div><div className="metric-note">可用于日常支出的账户合计</div></div>
          <div className="metric"><div className="metric-label">投资资产</div><div className="metric-value">{money(overview.investmentCents)}</div><div className="metric-note">不计入安全月数</div></div>
          <div className="metric"><div className="metric-label">借贷余额</div><div className="metric-value">{money(overview.debtCents)}</div><div className="metric-note">尚未偿还的本金</div></div>
          <div className="metric"><div className="metric-label">当前净资产</div><div className={`metric-value ${overview.netWorthCents < 0 ? "negative" : ""}`}>{money(overview.netWorthCents)}</div><div className="metric-note">可用资金 + 投资资产 − 借贷</div></div>
        </div>
      </section>

      <section id="daily" className="section" aria-labelledby="daily-title"><div className="section-head"><div><h2 id="daily-title">本月日常</h2><p>记账只需金额与备注，日期默认今天</p></div><span className={`pill ${overview.allowanceRemainingCents < 0 ? "warn" : ""}`}>{overview.allowanceRemainingCents < 0 ? "已超出额度" : "额度内"}</span></div>
        <div className="focus-grid">
          <div className="panel quick-entry"><h3>快速记一笔</h3><p className="panel-hint">从默认消费账户{defaultAccount ? `「${defaultAccount.name}」` : ""}扣除</p>
            {defaultAccount ? <ActionForm action={createRecordAction}><input type="hidden" name="type" value="expense" /><div className="field-row"><Field label="金额（元）" name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" /><Field label="备注" name="note" placeholder="例如：午餐、超市" /><button className="btn" type="submit">记下支出</button></div><details className="quiet-details"><summary>补记过去日期</summary><Field label="支出日期" name="date" type="date" required={false} max={today} /></details></ActionForm> : <p className="empty">请先创建可用资金账户，并设为默认消费账户。</p>}
          </div>
          <div className="panel"><h3>本月额度</h3><p className="panel-hint">每月重新开始，不结转上月余额</p><div className="runway-number"><span className={overview.allowanceRemainingCents < 0 ? "negative" : ""}>{money(overview.allowanceRemainingCents)}</span></div><div className="stat-line"><span>本月额度</span><strong>{money(overview.allowanceCents)}</strong></div><div className="stat-line"><span>已记日常支出</span><strong>{money(overview.dailySpentCents)}</strong></div></div>
        </div>
        <div className="panel stack-top"><h3>本月日常支出</h3>{expenseRecords.length ? <ul className="record-list">{expenseRecords.map(record => <RecordRow key={record.id} record={record} accounts={accounts} />)}</ul> : <p className="empty">本月还没有日常支出。第一笔可以从上方快速记下。</p>}</div>
      </section>

      <section id="accounts" className="section" aria-labelledby="accounts-title"><div className="section-head"><div><h2 id="accounts-title">账户资产</h2><p>余额由初始金额与后续记录计算</p></div></div>
        <div className="split"><div className="panel"><h3>可用资金</h3>{available.length ? <ul className="account-list">{available.map(account => <li className="account" key={account.id}><div><div className="account-name">{account.name} {account.id === data.defaultExpenseAccountId && <span className="pill">默认消费账户</span>}</div><div className="account-meta">可用资金</div></div><strong className={`account-amount ${account.balanceCents < 0 ? "negative" : ""}`}>{money(account.balanceCents)}</strong></li>)}</ul> : <p className="empty">还没有可用资金账户。</p>}</div>
          <div className="panel"><h3>投资与借贷</h3>{[...investments, ...debts].length ? <ul className="account-list">{[...investments, ...debts].map(account => <li className="account" key={account.id}><div><div className="account-name">{account.name}</div><div className="account-meta">{accountLabel[account.type]}</div></div><strong className="account-amount">{money(account.balanceCents)}</strong></li>)}</ul> : <p className="empty">还没有投资或借贷账户。</p>}</div></div>
        <div className="forms-grid stack-top"><div className="form-card"><h3>新增账户</h3><ActionForm action={createAccountAction}><div className="form-grid"><Field label="账户名称" name="name" placeholder="例如：工资卡" /><Field label="账户类型" name="type" defaultValue="available"><option value="available">可用资金</option><option value="investment">投资资产</option><option value="debt">借贷</option></Field><Field label="初始金额（元）" name="initialAmount" type="number" min="0" step="0.01" placeholder="0.00" /></div><div className="form-actions"><button type="submit" className="btn">创建账户</button></div></ActionForm><p className="muted-note">创建后请通过收支、转账或本金记录调整余额。</p></div>
          <div className="form-card"><h3>默认消费账户</h3>{available.length ? <ActionForm action={setDefaultExpenseAccountAction}><div className="form-grid"><Field label="日常与固定支出从此扣款" name="accountId" defaultValue={data.defaultExpenseAccountId ?? ""}><option value="" disabled>选择账户</option><AccountOptions accounts={available} includeInvestment={false} /></Field></div><div className="form-actions"><button type="submit" className="btn secondary">保存账户</button></div></ActionForm> : <p className="empty">创建一个可用资金账户后即可指定。</p>}</div></div>
      </section>

      <section id="records" className="section" aria-labelledby="records-title"><div className="section-head"><div><h2 id="records-title">资金变动</h2><p>记录实际到账、账户转移、投资涨跌与偿还本金</p></div></div>
        <div className="forms-grid">
          <div className="form-card"><h3>收入到账</h3><ActionForm action={createRecordAction}><input type="hidden" name="type" value="income" /><div className="form-grid"><Field label="收入类型" name="incomeType" defaultValue="salary"><option value="salary">工资收入</option><option value="investment">理财收入</option></Field><Field label="到账金额（元）" name="amount" type="number" min="0.01" step="0.01" /><Field label="到账账户" name="accountId"><option value="">选择账户</option><AccountOptions accounts={assets} /></Field><Field label="到账日期" name="date" type="date" defaultValue={today} max={today} /><div className="wide"><Field label="备注" name="note" required={false} placeholder="可选" /></div></div><div className="form-actions"><button type="submit" className="btn">记录收入</button></div></ActionForm></div>
          <div className="form-card"><h3>账户间转账</h3><ActionForm action={createRecordAction}><input type="hidden" name="type" value="transfer" /><div className="form-grid"><Field label="转出账户" name="fromAccountId"><option value="">选择账户</option><AccountOptions accounts={assets} /></Field><Field label="转入账户" name="toAccountId"><option value="">选择账户</option><AccountOptions accounts={assets} /></Field><Field label="金额（元）" name="amount" type="number" min="0.01" step="0.01" /><Field label="日期" name="date" type="date" defaultValue={today} max={today} /><div className="wide"><Field label="备注" name="note" required={false} placeholder="可选" /></div></div><div className="form-actions"><button type="submit" className="btn">记录转账</button></div></ActionForm></div>
          <div className="form-card"><h3>投资价值变动</h3><ActionForm action={createRecordAction}><input type="hidden" name="type" value="value_change" /><div className="form-grid"><Field label="投资账户" name="accountId"><option value="">选择账户</option>{investments.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</Field><Field label="涨跌金额（元）" name="amount" type="number" step="0.01" placeholder="上涨填正数，下跌填负数" /><Field label="日期" name="date" type="date" defaultValue={today} max={today} /><Field label="备注" name="note" required={false} placeholder="可选" /></div><div className="form-actions"><button type="submit" className="btn">记录变动</button></div></ActionForm></div>
          <div className="form-card"><h3>偿还借贷本金</h3><ActionForm action={createRecordAction}><input type="hidden" name="type" value="principal" /><div className="form-grid"><Field label="借贷账户" name="accountId"><option value="">选择账户</option>{debts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</Field><Field label="偿还本金（元）" name="amount" type="number" min="0.01" step="0.01" /><Field label="对应固定还款" name="repaymentTransactionId"><option value="">选择已扣款记录</option>{fixedCharges.map(charge => <option key={charge.id} value={charge.id}>{charge.date} · {charge.note || "固定支出"} · {money(charge.amountCents)}</option>)}</Field><Field label="日期" name="date" type="date" defaultValue={today} max={today} /><Field label="备注" name="note" required={false} placeholder="可选" /></div><div className="form-actions"><button type="submit" className="btn">记录本金</button></div></ActionForm><p className="muted-note">固定还款已扣除现金；本金记录仅减少借贷余额。</p></div>
        </div>
        <div className="panel stack-top"><h3>其他记录</h3>{otherRecords.length ? <ul className="record-list">{otherRecords.map(record => <RecordRow key={record.id} record={record} accounts={accounts} />)}</ul> : <p className="empty">还没有其他资金变动记录。</p>}</div>
      </section>

      <section id="planning" className="section" aria-labelledby="planning-title"><div className="section-head"><div><h2 id="planning-title">月度计划与安全距离</h2><p>按本月计划支出估算可用资金能支撑多久</p></div></div>
        <div className="wide-split"><div className="panel"><h3>实际可支撑月数</h3>{overview.plannedSpendingCents === 0 ? <><div className="runway-number">暂无月度支出计划</div><p className="muted-note">设置日常额度或固定支出后即可计算。</p></> : <><div className="runway-number">{runway === null ? "—" : `${runway.toFixed(1)} 个月`}</div><div className="progress-track" aria-label={`安全月数目标 ${target} 个月`}><div className="progress-fill" style={{width:`${Math.min(100,Math.max(0,((runway ?? 0)/target)*100))}%`}} /></div><div className="progress-label"><span>{runwayGood ? "已达到安全目标" : overview.availableCents <= 0 ? "可用资金存在缺口" : `距目标还差 ${Math.max(0,target-(runway ?? 0)).toFixed(1)} 个月`}</span><span>目标 {target} 个月</span></div></>}<div className="stat-line"><span>本月计划支出</span><strong>{money(overview.plannedSpendingCents)}</strong></div><div className="stat-line"><span>本月实际收入</span><strong>{money(overview.monthlyIncomeCents)}</strong></div><div className="stat-line"><span>其中工资收入</span><strong>{money(salaryIncomeCents)}</strong></div><div className="stat-line"><span>其中理财收入</span><strong>{money(investmentIncomeCents)}</strong></div><div className="stat-line"><span>本月实际支出</span><strong>{money(overview.dailySpentCents + overview.fixedSpentCents)}</strong></div><div className="stat-line"><span>其中日常支出</span><strong>{money(overview.dailySpentCents)}</strong></div><div className="stat-line"><span>其中固定支出</span><strong>{money(overview.fixedSpentCents)}</strong></div></div>
          <div className="panel"><h3>调整计划</h3><p className="panel-hint">计划支出 = 本月日常额度 + 启用的固定支出</p><ActionForm action={updateBudgetAction}><div className="form-grid"><Field label="默认每月日常额度（元）" name="defaultAllowance" type="number" min="0" step="0.01" defaultValue={amount(data.monthlyAllowanceCents)} /><Field label="安全月数目标" name="runwayTarget" type="number" min="1" step="1" defaultValue={target} /></div><div className="form-actions"><button type="submit" className="btn">保存默认计划</button></div></ActionForm><details className="quiet-details"><summary>单独调整某个月的日常额度</summary><ActionForm action={updateBudgetAction}><div className="form-grid"><Field label="月份" name="month" type="month" defaultValue={month} /><Field label="该月额度（元）" name="monthAllowance" type="number" min="0" step="0.01" defaultValue={amount(overview.allowanceCents)} /></div><div className="form-actions"><button type="submit" className="btn secondary">保存月度额度</button></div></ActionForm></details></div></div>
        <div className="split stack-top"><div className="panel"><h3>固定支出</h3>{fixedExpenses.length ? <ul className="record-list">{fixedExpenses.map(item => <li className="record" key={item.id}><div className="record-main"><div className="record-title">{item.name} {!item.active && <span className="pill warn">已停用</span>}</div><div className="record-meta">每月 {item.day} 日 · {item.active ? "自动扣款" : "不再扣款"}</div></div><div className="record-side"><strong className="record-amount">{money(item.amountCents)}</strong><details><summary>编辑</summary><div className="edit-popover"><h4>编辑固定支出</h4><ActionForm action={updateFixedExpenseAction}><input type="hidden" name="id" value={item.id} /><div className="form-grid"><Field label="名称" name="name" defaultValue={item.name} /><Field label="金额（元）" name="amount" type="number" min="0.01" step="0.01" defaultValue={amount(item.amountCents)} /><Field label="每月扣款日" name="day" type="number" min="1" max="31" defaultValue={item.day} /><Field label="状态" name="active" defaultValue={item.active ? "true" : "false"}><option value="true">启用</option><option value="false">停用</option></Field></div><div className="form-actions"><button type="submit" className="btn small">保存修改</button></div></ActionForm><ActionForm action={deleteFixedExpenseAction}><input type="hidden" name="id" value={item.id} /><button type="submit" className="btn danger small delete-button">删除配置</button></ActionForm></div></details></div></li>)}</ul> : <p className="empty">还没有固定支出。</p>}</div>
          <div className="form-card"><h3>新增固定支出</h3><ActionForm action={createFixedExpenseAction}><div className="form-grid"><Field label="名称" name="name" placeholder="例如：房租、还贷" /><Field label="金额（元）" name="amount" type="number" min="0.01" step="0.01" /><Field label="每月扣款日" name="day" type="number" min="1" max="31" defaultValue="1" /></div><div className="form-actions"><button type="submit" className="btn">添加固定支出</button></div></ActionForm><p className="muted-note">短月没有设定日期时，按当月最后一天扣款。历史扣款不会被之后的配置更改影响。</p></div></div>
      </section>
    </main>
  </div>;
}

function RecordRow({ record, accounts }: { record: RecordView; accounts: AccountView[] }) {
  const accountName = (id?: string | null) => accounts.find(account => account.id === id)?.name ?? "账户";
  const title = record.type === "income" ? `${record.incomeType === "salary" ? "工资收入" : "理财收入"}${record.note ? ` · ${record.note}` : ""}` : record.type === "transfer" ? `${accountName(record.fromAccountId)} → ${accountName(record.toAccountId)}` : record.note || typeLabel[record.type] || "记录";
  const assetAccounts = accounts.filter(account => account.type !== "debt");
  return <li className="record"><div className="record-main"><div className="record-title">{title}</div><div className="record-meta">{record.date} · {typeLabel[record.type] ?? record.type}{record.accountId ? ` · ${accountName(record.accountId)}` : ""}</div></div><div className="record-side"><strong className={`record-amount ${record.type === "expense" || record.type === "fixed_expense" || record.amountCents < 0 ? "negative" : ""}`}>{record.type === "expense" || record.type === "fixed_expense" || record.amountCents < 0 ? "−" : record.type === "income" || record.type === "value_change" ? "+" : ""}{money(Math.abs(record.amountCents))}</strong>{record.type !== "fixed_expense" && <details><summary>编辑</summary><div className="edit-popover"><h4>修改记录</h4><ActionForm action={updateRecordAction}><input type="hidden" name="id" value={record.id} /><input type="hidden" name="type" value={record.type} />{record.repaymentTransactionId && <input type="hidden" name="repaymentTransactionId" value={record.repaymentTransactionId} />}<div className="form-grid"><Field label="金额（元）" name="amount" type="number" step="0.01" min={record.type === "value_change" ? undefined : "0.01"} defaultValue={amount(record.amountCents)} /><Field label="日期" name="date" type="date" defaultValue={record.date} max={chinaDate()} />{record.type === "income" && <><Field label="收入类型" name="incomeType" defaultValue={record.incomeType ?? "salary"}><option value="salary">工资收入</option><option value="investment">理财收入</option></Field><Field label="到账账户" name="accountId" defaultValue={record.accountId ?? ""}><AccountOptions accounts={assetAccounts} /></Field></>}{record.type === "transfer" && <><Field label="转出账户" name="fromAccountId" defaultValue={record.fromAccountId ?? ""}><AccountOptions accounts={assetAccounts} /></Field><Field label="转入账户" name="toAccountId" defaultValue={record.toAccountId ?? ""}><AccountOptions accounts={assetAccounts} /></Field></>}{(record.type === "value_change" || record.type === "principal") && <Field label={record.type === "principal" ? "借贷账户" : "投资账户"} name="accountId" defaultValue={record.accountId ?? ""}>{accounts.filter(account => account.type === (record.type === "principal" ? "debt" : "investment")).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</Field>}<div className="wide"><Field label="备注" name="note" defaultValue={record.note ?? ""} required={record.type === "expense"} /></div></div><div className="form-actions"><button type="submit" className="btn small">保存修改</button></div></ActionForm><ActionForm action={deleteRecordAction}><input type="hidden" name="id" value={record.id} /><button type="submit" className="btn danger small delete-button">删除这笔记录</button></ActionForm></div></details>}</div></li>;
}

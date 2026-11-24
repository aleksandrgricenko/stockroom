import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownToLine, ArrowDownUp, ArrowLeft, ArrowRight, ArrowUpFromLine, Box, Boxes, CalendarDays,
  Check, ChevronRight, ClipboardList, Clock3, History, PackageCheck, PackageOpen, Search, Truck, Warehouse,
} from 'lucide-react';
import { statusLabels, type Delivery, type DeliveryDetail, type Movement, type Product, type Status } from '../shared/model.js';

const sections = [
  { id: 'deliveries', title: 'Поставки', icon: Truck, description: 'Ожидаемые поставки и приёмка товара' },
  { id: 'stock', title: 'Остатки', icon: Boxes, description: 'Доступное количество по каждому SKU' },
  { id: 'movements', title: 'Движения', icon: ArrowDownUp, description: 'Журнал приёмки и выдачи товара' },
] as const;

const number = new Intl.NumberFormat('ru-RU');
const date = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const timestamp = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
const statuses = [
  { id: 'expected', icon: Clock3, label: 'Ожидаются' },
  { id: 'partial', icon: PackageOpen, label: 'Частично обработаны' },
  { id: 'completed', icon: PackageCheck, label: 'Обработаны' },
] as const;

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось выполнить запрос.';
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api' + path, options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error('Нет связи с сервером. Попробуйте ещё раз.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? 'Ошибка сервера. Попробуйте ещё раз.');
  }
  return response.json();
}

function useData<T>(path: string) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ path: string; version: number; data?: T; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    api<T>(path, { signal: controller.signal }).then(
      (data) => { if (!controller.signal.aborted) setState({ path, version, data }); },
      (error) => { if (!controller.signal.aborted) setState({ path, version, error: message(error) }); },
    );
    return () => controller.abort();
  }, [path, version]);
  const current = state?.path === path && state.version === version ? state : undefined;
  return { data: current?.data, error: current?.error, loading: !current, reload: () => setVersion((count) => count + 1) };
}

function useMutation(path: string) {
  const pendingKeys = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(payload: object, done: () => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const body = JSON.stringify(payload);
    const key = pendingKeys.current.get(body) ?? crypto.randomUUID();
    pendingKeys.current.set(body, key);
    try {
      await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body });
      pendingKeys.current.delete(body);
      done();
    } catch (error) {
      setError(message(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { busy, error, submit, setError };
}

function href(section: string, value?: string | number) {
  return '#/' + section + (value === undefined ? '' : '/' + encodeURIComponent(value));
}

function readRoute() {
  const [, section, encoded] = location.hash.split('/');
  let value = '';
  try { value = decodeURIComponent(encoded ?? ''); } catch { /* malformed link */ }
  return { section, value };
}

export function App() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const section = sections.find((item) => item.id === route.section) ?? sections[0];
  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href={href('deliveries')} aria-label="Stockroom · Поставки">
        <span className="brand-icon"><Box size={23} strokeWidth={2.1} /></span>
        <span><strong>Stockroom</strong><small>Складской учёт</small></span>
      </a>
      <nav className="nav" aria-label="Основные разделы">
        {sections.map(({ id, title, icon: Icon }) =>
          <a key={id} href={href(id)} aria-current={section.id === id ? 'page' : undefined}>
            <Icon size={19} /><span>{title}</span>{section.id === id && <ChevronRight className="nav-arrow" size={15} />}
          </a>
        )}
      </nav>
      <div className="sidebar-foot"><Warehouse size={18} /><span>Демонстрационный склад</span></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><Warehouse size={17} /><span>Склад</span><ChevronRight size={14} />
        <strong>{section.title}</strong>
      </header>
      <main className="content">
        {section.id === 'deliveries' && (route.value
          ? <DeliveryPage key={route.value} id={route.value} />
          : <DeliveriesPage />)}
        {section.id === 'stock' && <StockPage />}
        {section.id === 'movements' && <MovementsPage sku={route.value} />}
      </main>
    </div>
  </div>;
}

function Heading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}

function Badge({ status }: { status: Status }) {
  return <span className={'badge ' + status}><i />{statusLabels[status]}</span>;
}

function Notice({ loading, error, retry }: { loading?: boolean; error?: string; retry?: () => void }) {
  if (loading) return <div className="notice" role="status"><span className="spinner" />Загрузка…</div>;
  if (!error) return null;
  return <div className="notice error" role="alert">{error}{retry && <button className="button secondary" onClick={retry}>Повторить</button>}</div>;
}

function SearchBox({ value, setValue, label }: { value: string; setValue: (value: string) => void; label: string }) {
  return <label className="search"><Search size={17} /><input type="search" aria-label={label}
    placeholder={label} value={value} onChange={(event) => setValue(event.target.value)} /></label>;
}

function Progress({ value, total }: { value: number; total: number }) {
  return <div className="progress" aria-label={`Обработано ${value} из ${total}`} role="progressbar"
    aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={value}>
    <span style={{ width: total ? `${value / total * 100}%` : 0 }} />
  </div>;
}

function DeliveriesPage() {
  const query = useData<Delivery[]>('/deliveries');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const term = search.trim().toLocaleLowerCase('ru');
  const rows = query.data?.filter((d) => (!filter || d.status === filter)
    && (d.number.toLowerCase().includes(term) || d.supplier.toLocaleLowerCase('ru').includes(term)));
  return <>
    <Heading title="Поставки" description={sections[0].description} />
    <Notice {...query} retry={query.reload} />
    {rows && <>
      <div className="metrics">
        {statuses.map(({ id, icon: Icon, label }) => <button type="button" key={id}
          className="metric card" aria-pressed={filter === id} onClick={() => setFilter(filter === id ? '' : id)}>
          <span className={'metric-icon ' + id}><Icon size={21} /></span>
          <span><span className="metric-label">{label}</span><strong>{query.data!.filter((d) => d.status === id).length}</strong></span>
        </button>)}
      </div>
      <section className="card ledger" aria-labelledby="deliveries-title">
        <div className="ledger-title"><div><h2 id="deliveries-title">Реестр поставок</h2><p>Всего поставок: {query.data!.length}</p></div><ClipboardList size={21} /></div>
        <div className="toolbar"><SearchBox label="Поиск по номеру или поставщику" value={search} setValue={setSearch} />
          <select aria-label="Статус поставки" value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="">Все статусы</option>{statuses.map(({ id }) => <option key={id} value={id}>{statusLabels[id]}</option>)}
          </select>
        </div>
        <div className="table-scroll"><table><thead><tr><th>Поставка</th><th>Поставщик</th><th>Ожидается</th><th>Статус</th><th>Обработано</th><th><span className="sr-only">Открыть</span></th></tr></thead>
          <tbody>{rows.map((d) => <tr key={d.id}>
            <td><a className="record" href={href('deliveries', d.id)}><span className="row-icon"><Truck size={17} /></span><strong>{d.number}</strong></a></td>
            <td>{d.supplier}</td><td className="muted nowrap">{date.format(new Date(d.expectedOn))}</td><td><Badge status={d.status} /></td>
            <td><div className="table-progress"><span>{number.format(d.accepted + d.rejected)} <small>/ {number.format(d.ordered)}</small></span>
              <Progress value={d.accepted + d.rejected} total={d.ordered} /></div></td>
            <td><a className="icon-link" href={href('deliveries', d.id)} aria-label={`Открыть поставку ${d.number}`}><ArrowRight size={17} /></a></td>
          </tr>)}</tbody>
        </table></div>
        {rows.length === 0 && <div className="empty">Поставки не найдены.</div>}
      </section>
    </>}
  </>;
}

function DeliveryPage({ id }: { id: string }) {
  const query = useData<DeliveryDetail>('/deliveries/' + encodeURIComponent(id));
  const [saved, setSaved] = useState(false);
  const delivery = query.data;
  return <>
    <a className="back" href={href('deliveries')}><ArrowLeft size={17} />К поставкам</a>
    <Notice {...query} retry={query.reload} />
    {saved && <div className="notice success" role="status"><Check size={17} />Партия сохранена.</div>}
    {delivery && <>
      <Heading title={delivery.number} description={delivery.supplier} action={<Badge status={delivery.status} />} />
      <section className="card delivery-summary" aria-label="Сводка поставки">
        <div className="delivery-meta"><CalendarDays size={17} /> Ожидается {date.format(new Date(delivery.expectedOn))}</div>
        <div className="summary-grid">{[
          ['Заказано', delivery.ordered], ['Принято', delivery.accepted], ['Отклонено', delivery.rejected],
          ['Осталось', delivery.ordered - delivery.accepted - delivery.rejected],
        ].map(([title, count]) => <div key={title}><span>{title}</span><strong>{number.format(Number(count))} <small>шт.</small></strong></div>)}</div>
        <Progress value={delivery.accepted + delivery.rejected} total={delivery.ordered} />
      </section>
      <section className="card ledger">
        <div className="ledger-title"><div><h2>Позиции поставки</h2><p>Количество по всем партиям</p></div><Boxes size={21} /></div>
        <div className="table-scroll"><table><thead><tr><th>Товар</th><th>Ожидается</th><th>Принято</th><th>Отклонено</th><th>Осталось</th></tr></thead>
          <tbody>{delivery.lines.map((line) => <tr key={line.sku}>
            <td><strong>{line.name}</strong><small className="subline">{line.sku}</small></td>
            <td>{line.ordered}</td><td>{line.accepted}</td><td>{line.rejected}</td>
            <td><strong>{line.ordered - line.accepted - line.rejected}</strong></td>
          </tr>)}</tbody></table></div>
      </section>
      {delivery.status !== 'completed' && <ReceiptForm delivery={delivery} onSaved={() => { setSaved(true); query.reload(); }} />}
      {delivery.status === 'completed' && <div className="notice success"><Check size={17} />Все единицы поставки обработаны.</div>}
      {delivery.batches.some((batch) => batch.lines.some((line) => line.rejected > 0)) && <section className="card ledger">
        <div className="ledger-title"><div><h2>Отклонённый товар</h2></div><PackageOpen size={21} /></div>
        <div className="table-scroll"><table><thead><tr><th>SKU</th><th>Отклонено</th><th>Причина</th></tr></thead>
          <tbody>{delivery.batches.flatMap((batch) => batch.lines.filter((line) => line.rejected > 0).map((line) =>
            <tr key={batch.id + line.sku}><td className="sku">{line.sku}</td><td>{line.rejected}</td><td>{line.reason}</td></tr>))}</tbody>
        </table></div>
      </section>}
    </>}
  </>;
}

type Draft = { accepted: string; rejected: string; reason: string };
const blank: Draft = { accepted: '', rejected: '', reason: '' };

function ReceiptForm({ delivery, onSaved }: { delivery: DeliveryDetail; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const mutation = useMutation(`/deliveries/${delivery.id}/receipts`);
  const available = delivery.lines.filter((line) => line.accepted + line.rejected < line.ordered);
  function change(sku: string, key: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [sku]: { ...(current[sku] ?? blank), [key]: value } }));
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const lines = available.map(({ sku }) => ({
      sku, accepted: Number(draft[sku]?.accepted || 0), rejected: Number(draft[sku]?.rejected || 0),
      reason: draft[sku]?.reason.trim() || null,
    })).filter((line) => line.accepted > 0 || line.rejected > 0);
    if (!lines.length) { mutation.setError('Укажите количество хотя бы для одной позиции.'); return; }
    void mutation.submit({ lines }, onSaved);
  }
  return <form className="card ledger" onSubmit={submit}>
    <div className="ledger-title"><div><h2>Приёмка партии</h2><p>Укажите количество, которое обработали в этой партии.</p></div><ArrowDownToLine size={21} /></div>
    <fieldset className="receipt-fields" disabled={mutation.busy}>
      {available.map((line) => {
        const value = draft[line.sku] ?? blank;
        const remaining = line.ordered - line.accepted - line.rejected;
        return <div className="receipt-grid" key={line.sku}>
          <div><strong>{line.name}</strong><small className="subline">{line.sku} · осталось {remaining} шт.</small></div>
          <label>Принято<input type="number" min="0" max={remaining} step="1" placeholder="0"
            aria-label={`Принято · ${line.sku}`} value={value.accepted} onChange={(e) => change(line.sku, 'accepted', e.target.value)} /></label>
          <label>Отклонено<input type="number" min="0" max={remaining} step="1" placeholder="0"
            aria-label={`Отклонено · ${line.sku}`} value={value.rejected} onChange={(e) => change(line.sku, 'rejected', e.target.value)} /></label>
          {Number(value.rejected) > 0 && <label className="reason">Причина отклонения<input required maxLength={300}
            aria-label={`Причина отклонения · ${line.sku}`} placeholder="Например, повреждена упаковка" value={value.reason}
            onChange={(e) => change(line.sku, 'reason', e.target.value)} /></label>}
        </div>;
      })}
    </fieldset>
    <div className="form-footer"><Notice error={mutation.error} />
      <button className="button primary" disabled={mutation.busy}><PackageCheck size={17} />{mutation.busy ? 'Сохраняем…' : 'Сохранить приёмку'}</button>
    </div>
  </form>;
}

function StockPage() {
  const query = useData<Product[]>('/products');
  const [search, setSearch] = useState('');
  const [issueSku, setIssueSku] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const term = search.trim().toLocaleLowerCase('ru');
  const rows = query.data?.filter((p) => p.sku.toLowerCase().includes(term) || p.name.toLocaleLowerCase('ru').includes(term));
  return <>
    <Heading title="Остатки" description={sections[1].description} action={<button className="button primary"
      disabled={!query.data?.length} onClick={() => { setSaved(false); setIssueSku(''); }}><ArrowUpFromLine size={17} />Выдать товар</button>} />
    <Notice {...query} retry={query.reload} />
    {saved && <div className="notice success" role="status"><Check size={17} />Выдача оформлена.</div>}
    {query.data && issueSku !== null && <IssueForm key={issueSku} products={query.data} initialSku={issueSku}
      onCancel={() => setIssueSku(null)} onSaved={() => { setIssueSku(null); setSaved(true); query.reload(); }} />}
    {rows && <section className="card ledger">
      <div className="ledger-title"><div><h2>Товары на складе</h2><p>Всего SKU: {query.data!.length}</p></div><Boxes size={21} /></div>
      <div className="toolbar"><SearchBox label="Поиск по SKU или названию" value={search} setValue={setSearch} /></div>
      <div className="table-scroll"><table><thead><tr><th>Товар</th><th>SKU</th><th>Остаток</th><th>Действия</th></tr></thead>
        <tbody>{rows.map((p) => <tr key={p.sku}>
          <td><span className="record"><span className="row-icon"><Box size={17} /></span><strong>{p.name}</strong></span></td>
          <td className="sku">{p.sku}</td><td><strong>{number.format(p.balance)}</strong> <span className="muted">шт.</span></td>
          <td><div className="row-actions"><a className="text-link" href={href('movements', p.sku)}><History size={16} />История</a>
            <button className="text-link" onClick={() => { setSaved(false); setIssueSku(p.sku); }}><ArrowUpFromLine size={16} />Выдать</button></div></td>
        </tr>)}</tbody>
      </table></div>
      {rows.length === 0 && <div className="empty">Товары не найдены.</div>}
    </section>}
  </>;
}

function IssueForm({ products, initialSku, onCancel, onSaved }: {
  products: Product[]; initialSku: string; onCancel: () => void; onSaved: () => void;
}) {
  const [sku, setSku] = useState(initialSku);
  const [amount, setAmount] = useState('');
  const [basis, setBasis] = useState('');
  const mutation = useMutation('/issues');
  const product = products.find((item) => item.sku === sku);
  function submit(event: FormEvent) {
    event.preventDefault();
    void mutation.submit({ sku, quantity: Number(amount), basis: basis.trim() }, onSaved);
  }
  return <form className="card ledger" onSubmit={submit}>
    <div className="ledger-title"><div><h2>Выдача товара</h2>{product && <p>Доступно: {number.format(product.balance)} шт.</p>}</div><ArrowUpFromLine size={21} /></div>
    <fieldset className="issue-fields" disabled={mutation.busy}>
      <label>Товар<select required value={sku} onChange={(e) => setSku(e.target.value)}>
        <option value="">Выберите SKU</option>{products.map((p) => <option key={p.sku} value={p.sku}>{p.sku} · {p.name}</option>)}
      </select></label>
      <label>Количество<input type="number" min="1" step="1" required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label>Основание выдачи<input required maxLength={300} placeholder="Например, заявка Р-018" value={basis}
        onChange={(e) => setBasis(e.target.value)} /></label>
    </fieldset>
    <div className="form-footer"><Notice error={mutation.error} />
      <button type="button" className="button secondary" disabled={mutation.busy} onClick={onCancel}>Отмена</button>
      <button className="button primary" disabled={mutation.busy}>{mutation.busy ? 'Сохраняем…' : 'Подтвердить выдачу'}</button>
    </div>
  </form>;
}

function MovementsPage({ sku }: { sku: string }) {
  const query = useData<Movement[]>('/movements?sku=' + encodeURIComponent(sku));
  return <>
    <Heading title="Движения" description={sections[2].description} />
    <Notice {...query} retry={query.reload} />
    {query.data && <section className="card ledger">
      <div className="ledger-title"><div><h2>{sku ? `История по SKU ${sku}` : 'Журнал движений'}</h2>
        <p>Всего операций в журнале: {query.data.length}</p></div><History size={21} /></div>
      {sku && <div className="toolbar"><a className="text-link" href={href('movements')}><ArrowLeft size={16} />Все движения</a></div>}
      <div className="table-scroll"><table><thead><tr><th>Дата и время</th><th>Товар</th><th>Операция</th><th>Количество</th><th>Основание</th></tr></thead>
        <tbody>{query.data.map((m) => <tr key={m.id}>
          <td className="nowrap">{timestamp.format(new Date(m.createdAt))}</td>
          <td><strong>{m.name}</strong><a className="subline text-link sku" href={href('movements', m.sku)}>{m.sku}</a></td>
          <td><span className={'badge ' + (m.kind === 'receipt' ? 'completed' : 'expected')}>
            {m.kind === 'receipt' ? <ArrowDownToLine size={14} /> : <ArrowUpFromLine size={14} />}
            {m.kind === 'receipt' ? 'Приёмка' : 'Выдача'}
          </span></td>
          <td className={m.kind === 'receipt' ? 'positive' : ''}><strong>{m.kind === 'receipt' ? '+' : '−'}{number.format(m.quantity)}</strong></td>
          <td>{m.deliveryId ? <a className="text-link" href={href('deliveries', m.deliveryId)}>{m.basis}<ChevronRight size={15} /></a> : m.basis}</td>
        </tr>)}</tbody>
      </table></div>
      {query.data.length === 0 && <div className="empty">Движений пока нет.</div>}
    </section>}
  </>;
}

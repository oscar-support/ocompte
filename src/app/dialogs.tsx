'use client';

import { ArrowRight, Check, Copy, Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { parseAmount, splitEvenly, type Action, type CreateGroup, type Currency, type Entry, type Expense, type Group, type Payment } from '../lib/ledger';
import { categories, currencies, displayMoney, today } from '../lib/presentation';

export type Modal = { type: 'create' | 'share' | 'member' } | { type: 'expense'; entry?: Expense } | { type: 'payment'; payment: Omit<Payment, 'id' | 'kind' | 'date'> } | { type: 'remove'; entry: Entry };
export type Report = string | null;

function Dialog({ title, subtitle, close, children, busy }: { title: string; subtitle?: string; close: () => void; children: ReactNode; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); }; }, []);
  return <dialog ref={ref} className="dialog" aria-labelledby={id} onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <div className="dialog-top"><h2 id={id}>{title}</h2><button type="button" disabled={busy} className="icon-button" onClick={close} aria-label="Fermer"><X size={20} /></button></div>
    {subtitle && <p className="dialog-sub">{subtitle}</p>}
    {children}
  </dialog>;
}

function ErrorMessage({ value }: { value: Report }) { return value && <p className="form-error" role="alert">{value}</p>; }

export function GroupDialogs({ modal, group, invite, close, create, mutate }: { modal: Modal; group: Group; invite: string; close: () => void; create: (data: CreateGroup) => Promise<Report>; mutate: (action: Action) => Promise<Report> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Report>(null);
  const [copied, setCopied] = useState(false);
  const [paymentId] = useState(() => modal.type === 'payment' ? crypto.randomUUID() : '');
  const inviteInput = useRef<HTMLInputElement>(null);
  async function send(run: () => Promise<Report>) {
    if (busy) return;
    setBusy(true); setError(null);
    try { const message = await run(); if (message) setError(message); else close(); }
    catch { setError('La connexion a été interrompue. Réessayez.'); }
    finally { setBusy(false); }
  }
  const title = { create: 'Nouveau groupe', member: 'Ajouter une personne', share: 'Partager le groupe', expense: 'Nouvelle dépense', payment: 'Enregistrer un remboursement', remove: 'Supprimer cette opération ?' }[modal.type];
  return <Dialog title={modal.type === 'expense' && modal.entry ? 'Modifier la dépense' : title} close={close} busy={busy} subtitle={modal.type === 'create' ? 'Un week-end, une coloc, un dîner… Commencez par lui donner un nom.' : undefined}>
    {modal.type === 'create' && <form className="form" onSubmit={e => {
      e.preventDefault(); const fields = new FormData(e.currentTarget);
      void send(() => create({ name: String(fields.get('name')), currency: String(fields.get('currency')) as Currency, names: String(fields.get('names')).split(/\r?\n/).map(name => name.trim()).filter(Boolean) }));
    }}><label>Nom du groupe<input name="name" placeholder="Ex. Week-end à Lisbonne" maxLength={80} required autoFocus /></label>
      <label>Devise<select name="currency" defaultValue="EUR">{Object.entries(currencies).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Participants<textarea name="names" rows={3} maxLength={1200} placeholder={'Camille\nNoé\nJade'} required aria-describedby="names-help" /></label>
      <small id="names-help" className="form-help">Un prénom par ligne. Vous pourrez en ajouter ensuite.</small>
      <ErrorMessage value={error} /><button className="button primary full" type="submit" disabled={busy}>{busy ? 'Création…' : 'Créer le groupe'} <ArrowRight size={17} /></button></form>}
    {modal.type === 'member' && <form className="form" onSubmit={e => { e.preventDefault(); const name = String(new FormData(e.currentTarget).get('name')); void send(() => mutate({ type: 'member.add', name })); }}>
      <label>Prénom<input name="name" maxLength={40} required autoFocus /></label><ErrorMessage value={error} /><button className="button primary full" disabled={busy}><Plus size={18} />{busy ? 'Ajout…' : 'Ajouter au groupe'}</button>
    </form>}
    {modal.type === 'share' && <div className="form"><p className="dialog-sub share-note">Toute personne qui dispose de ce lien peut consulter et modifier le carnet. Ne le partagez qu’avec les participants.</p>
      <label>Lien du groupe<input ref={inviteInput} value={invite} readOnly onFocus={e => e.currentTarget.select()} /></label>
      <button type="button" className="button primary full" onClick={async () => { try { await navigator.clipboard.writeText(invite); setCopied(true); setError(null); } catch { inviteInput.current?.focus(); setError('Copiez le lien sélectionné manuellement.'); } }}>{copied ? <><Check size={18} /> Lien copié</> : <><Copy size={18} /> Copier le lien</>}</button>
      <span className="sr-only" role="status">{copied ? 'Lien copié' : ''}</span><ErrorMessage value={error} />
    </div>}
    {modal.type === 'expense' && <ExpenseEditor group={group} entry={modal.entry} mutate={action => void send(() => mutate(action))} error={error} busy={busy} />}
    {modal.type === 'payment' && <form className="form" onSubmit={e => { e.preventDefault(); const date = String(new FormData(e.currentTarget).get('date')); void send(() => mutate({ type: 'entry.add', entry: { ...modal.payment, id: paymentId, kind: 'payment', date } })); }}>
      <p className="dialog-sub"><strong>{group.members.find(m => m.id === modal.payment.fromId)?.name}</strong> a remboursé <strong>{displayMoney(modal.payment.amount, group.currency)}</strong> à <strong>{group.members.find(m => m.id === modal.payment.toId)?.name}</strong>. L’application n’effectue aucun virement.</p>
      <label>Date du remboursement<input type="date" name="date" defaultValue={today()} required /></label><ErrorMessage value={error} /><button className="button primary full" disabled={busy}>{busy ? 'Enregistrement…' : 'Confirmer le remboursement'}</button>
    </form>}
    {modal.type === 'remove' && <div className="form"><p className="dialog-sub">Cette opération sera retirée du carnet et les soldes seront recalculés.</p><ErrorMessage value={error} /><button className="button danger full" disabled={busy} onClick={() => void send(() => mutate({ type: 'entry.remove', id: modal.entry.id }))}>{busy ? 'Suppression…' : 'Supprimer'}</button></div>}
  </Dialog>;
}

function ExpenseEditor({ group, entry, mutate, error, busy }: { group: Group; entry?: Expense; mutate: (action: Action) => void; error: Report; busy: boolean }) {
  const initialIds = entry ? group.members.filter(m => Object.hasOwn(entry.shares, m.id)).map(m => m.id) : group.members.map(m => m.id);
  const format = (n: number) => (n / 100).toFixed(2).replace('.', ',');
  const parseShare = (s: string) => /^0(?:[,.]0{1,2})?$/.test(s.trim()) ? 0 : parseAmount(s);
  const [entryId] = useState(() => entry?.id ?? crypto.randomUUID());
  const [selection, setSelection] = useState(initialIds);
  const [parts, setParts] = useState<Record<string,string>>(entry ? Object.fromEntries(initialIds.map(id => [id, format(entry.shares[id])])) : {});
  const [mode, setMode] = useState(entry ? 'custom' : 'equal');
  const [amount, setAmount] = useState(entry ? format(entry.amount) : '');
  const [localError, setLocalError] = useState<Report>(null);
  const total = parseAmount(amount);
  const distributed = mode === 'custom' ? selection.reduce((sum, id) => sum + (parseShare(parts[id] ?? '') ?? 0), 0) : total;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setLocalError(null);
    const people = group.members.map(m => m.id).filter(id => selection.includes(id));
    if (!total) return setLocalError('Saisissez un montant positif avec deux décimales au maximum.');
    if (!people.length) return setLocalError('Sélectionnez au moins une personne pour répartir la dépense.');
    const selectedParts = people.map(id => parseShare(parts[id] ?? ''));
    if (mode === 'custom' && (selectedParts.some(p => p === null) || distributed !== total)) return setLocalError('Saisissez un montant pour chaque part. Leur somme doit correspondre au montant de la dépense.');
    const fields = new FormData(e.currentTarget);
    mutate({ type: entry ? 'entry.edit' : 'entry.add', entry: { id: entryId, kind: 'expense', label: String(fields.get('label')), amount: total,
      date: String(fields.get('date')), category: String(fields.get('category')) as Expense['category'], payerId: String(fields.get('payer')),
      shares: mode === 'equal' ? splitEvenly(total, people) : Object.fromEntries(people.flatMap((id, i) => selectedParts[i] ? [[id, selectedParts[i]]] : [])) } });
  }
  return <form className="form" onSubmit={submit} onChange={() => setLocalError(null)}>
    <label>Intitulé<input name="label" defaultValue={entry?.label} maxLength={100} placeholder="Ex. Les pizzas du vendredi" required autoFocus /></label>
    <div className="form-row"><label>Montant<input name="amount" inputMode="decimal" placeholder="0,00" value={amount} onChange={e => setAmount(e.target.value)} maxLength={12} required /></label><label>Date<input name="date" type="date" defaultValue={entry?.date ?? today()} required /></label></div>
    <div className="form-row"><label>Payé par<select name="payer" defaultValue={entry?.payerId}>{group.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label>Catégorie<select name="category" defaultValue={entry?.category ?? 'repas'}>{Object.entries(categories).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label></div>
    <label><span id="split-label">Répartition</span><select aria-labelledby="split-label" value={mode} onChange={e => setMode(e.target.value)}><option value="equal">À parts égales</option><option value="custom">Montants personnalisés</option></select></label>
    <fieldset className="people-fields"><legend>Pour qui ?</legend>{group.members.map(m => <div className="person-field" key={m.id}>
      <label><input type="checkbox" checked={selection.includes(m.id)} onChange={e => setSelection(list => e.target.checked ? [...list, m.id] : list.filter(id => id !== m.id))} /> {m.name}</label>
      {mode === 'custom' && selection.includes(m.id) && <input aria-label={`Part de ${m.name}`} value={parts[m.id] ?? ''} onChange={event => setParts(prev => ({ ...prev, [m.id]: event.target.value }))} placeholder="0,00" inputMode="decimal" maxLength={12} />}
    </div>)}</fieldset>
    {mode === 'custom' && <small className="form-help">Réparti : {displayMoney(distributed ?? 0, group.currency)} / {displayMoney(total ?? 0, group.currency)}</small>}
    <ErrorMessage value={localError ?? error} /><button className="button primary full" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer la dépense'}</button>
  </form>;
}

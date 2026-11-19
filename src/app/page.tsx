'use client';

import { ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, Banknote, BookOpen, Check, ChevronRight, CircleHelp, Coffee, House, LayoutGrid, Menu, Pencil, Plus, ReceiptText, Share2, ShoppingBasket, TrainFront, Trash2, Users, Wine, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { balances, settlements, type Action, type CreateGroup, type Group, type Member } from '../lib/ledger';
import { categories, displayDate, displayMoney, example, initials, sortedEntries } from '../lib/presentation';
import { GroupDialogs, type Modal } from './dialogs';

type Recent = { token: string; name: string };
type Tab = 'entries' | 'balance' | 'members';
type View = { kind: 'demo' } | { kind: 'loading'; token: string } | { kind: 'error'; token: string; message: string } | { kind: 'group'; token: string; data: Group };
const recentKey = 'ocompte.recents.v1';
const tokenPattern = /^[a-zA-Z0-9_-]{43}$/;
const conflictNotice = 'Le carnet a été modifié entre-temps. Vérifiez la version à jour avant de recommencer.';
const icons = { repas: Coffee, courses: ShoppingBasket, transport: TrainFront, logement: House, loisirs: Wine, autre: ReceiptText };
const tabs = [{ id: 'entries', name: 'Dépenses', icon: ReceiptText }, { id: 'balance', name: 'Équilibre', icon: ArrowLeftRight }, { id: 'members', name: 'Participants', icon: Users }] as const;

function remember(token: string, name: string) {
  const next = [{ token, name }, ...loadRecent().filter(r => r.token !== token)].slice(0, 16);
  try { localStorage.setItem(recentKey, JSON.stringify(next)); } catch { /* private browser */ }
  return next;
}
function loadRecent(): Recent[] {
  try { const values: unknown = JSON.parse(localStorage.getItem(recentKey) ?? '[]'); return Array.isArray(values) ? values.filter((r): r is Recent => !!r && typeof r.name === 'string' && typeof r.token === 'string' && tokenPattern.test(r.token)).slice(0, 16) : []; }
  catch { return []; }
}
function tokenFromHash() { return new URLSearchParams(window.location.hash.slice(1)).get('g') ?? ''; }

async function api(path: string, { method, token, data, signal }: { method?: 'PATCH'|'POST'; token?: string; data?: unknown; signal?: AbortSignal } = {}) {
  const timeout = AbortSignal.timeout(15000);
  const response = await fetch(path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined, cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const payload = await response.json().catch(() => ({})) as { error?: string; group?: Group; token?: string };
  return { ...payload, ok: response.ok, status: response.status };
}

export default function Page() {
  const [view, setView] = useState<View>({ kind: 'demo' });
  const [recent, setRecent] = useState<Recent[]>([]);
  const [tab, setTab] = useState<Tab>('entries');
  const [modal, setModal] = useState<Modal | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [notice, setNotice] = useState('');
  const liveToken = view.kind === 'group' ? view.token : '';
  const group = view.kind === 'group' ? view.data : example;
  const demo = view.kind === 'demo';

  const readGroup = useCallback(async (token: string, signal?: AbortSignal) => {
    if (!token) { setView({ kind: 'demo' }); return; }
    if (!tokenPattern.test(token)) { setView({ kind: 'error', token, message: 'Ce lien de groupe est incomplet ou invalide.' }); return; }
    setView({ kind: 'loading', token });
    try {
      const result = await api('/api/group', { token, signal });
      if (signal?.aborted || tokenFromHash() !== token) return;
      if (!result.ok || !result.group) { setView({ kind: 'error', token, message: result.error ?? 'Le groupe n’a pas pu être chargé.' }); return; }
      setView({ kind: 'group', token, data: result.group });
      setRecent(remember(token, result.group.name));
    } catch {
      if (!signal?.aborted && tokenFromHash() === token) setView({ kind: 'error', token, message: 'Connexion interrompue. Réessayez dans un instant.' });
    }
  }, []);

  useEffect(() => {
    let request: AbortController | undefined;
    function onNavigation() {
      request?.abort(); request = new AbortController();
      setTab('entries'); setModal(null); setNotice(''); setMobileMenu(false);
      void readGroup(tokenFromHash(), request.signal);
    }
    const timer = window.setTimeout(() => { setRecent(loadRecent()); onNavigation(); }, 0);
    window.addEventListener('hashchange', onNavigation);
    return () => { clearTimeout(timer); request?.abort(); window.removeEventListener('hashchange', onNavigation); };
  }, [readGroup]);

  useEffect(() => {
    if (!liveToken || modal) return;
    const controller = new AbortController();
    async function refresh() {
      if (document.visibilityState !== 'visible') return;
      try {
        const result = await api('/api/group', { token: liveToken, signal: controller.signal });
        if (!controller.signal.aborted) setView(current => current.kind === 'group' && current.token === liveToken && result.group && result.group.version > current.data.version ? { ...current, data: result.group } : current);
      } catch { /* A failed background refresh should not hide the ledger. */ }
    }
    window.addEventListener('focus', refresh);
    const interval = window.setInterval(refresh, 20000);
    return () => { controller.abort(); window.clearInterval(interval); window.removeEventListener('focus', refresh); };
  }, [liveToken, modal]);

  function go(token = '') {
    setMobileMenu(false);
    const target = token ? `#g=${token}` : '';
    if (window.location.hash !== target) window.location.hash = target;
    else { setTab('entries'); setNotice(''); }
  }
  async function create(data: CreateGroup) {
    const result = await api('/api/groups', { method: 'POST', data });
    if (!result.ok || !result.group || !result.token) return result.error ?? 'Impossible de créer le groupe.';
    window.history.pushState(null, '', `#g=${result.token}`);
    setMobileMenu(false); setTab('entries'); setView({ kind: 'group', token: result.token, data: result.group });
    setRecent(remember(result.token, result.group.name)); setNotice('Votre groupe est prêt. Partagez son lien pour inviter les participants.');
    return null;
  }
  async function mutate(action: Action) {
    if (view.kind !== 'group') return 'Créez un groupe pour ajouter des opérations.';
    const result = await api('/api/group', { method: 'PATCH', token: view.token, data: { version: view.data.version, action } });
    if (result.group) setView(current => current.kind === 'group' && current.token === view.token && result.group && result.group.version >= current.data.version ? { ...current, data: result.group } : current);
    if (result.status === 409) { setModal(null); setNotice(conflictNotice); return null; }
    if (!result.ok) return result.error ?? 'Impossible d’enregistrer la modification.';
    setNotice(action.type === 'member.add' ? 'Participant ajouté.' : action.type === 'entry.remove' ? 'Opération supprimée.' : action.entry.kind === 'expense' ? 'Dépense enregistrée.' : 'Remboursement enregistré.');
    return null;
  }

  const nameOf = (id: string) => group.members.find(m => m.id === id)?.name ?? 'Participant';
  const expenseList = group.entries.filter(e => e.kind === 'expense');
  const total = expenseList.reduce((sum, e) => sum + e.amount, 0);
  const owed = settlements(group);
  const money = (n: number) => displayMoney(n, group.currency);
  const openExpense = () => setModal({ type: demo ? 'create' : 'expense' });
  const showLedger = demo || view.kind === 'group';
  return <div className="workspace">
    <a className="skip-link" href="#carnet" onClick={e => { e.preventDefault(); document.getElementById('carnet')?.focus(); }}>Aller au carnet</a>
    <header className="mobile-header"><button className="brand" type="button" onClick={() => go()}><Brand /> </button><button type="button" className="icon-button" aria-controls="menu-groups" aria-expanded={mobileMenu} aria-label={mobileMenu ? 'Fermer le menu' : 'Ouvrir le menu'} onClick={() => setMobileMenu(v => !v)}>{mobileMenu ? <X size={22} /> : <Menu size={22} />}</button></header>
    <aside className={`sidebar ${mobileMenu ? 'open' : ''}`} id="menu-groups">
      <button type="button" className="brand" onClick={() => go()}><Brand /></button>
      <button className="button sidebar-create" type="button" onClick={() => { setMobileMenu(false); setModal({ type: 'create' }); }}><Plus size={18} /> Nouveau groupe</button>
      <nav className="side-nav" aria-label="Groupes"><p className="eyebrow">Mes groupes</p>
        {!recent.length && <p className="recent-empty">Vos groupes récents s’afficheront ici.</p>}
        {recent.map(r => <button type="button" className="nav-item" key={r.token} aria-current={liveToken === r.token ? 'page' : undefined} onClick={() => go(r.token)}><Users size={17} /><span>{r.name}</span><ChevronRight size={14} /></button>)}
        <p className="eyebrow discover">À découvrir</p>
        <button type="button" className="nav-item" aria-current={demo ? 'page' : undefined} onClick={() => go()}><BookOpen size={17} /><span>Le groupe d’exemple</span><ChevronRight size={14} /></button>
      </nav>
      <div className="sidebar-footer"><CircleHelp size={16} /><p>Pas de compte à créer.<br />Il suffit d’un lien pour partager.</p></div>
    </aside>

    <main id="carnet" tabIndex={-1} className="main">
      <div className="topline"><span className="crumb"><LayoutGrid size={16} /> Carnet de groupe</span><span className="status-label"><span />{demo ? 'Mode démo' : 'Espace partagé'}</span></div>
      {!showLedger && <section className="unavailable" aria-live="polite"><h1>{view.kind === 'loading' ? 'Ouverture du carnet…' : 'Carnet indisponible'}</h1>
        {view.kind === 'error' && <><p>{view.message}</p><div className="header-actions"><button className="button primary" onClick={() => void readGroup(view.token)}>Réessayer</button><button className="button secondary" onClick={() => go()}>Revenir à l’exemple</button></div></>}
      </section>}
      {showLedger && <>
        <header className="group-header"><div className="group-heading"><p className="eyebrow group-kicker">{demo ? 'Carnet d’exemple' : 'Votre carnet de dépenses'} <span aria-hidden="true" /></p>
          <h1>{demo && <span className="sr-only">Exemple : </span>}{group.name}</h1>
          <p>{demo ? 'Explorez le carnet avant de créer le vôtre.' : 'Les dépenses et les remboursements de votre groupe.'}</p>
        </div><div className="header-actions">{!demo && <button className="button secondary" type="button" onClick={() => setModal({ type: 'share' })}><Share2 size={17} /> Partager</button>}
          <button className="button primary" type="button" onClick={openExpense}>{demo ? <ArrowRight size={18} /> : <Plus size={19} />}{demo ? 'Créer mon groupe' : 'Ajouter une dépense'}</button></div></header>
        <div className="overview" aria-label="Résumé du groupe">
          <div className="total-card"><p><Banknote size={18} /> Total des dépenses</p><strong>{money(total)}</strong><small>{expenseList.length} dépense{expenseList.length !== 1 ? 's' : ''} · {group.currency}</small></div>
          <div className="stat-card"><p><Users size={18} /> Participants</p><strong>{group.members.length}</strong><div className="avatar-stack" aria-hidden="true">{group.members.slice(0,5).map((m,i) => <Avatar key={m.id} member={m} index={i} />)}{group.members.length > 5 && <span className="avatar">+{group.members.length - 5}</span>}</div></div>
          <div className="stat-card"><p><ArrowLeftRight size={18} /> À rembourser</p><strong>{money(owed.reduce((sum, t) => sum + t.amount, 0))}</strong><small>{owed.length ? `${owed.length} remboursement${owed.length > 1 ? 's' : ''} proposé${owed.length > 1 ? 's' : ''}` : 'Le groupe est à l’équilibre'}</small></div>
        </div>
        <div className="section-nav" aria-label="Sections du carnet">{tabs.map(t => <button type="button" key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}><t.icon size={17} /> {t.name}</button>)}</div>
        <div className="sr-only" role="status">{notice === conflictNotice ? '' : notice}</div>
        {notice === conflictNotice && <p className="form-error" role="alert">{notice}</p>}
        {notice.startsWith('Votre groupe') && <p className="created-note"><Check size={17} /> {notice}<button className="icon-button" aria-label="Masquer le message" onClick={() => setNotice('')}><X size={17} /></button></p>}
        {tab === 'entries' && <section className="ledger" aria-labelledby="ledger-heading">
          <div className="section-header"><div><h2 id="ledger-heading">Historique des dépenses</h2><p>Dépenses et remboursements, du plus récent au plus ancien.</p></div><span className="count">{group.entries.length} opération{group.entries.length !== 1 ? 's' : ''}</span></div>
          {group.entries.length ? <ul className="entry-list">{sortedEntries(group.entries).map(entry => {
            const Icon = entry.kind === 'expense' ? icons[entry.category] : ArrowLeftRight;
            return <li key={entry.id} className="entry"><div className={`entry-icon ${entry.kind === 'expense' ? entry.category : 'payment'}`}><Icon size={20} /></div><div className="entry-name"><strong>{entry.kind === 'expense' ? entry.label : 'Remboursement'}</strong><span>{entry.kind === 'expense' ? `${categories[entry.category]} · Payé par ${nameOf(entry.payerId)}` : `${nameOf(entry.fromId)} → ${nameOf(entry.toId)}`}</span></div>
              <time dateTime={entry.date}>{displayDate(entry.date)}</time><strong className="entry-amount">{money(entry.amount)}</strong>
              {!demo && <div className="entry-tools">{entry.kind === 'expense' && <button type="button" className="icon-button" aria-label={`Modifier ${entry.label}`} onClick={() => setModal({ type: 'expense', entry })}><Pencil size={16} /></button>}<button type="button" className="icon-button" aria-label={`Supprimer ${entry.kind === 'expense' ? entry.label : 'le remboursement'}`} onClick={() => setModal({ type: 'remove', entry })}><Trash2 size={17} /></button></div>}
            </li>;
          })}</ul> : <div className="empty-state"><ReceiptText size={27} /><h3>Aucune dépense pour le moment</h3><p>Ajoutez la première note pour commencer les comptes.</p><button className="button secondary" type="button" onClick={openExpense}><Plus size={17} /> Ajouter une première dépense</button></div>}
        </section>}
        {tab === 'balance' && <div className="balance-grid"><section className="ledger" aria-labelledby="settlements-heading"><div className="section-header"><div><h2 id="settlements-heading">Qui rembourse qui ?</h2><p>Les paiements proposés pour solder le carnet.</p></div></div>
          {owed.length ? <ul className="entry-list">{owed.map((t, i) => <li className="entry transfer" key={`${t.fromId}:${t.toId}:${i}`}><span className="entry-icon payment"><ArrowRight size={19} /></span><div className="entry-name"><strong>{nameOf(t.fromId)} → {nameOf(t.toId)}</strong><span>{money(t.amount)}</span></div>{!demo && <button className="button secondary" aria-label={`Enregistrer le remboursement ${nameOf(t.fromId)} vers ${nameOf(t.toId)}`} type="button" onClick={() => setModal({ type: 'payment', payment: t })}><Check size={16} /> Marquer payé</button>}</li>)}</ul> : <div className="empty-state"><Check size={27} /><h3>Tout est réglé</h3><p>Aucun remboursement à effectuer.</p></div>}
        </section><section className="ledger" aria-labelledby="balance-heading"><div className="section-header"><div><h2 id="balance-heading">Soldes individuels</h2><p>Ce que chaque personne doit ou reçoit.</p></div></div>
          <ul className="entry-list">{Object.entries(balances(group)).map(([id, amount]) => <li className="entry transfer" key={id}><span className={`entry-icon ${amount < 0 ? 'repas' : 'payment'}`}>{amount < 0 ? <ArrowUpRight size={19} /> : amount > 0 ? <ArrowDownLeft size={19} /> : <Check size={19} />}</span><div className="entry-name"><strong>{nameOf(id)}</strong><span>{amount > 0 ? 'Doit recevoir' : amount < 0 ? 'Doit rembourser' : 'À l’équilibre'}</span></div><strong className={amount < 0 ? 'negative' : ''}>{amount > 0 ? '+' : ''}{money(amount)}</strong></li>)}</ul>
        </section></div>}
        {tab === 'members' && <section className="ledger" aria-labelledby="members-heading"><div className="section-header"><div><h2 id="members-heading">Participants du groupe</h2><p>Les personnes pour qui répartir les dépenses.</p></div>{!demo && <button className="button secondary" type="button" onClick={() => setModal({ type: 'member' })}><Plus size={16} /> Ajouter une personne</button>}</div>
          <ul className="entry-list">{group.members.map((m,i) => <li className="entry transfer" key={m.id}><Avatar member={m} index={i} /><div className="entry-name"><strong>{m.name}</strong></div></li>)}</ul>
        </section>}
      </>}
      <footer className="main-footer"><span>ocompte</span><span>Les bons comptes, ensemble.</span></footer>
    </main>
    {modal && <GroupDialogs key={modal.type} modal={modal} close={() => setModal(null)} group={group} create={create} mutate={mutate} invite={modal.type === 'share' ? `${window.location.origin}/#g=${liveToken}` : ''} />}
  </div>;
}

function Brand() { return <><span className="brand-mark" aria-hidden="true"><svg width="27" height="27" viewBox="0 0 28 28" fill="none"><path d="M6 8h16M6 14h16M6 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><circle cx="22" cy="20" r="1.5" fill="#d8e9b7"/></svg></span><span>ocompte<span className="brand-dot">.</span></span></>; }
function Avatar({ member, index }: { member: Member; index: number }) { return <span className={`avatar tone-${index % 5}`} title={member.name}>{initials(member.name)}</span>; }

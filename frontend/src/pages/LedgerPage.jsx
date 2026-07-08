import { useState, useEffect, useMemo } from 'react';
import api from '../lib/api';
import { useCurrency } from '../context/CurrencyContext';
import { useOrg } from '../context/OrgContext';

const API_BASE = import.meta.env.VITE_API_URL || 'https://xpensetrack-production.up.railway.app/api';
const BRAND = 'var(--brand-color,#1D9E75)';

const TYPE_LABEL = { AP_INVOICE: 'AP Invoice', AP_RECEIPT: 'AP Receipt', AR_INVOICE: 'AR Invoice' };
const TYPE_BADGE = {
  AP_INVOICE: 'bg-purple-50 text-purple-700',
  AP_RECEIPT: 'bg-indigo-50 text-indigo-700',
  AR_INVOICE: 'bg-teal-50 text-teal-700',
};
const STAGES = ['DRAFT', 'FOR_VERIFICATION', 'FOR_APPROVAL', 'PAID'];
const STATUS_LABEL = { DRAFT: 'Draft', PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', RETURNED: 'Returned', PROCESSED: 'Processed', FOR_VERIFICATION: 'For Verification', FOR_APPROVAL: 'For Approval', PAID: 'Paid' };
const STATUS_BADGE = {
  DRAFT: 'bg-gray-100 text-gray-600',
  PENDING: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-green-50 text-green-700',
  REJECTED: 'bg-red-50 text-red-700',
  RETURNED: 'bg-orange-50 text-orange-700',
  PROCESSED: 'bg-emerald-50 text-emerald-700',
  FOR_VERIFICATION: 'bg-blue-50 text-blue-700',
  FOR_APPROVAL: 'bg-amber-50 text-amber-700',
  PAID: 'bg-green-50 text-green-700',
};
const statusLabel = (s) => STATUS_LABEL[s] || s || '—';
const FREQ = [['ONE_TIME','One-time'],['WEEKLY','Weekly'],['MONTHLY','Monthly'],['QUARTERLY','Quarterly'],['ANNUALLY','Annually']];

const emptyDoc = (defaults = {}) => ({
  docType: 'AP_INVOICE', clientId: '', vendorName: '', vendorTin: '', businessStyle: '',
  docNumber: '', poNumber: '', docDate: '', dueDate: '', amount: '', currency: 'PHP',
  category: '', notes: '', remarks: '', assignedToId: '', status: 'DRAFT', frequency: 'ONE_TIME', receiptId: '', ...defaults,
});

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const initials = (u) => u ? `${(u.firstName || '')[0] || ''}${(u.lastName || '')[0] || ''}`.toUpperCase() : '';
const fullName = (u) => u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '';

export default function LedgerPage({ mode = 'manage' }) {
  const isAddMode = mode === 'add';
  const { format } = useCurrency();
  const { settings } = useOrg();
  const _catTypes = settings?.categoryTypes || {};
  const categories = (settings?.categories || []).filter(c => ['AP_AR','BOTH'].includes(_catTypes[c] || 'BOTH'));
  const vendors = Array.isArray(settings?.vendors) ? settings.vendors : [];
  const vendorNames = vendors.map(v => v.name);

  const [tab, setTab] = useState('ALL'); // ALL | AP_INVOICE | AP_RECEIPT | AR_INVOICE | ARCHIVED | CLIENTS
  const [docs, setDocs] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');

  const [sel, setSel] = useState(new Set());
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [bulk, setBulk] = useState(null);
  const [clientModal, setClientModal] = useState(null);
  const [assignModal, setAssignModal] = useState(null);
  const [statusModal, setStatusModal] = useState(null); // { ids:[...] } for bulk status change
  const [scanning, setScanning] = useState(false);
  const [dragging, setDragging] = useState(false);

  const isDocTab = !['CLIENTS'].includes(tab);
  const isArchived = tab === 'ARCHIVED';

  const loadClients = async () => { try { setClients(await api.get('/clients')); } catch { setClients([]); } };
  const loadUsers = async () => {
    try { const u = await api.get('/users'); setUsers((Array.isArray(u) ? u : (u.users || [])).filter(x => x.isActive !== false)); }
    catch { setUsers([]); }
  };

  const load = async () => {
    setLoading(true);
    setSel(new Set());
    try {
      const params = new URLSearchParams();
      if (!['ALL', 'CLIENTS', 'ARCHIVED'].includes(tab)) params.set('docType', tab);
      if (isArchived) params.set('archived', '1');
      if (clientFilter) params.set('clientId', clientFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (q.trim()) params.set('q', q.trim());
      const [d, s] = await Promise.all([
        api.get(`/ledger?${params.toString()}`),
        api.get(`/ledger/summary${clientFilter ? `?clientId=${clientFilter}` : ''}`).catch(() => null),
      ]);
      setDocs(Array.isArray(d) ? d : []);
      setSummary(s);
    } catch { setDocs([]); } finally { setLoading(false); }
  };

  useEffect(() => { loadClients(); loadUsers(); }, []);
  useEffect(() => { if (!isAddMode && tab !== 'CLIENTS') load(); /* eslint-disable-next-line */ }, [tab, clientFilter, statusFilter]);
  // In add mode the page IS the form — keep a fresh document loaded in it.
  useEffect(() => { if (isAddMode && !editing) setEditing(emptyDoc({ docType: 'AP_INVOICE', clientId: defaultClientId() })); /* eslint-disable-next-line */ }, [isAddMode, clients]);

  const defaultClientId = () => (clients.find(c => c.isDefault) || {}).id || '';
  const initAddForm = () => setEditing(emptyDoc({ docType: 'AP_INVOICE', clientId: defaultClientId() }));
  // After save/submit: in add mode reset to a fresh form; in manage mode close + reload.
  const afterSave = () => { if (isAddMode) initAddForm(); else { setEditing(null); load(); } };
  const cancelForm = () => { if (isAddMode) initAddForm(); else setEditing(null); };

  // ---- single doc ----
  const saveDoc = async () => {
    const f = editing;
    try {
      if (f.id) await api.patch(`/ledger/${f.id}`, f); else await api.post('/ledger', f);
      afterSave();
    } catch (err) { alert(err.error || 'Save failed'); }
  };
  const saveAndSubmitDoc = async () => {
    const f = editing;
    try {
      let id = f.id;
      if (id) await api.patch(`/ledger/${id}`, f);
      else { const created = await api.post('/ledger', f); id = created?.id; }
      if (!id) { afterSave(); alert('Saved, but could not submit automatically.'); return; }
      const r = await api.post(`/ledger/${id}/submit`);
      afterSave();
      alert(r?.doc?.status === 'APPROVED' ? 'Saved \u2014 auto-approved (no approver in the creator\u2019s flow).' : 'Saved & submitted for approval.');
    } catch (err) { alert(err.error || 'Failed'); }
  };
  const markPaid = async (doc) => {
    try { await api.post(`/ledger/${doc.id}/${doc.status === 'PAID' ? 'mark-unpaid' : 'mark-paid'}`); load(); }
    catch (err) { alert(err.error || 'Failed'); }
  };
  const submitDoc = async (doc) => {
    try { const r = await api.post(`/ledger/${doc.id}/submit`); setViewing(null); load(); alert(r?.doc?.status === 'APPROVED' ? 'Submitted — auto-approved (no approver in the creator\u2019s flow).' : 'Submitted for approval.'); }
    catch (err) { alert(err.error || 'Submit failed'); }
  };
  const archiveDoc = async (doc, archived) => {
    try { await api.patch(`/ledger/${doc.id}`, { archived }); load(); } catch (err) { alert(err.error || 'Failed'); }
  };
  const removeDoc = async (doc) => {
    if (!confirm('Delete this document permanently?')) return;
    try { await api.delete(`/ledger/${doc.id}`); load(); } catch (err) { alert(err.error || 'Failed'); }
  };

  // ---- OCR autofill (single) ----
  const scanInto = async (file) => {
    if (!file) return;
    setScanning(true);
    try {
      const fd = new FormData(); fd.append('receipt', file);
      const res = await api.post('/ocr/scan', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const p = res.parsed || {};
      setEditing(e => ({ ...e,
        vendorName: p.merchant || e.vendorName,
        amount: p.amount != null ? String(p.amount) : e.amount,
        docNumber: p.orNumber || e.docNumber,
        docDate: p.date ? String(p.date).slice(0, 10) : e.docDate,
        currency: p.currency || e.currency,
        category: p.category || e.category,
        receiptId: res.receiptId || e.receiptId,
      }));
    } catch (err) { alert(err.error || err.message || 'Scan failed'); }
    finally { setScanning(false); }
  };

  // Open the Add Document window and scan the picked/dropped file into it.
  const openDocWithScan = (files) => {
    const file = Array.from(files || [])[0];
    const dt = ['AP_INVOICE', 'AR_INVOICE'].includes(tab) ? tab : 'AP_INVOICE';
    setEditing(emptyDoc({ docType: dt, clientId: clientFilter || defaultClientId() }));
    if (file) scanInto(file);
  };

  // ---- bulk OCR upload (drop or pick) ----
  const startBulk = async (files) => {
    const list = Array.from(files || []).filter(f => f);
    if (!list.length) return;
    setBulk({ rows: [], uploading: true, done: 0, total: list.length });
    const rows = [];
    let done = 0;
    for (const file of list) {
      try {
        const fd = new FormData(); fd.append('receipt', file);
        const res = await api.post('/ocr/scan', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        const p = res.parsed || {};
        rows.push({ docType: tab === 'AR_INVOICE' ? 'AR_INVOICE' : (tab === 'AP_RECEIPT' ? 'AP_RECEIPT' : 'AP_INVOICE'),
          clientId: clientFilter || defaultClientId(), vendorName: p.merchant || '',
          amount: p.amount != null ? String(p.amount) : '', docNumber: p.orNumber || '',
          docDate: p.date ? String(p.date).slice(0, 10) : '', currency: p.currency || 'PHP',
          category: p.category || '', status: 'UNPAID', receiptId: res.receiptId || '', fileName: file.name });
      } catch {
        rows.push({ docType: 'AP_INVOICE', clientId: clientFilter || defaultClientId(), vendorName: '', amount: '', docNumber: '', docDate: '', currency: 'PHP', status: 'UNPAID', receiptId: '', fileName: file.name, failed: true });
      }
      done++;
      setBulk({ rows: [...rows], uploading: true, done, total: list.length });
    }
    setBulk({ rows, uploading: false });
  };
  const saveBulk = async () => {
    const valid = bulk.rows.filter(r => r.amount && Number(r.amount) > 0);
    if (!valid.length) { alert('Add an amount to at least one row.'); return; }
    try { await api.post('/ledger/bulk', { docs: valid }); setBulk(null); load(); }
    catch (err) { alert(err.error || 'Bulk save failed'); }
  };

  // ---- multi-select bulk actions ----
  const allVisibleIds = useMemo(() => docs.map(d => d.id), [docs]);
  const allSelected = sel.size > 0 && allVisibleIds.every(id => sel.has(id));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(allVisibleIds));
  const toggleOne = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bulkAction = async (action, assignedToId, status) => {
    const ids = [...sel];
    if (!ids.length) return;
    if (action === 'delete' && !confirm(`Delete ${ids.length} document(s)?`)) return;
    try { await api.post('/ledger/bulk-action', { ids, action, assignedToId, status }); setAssignModal(null); setStatusModal(null); load(); }
    catch (err) { alert(err.error || 'Failed'); }
  };

  // ---- clients ----
  const saveClient = async () => {
    const c = clientModal; if (!c.name?.trim()) { alert('Name required'); return; }
    try { if (c.id) await api.patch(`/clients/${c.id}`, { name: c.name, isDefault: c.isDefault }); else await api.post('/clients', { name: c.name, isDefault: c.isDefault }); setClientModal(null); loadClients(); }
    catch (err) { alert(err.error || 'Failed'); }
  };
  const removeClient = async (c) => {
    if (!confirm(`Delete client "${c.name}"? Its documents are kept but un-linked.`)) return;
    try { await api.delete(`/clients/${c.id}`); loadClients(); load(); } catch (err) { alert(err.error || 'Failed'); }
  };

  const tabs = [['ALL', 'All'], ['AP_INVOICE', 'AP Invoices'], ['AR_INVOICE', 'AR Invoices'], ['ARCHIVED', 'Archived'], ['CLIENTS', 'Clients']];

  // Shared document FIELDS — used inline on the "Add" page and inside the edit modal.
  const renderDocFields = () => {
    if (!editing) return null;
    const _vSel = vendors.find(v => v.name === editing.vendorName);
    const isGovt = (editing._vendorType || (_vSel && _vSel.type)) === 'GOVERNMENT';
    return (
      <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Type"><select value={editing.docType} onChange={(e) => setEditing({ ...editing, docType: e.target.value })} className="inp">
            <option value="AP_INVOICE">AP Invoice (payable)</option><option value="AR_INVOICE">AR Invoice (receivable)</option>
          </select></Field>
          <Field label="Frequency"><select value={editing.frequency || 'ONE_TIME'} onChange={(e) => setEditing({ ...editing, frequency: e.target.value })} className="inp">
            {FREQ.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></Field>
          <div className="sm:col-span-2"><Field label="Vendor / Payee">
            <select
              value={(editing._vendorOther || (editing.vendorName && !vendorNames.includes(editing.vendorName))) ? '__OTHER__' : (editing.vendorName || '')}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '__OTHER__') setEditing({ ...editing, _vendorOther: true, vendorName: '', vendorTin: '', _vendorType: 'COMPANY' });
                else { const v = vendors.find(x => x.name === val); setEditing({ ...editing, _vendorOther: false, vendorName: val, vendorTin: (v && v.tin) || '', _vendorType: (v && v.type) || 'COMPANY' }); }
              }}
              className="inp">
              <option value="">— select vendor / payee —</option>
              {vendors.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
              <option value="__OTHER__">Others (type manually)</option>
            </select>
            {(editing._vendorOther || (editing.vendorName && !vendorNames.includes(editing.vendorName))) && (
              <input className="inp mt-2" placeholder="Enter vendor / payee name" value={editing.vendorName}
                onChange={(e) => setEditing({ ...editing, _vendorOther: true, vendorName: e.target.value })} />
            )}
          </Field></div>
          {!isGovt && <Field label="Vendor TIN"><input className="inp" value={editing.vendorTin} onChange={(e) => setEditing({ ...editing, vendorTin: e.target.value })} /></Field>}
          {!isGovt && <Field label="Doc/Invoice number"><input className="inp" value={editing.docNumber} onChange={(e) => setEditing({ ...editing, docNumber: e.target.value })} /></Field>}
          {!isGovt && <Field label="PO number"><input className="inp" value={editing.poNumber} onChange={(e) => setEditing({ ...editing, poNumber: e.target.value })} /></Field>}
          <Field label="Category"><select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} className="inp">
            <option value="">—</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select></Field>
          <Field label="Document date"><input type="date" className="inp" value={editing.docDate} onChange={(e) => setEditing({ ...editing, docDate: e.target.value })} /></Field>
          <Field label="Due date"><input type="date" className="inp" value={editing.dueDate} onChange={(e) => setEditing({ ...editing, dueDate: e.target.value })} /></Field>
          <Field label="Amount"><div className="flex gap-1">
            <input type="number" step="0.01" className="inp" value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} />
            <select value={editing.currency} onChange={(e) => setEditing({ ...editing, currency: e.target.value })} className="inp w-20"><option>PHP</option><option>USD</option></select>
          </div></Field>
          <div className="sm:col-span-2"><Field label="Remarks"><input className="inp" value={editing.remarks} onChange={(e) => setEditing({ ...editing, remarks: e.target.value })} placeholder="Notes visible in the list" /></Field></div>
        </div>
        <p className="text-xs text-gray-400 mt-2">VAT (12% inclusive) is computed automatically from the amount.</p>
        {editing.receiptId && (
          <a href={`${API_BASE}/ocr/receipt/${editing.receiptId}?token=${encodeURIComponent(localStorage.getItem('token') || '')}`} target="_blank" rel="noreferrer" className="text-xs hover:underline mt-1 inline-block" style={{ color: BRAND }}>📎 View attached file</a>
        )}
      </>
    );
  };

  // ---- ADD MODE: form-first page — matches the Add Expense window (layout + buttons) ----
  if (isAddMode) {
    const hasFile = !!editing?.receiptId;
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-5">
          <h1 className="text-xl font-medium text-gray-900">Add AP &amp; AR invoice</h1>
          <p className="text-sm text-gray-500 mt-0.5">View all invoices in <span className="font-medium">My AP &amp; AR Invoices</span>.</p>
        </div>

        {/* Invoice / receipt (matches expense Receipt card) */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-medium text-gray-700">Invoice / receipt</h2>
            <span className="text-xs px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: BRAND }}>✨ AI auto-fill</span>
          </div>
          {hasFile ? (
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-green-700">{scanning ? '✨ Reading…' : '✓ File attached'}</p>
              <a href={`${API_BASE}/ocr/receipt/${editing.receiptId}?token=${encodeURIComponent(localStorage.getItem('token') || '')}`} target="_blank" rel="noreferrer" className="text-xs hover:underline" style={{ color: BRAND }}>View</a>
            </div>
          ) : (
            <label className="block w-full border-2 border-dashed border-gray-200 rounded-xl py-5 text-center hover:bg-gray-50 transition-colors cursor-pointer">
              <p className="text-xl mb-1">📷</p>
              <p className="text-sm font-medium text-gray-700">{scanning ? '✨ Reading…' : 'Scan or upload invoice'}</p>
              <p className="text-xs text-gray-400 mt-0.5">AI fills in the form automatically</p>
              <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" disabled={scanning}
                onChange={(e) => { scanInto(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          )}
        </div>

        {/* Details */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
          <fieldset disabled={scanning} className={scanning ? 'opacity-50 pointer-events-none' : ''}>
            {renderDocFields()}
          </fieldset>
        </div>

        <div className="flex gap-3">
          <button onClick={saveAndSubmitDoc}
            className="flex-1 py-2.5 text-white rounded-lg text-sm font-medium hover:opacity-90"
            style={{ backgroundColor: BRAND }}>📤 Submit for approval</button>
          <button onClick={saveDoc}
            className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">💾 Draft</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">My AP &amp; AR Invoices</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track vendor invoices &amp; receivables, submit for approval, and see what's paid.</p>
        </div>
        {isDocTab && !isArchived && (
          <button onClick={() => setEditing(emptyDoc({ clientId: clientFilter || defaultClientId(), docType: ['AP_INVOICE','AP_RECEIPT','AR_INVOICE'].includes(tab) ? tab : 'AP_INVOICE' }))}
            className="px-4 py-2.5 text-white rounded-xl text-sm font-medium shadow-sm hover:opacity-90 transition" style={{ backgroundColor: BRAND }}>
            + Add document
          </button>
        )}
      </div>

      {/* Drag & drop upload zone — opens the Add Document window with the file scanned in */}
      {isDocTab && !isArchived && (
        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); openDocWithScan(e.dataTransfer.files); }}
          className={`block mb-5 rounded-2xl border-2 border-dashed cursor-pointer transition-all text-center px-6 py-8 ${dragging ? 'bg-emerald-50 border-emerald-400 scale-[1.01]' : 'bg-white border-gray-200 hover:border-gray-300'}`}>
          <input type="file" accept="image/*,application/pdf" className="hidden"
            onChange={(e) => { openDocWithScan(e.target.files); e.target.value = ''; }} />
          <div className="text-3xl mb-1">🧾</div>
          <p className="text-sm font-medium text-gray-700">Drop an invoice &amp; receipt here, or <span style={{ color: BRAND }}>browse</span></p>
          <p className="text-xs text-gray-400 mt-1">PDF, PNG, JPEG up to ~10 MB · opens the Add Document window with details auto-filled</p>
        </label>
      )}

      {/* Totals */}
      {summary && isDocTab && !isArchived && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <SummaryCard label="Outstanding payables" value={format(summary.payablesOutstanding)} sub={`${summary.payablesOutstandingCount} unpaid`} accent="#b45309" />
          <SummaryCard label="Outstanding receivables" value={format(summary.receivablesOutstanding)} sub={`${summary.receivablesOutstandingCount} unpaid`} accent="#0f766e" />
          <SummaryCard label="Payables paid" value={format(summary.payablesPaid)} accent="#15803d" />
          <SummaryCard label="Receivables paid" value={format(summary.receivablesPaid)} accent="#15803d" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        {tabs.map(([val, label]) => (
          <button key={val} onClick={() => setTab(val)}
            className={`px-3.5 py-1.5 rounded-lg text-sm transition-colors ${tab === val ? 'text-white shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}
            style={tab === val ? { backgroundColor: BRAND } : {}}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'CLIENTS' ? (
        <ClientsView clients={clients} onAdd={() => setClientModal({ name: '', isDefault: false })}
          onEdit={(c) => setClientModal({ id: c.id, name: c.name, isDefault: c.isDefault })} onDelete={removeClient} />
      ) : (
        <>
          {/* Filters */}
          <div className="flex gap-2 mb-3 flex-wrap">
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()}
              placeholder="Search vendor / doc no / PO / TIN" className="px-3 py-2 border border-gray-200 rounded-lg text-sm flex-1 min-w-[200px]" />
            <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option value="">All clients</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {!isArchived && (
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                <option value="">All statuses</option>
                {STAGES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            )}
            <button onClick={load} className="px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Search</button>
          </div>

          {/* Bulk action bar */}
          {sel.size > 0 && (
            <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-gray-900 text-white text-sm flex-wrap">
              <span className="font-medium">{sel.size} selected</span>
              <span className="opacity-40">|</span>
              {!isArchived && <button onClick={() => setStatusModal({ ids: [...sel] })} className="hover:underline">Change status…</button>}
              <button onClick={() => setAssignModal({ ids: [...sel] })} className="hover:underline">Assign…</button>
              {isArchived
                ? <button onClick={() => bulkAction('unarchive')} className="hover:underline">Unarchive</button>
                : <button onClick={() => bulkAction('archive')} className="hover:underline">Archive</button>}
              <button onClick={() => bulkAction('delete')} className="hover:underline text-red-300">Delete</button>
              <button onClick={() => setSel(new Set())} className="ml-auto opacity-70 hover:opacity-100">Clear</button>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-gray-400 py-10 text-center">Loading…</p>
          ) : docs.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
              <div className="text-4xl mb-2">{isArchived ? '🗂️' : '📭'}</div>
              <p className="text-sm text-gray-500 font-medium">{isArchived ? 'Nothing archived here.' : 'No documents yet.'}</p>
              {!isArchived && <p className="text-xs text-gray-400 mt-1">Drop a file above or use “Add document”.</p>}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="pl-4 pr-1 py-3 w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
                    <th className="px-3 py-3">Vendor / Payee</th>
                    <th className="px-3 py-3">Type</th>
                    <th className="px-3 py-3">Doc no.</th>
                    <th className="px-3 py-3">Client</th>
                    <th className="px-3 py-3">Assigned</th>
                    <th className="px-3 py-3">Due</th>
                    <th className="px-3 py-3 text-right">Amount</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Last edit</th>
                    <th className="px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map(d => (
                    <tr key={d.id} className={`border-b border-gray-50 hover:bg-gray-50 ${sel.has(d.id) ? 'bg-emerald-50/40' : ''}`}>
                      <td className="pl-4 pr-1 py-3"><input type="checkbox" checked={sel.has(d.id)} onChange={() => toggleOne(d.id)} /></td>
                      <td className="px-3 py-3 font-medium text-gray-800">
                        {d.vendorName || '—'}{d.receipt && <span title="Has attachment" className="ml-1 text-gray-300">📎</span>}
                        {d.remarks && <span title={d.remarks} className="ml-1 text-amber-400">💬</span>}
                      </td>
                      <td className="px-3 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${TYPE_BADGE[d.docType]}`}>{TYPE_LABEL[d.docType]}</span></td>
                      <td className="px-3 py-3 text-gray-500">{d.docNumber || '—'}</td>
                      <td className="px-3 py-3 text-gray-500">{d.client?.name || '—'}</td>
                      <td className="px-3 py-3">
                        {d.assignedTo
                          ? <span title={fullName(d.assignedTo)} className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-medium text-white" style={{ backgroundColor: BRAND }}>{initials(d.assignedTo)}</span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-3 text-gray-500">{fmtDate(d.dueDate)}</td>
                      <td className="px-3 py-3 text-right font-medium text-gray-800">{format(d.amountPhp || 0)}</td>
                      <td className="px-3 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_BADGE[d.status] || 'bg-gray-100 text-gray-600'}`}>{statusLabel(d.status)}</span></td>
                      <td className="px-3 py-3 text-gray-500 text-xs">{d.lastEditedBy ? fullName(d.lastEditedBy) : '—'}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {!['PENDING','APPROVED','PROCESSED','PAID'].includes(d.status) && (
                          <button onClick={() => submitDoc(d)} title="Submit for approval"
                            className="text-xs font-medium mr-2 px-2 py-1 rounded-md text-white bg-brand-400 hover:bg-brand-600">Submit</button>
                        )}
                        <button onClick={() => setViewing(d)} title="View" className="text-base mr-1.5 hover:opacity-70">👁</button>
                        <button onClick={() => setEditing({
                          id: d.id, docType: d.docType, clientId: d.clientId || '', vendorName: d.vendorName || '',
                          vendorTin: d.vendorTin || '', businessStyle: d.businessStyle || '', docNumber: d.docNumber || '',
                          poNumber: d.poNumber || '', docDate: d.docDate ? d.docDate.slice(0, 10) : '', dueDate: d.dueDate ? d.dueDate.slice(0, 10) : '',
                          amount: String(d.amount ?? ''), currency: d.currency || 'PHP', category: d.category || '', notes: d.notes || '',
                          remarks: d.remarks || '', assignedToId: d.assignedToId || '', status: d.status, receiptId: d.receiptId || '',
                        })} title="Edit" className="text-base mr-1.5 hover:opacity-70">✏️</button>
                        {isArchived
                          ? <button onClick={() => archiveDoc(d, false)} className="text-xs text-gray-500 hover:underline mr-1.5">Unarchive</button>
                          : <button onClick={() => archiveDoc(d, true)} title="Archive" className="text-base mr-1.5 hover:opacity-70">🗄️</button>}
                        <button onClick={() => removeDoc(d)} title="Delete" className="text-base hover:opacity-70">🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Add/edit modal (manage mode only — in add mode the form is inline) */}
      {!isAddMode && editing && (
        <Modal title={editing.id ? 'Edit document' : 'Add document'} onClose={() => setEditing(null)}>
          {!editing.id && (
            <label className="block mb-3 px-3 py-2.5 border border-dashed border-gray-300 rounded-xl text-sm text-center cursor-pointer hover:bg-gray-50 text-gray-600">
              {scanning ? '✨ Reading…' : '📷 Scan a receipt/invoice to auto-fill'}
              <input type="file" accept="image/*,application/pdf" className="hidden" disabled={scanning}
                onChange={(e) => { scanInto(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          )}
          {renderDocFields()}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button onClick={saveDoc} className="px-4 py-2 text-sm rounded-lg font-medium border border-gray-200 text-gray-700 hover:bg-gray-50">Save</button>
            <button onClick={saveAndSubmitDoc} className="px-4 py-2 text-sm text-white rounded-lg font-medium" style={{ backgroundColor: BRAND }}>Submit for approval</button>
          </div>
        </Modal>
      )}

      {/* Bulk review modal */}
      {bulk && (
        <Modal title="Bulk upload — review" onClose={() => setBulk(null)} wide>
          {bulk.uploading ? (
            <div className="py-6 text-center">
              <p className="text-sm text-gray-600 mb-2">✨ Reading {bulk.done}/{bulk.total} file(s)…</p>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden max-w-xs mx-auto">
                <div className="h-full rounded-full transition-all" style={{ width: `${(bulk.done / bulk.total) * 100}%`, backgroundColor: BRAND }} />
              </div>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-400 mb-2">Review the extracted data, set type/client, then save. Rows without an amount are skipped.</p>
              <div className="overflow-x-auto max-h-[55vh]">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-gray-400 border-b">
                    <th className="p-2">File</th><th className="p-2">Type</th><th className="p-2">Client</th><th className="p-2">Vendor</th><th className="p-2">Doc no.</th><th className="p-2">Date</th><th className="p-2">Amount</th>
                  </tr></thead>
                  <tbody>
                    {bulk.rows.map((r, i) => (
                      <tr key={i} className={`border-b border-gray-50 ${r.failed ? 'bg-red-50' : ''}`}>
                        <td className="p-2 text-gray-400 max-w-[120px] truncate" title={r.fileName}>{r.fileName}</td>
                        <td className="p-2"><select value={r.docType} onChange={(e) => setBulk(b => ({ ...b, rows: b.rows.map((x, j) => j === i ? { ...x, docType: e.target.value } : x) }))} className="border rounded p-1"><option value="AP_INVOICE">AP Inv</option><option value="AP_RECEIPT">AP Rcpt</option><option value="AR_INVOICE">AR Inv</option></select></td>
                        <td className="p-2"><select value={r.clientId} onChange={(e) => setBulk(b => ({ ...b, rows: b.rows.map((x, j) => j === i ? { ...x, clientId: e.target.value } : x) }))} className="border rounded p-1"><option value="">—</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                        <td className="p-2"><input value={r.vendorName} onChange={(e) => setBulk(b => ({ ...b, rows: b.rows.map((x, j) => j === i ? { ...x, vendorName: e.target.value } : x) }))} className="border rounded p-1 w-28" /></td>
                        <td className="p-2"><input value={r.docNumber} onChange={(e) => setBulk(b => ({ ...b, rows: b.rows.map((x, j) => j === i ? { ...x, docNumber: e.target.value } : x) }))} className="border rounded p-1 w-24" /></td>
                        <td className="p-2"><input type="date" value={r.docDate} onChange={(e) => setBulk(b => ({ ...b, rows: b.rows.map((x, j) => j === i ? { ...x, docDate: e.target.value } : x) }))} className="border rounded p-1" /></td>
                        <td className="p-2"><input type="number" step="0.01" value={r.amount} onChange={(e) => setBulk(b => ({ ...b, rows: b.rows.map((x, j) => j === i ? { ...x, amount: e.target.value } : x) }))} className="border rounded p-1 w-24" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setBulk(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={saveBulk} className="px-4 py-2 text-sm text-white rounded-lg font-medium" style={{ backgroundColor: BRAND }}>Save all</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* View (read-only) modal */}
      {viewing && (
        <Modal title="Document details" onClose={() => setViewing(null)} wide>
          <div className="flex items-center gap-2 mb-3">
            <span className={`px-2 py-0.5 rounded-full text-xs ${TYPE_BADGE[viewing.docType]}`}>{TYPE_LABEL[viewing.docType]}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_BADGE[viewing.status] || 'bg-gray-100 text-gray-600'}`}>{statusLabel(viewing.status)}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <ViewRow label="Vendor / Payee" value={viewing.vendorName} />
            <ViewRow label="Client" value={viewing.client?.name} />
            <ViewRow label="Vendor TIN" value={viewing.vendorTin} />
            <ViewRow label="Business style" value={viewing.businessStyle} />
            <ViewRow label="Doc/Invoice number" value={viewing.docNumber} />
            <ViewRow label="PO number" value={viewing.poNumber} />
            <ViewRow label="Document date" value={fmtDate(viewing.docDate)} />
            <ViewRow label="Due date" value={fmtDate(viewing.dueDate)} />
            <ViewRow label="Amount" value={format(viewing.amountPhp || 0)} />
            <ViewRow label="VATable / VAT" value={`${format(viewing.vatableAmount || 0)} / ${format(viewing.vatAmount || 0)}`} />
            <ViewRow label="Category" value={viewing.category} />
            <ViewRow label="Assigned to" value={fullName(viewing.assignedTo)} />
            <ViewRow label="Created by" value={fullName(viewing.createdBy)} />
            <ViewRow label="Last edited by" value={fullName(viewing.lastEditedBy)} />
            <div className="col-span-2"><ViewRow label="Remarks" value={viewing.remarks} /></div>
            <div className="col-span-2"><ViewRow label="Notes" value={viewing.notes} /></div>
          </div>
          {viewing.receiptId && (
            <a href={`${API_BASE}/ocr/receipt/${viewing.receiptId}?token=${encodeURIComponent(localStorage.getItem('token') || '')}`} target="_blank" rel="noreferrer" className="text-xs hover:underline mt-3 inline-block" style={{ color: BRAND }}>📎 View attached file</a>
          )}
          <div className="flex justify-end gap-2 mt-4">
            {!['PENDING','APPROVED','PROCESSED','PAID'].includes(viewing.status) && (
              <button onClick={() => submitDoc(viewing)} className="px-4 py-2 text-sm text-white rounded-lg font-medium bg-brand-400 hover:bg-brand-600">Submit for approval</button>
            )}
            <button onClick={() => { const d = viewing; setViewing(null); setEditing({
              id: d.id, docType: d.docType, clientId: d.clientId || '', vendorName: d.vendorName || '', vendorTin: d.vendorTin || '',
              businessStyle: d.businessStyle || '', docNumber: d.docNumber || '', poNumber: d.poNumber || '',
              docDate: d.docDate ? d.docDate.slice(0, 10) : '', dueDate: d.dueDate ? d.dueDate.slice(0, 10) : '', amount: String(d.amount ?? ''),
              currency: d.currency || 'PHP', category: d.category || '', notes: d.notes || '', remarks: d.remarks || '',
              assignedToId: d.assignedToId || '', status: d.status, receiptId: d.receiptId || '',
            }); }} className="px-4 py-2 text-sm text-white rounded-lg font-medium" style={{ backgroundColor: BRAND }}>Edit</button>
            <button onClick={() => setViewing(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Close</button>
          </div>
        </Modal>
      )}

      {/* Bulk change-status modal */}
      {statusModal && (
        <Modal title={`Change status · ${statusModal.ids.length} document(s)`} onClose={() => setStatusModal(null)}>
          <Field label="Set status to">
            <select id="bulk-status" className="inp" defaultValue="FOR_APPROVAL">
              {STAGES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setStatusModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button onClick={() => bulkAction('status', null, document.getElementById('bulk-status').value)} className="px-4 py-2 text-sm text-white rounded-lg font-medium" style={{ backgroundColor: BRAND }}>Apply</button>
          </div>
        </Modal>
      )}

      {/* Bulk assign modal */}
      {assignModal && (
        <Modal title={`Assign ${assignModal.ids.length} document(s)`} onClose={() => setAssignModal(null)}>
          <Field label="Assign to">
            <select id="bulk-assign-user" className="inp" defaultValue="">
              <option value="">— unassigned —</option>{users.map(u => <option key={u.id} value={u.id}>{fullName(u)}</option>)}
            </select>
          </Field>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setAssignModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button onClick={() => bulkAction('assign', document.getElementById('bulk-assign-user').value || null)} className="px-4 py-2 text-sm text-white rounded-lg font-medium" style={{ backgroundColor: BRAND }}>Assign</button>
          </div>
        </Modal>
      )}

      {/* Client modal */}
      {clientModal && (
        <Modal title={clientModal.id ? 'Edit client' : 'Add client'} onClose={() => setClientModal(null)}>
          <Field label="Client name"><input className="inp" value={clientModal.name} onChange={(e) => setClientModal({ ...clientModal, name: e.target.value })} /></Field>
          <label className="flex items-center gap-2 mt-3 text-sm text-gray-600"><input type="checkbox" checked={!!clientModal.isDefault} onChange={(e) => setClientModal({ ...clientModal, isDefault: e.target.checked })} /> Set as default client</label>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setClientModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button onClick={saveClient} className="px-4 py-2 text-sm text-white rounded-lg font-medium" style={{ backgroundColor: BRAND }}>Save</button>
          </div>
        </Modal>
      )}

      <style>{`.inp{width:100%;padding:0.5rem 0.625rem;border:1px solid #e5e7eb;border-radius:0.5rem;font-size:0.875rem}`}</style>
    </div>
  );
}

function SummaryCard({ label, value, sub, accent }) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100">
      <div className="flex items-center gap-1.5 mb-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: accent }} /><p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p></div>
      <p className="text-xl font-semibold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}
function Field({ label, children }) { return (<div><label className="text-xs text-gray-500 block mb-1">{label}</label>{children}</div>); }
function ViewRow({ label, value }) { return (<div><p className="text-xs text-gray-400">{label}</p><p className="text-gray-800">{value || '—'}</p></div>); }
function Modal({ title, children, onClose, wide }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl p-5 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">{title}</h3><button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg">✕</button></div>
        {children}
      </div>
    </div>
  );
}
function ClientsView({ clients, onAdd, onEdit, onDelete }) {
  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="flex justify-between items-center p-4 border-b border-gray-100">
        <p className="text-sm font-medium text-gray-700">Clients</p>
        <button onClick={onAdd} className="px-3 py-1.5 text-white rounded-lg text-sm font-medium" style={{ backgroundColor: BRAND }}>+ Add client</button>
      </div>
      {clients.length === 0 ? <p className="text-sm text-gray-400 p-10 text-center">No clients yet.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100"><th className="px-4 py-3">Name</th><th className="px-4 py-3">Default</th><th className="px-4 py-3">Documents</th><th className="px-4 py-3">Last activity</th><th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {clients.map(c => (
              <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                <td className="px-4 py-3">{c.isDefault ? <span className="text-green-600">✓</span> : ''}</td>
                <td className="px-4 py-3 text-gray-500">{c.docCount}</td>
                <td className="px-4 py-3 text-gray-500">{fmt(c.lastActivity)}</td>
                <td className="px-4 py-3 text-right"><button onClick={() => onEdit(c)} className="text-xs text-gray-500 hover:underline mr-2">Edit</button><button onClick={() => onDelete(c)} className="text-xs text-red-400 hover:underline">Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

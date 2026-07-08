import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import ReceiptImage from '../components/ReceiptImage';
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
  const navigate = useNavigate();
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

  // ---- MANAGE MODE: list + detail panel, mirroring My Expenses ----
  const typeTabs = [['ALL', 'All'], ['AP_INVOICE', 'AP (payables)'], ['AR_INVOICE', 'AR (receivables)']];
  const statusTabs = [['', 'All'], ['DRAFT', 'Drafts'], ['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['RETURNED', 'Returned'], ['REJECTED', 'Rejected'], ['PROCESSED', 'Processed']];
  const openEdit = (d) => setEditing({
    id: d.id, docType: d.docType, clientId: d.clientId || '', vendorName: d.vendorName || '', vendorTin: d.vendorTin || '',
    businessStyle: d.businessStyle || '', docNumber: d.docNumber || '', poNumber: d.poNumber || '',
    docDate: d.docDate ? d.docDate.slice(0, 10) : '', dueDate: d.dueDate ? d.dueDate.slice(0, 10) : '', amount: String(d.amount ?? ''),
    currency: d.currency || 'PHP', category: d.category || '', notes: d.notes || '', remarks: d.remarks || '',
    assignedToId: d.assignedToId || '', status: d.status, receiptId: d.receiptId || '', frequency: d.frequency || 'ONE_TIME',
  });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-medium text-gray-900">My AP &amp; AR invoices</h1>
        <button onClick={() => navigate('/payables')}
          className="px-3 py-2 text-white rounded-lg text-sm font-medium hover:opacity-90" style={{ backgroundColor: BRAND }}>
          + Add AP &amp; AR invoice
        </button>
      </div>

      {/* Type toggle (mirrors the scope toggle in My Expenses) */}
      <div className="flex gap-1 mb-3 bg-gray-100 rounded-lg p-1 w-fit">
        {typeTabs.map(([val, label]) => (
          <button key={val} onClick={() => { setTab(val); setViewing(null); }}
            className={`px-3 py-1.5 rounded-md text-xs transition-colors ${tab === val ? 'text-white shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}
            style={tab === val ? { backgroundColor: BRAND } : {}}>
            {label}
          </button>
        ))}
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit flex-wrap">
        {statusTabs.map(([val, label]) => (
          <button key={label} onClick={() => setStatusFilter(val)}
            className={`px-3 py-1.5 rounded-md text-xs transition-colors ${statusFilter === val ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* List */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-sm text-gray-400">Loading...</div>
          ) : docs.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-gray-400 text-sm">No invoices found.</p>
              <button onClick={() => navigate('/payables')} className="mt-2 text-sm hover:opacity-70" style={{ color: BRAND }}>Add AP &amp; AR invoice →</button>
            </div>
          ) : (
            <div>
              {docs.map(d => (
                <div key={d.id} onClick={() => setViewing(viewing?.id === d.id ? null : d)}
                  className={`flex items-center gap-3 px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${viewing?.id === d.id ? 'border-l-4' : 'border-l-4 border-l-transparent'}`}
                  style={viewing?.id === d.id ? { borderLeftColor: '#1D9E75', backgroundColor: 'rgba(29,158,117,0.12)' } : {}}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{d.vendorName || '—'}</p>
                    {d.docNumber && <p className="text-xs text-gray-400">Doc/Invoice: {d.docNumber}</p>}
                    <p className="text-xs text-gray-400 mt-0.5">{fmtDate(d.docDate)} · {(d.category || '').toLowerCase() || '—'}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium text-gray-900">{format(d.amountPhp || 0)}</p>
                    <div className="flex items-center gap-1 justify-end mt-0.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[d.docType]}`}>{d.docType === 'AR_INVOICE' ? 'AR' : 'AP'}</span>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[d.status] || 'bg-gray-100 text-gray-600'}`}>{statusLabel(d.status)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {viewing ? (
          <>
            <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setViewing(null)} />
            <div className="bg-white border border-gray-100 p-4 z-50 fixed bottom-0 left-0 right-0 rounded-t-2xl max-h-[85vh] overflow-y-auto lg:static lg:rounded-xl lg:max-h-none lg:h-fit lg:overflow-visible lg:z-auto">
              <div className="flex items-start justify-between mb-3">
                <h2 className="text-sm font-medium text-gray-900">{viewing.vendorName || 'Invoice'}</h2>
                <button onClick={() => setViewing(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[viewing.docType]}`}>{TYPE_LABEL[viewing.docType]}</span>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[viewing.status] || 'bg-gray-100 text-gray-600'}`}>{statusLabel(viewing.status)}</span>
              </div>

              <div className="space-y-2 text-xs mb-4">
                <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="font-medium">{format(viewing.amountPhp || 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">VATable / VAT</span><span>{format(viewing.vatableAmount || 0)} / {format(viewing.vatAmount || 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Document date</span><span>{fmtDate(viewing.docDate)}</span></div>
                {viewing.dueDate && <div className="flex justify-between"><span className="text-gray-500">Due date</span><span>{fmtDate(viewing.dueDate)}</span></div>}
                <div className="flex justify-between"><span className="text-gray-500">Category</span><span>{viewing.category || '—'}</span></div>
                {viewing.vendorTin && <div className="flex justify-between"><span className="text-gray-500">Vendor TIN</span><span>{viewing.vendorTin}</span></div>}
                {viewing.docNumber && <div className="flex justify-between"><span className="text-gray-500">Doc/Invoice no.</span><span>{viewing.docNumber}</span></div>}
                {viewing.poNumber && <div className="flex justify-between"><span className="text-gray-500">PO no.</span><span>{viewing.poNumber}</span></div>}
                <div className="flex justify-between"><span className="text-gray-500">Created by</span><span>{fullName(viewing.createdBy) || '—'}</span></div>
              </div>

              {viewing.remarks && (<div className="bg-gray-50 rounded-lg p-2 text-xs text-gray-600 mb-3">{viewing.remarks}</div>)}

              {viewing.approvals?.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Approval Trail</p>
                  <div className="space-y-2">
                    {[...viewing.approvals].sort((a, b) => (a.stepOrder || a.level || 0) - (b.stepOrder || b.level || 0)).map((a, i) => {
                      const isApproved = a.status === 'APPROVED';
                      const isReturned = a.status === 'REJECTED' && (a.notes || '').startsWith('[RETURNED]');
                      const isRejected = a.status === 'REJECTED' && !isReturned;
                      const isPending = a.status === 'PENDING';
                      const accent = isApproved ? '#16a34a' : isReturned ? '#d97706' : isPending ? '#64748b' : '#dc2626';
                      const cleanNote = (a.notes || '').startsWith('[auto]') ? '' : (a.notes || '').replace(/^\[RETURNED\]\s*/, '');
                      return (
                        <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg border"
                          style={{
                            backgroundColor: isApproved ? 'rgba(22,163,74,0.12)' : isReturned ? 'rgba(217,119,6,0.12)' : isPending ? 'rgba(148,163,184,0.12)' : 'rgba(220,38,38,0.12)',
                            borderColor: isApproved ? 'rgba(22,163,74,0.35)' : isReturned ? 'rgba(217,119,6,0.35)' : isPending ? 'rgba(148,163,184,0.35)' : 'rgba(220,38,38,0.35)',
                          }}>
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold mt-0.5 shrink-0 text-white" style={{ backgroundColor: accent }}>
                            {isApproved ? '✓' : isReturned ? '↩' : isRejected ? '✗' : '⌛'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold">{fullName(a.approver) || '—'}</p>
                            <p className="text-xs font-semibold" style={{ color: accent }}>
                              {isApproved ? 'Approved' : isReturned ? 'Returned' : isRejected ? 'Rejected' : 'Pending approval'}
                            </p>
                            {cleanNote && <p className="text-sm mt-1 font-medium" style={{ color: accent }}>"{cleanNote}"</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {viewing.receiptId && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-gray-500 mb-1.5">Uploaded invoice</p>
                  <ReceiptImage receiptId={viewing.receiptId} className="w-full max-h-56 object-contain" />
                </div>
              )}

              <div className="flex flex-col gap-2 border-t border-gray-50 pt-3">
                {!['PENDING', 'APPROVED', 'PROCESSED', 'PAID'].includes(viewing.status) && (
                  <button onClick={() => submitDoc(viewing)} className="w-full py-2 text-white rounded-lg text-xs font-medium hover:opacity-90" style={{ backgroundColor: BRAND }}>📤 Submit for approval</button>
                )}
                <button onClick={() => { const d = viewing; setViewing(null); openEdit(d); }} className="w-full py-2 border border-gray-200 text-gray-700 rounded-lg text-xs hover:bg-gray-50">✏️ Edit</button>
                {['DRAFT', 'RETURNED', 'REJECTED'].includes(viewing.status) && (
                  <button onClick={() => { removeDoc(viewing); setViewing(null); }} className="w-full py-2 border border-red-100 text-red-600 rounded-lg text-xs hover:bg-red-50">🗑️ Delete permanently</button>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="hidden lg:flex bg-gray-50 rounded-xl border border-gray-100 p-4 items-center justify-center h-32">
            <p className="text-xs text-gray-400 text-center">Click an invoice to see details and actions</p>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <Modal title={editing.id ? 'Edit invoice' : 'Add invoice'} onClose={() => setEditing(null)}>
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

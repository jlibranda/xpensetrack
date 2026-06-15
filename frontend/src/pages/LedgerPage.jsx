import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useCurrency } from '../context/CurrencyContext';
import { useOrg } from '../context/OrgContext';

const API_BASE = import.meta.env.VITE_API_URL || 'https://xpensetrack-production.up.railway.app/api';

const TYPE_LABEL = { AP_INVOICE: 'AP Invoice', AP_RECEIPT: 'AP Receipt', AR_INVOICE: 'AR Invoice' };
const TYPE_BADGE = {
  AP_INVOICE: 'bg-purple-50 text-purple-700',
  AP_RECEIPT: 'bg-indigo-50 text-indigo-700',
  AR_INVOICE: 'bg-teal-50 text-teal-700',
};
const STATUS_BADGE = { UNPAID: 'bg-amber-50 text-amber-700', PAID: 'bg-green-50 text-green-700' };

const emptyDoc = (defaults = {}) => ({
  docType: 'AP_INVOICE', clientId: '', vendorName: '', vendorTin: '', businessStyle: '',
  docNumber: '', poNumber: '', docDate: '', dueDate: '', amount: '', currency: 'PHP',
  category: '', notes: '', status: 'UNPAID', receiptId: '', ...defaults,
});

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export default function LedgerPage() {
  const { format } = useCurrency();
  const { settings } = useOrg();
  const categories = settings?.categories || [];

  const [tab, setTab] = useState('ALL'); // ALL | AP_INVOICE | AP_RECEIPT | AR_INVOICE | CLIENTS
  const [docs, setDocs] = useState([]);
  const [clients, setClients] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  // filters
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');

  // modals
  const [editing, setEditing] = useState(null); // doc form object (with optional id)
  const [bulk, setBulk] = useState(null);       // { rows: [...] }
  const [clientModal, setClientModal] = useState(null); // { name, isDefault, id? }

  const loadClients = async () => {
    try { setClients(await api.get('/clients')); } catch { setClients([]); }
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (tab !== 'ALL' && tab !== 'CLIENTS') params.set('docType', tab);
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

  useEffect(() => { loadClients(); }, []);
  useEffect(() => { if (tab !== 'CLIENTS') load(); }, [tab, clientFilter, statusFilter]);

  const defaultClientId = () => (clients.find(c => c.isDefault) || {}).id || '';

  // ---- single doc save ----
  const saveDoc = async () => {
    const f = editing;
    try {
      if (f.id) await api.patch(`/ledger/${f.id}`, f);
      else await api.post('/ledger', f);
      setEditing(null);
      load();
    } catch (err) { alert(err.error || 'Save failed'); }
  };

  const markPaid = async (doc) => {
    try { await api.post(`/ledger/${doc.id}/${doc.status === 'PAID' ? 'mark-unpaid' : 'mark-paid'}`); load(); }
    catch (err) { alert(err.error || 'Failed'); }
  };

  const removeDoc = async (doc) => {
    if (!confirm('Delete this document?')) return;
    try { await api.delete(`/ledger/${doc.id}`); load(); } catch (err) { alert(err.error || 'Failed'); }
  };

  // ---- OCR autofill for single add ----
  const [scanning, setScanning] = useState(false);
  const scanInto = async (file) => {
    if (!file) return;
    setScanning(true);
    try {
      const fd = new FormData();
      fd.append('receipt', file);
      const res = await api.post('/ocr/scan', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const p = res.parsed || {};
      setEditing(e => ({
        ...e,
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

  // ---- bulk upload ----
  const startBulk = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setBulk({ rows: [], uploading: true });
    const rows = [];
    for (const file of list) {
      try {
        const fd = new FormData();
        fd.append('receipt', file);
        const res = await api.post('/ocr/scan', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        const p = res.parsed || {};
        rows.push({
          docType: 'AP_INVOICE', clientId: defaultClientId(),
          vendorName: p.merchant || '', amount: p.amount != null ? String(p.amount) : '',
          docNumber: p.orNumber || '', docDate: p.date ? String(p.date).slice(0, 10) : '',
          currency: p.currency || 'PHP', category: p.category || '', status: 'UNPAID',
          receiptId: res.receiptId || '', fileName: file.name,
        });
      } catch {
        rows.push({ docType: 'AP_INVOICE', clientId: defaultClientId(), vendorName: '', amount: '', docNumber: '', docDate: '', currency: 'PHP', status: 'UNPAID', receiptId: '', fileName: file.name, failed: true });
      }
      setBulk({ rows: [...rows], uploading: true });
    }
    setBulk({ rows, uploading: false });
  };

  const saveBulk = async () => {
    const valid = bulk.rows.filter(r => r.amount && Number(r.amount) > 0);
    if (!valid.length) { alert('Add an amount to at least one row.'); return; }
    try {
      await api.post('/ledger/bulk', { docs: valid });
      setBulk(null);
      load();
    } catch (err) { alert(err.error || 'Bulk save failed'); }
  };

  // ---- clients ----
  const saveClient = async () => {
    const c = clientModal;
    if (!c.name?.trim()) { alert('Name required'); return; }
    try {
      if (c.id) await api.patch(`/clients/${c.id}`, { name: c.name, isDefault: c.isDefault });
      else await api.post('/clients', { name: c.name, isDefault: c.isDefault });
      setClientModal(null);
      loadClients();
    } catch (err) { alert(err.error || 'Failed'); }
  };
  const removeClient = async (c) => {
    if (!confirm(`Delete client "${c.name}"? Its documents will be kept but un-linked.`)) return;
    try { await api.delete(`/clients/${c.id}`); loadClients(); load(); } catch (err) { alert(err.error || 'Failed'); }
  };

  const tabs = [['ALL', 'All'], ['AP_INVOICE', 'AP Invoices'], ['AP_RECEIPT', 'AP Receipts'], ['AR_INVOICE', 'AR Invoices'], ['CLIENTS', 'Clients']];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Payables &amp; Receivables</h1>
          <p className="text-sm text-gray-500">Upload vendor invoices &amp; receipts and track what's paid.</p>
        </div>
        {tab !== 'CLIENTS' && (
          <div className="flex gap-2">
            <label className="px-3 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">
              ⬆ Bulk upload
              <input type="file" accept="image/*,application/pdf" multiple className="hidden"
                onChange={(e) => { startBulk(e.target.files); e.target.value = ''; }} />
            </label>
            <button onClick={() => setEditing(emptyDoc({ clientId: defaultClientId() }))}
              className="px-4 py-2 text-white rounded-lg text-sm font-medium hover:opacity-90"
              style={{ backgroundColor: 'var(--brand-color,#1D9E75)' }}>+ Add document</button>
          </div>
        )}
      </div>

      {/* Totals */}
      {summary && tab !== 'CLIENTS' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Outstanding payables</p>
            <p className="text-xl font-medium text-gray-900">{format(summary.payablesOutstanding)}</p>
            <p className="text-xs text-gray-400">{summary.payablesOutstandingCount} unpaid</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Outstanding receivables</p>
            <p className="text-xl font-medium text-gray-900">{format(summary.receivablesOutstanding)}</p>
            <p className="text-xs text-gray-400">{summary.receivablesOutstandingCount} unpaid</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Payables paid</p>
            <p className="text-xl font-medium text-gray-900">{format(summary.payablesPaid)}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Receivables paid</p>
            <p className="text-xl font-medium text-gray-900">{format(summary.receivablesPaid)}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit flex-wrap">
        {tabs.map(([val, label]) => (
          <button key={val} onClick={() => setTab(val)}
            className={`px-3 py-1.5 rounded-md text-sm transition-colors ${tab === val ? 'text-white shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}
            style={tab === val ? { backgroundColor: 'var(--brand-color,#1D9E75)' } : {}}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'CLIENTS' ? (
        <ClientsView clients={clients} onAdd={() => setClientModal({ name: '', isDefault: false })}
          onEdit={(c) => setClientModal({ id: c.id, name: c.name, isDefault: c.isDefault })}
          onDelete={removeClient} fmtDate={fmtDate} />
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
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option value="">All statuses</option>
              <option value="UNPAID">Unpaid</option>
              <option value="PAID">Paid</option>
            </select>
            <button onClick={load} className="px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Search</button>
          </div>

          {loading ? (
            <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
          ) : docs.length === 0 ? (
            <div className="bg-white rounded-xl p-10 text-center border border-gray-100">
              <p className="text-sm text-gray-400">No documents yet.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="px-4 py-3">Vendor / Payee</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Doc no.</th>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Due</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map(d => (
                    <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{d.vendorName || '—'}{d.receipt && <span title="Has attachment" className="ml-1 text-gray-300">📎</span>}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${TYPE_BADGE[d.docType]}`}>{TYPE_LABEL[d.docType]}</span></td>
                      <td className="px-4 py-3 text-gray-500">{d.docNumber || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{d.client?.name || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{fmtDate(d.dueDate)}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-800">{format(d.amountPhp || 0)}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_BADGE[d.status]}`}>{d.status === 'PAID' ? '✓ Paid' : 'Unpaid'}</span></td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => markPaid(d)} className="text-xs text-brand-600 hover:underline mr-2">{d.status === 'PAID' ? 'Mark unpaid' : 'Mark paid'}</button>
                        <button onClick={() => setEditing({
                          id: d.id, docType: d.docType, clientId: d.clientId || '', vendorName: d.vendorName || '',
                          vendorTin: d.vendorTin || '', businessStyle: d.businessStyle || '', docNumber: d.docNumber || '',
                          poNumber: d.poNumber || '', docDate: d.docDate ? d.docDate.slice(0, 10) : '', dueDate: d.dueDate ? d.dueDate.slice(0, 10) : '',
                          amount: String(d.amount ?? ''), currency: d.currency || 'PHP', category: d.category || '', notes: d.notes || '',
                          status: d.status, receiptId: d.receiptId || '',
                        })} className="text-xs text-gray-500 hover:underline mr-2">Edit</button>
                        <button onClick={() => removeDoc(d)} className="text-xs text-red-400 hover:underline">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Add / edit document modal */}
      {editing && (
        <Modal title={editing.id ? 'Edit document' : 'Add document'} onClose={() => setEditing(null)}>
          {!editing.id && (
            <label className="block mb-3 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-center cursor-pointer hover:bg-gray-50 text-gray-600">
              {scanning ? '✨ Reading…' : '📷 Scan a receipt/invoice to auto-fill'}
              <input type="file" accept="image/*,application/pdf" className="hidden" disabled={scanning}
                onChange={(e) => { scanInto(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select value={editing.docType} onChange={(e) => setEditing({ ...editing, docType: e.target.value })} className="inp">
                <option value="AP_INVOICE">AP Invoice (payable)</option>
                <option value="AP_RECEIPT">AP Receipt (payable)</option>
                <option value="AR_INVOICE">AR Invoice (receivable)</option>
              </select>
            </Field>
            <Field label="Client">
              <select value={editing.clientId} onChange={(e) => setEditing({ ...editing, clientId: e.target.value })} className="inp">
                <option value="">— none —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Vendor / Payee"><input className="inp" value={editing.vendorName} onChange={(e) => setEditing({ ...editing, vendorName: e.target.value })} /></Field>
            <Field label="Vendor TIN"><input className="inp" value={editing.vendorTin} onChange={(e) => setEditing({ ...editing, vendorTin: e.target.value })} /></Field>
            <Field label="Business style"><input className="inp" value={editing.businessStyle} onChange={(e) => setEditing({ ...editing, businessStyle: e.target.value })} /></Field>
            <Field label="Doc / OR number"><input className="inp" value={editing.docNumber} onChange={(e) => setEditing({ ...editing, docNumber: e.target.value })} /></Field>
            <Field label="PO number"><input className="inp" value={editing.poNumber} onChange={(e) => setEditing({ ...editing, poNumber: e.target.value })} /></Field>
            <Field label="Category">
              <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} className="inp">
                <option value="">—</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Document date"><input type="date" className="inp" value={editing.docDate} onChange={(e) => setEditing({ ...editing, docDate: e.target.value })} /></Field>
            <Field label="Due date"><input type="date" className="inp" value={editing.dueDate} onChange={(e) => setEditing({ ...editing, dueDate: e.target.value })} /></Field>
            <Field label="Amount">
              <div className="flex gap-1">
                <input type="number" step="0.01" className="inp" value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} />
                <select value={editing.currency} onChange={(e) => setEditing({ ...editing, currency: e.target.value })} className="inp w-20">
                  <option>PHP</option><option>USD</option>
                </select>
              </div>
            </Field>
            <Field label="Status">
              <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })} className="inp">
                <option value="UNPAID">Unpaid</option>
                <option value="PAID">Paid</option>
              </select>
            </Field>
            <div className="col-span-2">
              <Field label="Notes"><input className="inp" value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">VAT (12% inclusive) is computed automatically from the amount.</p>
          {editing.receiptId && (
            <a href={`${API_BASE}/ocr/receipt/${editing.receiptId}?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
              target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline mt-1 inline-block">📎 View attached file</a>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button onClick={saveDoc} className="px-4 py-2 text-sm text-white rounded-lg font-medium" style={{ backgroundColor: 'var(--brand-color,#1D9E75)' }}>Save</button>
          </div>
        </Modal>
      )}

      {/* Bulk review modal */}
      {bulk && (
        <Modal title="Bulk upload — review" onClose={() => setBulk(null)} wide>
          {bulk.uploading ? (
            <p className="text-sm text-gray-500 py-4">✨ Scanning {bulk.rows.length} file(s)…</p>
          ) : (
            <>
              <p className="text-xs text-gray-400 mb-2">Review the extracted data, set the type/client, then save. Rows without an amount are skipped.</p>
              <div className="overflow-x-auto max-h-[55vh]">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-gray-400 border-b">
                    <th className="p-2">File</th><th className="p-2">Type</th><th className="p-2">Client</th><th className="p-2">Vendor</th><th className="p-2">Doc no.</th><th className="p-2">Date</th><th className="p-2">Amount</th>
                  </tr></thead>
                  <tbody>
                    {bulk.rows.map((r, i) => (
                      <tr key={i} className={`border-b border-gray-50 ${r.failed ? 'bg-red-50' : ''}`}>
                        <td className="p-2 text-gray-400 max-w-[120px] truncate" title={r.fileName}>{r.fileName}</td>
                        <td className="p-2">
                          <select value={r.docType} onChange={(e) => setBulk(b => ({ ...b, rows: b.rows.map((x, j) => j === i ? { ...x, docType: e.target.value } : x) }))} className="border rounded p-1">
                            <option value="AP_INVOICE">AP Inv</option><option value="AP_RECEIPT">AP Rcpt</option><option value="AR_INVOICE">AR Inv</option>
                          </select>
                        </td>
                        <td className="p-2">
                          <select value={r.clientId} onChange={(e) => setBulk(b => ({ ...b, rows: b.rows.map((x, j) => j === i ? { ...x, clientId: e.target.value } : x) }))} className="border rounded p-1">
                            <option value="">—</option>
                            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </td>
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
                <button onClick={saveBulk} className="px-4 py-2 text-sm text-white rounded-lg font-medium" style={{ backgroundColor: 'var(--brand-color,#1D9E75)' }}>Save all</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* Client modal */}
      {clientModal && (
        <Modal title={clientModal.id ? 'Edit client' : 'Add client'} onClose={() => setClientModal(null)}>
          <Field label="Client name"><input className="inp" value={clientModal.name} onChange={(e) => setClientModal({ ...clientModal, name: e.target.value })} /></Field>
          <label className="flex items-center gap-2 mt-3 text-sm text-gray-600">
            <input type="checkbox" checked={!!clientModal.isDefault} onChange={(e) => setClientModal({ ...clientModal, isDefault: e.target.checked })} />
            Set as default client
          </label>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setClientModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button onClick={saveClient} className="px-4 py-2 text-sm text-white rounded-lg font-medium" style={{ backgroundColor: 'var(--brand-color,#1D9E75)' }}>Save</button>
          </div>
        </Modal>
      )}

      <style>{`.inp{width:100%;padding:0.5rem 0.625rem;border:1px solid #e5e7eb;border-radius:0.5rem;font-size:0.875rem}`}</style>
    </div>
  );
}

function Field({ label, children }) {
  return (<div><label className="text-xs text-gray-500 block mb-1">{label}</label>{children}</div>);
}

function Modal({ title, children, onClose, wide }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl p-5 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ClientsView({ clients, onAdd, onEdit, onDelete, fmtDate }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="flex justify-between items-center p-4 border-b border-gray-100">
        <p className="text-sm font-medium text-gray-700">Clients</p>
        <button onClick={onAdd} className="px-3 py-1.5 text-white rounded-lg text-sm font-medium" style={{ backgroundColor: 'var(--brand-color,#1D9E75)' }}>+ Add client</button>
      </div>
      {clients.length === 0 ? (
        <p className="text-sm text-gray-400 p-8 text-center">No clients yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
            <th className="px-4 py-3">Name</th><th className="px-4 py-3">Default</th><th className="px-4 py-3">Documents</th><th className="px-4 py-3">Last activity</th><th className="px-4 py-3"></th>
          </tr></thead>
          <tbody>
            {clients.map(c => (
              <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                <td className="px-4 py-3">{c.isDefault ? <span className="text-green-600">✓</span> : ''}</td>
                <td className="px-4 py-3 text-gray-500">{c.docCount}</td>
                <td className="px-4 py-3 text-gray-500">{fmtDate(c.lastActivity)}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => onEdit(c)} className="text-xs text-gray-500 hover:underline mr-2">Edit</button>
                  <button onClick={() => onDelete(c)} className="text-xs text-red-400 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// src/pages/ApprovalsPage.jsx
import { useState, useEffect } from 'react';
import api from '../lib/api';
import toast from '../lib/toast';
import { useNotifications } from '../context/NotificationContext';
import { useCurrency } from '../context/CurrencyContext';
import ReceiptImage from '../components/ReceiptImage';

const STATUS_BADGE = {
  PENDING: 'bg-amber-500 text-white',
  APPROVED: 'bg-green-600 text-white',
  REJECTED: 'bg-red-600 text-white',
  RETURNED: 'bg-amber-600 text-white',
  PROCESSED: 'bg-blue-600 text-white',
  CANCELLED: 'bg-gray-400 text-white',
};

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyDetail, setHistoryDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');
  const [source, setSource] = useState('expense'); // 'expense' | 'ledger' (AP/AR)
  const [counts, setCounts] = useState({ expense: 0, ledger: 0 });
  const [notes, setNotes] = useState({});
  const [noteError, setNoteError] = useState({}); // {id:true} kapag nag-Return/Reject nang walang note
  const [selected, setSelected] = useState(null);
  const [actioning, setActioning] = useState(null);
  const { format } = useCurrency();
  const { load: refreshNotif } = useNotifications();

  // Build a full name from a user object (backend returns firstName/lastName).
  const personName = (u) => u ? (`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.name || u.email || '—') : '—';

  // Normalize an AP/AR approval row into the same shape the expense UI expects,
  // so the existing list + detail modal render without a parallel layout.
  const normLedger = (a) => ({
    ...a,
    expense: {
      _isLedger: true,
      title: `${a.ledgerDoc?.vendorName || 'AP/AR document'}${a.ledgerDoc?.docNumber ? ` \u2014 ${a.ledgerDoc.docNumber}` : ''}`,
      amount: a.ledgerDoc?.amount,
      amountPhp: a.ledgerDoc?.amountPhp,
      currency: a.ledgerDoc?.currency || 'PHP',
      category: a.ledgerDoc?.category || '',
      expenseDate: a.ledgerDoc?.docDate,
      description: a.ledgerDoc?.notes || '',
      submittedBy: a.ledgerDoc?.createdBy || null,
      approvals: a.ledgerDoc?.approvals || [],
      receipt: a.ledgerDoc?.receipt || null,
    },
  });

  const load = async () => {
    setLoading(true);
    try {
      if (source === 'ledger') {
        const [p, h] = await Promise.all([
          api.get('/approvals/ledger/pending'),
          api.get('/approvals/ledger/history'),
        ]);
        setApprovals((Array.isArray(p) ? p : []).filter(a => a.ledgerDoc).map(normLedger));
        setHistory((Array.isArray(h) ? h : []).filter(a => a.ledgerDoc).map(normLedger));
      } else {
        const [p, h] = await Promise.all([
          api.get('/approvals/pending'),
          api.get('/approvals/history'),
        ]);
        setApprovals((Array.isArray(p) ? p : []).filter(a => a.expense));
        setHistory((Array.isArray(h) ? h : []).filter(a => a.expense));
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { setSelected(null); load(); /* eslint-disable-next-line */ }, [source]);

  // Pending counts for BOTH sources, so each toggle shows its own bubble.
  const loadCounts = async () => {
    try {
      const [pe, pl] = await Promise.all([
        api.get('/approvals/pending'),
        api.get('/approvals/ledger/pending'),
      ]);
      setCounts({ expense: Array.isArray(pe) ? pe.length : 0, ledger: Array.isArray(pl) ? pl.length : 0 });
    } catch { /* ignore */ }
  };
  useEffect(() => { loadCounts(); }, []);

  const action = async (id, type) => {
    if (type === 'return' && !notes[id]?.trim()) {
      setNoteError(e => ({ ...e, [id]: true }));
      toast.error('Please add a comment before returning to submitter.'); return;
    }
    if (type === 'reject' && !notes[id]?.trim()) {
      setNoteError(e => ({ ...e, [id]: true }));
      toast.error('Please add a reason before rejecting.'); return;
    }
    setNoteError(e => { const c = { ...e }; delete c[id]; return c; });
    setActioning(id + type);
    try {
      const base = source === 'ledger' ? '/approvals/ledger' : '/approvals';
      await api.post(`${base}/${id}/${type}`, { notes: notes[id] || '' });
      setNotes(n => { const c = {...n}; delete c[id]; return c; });
      setSelected(null);
      await load();
      loadCounts();
      refreshNotif();
      toast.success(type === 'approve' ? 'Approved' : type === 'reject' ? 'Rejected' : 'Returned to submitter');
    } catch(err) {
      toast.error(err.error || 'Action failed. Please try again.');
    } finally { setActioning(null); }
  };

  const reimburse = async (expenseId) => {
    try {
      await api.post(`/approvals/${expenseId}/reimburse`);
      await load();
    } catch(err) { toast.error(err.error || 'Failed'); }
  };

  const hasReceipt = (expense) => expense?.receipt?.id;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-gray-900">My Approvals</h1>
        {(() => {
          const ready = approvals.filter(a => a.actionable !== false).length;
          const waitingN = approvals.length - ready;
          const srcLabel = source === 'ledger' ? 'AP & AR' : 'Expense';
          return (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500 mt-1">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${ready > 0 ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                {ready} {srcLabel} for your action
              </span>
              {waitingN > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">
                  ⏳ {waitingN} {srcLabel} waiting on earlier approver{waitingN > 1 ? 's' : ''}
                </span>
              )}
              <span className="text-xs text-gray-400">· {history.length} {srcLabel} already actioned (see History)</span>
            </div>
          );
        })()}
      </div>

      {/* Source toggle: Expenses vs AP & AR invoices */}
      <div className="seg-group mb-3">
        <button onClick={() => setSource('expense')}
          className={`seg-btn ${source === 'expense' ? 'active' : ''}`}>
          Expenses
          {counts.expense > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center min-w-5 h-5 px-1.5 bg-red-500 text-white text-xs font-bold rounded-full">{counts.expense}</span>
          )}
        </button>
        <button onClick={() => setSource('ledger')}
          className={`seg-btn ${source === 'ledger' ? 'active' : ''}`}>
          AP &amp; AR
          {counts.ledger > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center min-w-5 h-5 px-1.5 bg-red-500 text-white text-xs font-bold rounded-full">{counts.ledger}</span>
          )}
        </button>
      </div>

      {/* Tabs */}
      <div className="seg-group mb-4">
        <button onClick={() => setTab('pending')}
          className={`seg-btn ${tab === 'pending' ? 'active' : ''}`}>
          Pending {approvals.length > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center min-w-5 h-5 px-1.5 bg-red-500 text-white text-xs font-bold rounded-full">{approvals.length}</span>
          )}
        </button>
        <button onClick={() => setTab('history')}
          className={`seg-btn ${tab === 'history' ? 'active' : ''}`}>
          History
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading...</div>
      ) : tab === 'pending' ? (
        approvals.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 py-16 text-center">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-gray-700 font-medium">All caught up!</p>
            <p className="text-sm text-gray-400 mt-1">No pending approvals.</p>
          </div>
        ) : (
          <div>
            {/* Approval cards */}
            <div className="space-y-3">
              {approvals.map(a => {
                const e = a.expense;
                const isSelected = selected?.id === a.id;
                const waiting = a.actionable === false; // hindi pa umaabot sa step ng approver na ito
                return (
                  <div key={a.id}
                    onClick={() => setSelected(isSelected ? null : a)}
                    className={`bg-white rounded-xl border cursor-pointer transition-all ${isSelected ? 'border-brand-400 ring-1 ring-brand-400' : 'border-gray-100 hover:border-gray-200'} ${waiting ? 'opacity-75' : ''} p-4`}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0 mr-3">
                        <p className="text-sm font-medium text-gray-900 truncate">{e.merchant || e.title}</p>
                        {e.orNumber && <p className="text-xs text-gray-400">OR: {e.orNumber}</p>}
                        <p className="text-xs text-gray-500 mt-0.5">
                          <span className="font-semibold text-gray-700">{personName(e.submittedBy)}</span> · {e.submittedBy?.department || 'No dept'} · {new Date(e.expenseDate).toLocaleDateString('en-PH',{month:'short',day:'numeric'})}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-medium text-gray-900">{format(e.amountPhp)}</p>
                        <p className="text-xs text-gray-400 capitalize mt-0.5">{e.category?.toLowerCase()}</p>
                      </div>
                    </div>

                    {e.description && (
                      <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mb-2 line-clamp-2">
                        {e.description}
                      </p>
                    )}

                    {hasReceipt(e) && (
                      <button onClick={ev => {ev.stopPropagation(); setSelected(a);}}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold mb-2 px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90"
                        style={{ backgroundColor: '#2563eb', color: '#ffffff' }}>
                        🧾 Receipt attached — click to view
                      </button>
                    )}

                    <div onClick={ev => ev.stopPropagation()}>
                      {waiting && (
                        <div className="mb-2 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-[11px] text-gray-500">
                          ⏳ In your queue — waiting for an earlier approver to act first. Buttons will unlock when it's your turn.
                        </div>
                      )}
                      <input
                        value={notes[a.id] || ''}
                        onChange={ev => { setNotes(n => ({...n, [a.id]: ev.target.value})); if (ev.target.value.trim()) setNoteError(er => { const c = { ...er }; delete c[a.id]; return c; }); }}
                        placeholder={noteError[a.id] ? '⚠ Reason is required — type it here' : 'Add note (required for Return and Reject)'}
                        disabled={waiting}
                        className={`w-full px-3 py-1.5 border rounded-lg text-xs focus:outline-none mb-2 disabled:opacity-50 ${noteError[a.id]
                          ? 'border-red-500 ring-1 ring-red-300 placeholder-red-400 focus:border-red-500'
                          : 'border-gray-200 focus:border-brand-400'}`}
                      />
                      {noteError[a.id] && (
                        <p className="text-[11px] text-red-500 -mt-1 mb-2">Please type the reason above before Return / Reject.</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => action(a.id, 'approve')}
                          disabled={waiting || actioning === a.id + 'approve'}
                          className="flex-1 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg text-xs font-medium hover:bg-green-100 disabled:opacity-50 transition-colors">
                          {actioning === a.id + 'approve' ? '...' : '✓ Approve'}
                        </button>
                        <button
                          onClick={() => action(a.id, 'return')}
                          disabled={waiting || actioning === a.id + 'return'}
                          className="flex-1 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-xs font-medium hover:bg-amber-100 disabled:opacity-50 transition-colors">
                          {actioning === a.id + 'return' ? '...' : '↩ Return'}
                        </button>
                        <button
                          onClick={() => action(a.id, 'reject')}
                          disabled={waiting || actioning === a.id + 'reject'}
                          className="flex-1 py-2 bg-red-50 text-red-700 border border-red-100 rounded-lg text-xs font-medium hover:bg-red-100 disabled:opacity-50 transition-colors">
                          {actioning === a.id + 'reject' ? '...' : '✗ Reject'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Detail modal — full expense details (works on mobile + desktop) */}
            {selected && (() => {
              const e = selected.expense;
              const row = (label, val) => val ? (
                <div className="flex justify-between py-1.5 border-b border-gray-50">
                  <span className="text-gray-500">{label}</span>
                  <span className="text-gray-800 text-right max-w-[60%]">{val}</span>
                </div>
              ) : null;
              return (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setSelected(null)}>
                  <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5" onClick={ev => ev.stopPropagation()}>
                    <div className="flex justify-between items-center mb-3">
                      <p className="text-sm font-medium text-gray-900">{source === 'ledger' ? 'AP/AR invoice details' : 'Expense details'}</p>
                      <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
                    </div>
                    {hasReceipt(e) ? (
                      <div className="mb-4"><ReceiptImage receiptId={e.receipt.id} className="w-full max-h-56 object-contain rounded-lg" /></div>
                    ) : (
                      <div className="bg-gray-50 rounded-lg p-6 text-center mb-4">
                        <p className="text-2xl mb-1">🧾</p>
                        <p className="text-xs text-gray-400">No receipt attached</p>
                      </div>
                    )}
                    <div className="space-y-0.5 text-xs">
                      {row('Submitted by', personName(e.submittedBy))}
                      {row('Department', e.submittedBy?.department)}
                      {row('Merchant', e.merchant)}
                      {row('Description', e.title)}
                      {row('Amount', format(e.amountPhp))}
                      {row('OR / Invoice no.', e.orNumber)}
                      {row('Type', e.expenseType ? e.expenseType.toLowerCase().replace('_', ' ') : '')}
                      {row('Category', e.category)}
                      {row('Cost center', e.costCenter)}
                      {row('Date', e.expenseDate ? new Date(e.expenseDate).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '')}
                      {row('Approval level', selected.level ? `Level ${selected.level}` : '')}
                      {e.description && e.description !== e.title ? row('Notes', e.description) : null}
                    </div>
                    {e.status === 'APPROVED' && (
                      <button onClick={() => reimburse(e.id)}
                        className="w-full mt-4 py-2 bg-brand-400 text-white rounded-lg text-xs font-medium hover:bg-brand-600 transition-colors">
                        💰 Mark as reimbursed
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )
      ) : (
        /* History tab */
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {history.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">No history yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Expense</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium hidden md:table-cell">Employee</th>
                <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Amount</th>
                <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Decision</th>
              </tr></thead>
              <tbody>
                {history.map(a => {
                  // Align the badge with the EXPENSE's actual decision, not the raw
                  // approval-row status (a Return is stored as a REJECTED row + [RETURNED] note).
                  const isReturnedRow = a.status === 'REJECTED' && (a.notes||'').startsWith('[RETURNED]');
                  const decision = isReturnedRow ? 'RETURNED' : (a.expense?.status || a.status);
                  const cleanNote = (a.notes||'').startsWith('[auto]') ? '' : (a.notes||'').replace(/^\[RETURNED\]\s*/, '');
                  return (
                  <tr key={a.id} onClick={() => setHistoryDetail(a)} className="border-t border-gray-50 hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-3">
                      <p className="text-gray-900 font-medium text-sm">{a.expense.title}</p>
                      {cleanNote && <p className="text-xs text-gray-600 mt-0.5 max-w-xs">"{cleanNote}"</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell">{personName(a.expense.submittedBy)}</td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">{format(a.expense.amountPhp)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[decision] || 'bg-gray-100 text-gray-600'}`}>
                        {decision}
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* History detail modal — read-only expense details incl. who submitted it */}
      {historyDetail && (() => {
        const a = historyDetail;
        const e = a.expense || {};
        const isReturnedRow = a.status === 'REJECTED' && (a.notes || '').startsWith('[RETURNED]');
        const decision = isReturnedRow ? 'RETURNED' : (e.status || a.status);
        const note = (a.notes || '').startsWith('[auto]') ? '' : (a.notes || '').replace(/^\[RETURNED\]\s*/, '');
        const row = (label, val) => val ? (
          <div className="flex justify-between py-1.5 border-b border-gray-50">
            <span className="text-gray-500">{label}</span>
            <span className="text-gray-800 text-right max-w-[60%]">{val}</span>
          </div>
        ) : null;
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setHistoryDetail(null)}>
            <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5" onClick={ev => ev.stopPropagation()}>
              <div className="flex justify-between items-center mb-3">
                <p className="text-sm font-medium text-gray-900">Expense details</p>
                <button onClick={() => setHistoryDetail(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
              </div>

              {hasReceipt(e) ? (
                <div className="mb-4"><ReceiptImage receiptId={e.receipt.id} className="w-full max-h-56 object-contain rounded-lg" /></div>
              ) : (
                <div className="bg-gray-50 rounded-lg p-6 text-center mb-4">
                  <p className="text-2xl mb-1">🧾</p>
                  <p className="text-xs text-gray-400">No receipt attached</p>
                </div>
              )}

              <div className="mb-3">
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[decision] || 'bg-gray-100 text-gray-600'}`}>{decision}</span>
              </div>

              <div className="space-y-0.5 text-xs">
                {row('Submitted by', personName(e.submittedBy))}
                {row('Merchant', e.merchant)}
                {row('Description', e.title)}
                {row('Amount', format(e.amountPhp))}
                {row('OR / Invoice no.', e.orNumber)}
                {row('Type', e.expenseType ? e.expenseType.toLowerCase().replace('_', ' ') : '')}
                {row('Category', e.category)}
                {row('Cost center', e.costCenter)}
                {row('Date', e.expenseDate ? new Date(e.expenseDate).toLocaleDateString() : '')}
                {row('Processed on', e.processedAt ? new Date(e.processedAt).toLocaleDateString() : '')}
                {e.description && e.description !== e.title ? row('Notes', e.description) : null}
                {note ? row('Decision note', `"${note}"`) : null}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

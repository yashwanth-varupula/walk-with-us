import { useEffect, useState } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Search,
  RotateCw,
  Clock,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import Button from '../../components/ui/Button';
import { Alert } from '../../components/ui/Card';
import type { UserRole } from '../../lib/roles';

interface ProfileRecord {
  id: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface AuditRecord {
  id: string;
  admin_id: string;
  action: string;
  notes: string;
  created_at: string;
}

const TARGET_USER_UUID = '370c0774-cdcc-4c48-b968-042ba3f32843';
const TARGET_USER_EMAIL = 'raguramg44aru@gmail.com';

export default function AdminUserManagement() {
  const { user: currentAdmin } = useAuth();

  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [auditLogs, setAuditLogs] = useState<AuditRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Modal / Confirmation State
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [targetUser, setTargetUser] = useState<ProfileRecord | null>(null);
  const [selectedRole, setSelectedRole] = useState<UserRole>('admin');
  const [promotionNotes, setPromotionNotes] = useState(
    'Promoted to co-administrator by primary administrator',
  );
  const [submitting, setSubmitting] = useState(false);
  const [rpcResult, setRpcResult] = useState<Record<string, unknown> | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from('profiles')
        .select('id, full_name, role, is_active, created_at, updated_at')
        .order('created_at', { ascending: false });

      if (fetchErr) throw fetchErr;
      setProfiles(data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch user profiles.');
    } finally {
      setLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const { data, error: auditErr } = await supabase
        .from('admin_actions')
        .select('id, admin_id, action, notes, created_at')
        .eq('action', 'set_user_role')
        .order('created_at', { ascending: false })
        .limit(5);

      if (auditErr) throw auditErr;
      setAuditLogs(data || []);
    } catch {
      // Non-fatal if audit log view is empty
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    void loadAuditLogs();
  }, []);

  const openPromotionModal = (profile: ProfileRecord, desiredRole: UserRole = 'admin') => {
    setTargetUser(profile);
    setSelectedRole(desiredRole);
    setPromotionNotes(
      desiredRole === 'admin'
        ? `Promoted user ${profile.id === TARGET_USER_UUID ? TARGET_USER_EMAIL : profile.full_name} to co-administrator`
        : `Role updated to ${desiredRole}`,
    );
    setConfirmModalOpen(true);
  };

  const handleConfirmRoleChange = async () => {
    if (!targetUser) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    setRpcResult(null);

    try {
      const { data, error: rpcErr } = await supabase.rpc('set_user_role', {
        p_target_user_id: targetUser.id,
        p_new_role: selectedRole,
        p_notes: promotionNotes.trim() || 'Role updated via Admin User Management',
      });

      if (rpcErr) {
        throw rpcErr;
      }

      setRpcResult(data as Record<string, unknown>);
      setSuccess(
        `Successfully updated ${targetUser.full_name} (${targetUser.id}) to ${selectedRole}.`,
      );
      setConfirmModalOpen(false);

      // Refresh data
      await loadData();
      await loadAuditLogs();
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : typeof (err as Record<string, unknown>).message === 'string'
            ? (err as Record<string, string>).message
            : 'Role update RPC failed.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const targetProfile = profiles.find((p) => p.id === TARGET_USER_UUID);

  const filteredProfiles = profiles.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      p.id.toLowerCase().includes(q) ||
      p.full_name.toLowerCase().includes(q) ||
      p.role.toLowerCase().includes(q)
    );
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
              <Shield className="h-5 w-5" aria-hidden="true" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Admin User Management
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Promote accounts, manage role assignments, and review security audit logs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void loadData();
              void loadAuditLogs();
            }}
            loading={loading || auditLoading}
          >
            <RotateCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      {error && <Alert tone="stop">{error}</Alert>}
      {success && <Alert tone="good">{success}</Alert>}

      {/* Spotlight: Target User Promotion Card */}
      <div className="rounded-xl border-2 border-emerald-500/30 bg-emerald-50/50 p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm">
              <UserCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 uppercase tracking-wide">
                Target User for Promotion
              </span>
              <h2 className="text-lg font-bold text-slate-900 mt-0.5">
                {targetProfile?.full_name || 'ram'} ({TARGET_USER_EMAIL})
              </h2>
            </div>
          </div>

          <div>
            {targetProfile?.role === 'admin' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-200 px-3 py-1 text-sm font-semibold text-emerald-950">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                Active Administrator
              </span>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() => {
                  if (targetProfile) {
                    openPromotionModal(targetProfile, 'admin');
                  } else {
                    // Fallback stub if profiles are still loading
                    openPromotionModal(
                      {
                        id: TARGET_USER_UUID,
                        full_name: 'ram',
                        role: 'requester',
                        is_active: true,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                      },
                      'admin',
                    );
                  }
                }}
              >
                <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                Promote to Admin
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t border-emerald-200/60 text-xs text-slate-700">
          <div>
            <span className="block font-medium text-slate-500 uppercase">User UUID</span>
            <code className="mt-1 block font-mono text-[11px] bg-white/80 p-1.5 rounded border border-emerald-200 truncate select-all">
              {TARGET_USER_UUID}
            </code>
          </div>
          <div>
            <span className="block font-medium text-slate-500 uppercase">Account Email</span>
            <span className="mt-1 block font-semibold text-slate-900 bg-white/80 p-1.5 rounded border border-emerald-200">
              {TARGET_USER_EMAIL}
            </span>
          </div>
          <div>
            <span className="block font-medium text-slate-500 uppercase">Current Role</span>
            <span className="mt-1 inline-block capitalize font-bold px-2.5 py-1 rounded bg-slate-200 text-slate-800">
              {targetProfile?.role || 'requester'}
            </span>
          </div>
          <div>
            <span className="block font-medium text-slate-500 uppercase">Desired Role</span>
            <span className="mt-1 inline-block capitalize font-bold px-2.5 py-1 rounded bg-emerald-600 text-white">
              admin
            </span>
          </div>
        </div>

        {rpcResult && (
          <div className="mt-3 rounded-lg border border-emerald-300 bg-white p-3 text-xs">
            <p className="font-semibold text-emerald-950">RPC Execution Response:</p>
            <pre className="mt-1 overflow-x-auto text-[11px] text-slate-800 font-mono">
              {JSON.stringify(rpcResult, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Profiles Directory */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-slate-900">
            Registered Profiles ({profiles.length})
          </h2>
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, role, or UUID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold">
              <tr>
                <th className="px-4 py-3">Full Name</th>
                <th className="px-4 py-3">UUID</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Loading profiles...
                  </td>
                </tr>
              ) : filteredProfiles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No matching user profiles found.
                  </td>
                </tr>
              ) : (
                filteredProfiles.map((p) => {
                  const isCurrentAdmin = p.id === currentAdmin?.id;
                  const isTarget = p.id === TARGET_USER_UUID;
                  return (
                    <tr
                      key={p.id}
                      className={
                        isTarget
                          ? 'bg-emerald-50/40 hover:bg-emerald-50'
                          : 'hover:bg-slate-50/80'
                      }
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {p.full_name}
                        {isTarget && (
                          <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                            Target
                          </span>
                        )}
                        {isCurrentAdmin && (
                          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                            You
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                        {p.id}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 font-semibold capitalize ${
                            p.role === 'admin'
                              ? 'bg-rose-100 text-rose-800'
                              : p.role === 'staff'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {p.role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${
                            p.is_active
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {p.is_active ? 'Active' : 'Suspended'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {new Date(p.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {p.role !== 'admin' && (
                          <button
                            type="button"
                            onClick={() => openPromotionModal(p, 'admin')}
                            className="font-medium text-emerald-700 hover:text-emerald-900 hover:underline"
                          >
                            Promote to Admin
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Security Audit Entries */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-slate-500" />
          <h2 className="text-base font-semibold text-slate-900">
            Recent Role Changes Audit Trail (`admin_actions`)
          </h2>
        </div>

        {auditLogs.length === 0 ? (
          <p className="text-xs text-slate-500 py-3">No role changes recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1"
              >
                <div className="flex items-center justify-between text-slate-500 text-[11px]">
                  <span>Action: <strong>{log.action}</strong></span>
                  <span>{new Date(log.created_at).toLocaleString()}</span>
                </div>
                <p className="text-slate-800 font-mono text-[11px] break-all">{log.notes}</p>
                <p className="text-[10px] text-slate-400">Admin UUID: {log.admin_id}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {confirmModalOpen && targetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Confirm Administrator Promotion
                </h3>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  You are about to promote this user to the{' '}
                  <strong className="text-emerald-700">admin</strong> role. Administrators have
                  full authorization over help requests, verification, and role assignments.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Target User:</span>
                <span className="font-semibold text-slate-900">{targetUser.full_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Target UUID:</span>
                <code className="font-mono text-[11px] text-slate-800">{targetUser.id}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Current Role:</span>
                <span className="capitalize font-medium text-slate-700">{targetUser.role}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Assigned Role:</span>
                <span className="capitalize font-bold text-emerald-700">{selectedRole}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="promotionNotes"
                className="block text-xs font-semibold text-slate-700"
              >
                Audit Reason / Notes (required for public.admin_actions)
              </label>
              <textarea
                id="promotionNotes"
                rows={2}
                value={promotionNotes}
                onChange={(e) => setPromotionNotes(e.target.value)}
                className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900 flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
              <span>
                This calls <code>public.set_user_role</code> with your active admin session.
                The action is logged to the database audit trail.
              </span>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmModalOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleConfirmRoleChange}
                loading={submitting}
                loadingLabel="Promoting…"
              >
                <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Yes, Promote to Admin
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  HandHeart,
  History,
  Inbox,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  Sparkles,
  User,
  X,
  XCircle,
} from 'lucide-react';
import {
  ENQUIRY_STATUS_LABELS,
  listEnquiryAuditTrail,
  listStaffPartnerEnquiries,
  listStaffVolunteerApplications,
  updateStaffEnquiryStatus,
  type EnquiryActionRow,
  type EnquiryStatus,
  type PartnerEnquiryRow,
  type StaffEnquiryError,
  type VolunteerApplicationRow,
} from '../../services/staffEnquiries';
import { formatDate, formatDateTime, formatRelative } from '../../lib/format';

type ActiveTab = 'volunteer' | 'partner';
type StatusFilter = EnquiryStatus | 'all';

const STATUS_BADGE_STYLES: Record<EnquiryStatus, string> = {
  new: 'bg-sky-100 text-sky-800 ring-sky-600/20',
  reviewing: 'bg-amber-100 text-amber-800 ring-amber-600/20',
  accepted: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20',
  declined: 'bg-rose-100 text-rose-800 ring-rose-600/20',
};

export function EnquiryStatusBadge({ status }: { status: EnquiryStatus }) {
  const style = STATUS_BADGE_STYLES[status] ?? 'bg-slate-100 text-slate-700 ring-slate-500/20';
  const label = ENQUIRY_STATUS_LABELS[status] ?? status;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${style}`}
    >
      {label}
    </span>
  );
}

export default function StaffEnquiryInbox() {
  // Navigation & Filter state
  const [activeTab, setActiveTab] = useState<ActiveTab>('volunteer');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Data state
  const [volunteerRows, setVolunteerRows] = useState<VolunteerApplicationRow[]>([]);
  const [partnerRows, setPartnerRows] = useState<PartnerEnquiryRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<StaffEnquiryError | null>(null);

  // Selected item detail state
  const [selectedVolunteer, setSelectedVolunteer] = useState<VolunteerApplicationRow | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<PartnerEnquiryRow | null>(null);

  // Status Change Confirmation Dialog State
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    targetStatus: EnquiryStatus;
    enquiryType: 'volunteer' | 'partner';
    enquiryId: string;
    enquiryName: string;
  } | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Audit trail state for selected item
  const [auditLogs, setAuditLogs] = useState<EnquiryActionRow[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Load enquiries
  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    if (activeTab === 'volunteer') {
      const result = await listStaffVolunteerApplications({
        search: debouncedSearch,
        status: statusFilter,
        sortOrder,
        page,
        pageSize,
      });

      setLoading(false);
      if (result.error) {
        setLoadError(result.error);
        setVolunteerRows([]);
        setTotalCount(0);
      } else {
        setVolunteerRows(result.data);
        setTotalCount(result.count);
      }
    } else {
      const result = await listStaffPartnerEnquiries({
        search: debouncedSearch,
        status: statusFilter,
        sortOrder,
        page,
        pageSize,
      });

      setLoading(false);
      if (result.error) {
        setLoadError(result.error);
        setPartnerRows([]);
        setTotalCount(0);
      } else {
        setPartnerRows(result.data);
        setTotalCount(result.count);
      }
    }
  }, [activeTab, debouncedSearch, statusFilter, sortOrder, page, pageSize]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Fetch audit trail when an item is selected
  const activeEnquiryId = selectedVolunteer?.id ?? selectedPartner?.id ?? null;
  useEffect(() => {
    if (!activeEnquiryId) {
      setAuditLogs([]);
      return;
    }

    let isSubscribed = true;
    setLoadingAudit(true);
    void listEnquiryAuditTrail(activeEnquiryId).then((res) => {
      if (!isSubscribed) return;
      setLoadingAudit(false);
      setAuditLogs(res.data);
    });

    return () => {
      isSubscribed = false;
    };
  }, [activeEnquiryId]);

  // Tab switch
  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);
    setPage(1);
    setSelectedVolunteer(null);
    setSelectedPartner(null);
    setSuccessBanner(null);
  };

  // Status transition execution
  const executeStatusChange = async () => {
    if (!pendingStatusChange) return;

    setIsUpdating(true);
    setStatusError(null);

    const result = await updateStaffEnquiryStatus({
      enquiryType: pendingStatusChange.enquiryType,
      enquiryId: pendingStatusChange.enquiryId,
      newStatus: pendingStatusChange.targetStatus,
      notes: reviewNotes,
    });

    setIsUpdating(false);

    if (!result.ok) {
      setStatusError(result.error?.message ?? 'Failed to update enquiry status.');
      return;
    }

    // Success: update local view state
    const targetStatus = pendingStatusChange.targetStatus;
    if (pendingStatusChange.enquiryType === 'volunteer') {
      setVolunteerRows((prev) =>
        prev.map((r) => (r.id === pendingStatusChange.enquiryId ? { ...r, status: targetStatus } : r)),
      );
      if (selectedVolunteer?.id === pendingStatusChange.enquiryId) {
        setSelectedVolunteer((prev) => (prev ? { ...prev, status: targetStatus } : null));
      }
    } else {
      setPartnerRows((prev) =>
        prev.map((r) => (r.id === pendingStatusChange.enquiryId ? { ...r, status: targetStatus } : r)),
      );
      if (selectedPartner?.id === pendingStatusChange.enquiryId) {
        setSelectedPartner((prev) => (prev ? { ...prev, status: targetStatus } : null));
      }
    }

    // Refresh audit trail
    if (activeEnquiryId) {
      void listEnquiryAuditTrail(activeEnquiryId).then((res) => setAuditLogs(res.data));
    }

    setSuccessBanner(
      `Updated status of "${pendingStatusChange.enquiryName}" to ${ENQUIRY_STATUS_LABELS[targetStatus]}.`,
    );
    setPendingStatusChange(null);
    setReviewNotes('');
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Enquiry Inbox</h1>
          <p className="mt-1 text-sm text-slate-500">
            Review community volunteer applications and organizational partnership proposals.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </div>

      {/* 2. Success Banner */}
      {successBanner && (
        <div
          role="status"
          className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>{successBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessBanner(null)}
            className="text-emerald-700 hover:text-emerald-900"
            aria-label="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 3. Tab Bar */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex gap-6" aria-label="Enquiry Types" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'volunteer'}
            onClick={() => handleTabChange('volunteer')}
            className={`inline-flex items-center gap-2 border-b-2 py-3 text-sm font-semibold transition-colors ${
              activeTab === 'volunteer'
                ? 'border-emerald-600 text-emerald-800'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            <HandHeart className="h-4 w-4" aria-hidden="true" />
            <span>Volunteer Applications</span>
            {activeTab === 'volunteer' && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                {totalCount}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'partner'}
            onClick={() => handleTabChange('partner')}
            className={`inline-flex items-center gap-2 border-b-2 py-3 text-sm font-semibold transition-colors ${
              activeTab === 'partner'
                ? 'border-emerald-600 text-emerald-800'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            <Building2 className="h-4 w-4" aria-hidden="true" />
            <span>Partner Enquiries</span>
            {activeTab === 'partner' && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                {totalCount}
              </span>
            )}
          </button>
        </nav>
      </div>

      {/* 4. Search and Filters Toolbar */}
      <div className="grid gap-3 sm:grid-cols-12">
        {/* Search Input */}
        <div className="relative sm:col-span-6 lg:col-span-5">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={
              activeTab === 'volunteer'
                ? 'Search by name, email, city, skills...'
                : 'Search by organisation, contact, email, type...'
            }
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-slate-600"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Status Filter */}
        <div className="sm:col-span-3 lg:col-span-4">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StatusFilter);
              setPage(1);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
            aria-label="Filter by Status"
          >
            <option value="all">All Statuses</option>
            <option value="new">New</option>
            <option value="reviewing">Under Review</option>
            <option value="accepted">Approved / Accepted</option>
            <option value="declined">Declined</option>
          </select>
        </div>

        {/* Sort Order */}
        <div className="sm:col-span-3 lg:col-span-3">
          <select
            value={sortOrder}
            onChange={(e) => {
              setSortOrder(e.target.value as 'desc' | 'asc');
              setPage(1);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
            aria-label="Sort by Date"
          >
            <option value="desc">Newest First</option>
            <option value="asc">Oldest First</option>
          </select>
        </div>
      </div>

      {/* 5. Main Content Area */}
      {loadError ? (
        /* Error State */
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50/60 p-6 text-center text-rose-900 sm:p-8"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-700">
            <AlertCircle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 className="mt-3 text-base font-bold sm:text-lg">Unable to Load Enquiries</h2>
          <p className="mx-auto mt-2 max-w-xl text-xs sm:text-sm text-rose-800 leading-relaxed">
            {loadError.message}
          </p>
          {loadError.isPermissionError && (
            <div className="mx-auto mt-4 max-w-lg rounded-md bg-white p-3 text-left text-xs font-mono text-slate-700 border border-rose-200">
              <code>supabase/migrations/20261105_staff_enquiries_access.sql</code>
            </div>
          )}
          <div className="mt-5">
            <button
              type="button"
              onClick={() => void loadData()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-700 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-rose-800 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      ) : loading ? (
        /* Loading Skeleton */
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
          <div className="h-4 w-48 bg-slate-200 rounded animate-pulse" />
          <div className="space-y-3 pt-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="space-y-2">
                  <div className="h-4 w-40 bg-slate-200 rounded animate-pulse" />
                  <div className="h-3 w-64 bg-slate-100 rounded animate-pulse" />
                </div>
                <div className="h-6 w-20 bg-slate-100 rounded-full animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ) : (activeTab === 'volunteer' ? volunteerRows.length === 0 : partnerRows.length === 0) ? (
        /* Empty State */
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Inbox className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 className="mt-3 text-base font-bold text-slate-900">No Enquiries Found</h2>
          <p className="mx-auto mt-1 max-w-sm text-xs sm:text-sm text-slate-500">
            {searchInput || statusFilter !== 'all'
              ? 'No submissions matched your search or status filter. Try clearing the filter.'
              : activeTab === 'volunteer'
              ? 'No volunteer applications have been submitted yet.'
              : 'No partner enquiries have been submitted yet.'}
          </p>
          {(searchInput || statusFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setStatusFilter('all');
              }}
              className="mt-4 inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Clear all filters
            </button>
          )}
        </div>
      ) : (
        /* Table / List View */
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {activeTab === 'volunteer' ? (
                    <tr>
                      <th scope="col" className="px-5 py-3.5">
                        Applicant
                      </th>
                      <th scope="col" className="px-4 py-3.5">
                        Location &amp; Availability
                      </th>
                      <th scope="col" className="px-4 py-3.5">
                        Skills &amp; Motivation
                      </th>
                      <th scope="col" className="px-4 py-3.5">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-3.5">
                        Submitted
                      </th>
                      <th scope="col" className="px-5 py-3.5 text-right">
                        Action
                      </th>
                    </tr>
                  ) : (
                    <tr>
                      <th scope="col" className="px-5 py-3.5">
                        Organisation &amp; Contact
                      </th>
                      <th scope="col" className="px-4 py-3.5">
                        Partnership Type
                      </th>
                      <th scope="col" className="px-4 py-3.5">
                        Proposal Message
                      </th>
                      <th scope="col" className="px-4 py-3.5">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-3.5">
                        Submitted
                      </th>
                      <th scope="col" className="px-5 py-3.5 text-right">
                        Action
                      </th>
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {activeTab === 'volunteer'
                    ? volunteerRows.map((row) => (
                        <tr
                          key={row.id}
                          className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                          onClick={() => setSelectedVolunteer(row)}
                        >
                          <td className="px-5 py-4">
                            <div className="font-semibold text-slate-900">{row.fullName}</div>
                            <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                              <span>{row.email}</span>
                              {row.phone && (
                                <>
                                  <span>·</span>
                                  <span>{row.phone}</span>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-4 text-xs text-slate-600">
                            <div className="font-medium text-slate-800 flex items-center gap-1">
                              <MapPin className="h-3 w-3 text-slate-400" />
                              <span>{row.city}</span>
                            </div>
                            <div className="mt-0.5 text-slate-500">{row.availability}</div>
                          </td>
                          <td className="px-4 py-4 max-w-xs truncate text-xs text-slate-600">
                            <div className="font-medium text-slate-700 truncate">
                              {row.skills || 'General support'}
                            </div>
                            <div className="text-slate-400 truncate mt-0.5">{row.message}</div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <EnquiryStatusBadge status={row.status} />
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-xs text-slate-500">
                            <div>{formatDate(row.createdAt)}</div>
                            <div className="text-[11px] text-slate-400">
                              {formatRelative(row.createdAt)}
                            </div>
                          </td>
                          <td className="px-5 py-4 whitespace-nowrap text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedVolunteer(row);
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-600"
                            >
                              <Eye className="h-3.5 w-3.5 text-slate-500" />
                              <span>View</span>
                            </button>
                          </td>
                        </tr>
                      ))
                    : partnerRows.map((row) => (
                        <tr
                          key={row.id}
                          className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                          onClick={() => setSelectedPartner(row)}
                        >
                          <td className="px-5 py-4">
                            <div className="font-semibold text-slate-900">{row.organisation}</div>
                            <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                              <User className="h-3 w-3 text-slate-400" />
                              <span>{row.contactName}</span>
                              <span>·</span>
                              <span>{row.email}</span>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-xs">
                            <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                              {row.partnershipType}
                            </span>
                          </td>
                          <td className="px-4 py-4 max-w-xs truncate text-xs text-slate-500">
                            {row.message}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <EnquiryStatusBadge status={row.status} />
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-xs text-slate-500">
                            <div>{formatDate(row.createdAt)}</div>
                            <div className="text-[11px] text-slate-400">
                              {formatRelative(row.createdAt)}
                            </div>
                          </td>
                          <td className="px-5 py-4 whitespace-nowrap text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPartner(row);
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-600"
                            >
                              <Eye className="h-3.5 w-3.5 text-slate-500" />
                              <span>View</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/50 px-5 py-3 text-xs text-slate-500">
              <div>
                Showing <span className="font-medium text-slate-900">{(page - 1) * pageSize + 1}</span> to{' '}
                <span className="font-medium text-slate-900">
                  {Math.min(page * pageSize, totalCount)}
                </span>{' '}
                of <span className="font-medium text-slate-900">{totalCount}</span> enquiries
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>Previous</span>
                </button>
                <span className="px-2 text-slate-600">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white"
                >
                  <span>Next</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. Detail Drawer / Modal */}
      {(selectedVolunteer || selectedPartner) && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="enquiry-detail-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
        >
          <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4.5 bg-slate-50/50">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {selectedVolunteer ? 'Volunteer Application' : 'Partner Proposal'}
                  </span>
                  <EnquiryStatusBadge
                    status={selectedVolunteer ? selectedVolunteer.status : selectedPartner!.status}
                  />
                </div>
                <h2 id="enquiry-detail-title" className="mt-1 text-lg font-bold text-slate-900">
                  {selectedVolunteer ? selectedVolunteer.fullName : selectedPartner?.organisation}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedVolunteer(null);
                  setSelectedPartner(null);
                }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-emerald-600"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="overflow-y-auto px-6 py-5 space-y-6 text-sm">
              {/* Contact Information Cards */}
              <div className="grid gap-3 sm:grid-cols-2 rounded-xl bg-slate-50 p-4 border border-slate-200">
                <div>
                  <span className="text-xs font-medium text-slate-500 uppercase">Primary Contact</span>
                  <div className="mt-1 font-semibold text-slate-900">
                    {selectedVolunteer ? selectedVolunteer.fullName : selectedPartner?.contactName}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-600">
                    <Mail className="h-3.5 w-3.5 text-slate-400" />
                    <a
                      href={`mailto:${selectedVolunteer ? selectedVolunteer.email : selectedPartner?.email}`}
                      className="text-emerald-700 hover:underline font-medium"
                    >
                      {selectedVolunteer ? selectedVolunteer.email : selectedPartner?.email}
                    </a>
                  </div>
                  {(selectedVolunteer?.phone || selectedPartner?.phone) && (
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-600">
                      <Phone className="h-3.5 w-3.5 text-slate-400" />
                      <a
                        href={`tel:${selectedVolunteer ? selectedVolunteer.phone : selectedPartner?.phone}`}
                        className="text-slate-700 hover:underline"
                      >
                        {selectedVolunteer ? selectedVolunteer.phone : selectedPartner?.phone}
                      </a>
                    </div>
                  )}
                </div>

                <div>
                  <span className="text-xs font-medium text-slate-500 uppercase">
                    {selectedVolunteer ? 'Location & Timing' : 'Partnership Details'}
                  </span>
                  {selectedVolunteer ? (
                    <div className="mt-1 space-y-1 text-xs text-slate-700">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-slate-400" />
                        <span>City: <strong>{selectedVolunteer.city}</strong></span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        <span>Available: <strong>{selectedVolunteer.availability}</strong></span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 space-y-1 text-xs text-slate-700">
                      <div>
                        Type: <span className="font-semibold">{selectedPartner?.partnershipType}</span>
                      </div>
                      <div>
                        Organisation: <span className="font-semibold">{selectedPartner?.organisation}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Specific Content: Skills & Message */}
              {selectedVolunteer && selectedVolunteer.skills && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Skills &amp; Resources Offered
                  </h3>
                  <div className="mt-1.5 rounded-lg border border-slate-200 bg-white p-3 text-slate-800 leading-relaxed">
                    {selectedVolunteer.skills}
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  {selectedVolunteer ? 'Applicant Message & Background' : 'Partnership Proposal'}
                </h3>
                <div className="mt-1.5 rounded-lg border border-slate-200 bg-white p-3.5 text-slate-800 leading-relaxed whitespace-pre-wrap">
                  {selectedVolunteer ? selectedVolunteer.message : selectedPartner?.message}
                </div>
              </div>

              {/* Status Action Buttons */}
              <div className="border-t border-slate-200 pt-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Take Review Action
                </h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPendingStatusChange({
                        targetStatus: 'reviewing',
                        enquiryType: selectedVolunteer ? 'volunteer' : 'partner',
                        enquiryId: selectedVolunteer ? selectedVolunteer.id : selectedPartner!.id,
                        enquiryName: selectedVolunteer
                          ? selectedVolunteer.fullName
                          : selectedPartner!.organisation,
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                  >
                    <Clock className="h-3.5 w-3.5" />
                    <span>Mark Under Review</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setPendingStatusChange({
                        targetStatus: 'accepted',
                        enquiryType: selectedVolunteer ? 'volunteer' : 'partner',
                        enquiryId: selectedVolunteer ? selectedVolunteer.id : selectedPartner!.id,
                        enquiryName: selectedVolunteer
                          ? selectedVolunteer.fullName
                          : selectedPartner!.organisation,
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Approve / Accept</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setPendingStatusChange({
                        targetStatus: 'declined',
                        enquiryType: selectedVolunteer ? 'volunteer' : 'partner',
                        enquiryId: selectedVolunteer ? selectedVolunteer.id : selectedPartner!.id,
                        enquiryName: selectedVolunteer
                          ? selectedVolunteer.fullName
                          : selectedPartner!.organisation,
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>Decline / Reject</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setPendingStatusChange({
                        targetStatus: 'new',
                        enquiryType: selectedVolunteer ? 'volunteer' : 'partner',
                        enquiryId: selectedVolunteer ? selectedVolunteer.id : selectedPartner!.id,
                        enquiryName: selectedVolunteer
                          ? selectedVolunteer.fullName
                          : selectedPartner!.organisation,
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-slate-400" />
                    <span>Reset to New</span>
                  </button>
                </div>
              </div>

              {/* Audit History Log */}
              <div className="border-t border-slate-200 pt-5">
                <div className="flex items-center gap-2 mb-3">
                  <History className="h-4 w-4 text-slate-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Audit Trail &amp; Staff Decisions
                  </h3>
                </div>

                {loadingAudit ? (
                  <div className="text-xs text-slate-400 py-2">Loading audit history...</div>
                ) : auditLogs.length === 0 ? (
                  <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500 border border-slate-100">
                    No status review actions recorded yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs"
                      >
                        <div className="flex items-center justify-between text-slate-600">
                          <span className="font-semibold text-slate-800">
                            Changed from{' '}
                            <span className="capitalize">{ENQUIRY_STATUS_LABELS[log.oldStatus as EnquiryStatus] ?? log.oldStatus}</span>{' '}
                            to{' '}
                            <span className="capitalize font-bold text-slate-900">
                              {ENQUIRY_STATUS_LABELS[log.newStatus as EnquiryStatus] ?? log.newStatus}
                            </span>
                          </span>
                          <span className="text-slate-400">{formatDateTime(log.createdAt)}</span>
                        </div>
                        {log.notes && (
                          <div className="mt-1.5 text-slate-700 bg-white p-2 rounded border border-slate-200">
                            <strong>Note:</strong> {log.notes}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3">
              <span className="text-xs text-slate-400">
                Submitted on {formatDateTime(selectedVolunteer ? selectedVolunteer.createdAt : selectedPartner!.createdAt)}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedVolunteer(null);
                  setSelectedPartner(null);
                }}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Confirmation Modal Dialog for Consequential Status Transitions */}
      {pendingStatusChange && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-status-title"
          className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <h3 id="confirm-status-title" className="text-base font-bold text-slate-900">
              Confirm Status Change
            </h3>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
              Are you sure you want to change the status of{' '}
              <strong>"{pendingStatusChange.enquiryName}"</strong> to{' '}
              <strong className="text-slate-900 uppercase">
                {ENQUIRY_STATUS_LABELS[pendingStatusChange.targetStatus]}
              </strong>
              ?
            </p>

            {statusError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                {statusError}
              </div>
            )}

            <div className="mt-4">
              <label
                htmlFor="staff-review-notes"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Staff Review Notes (Optional audit reason):
              </label>
              <textarea
                id="staff-review-notes"
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Reason for acceptance, decline, or follow-up notes..."
                className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
              />
              <span className="text-[10px] text-slate-400 text-right block mt-0.5">
                {reviewNotes.length}/2000
              </span>
            </div>

            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setPendingStatusChange(null);
                  setStatusError(null);
                  setReviewNotes('');
                }}
                disabled={isUpdating}
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void executeStatusChange()}
                disabled={isUpdating}
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-xs disabled:opacity-50 ${
                  pendingStatusChange.targetStatus === 'declined'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : pendingStatusChange.targetStatus === 'accepted'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-slate-900 hover:bg-slate-800'
                }`}
              >
                {isUpdating ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Updating...</span>
                  </>
                ) : (
                  <span>Confirm Status</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

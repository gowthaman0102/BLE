import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Badge from '../components/Badge';
import SearchBar from '../components/SearchBar';
import Select from '../components/Select';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Icon from '../components/Icon';
import BulkImportModal from '../components/BulkImportModal';
import { staffService } from '../services/staffService';
import type { Staff } from '../types';
import './StaffPage.css';

interface StaffFormData {
  staffCode: string;
  name: string;
  collegeEmail: string;
  roles: string[];
}

const EMPTY_FORM: StaffFormData = {
  staffCode: '',
  name: '',
  collegeEmail: '',
  roles: ['STAFF'],
};

const ALLOWED_STAFF_ROLES = [
  { id: 'STAFF', label: 'Teaching Staff', description: 'Regular faculty member' },
  { id: 'CLASS_COUNSELOR', label: 'Class Counselor', description: 'Assigned to classes for attendance oversight' },
  { id: 'DEPUTY_HOD', label: 'Deputy HOD', description: 'Deputy Head of Department' },
  { id: 'HOD', label: 'HOD', description: 'Head of Department' },
  { id: 'ADMIN', label: 'Administrator', description: 'System Administrator with full access' },
];

function errorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : 'The request failed. Please retry.';
}

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const [message, setMessage] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [isCompact, setIsCompact] = useState(false);

  // Modals & Dialogs
  const [formOpen, setFormOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [form, setForm] = useState<StaffFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // ConfirmDialog targets
  const [deactivateTarget, setDeactivateTarget] = useState<Staff | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Staff | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await staffService.getStaff({
        search: search.trim() || undefined,
        role: role || undefined,
        status: status || undefined,
        page,
        limit: pageSize,
      });
      setStaff(result.staff);
      setTotal(result.pagination.total);
    } catch (requestError) {
      setError(errorMessage(requestError));
      setStaff([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [search, role, status, page, pageSize]);

  useEffect(() => {
    void fetchStaff();
  }, [fetchStaff]);

  const openForm = (member?: Staff) => {
    setError('');
    setMessage('');
    setModalError('');
    setEditing(member || null);
    if (member) {
      const roles = Array.isArray(member.roles) && member.roles.length > 0
        ? member.roles
        : ['STAFF'];
      setForm({
        staffCode: member.staffCode,
        name: member.name,
        collegeEmail: member.collegeEmail,
        roles,
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setFormOpen(true);
  };

  const toggleRoleInForm = (roleName: string) => {
    const currentRoles = form.roles;
    if (currentRoles.includes(roleName)) {
      if (currentRoles.length === 1) {
        // Must keep at least one role
        return;
      }
      setForm({
        ...form,
        roles: currentRoles.filter((r) => r !== roleName),
      });
    } else {
      setForm({
        ...form,
        roles: [...currentRoles, roleName],
      });
    }
  };

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setModalError('');
    setMessage('');
    try {
      if (editing) {
        await staffService.updateStaff(editing.id, form);
        setMessage(`Faculty member ${form.name} updated successfully.`);
      } else {
        await staffService.createStaff(form);
        setMessage(`Faculty member ${form.name} registered successfully.`);
      }
      setFormOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      await fetchStaff();
    } catch (requestError) {
      setModalError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const handleStatusClick = (member: Staff) => {
    if (member.status === 'ACTIVE') {
      setDeactivateTarget(member);
    } else {
      void activateStaff(member);
    }
  };

  const activateStaff = async (member: Staff) => {
    setError('');
    setMessage('');
    try {
      await staffService.updateStaffStatus(member.id, 'ACTIVE');
      setMessage(`Faculty member ${member.name} is now active.`);
      await fetchStaff();
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  };

  const confirmDeactivate = async () => {
    if (!deactivateTarget) return;
    setDeactivating(true);
    setError('');
    setMessage('');
    try {
      await staffService.updateStaffStatus(deactivateTarget.id, 'INACTIVE');
      setMessage(`Faculty member ${deactivateTarget.name} has been deactivated.`);
      setDeactivateTarget(null);
      await fetchStaff();
    } catch (requestError) {
      setError(errorMessage(requestError));
      setDeactivateTarget(null);
    } finally {
      setDeactivating(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    setMessage('');
    try {
      await staffService.deleteStaff(deleteTarget.id);
      setMessage(`Staff record for ${deleteTarget.name} was permanently deleted.`);
      setDeleteTarget(null);
      await fetchStaff();
    } catch (requestError) {
      setError(errorMessage(requestError));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div className="staff-page">
      {/* Header */}
      <div className="staff-page__header-row">
        <div>
          <PageHeader
            title="Faculty &amp; Staff"
            breadcrumbs={[{ label: 'Home', path: '/dashboard' }, { label: 'Faculty & Staff' }]}
          />
        </div>
        <div className="staff-page__header-actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setImportModalOpen(true)}
          >
            <Icon name="upload" size={16} />
            <span>Import Staff</span>
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => openForm()}
          >
            <Icon name="add" size={16} />
            <span>Add Staff</span>
          </button>
        </div>
      </div>

      {/* Notices */}
      {message && (
        <div role="status" className="staff-page__notice">
          <Icon name="check" size={16} />
          <span>{message}</span>
          <button type="button" className="notice-dismiss" onClick={() => setMessage('')}>×</button>
        </div>
      )}
      {error && (
        <div role="alert" className="staff-page__error">
          <Icon name="error" size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => void fetchStaff()}>Retry</button>
        </div>
      )}

      {/* Controls Bar */}
      <div className="staff-page__controls-bar">
        <div className="staff-page__search-wrap">
          <SearchBar
            placeholder="Search staff by identifier, name, or email..."
            value={search}
            onChange={(value) => { setSearch(value); setPage(1); }}
          />
        </div>
        <div className="staff-page__filters-group">
          <Select
            label="Role"
            value={role}
            onChange={(value) => { setRole(value); setPage(1); }}
            options={[
              { value: '', label: 'All roles' },
              { value: 'STAFF', label: 'Staff' },
              { value: 'CLASS_COUNSELOR', label: 'Class Counselor' },
              { value: 'DEPUTY_HOD', label: 'Deputy HOD' },
              { value: 'HOD', label: 'HOD' },
              { value: 'ADMIN', label: 'Administrator' },
            ]}
          />
          <Select
            label="Status"
            value={status}
            onChange={(value) => { setStatus(value); setPage(1); }}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
            ]}
          />
          <div className="staff-page__view-toggles">
            <button
              type="button"
              className={`view-toggle-btn ${isCompact ? 'view-toggle-btn--active' : ''}`}
              onClick={() => setIsCompact((c) => !c)}
              title={isCompact ? 'Switch to comfortable view' : 'Switch to compact view'}
            >
              {isCompact ? 'Compact View' : 'Comfortable'}
            </button>
          </div>
        </div>
      </div>

      {/* Table Container with Sticky Headers & Internal Scroll */}
      <div className="staff-page__table-wrapper">
        <div className={`staff-table-scroll ${isCompact ? 'staff-table-scroll--compact' : ''}`}>
          <table className="staff-table">
            <thead>
              <tr>
                <th style={{ width: '150px' }}>Staff Identifier</th>
                <th>Faculty Member</th>
                <th>College Email</th>
                <th style={{ width: '180px' }}>Role</th>
                <th style={{ width: '110px' }}>Status</th>
                <th style={{ width: '230px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="staff-table__loading-cell">
                    <div className="table-spinner" />
                    <span>Loading faculty directory...</span>
                  </td>
                </tr>
              ) : staff.length === 0 ? (
                <tr>
                  <td colSpan={6} className="staff-table__empty-cell">
                    <div className="staff-empty-state">
                      <div className="empty-state-icon">
                        <Icon name="staff" size={40} />
                      </div>
                      <h3>No Staff Records Found</h3>
                      <p>
                        {search || role || status
                          ? 'No staff members match the active filters.'
                          : 'No staff members added yet. Import staff using Excel or add them individually.'}
                      </p>
                      <div className="empty-state-actions">
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={() => setImportModalOpen(true)}
                        >
                          <Icon name="upload" size={16} />
                          <span>Import Staff</span>
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary"
                          onClick={() => openForm()}
                        >
                          <Icon name="add" size={16} />
                          <span>Add Single Faculty</span>
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                staff.map((member) => (
                  <tr key={member.id} className="staff-row">
                    <td>
                      <span className="staff-code-badge">
                        {member.staffCode}
                      </span>
                    </td>
                    <td>
                      <div className="staff-name-cell">
                        <div className="staff-avatar-initials">
                          {member.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="staff-name-text">{member.name}</span>
                      </div>
                    </td>
                    <td>
                      <span className="staff-email-text">{member.collegeEmail}</span>
                    </td>
                    <td>
                      <div className="staff-roles-wrap">
                        {Array.isArray(member.roles) && member.roles.length > 0 ? (
                          member.roles.map((r) => (
                            <span
                              key={r}
                              className={`role-pill ${
                                r === 'HOD' ? 'role-pill--hod' : r === 'ADMIN' ? 'role-pill--admin' : 'role-pill--staff'
                              }`}
                            >
                              {r}
                            </span>
                          ))
                        ) : (
                          <span className="role-pill role-pill--staff">STAFF</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <Badge variant={member.status === 'ACTIVE' ? 'success' : 'default'}>
                        {member.status}
                      </Badge>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="staff-row-actions">
                        <Link
                          to={`/staff/${member.id}/timetable`}
                          className="action-btn action-btn--timetable"
                          title="View Weekly Schedule"
                        >
                          Timetable
                        </Link>
                        <button
                          type="button"
                          className="action-btn action-btn--edit"
                          onClick={() => openForm(member)}
                          title="Edit Details & Roles"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={`action-btn ${member.status === 'ACTIVE' ? 'action-btn--deactivate' : 'action-btn--activate'}`}
                          onClick={() => handleStatusClick(member)}
                        >
                          {member.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          className="action-btn action-btn--delete"
                          onClick={() => setDeleteTarget(member)}
                          title="Delete Staff Member"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="staff-page__pagination-bar">
          <div className="pagination-info">
            <span>
              Showing {staff.length > 0 ? (page - 1) * pageSize + 1 : 0} to{' '}
              {Math.min(page * pageSize, total)} of <strong>{total}</strong> faculty
            </span>
            <div className="page-size-selector">
              <label htmlFor="staff-pagesize">Rows per page:</label>
              <select
                id="staff-pagesize"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div className="pagination-controls">
            <button
              type="button"
              className="pagination-btn"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              <Icon name="chevron-left" size={16} />
              <span>Previous</span>
            </button>
            <span className="pagination-current-page">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              className="pagination-btn"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
            >
              <span>Next</span>
              <Icon name="chevron-right" size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Add / Edit Faculty Modal */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit Faculty Details & Permissions' : 'Register New Faculty Member'}
        size="md"
      >
        <form onSubmit={submitForm} className="staff-form-modal">
          {modalError && (
            <div role="alert" className="staff-page__error" style={{ marginBottom: 14 }}>
              <Icon name="error" size={16} />
              <span>{modalError}</span>
            </div>
          )}

          <div className="staff-form-grid">
            <div className="form-group">
              <label htmlFor="staff-form-code">Staff Identifier / Code *</label>
              <input
                id="staff-form-code"
                required
                maxLength={50}
                placeholder="e.g. IT-FAC-01"
                value={form.staffCode}
                onChange={(e) => setForm({ ...form, staffCode: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="staff-form-name">Faculty Full Name *</label>
              <input
                id="staff-form-name"
                required
                maxLength={255}
                placeholder="e.g. Dr. M. Suresh"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="staff-form-email">College Email Address *</label>
              <input
                id="staff-form-email"
                required
                type="email"
                maxLength={255}
                placeholder="e.g. suresh.m@sonatech.ac.in"
                value={form.collegeEmail}
                onChange={(e) => setForm({ ...form, collegeEmail: e.target.value.toLowerCase() })}
              />
            </div>

            {/* Role Assignment */}
            <div className="staff-roles-selector">
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                Assigned Roles &amp; Permissions *
              </label>
              <div className="staff-roles-grid">
                {ALLOWED_STAFF_ROLES.map((r) => {
                  const checked = form.roles.includes(r.id);
                  return (
                    <label key={r.id} className="role-checkbox-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRoleInForm(r.id)}
                      />
                      <div>
                        <div>{r.label}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="staff-form-actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setFormOpen(false)}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Faculty Record'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Confirm Deactivation Dialog */}
      <ConfirmDialog
        isOpen={!!deactivateTarget}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={confirmDeactivate}
        title="Deactivate Staff Member"
        message={`Are you sure you want to deactivate faculty member "${deactivateTarget?.name}" (${deactivateTarget?.staffCode})? They will no longer be able to log in or conduct attendance sessions.`}
        confirmLabel="Deactivate Staff"
        variant="danger"
        loading={deactivating}
      />

      {/* Confirm Deletion Dialog */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete Staff Record"
        message={`Are you sure you want to permanently delete faculty member "${deleteTarget?.name}" (${deleteTarget?.staffCode})? Note: Staff with existing timetables, attendance sessions, or counselor assignments cannot be deleted and must be deactivated instead.`}
        confirmLabel="Delete Staff"
        variant="danger"
        loading={deleting}
      />

      {/* Modern Bulk Import Modal */}
      <BulkImportModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Import Staff"
        entityName="faculty"
        sampleTemplateName="faculty-import-template.csv"
        columnsNote="Columns: staff_code, name, college_email. Supports Excel (.xlsx) and CSV."
        onDownloadTemplate={(format) => staffService.downloadTemplate(format)}
        onPreview={(file) => staffService.previewImport(file)}
        onConfirm={(file) => staffService.confirmImport(file)}
        onSuccess={() => {
          void fetchStaff();
        }}
      />
    </div>
  );
}

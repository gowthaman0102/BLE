import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import PageHeader from '../components/PageHeader';
import Badge from '../components/Badge';
import SearchBar from '../components/SearchBar';
import Select from '../components/Select';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Icon from '../components/Icon';
import BulkImportModal from '../components/BulkImportModal';
import { academicService } from '../services/academicService';
import { studentService } from '../services/studentService';
import type { Student, Department, Batch, StudentFaceProfile, FaceProfileStatus } from '../types';
import './StudentsPage.css';

interface ClassOption {
  id: string;
  name: string;
  batchName?: string;
  status: string;
}

interface StudentFormData {
  registerNumber: string;
  name: string;
  collegeEmail: string;
  classId: string;
}

const EMPTY_FORM: StudentFormData = { registerNumber: '', name: '', collegeEmail: '', classId: '' };

function errorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : 'The request failed. Please retry.';
}

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const [message, setMessage] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState('');
  const [isCompact, setIsCompact] = useState(false);

  // Modals & Dialogs
  const [formOpen, setFormOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [form, setForm] = useState<StudentFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // ConfirmDialog targets
  const [deactivateTarget, setDeactivateTarget] = useState<Student | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Face Profile Modal (Milestones F2 & F3)
  const [faceModalOpen, setFaceModalOpen] = useState(false);
  const [faceTarget, setFaceTarget] = useState<Student | null>(null);
  const [faceProfile, setFaceProfile] = useState<StudentFaceProfile | null>(null);
  const [faceLoading, setFaceLoading] = useState(false);
  const [faceSaving, setFaceSaving] = useState(false);
  const [faceError, setFaceError] = useState('');
  const [photoBlobUrl, setPhotoBlobUrl] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoRevoking, setPhotoRevoking] = useState(false);
  const [showRevokePrompt, setShowRevokePrompt] = useState(false);
  const [revokeReasonInput, setRevokeReasonInput] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await studentService.getStudents({
        search: search.trim() || undefined,
        departmentId: departmentId || undefined,
        batchId: batchId || undefined,
        classId: classId || undefined,
        status: status || undefined,
        page,
        limit: pageSize,
      });
      setStudents(result.students);
      setTotal(result.pagination.total);
    } catch (requestError) {
      setError(errorMessage(requestError));
      setStudents([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [search, departmentId, batchId, classId, status, page, pageSize]);

  useEffect(() => {
    void fetchStudents();
  }, [fetchStudents]);

  useEffect(() => {
    void academicService.getClasses()
      .then((response) => setClasses((response.data || []).filter((item: ClassOption) => item.status === 'ACTIVE')))
      .catch((requestError: unknown) => setError(errorMessage(requestError)));

    void academicService.getDepartments()
      .then((response) => setDepartments((response.data || []).filter((item: Department) => item.status === 'ACTIVE')))
      .catch((requestError: unknown) => setError(errorMessage(requestError)));

    void academicService.getBatches()
      .then((response) => setBatches((response.data || []).filter((item: Batch) => item.status === 'ACTIVE')))
      .catch((requestError: unknown) => setError(errorMessage(requestError)));
  }, []);

  const openForm = (student?: Student) => {
    setMessage('');
    setError('');
    setModalError('');
    setEditing(student || null);
    setForm(student
      ? { registerNumber: student.registerNumber, name: student.name, collegeEmail: student.collegeEmail, classId: student.classId }
      : EMPTY_FORM);
    setFormOpen(true);
  };

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setModalError('');
    setMessage('');
    try {
      if (editing) {
        await studentService.updateStudent(editing.id, form);
        setMessage(`Student ${form.name} updated successfully.`);
      } else {
        await studentService.createStudent(form);
        setMessage(`Student ${form.name} registered successfully.`);
      }
      setFormOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      await fetchStudents();
    } catch (requestError) {
      setModalError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const handleStatusClick = (student: Student) => {
    if (student.status === 'ACTIVE') {
      setDeactivateTarget(student);
    } else {
      void activateStudent(student);
    }
  };

  const activateStudent = async (student: Student) => {
    setError('');
    setMessage('');
    try {
      await studentService.updateStudentStatus(student.id, 'ACTIVE');
      setMessage(`Student ${student.name} is now active.`);
      await fetchStudents();
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
      await studentService.updateStudentStatus(deactivateTarget.id, 'INACTIVE');
      setMessage(`Student ${deactivateTarget.name} has been deactivated.`);
      setDeactivateTarget(null);
      await fetchStudents();
    } catch (requestError) {
      setError(errorMessage(requestError));
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
      await studentService.deleteStudent(deleteTarget.id);
      setMessage(`Student ${deleteTarget.name} record was permanently deleted.`);
      setDeleteTarget(null);
      await fetchStudents();
    } catch (requestError) {
      setError(errorMessage(requestError));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const closeFaceModal = () => {
    setFaceModalOpen(false);
    if (photoBlobUrl) {
      URL.revokeObjectURL(photoBlobUrl);
      setPhotoBlobUrl(null);
    }
    setShowRevokePrompt(false);
    setRevokeReasonInput('');
  };

  const openFaceModal = async (student: Student) => {
    setFaceTarget(student);
    setFaceModalOpen(true);
    setFaceLoading(true);
    setFaceError('');
    setShowRevokePrompt(false);
    setRevokeReasonInput('');
    if (photoBlobUrl) {
      URL.revokeObjectURL(photoBlobUrl);
      setPhotoBlobUrl(null);
    }

    try {
      const profile = await studentService.getFaceProfile(student.id);
      setFaceProfile(profile);

      if (profile.referencePhotoKey) {
        setPhotoLoading(true);
        try {
          const blob = await studentService.getReferencePhotoBlob(student.id);
          const url = URL.createObjectURL(blob);
          setPhotoBlobUrl(url);
        } catch {
          // Photo blob might be unavailable
        } finally {
          setPhotoLoading(false);
        }
      }
    } catch (err) {
      setFaceError(errorMessage(err));
    } finally {
      setFaceLoading(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !faceTarget) return;

    if (file.size > 5 * 1024 * 1024) {
      setFaceError('Selected photo exceeds maximum allowed size of 5 MB.');
      if (photoInputRef.current) photoInputRef.current.value = '';
      return;
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setFaceError('Only JPEG, PNG, and WebP images are permitted.');
      if (photoInputRef.current) photoInputRef.current.value = '';
      return;
    }

    setPhotoUploading(true);
    setFaceError('');
    try {
      const updated = await studentService.uploadReferencePhoto(
        faceTarget.id,
        file,
        'Enrolled by HOD from Admin portal'
      );
      setFaceProfile(updated);

      if (photoBlobUrl) {
        URL.revokeObjectURL(photoBlobUrl);
      }
      const blob = await studentService.getReferencePhotoBlob(faceTarget.id);
      const url = URL.createObjectURL(blob);
      setPhotoBlobUrl(url);

      setMessage(`Reference photo for ${faceTarget.name} uploaded successfully (v${updated.imageVersion || 1}).`);
    } catch (err) {
      setFaceError(errorMessage(err));
    } finally {
      setPhotoUploading(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const handleRevokePhoto = async () => {
    if (!faceTarget) return;
    setPhotoRevoking(true);
    setFaceError('');
    try {
      const updated = await studentService.revokeReferencePhoto(
        faceTarget.id,
        revokeReasonInput.trim() || 'Revoked by HOD'
      );
      setFaceProfile(updated);
      setShowRevokePrompt(false);
      setRevokeReasonInput('');
      setMessage(`Reference photo for ${faceTarget.name} has been revoked.`);
    } catch (err) {
      setFaceError(errorMessage(err));
    } finally {
      setPhotoRevoking(false);
    }
  };

  const handleUpdateFaceStatus = async (newStatus: FaceProfileStatus) => {
    if (!faceTarget) return;
    setFaceSaving(true);
    setFaceError('');
    try {
      const updated = await studentService.updateFaceProfileStatus(
        faceTarget.id,
        newStatus,
        `HOD status update from Admin portal to ${newStatus}`
      );
      setFaceProfile(updated);
      setMessage(`Face profile for ${faceTarget.name} updated to ${newStatus}.`);
    } catch (err) {
      setFaceError(errorMessage(err));
    } finally {
      setFaceSaving(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div className="students-page">
      {/* Page Header */}
      <div className="students-page__header-row">
        <div>
          <PageHeader
            title="Students"
            breadcrumbs={[{ label: 'Home', path: '/dashboard' }, { label: 'Students' }]}
          />
        </div>
        <div className="students-page__header-actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setImportModalOpen(true)}
          >
            <Icon name="upload" size={16} />
            <span>Import Students</span>
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => openForm()}
          >
            <Icon name="add" size={16} />
            <span>Add Student</span>
          </button>
        </div>
      </div>

      {/* Notices */}
      {message && (
        <div role="status" className="students-page__notice">
          <Icon name="check" size={16} />
          <span>{message}</span>
          <button type="button" className="notice-dismiss" onClick={() => setMessage('')}>×</button>
        </div>
      )}
      {error && (
        <div role="alert" className="students-page__error">
          <Icon name="error" size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => void fetchStudents()}>Retry</button>
        </div>
      )}

      {/* Filters & View Controls Bar */}
      <div className="students-page__controls-bar">
        <div className="students-page__search-wrap">
          <SearchBar
            placeholder="Search by register number, name, or email..."
            value={search}
            onChange={(value) => { setSearch(value); setPage(1); }}
          />
        </div>

        <div className="students-page__filters-group">
          <Select
            label="Department"
            value={departmentId}
            onChange={(value) => { setDepartmentId(value); setPage(1); }}
            options={[{ value: '', label: 'All departments' }, ...departments.map((d) => ({ value: d.id, label: `${d.code} - ${d.name}` }))]}
          />
          <Select
            label="Batch"
            value={batchId}
            onChange={(value) => { setBatchId(value); setPage(1); }}
            options={[{ value: '', label: 'All batches' }, ...batches.map((b) => ({ value: b.id, label: b.name }))]}
          />
          <Select
            label="Class"
            value={classId}
            onChange={(value) => { setClassId(value); setPage(1); }}
            options={[{ value: '', label: 'All classes' }, ...classes.map((item) => ({ value: item.id, label: item.name }))]}
          />
          <Select
            label="Status"
            value={status}
            onChange={(value) => { setStatus(value); setPage(1); }}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
              { value: 'GRADUATED', label: 'Graduated' },
              { value: 'SUSPENDED', label: 'Suspended' },
            ]}
          />
          <div className="students-page__view-toggles">
            <button
              type="button"
              className={`view-toggle-btn ${isCompact ? 'view-toggle-btn--active' : ''}`}
              onClick={() => setIsCompact((c) => !c)}
              title={isCompact ? 'Switch to comfortable view' : 'Switch to compact view (best for 100+ students)'}
            >
              {isCompact ? 'Compact View' : 'Comfortable'}
            </button>
          </div>
        </div>
      </div>

      {/* Main Table Container with Sticky Headers & Internal Scroll */}
      <div className="students-page__table-wrapper">
        <div className={`students-table-scroll ${isCompact ? 'students-table-scroll--compact' : ''}`}>
          <table className="students-table">
            <thead>
              <tr>
                <th style={{ width: '160px' }}>Register Number</th>
                <th>Student Name</th>
                <th>College Email</th>
                <th style={{ width: '130px' }}>Class</th>
                <th style={{ width: '120px' }}>Batch</th>
                <th style={{ width: '110px' }}>Status</th>
                <th style={{ width: '210px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="students-table__loading-cell">
                    <div className="table-spinner" />
                    <span>Loading student records...</span>
                  </td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan={7} className="students-table__empty-cell">
                    <div className="students-empty-state">
                      <div className="empty-state-icon">
                        <Icon name="students" size={40} />
                      </div>
                      <h3>No Student Records</h3>
                      <p>
                        {search || departmentId || batchId || classId || status
                          ? 'No students matched the active search filters.'
                          : 'No students added yet. Upload an Excel or CSV file or add students to get started.'}
                      </p>
                      <div className="empty-state-actions">
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={() => setImportModalOpen(true)}
                        >
                          <Icon name="upload" size={16} />
                          <span>Import Students</span>
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary"
                          onClick={() => openForm()}
                        >
                          <Icon name="add" size={16} />
                          <span>Add Single Student</span>
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                students.map((student) => (
                  <tr key={student.id} className="student-row">
                    <td>
                      <span className="student-regno-badge">
                        {student.registerNumber}
                      </span>
                    </td>
                    <td>
                      <div className="student-name-cell">
                        <div className="student-avatar-initials">
                          {student.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="student-name-text">{student.name}</span>
                      </div>
                    </td>
                    <td>
                      <span className="student-email-text">{student.collegeEmail}</span>
                    </td>
                    <td>
                      <span className="student-class-badge">{student.className || '-'}</span>
                    </td>
                    <td>
                      <span className="student-batch-badge">{student.batchName || '-'}</span>
                    </td>
                    <td>
                      <Badge variant={student.status === 'ACTIVE' ? 'success' : 'default'}>
                        {student.status}
                      </Badge>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="student-row-actions">
                        <button
                          type="button"
                          className="action-btn action-btn--edit"
                          onClick={() => openForm(student)}
                          title="Edit Student Details"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={`action-btn ${student.status === 'ACTIVE' ? 'action-btn--deactivate' : 'action-btn--activate'}`}
                          onClick={() => handleStatusClick(student)}
                        >
                          {student.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          className="action-btn action-btn--face"
                          onClick={() => openFaceModal(student)}
                          title="Manage Face Profile (HOD)"
                        >
                          Face
                        </button>
                        <button
                          type="button"
                          className="action-btn action-btn--delete"
                          onClick={() => setDeleteTarget(student)}
                          title="Delete Student Record"
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

        {/* Enhanced Pagination & Page Size Control */}
        <div className="students-page__pagination-bar">
          <div className="pagination-info">
            <span>
              Showing {students.length > 0 ? (page - 1) * pageSize + 1 : 0} to{' '}
              {Math.min(page * pageSize, total)} of <strong>{total}</strong> students
            </span>
            <div className="page-size-selector">
              <label htmlFor="student-pagesize">Rows per page:</label>
              <select
                id="student-pagesize"
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

      {/* Add / Edit Student Modal */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit Student Details' : 'Register New Student'}
        size="md"
      >
        <form onSubmit={submitForm} className="student-form-modal">
          {modalError && (
            <div role="alert" className="students-page__error" style={{ marginBottom: 14 }}>
              <Icon name="error" size={16} />
              <span>{modalError}</span>
            </div>
          )}

          <div className="student-form-grid">
            <div className="form-group">
              <label htmlFor="form-regno">Register Number *</label>
              <input
                id="form-regno"
                required
                maxLength={50}
                placeholder="e.g. 61782324106001"
                value={form.registerNumber}
                onChange={(e) => setForm({ ...form, registerNumber: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="form-name">Full Name *</label>
              <input
                id="form-name"
                required
                maxLength={255}
                placeholder="e.g. Anandha Kumar S"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="form-email">College Email *</label>
              <input
                id="form-email"
                required
                type="email"
                maxLength={255}
                placeholder="e.g. anand.23it@sonatech.ac.in"
                value={form.collegeEmail}
                onChange={(e) => setForm({ ...form, collegeEmail: e.target.value.toLowerCase() })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="form-class">Assigned Class *</label>
              <select
                id="form-class"
                required
                value={form.classId}
                onChange={(e) => setForm({ ...form, classId: e.target.value })}
              >
                <option value="">Select Class</option>
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} {item.batchName ? `(${item.batchName})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="student-form-actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setFormOpen(false)}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={saving || classes.length === 0}
            >
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Register Student'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Confirm Deactivation Dialog */}
      <ConfirmDialog
        isOpen={!!deactivateTarget}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={confirmDeactivate}
        title="Deactivate Student"
        message={`Are you sure you want to deactivate student "${deactivateTarget?.name}" (${deactivateTarget?.registerNumber})? Inactive students cannot verify attendance in upcoming sessions.`}
        confirmLabel="Deactivate Student"
        variant="danger"
        loading={deactivating}
      />

      {/* Confirm Deletion Dialog */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete Student Record"
        message={`Are you sure you want to permanently delete student "${deleteTarget?.name}" (${deleteTarget?.registerNumber})? Note: Students with existing attendance history cannot be deleted and must be deactivated instead.`}
        confirmLabel="Delete Student"
        variant="danger"
        loading={deleting}
      />

      {/* Modern Bulk Import Modal */}
      <BulkImportModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Import Students"
        entityName="students"
        sampleTemplateName="student-import-template.csv"
        columnsNote="Columns: register_number, name, college_email, class_id. Supports Excel (.xlsx) and CSV."
        onDownloadTemplate={(format) => studentService.downloadTemplate(format)}
        onPreview={(file) => studentService.previewImport(file)}
        onConfirm={(file) => studentService.confirmImport(file)}
        onSuccess={() => {
          void fetchStudents();
        }}
      />

      {/* Face Verification Profile Modal (Milestones F2 & F3) */}
      {faceModalOpen && faceTarget && (
        <Modal
          isOpen={faceModalOpen}
          title={`Biometric Reference Photo — ${faceTarget.name}`}
          onClose={closeFaceModal}
        >
          <div className="face-profile-modal">
            {/* Student & Photo Summary Card */}
            <div className="face-profile-card">
              <div className="face-photo-section">
                <div className="face-photo-container">
                  {photoLoading ? (
                    <div className="face-photo-loading">
                      <div className="table-spinner" style={{ width: 22, height: 22 }} />
                      <span>Loading...</span>
                    </div>
                  ) : photoBlobUrl ? (
                    <img
                      src={photoBlobUrl}
                      alt={`Reference portrait for ${faceTarget.name}`}
                      className="face-photo-img"
                    />
                  ) : (
                    <div className="face-photo-placeholder">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="12" cy="8" r="4" />
                        <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
                      </svg>
                      <span>No Reference Photo</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="face-metadata-section">
                <div className="face-metadata-item">
                  <span className="face-metadata-label">Register Number:</span>
                  <span className="face-metadata-value">{faceTarget.registerNumber}</span>
                </div>
                <div className="face-metadata-item">
                  <span className="face-metadata-label">Class:</span>
                  <span className="face-metadata-value">{faceTarget.className || '-'}</span>
                </div>
                <div className="face-metadata-item">
                  <span className="face-metadata-label">Enrollment Status:</span>
                  <span className="face-metadata-value">
                    <Badge variant={faceProfile?.status === 'ACTIVE' ? 'success' : faceProfile?.status === 'REVOKED' ? 'danger' : 'warning'}>
                      {faceProfile?.status || 'NOT_ENROLLED'}
                    </Badge>
                  </span>
                </div>
                {faceProfile?.referencePhotoKey && (
                  <>
                    <div className="face-metadata-item">
                      <span className="face-metadata-label">Image Version:</span>
                      <span className="face-metadata-value">v{faceProfile.imageVersion || 1}</span>
                    </div>
                    {faceProfile.width && faceProfile.height && (
                      <div className="face-metadata-item">
                        <span className="face-metadata-label">Resolution:</span>
                        <span className="face-metadata-value">{faceProfile.width} × {faceProfile.height} px</span>
                      </div>
                    )}
                    {faceProfile.fileSize && (
                      <div className="face-metadata-item">
                        <span className="face-metadata-label">File Size:</span>
                        <span className="face-metadata-value">{(faceProfile.fileSize / 1024).toFixed(1)} KB</span>
                      </div>
                    )}
                    {faceProfile.referencePhotoSha256 && (
                      <div className="face-metadata-item">
                        <span className="face-metadata-label">SHA-256:</span>
                        <span className="face-metadata-value face-hash-pill" title={faceProfile.referencePhotoSha256}>
                          {faceProfile.referencePhotoSha256.substring(0, 16)}…
                        </span>
                      </div>
                    )}
                    {faceProfile.enrolledAt && (
                      <div className="face-metadata-item">
                        <span className="face-metadata-label">Enrolled At:</span>
                        <span className="face-metadata-value" style={{ fontSize: 12 }}>
                          {new Date(faceProfile.enrolledAt).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Revocation Banner if Revoked */}
            {faceProfile?.status === 'REVOKED' && (
              <div className="face-profile-revocation">
                <strong>⚠️ Reference Photo Revoked:</strong> {faceProfile.revocationReason || 'Revoked by authorized staff'}
                {faceProfile.revokedAt ? ` on ${new Date(faceProfile.revokedAt).toLocaleString()}` : ''}
              </div>
            )}

            {/* Face Detection Deferral Notice */}
            <div className="face-profile-notice">
              <p><strong>ℹ️ Milestone F3 — HOD Reference Photo Storage & Validation</strong></p>
              <p>Reference photos are validated (JPEG/PNG/WebP, 200–4096px, ≤5MB) and securely stored in server storage. Biometric face detection and selfie verification remain deferred to Milestone F5.</p>
            </div>

            {faceError ? <div className="modal-error-banner">{faceError}</div> : null}

            {/* HOD Photo Upload Controls */}
            <div className="face-photo-controls">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                onChange={handlePhotoUpload}
                className="face-upload-input"
              />
              <button
                type="button"
                className="btn btn--primary"
                disabled={photoUploading || photoLoading || faceLoading}
                onClick={() => photoInputRef.current?.click()}
              >
                {photoUploading ? 'Uploading & Validating...' : faceProfile?.referencePhotoKey ? 'Replace Reference Photo' : 'Upload Reference Photo'}
              </button>

              {faceProfile?.referencePhotoKey && faceProfile.status !== 'REVOKED' && !showRevokePrompt && (
                <button
                  type="button"
                  className="btn btn--danger"
                  disabled={photoRevoking || photoUploading || faceLoading}
                  onClick={() => setShowRevokePrompt(true)}
                >
                  Revoke Reference Photo
                </button>
              )}
            </div>

            {/* Inline Revocation Prompt */}
            {showRevokePrompt && (
              <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', padding: '12px 14px', borderRadius: 6 }}>
                <p style={{ margin: '0 0 8px 0', fontSize: 13, fontWeight: 600, color: '#9f1239' }}>
                  Confirm Revocation of Reference Photo
                </p>
                <input
                  type="text"
                  placeholder="Reason for revocation (e.g., photo outdated, wrong student)..."
                  value={revokeReasonInput}
                  onChange={(e) => setRevokeReasonInput(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', fontSize: 13, marginBottom: 8, borderRadius: 4, border: '1px solid #cbd5e1' }}
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => setShowRevokePrompt(false)}
                    disabled={photoRevoking}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger"
                    onClick={() => void handleRevokePhoto()}
                    disabled={photoRevoking}
                  >
                    {photoRevoking ? 'Revoking...' : 'Confirm Revoke'}
                  </button>
                </div>
              </div>
            )}

            <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={closeFaceModal}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn--warning"
                disabled={faceSaving || faceLoading || faceProfile?.status === 'REVOKED'}
                onClick={() => void handleUpdateFaceStatus('REVOKED')}
              >
                {faceSaving ? 'Saving...' : 'Disable Profile'}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={faceSaving || faceLoading || faceProfile?.status === 'ACTIVE'}
                onClick={() => void handleUpdateFaceStatus('ACTIVE')}
              >
                {faceSaving ? 'Saving...' : 'Activate Profile'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

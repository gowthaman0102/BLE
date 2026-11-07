import { useState, useMemo } from 'react';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import Badge from '../components/Badge';
import Button from '../components/Button';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Input from '../components/Input';
import Select from '../components/Select';
import { useApi } from '../hooks/useApi';
import api from '../services/api';
import { useToast } from '../hooks/useToast';
import type { ApiResponse, ClassSection, TableColumn } from '../types';

interface Option {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  code?: string;
  departmentId?: string;
  isCurrent?: boolean;
}

interface ClassForm {
  name: string;
  yearNumber: string;
  section: string;
  departmentId: string;
  academicYearId: string;
  batchId: string;
  regulationId: string;
  status: 'ACTIVE' | 'INACTIVE';
}

const EMPTY_FORM: ClassForm = {
  name: '',
  yearNumber: '1',
  section: '',
  departmentId: '',
  academicYearId: '',
  batchId: '',
  regulationId: '',
  status: 'ACTIVE',
};

const ROMAN_NUMERALS: Record<string, string> = {
  '1': 'I',
  '2': 'II',
  '3': 'III',
  '4': 'IV',
};

export default function ClassesPage() {
  const { data: classResponse, loading, error, refetch } = useApi<ApiResponse<ClassSection[]>>('/api/classes');
  const { data: departmentResponse, error: departmentError } = useApi<ApiResponse<Option[]>>('/api/departments');
  const { data: yearResponse, error: yearError } = useApi<ApiResponse<Option[]>>('/api/academic-years');
  const { data: batchResponse, error: batchError } = useApi<ApiResponse<Option[]>>('/api/batches');
  const { data: regulationResponse, error: regulationError } = useApi<ApiResponse<Option[]>>('/api/regulations');
  const { showToast } = useToast();

  const [form, setForm] = useState<ClassForm>(EMPTY_FORM);
  const [editing, setEditing] = useState<ClassSection | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // View mode: 'table' or 'hierarchy'
  const [viewMode, setViewMode] = useState<'table' | 'hierarchy'>('table');

  // Filters
  const [deptFilter, setDeptFilter] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Confirmation dialog for deactivation / activation
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    classRow: ClassSection | null;
    action: 'DEACTIVATE' | 'ACTIVATE';
    loading: boolean;
  }>({
    isOpen: false,
    classRow: null,
    action: 'DEACTIVATE',
    loading: false,
  });

  const classes = classResponse?.data || [];
  const allDepartments = departmentResponse?.data || [];
  const activeDepartments = allDepartments.filter((item) => item.status === 'ACTIVE');
  const allYears = yearResponse?.data || [];
  const activeYears = allYears.filter((item) => item.status === 'ACTIVE');
  const currentAcademicYear = allYears.find((y) => y.isCurrent) || activeYears[0];
  const allBatches = batchResponse?.data || [];
  const activeBatches = allBatches.filter((item) => item.status === 'ACTIVE');
  const allRegulations = regulationResponse?.data || [];
  const activeRegulations = allRegulations.filter((item) => item.status === 'ACTIVE');

  // Auto-generate suggested class name based on Dept + Year + Section
  const computeSuggestedName = (deptId: string, yrNum: string, sec: string) => {
    if (!deptId || !yrNum || !sec.trim()) return '';
    const dept = allDepartments.find((d) => d.id === deptId);
    const deptCode = dept?.code || 'IT';
    const roman = ROMAN_NUMERALS[yrNum] || yrNum;
    return `${roman} ${deptCode}-${sec.trim().toUpperCase()}`;
  };

  const openForm = (classRow?: ClassSection) => {
    if (classRow) {
      setEditing(classRow);
      setForm({
        name: classRow.name,
        yearNumber: String(classRow.yearNumber),
        section: classRow.section,
        departmentId: classRow.departmentId || '',
        academicYearId: classRow.academicYearId || '',
        batchId: classRow.batchId || '',
        regulationId: classRow.regulationId || '',
        status: classRow.status,
      });
    } else {
      setEditing(null);
      const defaultDept = activeDepartments[0]?.id || '';
      const defaultYear = currentAcademicYear?.id || activeYears[0]?.id || '';
      const defaultBatch = activeBatches.find((b) => !defaultDept || b.departmentId === defaultDept)?.id || activeBatches[0]?.id || '';
      const defaultReg = activeRegulations[0]?.id || '';
      setForm({
        name: '',
        yearNumber: '1',
        section: 'A',
        departmentId: defaultDept,
        academicYearId: defaultYear,
        batchId: defaultBatch,
        regulationId: defaultReg,
        status: 'ACTIVE',
      });
    }
    setFormError('');
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const handleDeptChange = (newDeptId: string) => {
    const updatedForm = { ...form, departmentId: newDeptId };
    // Filter batches for selected department
    const availableBatches = activeBatches.filter((b) => b.departmentId === newDeptId);
    if (availableBatches.length > 0 && (!form.batchId || !availableBatches.some((b) => b.id === form.batchId))) {
      updatedForm.batchId = availableBatches[0].id;
    }
    // Auto update suggested name if not custom edited
    const suggested = computeSuggestedName(newDeptId, form.yearNumber, form.section);
    if (!editing || form.name === computeSuggestedName(form.departmentId, form.yearNumber, form.section)) {
      updatedForm.name = suggested;
    }
    setForm(updatedForm);
  };

  const handleYearChange = (newYearNum: string) => {
    const updatedForm = { ...form, yearNumber: newYearNum };
    const suggested = computeSuggestedName(form.departmentId, newYearNum, form.section);
    if (!editing || !form.name || form.name === computeSuggestedName(form.departmentId, form.yearNumber, form.section)) {
      updatedForm.name = suggested;
    }
    setForm(updatedForm);
  };

  const handleSectionChange = (newSection: string) => {
    const cleanSec = newSection.toUpperCase();
    const updatedForm = { ...form, section: cleanSec };
    const suggested = computeSuggestedName(form.departmentId, form.yearNumber, cleanSec);
    if (!editing || !form.name || form.name === computeSuggestedName(form.departmentId, form.yearNumber, form.section)) {
      updatedForm.name = suggested;
    }
    setForm(updatedForm);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError('');

    const yr = Number(form.yearNumber);
    const sec = form.section.trim().toUpperCase();

    if (!sec) {
      setFormError('Section cannot be empty (e.g. A, B, C).');
      setSaving(false);
      return;
    }

    if (!form.departmentId || !form.academicYearId || !form.batchId || !form.regulationId) {
      setFormError('Department, Academic Year, Admission Batch, and Regulation are all required.');
      setSaving(false);
      return;
    }

    // Client-side duplicate check
    const duplicate = classes.find((c) =>
      c.id !== editing?.id &&
      c.departmentId === form.departmentId &&
      c.academicYearId === form.academicYearId &&
      c.yearNumber === yr &&
      c.section.toUpperCase() === sec
    );

    if (duplicate) {
      setFormError(`A class section for this Department, Academic Year, Year ${yr}, and Section "${sec}" already exists (${duplicate.name}).`);
      setSaving(false);
      return;
    }

    const className = form.name.trim() || computeSuggestedName(form.departmentId, form.yearNumber, sec);

    try {
      const payload = {
        name: className,
        yearNumber: yr,
        section: sec,
        departmentId: form.departmentId,
        academicYearId: form.academicYearId,
        batchId: form.batchId,
        regulationId: form.regulationId,
        status: form.status,
      };

      if (editing) {
        await api.patch(`/api/classes/${editing.id}`, payload);
        showToast('success', `Class "${className}" updated successfully.`);
      } else {
        await api.post('/api/classes', payload);
        showToast('success', `Class "${className}" created successfully.`);
      }

      closeForm();
      await refetch();
    } catch (requestError: any) {
      setFormError(requestError.response?.data?.error?.message || requestError.message || 'Unable to save class.');
    } finally {
      setSaving(false);
    }
  };

  const promptStatusToggle = (classRow: ClassSection) => {
    setConfirmDialog({
      isOpen: true,
      classRow,
      action: classRow.status === 'ACTIVE' ? 'DEACTIVATE' : 'ACTIVATE',
      loading: false,
    });
  };

  const handleConfirmStatusToggle = async () => {
    if (!confirmDialog.classRow) return;
    const target = confirmDialog.classRow;
    const nextStatus = confirmDialog.action === 'DEACTIVATE' ? 'INACTIVE' : 'ACTIVE';

    setConfirmDialog((prev) => ({ ...prev, loading: true }));
    try {
      await api.patch(`/api/classes/${target.id}`, { status: nextStatus });
      showToast('success', `Class "${target.name}" is now ${nextStatus.toLowerCase()}.`);
      setConfirmDialog({ isOpen: false, classRow: null, action: 'DEACTIVATE', loading: false });
      await refetch();
    } catch (requestError: any) {
      showToast('error', requestError.response?.data?.error?.message || requestError.message || 'Unable to update class status.');
      setConfirmDialog((prev) => ({ ...prev, loading: false }));
    }
  };

  const handleDelete = async (e: React.MouseEvent, classRow: ClassSection) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete class "${classRow.name}"? If students, timetables, or attendance records are linked to this class, deletion will be blocked.`)) {
      return;
    }

    try {
      await api.delete(`/api/classes/${classRow.id}`);
      showToast('success', `Class "${classRow.name}" deleted successfully.`);
      await refetch();
    } catch (err: any) {
      showToast('error', err.response?.data?.error?.message || err.message || 'Failed to delete class.');
    }
  };

  // Filtered classes for table and hierarchy
  const filteredClasses = useMemo(() => {
    return classes.filter((item) => {
      if (deptFilter && item.departmentId !== deptFilter) return false;
      if (batchFilter && item.batchId !== batchFilter) return false;
      if (yearFilter && String(item.yearNumber) !== yearFilter) return false;
      if (statusFilter && item.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.name.toLowerCase().includes(q) ||
          item.section.toLowerCase().includes(q) ||
          (item.department && item.department.toLowerCase().includes(q)) ||
          (item.batch && item.batch.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [classes, deptFilter, batchFilter, yearFilter, statusFilter, searchQuery]);

  // Grouping for Hierarchy View: Department -> Batch -> Year Number -> Sections
  const hierarchyData = useMemo(() => {
    const tree: Record<string, { deptName: string; deptCode: string; batches: Record<string, { batchName: string; years: Record<number, ClassSection[]> }> }> = {};

    filteredClasses.forEach((cls) => {
      const deptKey = cls.departmentId || 'unknown';
      const dept = allDepartments.find((d) => d.id === cls.departmentId);
      const deptName = dept?.name || cls.department || 'Department';
      const deptCode = dept?.code || 'IT';

      if (!tree[deptKey]) {
        tree[deptKey] = { deptName, deptCode, batches: {} };
      }

      const batchKey = cls.batchId || 'unknown';
      const batchName = cls.batch || 'Batch';
      if (!tree[deptKey].batches[batchKey]) {
        tree[deptKey].batches[batchKey] = { batchName, years: {} };
      }

      if (!tree[deptKey].batches[batchKey].years[cls.yearNumber]) {
        tree[deptKey].batches[batchKey].years[cls.yearNumber] = [];
      }

      tree[deptKey].batches[batchKey].years[cls.yearNumber].push(cls);
    });

    return tree;
  }, [filteredClasses, allDepartments]);

  const columns: TableColumn<ClassSection>[] = useMemo(() => [
    { key: 'name', label: 'Class / Section', sortable: true },
    {
      key: 'yearNumber',
      label: 'Year',
      sortable: true,
      render: (val: any) => `Year ${val} (${ROMAN_NUMERALS[String(val)] || val})`,
    },
    { key: 'section', label: 'Section', sortable: true },
    {
      key: 'department',
      label: 'Department',
      render: (val: any, row: ClassSection) => {
        const d = allDepartments.find((item) => item.id === row.departmentId);
        return d ? `${d.name} (${d.code})` : val || '—';
      },
    },
    {
      key: 'batch',
      label: 'Admission Batch',
      render: (val: any, row: ClassSection) => {
        const b = allBatches.find((item) => item.id === row.batchId);
        return b?.name || val || '—';
      },
    },
    { key: 'academicYear', label: 'Academic Year' },
    { key: 'regulation', label: 'Regulation' },
    {
      key: 'status',
      label: 'Status',
      render: (value: any) => (
        <Badge variant={value === 'ACTIVE' ? 'success' : 'danger'}>{String(value)}</Badge>
      ),
    },
  ], [allDepartments, allBatches]);

  const renderActions = (classRow: ClassSection) => (
    <div style={{ display: 'flex', gap: '8px' }}>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          openForm(classRow);
        }}
      >
        Edit
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          promptStatusToggle(classRow);
        }}
        style={{ color: classRow.status === 'ACTIVE' ? 'var(--color-warning)' : 'var(--color-success)' }}
      >
        {classRow.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => handleDelete(e, classRow)}
        style={{ color: 'var(--color-danger)' }}
      >
        Delete
      </Button>
    </div>
  );

  return (
    <div className="classes-page" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Classes & Sections"
        breadcrumbs={[
          { label: 'Home', path: '/dashboard' },
          { label: 'Academic' },
          { label: 'Classes & Sections' },
        ]}
        actions={
          <div style={{ display: 'flex', gap: '10px' }}>
            <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                style={{
                  padding: '6px 12px',
                  background: viewMode === 'table' ? 'var(--color-primary)' : 'transparent',
                  color: viewMode === 'table' ? '#fff' : 'var(--color-text)',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Table View
              </button>
              <button
                type="button"
                onClick={() => setViewMode('hierarchy')}
                style={{
                  padding: '6px 12px',
                  background: viewMode === 'hierarchy' ? 'var(--color-primary)' : 'transparent',
                  color: viewMode === 'hierarchy' ? '#fff' : 'var(--color-text)',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Hierarchy Tree
              </button>
            </div>
            <Button onClick={() => openForm()} disabled={activeDepartments.length === 0 || activeBatches.length === 0}>
              Add Class / Section
            </Button>
          </div>
        }
      />

      {/* Filter and Search Bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
        <Input
          placeholder="Search classes or sections (e.g. I IT-A)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ maxWidth: '240px' }}
        />

        <div style={{ minWidth: '170px' }}>
          <Select
            value={deptFilter}
            onChange={setDeptFilter}
            options={[
              { value: '', label: 'All Departments' },
              ...allDepartments.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` })),
            ]}
          />
        </div>

        <div style={{ minWidth: '150px' }}>
          <Select
            value={batchFilter}
            onChange={setBatchFilter}
            options={[
              { value: '', label: 'All Batches' },
              ...allBatches.map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
        </div>

        <div style={{ minWidth: '130px' }}>
          <Select
            value={yearFilter}
            onChange={setYearFilter}
            options={[
              { value: '', label: 'All Years' },
              { value: '1', label: 'Year 1 (I)' },
              { value: '2', label: 'Year 2 (II)' },
              { value: '3', label: 'Year 3 (III)' },
              { value: '4', label: 'Year 4 (IV)' },
            ]}
          />
        </div>

        <div style={{ minWidth: '130px' }}>
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: '', label: 'All Statuses' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
            ]}
          />
        </div>

        <div style={{ marginLeft: 'auto', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
          Total Sections: <strong>{filteredClasses.length}</strong>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-danger)', borderRadius: '6px' }}>
          Classes could not be loaded: {error.message || 'Request failed.'}
          <Button variant="ghost" size="sm" onClick={() => void refetch()} style={{ marginLeft: '12px' }}>Retry</Button>
        </div>
      )}

      {(departmentError || yearError || batchError || regulationError) && (
        <div role="alert" style={{ padding: '12px', background: 'rgba(245, 158, 11, 0.1)', color: 'var(--color-warning)', borderRadius: '6px' }}>
          One or more reference lists could not be loaded. Please check backend connectivity.
        </div>
      )}

      {/* VIEW 1: DATA TABLE */}
      {viewMode === 'table' && (
        <DataTable
          columns={columns}
          data={filteredClasses}
          keyField="id"
          loading={loading}
          onRowClick={(row) => openForm(row)}
          actions={renderActions}
          emptyMessage={error ? 'Class data is unavailable.' : 'No classes match the current filter selection.'}
        />
      )}

      {/* VIEW 2: HIERARCHY TREE VIEW (Department -> Batch -> Class (Year) -> Section) */}
      {viewMode === 'hierarchy' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {Object.keys(hierarchyData).length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
              No classes or sections configured for the current filter.
            </div>
          ) : (
            Object.entries(hierarchyData).map(([deptId, dept]) => (
              <div key={deptId} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                  <span style={{ fontSize: '18px', fontWeight: 600 }}>🏢 {dept.deptName} ({dept.deptCode})</span>
                  <Badge variant="default">Department</Badge>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingLeft: '16px' }}>
                  {Object.entries(dept.batches).map(([batchId, batch]) => (
                    <div key={batchId} style={{ borderLeft: '3px solid var(--color-primary)', paddingLeft: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <span style={{ fontWeight: 600, fontSize: '15px' }}>🎓 Batch: {batch.batchName}</span>
                        <Badge variant="success">Admissions</Badge>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                        {Object.entries(batch.years).map(([yrNum, sections]) => (
                          <div key={yrNum} style={{ background: 'var(--bg-elevated, #fafafa)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '12px' }}>
                            <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px', color: 'var(--color-primary)' }}>
                              Year {yrNum} ({ROMAN_NUMERALS[yrNum] || yrNum}) — Class Cohort
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                              {sections.map((sec) => (
                                <div
                                  key={sec.id}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    background: 'var(--bg-surface, #fff)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '4px',
                                    padding: '4px 8px',
                                    fontSize: '13px',
                                  }}
                                >
                                  <strong>{sec.name}</strong>
                                  <Badge variant={sec.status === 'ACTIVE' ? 'success' : 'danger'} size="sm">
                                    {sec.status}
                                  </Badge>
                                  <button
                                    type="button"
                                    onClick={() => openForm(sec)}
                                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-primary)', fontSize: '12px' }}
                                  >
                                    ✎
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* CREATE / EDIT CLASS SECTION MODAL */}
      <Modal
        isOpen={formOpen}
        onClose={closeForm}
        title={editing ? `Edit Class Section: ${editing.name}` : 'Add Class & Section'}
        size="lg"
      >
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {formError && (
            <div role="alert" style={{ color: 'var(--color-danger)', fontSize: '14px', padding: '8px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '4px' }}>
              {formError}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
            <Select
              label="Department *"
              required
              value={form.departmentId}
              onChange={handleDeptChange}
              options={[
                { value: '', label: 'Select department' },
                ...activeDepartments.map((d) => ({ value: d.id, label: `${d.name} (${d.code})` })),
              ]}
            />

            <Select
              label="Admission Batch *"
              required
              value={form.batchId}
              onChange={(value) => setForm({ ...form, batchId: value })}
              options={[
                { value: '', label: 'Select batch' },
                ...activeBatches
                  .filter((b) => !form.departmentId || b.departmentId === form.departmentId)
                  .map((b) => ({ value: b.id, label: b.name })),
              ]}
            />

            <Select
              label="Academic Year *"
              required
              value={form.academicYearId}
              onChange={(value) => setForm({ ...form, academicYearId: value })}
              options={[
                { value: '', label: 'Select academic year' },
                ...activeYears.map((y) => ({ value: y.id, label: `${y.name}${y.isCurrent ? ' (Current)' : ''}` })),
              ]}
            />

            <Select
              label="Regulation *"
              required
              value={form.regulationId}
              onChange={(value) => setForm({ ...form, regulationId: value })}
              options={[
                { value: '', label: 'Select regulation' },
                ...activeRegulations.map((r) => ({ value: r.id, label: `${r.name}` })),
              ]}
            />

            <Select
              label="Year of Study *"
              required
              value={form.yearNumber}
              onChange={handleYearChange}
              options={[
                { value: '1', label: 'Year 1 (I Year)' },
                { value: '2', label: 'Year 2 (II Year)' },
                { value: '3', label: 'Year 3 (III Year)' },
                { value: '4', label: 'Year 4 (IV Year)' },
              ]}
            />

            <Input
              label="Section *"
              placeholder="e.g. A, B, C"
              required
              maxLength={10}
              value={form.section}
              onChange={(e) => handleSectionChange(e.target.value)}
            />
          </div>

          <Input
            label="Class Display Name *"
            placeholder="e.g. I IT-A"
            required
            maxLength={100}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            helpText="Auto-generated based on Department, Year, and Section (can be customized if required)."
          />

          {editing && (
            <Select
              label="Status"
              value={form.status}
              onChange={(val) => setForm({ ...form, status: val as any })}
              options={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' },
              ]}
            />
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
            <Button variant="ghost" onClick={closeForm} type="button" disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} disabled={activeDepartments.length === 0 || activeBatches.length === 0}>
              {editing ? 'Save Changes' : 'Create Class Section'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Confirmation Dialog for Deactivation / Activation */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirmStatusToggle}
        title={confirmDialog.action === 'DEACTIVATE' ? 'Deactivate Class Section?' : 'Activate Class Section?'}
        message={
          confirmDialog.action === 'DEACTIVATE'
            ? `Are you sure you want to deactivate class section "${confirmDialog.classRow?.name}"? Existing student attendance records, timetables, and assignments will be preserved, but new attendance sessions cannot be started for an inactive class.`
            : `Are you sure you want to activate class section "${confirmDialog.classRow?.name}"? It will become active for scheduling and attendance.`
        }
        confirmLabel={confirmDialog.action === 'DEACTIVATE' ? 'Deactivate' : 'Activate'}
        variant={confirmDialog.action === 'DEACTIVATE' ? 'danger' : 'primary'}
        loading={confirmDialog.loading}
      />
    </div>
  );
}

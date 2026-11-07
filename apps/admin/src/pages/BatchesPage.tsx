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
import type { ApiResponse, Batch, Department, TableColumn } from '../types';

export default function BatchesPage() {
  const { data: batchResponse, loading, error, refetch } = useApi<ApiResponse<Batch[]>>('/api/batches');
  const { data: departmentsResponse, error: departmentsError } = useApi<ApiResponse<Department[]>>('/api/departments');
  const { showToast } = useToast();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [startYear, setStartYear] = useState('');
  const [endYear, setEndYear] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [formError, setFormError] = useState('');

  // Filters
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Confirmation dialog for deactivation / activation
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    batch: Batch | null;
    action: 'DEACTIVATE' | 'ACTIVATE';
    loading: boolean;
  }>({
    isOpen: false,
    batch: null,
    action: 'DEACTIVATE',
    loading: false,
  });

  const batches = batchResponse?.data || [];
  const departments = departmentsResponse?.data || [];
  const activeDepartments = departments.filter((d) => d.status === 'ACTIVE');

  const openModal = (batch?: Batch) => {
    if (batch) {
      setEditingBatch(batch);
      setName(batch.name);
      setStartYear(String(batch.startYear));
      setEndYear(String(batch.endYear));
      setDepartmentId(batch.departmentId || '');
      setStatus(batch.status);
    } else {
      setEditingBatch(null);
      setName('');
      setStartYear('');
      setEndYear('');
      setDepartmentId(activeDepartments.length === 1 ? activeDepartments[0].id : '');
      setStatus('ACTIVE');
    }
    setFormError('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingBatch(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const start = Number(startYear);
    const end = Number(endYear);

    if (!name.trim()) {
      setFormError('Batch name is required.');
      return;
    }

    if (!start || !end) {
      setFormError('Start year and expected graduation year are required.');
      return;
    }

    if (start >= end) {
      setFormError('Admission start year must be less than graduation year.');
      return;
    }

    if (!departmentId) {
      setFormError('A department must be selected for this batch.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        startYear: start,
        endYear: end,
        departmentId,
        status,
      };

      if (editingBatch) {
        await api.patch(`/api/batches/${editingBatch.id}`, payload);
        showToast('success', `Batch "${payload.name}" updated successfully`);
      } else {
        await api.post('/api/batches', payload);
        showToast('success', `Batch "${payload.name}" created successfully`);
      }
      closeModal();
      refetch();
    } catch (err: any) {
      setFormError(err.response?.data?.error?.message || err.message || 'An error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const promptStatusToggle = (batch: Batch) => {
    setConfirmDialog({
      isOpen: true,
      batch,
      action: batch.status === 'ACTIVE' ? 'DEACTIVATE' : 'ACTIVATE',
      loading: false,
    });
  };

  const handleConfirmStatusToggle = async () => {
    if (!confirmDialog.batch) return;
    const targetBatch = confirmDialog.batch;
    const nextStatus = confirmDialog.action === 'DEACTIVATE' ? 'INACTIVE' : 'ACTIVE';

    setConfirmDialog((prev) => ({ ...prev, loading: true }));
    try {
      await api.patch(`/api/batches/${targetBatch.id}`, { status: nextStatus });
      showToast('success', `Batch "${targetBatch.name}" is now ${nextStatus.toLowerCase()}`);
      setConfirmDialog({ isOpen: false, batch: null, action: 'DEACTIVATE', loading: false });
      refetch();
    } catch (err: any) {
      showToast('error', err.response?.data?.error?.message || err.message || 'Failed to update batch status');
      setConfirmDialog((prev) => ({ ...prev, loading: false }));
    }
  };

  const handleDelete = async (e: React.MouseEvent, batch: Batch) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete batch "${batch.name}"? If classes are associated with it, deletion will be blocked.`)) {
      return;
    }

    try {
      await api.delete(`/api/batches/${batch.id}`);
      showToast('success', `Batch "${batch.name}" deleted successfully`);
      refetch();
    } catch (err: any) {
      showToast('error', err.response?.data?.error?.message || err.message || 'Failed to delete batch');
    }
  };

  const filteredBatches = useMemo(() => {
    return batches.filter((b) => {
      if (deptFilter && b.departmentId !== deptFilter) return false;
      if (statusFilter && b.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return b.name.toLowerCase().includes(q) || (b.department && b.department.toLowerCase().includes(q));
      }
      return true;
    });
  }, [batches, deptFilter, statusFilter, searchQuery]);

  const columns: TableColumn<Batch>[] = useMemo(() => [
    { key: 'name', label: 'Admission Batch', sortable: true },
    { key: 'startYear', label: 'Start Year', sortable: true },
    { key: 'endYear', label: 'Graduation Year', sortable: true },
    {
      key: 'department',
      label: 'Department',
      render: (val: any, row: Batch) => {
        const dept = departments.find((d) => d.id === row.departmentId);
        return dept ? `${dept.name} (${dept.code})` : val || '—';
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: any) => (
        <Badge variant={val === 'ACTIVE' ? 'success' : 'danger'}>{val}</Badge>
      ),
    },
  ], [departments]);

  const renderActions = (row: Batch) => (
    <div style={{ display: 'flex', gap: '8px' }}>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          openModal(row);
        }}
      >
        Edit
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          promptStatusToggle(row);
        }}
        style={{ color: row.status === 'ACTIVE' ? 'var(--color-warning)' : 'var(--color-success)' }}
      >
        {row.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => handleDelete(e, row)}
        style={{ color: 'var(--color-danger)' }}
      >
        Delete
      </Button>
    </div>
  );

  return (
    <div className="batches-page" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Admission Batches"
        breadcrumbs={[
          { label: 'Home', path: '/dashboard' },
          { label: 'Academic' },
          { label: 'Batches' },
        ]}
        actions={
          <Button onClick={() => openModal()} disabled={activeDepartments.length === 0}>
            Add Batch
          </Button>
        }
      />

      {/* Filter and Search Bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
        <Input
          placeholder="Search batches..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ maxWidth: '240px' }}
        />

        <div style={{ minWidth: '180px' }}>
          <Select
            value={deptFilter}
            onChange={setDeptFilter}
            options={[
              { value: '', label: 'All Departments' },
              ...departments.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` })),
            ]}
          />
        </div>

        <div style={{ minWidth: '140px' }}>
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
          Showing <strong>{filteredBatches.length}</strong> of {batches.length} batches
        </div>
      </div>

      {error && (
        <div role="alert" style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-danger)', borderRadius: '6px' }}>
          Batches could not be loaded: {error.message || 'Request failed.'}
          <Button variant="ghost" size="sm" onClick={() => void refetch()} style={{ marginLeft: '12px' }}>Retry</Button>
        </div>
      )}

      {departmentsError && (
        <div role="alert" style={{ padding: '12px', background: 'rgba(245, 158, 11, 0.1)', color: 'var(--color-warning)', borderRadius: '6px' }}>
          Departments could not be loaded; batch creation is unavailable: {departmentsError.message || 'Request failed.'}
        </div>
      )}

      <DataTable
        columns={columns}
        data={filteredBatches}
        keyField="id"
        loading={loading}
        onRowClick={(row) => openModal(row)}
        actions={renderActions}
        emptyMessage={error ? 'Batch data is unavailable.' : 'No batches match the selected criteria.'}
      />

      {/* Create / Edit Batch Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingBatch ? 'Edit Admission Batch' : 'Add Admission Batch'}
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {formError && (
            <div role="alert" style={{ color: 'var(--color-danger)', fontSize: '14px', padding: '8px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '4px' }}>
              {formError}
            </div>
          )}

          <Input
            label="Batch Name"
            placeholder="e.g. 2024–2028"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={50}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Input
              label="Admission Start Year"
              type="number"
              placeholder="e.g. 2024"
              value={startYear}
              onChange={(e) => {
                setStartYear(e.target.value);
                if (e.target.value && !endYear && !editingBatch) {
                  setEndYear(String(Number(e.target.value) + 4));
                  if (!name) setName(`${e.target.value}–${Number(e.target.value) + 4}`);
                }
              }}
              required
              min={2000}
              max={2200}
            />

            <Input
              label="Expected Graduation Year"
              type="number"
              placeholder="e.g. 2028"
              value={endYear}
              onChange={(e) => setEndYear(e.target.value)}
              required
              min={2001}
              max={2205}
            />
          </div>

          <Select
            label="Department"
            value={departmentId}
            onChange={setDepartmentId}
            options={[
              { value: '', label: 'Select department' },
              ...activeDepartments.map((d) => ({
                value: d.id,
                label: `${d.name} (${d.code})`,
              })),
            ]}
          />

          {editingBatch && (
            <Select
              label="Status"
              value={status}
              onChange={(val) => setStatus(val as any)}
              options={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' },
              ]}
            />
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
            <Button variant="ghost" onClick={closeModal} type="button">Cancel</Button>
            <Button type="submit" loading={isSubmitting} disabled={activeDepartments.length === 0}>
              {editingBatch ? 'Save Changes' : 'Create Batch'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Confirmation Dialog for Deactivation / Activation */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirmStatusToggle}
        title={confirmDialog.action === 'DEACTIVATE' ? 'Deactivate Admission Batch?' : 'Activate Admission Batch?'}
        message={
          confirmDialog.action === 'DEACTIVATE'
            ? `Are you sure you want to deactivate batch "${confirmDialog.batch?.name}"? Existing classes and students will remain in the database, but new classes cannot be scheduled for an inactive batch.`
            : `Are you sure you want to activate batch "${confirmDialog.batch?.name}"? It will become available for new class schedules.`
        }
        confirmLabel={confirmDialog.action === 'DEACTIVATE' ? 'Deactivate' : 'Activate'}
        variant={confirmDialog.action === 'DEACTIVATE' ? 'danger' : 'primary'}
        loading={confirmDialog.loading}
      />
    </div>
  );
}
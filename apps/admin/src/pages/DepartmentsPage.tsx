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
import type { Department, ApiResponse, TableColumn } from '../types';

export default function DepartmentsPage() {
  const { data: response, loading, error, refetch } = useApi<ApiResponse<Department[]>>('/api/departments');
  const { showToast } = useToast();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [formError, setFormError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Confirmation dialog state for deactivation / activation
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    dept: Department | null;
    action: 'DEACTIVATE' | 'ACTIVATE';
    loading: boolean;
  }>({
    isOpen: false,
    dept: null,
    action: 'DEACTIVATE',
    loading: false,
  });

  const openModal = (dept?: Department) => {
    if (dept) {
      setEditingDept(dept);
      setName(dept.name);
      setCode(dept.code);
      setStatus(dept.status);
    } else {
      setEditingDept(null);
      setName('');
      setCode('');
      setStatus('ACTIVE');
    }
    setFormError('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingDept(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!name.trim() || !code.trim()) {
      setFormError('Department name and code are required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        status,
      };

      if (editingDept) {
        await api.patch(`/api/departments/${editingDept.id}`, payload);
        showToast('success', `Department "${payload.name}" updated successfully`);
      } else {
        await api.post('/api/departments', payload);
        showToast('success', `Department "${payload.name}" created successfully`);
      }
      closeModal();
      refetch();
    } catch (err: any) {
      setFormError(err.response?.data?.error?.message || err.message || 'An error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const promptStatusToggle = (dept: Department) => {
    setConfirmDialog({
      isOpen: true,
      dept,
      action: dept.status === 'ACTIVE' ? 'DEACTIVATE' : 'ACTIVATE',
      loading: false,
    });
  };

  const handleConfirmStatusToggle = async () => {
    if (!confirmDialog.dept) return;
    const targetDept = confirmDialog.dept;
    const nextStatus = confirmDialog.action === 'DEACTIVATE' ? 'INACTIVE' : 'ACTIVE';

    setConfirmDialog((prev) => ({ ...prev, loading: true }));
    try {
      await api.patch(`/api/departments/${targetDept.id}`, { status: nextStatus });
      showToast('success', `Department "${targetDept.name}" is now ${nextStatus.toLowerCase()}`);
      setConfirmDialog({ isOpen: false, dept: null, action: 'DEACTIVATE', loading: false });
      refetch();
    } catch (err: any) {
      showToast('error', err.response?.data?.error?.message || err.message || 'Failed to update department status');
      setConfirmDialog((prev) => ({ ...prev, loading: false }));
    }
  };

  const handleDelete = async (e: React.MouseEvent, dept: Department) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete department "${dept.name}" (${dept.code})? If this department has batches or classes, deletion will be blocked.`)) {
      return;
    }

    try {
      await api.delete(`/api/departments/${dept.id}`);
      showToast('success', `Department "${dept.name}" deleted successfully`);
      refetch();
    } catch (err: any) {
      showToast('error', err.response?.data?.error?.message || err.message || 'Failed to delete department');
    }
  };

  const filteredData = useMemo(() => {
    const list = response?.data || [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((d) => d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q));
  }, [response?.data, searchQuery]);

  const columns: TableColumn<Department>[] = useMemo(() => [
    { key: 'name', label: 'Department Name', sortable: true },
    { key: 'code', label: 'Code', sortable: true },
    {
      key: 'status',
      label: 'Status',
      render: (val: any) => (
        <Badge variant={val === 'ACTIVE' ? 'success' : 'danger'}>{val}</Badge>
      ),
    },
    {
      key: 'createdAt',
      label: 'Created',
      render: (val: any) => (val ? new Date(val).toLocaleDateString() : '—'),
    },
  ], []);

  const renderActions = (row: Department) => (
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
    <div className="departments-page" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Departments"
        breadcrumbs={[
          { label: 'Home', path: '/dashboard' },
          { label: 'Academic' },
          { label: 'Departments' },
        ]}
        actions={
          <Button onClick={() => openModal()}>Add Department</Button>
        }
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <Input
          placeholder="Search by name or code (e.g. IT, Computer Science)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ maxWidth: '360px' }}
        />
        <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
          Total Departments: <strong>{filteredData.length}</strong>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-danger)', borderRadius: '6px' }}>
          Departments could not be loaded: {error.message || 'Request failed.'}
          <Button variant="ghost" size="sm" onClick={() => void refetch()} style={{ marginLeft: '12px' }}>Retry</Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={filteredData}
        keyField="id"
        loading={loading}
        onRowClick={(row) => openModal(row)}
        actions={renderActions}
        emptyMessage={error ? 'Department data is unavailable.' : 'No departments configured yet.'}
      />

      {/* Create / Edit Department Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingDept ? 'Edit Department' : 'Add Department'}
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {formError && (
            <div role="alert" style={{ color: 'var(--color-danger)', fontSize: '14px', padding: '8px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '4px' }}>
              {formError}
            </div>
          )}

          <Input
            label="Department Name"
            placeholder="e.g. Information Technology"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={255}
          />

          <Input
            label="Department Code"
            placeholder="e.g. IT, CSE, ECE"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            maxLength={50}
          />

          <Select
            label="Status"
            value={status}
            onChange={(val) => setStatus(val as any)}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
            ]}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
            <Button variant="ghost" onClick={closeModal} type="button">Cancel</Button>
            <Button type="submit" loading={isSubmitting}>
              {editingDept ? 'Save Changes' : 'Create Department'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Confirmation Dialog for Deactivation / Activation */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirmStatusToggle}
        title={confirmDialog.action === 'DEACTIVATE' ? 'Deactivate Department?' : 'Activate Department?'}
        message={
          confirmDialog.action === 'DEACTIVATE'
            ? `Are you sure you want to deactivate department "${confirmDialog.dept?.name}" (${confirmDialog.dept?.code})? Active batches and classes will remain in the database, but new batches cannot be assigned to an inactive department.`
            : `Are you sure you want to activate department "${confirmDialog.dept?.name}" (${confirmDialog.dept?.code})? It will become available for new batches and classes.`
        }
        confirmLabel={confirmDialog.action === 'DEACTIVATE' ? 'Deactivate' : 'Activate'}
        variant={confirmDialog.action === 'DEACTIVATE' ? 'danger' : 'primary'}
        loading={confirmDialog.loading}
      />
    </div>
  );
}

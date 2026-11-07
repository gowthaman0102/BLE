import { useState, useEffect } from 'react';
import Modal from '../Modal';
import Select from '../Select';
import Button from '../Button';
import ConfirmDialog from '../ConfirmDialog';
import { useToast } from '../../hooks/useToast';
import { useApi } from '../../hooks/useApi';
import { timetableService } from '../../services/timetableService';
import type { ApiResponse, TimetableEntry, Period } from '../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: TimetableEntry | null;
  academicYearId: string;
  classId: string;
  defaultDay?: string;
  defaultPeriodId?: string;
}

const DAYS = [
  { value: 'MONDAY', label: 'Monday' },
  { value: 'TUESDAY', label: 'Tuesday' },
  { value: 'WEDNESDAY', label: 'Wednesday' },
  { value: 'THURSDAY', label: 'Thursday' },
  { value: 'FRIDAY', label: 'Friday' },
  { value: 'SATURDAY', label: 'Saturday' }
];

export default function TimetableEntryModal({ 
  isOpen, onClose, onSuccess, initialData, academicYearId, classId, defaultDay, defaultPeriodId 
}: Props) {
  const [dayOfWeek, setDayOfWeek] = useState(initialData?.dayOfWeek || defaultDay || 'MONDAY');
  const [periodId, setPeriodId] = useState(initialData?.periodId || defaultPeriodId || '');
  const [subjectId, setSubjectId] = useState(initialData?.subjectId || '');
  const [staffId, setStaffId] = useState(initialData?.staffId || '');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(initialData?.status || 'ACTIVE');
  
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [modalError, setModalError] = useState('');
  const { showToast } = useToast();

  const { data: periodsRes } = useApi<ApiResponse<Period[]>>('/api/periods');
  const { data: subjectsRes } = useApi<ApiResponse<any>>('/api/subjects?status=ACTIVE&limit=1000');
  const { data: staffRes } = useApi<ApiResponse<any>>('/api/staff?status=ACTIVE&limit=100');

  useEffect(() => {
    if (isOpen) {
      setDayOfWeek(initialData?.dayOfWeek || defaultDay || 'MONDAY');
      setPeriodId(initialData?.periodId || defaultPeriodId || '');
      setSubjectId(initialData?.subjectId || '');
      setStaffId(initialData?.staffId || '');
      setStatus(initialData?.status || 'ACTIVE');
      setModalError('');
      setDeleteConfirmOpen(false);
    }
  }, [isOpen, initialData, defaultDay, defaultPeriodId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');
    if (!periodId || !subjectId || !staffId) {
      setModalError('Please fill in all required fields.');
      showToast('warning', 'Please fill all fields');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        academicYearId,
        classId,
        dayOfWeek,
        periodId,
        subjectId,
        staffId,
        status
      };

      if (initialData) {
        await timetableService.updateTimetableEntry(initialData.id, payload);
        showToast('success', 'Timetable slot updated successfully.');
      } else {
        await timetableService.createTimetableEntry(payload);
        showToast('success', 'Timetable slot created successfully.');
      }
      onSuccess();
      onClose();
    } catch (error: any) {
      const errMsg = error.response?.data?.error?.message || error?.message || 'Failed to save timetable slot.';
      setModalError(errMsg);
      showToast('error', errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!initialData) return;
    
    setDeleting(true);
    setModalError('');
    try {
      await timetableService.deleteTimetableEntry(initialData.id);
      showToast('success', 'Timetable entry deleted successfully.');
      setDeleteConfirmOpen(false);
      onSuccess();
      onClose();
    } catch (error: any) {
      const errMsg = error.response?.data?.error?.message || error?.message || 'Failed to delete slot.';
      setModalError(errMsg);
      showToast('error', errMsg);
      setDeleteConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  const periodOptions = periodsRes?.data
    ?.filter(p => !p.name.includes('ATT-') && p.startTime !== '00:00:00')
    ?.map(p => ({
      value: p.id,
      label: `${p.name} (${(p.startTime || '').substring(0, 5)} - ${(p.endTime || '').substring(0, 5)})`
    })) || [];

  const subjectOptions = subjectsRes?.data?.subjects?.map((s: any) => ({
    value: s.id,
    label: `${s.code} - ${s.name}`
  })) || [];

  const TEACHING_ROLES = ['STAFF', 'FACULTY', 'HOD', 'DEPUTY_HOD', 'CLASS_COUNSELOR'];
  const staffOptions = (staffRes?.data?.staff || [])
    .filter((s: any) => s.status === 'ACTIVE' && s.roles?.some((r: string) => TEACHING_ROLES.includes(r)))
    .map((s: any) => ({
      value: s.id,
      label: `${s.staffCode ? s.staffCode + ' - ' : ''}${s.name}`
    }));

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={initialData ? 'Edit Timetable Entry' : 'Create Timetable Entry'}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {modalError && (
            <div role="alert" style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              padding: '10px 14px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
            }}>
              {modalError}
            </div>
          )}

          <Select
            label="Day of Week *"
            value={dayOfWeek}
            onChange={setDayOfWeek}
            options={DAYS}
            required
          />
          
          <Select
            label="Period *"
            value={periodId}
            onChange={setPeriodId}
            options={[{ value: '', label: 'Select Period...' }, ...periodOptions]}
            required
          />

          <Select
            label="Subject *"
            value={subjectId}
            onChange={setSubjectId}
            options={[{ value: '', label: 'Select Subject...' }, ...subjectOptions]}
            required
          />

          <Select
            label="Faculty / Staff *"
            value={staffId}
            onChange={setStaffId}
            options={[{ value: '', label: 'Select Staff...' }, ...staffOptions]}
            required
          />

          {initialData && (
            <Select
              label="Status"
              value={status}
              onChange={(val) => setStatus(val as 'ACTIVE' | 'INACTIVE')}
              options={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' }
              ]}
            />
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
            {initialData && (
              <Button
                variant="danger"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={deleting || submitting}
                type="button"
                style={{ marginRight: 'auto' }}
              >
                Delete Slot
              </Button>
            )}
            <Button variant="secondary" onClick={onClose} disabled={submitting} type="button">
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : initialData ? 'Save Changes' : 'Create Entry'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Confirmation Dialog for Deleting Slot */}
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleConfirmDelete}
        title="Delete Timetable Slot"
        message="Are you sure you want to permanently delete this scheduled timetable slot? Note: Slots with conducted attendance sessions cannot be deleted and should be deactivated instead."
        confirmLabel="Delete Slot"
        variant="danger"
        loading={deleting}
      />
    </>
  );
}

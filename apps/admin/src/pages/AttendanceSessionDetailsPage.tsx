import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Badge from '../components/Badge';
import Button from '../components/Button';
import Modal from '../components/Modal';
import Select from '../components/Select';
import Input from '../components/Input';
import { useToast } from '../hooks/useToast';
import { attendanceService } from '../services/attendanceService';
import type { AttendanceSession, LiveAttendanceData, LiveAttendanceStudent } from '../types';
import DataTable from '../components/DataTable';

export default function AttendanceSessionDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [liveData, setLiveData] = useState<LiveAttendanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [bleLoading, setBleLoading] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [liveError, setLiveError] = useState('');
  const [lastLiveRefresh, setLastLiveRefresh] = useState<Date | null>(null);

  // Correction Modal state
  const [selectedStudent, setSelectedStudent] = useState<LiveAttendanceStudent | null>(null);
  const [newStatus, setNewStatus] = useState<string>('PRESENT');
  const [correctionReason, setCorrectionReason] = useState<string>('');
  const [submittingCorrection, setSubmittingCorrection] = useState(false);

  const { showToast } = useToast();
  const liveRequestInFlight = useRef(false);

  const fetchLiveAttendance = useCallback(async () => {
    if (!id || liveRequestInFlight.current) return;
    liveRequestInFlight.current = true;
    try {
      const res = await attendanceService.getLiveAttendance(id);
      setLiveData(res.data);
      setLiveError('');
      setLastLiveRefresh(new Date());
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
        ? err.message
        : 'Failed to refresh live attendance.';
      setLiveError(message);
    } finally {
      liveRequestInFlight.current = false;
    }
  }, [id]);

  const fetchSession = useCallback(async () => {
    if (!id) return;
    try {
      const res = await attendanceService.getSession(id);
      setSession(res.data);
      if (res.data.status === 'ACTIVE' || res.data.status === 'COMPLETED') {
        await fetchLiveAttendance();
      }
      setSessionError('');
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
        ? err.message
        : 'Failed to fetch session.';
      setSessionError(message);
      showToast('error', message);
    } finally {
      setLoading(false);
    }
  }, [fetchLiveAttendance, id, showToast]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void fetchSession(), 0);
    return () => window.clearTimeout(initialRefresh);
  }, [fetchSession]);

  useEffect(() => {
    if (!session || !['ACTIVE', 'COMPLETED'].includes(session.status)) return;
    const interval = window.setInterval(() => void fetchLiveAttendance(), 5000);
    return () => clearInterval(interval);
  }, [fetchLiveAttendance, session]);

  useEffect(() => {
    if (!session || !['ACTIVE', 'SCHEDULED'].includes(session.status)) return;
    const interval = window.setInterval(() => void fetchSession(), 15000);
    return () => window.clearInterval(interval);
  }, [fetchSession, session]);

  const handleStartBle = async () => {
    if (!id) return;
    setBleLoading(true);
    try {
      await attendanceService.startBle(id);
      showToast('success', 'BLE Scanning Started');
      fetchLiveAttendance();
    } catch (err: any) {
      showToast('error', err.response?.data?.error?.message || 'Failed to start BLE');
    } finally {
      setBleLoading(false);
    }
  };

  const handleStopBle = async () => {
    if (!id) return;
    setBleLoading(true);
    try {
      await attendanceService.stopBle(id);
      showToast('success', 'BLE Scanning Stopped');
      fetchLiveAttendance();
    } catch (err: any) {
      showToast('error', err.response?.data?.error?.message || 'Failed to stop BLE');
    } finally {
      setBleLoading(false);
    }
  };

  const handleEndSession = async () => {
    if (!id || !window.confirm('Are you sure you want to end this active session?')) return;
    try {
      await attendanceService.endSession(id);
      showToast('success', 'Session ended successfully');
      fetchSession();
    } catch (err: any) {
      showToast('error', err.response?.data?.error?.message || 'Failed to end session');
    }
  };

  const handleCancelSession = async () => {
    if (!id) return;
    const reason = window.prompt('Enter reason for cancellation:');
    if (!reason) return;

    try {
      await attendanceService.cancelSession(id, reason);
      showToast('success', 'Session cancelled successfully');
      fetchSession();
    } catch (err: any) {
      showToast('error', err.response?.data?.error?.message || 'Failed to cancel session');
    }
  };

  const handleOpenCorrection = (student: LiveAttendanceStudent) => {
    setSelectedStudent(student);
    setNewStatus(student.status === 'PRESENT' ? 'ABSENT' : 'PRESENT');
    setCorrectionReason('');
  };

  const handleSubmitCorrection = async () => {
    if (!id || !selectedStudent) return;
    if (!correctionReason.trim()) {
      showToast('error', 'Please provide a reason for the manual attendance correction.');
      return;
    }

    setSubmittingCorrection(true);
    try {
      await attendanceService.manualMark({
        sessionId: id,
        studentId: selectedStudent.studentId,
        status: newStatus,
        reason: correctionReason.trim(),
      });
      showToast('success', `Attendance updated for ${selectedStudent.name} (${newStatus})`);
      setSelectedStudent(null);
      fetchLiveAttendance();
    } catch (err: any) {
      showToast('error', err.response?.data?.error?.message || err.message || 'Failed to update attendance');
    } finally {
      setSubmittingCorrection(false);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (!session) return <div role="alert">{sessionError || 'Session not found.'}</div>;

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'info' | 'warning' | 'success' | 'danger'> = {
      SCHEDULED: 'default',
      ACTIVE: 'info',
      COMPLETED: 'success',
      CANCELLED: 'danger',
      EXPIRED: 'warning',
    };
    return <Badge variant={variants[status] || 'default'}>{status}</Badge>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <PageHeader
        title="Session Details"
        breadcrumbs={[
          { label: 'Home', path: '/dashboard' },
          { label: 'Attendance', path: '/attendance' },
          { label: 'Session' },
        ]}
        actions={
          <div style={{ display: 'flex', gap: '12px' }}>
            {session.status === 'ACTIVE' && (
              <>
                <Button onClick={handleStartBle} disabled={bleLoading} variant="secondary">
                  Start BLE
                </Button>
                <Button onClick={handleStopBle} disabled={bleLoading} variant="secondary">
                  Stop BLE
                </Button>
                <Button onClick={handleEndSession} variant="primary">
                  End Session
                </Button>
              </>
            )}
            {(session.status === 'ACTIVE' || session.status === 'SCHEDULED') && (
              <Button onClick={handleCancelSession} variant="danger">
                Cancel Session
              </Button>
            )}
          </div>
        }
      />

      {sessionError && <p role="alert">Session data could not be refreshed. {sessionError}</p>}
      {liveError && (
        <p role="alert">
          Live attendance could not be refreshed; displayed attendance may be stale. {liveError}
        </p>
      )}
      {!liveError && lastLiveRefresh && (
        <p role="status" aria-live="polite">Attendance last refreshed {lastLiveRefresh.toLocaleTimeString()}.</p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        <Card title="Session Information">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <strong>Session ID:</strong> {session.id}
            </div>
            <div>
              <strong>Status:</strong> {getStatusBadge(session.status)}
            </div>
            <div>
              <strong>Date:</strong> {new Date(session.sessionDate).toLocaleDateString()}
            </div>
            <div>
              <strong>Scheduled Time:</strong> {session.periodStartTime} - {session.periodEndTime} ({session.periodName})
            </div>
            <div>
              <strong>Actual Start:</strong>{' '}
              {session.startedAt ? new Date(session.startedAt).toLocaleTimeString() : 'Not started'}
            </div>
            <div>
              <strong>Actual End:</strong>{' '}
              {session.endedAt ? new Date(session.endedAt).toLocaleTimeString() : 'Not ended'}
            </div>
            {session.cancellationReason && (
              <div>
                <strong>Cancellation Reason:</strong> {session.cancellationReason}
              </div>
            )}
          </div>
        </Card>

        {liveData ? (
          <Card title="Live Attendance Stats">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <strong>Total Students:</strong> {liveData.totalStudents}
              </div>
              <div>
                <strong>Detected / Present:</strong>{' '}
                <span style={{ color: 'var(--success-color, #059669)' }}>{liveData.detectedStudents}</span>
              </div>
              <div>
                <strong>Not Detected / Absent:</strong>{' '}
                <span style={{ color: 'var(--danger-color, #DC2626)' }}>{liveData.notDetectedStudents}</span>
              </div>
              <div>
                <strong>Attendance Percentage:</strong> {liveData.percentage}%
              </div>
            </div>
          </Card>
        ) : (
          <Card title="Academic Details">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <strong>Class:</strong> {session.className}
              </div>
              <div>
                <strong>Subject:</strong> {session.subjectName}
              </div>
              <div>
                <strong>Staff:</strong> {session.staffName}
              </div>
            </div>
          </Card>
        )}
      </div>

      {liveData && (
        <Card title="Student Attendance List & Manual Marking" padding="none">
          <DataTable
            data={liveData.students}
            keyField="studentId"
            columns={[
              { key: 'registerNumber', label: 'Register Number' },
              { key: 'name', label: 'Student Name' },
              {
                key: 'status',
                label: 'Status',
                render: (val) => (
                  <Badge variant={val === 'PRESENT' ? 'success' : 'danger'}>
                    {val as string}
                  </Badge>
                ),
              },
              {
                key: 'source',
                label: 'Source / Verification',
                render: (val, row: LiveAttendanceStudent) => (
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {val === 'MANUAL' ? (
                      <Badge variant="warning">MANUAL</Badge>
                    ) : val === 'BLE' ? (
                      <Badge variant="info">BLE</Badge>
                    ) : (
                      <span>-</span>
                    )}
                    {row.faceVerificationStatus === 'FALLBACK_PENDING' && (
                      <Badge variant="warning">FALLBACK REQUESTED</Badge>
                    )}
                    {row.faceVerificationStatus === 'VERIFIED' && (
                      <Badge variant="success">FACE VERIFIED</Badge>
                    )}
                  </div>
                ),
              },
              {
                key: 'firstDetectedAt',
                label: 'First Detected',
                render: (val) => (val ? new Date(val as string).toLocaleTimeString() : '-'),
              },
              {
                key: 'lastDetectedAt',
                label: 'Last Detected',
                render: (val) => (val ? new Date(val as string).toLocaleTimeString() : '-'),
              },
              { key: 'detectionCount', label: 'Pings' },
            ]}
            actions={(row: LiveAttendanceStudent) => (
              <Button variant="ghost" size="sm" onClick={() => handleOpenCorrection(row)}>
                Correct / Mark
              </Button>
            )}
          />
        </Card>
      )}

      {/* Manual Attendance Marking / Correction Modal */}
      {selectedStudent && (
        <Modal
          isOpen={!!selectedStudent}
          onClose={() => setSelectedStudent(null)}
          title={`Manual Attendance Correction: ${selectedStudent.name}`}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <Button variant="secondary" onClick={() => setSelectedStudent(null)} disabled={submittingCorrection}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSubmitCorrection} disabled={submittingCorrection}>
                {submittingCorrection ? 'Saving...' : 'Confirm Correction'}
              </Button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ padding: '12px', background: '#F1F6FC', borderRadius: '6px', fontSize: '14px' }}>
              <div><strong>Student:</strong> {selectedStudent.name} ({selectedStudent.registerNumber})</div>
              <div><strong>Current Recorded Status:</strong> {selectedStudent.status}</div>
              <div><strong>Session:</strong> {session.className} &bull; {session.subjectName}</div>
            </div>

            <Select
              label="New Attendance Status *"
              value={newStatus}
              onChange={setNewStatus}
              options={[
                { value: 'PRESENT', label: 'Present' },
                { value: 'ABSENT', label: 'Absent' },
                { value: 'LATE', label: 'Late' },
                { value: 'MANUAL', label: 'Manual' },
              ]}
            />

            <Input
              label="Correction Reason / Rationale *"
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
              placeholder="e.g. Device Bluetooth issue verified by class counselor, On-Duty approved"
              required
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

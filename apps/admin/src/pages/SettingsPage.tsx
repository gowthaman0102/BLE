import { useState, useEffect } from 'react';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import Button from '../components/Button';
import { settingsService } from '../services/settingsService';
import { periodService, type Period } from '../services/periodService';
import './SettingsPage.css';

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'periods', label: 'Periods' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'system', label: 'System Info' },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');
  const [loading, setLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Periods State
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodsError, setPeriodsError] = useState<string | null>(null);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<Partial<Period> | null>(null);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const res = await settingsService.getSettings();
      if (res.success) {
        setSettings(res.data);
      }
    } catch (_err: any) {
      showMessage('error', 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const fetchPeriods = async () => {
    try {
      const res = await periodService.getPeriods();
      if (res.success) {
        setPeriods(res.data || []);
        setPeriodsError(null);
      } else {
        setPeriodsError('The server did not return period data.');
      }
    } catch (err) {
      setPeriodsError(err instanceof Error ? err.message : 'Failed to load periods.');
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    if (activeTab === 'periods') fetchPeriods();
  }, [activeTab]);

  const handleSettingChange = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const saveSettings = async (keys: string[]) => {
    try {
      setSaveLoading(true);
      const updates = keys.map(k => ({ key: k, value: settings[k] || '' }));
      const res = await settingsService.updateSettings(updates);
      if (res.success) {
        showMessage('success', 'Settings updated successfully');
      } else {
        showMessage('error', 'Failed to update settings');
      }
    } catch (err: any) {
      showMessage('error', err.message || 'Error updating settings');
    } finally {
      setSaveLoading(false);
    }
  };

  // --- Periods Management ---
  const savePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingPeriod?.id) {
        await periodService.updatePeriod(editingPeriod.id, editingPeriod);
        showMessage('success', 'Period updated successfully');
      } else {
        await periodService.createPeriod(editingPeriod!);
        showMessage('success', 'Period created successfully');
      }
      setPeriodModalOpen(false);
      fetchPeriods();
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to save period');
    }
  };

  const deletePeriod = async (id: string) => {
    if (!window.confirm("Are you sure you want to deactivate this period? Deactivation is preferred to protect historical records.")) return;
    try {
      await periodService.deletePeriod(id);
      showMessage('success', 'Period deactivated successfully');
      fetchPeriods();
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to deactivate period');
    }
  };



  return (
    <div className="settings-page">
      <PageHeader
        title="System Settings"
        subtitle="Manage global system preferences, academic configurations, and administrative tools."
      />

      <div className="settings-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {message && (
        <div style={{ padding: '1rem', borderRadius: '8px', background: message.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: message.type === 'success' ? '#10b981' : '#ef4444', border: `1px solid ${message.type === 'success' ? '#10b981' : '#ef4444'}` }}>
          {message.text}
        </div>
      )}

      <Card>
        {loading ? (
          <p>Loading settings...</p>
        ) : (
          <div className="settings-content">
            
            {/* GENERAL SETTINGS */}
            {activeTab === 'general' && (
              <div>
                <h3 style={{ marginBottom: '1.5rem' }}>General Preferences</h3>
                <div className="settings-form-group">
                  <label>Institution Name</label>
                  <input 
                    type="text" 
                    value={settings.INSTITUTION_NAME || ''} 
                    onChange={e => handleSettingChange('INSTITUTION_NAME', e.target.value)} 
                  />
                  <span className="description">Displayed on reports and official exports.</span>
                </div>
                <div className="settings-form-group">
                  <label>System Timezone</label>
                  <input type="text" value={settings.TIMEZONE || 'Asia/Kolkata'} readOnly disabled />
                  <span className="description">Timezone is locked to Asia/Kolkata (IST). Contact support to change.</span>
                </div>
                <div className="settings-actions">
                  <Button variant="primary" onClick={() => saveSettings(['INSTITUTION_NAME'])} loading={saveLoading}>
                    Save General Settings
                  </Button>
                </div>
              </div>
            )}

            {/* PERIODS */}
            {activeTab === 'periods' && (
              <div>
                {periodsError && <div role="alert">{periodsError}</div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                  <h3>Period Management</h3>
                  <Button variant="primary" onClick={() => { setEditingPeriod({ status: 'ACTIVE' }); setPeriodModalOpen(true); }} icon="plus">
                    Add Period
                  </Button>
                </div>
                <DataTable
                  columns={[
                    { key: 'periodNumber', label: 'No.' },
                    { key: 'name', label: 'Name' },
                    { key: 'startTime', label: 'Start Time' },
                    { key: 'endTime', label: 'End Time' },
                    { key: 'status', label: 'Status' },
                  ]}
                  data={periods}
                  keyField="id"
                  actions={(row) => (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <Button variant="ghost" size="sm" onClick={() => { setEditingPeriod(row); setPeriodModalOpen(true); }} icon="edit" />
                      <Button variant="ghost" size="sm" onClick={() => deletePeriod(row.id)} icon="trash" />
                    </div>
                  )}
                />
              </div>
            )}


            {/* ATTENDANCE SETTINGS */}
            {activeTab === 'attendance' && (
              <div>
                <h3 style={{ marginBottom: '1.5rem' }}>Attendance Configuration</h3>
                <div className="settings-form-group">
                  <label>Minimum Attendance Threshold (%)</label>
                  <input 
                    type="number" 
                    min="0" max="100"
                    value={settings.ATTENDANCE_THRESHOLD || '75'} 
                    onChange={e => handleSettingChange('ATTENDANCE_THRESHOLD', e.target.value)} 
                  />
                  <span className="description">Used for identifying low-attendance students and generating reports.</span>
                </div>
                <div className="settings-form-group">
                  <label>Session Start Window (Minutes)</label>
                  <input 
                    type="number" 
                    min="0"
                    value={settings.ATTENDANCE_START_EARLY_MINUTES || '10'} 
                    onChange={e => handleSettingChange('ATTENDANCE_START_EARLY_MINUTES', e.target.value)} 
                  />
                  <span className="description">How many minutes before a scheduled period a staff member can activate a session.</span>
                </div>
                <div className="settings-form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '1rem' }}>
                  <input 
                    type="checkbox" 
                    checked={settings.MANUAL_CORRECTION_ENABLED === 'true'} 
                    onChange={e => handleSettingChange('MANUAL_CORRECTION_ENABLED', e.target.checked ? 'true' : 'false')} 
                  />
                  <div>
                    <label>Enable Manual Corrections</label>
                    <div className="description">Allow class counselors and HODs to modify attendance retroactively.</div>
                  </div>
                </div>
                <div className="settings-actions">
                  <Button variant="primary" onClick={() => saveSettings(['ATTENDANCE_THRESHOLD', 'ATTENDANCE_START_EARLY_MINUTES', 'MANUAL_CORRECTION_ENABLED'])} loading={saveLoading}>
                    Save Attendance Settings
                  </Button>
                </div>
              </div>
            )}

            {/* NOTIFICATIONS */}
            {activeTab === 'notifications' && (
              <div>
                <h3 style={{ marginBottom: '1.5rem' }}>Notification Preferences</h3>
                <div className="settings-form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '1rem' }}>
                  <input 
                    type="checkbox" 
                    checked={settings.ATTENDANCE_SESSION_NOTIFICATIONS === 'true'} 
                    onChange={e => handleSettingChange('ATTENDANCE_SESSION_NOTIFICATIONS', e.target.checked ? 'true' : 'false')} 
                  />
                  <div>
                    <label>Session Alerts</label>
                    <div className="description">Notify staff members when their scheduled session is about to begin. (Configuration Only)</div>
                  </div>
                </div>
                <div className="settings-form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '1rem' }}>
                  <input 
                    type="checkbox" 
                    checked={settings.LOW_ATTENDANCE_NOTIFICATIONS === 'true'} 
                    onChange={e => handleSettingChange('LOW_ATTENDANCE_NOTIFICATIONS', e.target.checked ? 'true' : 'false')} 
                  />
                  <div>
                    <label>Low Attendance Warnings</label>
                    <div className="description">Automatically alert students who fall below the attendance threshold. (Configuration Only)</div>
                  </div>
                </div>
                <div className="settings-actions">
                  <Button variant="primary" onClick={() => saveSettings(['ATTENDANCE_SESSION_NOTIFICATIONS', 'LOW_ATTENDANCE_NOTIFICATIONS'])} loading={saveLoading}>
                    Save Notification Settings
                  </Button>
                </div>
              </div>
            )}

            {/* SYSTEM INFO */}
            {activeTab === 'system' && (
              <div>
                <h3 style={{ marginBottom: '1.5rem' }}>System Information</h3>
                <div className="system-info-grid">
                  <div className="system-info-item">
                    <span className="system-info-label">Application</span>
                    <span className="system-info-value">Smart Attendance System Admin</span>
                  </div>
                  <div className="system-info-item">
                    <span className="system-info-label">Version</span>
                    <span className="system-info-value">0.1.0 (Beta)</span>
                  </div>
                  <div className="system-info-item">
                    <span className="system-info-label">Environment</span>
                    <span className="system-info-value">Development</span>
                  </div>
                  <div className="system-info-item">
                    <span className="system-info-label">Primary Department</span>
                    <span className="system-info-value">Information Technology (IT)</span>
                  </div>
                  <div className="system-info-item">
                    <span className="system-info-label">Server Timezone</span>
                    <span className="system-info-value">Asia/Kolkata (IST)</span>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}
      </Card>

      {/* Period Modal */}
      {periodModalOpen && (
        <Modal isOpen={periodModalOpen} onClose={() => setPeriodModalOpen(false)} title={editingPeriod?.id ? "Edit Period" : "Add Period"}>
          <form onSubmit={savePeriod}>
            <div className="settings-form-group">
              <label>Period Number</label>
              <input type="number" required value={editingPeriod?.periodNumber || ''} onChange={e => setEditingPeriod({...editingPeriod, periodNumber: parseInt(e.target.value)})} />
            </div>
            <div className="settings-form-group">
              <label>Name</label>
              <input type="text" required value={editingPeriod?.name || ''} onChange={e => setEditingPeriod({...editingPeriod, name: e.target.value})} placeholder="e.g. Period 1" />
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <div className="settings-form-group" style={{ flex: 1 }}>
                <label>Start Time</label>
                <input type="time" required value={editingPeriod?.startTime || ''} onChange={e => setEditingPeriod({...editingPeriod, startTime: e.target.value})} />
              </div>
              <div className="settings-form-group" style={{ flex: 1 }}>
                <label>End Time</label>
                <input type="time" required value={editingPeriod?.endTime || ''} onChange={e => setEditingPeriod({...editingPeriod, endTime: e.target.value})} />
              </div>
            </div>
            <div className="settings-form-group">
              <label>Status</label>
              <select value={editingPeriod?.status || 'ACTIVE'} onChange={e => setEditingPeriod({...editingPeriod, status: e.target.value as any})}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </div>
            <div className="settings-actions">
              <Button type="button" variant="secondary" onClick={() => setPeriodModalOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary">Save Period</Button>
            </div>
          </form>
        </Modal>
      )}


    </div>
  );
}

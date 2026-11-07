import { useState, useEffect, useMemo } from 'react';
import Select from '../components/Select';
import Icon from '../components/Icon';
import { useApi } from '../hooks/useApi';
import { timetableService } from '../services/timetableService';
import { useToast } from '../hooks/useToast';
import TimetableGrid from '../components/timetable/TimetableGrid';
import type { ApiResponse, AcademicYear, Department, Batch, ClassSection, Staff, TimetableEntry, Period } from '../types';
import './TimetablePage.css';

export default function TimetablePage() {
  const [viewMode, setViewMode] = useState<'class' | 'staff'>('class');

  // Hierarchy filter state
  const [selectedDept, setSelectedDept] = useState<string>('');
  const [selectedBatch, setSelectedBatch] = useState<string>('');
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<string>('');

  const [timetable, setTimetable] = useState<TimetableEntry[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(false);
  const [periodsError, setPeriodsError] = useState<string | null>(null);
  const [timetableError, setTimetableError] = useState<string | null>(null);
  const { showToast } = useToast();

  const { data: yearsRes, error: yearsError } = useApi<ApiResponse<AcademicYear[]>>('/api/academic-years');
  const { data: deptsRes } = useApi<ApiResponse<Department[]>>('/api/departments');
  const { data: batchesRes } = useApi<ApiResponse<Batch[]>>('/api/batches');
  const { data: classesRes, error: classesError } = useApi<ApiResponse<ClassSection[]>>('/api/classes');
  const { data: staffRes } = useApi<ApiResponse<any>>('/api/staff?status=ACTIVE&limit=100');

  // Load periods
  useEffect(() => {
    timetableService.getPeriods()
      .then(res => {
        setPeriods(res.data);
        setPeriodsError(null);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to load period times.';
        setPeriodsError(message);
      });
  }, []);

  // Auto-select active academic year
  useEffect(() => {
    if (!selectedYear && yearsRes?.data && yearsRes.data.length > 0) {
      const activeYear = yearsRes.data.find(y => y.isCurrent && y.status === 'ACTIVE') || yearsRes.data[0];
      if (activeYear) setSelectedYear(activeYear.id);
    }
  }, [yearsRes, selectedYear]);

  // Filter batches by selected department
  const filteredBatches = useMemo(() => {
    const list = batchesRes?.data || [];
    if (!selectedDept) return list;
    return list.filter(b => !b.departmentId || b.departmentId === selectedDept);
  }, [batchesRes, selectedDept]);

  // Filter classes by selected department and batch
  const filteredClasses = useMemo(() => {
    let list = (classesRes?.data || []).filter(c => c.status === 'ACTIVE');
    if (selectedDept) {
      list = list.filter(c => !c.departmentId || c.departmentId === selectedDept);
    }
    if (selectedBatch) {
      list = list.filter(c => !c.batchId || c.batchId === selectedBatch);
    }
    return list;
  }, [classesRes, selectedDept, selectedBatch]);

  // Auto-select first class when list updates if none selected
  useEffect(() => {
    if (filteredClasses.length > 0) {
      const currentExists = filteredClasses.some(c => c.id === selectedClass);
      if (!currentExists) {
        setSelectedClass(filteredClasses[0].id);
      }
    } else {
      setSelectedClass('');
    }
  }, [filteredClasses, selectedClass]);

  // Auto-select first teaching staff member in staff mode
  const staffList: Staff[] = useMemo(() => {
    const TEACHING_ROLES = ['STAFF', 'FACULTY', 'HOD', 'DEPUTY_HOD', 'CLASS_COUNSELOR'];
    return (staffRes?.data?.staff || []).filter(
      (s: Staff) => s.status === 'ACTIVE' && s.roles?.some((r: string) => TEACHING_ROLES.includes(r))
    );
  }, [staffRes]);

  useEffect(() => {
    if (viewMode === 'staff' && !selectedStaff && staffList.length > 0) {
      setSelectedStaff(staffList[0].id);
    }
  }, [viewMode, selectedStaff, staffList]);

  // Fetch timetable when parameters change
  const fetchTimetableData = async () => {
    if (!selectedYear) return;

    if (viewMode === 'class') {
      if (!selectedClass) {
        setTimetable([]);
        return;
      }
      setLoading(true);
      setTimetableError(null);
      try {
        const res = await timetableService.getTimetableByClass(selectedClass, selectedYear);
        setTimetable(res.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch class timetable.';
        setTimetableError(message);
        showToast('error', message);
      } finally {
        setLoading(false);
      }
    } else {
      if (!selectedStaff) {
        setTimetable([]);
        return;
      }
      setLoading(true);
      setTimetableError(null);
      try {
        const res = await timetableService.getTimetableByStaff(selectedStaff, selectedYear);
        setTimetable(res.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch staff timetable.';
        setTimetableError(message);
        showToast('error', message);
      } finally {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void fetchTimetableData();
  }, [viewMode, selectedClass, selectedStaff, selectedYear]);

  // Options for selectors
  const yearOptions = (yearsRes?.data || []).map(y => ({ value: y.id, label: y.name }));
  const deptOptions = (deptsRes?.data || []).filter(d => d.status === 'ACTIVE').map(d => ({ value: d.id, label: `${d.code} - ${d.name}` }));
  const batchOptions = filteredBatches.filter(b => b.status === 'ACTIVE').map(b => ({ value: b.id, label: b.name }));
  const classOptions = filteredClasses.map(c => ({ value: c.id, label: c.name }));
  const staffOptions = staffList.map(s => ({ value: s.id, label: `${s.staffCode ? s.staffCode + ' - ' : ''}${s.name}` }));

  const selectedYearObj = yearsRes?.data?.find(y => y.id === selectedYear);
  const selectedClassObj = classesRes?.data?.find(c => c.id === selectedClass);
  const selectedStaffObj = staffList.find(s => s.id === selectedStaff);

  return (
    <div className="timetable-page">
      {/* Header & Controls Bar */}
      <div className="timetable-page-header">
        <div className="timetable-page-header__left">
          <div className="timetable-breadcrumb">
            <span>Home</span>
            <span>/</span>
            <span>Timetable</span>
            <span>/</span>
            <span className="timetable-breadcrumb--active">
              {viewMode === 'class' ? 'Class Schedule' : 'Faculty Schedule'}
            </span>
          </div>
          <div className="timetable-title-group">
            <h1 className="timetable-page-title">Weekly Timetable</h1>
            {viewMode === 'class' && selectedClassObj && (
              <span className="timetable-header-badge timetable-header-badge--class">
                {selectedClassObj.name}
              </span>
            )}
            {viewMode === 'staff' && selectedStaffObj && (
              <span className="timetable-header-badge timetable-header-badge--class">
                {selectedStaffObj.name}
              </span>
            )}
            {selectedYearObj && (
              <span className="timetable-header-badge timetable-header-badge--year">
                {selectedYearObj.name}
              </span>
            )}
          </div>
        </div>

        {/* View Mode Switcher */}
        <div className="timetable-view-switcher" style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            className={`btn ${viewMode === 'class' ? 'btn--primary' : 'btn--secondary'}`}
            style={{ padding: '6px 12px', fontSize: '12px' }}
            onClick={() => setViewMode('class')}
          >
            Class Schedule
          </button>
          <button
            type="button"
            className={`btn ${viewMode === 'staff' ? 'btn--primary' : 'btn--secondary'}`}
            style={{ padding: '6px 12px', fontSize: '12px' }}
            onClick={() => setViewMode('staff')}
          >
            Faculty Schedule
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="timetable-filters-panel" style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        background: '#ffffff',
        padding: '10px 16px',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        flexWrap: 'wrap'
      }}>
        {viewMode === 'class' ? (
          <>
            <div className="timetable-filter-item">
              <span className="timetable-filter-label">Department</span>
              <div className="timetable-select-wrap">
                <Select
                  value={selectedDept}
                  onChange={(val) => { setSelectedDept(val); setSelectedBatch(''); }}
                  options={[{ value: '', label: 'All Departments' }, ...deptOptions]}
                />
              </div>
            </div>

            <div className="timetable-filter-item">
              <span className="timetable-filter-label">Batch</span>
              <div className="timetable-select-wrap">
                <Select
                  value={selectedBatch}
                  onChange={setSelectedBatch}
                  options={[{ value: '', label: 'All Batches' }, ...batchOptions]}
                />
              </div>
            </div>

            <div className="timetable-filter-item">
              <span className="timetable-filter-label">Class *</span>
              <div className="timetable-select-wrap">
                <Select
                  value={selectedClass}
                  onChange={setSelectedClass}
                  options={[{ value: '', label: 'Select Class...' }, ...classOptions]}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="timetable-filter-item">
            <span className="timetable-filter-label">Faculty Member *</span>
            <div className="timetable-select-wrap" style={{ minWidth: '220px' }}>
              <Select
                value={selectedStaff}
                onChange={setSelectedStaff}
                options={[{ value: '', label: 'Select Faculty Member...' }, ...staffOptions]}
              />
            </div>
          </div>
        )}

        <div className="timetable-filter-item">
          <span className="timetable-filter-label">Academic Year *</span>
          <div className="timetable-select-wrap">
            <Select
              value={selectedYear}
              onChange={setSelectedYear}
              options={[{ value: '', label: 'Select Year...' }, ...yearOptions]}
            />
          </div>
        </div>

        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => void fetchTimetableData()}
          disabled={loading}
          style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: '12px' }}
          title="Refresh Schedule"
        >
          <Icon name="refresh" size={14} />
          <span>Refresh</span>
        </button>
      </div>

      {(yearsError || classesError || periodsError || timetableError) && (
        <div className="timetable-alert-box" role="alert">
          {yearsError && <div>Academic years could not be loaded.</div>}
          {classesError && <div>Classes could not be loaded.</div>}
          {periodsError && <div>Period times could not be loaded: {periodsError}</div>}
          {timetableError && <div>{timetableError}</div>}
        </div>
      )}

      {/* Grid or Empty Card */}
      {viewMode === 'class' && selectedClass && selectedYear ? (
        <TimetableGrid
          timetable={timetable}
          periods={periods}
          loading={loading}
          academicYearId={selectedYear}
          classId={selectedClass}
          classNameText={selectedClassObj?.name}
          academicYearName={selectedYearObj?.name}
          readOnly={false}
          onRefresh={() => void fetchTimetableData()}
        />
      ) : viewMode === 'staff' && selectedStaff && selectedYear ? (
        <TimetableGrid
          timetable={timetable}
          periods={periods}
          loading={loading}
          academicYearId={selectedYear}
          classId=""
          classNameText={`Faculty: ${selectedStaffObj?.name || 'Selected Staff'}`}
          academicYearName={selectedYearObj?.name}
          readOnly={true}
          onRefresh={() => void fetchTimetableData()}
        />
      ) : (
        <div className="timetable-empty-card">
          <div className="empty-state">
            <div className="empty-state-icon-wrap">
              <Icon name="timetable" size={38} className="empty-state-icon-svg" />
            </div>
            <h3>Select Timetable Parameters</h3>
            <p>
              {viewMode === 'class'
                ? 'Please select a Class and an Academic Year above to load the weekly schedule.'
                : 'Please select a Faculty Member and an Academic Year above to load their teaching schedule.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

import { createBrowserRouter, Navigate } from 'react-router-dom';
import DashboardLayout from '../layouts/DashboardLayout';
import LoginPage from '../pages/LoginPage';
import DashboardPage from '../pages/DashboardPage';
import ProtectedRoute from '../components/ProtectedRoute';
import DepartmentsPage from '../pages/DepartmentsPage';
import AcademicYearsPage from '../pages/AcademicYearsPage';
import BatchesPage from '../pages/BatchesPage';
import RegulationsPage from '../pages/RegulationsPage';
import ClassesPage from '../pages/ClassesPage';
import StudentsPage from '../pages/StudentsPage';
import StaffPage from '../pages/StaffPage';
import StaffDetailsPage from '../pages/StaffDetailsPage';
import CounselorsPage from '../pages/CounselorsPage';
import SubjectsPage from '../pages/SubjectsPage';
import SubjectDetailsPage from '../pages/SubjectDetailsPage';
import TimetablePage from '../pages/TimetablePage';
import OverridesPage from '../pages/OverridesPage';
import PeriodsPage from '../pages/PeriodsPage';
import StaffTimetablePage from '../pages/StaffTimetablePage';
import AttendancePage from '../pages/AttendancePage';
import AttendanceSessionDetailsPage from '../pages/AttendanceSessionDetailsPage';
import AuditLogsPage from '../pages/AuditLogsPage';
import SettingsPage from '../pages/SettingsPage';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: <ProtectedRoute allowedRoles={['ADMIN', 'HOD', 'DEPUTY_HOD', 'CLASS_COUNSELOR', 'STAFF', 'FACULTY']} />,
    children: [
      {
        path: '/',
        element: <DashboardLayout />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'departments', element: <DepartmentsPage /> },
          { path: 'academic-years', element: <AcademicYearsPage /> },
      { path: 'batches', element: <BatchesPage /> },
      { path: 'regulations', element: <RegulationsPage /> },
      { path: 'classes', element: <ClassesPage /> },
      { path: 'classes/:id', element: <Navigate to="/classes" replace /> },
      { path: 'students', element: <StudentsPage /> },
      { path: 'staff', element: <StaffPage /> },
      { path: 'staff/:id', element: <StaffDetailsPage /> },
      { path: 'class-counselors', element: <CounselorsPage /> },
      { path: 'subjects', element: <SubjectsPage /> },
      { path: 'subjects/:id', element: <SubjectDetailsPage /> },
      { path: 'timetable', element: <TimetablePage /> },
      { path: 'timetable/overrides', element: <OverridesPage /> },
      {
        path: 'periods',
        element: <ProtectedRoute allowedRoles={['ADMIN']} />,
        children: [{ index: true, element: <PeriodsPage /> }],
      },
      { path: 'staff/:id/timetable', element: <StaffTimetablePage /> },
      { path: 'attendance', element: <AttendancePage /> },
      { path: 'attendance/sessions/:id', element: <AttendanceSessionDetailsPage /> },
      {
        path: 'audit-logs',
        element: <ProtectedRoute allowedRoles={['ADMIN', 'HOD', 'DEPUTY_HOD']} />,
        children: [{ index: true, element: <AuditLogsPage /> }],
      },
      {
        path: 'settings',
        element: <ProtectedRoute allowedRoles={['ADMIN']} />,
        children: [{ index: true, element: <SettingsPage /> }],
      },
        ],
      }
    ],
  },
  {
    path: '*',
    element: <Navigate to="/dashboard" replace />,
  },
]);

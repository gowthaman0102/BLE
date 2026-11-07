import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import Icon from '../components/Icon';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../types';
import './Sidebar.css';

interface SubNavItem {
  label: string;
  path: string;
  icon?: string;
  allowedRoles?: UserRole[];
}

interface NavItem {
  label: string;
  path: string;
  icon: string;
  badge?: string | number;
  allowedRoles?: UserRole[];
  children?: SubNavItem[];
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export default function Sidebar() {
  const location = useLocation();
  const { hasAnyRole } = useAuth();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    'Academic': true,
    'Timetable': false,
  });

  // Auto-expand parents if active route matches child
  useEffect(() => {
    if (['/departments', '/academic-years', '/batches', '/regulations', '/classes'].includes(location.pathname)) {
      setExpanded((prev) => ({ ...prev, Academic: true }));
    }
    if (['/timetable', '/timetable/overrides'].includes(location.pathname)) {
      setExpanded((prev) => ({ ...prev, Timetable: true }));
    }
  }, [location.pathname]);

  const toggleExpand = (label: string) => {
    setExpanded((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const navSections: NavSection[] = [
    {
      title: 'OVERVIEW',
      items: [
        { label: 'Dashboard', path: '/dashboard', icon: 'dashboard' },
      ],
    },
    {
      title: 'ACADEMIC STRUCTURE',
      items: [
        {
          label: 'Academic',
          path: '/academic',
          icon: 'academic',
          allowedRoles: ['ADMIN', 'HOD', 'DEPUTY_HOD', 'STAFF', 'FACULTY'],
          children: [
            { label: 'Departments', path: '/departments' },
            { label: 'Academic Years', path: '/academic-years' },
            { label: 'Batches', path: '/batches' },
            { label: 'Regulations', path: '/regulations' },
            { label: 'Classes & Sections', path: '/classes' },
          ],
        },
        {
          label: 'Subjects',
          path: '/subjects',
          icon: 'subjects',
          allowedRoles: ['ADMIN', 'HOD', 'DEPUTY_HOD', 'STAFF', 'FACULTY'],
        },
      ],
    },
    {
      title: 'DIRECTORY',
      items: [
        {
          label: 'Students',
          path: '/students',
          icon: 'students',
          allowedRoles: ['ADMIN', 'HOD', 'DEPUTY_HOD', 'CLASS_COUNSELOR', 'STAFF', 'FACULTY'],
        },
        {
          label: 'Staff',
          path: '/staff',
          icon: 'staff',
          allowedRoles: ['ADMIN', 'HOD', 'DEPUTY_HOD'],
        },
      ],
    },
    {
      title: 'SCHEDULE & TRACKING',
      items: [
        {
          label: 'Timetable',
          path: '/timetable',
          icon: 'timetable',
          allowedRoles: ['ADMIN', 'HOD', 'DEPUTY_HOD', 'STAFF', 'FACULTY'],
          children: [
            { label: 'Weekly Schedule', path: '/timetable' },
            { label: 'Substitutions', path: '/timetable/overrides' },
          ],
        },
        {
          label: 'Attendance',
          path: '/attendance',
          icon: 'attendance',
          allowedRoles: ['ADMIN', 'HOD', 'DEPUTY_HOD', 'CLASS_COUNSELOR', 'STAFF', 'FACULTY'],
        },
      ],
    },
    {
      title: 'SYSTEM',
      items: [
        { label: 'Audit Logs', path: '/audit-logs', icon: 'audit', allowedRoles: ['ADMIN', 'HOD', 'DEPUTY_HOD'] },
        { label: 'Settings', path: '/settings', icon: 'settings', allowedRoles: ['ADMIN'] },
      ],
    },
  ];

  const isChildActive = (children?: SubNavItem[]): boolean => {
    if (!children) return false;
    return children.some((c) => location.pathname === c.path);
  };

  return (
    <aside className="modern-sidebar" role="navigation" aria-label="Main Navigation">
      {/* Brand Header */}
      <div className="modern-sidebar__brand">
        <div className="modern-sidebar__logo-wrap">
          <div className="modern-sidebar__logo-badge">SONA</div>
          <div className="modern-sidebar__brand-text">
            <span className="modern-sidebar__brand-title">SMART ATTENDANCE</span>
            <span className="modern-sidebar__brand-dept" title="Department of Information Technology">Department of Information Technology</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="modern-sidebar__nav">
        {navSections.map((section) => {
          const visibleItems = section.items.filter((item) => {
            if (!item.allowedRoles || item.allowedRoles.length === 0) return true;
            return hasAnyRole(item.allowedRoles);
          });

          if (visibleItems.length === 0) return null;

          return (
            <div key={section.title} className="modern-sidebar__section">
              <div className="modern-sidebar__section-title">{section.title}</div>
              <ul className="modern-sidebar__list">
                {visibleItems.map((item) => {
                  const hasChildren = Boolean(item.children && item.children.length > 0);
                  const isOpen = Boolean(expanded[item.label]);
                  const parentActive = isChildActive(item.children);

                  return (
                    <li key={item.label} className="modern-sidebar__item">
                      {hasChildren ? (
                        <>
                          <button
                            type="button"
                            className={`modern-sidebar__link ${
                              parentActive ? 'modern-sidebar__link--parent-active' : ''
                            } ${isOpen ? 'modern-sidebar__link--open' : ''}`}
                            onClick={() => toggleExpand(item.label)}
                            aria-expanded={isOpen}
                          >
                            <span className="modern-sidebar__icon-box">
                              <Icon name={item.icon} size={18} />
                            </span>
                            <span className="modern-sidebar__label">{item.label}</span>
                            <span
                              className={`modern-sidebar__chevron ${
                                isOpen ? 'modern-sidebar__chevron--open' : ''
                              }`}
                            >
                              <Icon name="chevron-down" size={14} />
                            </span>
                          </button>

                          {/* Accordion sub-items with modern guide rails */}
                          {isOpen && (
                            <ul className="modern-sidebar__sublist">
                              <div className="modern-sidebar__rail-guide" />
                              {item.children!
                                .filter(
                                  (child) =>
                                    !child.allowedRoles || hasAnyRole(child.allowedRoles)
                                )
                                .map((child) => (
                                  <li key={child.path} className="modern-sidebar__subitem">
                                    <NavLink
                                      to={child.path}
                                      className={({ isActive }) =>
                                        `modern-sidebar__sublink ${
                                          isActive ? 'modern-sidebar__sublink--active' : ''
                                        }`
                                      }
                                    >
                                      <span className="modern-sidebar__subdot" />
                                      <span className="modern-sidebar__sublabel">
                                        {child.label}
                                      </span>
                                    </NavLink>
                                  </li>
                                ))}
                            </ul>
                          )}
                        </>
                      ) : (
                        <NavLink
                          to={item.path}
                          className={({ isActive }) =>
                            `modern-sidebar__link ${isActive ? 'modern-sidebar__link--active' : ''}`
                          }
                        >
                          <span className="modern-sidebar__icon-box">
                            <Icon name={item.icon} size={18} />
                          </span>
                          <span className="modern-sidebar__label">{item.label}</span>
                          {item.badge !== undefined && (
                            <span className="modern-sidebar__badge" title="Pending staff approvals">
                              {item.badge}
                            </span>
                          )}
                        </NavLink>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Modern Executive Footer Card */}
      <div className="modern-sidebar__footer">
        <div className="modern-sidebar__user-card">
          <div className="modern-sidebar__user-status-dot" />
          <div className="modern-sidebar__user-details">
            <span className="modern-sidebar__user-mode">
              HOD Workspace
            </span>
            <span className="modern-sidebar__user-inst">Sona College · IT</span>
          </div>
          <span className="modern-sidebar__app-ver">v1.2</span>
        </div>
      </div>
    </aside>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import './LoginPage.css';

interface LoginLocationState {
  from?: { pathname?: string };
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Sign Up Modal State
  const [showSignUpModal, setShowSignUpModal] = useState(false);
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [signupStaffCode, setSignupStaffCode] = useState('');
  const [signupDepartment, setSignupDepartment] = useState('Information Technology');
  const [showSignupPw, setShowSignupPw] = useState(false);
  const [showSignupConfirmPw, setShowSignupConfirmPw] = useState(false);
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState('');
  const [signupSuccess, setSignupSuccess] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const { login, registerStaffRequest, isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      const requested = (location.state as LoginLocationState | null)?.from?.pathname;
      navigate(requested || '/dashboard', { replace: true });
    }
  }, [isAuthenticated, location, navigate]);

  const closeModal = () => {
    setShowSignUpModal(false);
    setSignupError('');
    setSignupSuccess(false);
    setSignupName('');
    setSignupEmail('');
    setSignupPassword('');
    setSignupConfirmPassword('');
    setSignupStaffCode('');
    setSignupDepartment('Information Technology');
    setShowSignupPw(false);
    setShowSignupConfirmPw(false);
  };

  // Close modal on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    if (showSignUpModal) document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showSignUpModal]);

  const handleLoginSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    const result = await login(email, password);
    if (result.success) {
      navigate((location.state as LoginLocationState | null)?.from?.pathname || '/dashboard', { replace: true });
    } else {
      setError(result.error || 'Invalid credentials. Please verify your email and password.');
    }
    setLoading(false);
  };

  const handleSignUpSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSignupError('');

    if (signupPassword !== signupConfirmPassword) {
      setSignupError('Passwords do not match. Please re-enter your password.');
      return;
    }
    if (signupPassword.length < 8) {
      setSignupError('Password must be at least 8 characters long.');
      return;
    }

    setSignupLoading(true);
    const result = await registerStaffRequest({
      name: signupName,
      email: signupEmail,
      password: signupPassword,
      staffCode: signupStaffCode || undefined,
      department: signupDepartment,
    });

    if (result.success) {
      setSignupSuccess(true);
    } else {
      setSignupError(result.error || 'Unable to submit registration. Please try again.');
    }
    setSignupLoading(false);
  };

  // Password strength
  const getPasswordStrength = (pass: string) => {
    if (!pass) return { score: 0, label: '', color: '' };
    let score = 0;
    if (pass.length >= 8) score += 1;
    if (pass.length >= 12) score += 1;
    if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;
    if (score <= 2) return { score: 1, label: 'Weak', color: '#ef4444' };
    if (score <= 3) return { score: 2, label: 'Fair', color: '#f59e0b' };
    if (score <= 4) return { score: 3, label: 'Good', color: '#3b82f6' };
    return { score: 4, label: 'Strong', color: '#10b981' };
  };
  const pwStrength = getPasswordStrength(signupPassword);

  return (
    <div className="login-layout">
      <div className="login-layout__background" />
      <div className="login-layout__overlay" />

      <div className="login-card-container">
        <div className="login-card">
          {/* Header & Logo */}
          <div className="login-card__brand">
            <div className="login-card__logo-row">
              <span className="login-card__crest-badge">SONA</span>
              <div className="login-card__brand-titles">
                <h1 className="login-card__title">SONA SMART ATTENDANCE</h1>
                <span className="login-card__subtitle">Department of Information Technology</span>
              </div>
            </div>
          </div>

          <div className="login-portal-badge login-portal-badge--hod">
            <Icon name="lock" size={15} />
            <span>Head of Department (HOD) Portal</span>
          </div>

          {/* Errors */}
          {error && <div className="login-alert login-alert--error" role="alert">{error}</div>}

          {/* HOD Sign In Form */}
          <form className="login-form" onSubmit={handleLoginSubmit}>
            <div className="form-group">
              <label htmlFor="hod-email">HOD / Admin College Email</label>
              <input
                id="hod-email"
                type="email"
                value={email}
                placeholder="name@sonatech.ac.in"
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="hod-password">Password</label>
              <div className="input-with-icon">
                <input
                  id="hod-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  placeholder="Enter your password"
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button type="submit" className="login-btn login-btn--hod" disabled={loading}>
              {loading ? 'Authenticating...' : 'Sign In to HOD Dashboard'}
            </button>
          </form>

          {/* Quick Demo Login */}
          <div className="login-quick-helper">
            <span className="quick-helper-label">Quick Demo Sign-in:</span>
            <button
              type="button"
              className="quick-helper-chip quick-helper-chip--hod"
              onClick={() => { setEmail('hod.it@sonatech.ac.in'); setPassword('123456789012'); setError(''); }}
            >
              👑 HOD
            </button>
            <button
              type="button"
              className="quick-helper-chip quick-helper-chip--admin"
              onClick={() => { setEmail('admin@sonatech.ac.in'); setPassword('123456789012'); setError(''); }}
            >
              ⚡ Admin
            </button>
            <button
              type="button"
              className="quick-helper-chip quick-helper-chip--faculty"
              onClick={() => { setEmail('faculty.it@sonatech.ac.in'); setPassword('123456789012'); setError(''); }}
            >
              🎓 Faculty
            </button>
          </div>

          {/* Sign Up Link */}
          <div className="login-signup-row">
            <span>New to the portal?</span>
            <button
              type="button"
              className="login-signup-link"
              onClick={() => setShowSignUpModal(true)}
            >
              Create an account
            </button>
          </div>

          {/* Footer */}
          <div className="login-card__footer">
            <span>Sona College of Technology (Autonomous), Salem · HOD Oversight Portal</span>
          </div>
        </div>
      </div>

      {/* ===================== SIGN UP MODAL ===================== */}
      {showSignUpModal && (
        <div
          className="signup-modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="signup-modal-title"
        >
          <div className="signup-modal">
            {/* Modal Header */}
            <div className="signup-modal__header">
              <div className="signup-modal__header-brand">
                <span className="login-card__crest-badge signup-modal__crest">SONA</span>
                <div>
                  <h2 id="signup-modal-title" className="signup-modal__title">Create Staff Account</h2>
                  <p className="signup-modal__subtitle">Sona Smart Attendance Portal</p>
                </div>
              </div>
              <button
                type="button"
                className="signup-modal__close"
                onClick={closeModal}
                aria-label="Close sign up modal"
              >
                <Icon name="close" size={20} />
              </button>
            </div>

            {/* About Banner */}
            <div className="signup-modal__about-banner">
              <div className="about-banner__icon">
                <Icon name="info" size={18} />
              </div>
              <div className="about-banner__content">
                <strong>About This Portal</strong>
                <p>
                  The Sona Smart Attendance System provides HOD, faculty, and counselors with automated BLE-based attendance tracking, real-time timetable management, period substitutions, and ISO-compliant audit trails — all in a single unified dashboard.
                </p>
              </div>
            </div>

            {signupSuccess ? (
              /* ── Success State ── */
              <div className="signup-success-state">
                <div className="signup-success__icon">
                  <Icon name="check" size={32} />
                </div>
                <h3>Request Submitted!</h3>
                <p>Your staff access request has been sent to the Head of Department for approval. You will be able to sign in once your account is authorized.</p>
                <div className="signup-success__detail">
                  <span><strong>Name:</strong> {signupName}</span>
                  <span><strong>Email:</strong> {signupEmail}</span>
                  <span><strong>Department:</strong> {signupDepartment}</span>
                </div>
                <button
                  type="button"
                  className="login-btn login-btn--hod"
                  onClick={closeModal}
                  style={{ marginTop: '16px', width: '100%' }}
                >
                  Return to Sign In
                </button>
              </div>
            ) : (
              /* ── Sign Up Form ── */
              <>
                {signupError && (
                  <div className="login-alert login-alert--error" role="alert" style={{ margin: '0 0 14px 0' }}>
                    {signupError}
                  </div>
                )}

                <form className="login-form signup-modal__form" onSubmit={handleSignUpSubmit}>
                  {/* Name */}
                  <div className="form-group">
                    <label htmlFor="su-name">Full Name &amp; Title</label>
                    <input
                      id="su-name"
                      type="text"
                      value={signupName}
                      placeholder="Dr. / Prof. First Last"
                      onChange={(e) => setSignupName(e.target.value)}
                      required
                      disabled={signupLoading}
                      minLength={2}
                    />
                  </div>

                  {/* Email */}
                  <div className="form-group">
                    <label htmlFor="su-email">Sona College Email</label>
                    <input
                      id="su-email"
                      type="email"
                      value={signupEmail}
                      placeholder="faculty@sonatech.ac.in"
                      onChange={(e) => setSignupEmail(e.target.value)}
                      required
                      disabled={signupLoading}
                    />
                  </div>

                  {/* Department + Staff Code row */}
                  <div className="form-row">
                    <div className="form-group">
                      <label htmlFor="su-dept">Department</label>
                      <select
                        id="su-dept"
                        value={signupDepartment}
                        onChange={(e) => setSignupDepartment(e.target.value)}
                        disabled={signupLoading}
                        className="form-select"
                      >
                        <option value="Information Technology">Information Technology</option>
                        <option value="Computer Science and Engineering">CS &amp; Engineering</option>
                        <option value="Artificial Intelligence and Data Science">AI &amp; Data Science</option>
                        <option value="Electronics and Communication">Electronics &amp; Comm.</option>
                        <option value="Mechanical Engineering">Mechanical Engineering</option>
                        <option value="Civil Engineering">Civil Engineering</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label htmlFor="su-staffcode">
                        Staff Code <span className="form-optional">(optional)</span>
                      </label>
                      <input
                        id="su-staffcode"
                        type="text"
                        value={signupStaffCode}
                        placeholder="e.g. IT-108"
                        onChange={(e) => setSignupStaffCode(e.target.value)}
                        disabled={signupLoading}
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div className="form-group">
                    <label htmlFor="su-password">
                      Password <span className="form-hint-label">(min. 8 characters)</span>
                    </label>
                    <div className="input-with-icon">
                      <input
                        id="su-password"
                        type={showSignupPw ? 'text' : 'password'}
                        value={signupPassword}
                        placeholder="Create a secure password"
                        onChange={(e) => setSignupPassword(e.target.value)}
                        required
                        disabled={signupLoading}
                        minLength={8}
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowSignupPw((p) => !p)}
                        aria-label="Toggle password visibility"
                      >
                        {showSignupPw ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    {signupPassword && (
                      <div className="pw-strength-row">
                        {[1, 2, 3, 4].map((bar) => (
                          <div
                            key={bar}
                            className="pw-strength-bar"
                            style={{ backgroundColor: pwStrength.score >= bar ? pwStrength.color : '#e2e8f0' }}
                          />
                        ))}
                        <span className="pw-strength-label" style={{ color: pwStrength.color }}>
                          {pwStrength.label}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Confirm Password */}
                  <div className="form-group">
                    <label htmlFor="su-confirm">Confirm Password</label>
                    <div className="input-with-icon">
                      <input
                        id="su-confirm"
                        type={showSignupConfirmPw ? 'text' : 'password'}
                        value={signupConfirmPassword}
                        placeholder="Re-enter your password"
                        onChange={(e) => setSignupConfirmPassword(e.target.value)}
                        required
                        disabled={signupLoading}
                        minLength={8}
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowSignupConfirmPw((p) => !p)}
                        aria-label="Toggle confirm password visibility"
                      >
                        {showSignupConfirmPw ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    {signupConfirmPassword && (
                      <span className={`pw-match-tag ${signupPassword === signupConfirmPassword ? 'pw-match-tag--ok' : 'pw-match-tag--err'}`}>
                        {signupPassword === signupConfirmPassword ? '✓ Passwords match' : '✕ Passwords do not match'}
                      </span>
                    )}
                  </div>

                  {/* Info note */}
                  <div className="signup-modal__note">
                    <Icon name="info" size={14} />
                    <span>Your account request will be reviewed and approved by the Head of Department before you can sign in.</span>
                  </div>

                  {/* Submit */}
                  <button
                    type="submit"
                    className="login-btn login-btn--register"
                    disabled={signupLoading}
                  >
                    {signupLoading ? 'Submitting request...' : 'Submit Access Request'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

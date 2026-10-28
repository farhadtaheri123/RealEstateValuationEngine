
import { useCallback, useEffect, useState } from 'react'
import './App.css'

const API = 'http://127.0.0.1:8000'
const TOKEN_KEY = 'residence_access_token'

const districts = [
  'BARKING AND DAGENHAM', 'BARNET', 'BEXLEY', 'BRENT', 'BROMLEY',
  'CAMDEN', 'CITY OF LONDON', 'CITY OF WESTMINSTER', 'CROYDON',
  'EALING', 'ENFIELD', 'GREENWICH', 'HACKNEY', 'HAMMERSMITH AND FULHAM',
  'HARINGEY', 'HARROW', 'HAVERING', 'HILLINGDON', 'HOUNSLOW',
  'ISLINGTON', 'KENSINGTON AND CHELSEA', 'KINGSTON UPON THAMES',
  'LAMBETH', 'LEWISHAM', 'MERTON', 'NEWHAM', 'REDBRIDGE',
  'RICHMOND UPON THAMES', 'SOUTHWARK', 'SUTTON', 'TOWER HAMLETS',
  'WALTHAM FOREST', 'WANDSWORTH',
]

const propertyLabels = {
  F: 'Flat',
  T: 'Terraced house',
  S: 'Semi-detached house',
  D: 'Detached house',
}

const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const initialForm = {
  property_type: 'F',
  old_new: 'N',
  duration: 'L',
  district: 'BRENT',
  sale_month: '2',
}

const formatPrice = (price) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(Number(price) || 0)

const formatDate = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
}

const titleCase = (value = '') =>
  value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())

async function apiRequest(path, options = {}, token = '') {
  const headers = { ...(options.headers || {}) }

  if (options.body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers,
  })

  if (response.status === 204) {
    if (!response.ok) throw new Error('The request could not be completed.')
    return null
  }

  const text = await response.text()
  let data = {}

  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = {}
  }

  if (!response.ok) {
    const detail = data.detail
    const message = Array.isArray(detail)
      ? detail.map((item) => item.msg || 'Please check your details.').join(' ')
      : typeof detail === 'string'
        ? detail
        : 'The request could not be completed. Please try again.'

    throw new Error(message)
  }

  return data
}

function App() {
  const [form, setForm] = useState(initialForm)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [token, setToken] = useState(
    () => localStorage.getItem(TOKEN_KEY) || '',
  )
  const [user, setUser] = useState(null)
  const [authMode, setAuthMode] = useState('login')
  const [showAuth, setShowAuth] = useState(false)
  const [authForm, setAuthForm] = useState({ email: '', password: '' })
  const [authError, setAuthError] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const [activeView, setActiveView] = useState('valuation')
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [historyMessage, setHistoryMessage] = useState('')
  const [savingHistory, setSavingHistory] = useState(false)
  const [savedRecordId, setSavedRecordId] = useState(null)

  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem('residence_theme') === 'dark',
  )

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {}

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'
    localStorage.setItem('residence_theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setToken('')
    setUser(null)
    setHistory([])
    setSavedRecordId(null)
    setHistoryMessage('')
    setHistoryError('')
    setActiveView('valuation')
    setShowAuth(false)
  }, [])

  useEffect(() => {
    if (!token) {
      setUser(null)
      return undefined
    }

    let cancelled = false

    apiRequest('/auth/me', {}, token)
      .then((data) => {
        if (!cancelled) setUser(data)
      })
      .catch(() => {
        if (!cancelled) signOut()
      })

    return () => {
      cancelled = true
    }
  }, [token, signOut])

  const loadHistory = useCallback(async () => {
    if (!token) return

    setHistoryLoading(true)
    setHistoryError('')
    setHistoryMessage('')

    try {
      const data = await apiRequest('/history', {}, token)
      const records = Array.isArray(data)
        ? data
        : data.items ?? data.history ?? data.records ?? []

      setHistory(records)
    } catch (err) {
      setHistoryError(err.message)
    } finally {
      setHistoryLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (token && activeView === 'history') loadHistory()
  }, [token, activeView, loadHistory])

  const updateField = (event) => {
    setForm((previous) => ({
      ...previous,
      [event.target.name]: event.target.value,
    }))
    setError('')
  }

  const updateAuthField = (event) => {
    setAuthForm((previous) => ({
      ...previous,
      [event.target.name]: event.target.value,
    }))
    setAuthError('')
  }

  const submitAuth = async (event) => {
    event.preventDefault()
    setAuthLoading(true)
    setAuthError('')
    setAuthMessage('')

    try {
      const registering = authMode === 'register'
      const endpoint = registering ? '/auth/register' : '/auth/login'

      const data = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          email: authForm.email.trim(),
          password: authForm.password,
        }),
      })

      if (registering) {
        setAuthMessage('Your account has been created. You can now sign in.')
        setAuthMode('login')
        setAuthForm((previous) => ({ ...previous, password: '' }))
        return
      }

      const accessToken = data.access_token || data.token
      if (!accessToken) throw new Error('Sign-in failed. Please try again.')

      localStorage.setItem(TOKEN_KEY, accessToken)
      setToken(accessToken)
      setUser(data.user || null)
      setShowAuth(false)
      setAuthForm({ email: '', password: '' })
      setActiveView('valuation')
    } catch (err) {
      setAuthError(err.message)
    } finally {
      setAuthLoading(false)
    }
  }

  const estimatePrice = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    setResult(null)
    setSavedRecordId(null)
    setHistoryError('')
    setHistoryMessage('')

    try {
      const data = await apiRequest('/predict', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          sale_month: Number(form.sale_month),
        }),
      })

      setResult(data)
    } catch (err) {
      setError(
        err.message === 'Failed to fetch'
          ? 'The valuation service is currently unavailable. Please try again.'
          : err.message,
      )
    } finally {
      setLoading(false)
    }
  }

  const saveHistory = async () => {
    if (!token || !result) {
      setAuthMode('login')
      setAuthError('Please sign in to save this valuation.')
      setAuthMessage('')
      setShowAuth(true)
      return
    }

    setSavingHistory(true)
    setHistoryError('')
    setHistoryMessage('')

    try {
      const payload = {
        input: {
          property_type: form.property_type,
          old_new: form.old_new,
          duration: form.duration,
          district: form.district,
          sale_month: Number(form.sale_month),
        },
        predicted_price_gbp: Number(result.predicted_price_gbp),
        prediction_interval: result.prediction_interval,
        explanation: result.explanation ?? { top_features: [] },
      }

      const data = await apiRequest('/history', {
        method: 'POST',
        body: JSON.stringify(payload),
      }, token)

      setSavedRecordId(data?.id ?? data?.history_id ?? 'saved')
      setHistoryMessage('Valuation saved successfully.')
    } catch (err) {
      setHistoryError(err.message || 'Unable to save this valuation.')
    } finally {
      setSavingHistory(false)
    }
  }

  const deleteHistory = async (record) => {
    const id = record.id ?? record.history_id ?? record.record_id

    if (id === undefined || id === null) {
      setHistoryError('This valuation could not be deleted.')
      return
    }

    if (!window.confirm('Delete this saved valuation?')) return

    setHistoryError('')
    setHistoryMessage('')

    try {
      await apiRequest(`/history/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }, token)

      setHistory((previous) =>
        previous.filter(
          (item) =>
            String(item.id ?? item.history_id ?? item.record_id) !== String(id),
        ),
      )
      setHistoryMessage('Valuation deleted.')
    } catch (err) {
      setHistoryError(err.message)
    }
  }

  const exportHistory = async () => {
    setHistoryError('')
    setHistoryMessage('')

    try {
      const response = await fetch(`${API}/history/export`, {
        headers: authHeaders,
      })

      if (!response.ok) {
        let message = 'Unable to export your valuation history.'
        try {
          const data = await response.json()
          if (data.detail) message = data.detail
        } catch {
          // Use the default message.
        }
        throw new Error(message)
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'valuation-history.csv'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setHistoryMessage('Valuation history exported.')
    } catch (err) {
      setHistoryError(err.message)
    }
  }

  const resetEstimate = () => {
    setResult(null)
    setError('')
    setSavedRecordId(null)
    setHistoryError('')
    setHistoryMessage('')
  }

  const getRecordInput = (record) =>
    record.property_input ?? record.input_data ?? record.input ?? record

  const getRecordPrice = (record) =>
    record.predicted_price_gbp ??
    record.predicted_price ??
    record.prediction?.predicted_price_gbp ??
    record.prediction_result?.predicted_price_gbp

  const getRecordDate = (record) =>
    record.created_at ?? record.timestamp ?? record.date ?? record.created

  const showRecord = (record) => {
    const input = getRecordInput(record)

    setForm({
      property_type: input.property_type ?? 'F',
      old_new: input.old_new ?? 'N',
      duration: input.duration ?? 'L',
      district: input.district ?? 'BRENT',
      sale_month: String(input.sale_month ?? 1),
    })

    const price = getRecordPrice(record)
    if (price === undefined) {
      setHistoryError('This valuation could not be displayed.')
      return
    }

    setResult({
      predicted_price_gbp: Number(price),
      prediction_interval:
        record.prediction_interval ??
        record.prediction?.prediction_interval ??
        record.prediction_result?.prediction_interval,
      explanation:
        record.explanation ??
        record.prediction?.explanation ??
        record.prediction_result?.explanation,
    })

    setSavedRecordId(record.id ?? record.history_id ?? 'saved')
    setActiveView('valuation')
    setError('')
  }

  const explanation = result?.explanation?.top_features ?? []
  const maxImpact = Math.max(
    0.000001,
    ...explanation.map((item) => Math.abs(item.impact_log_price)),
  )

  const userLabel = user?.email ?? user?.username ?? user?.name ?? 'My account'

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#home"
          onClick={() => setActiveView('valuation')}
          aria-label="Residence Analytics home"
        >
          <span className="brand-mark">R</span>
          <span>RESIDENCE <span className="brand-light">/ ANALYTICS</span></span>
        </a>

        <div className="header-actions">
          <span className="header-tag">GREATER LONDON</span>

          <button
            className="header-button"
            type="button"
            onClick={() => setDarkMode((value) => !value)}
          >
            {darkMode ? 'Light mode' : 'Dark mode'}
          </button>

          {token ? (
            <>
              <button
                className={`header-button ${activeView === 'history' ? 'active' : ''}`}
                type="button"
                onClick={() => setActiveView('history')}
              >
                My valuations
              </button>
              <button className="header-button" type="button" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <button
              className="header-button header-primary"
              type="button"
              onClick={() => {
                setAuthMode('login')
                setAuthError('')
                setAuthMessage('')
                setShowAuth(true)
              }}
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      {token && (
        <div className="account-strip">
          Signed in as <strong>{userLabel}</strong>
        </div>
      )}

      <main id="home">
        {activeView === 'history' ? (
          <section className="history-panel">
            <div className="history-heading">
              <div>
                <p className="eyebrow">ACCOUNT</p>
                <h1>My valuations</h1>
                <p className="intro-copy">
                  View and manage your saved property estimates.
                </p>
              </div>

              <div className="history-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={exportHistory}
                >
                  Export CSV
                </button>
                <button
                  className="estimate-button history-back"
                  type="button"
                  onClick={() => setActiveView('valuation')}
                >
                  New valuation <span>↗</span>
                </button>
              </div>
            </div>

            {historyError && <div className="error-message" role="alert">{historyError}</div>}
            {historyMessage && <div className="success-message" role="status">{historyMessage}</div>}

            {historyLoading ? (
              <div className="history-empty">Loading valuations…</div>
            ) : history.length === 0 ? (
              <div className="history-empty">
                <h2>No valuations saved</h2>
                <p>Your saved property estimates will appear here.</p>
                <button
                  className="estimate-button history-back"
                  type="button"
                  onClick={() => setActiveView('valuation')}
                >
                  Estimate a property <span>↗</span>
                </button>
              </div>
            ) : (
              <div className="history-table-wrap">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Estimated value</th>
                      <th>Property type</th>
                      <th>District</th>
                      <th>Date saved</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((record, index) => {
                      const input = getRecordInput(record)
                      const price = getRecordPrice(record)
                      const id = record.id ?? record.history_id ?? record.record_id ?? index

                      return (
                        <tr key={id}>
                          <td className="history-price">
                            {price === undefined ? '—' : formatPrice(price)}
                          </td>
                          <td>{propertyLabels[input.property_type] ?? input.property_type ?? '—'}</td>
                          <td>{titleCase(input.district ?? '—')}</td>
                          <td>{formatDate(getRecordDate(record))}</td>
                          <td>
                            <div className="table-actions">
                              <button className="text-button" type="button" onClick={() => showRecord(record)}>
                                View
                              </button>
                              <button className="text-button danger" type="button" onClick={() => deleteHistory(record)}>
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <button className="secondary-button" type="button" onClick={loadHistory} disabled={historyLoading}>
              Refresh
            </button>
          </section>
        ) : (
          <>
            <section className="intro">
              <p className="eyebrow">RESIDENTIAL PROPERTY</p>
              <h1>Property valuation<span>.</span></h1>
              <p className="intro-copy">
                Estimate residential property values across Greater London.
              </p>
            </section>

            <section className="workspace">
              <div className="form-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">PROPERTY DETAILS</p>
                    <h2>Enter property details</h2>
                  </div>
                </div>

                <form onSubmit={estimatePrice}>
                  <div className="field">
                    <label htmlFor="property_type">Property type</label>
                    <select id="property_type" name="property_type" value={form.property_type} onChange={updateField} required>
                      {Object.entries(propertyLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="district">London borough</label>
                    <select id="district" name="district" value={form.district} onChange={updateField} required>
                      {districts.map((district) => (
                        <option key={district} value={district}>{titleCase(district)}</option>
                      ))}
                    </select>
                  </div>

                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="duration">Tenure</label>
                      <select id="duration" name="duration" value={form.duration} onChange={updateField} required>
                        <option value="L">Leasehold</option>
                        <option value="F">Freehold</option>
                      </select>
                    </div>

                    <div className="field">
                      <label htmlFor="old_new">Property age</label>
                      <select id="old_new" name="old_new" value={form.old_new} onChange={updateField} required>
                        <option value="N">Existing property</option>
                        <option value="Y">Newly built</option>
                      </select>
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor="sale_month">Month</label>
                    <select id="sale_month" name="sale_month" value={form.sale_month} onChange={updateField} required>
                      {months.map((month, index) => (
                        <option key={month} value={index + 1}>{month}</option>
                      ))}
                    </select>
                  </div>

                  <button className="estimate-button" type="submit" disabled={loading}>
                    {loading ? 'Calculating…' : 'Estimate property value'}
                    {!loading && <span aria-hidden="true">↗</span>}
                  </button>
                </form>
              </div>

              <aside className="result-panel">
                <div className="result-top">
                  <span className="result-icon" aria-hidden="true">↗</span>
                  <span className="result-label">VALUATION RESULT</span>
                </div>

                {result ? (
                  <div className="result-content" aria-live="polite">
                    <p className="result-caption">Estimated property value</p>
                    <h2 className="price">{formatPrice(result.predicted_price_gbp)}</h2>
                    <span className="result-badge">ESTIMATE</span>

                    {result.prediction_interval?.lower_gbp !== undefined &&
                      result.prediction_interval?.upper_gbp !== undefined && (
                        <div className="interval-card">
                          <p className="interval-title">Estimated price range</p>
                          <div className="interval-values">
                            <div>
                              <span>Lower estimate</span>
                              <strong>{formatPrice(result.prediction_interval.lower_gbp)}</strong>
                            </div>
                            <div>
                              <span>Upper estimate</span>
                              <strong>{formatPrice(result.prediction_interval.upper_gbp)}</strong>
                            </div>
                          </div>
                        </div>
                      )}

                    <div className="result-divider" />
                    <p className="result-description">
                      {propertyLabels[form.property_type]} in {titleCase(form.district)}.
                    </p>

                    <div className="result-actions">
                      <button className="secondary-button" type="button" onClick={resetEstimate}>
                        New estimate <span>→</span>
                      </button>
                      <button
                        className="estimate-button save-button"
                        type="button"
                        onClick={saveHistory}
                        disabled={savingHistory || savedRecordId !== null}
                      >
                        {savingHistory ? 'Saving…' : savedRecordId !== null ? 'Saved ✓' : 'Save valuation'}
                      </button>
                    </div>

                    {!token && (
                      <p className="field-hint save-hint">Sign in to save this valuation.</p>
                    )}
                    {historyMessage && <div className="success-message" role="status">{historyMessage}</div>}
                    {historyError && <div className="error-message" role="alert">{historyError}</div>}
                  </div>
                ) : (
                  <div className="empty-result">
                    <div className="abstract-house" aria-hidden="true">
                      <div className="house-roof" />
                      <div className="house-body"><span /><span /><span /><span /></div>
                    </div>
                    <h2>Your valuation<br />starts here.</h2>
                    <p>Enter the property details to receive an estimated value.</p>
                  </div>
                )}

                {error && <div className="error-message" role="alert">{error}</div>}

                <p className="result-disclaimer">
                  Indicative estimate only. Not a formal valuation or guaranteed sale price.
                </p>
              </aside>
            </section>

            {result && (
              <section className="explanation-panel" aria-live="polite">
                <div className="explanation-heading">
                  <div>
                    <p className="eyebrow">VALUATION INSIGHTS</p>
                    <h2>Factors influencing this estimate</h2>
                  </div>
                </div>

                {explanation.length > 0 ? (
                  <div className="shap-list">
                    {explanation.map((item) => {
                      const positive = item.impact_log_price >= 0
                      const width = `${Math.max(2, Math.abs(item.impact_log_price) / maxImpact * 100)}%`

                      return (
                        <div className="shap-row" key={item.feature}>
                          <div className="shap-meta">
                            <div>
                              <strong>{item.feature}</strong>
                              <span>{item.value}</span>
                            </div>
                            <span className={`shap-direction ${positive ? 'positive' : 'negative'}`}>
                              {positive ? 'Increases estimate' : 'Decreases estimate'}
                            </span>
                          </div>
                          <div className="shap-track">
                            <div className={`shap-bar ${positive ? 'positive' : 'negative'}`} style={{ width }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="empty-explanation">No factor breakdown is available for this valuation.</p>
                )}
              </section>
            )}
          </>
        )}
      </main>

      <footer className="footer">
        <span>RESIDENCE / ANALYTICS</span>
        <span>PROPERTY VALUATION · GREATER LONDON</span>
      </footer>

      {showAuth && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowAuth(false)
          }}
        >
          <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <button className="modal-close" type="button" onClick={() => setShowAuth(false)} aria-label="Close dialog">
              ×
            </button>

            <p className="eyebrow">RESIDENCE / ANALYTICS</p>
            <h2 id="auth-title">{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
            <p className="auth-description">
              {authMode === 'login'
                ? 'Sign in to access your saved valuations.'
                : 'Create an account to save and manage your valuations.'}
            </p>

            {authError && <div className="error-message" role="alert">{authError}</div>}
            {authMessage && <div className="success-message" role="status">{authMessage}</div>}

            <form onSubmit={submitAuth}>
              <div className="field">
                <label htmlFor="auth-email">Email address</label>
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={authForm.email}
                  onChange={updateAuthField}
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="auth-password">Password</label>
                <input
                  id="auth-password"
                  name="password"
                  type="password"
                  autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  minLength={6}
                  value={authForm.password}
                  onChange={updateAuthField}
                  required
                />
              </div>

              <button className="estimate-button" type="submit" disabled={authLoading}>
                {authLoading ? 'Please wait…' : authMode === 'login' ? 'Sign in' : 'Create account'}
                {!authLoading && <span>↗</span>}
              </button>
            </form>

            <p className="auth-switch">
              {authMode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setAuthMode((mode) => mode === 'login' ? 'register' : 'login')
                  setAuthError('')
                  setAuthMessage('')
                }}
              >
                {authMode === 'login' ? 'Create an account' : 'Sign in'}
              </button>
            </p>
          </section>
        </div>
      )}
    </div>
  )
}

export default App

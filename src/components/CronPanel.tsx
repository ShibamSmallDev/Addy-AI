import React, { useState, useEffect } from "react";

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  type: "cron" | "interval";
  enabled: boolean;
  payload: Record<string, unknown>;
  handler: string;
  createdAt: number;
  lastRun?: number;
  nextRun?: number;
  runCount: number;
  maxRuns?: number;
}

interface CronPanelProps {
  apiBase: string;
}

export const CronPanel: React.FC<CronPanelProps> = ({ apiBase }) => {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    schedule: "0 * * * *",
    type: "cron" as "cron" | "interval",
    enabled: true,
    handler: "memory_consolidation",
    payload: {},
    maxRuns: "",
  });

  const handlers = [
    "memory_consolidation",
    "vault_digest",
  ];

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${apiBase}/cron`);
      if (!res.ok) throw new Error("Failed to load jobs");
      const data = await res.json();
      setJobs(data);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [apiBase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${apiBase}/cron`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          payload: form.payload ? JSON.parse(form.payload as any) : {},
          maxRuns: form.maxRuns ? parseInt(form.maxRuns as any, 10) : undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to create job");
      setShowForm(false);
      setForm({ name: "", schedule: "0 * * * *", type: "cron", enabled: true, handler: "memory_consolidation", payload: {}, maxRuns: "" });
      fetchJobs();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this cron job?")) return;
    try {
      const res = await fetch(`${apiBase}/cron/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      fetchJobs();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleToggle = async (job: CronJob) => {
    try {
      const res = await fetch(`${apiBase}/cron/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !job.enabled }),
      });
      if (!res.ok) throw new Error("Failed to toggle");
      fetchJobs();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const formatTime = (ts?: number) => ts ? new Date(ts).toLocaleString() : "never";

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <h3 style={styles.title}>Cron Scheduler</h3>
        <button style={styles.addBtn} onClick={() => setShowForm(true)}>+ Add Job</button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label>Name</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div style={styles.field}>
            <label>Type</label>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as "cron" | "interval" })}>
              <option value="cron">Cron Expression</option>
              <option value="interval">Interval (ms)</option>
            </select>
          </div>
          <div style={styles.field}>
            <label>{form.type === "cron" ? "Cron Expression" : "Interval (ms)"}</label>
            <input value={form.schedule} onChange={e => setForm({ ...form, schedule: e.target.value })} placeholder={form.type === "cron" ? "0 * * * *" : "3600000"} required />
            <small>{form.type === "cron" ? "e.g., 0 * * * * (hourly)" : "e.g., 3600000 (1 hour)"}</small>
          </div>
          <div style={styles.field}>
            <label>Handler</label>
            <select value={form.handler} onChange={e => setForm({ ...form, handler: e.target.value })}>
              {handlers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div style={styles.field}>
            <label>Max Runs (optional)</label>
            <input type="number" value={form.maxRuns} onChange={e => setForm({ ...form, maxRuns: e.target.value })} min="1" />
          </div>
          <div style={styles.field}>
            <label>
              <input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />
              Enabled
            </label>
          </div>
          <div style={styles.formActions}>
            <button type="submit" style={styles.submitBtn}>Create</button>
            <button type="button" style={styles.cancelBtn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <table style={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Schedule</th>
            <th>Handler</th>
            <th>Runs</th>
            <th>Last Run</th>
            <th>Next Run</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 ? (
            <tr><td colSpan={8} style={styles.empty}>No cron jobs yet. Click "Add Job" to create one.</td></tr>
          ) : (
            jobs.map(job => (
              <tr key={job.id} style={job.enabled ? {} : styles.disabledRow}>
                <td>{job.name}</td>
                <td><code>{job.schedule}</code></td>
                <td>{job.handler}</td>
                <td>{job.runCount}{job.maxRuns ? ` / ${job.maxRuns}` : ""}</td>
                <td>{formatTime(job.lastRun)}</td>
                <td>{formatTime(job.nextRun)}</td>
                <td>
                  <span style={{
                    ...styles.badge,
                    backgroundColor: job.enabled ? "#22c55e" : "#ef4444",
                  }}>
                    {job.enabled ? "ON" : "OFF"}
                  </span>
                </td>
                <td>
                  <button style={styles.iconBtn} onClick={() => handleToggle(job)} title={job.enabled ? "Disable" : "Enable"}>
                    {job.enabled ? "⏸" : "▶"}
                  </button>
                  <button style={{ ...styles.iconBtn, ...styles.deleteBtn }} onClick={() => handleDelete(job.id)} title="Delete">🗑</button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  panel: {
    fontFamily: "inherit",
    maxWidth: "900px",
    margin: "0 auto",
    padding: "16px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "16px",
  },
  title: { margin: 0, fontSize: "1.25rem" },
  addBtn: {
    padding: "8px 16px",
    backgroundColor: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
  },
  error: { color: "#ef4444", marginBottom: "12px" },
  form: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "12px",
    padding: "16px",
    backgroundColor: "#1e293b",
    borderRadius: "8px",
    marginBottom: "16px",
  },
  field: { display: "flex", flexDirection: "column", gap: "4px" },
  formActions: { gridColumn: "1 / -1", display: "flex", gap: "8px", marginTop: "8px" },
  submitBtn: { padding: "8px 16px", backgroundColor: "#22c55e", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" },
  cancelBtn: { padding: "8px 16px", backgroundColor: "#64748b", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" },
  empty: { textAlign: "center", padding: "32px", color: "#94a3b8" },
  disabledRow: { opacity: 0.5 },
  badge: { padding: "2px 8px", borderRadius: "9999px", color: "white", fontSize: "0.75rem", fontWeight: 600 },
  iconBtn: { background: "none", border: "none", cursor: "pointer", fontSize: "1rem", marginRight: "4px" },
  deleteBtn: { color: "#ef4444" },
};
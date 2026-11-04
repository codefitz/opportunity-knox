import { useState, useId } from "react";
import {
  Building2,
  ExternalLink,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Pencil,
  ArrowUpRight,
  Globe2,
  X,
} from "lucide-react";
import {
  TIER_LABELS,
  STATUS_LABELS,
  type TargetCompany,
  type TargetCompanyTier,
  type TargetCompanyStatus,
} from "../lib/target-companies.ts";

export default function TargetWishlist({
  companies,
  onAdd,
  onUpdate,
  onDelete,
  onCreateOpportunity,
}: {
  companies: TargetCompany[];
  onAdd: (body: Partial<TargetCompany>) => Promise<void>;
  onUpdate: (id: string, body: Partial<TargetCompany>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreateOpportunity: (prefill: { company: string; role?: string; url?: string }) => void;
}) {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<TargetCompany | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState<{
    name: string;
    targetRoles: string;
    tier: TargetCompanyTier;
    status: TargetCompanyStatus;
    careersUrl: string;
    notes: string;
  }>({
    name: "",
    targetRoles: "",
    tier: "target",
    status: "watching",
    careersUrl: "",
    notes: "",
  });

  function openCreate() {
    setEditingCompany(null);
    setForm({
      name: "",
      targetRoles: "",
      tier: "target",
      status: "watching",
      careersUrl: "",
      notes: "",
    });
    setError("");
    setModalOpen(true);
  }

  function openEdit(company: TargetCompany) {
    setEditingCompany(company);
    setForm({
      name: company.name,
      targetRoles: company.targetRoles,
      tier: company.tier,
      status: company.status,
      careersUrl: company.careersUrl,
      notes: company.notes,
    });
    setError("");
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (editingCompany) {
        await onUpdate(editingCompany.id, form);
      } else {
        await onAdd(form);
      }
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save target company.");
    } finally {
      setBusy(false);
    }
  }

  const filtered = companies.filter((c) => {
    if (tierFilter !== "all" && c.tier !== tierFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.targetRoles.toLowerCase().includes(q) ||
        c.notes.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const dreamCount = companies.filter((c) => c.tier === "dream").length;
  const targetCount = companies.filter((c) => c.tier === "target").length;

  return (
    <div className="target-wishlist-view">
      <div className="wishlist-toolbar">
        <div className="wishlist-search-row">
          <div className="search-input">
            <Search size={16} aria-hidden="true" />
            <input
              placeholder="Search target companies or roles…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search target companies"
            />
          </div>
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="filter-select-input"
            aria-label="Filter by tier"
          >
            <option value="all">All tiers ({companies.length})</option>
            <option value="dream">Dream ({dreamCount})</option>
            <option value="target">Target ({targetCount})</option>
            <option value="safety">Safety</option>
          </select>
        </div>
        <button className="button primary small" onClick={openCreate}>
          <Plus size={16} />
          Add target company
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <Building2 size={32} />
          <h3>
            {companies.length === 0
              ? "No target companies yet"
              : "No matching target companies"}
          </h3>
          <p>
            {companies.length === 0
              ? "Track employers and roles you're interested in before job postings open."
              : "Try adjusting your search or tier filter."}
          </p>
          {companies.length === 0 && (
            <button className="button primary small" onClick={openCreate} style={{ marginTop: 12 }}>
              <Plus size={14} /> Add your first target company
            </button>
          )}
        </div>
      ) : (
        <div className="target-companies-grid">
          {filtered.map((company) => (
            <div key={company.id} className="target-company-card">
              <div className="target-card-header">
                <div className="target-card-title-group">
                  <div className="company-icon-circle">
                    <Building2 size={16} />
                  </div>
                  <div>
                    <h3 className="target-company-name">{company.name}</h3>
                    {company.careersUrl && (
                      <a
                        href={company.careersUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="careers-link"
                        title="Open careers page in new tab"
                      >
                        <Globe2 size={12} />
                        Careers page
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </div>
                <div className="target-card-actions">
                  <button
                    className="icon-button"
                    onClick={() => openEdit(company)}
                    title="Edit target company"
                    aria-label={`Edit ${company.name}`}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => {
                      if (confirm(`Remove ${company.name} from your target wishlist?`)) {
                        void onDelete(company.id);
                      }
                    }}
                    title="Remove target company"
                    aria-label={`Remove ${company.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {company.targetRoles && (
                <div className="target-roles-row">
                  <span className="target-label">Target roles:</span>
                  <span className="target-roles-text">{company.targetRoles}</span>
                </div>
              )}

              {company.notes && (
                <p className="target-notes-text">{company.notes}</p>
              )}

              <div className="target-card-footer">
                <div className="target-badges-group">
                  <span className={`badge ${company.tier === "dream" ? "amber" : company.tier === "target" ? "blue" : "muted"}`}>
                    {TIER_LABELS[company.tier]}
                  </span>
                  <span className="badge muted">
                    {STATUS_LABELS[company.status]}
                  </span>
                </div>
                <button
                  className="button secondary small"
                  onClick={() =>
                    onCreateOpportunity({
                      company: company.name,
                      role: company.targetRoles ? company.targetRoles.split(",")[0].trim() : "",
                      url: company.careersUrl,
                    })
                  }
                  title={`Create an active opportunity at ${company.name}`}
                >
                  <ArrowUpRight size={14} />
                  Create opportunity
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="target-modal-title"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 520 }}
          >
            <div className="modal-heading">
              <h2 id="target-modal-title">
                {editingCompany ? "Edit target company" : "Add target company"}
              </h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => setModalOpen(false)}
                aria-label="Close modal"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              {error && <div className="modal-error">{error}</div>}

              <div className="form-grid">
                <div className="field">
                  <label htmlFor="target-name">Company name</label>
                  <input
                    id="target-name"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Anthropic, Stripe, Apple"
                  />
                </div>

                <div className="field">
                  <label htmlFor="target-roles">Target roles</label>
                  <input
                    id="target-roles"
                    value={form.targetRoles}
                    onChange={(e) => setForm({ ...form, targetRoles: e.target.value })}
                    placeholder="e.g. Solutions Architect, Staff Engineer"
                  />
                </div>

                <div className="field">
                  <label htmlFor="target-tier">Target tier</label>
                  <select
                    id="target-tier"
                    value={form.tier}
                    onChange={(e) => setForm({ ...form, tier: e.target.value as TargetCompanyTier })}
                  >
                    <option value="dream">Dream company</option>
                    <option value="target">Target company</option>
                    <option value="safety">Safety option</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="target-status">Status</label>
                  <select
                    id="target-status"
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as TargetCompanyStatus })}
                  >
                    <option value="watching">Watching for openings</option>
                    <option value="researching">Researching</option>
                    <option value="reached-out">Outreach initiated</option>
                    <option value="interviewing">Interviewing</option>
                  </select>
                </div>

                <div className="field wide">
                  <label htmlFor="target-url">Careers or portal link</label>
                  <input
                    id="target-url"
                    type="url"
                    value={form.careersUrl}
                    onChange={(e) => setForm({ ...form, careersUrl: e.target.value })}
                    placeholder="https://company.com/careers"
                  />
                </div>

                <div className="field wide">
                  <label htmlFor="target-notes">Focus notes & strategy</label>
                  <textarea
                    id="target-notes"
                    rows={3}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Hiring contacts, target divisions, referral angles…"
                  />
                </div>
              </div>

              <div className="form-actions" style={{ marginTop: 20 }}>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="button primary" disabled={busy}>
                  {busy ? "Saving…" : editingCompany ? "Save changes" : "Add target company"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

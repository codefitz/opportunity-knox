import { useEffect, useState, type ReactNode } from "react";

// Keep panels mounted so switching sections preserves drafts and running work.
export default function WorkspaceSections({ label, sections }: {
  label: string;
  sections: { id: string; label: string; content: ReactNode }[];
}) {
  const readSection = () => new URLSearchParams(window.location.hash.split("?")[1]).get("section");
  const [requested, setRequested] = useState(readSection);
  useEffect(() => {
    const changed = () => setRequested(readSection());
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  const selected = sections.find(section => section.id === requested)?.id || sections[0].id;
  const page = window.location.hash.split("?")[0];
  return <div className="workspace-sections">
    <nav className="workspace-section-nav" aria-label={label}>
      {sections.map(section => <a key={section.id}
        href={`${page}?section=${section.id}`}
        aria-current={selected === section.id ? "page" : undefined}>
        {section.label}
      </a>)}
    </nav>
    <div className="workspace-section-content">
      {sections.map(section => <section key={section.id} aria-label={section.label}
        hidden={selected !== section.id}>
        <h2 className="workspace-section-title">{section.label}</h2>
        {section.content}
      </section>)}
    </div>
  </div>;
}

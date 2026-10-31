import type { UpdateStatus } from "../types";

export default function BuildVersion({ status }: { status: UpdateStatus }) {
  const commit = status.currentCommit;
  const hasCommit = commit && /^[a-f0-9]{40,64}$/i.test(commit);
  return (
    <div className="build-version" aria-label="Installed build">
      <span>
        v{status.currentVersion}{" "}
        {status.currentVersion.includes("-") ? "(development)" : "(release)"}
      </span>
      {hasCommit ? (
        <a
          href={`https://github.com/codefitz/opportunity-knox/commit/${commit}`}
          target="_blank"
          rel="noreferrer"
          title={`Build commit ${commit}`}
        >
          <code>{commit.slice(0, 7)}</code>
        </a>
      ) : (
        <span>Commit not recorded</span>
      )}
      {status.buildDirty && <span>+ local changes</span>}
      <a
        href="https://github.com/codefitz/opportunity-knox/releases/latest"
        target="_blank"
        rel="noreferrer"
      >
        Latest release
      </a>
    </div>
  );
}

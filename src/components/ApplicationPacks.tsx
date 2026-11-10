import TailorApplication from "./TailorApplication";
import TailorCoverLetter from "./TailorCoverLetter";
import { api, json } from "../api";
import type { Opportunity } from "../types";

type Pack = {
  id: string;
  state: string;
  documents: { id: string }[];
};

export default function ApplicationPacks({
  opportunity,
  onChanged,
  onUpdate,
  onError,
  onOpenStudio,
}: {
  opportunity: Opportunity;
  timezone?: string;
  onChanged: () => void | Promise<void>;
  onUpdate?: (o: Opportunity) => void;
  onError: (e: unknown) => void;
  onOpenStudio?: (opId?: string, docId?: string) => void;
}) {
  const base = "/opportunities/" + opportunity.id + "/packs";

  async function handleSaved(documentIds: string[], hasCover: boolean) {
    try {
      const current = await api<{
        opportunityRevision: number;
        packs: Pack[];
      }>(base);
      const draftPack = current.packs.find((p) => p.state === "draft");
      if (draftPack) {
        const combinedIds = Array.from(
          new Set([...draftPack.documents.map((d) => d.id), ...documentIds]),
        );
        if (combinedIds.length !== draftPack.documents.length) {
          await api(
            `${base}/${draftPack.id}`,
            json(
              {
                revision: current.opportunityRevision,
                documentIds: combinedIds,
                coverLetterNotRequired:
                  !hasCover &&
                  !draftPack.documents.some((d) => d.id && documentIds.includes(d.id)),
              },
              "PATCH",
            ),
          );
        }
      } else if (
        !current.packs.some(
          (p) =>
            p.documents.length === documentIds.length &&
            p.documents.every((d) => documentIds.includes(d.id)),
        )
      ) {
        await api(
          base,
          json({
            revision: current.opportunityRevision,
            title: `${opportunity.company} — ${opportunity.role}`,
            documentIds,
            coverLetterNotRequired: !hasCover,
            supportingStatement: "",
            answers: [],
          }),
        );
      }
      await onChanged();
      try {
        const refreshed = await api<Opportunity>(`/opportunities/${opportunity.id}`);
        if (refreshed && onUpdate) {
          onUpdate(refreshed);
        }
      } catch {}
    } catch (e) {
      onError(e);
    }
  }

  return (
    <section className="application-packs">
      <TailorApplication
        key={`cv-${opportunity.id}`}
        opportunity={opportunity}
        onError={onError}
        onSaved={handleSaved}
      />
      <TailorCoverLetter
        key={`cover-${opportunity.id}`}
        opportunity={opportunity}
        onError={onError}
        onSaved={handleSaved}
        onUpdate={onUpdate}
        onOpenStudio={onOpenStudio}
      />
    </section>
  );
}

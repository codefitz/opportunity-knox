import TailorApplication from "./TailorApplication";
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
  onError,
}: {
  opportunity: Opportunity;
  timezone?: string;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const base = "/opportunities/" + opportunity.id + "/packs";

  return (
    <section className="application-packs">
      <TailorApplication
        key={opportunity.id}
        opportunity={opportunity}
        onError={onError}
        onSaved={async (documentIds, hasCover) => {
          try {
            const current = await api<{
              opportunityRevision: number;
              packs: Pack[];
            }>(base);
            if (
              !current.packs.some(
                (p) =>
                  p.state === "draft" &&
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
            onChanged();
          } catch (e) {
            onError(e);
          }
        }}
      />
    </section>
  );
}

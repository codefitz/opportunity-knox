import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  FileText,
  Upload,
  Plus,
  Search,
  Folder,
  FolderPlus,
  Copy,
  Edit3,
  Trash2,
  Star,
  Download,
  ChevronLeft,
  ChevronRight,
  Check,
  ExternalLink,
  MoreVertical,
  Sparkles,
  ArrowLeft,
  RefreshCw,
  FileSpreadsheet,
  FileQuestion,
  Filter,
  Mail,
  Loader2,
  History,
  MessageSquare,
  Send,
  X,
  RotateCcw,
  Cloud,
  CloudOff,
  BookOpen,
  AlertTriangle,
  Sliders,
} from "lucide-react";
import { api, json, ApiError } from "../api";
import type { BoardDocument, Opportunity } from "../types";
import categories, {libraryCategory} from "../lib/document-categories";
import MarkdownViewer from "./MarkdownViewer";
import TemplateBuilder from "./TemplateBuilder";

type ConnectedSources = {
  obsidian: {
    enabled: boolean;
    readOnly: boolean;
    vaultName: string;
    lastSyncedAt: string;
    lastImportedToVaultAt: string;
    mountPending: boolean;
    configured: boolean;
  };
  google: {
    configured: boolean;
    connected: boolean;
    canExport?: boolean;
    clientId: string;
    localExportPath?: string;
  };
};

type StudioDefaults = {
  masterCvId: string;
  cvTemplateId: string;
  coverLetterTemplateId: string;
};

type StudioPreview = {
  id: string;
  sourceName: string;
  pages: number;
  pageTarget: number;
  overTarget: boolean;
  pdfUrl: string;
  wordUrl: string | null;
  images: string[];
  warnings: string[];
};

type FilterCategory = "all" | "master-cv" | "templates" | "generated";
type FileTypeFilter = "all" | "docx" | "pdf" | "md" | "txt" | "gdoc";

type HistoryItem = {
  id: string;
  name: string;
  version: number;
  category?: string;
  kind: string;
  createdAt: string;
  notes?: string;
  aiNotes?: string;
  isCurrent: boolean;
};

type StudioChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  action?: string;
  createdDocument?: BoardDocument;
  revisedDocument?: BoardDocument;
  error?: boolean;
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function cleanDocName(name: string): string {
  return String(name || "").split(/[/\\]/).pop() || name;
}

function getDocFolder(name: string): string {
  const parts = String(name || "").split(/[/\\]/);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

function getCategoryLabel(categoryId?: string): string {
  const found = categories.find((c) => c.id === libraryCategory(categoryId));
  return found ? found.label : categoryId || "Other";
}

function getCategoryBadgeClass(categoryId?: string): string {
  switch (categoryId) {
    case "master-cv":
      return "badge-green";
    case "cv-template":
    case "template":
      return "badge-amber";
    case "cover-letter-template":
      return "badge-purple";
    case "tailored-cv":
    case "cover-letter":
      return "badge-blue";
    default:
      return "badge-neutral";
  }
}

export default function DocumentStudio({
  onError,
  onNotice,
  onChanged,
  timezone = "Europe/London",
  initialDocumentId,
  initialOpportunityId,
  initialMode,
  onBackToCareerDocs,
  onChatAboutDocument,
  onActiveDocumentChange,
}: {
  onError: (e: unknown) => void;
  onNotice?: (s: string) => void;
  onChanged?: () => void;
  timezone?: string;
  initialDocumentId?: string;
  initialOpportunityId?: string;
  initialMode?: "builder" | "document";
  onBackToCareerDocs?: () => void;
  onChatAboutDocument?: (doc: BoardDocument) => void;
  onActiveDocumentChange?: (doc: BoardDocument | null) => void;
}) {
  const [docs, setDocs] = useState<BoardDocument[]>([]);
  const [defaults, setDefaults] = useState<StudioDefaults>({
    masterCvId: "",
    cvTemplateId: "",
    coverLetterTemplateId: "",
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterCategory>("all");
  const [filetypeFilter, setFiletypeFilter] = useState<FileTypeFilter>("all");
  const [groupByFolder, setGroupByFolder] = useState(true);
  const [selectedDocId, setSelectedDocId] = useState<string>(() => {
    if (initialMode === "builder") return "";
    return initialDocumentId || localStorage.getItem("knox-studio-selected") || "";
  });
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [showMobilePreview, setShowMobilePreview] = useState(false);

  // Preview state
  const [preview, setPreview] = useState<StudioPreview | null>(null);
  const [markdownContent, setMarkdownContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [previewTrigger, setPreviewTrigger] = useState(0);

  // Modals / forms state
  const [showUpload, setShowUpload] = useState(false);
  const [uploadRole, setUploadRole] = useState<string>("master-cv");
  const [uploadFolder, setUploadFolder] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Generation state (Phase 2)
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [showGenerate, setShowGenerate] = useState(Boolean(initialOpportunityId));
  const [generateKind, setGenerateKind] = useState<"cv" | "cover">("cv");
  const [generateSourceCvId, setGenerateSourceCvId] = useState("");
  const [generateTemplateId, setGenerateTemplateId] = useState("");
  const [generateLayout, setGenerateLayout] = useState("classic");
  const [generateOpportunityId, setGenerateOpportunityId] = useState(initialOpportunityId || "");
  const [generateRole, setGenerateRole] = useState("");
  const [generateCompany, setGenerateCompany] = useState("");
  const [generateBrief, setGenerateBrief] = useState("");
  const [generateInstructions, setGenerateInstructions] = useState("");
  const [generateName, setGenerateName] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");

  // Studio Assistant & Chat state (Phase 3)
  const [showAssistant, setShowAssistant] = useState(false);
  const [chatMessages, setChatMessages] = useState<StudioChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Welcome to Document Studio Assistant! I can help derive reusable templates from your uploads, adjust spacing and layouts, polish text, or draft tailored applications.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatRequestId, setChatRequestId] = useState<string | null>(null);

  // Template creation & History state (Phase 3)
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [isBuildingTemplate, setIsBuildingTemplate] = useState<boolean>(() => {
    if (initialMode === "builder") return true;
    if (initialDocumentId) return false;
    return initialMode !== "document";
  });
  const [editingTemplateDef, setEditingTemplateDef] = useState<any>(null);

  useEffect(() => {
    if (initialMode === "builder") {
      setIsBuildingTemplate(true);
      setEditingTemplateDef(null);
    } else if (initialDocumentId) {
      setIsBuildingTemplate(false);
      setSelectedDocId(initialDocumentId);
    }
  }, [initialMode, initialDocumentId]);

  const [showHistory, setShowHistory] = useState(false);
  const [historyDocs, setHistoryDocs] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const [renameTarget, setRenameTarget] = useState<BoardDocument | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  const [moveTargetDocs, setMoveTargetDocs] = useState<BoardDocument[] | null>(null);
  const [moveFolderValue, setMoveFolderValue] = useState("");
  const [moving, setMoving] = useState(false);

  const [bulkCategoryTarget, setBulkCategoryTarget] = useState<BoardDocument[] | null>(null);
  const [selectedCategoryValue, setSelectedCategoryValue] = useState("master-cv");
  const [categorising, setCategorising] = useState(false);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Connected Documents state (Phase 4)
  const [connections, setConnections] = useState<ConnectedSources | null>(null);
  const [exportingObsidian, setExportingObsidian] = useState(false);
  const [exportingGoogleTarget, setExportingGoogleTarget] = useState<BoardDocument | null>(null);
  const [exportingGoogleMode, setExportingGoogleMode] = useState<"api" | "local" | null>(null);
  const [exportGoogleResult, setExportGoogleResult] = useState<{
    mode: "api" | "local";
    url?: string;
    filePath?: string;
    relPath?: string;
    message: string;
  } | null>(null);
  const [showDriveSearch, setShowDriveSearch] = useState(false);
  const [driveQuery, setDriveQuery] = useState("");
  const [driveFiles, setDriveFiles] = useState<
    Array<{
      id: string;
      name: string;
      mimeType: string;
      modifiedTime: string;
      version: string;
      webViewLink: string;
    }>
  >([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveImportingId, setDriveImportingId] = useState<string | null>(null);
  const [driveImportRole, setDriveImportRole] = useState("master-cv");
  const [refreshingDrive, setRefreshingDrive] = useState(false);
  const [driveNotice, setDriveNotice] = useState<string | null>(null);
  const [driveConflict, setDriveConflict] = useState<{
    document: BoardDocument;
    localVersion: number;
    externalVersion: string;
    modifiedTime: string;
    externalName: string;
    message: string;
  } | null>(null);

  async function loadConnections() {
    try {
      const res = await api<ConnectedSources>("/document-studio/connections");
      setConnections(res);
    } catch {}
  }


  async function handleExportToObsidian(doc: BoardDocument) {
    setExportingObsidian(true);
    try {
      const res = await api<{ ok: boolean; relPath: string; vaultName: string }>(
        "/document-studio/obsidian/export",
        json({ documentId: doc.id, subfolder: "Generated" })
      );
      setDriveNotice(`Exported to Obsidian vault (${res.relPath}).`);
      setTimeout(() => setDriveNotice(null), 4000);
    } catch (err: any) {
      onError(err);
    } finally {
      setExportingObsidian(false);
    }
  }

  async function handleExportToGoogleDocs(doc: BoardDocument, mode: "api" | "local") {
    setExportingGoogleMode(mode);
    setExportGoogleResult(null);
    try {
      const res = await api<{
        ok: boolean;
        mode: "api" | "local";
        url?: string;
        filePath?: string;
        relPath?: string;
        document?: BoardDocument;
        message: string;
      }>(
        "/document-studio/google/export",
        json({ documentId: doc.id, mode })
      );
      await loadData(true);
      if (res.document) {
        setExportingGoogleTarget(res.document);
      }
      setExportGoogleResult({
        mode: res.mode,
        url: res.url,
        filePath: res.filePath,
        relPath: res.relPath,
        message: res.message,
      });
      setDriveNotice(res.message);
      setTimeout(() => setDriveNotice(null), 5000);
      onNotice?.(res.message);
    } catch (err: any) {
      onError(err);
    } finally {
      setExportingGoogleMode(null);
    }
  }

  async function handleOpenDriveSearch() {
    setShowDriveSearch(true);
    setDriveQuery("");
    setDriveLoading(true);
    try {
      const res = await api<{ files: any[] }>(
        "/document-studio/google/search",
        json({ query: "" })
      );
      setDriveFiles(res.files || []);
    } catch (err: any) {
      onError(err);
    } finally {
      setDriveLoading(false);
    }
  }

  async function handleSearchDriveSubmit(e: FormEvent) {
    e.preventDefault();
    setDriveLoading(true);
    try {
      const res = await api<{ files: any[] }>(
        "/document-studio/google/search",
        json({ query: driveQuery })
      );
      setDriveFiles(res.files || []);
    } catch (err: any) {
      onError(err);
    } finally {
      setDriveLoading(false);
    }
  }

  async function handleImportDriveFile(file: any) {
    setDriveImportingId(file.id);
    try {
      const res = await api<{ ok: boolean; document: BoardDocument }>(
        "/document-studio/google/import",
        json({ id: file.id, category: driveImportRole })
      );
      await loadData(true);
      setShowDriveSearch(false);
      setSelectedDocId(res.document.id);
      setShowMobilePreview(true);
    } catch (err: any) {
      onError(err);
    } finally {
      setDriveImportingId(null);
    }
  }

  async function handleRefreshFromDrive(doc: BoardDocument, resolution?: string) {
    setRefreshingDrive(true);
    try {
      const res = await api<{
        ok?: boolean;
        conflict?: boolean;
        status?: string;
        message?: string;
        document?: BoardDocument;
        localVersion?: number;
        externalVersion?: string;
        modifiedTime?: string;
        externalName?: string;
      }>(
        "/document-studio/google/refresh",
        json({ documentId: doc.id, resolution })
      );

      if (res.conflict) {
        setDriveConflict({
          document: doc,
          localVersion: res.localVersion || 1,
          externalVersion: res.externalVersion || "",
          modifiedTime: res.modifiedTime || "",
          externalName: res.externalName || doc.name,
          message: res.message || "Document has changed on both sides.",
        });
        return;
      }

      setDriveConflict(null);
      await loadData(true);
      if (res.document) {
        setSelectedDocId(res.document.id);
      }
      setDriveNotice(
        res.message ||
          (res.status === "up-to-date"
            ? "Document is up to date."
            : "Refreshed from Google Drive.")
      );
      setTimeout(() => setDriveNotice(null), 4000);
    } catch (err: any) {
      onError(err);
    } finally {
      setRefreshingDrive(false);
    }
  }

  async function loadData(notifyParent = false) {
    setLoading(true);
    try {
      const [docsRes, defsRes] = await Promise.all([
        api<{ documents: BoardDocument[] }>("/documents"),
        api<StudioDefaults>("/document-studio/defaults"),
      ]);
      setDocs(docsRes.documents);
      setDefaults(defsRes);
      void loadConnections();
      if (notifyParent) {
        onChanged?.();
      }
    } catch (e) {
      onError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData(false);
  }, []);

  async function loadOpportunities() {
    try {
      const res = await api<{ opportunities: Opportunity[] }>("/board");
      setOpportunities(res.opportunities || []);
    } catch {}
  }

  useEffect(() => {
    if (showGenerate || initialOpportunityId) {
      void loadOpportunities();
    }
  }, [showGenerate, initialOpportunityId]);

  // When generate modal opens or kind changes, apply sensible defaults
  useEffect(() => {
    if (!showGenerate) return;
    if (generateKind === "cv") {
      if (!generateSourceCvId) {
        const preferredCv =
          docs.find((d) => d.id === defaults.masterCvId) ||
          docs.find((d) => d.category === "master-cv") ||
          docs.find((d) => d.kind === "cv");
        if (preferredCv) setGenerateSourceCvId(preferredCv.id);
      }
      if (!generateTemplateId && defaults.cvTemplateId) {
        setGenerateTemplateId(defaults.cvTemplateId);
      }
    } else {
      if (!generateTemplateId && defaults.coverLetterTemplateId) {
        setGenerateTemplateId(defaults.coverLetterTemplateId);
      }
      setGenerateLayout("letter");
    }
  }, [showGenerate, generateKind, defaults.masterCvId, defaults.cvTemplateId, defaults.coverLetterTemplateId, docs]);

  // Sync opportunity fields when opportunity is chosen
  useEffect(() => {
    if (!generateOpportunityId) return;
    const op = opportunities.find((o) => o.id === generateOpportunityId);
    if (op) {
      setGenerateCompany(op.company || "");
      setGenerateRole(op.role || "");
      if (!generateName.trim()) {
        setGenerateName(
          generateKind === "cv"
            ? `CV - ${op.company} - ${op.role}.docx`
            : `Cover letter - ${op.company} - ${op.role}.docx`
        );
      }
    }
  }, [generateOpportunityId, opportunities, generateKind]);

  // Global keyboard shortcuts (Phase 5)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (exportingGoogleTarget && !exportingGoogleMode) {
          setExportingGoogleTarget(null);
          return;
        }
        if (driveConflict) {
          setDriveConflict(null);
          return;
        }
        if (showDriveSearch) {
          setShowDriveSearch(false);
          return;
        }
        if (showHistory) {
          setShowHistory(false);
          return;
        }
        if (bulkCategoryTarget) {
          setBulkCategoryTarget(null);
          return;
        }
        if (moveTargetDocs) {
          setMoveTargetDocs(null);
          return;
        }
        if (renameTarget) {
          setRenameTarget(null);
          return;
        }
        if (showUpload) {
          setShowUpload(false);
          return;
        }
        if (showGenerate) {
          setShowGenerate(false);
          return;
        }
        if (openMenuId) {
          setOpenMenuId(null);
          return;
        }
        if (showMobilePreview) {
          setShowMobilePreview(false);
          return;
        }
      }

      // Arrow keys / Page navigation for document preview
      if (preview && preview.pages > 1) {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        const isEditable =
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          (e.target as HTMLElement)?.isContentEditable;
        if (!isEditable) {
          if (e.key === "ArrowLeft" || e.key === "PageUp") {
            e.preventDefault();
            setCurrentPage((p) => Math.max(1, p - 1));
          } else if (e.key === "ArrowRight" || e.key === "PageDown") {
            e.preventDefault();
            setCurrentPage((p) => Math.min(preview.pages, p + 1));
          }
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    driveConflict,
    showDriveSearch,
    showHistory,
    bulkCategoryTarget,
    moveTargetDocs,
    renameTarget,
    showUpload,
    showGenerate,
    openMenuId,
    showMobilePreview,
    preview,
  ]);

  function openGenerateWithTemplate(doc: BoardDocument) {
    const isCover =
      doc.category === "cover-letter-template" || /cover/i.test(doc.name);
    setGenerateKind(isCover ? "cover" : "cv");
    setGenerateTemplateId(doc.id);
    if (!isCover && defaults.masterCvId) {
      setGenerateSourceCvId(defaults.masterCvId);
    }
    setShowGenerate(true);
  }

  function openGenerateWithSourceCv(doc: BoardDocument) {
    setGenerateKind("cv");
    setGenerateSourceCvId(doc.id);
    if (defaults.cvTemplateId) {
      setGenerateTemplateId(defaults.cvTemplateId);
    }
    setShowGenerate(true);
  }

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    setGenerating(true);
    setGenerationError("");
    try {
      const res = await api<{
        document: BoardDocument;
        preview: StudioPreview | null;
        aiNotes?: string;
      }>("/document-studio/generate", {
        method: "POST",
        body: JSON.stringify({
          kind: generateKind,
          sourceCvId: generateSourceCvId || undefined,
          templateId: generateTemplateId || undefined,
          layout: generateLayout || undefined,
          opportunityId: generateOpportunityId || undefined,
          role: generateRole.trim() || undefined,
          company: generateCompany.trim() || undefined,
          brief: generateBrief.trim() || undefined,
          instructions: generateInstructions.trim() || undefined,
          name: generateName.trim() || undefined,
        }),
        headers: { "Content-Type": "application/json" },
      });

      setShowGenerate(false);
      await loadData(true);
      setSelectedDocId(res.document.id);
      setShowMobilePreview(true);
      if (res.preview) {
        setPreview(res.preview);
      }
      onNotice?.(`Generated "${cleanDocName(res.document.name)}" successfully.`);
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : "Failed to generate document.");
      onError(err);
    } finally {
      setGenerating(false);
    }
  }

  // Phase 3: Template derivation handler
  async function handleCreateTemplate(doc: BoardDocument) {
    setCreatingTemplate(true);
    try {
      const res = await api<{
        document: BoardDocument;
        preview: StudioPreview | null;
      }>("/document-studio/create-template", {
        method: "POST",
        body: JSON.stringify({ sourceDocumentId: doc.id }),
        headers: { "Content-Type": "application/json" },
      });
      await loadData(true);
      setSelectedDocId(res.document.id);
      setShowMobilePreview(true);
      if (res.preview) setPreview(res.preview);
      onNotice?.(`Derived template "${cleanDocName(res.document.name)}" with neutral placeholders.`);

      if (showAssistant) {
        setChatMessages((prev) => [
          ...prev,
          {
            id: "msg-" + Date.now(),
            role: "assistant",
            content: `I've derived a reusable template from "${cleanDocName(doc.name)}" with neutral placeholders and saved it to your templates.`,
            action: "created_template",
            createdDocument: res.document,
          },
        ]);
      }
    } catch (err) {
      onError(err);
    } finally {
      setCreatingTemplate(false);
    }
  }

  // Phase 3: Studio Assistant Chat
  async function handleSendChat(textToSend?: string) {
    const message = (textToSend || chatInput).trim();
    if (!message || chatLoading) return;
    setChatInput("");

    const userMsgId = "user-" + Date.now();
    setChatMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: message },
    ]);

    const reqId = "req-" + Date.now();
    setChatRequestId(reqId);
    setChatLoading(true);

    try {
      const res = await api<{
        reply: string;
        createdDocument?: BoardDocument;
        revisedDocument?: BoardDocument;
        action?: string;
        cancelled?: boolean;
        canRetry?: boolean;
      }>("/document-studio/chat", {
        method: "POST",
        body: JSON.stringify({
          documentId: selectedDoc?.id || undefined,
          message,
          requestId: reqId,
        }),
        headers: { "Content-Type": "application/json" },
      });

      if (res.createdDocument || res.revisedDocument) {
        await loadData(true);
      }

      setChatMessages((prev) => [
        ...prev,
        {
          id: "asst-" + Date.now(),
          role: "assistant",
          content: res.reply,
          action: res.action,
          createdDocument: res.createdDocument,
          revisedDocument: res.revisedDocument,
        },
      ]);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        {
          id: "err-" + Date.now(),
          role: "assistant",
          content: err instanceof Error ? err.message : "Request failed.",
          error: true,
        },
      ]);
    } finally {
      setChatLoading(false);
      setChatRequestId(null);
    }
  }

  async function handleCancelChat() {
    if (!chatRequestId) return;
    try {
      await api("/document-studio/chat/cancel", {
        method: "POST",
        body: JSON.stringify({ requestId: chatRequestId }),
        headers: { "Content-Type": "application/json" },
      });
      setChatLoading(false);
      setChatRequestId(null);
      setChatMessages((prev) => [
        ...prev,
        {
          id: "cancel-" + Date.now(),
          role: "assistant",
          content: "Request cancelled.",
        },
      ]);
    } catch (err) {
      onError(err);
    }
  }

  // Phase 3: Version history & restore
  async function loadHistory(docId: string) {
    setHistoryLoading(true);
    setShowHistory(true);
    try {
      const res = await api<{ documentId: string; history: HistoryItem[] }>(
        `/document-studio/documents/${docId}/history`
      );
      setHistoryDocs(res.history || []);
    } catch (err) {
      onError(err);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleRestoreVersion(targetId: string) {
    if (!selectedDocId) return;
    setRestoring(true);
    try {
      const res = await api<{ document: BoardDocument }>(
        `/document-studio/documents/${selectedDocId}/restore`,
        {
          method: "POST",
          body: JSON.stringify({ targetId }),
          headers: { "Content-Type": "application/json" },
        }
      );
      await loadData(true);
      setSelectedDocId(res.document.id);
      setShowHistory(false);
      onNotice?.(`Restored version of "${cleanDocName(res.document.name)}".`);
    } catch (err) {
      onError(err);
    } finally {
      setRestoring(false);
    }
  }

  // Save selection in localStorage
  useEffect(() => {
    if (selectedDocId) {
      localStorage.setItem("knox-studio-selected", selectedDocId);
    }
  }, [selectedDocId]);

  useEffect(() => {
    if (initialDocumentId) {
      setSelectedDocId(initialDocumentId);
    }
  }, [initialDocumentId]);

  const selectedDoc = useMemo(
    () => docs.find((d) => d.id === selectedDocId) || null,
    [docs, selectedDocId],
  );

  useEffect(() => {
    onActiveDocumentChange?.(selectedDoc);
  }, [selectedDoc?.id, selectedDoc?.name]);

  // If initial selection was cleared or not in docs, pick default master CV or first doc
  useEffect(() => {
    if (!loading && docs.length > 0 && !selectedDoc) {
      const preferred =
        docs.find((d) => d.id === defaults.masterCvId) ||
        docs.find((d) => d.category === "master-cv") ||
        docs[0];
      if (preferred) setSelectedDocId(preferred.id);
    }
  }, [loading, docs, selectedDoc, defaults.masterCvId]);

  // Load preview whenever selectedDoc changes
  useEffect(() => {
    if (!selectedDoc) {
      setPreview(null);
      setMarkdownContent(null);
      setPreviewError("");
      return;
    }

    let active = true;
    setPreviewLoading(true);
    setPreviewError("");
    setCurrentPage(1);

    const isMarkdown = /\.(md|markdown|txt)$/i.test(selectedDoc.name);
    if (isMarkdown) {
      setPreview(null);
      fetch(`/api/documents/${selectedDoc.id}/content`)
        .then((r) => {
          if (!r.ok) throw new Error("Could not load document text.");
          return r.text();
        })
        .then((txt) => {
          if (!active) return;
          setMarkdownContent(txt);
        })
        .catch((err) => {
          if (!active) return;
          setMarkdownContent(null);
          setPreviewError(err instanceof Error ? err.message : "Failed to load document text.");
        })
        .finally(() => {
          if (active) setPreviewLoading(false);
        });
      return () => {
        active = false;
      };
    }

    setMarkdownContent(null);
    const isPreviewable = /\.(docx|dotx|pdf|gdoc|gsheet|gslides)$/i.test(selectedDoc.name);
    if (!isPreviewable) {
      setPreviewLoading(false);
      setPreview(null);
      return;
    }

    api<StudioPreview>("/document-studio/preview", {
      method: "POST",
      body: JSON.stringify({
        documentId: selectedDoc.id,
        revision: selectedDoc.revision ?? 1,
        layout: "original",
      }),
      headers: { "Content-Type": "application/json" },
    })
      .then((res) => {
        if (!active) return;
        setPreview(res);
      })
      .catch((err) => {
        if (!active) return;
        setPreview(null);
        setPreviewError(
          err instanceof ApiError && err.status === 503
            ? "Visual page rendering requires LibreOffice in the Docker container. Direct download is still available."
            : err instanceof Error ? err.message : "Preview could not be rendered."
        );
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedDoc?.id, selectedDoc?.revision, previewTrigger]);

  // Available folders for move / upload
  const existingFolders = useMemo(() => {
    const set = new Set<string>();
    for (const d of docs) {
      const folder = getDocFolder(d.name);
      if (folder) set.add(folder);
    }
    return Array.from(set).sort();
  }, [docs]);

  // Filtered documents
  const filteredDocs = useMemo(() => {
    return docs.filter((d) => {
      if (search.trim()) {
        const query = search.toLowerCase();
        const matchesName = d.name.toLowerCase().includes(query);
        const matchesTag = Array.isArray(d.tags) && d.tags.some((t) => t.toLowerCase().includes(query));
        const matchesCategory = (d.category || "").toLowerCase().includes(query);
        if (!matchesName && !matchesTag && !matchesCategory) return false;
      }

      switch (filter) {
        case "master-cv":
          if (d.category !== "master-cv") return false;
          break;
        case "templates":
          if (
            !["template", "cv-template", "cover-letter-template"].includes(d.category || "") &&
            !/\btemplate\b/i.test(d.name)
          )
            return false;
          break;
        case "generated":
          if (
            !["tailored-cv", "cover-letter"].includes(d.category || "") &&
            !Boolean(d.opportunityId) &&
            d.status !== "draft"
          )
            return false;
          break;
        case "all":
        default:
          break;
      }

      if (filetypeFilter !== "all") {
        const ext = (d.name.split(".").pop() || "").toLowerCase();
        if (filetypeFilter === "docx" && ext !== "docx" && ext !== "dotx" && ext !== "doc") return false;
        if (filetypeFilter === "pdf" && ext !== "pdf") return false;
        if (filetypeFilter === "md" && ext !== "md" && ext !== "markdown") return false;
        if (filetypeFilter === "txt" && ext !== "txt") return false;
        if (filetypeFilter === "gdoc" && !["gdoc", "gsheet", "gslides"].includes(ext)) return false;
      }

      return true;
    });
  }, [docs, search, filter, filetypeFilter]);

  // Grouped documents
  const groupedDocs = useMemo(() => {
    if (!groupByFolder) {
      return [["", filteredDocs]] as [string, BoardDocument[]][];
    }
    const map = new Map<string, BoardDocument[]>();
    for (const d of filteredDocs) {
      const folder = getDocFolder(d.name);
      const list = map.get(folder) || [];
      list.push(d);
      map.set(folder, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredDocs, groupByFolder]);

  // Defaults helpers
  async function updateDefault(key: keyof StudioDefaults, id: string) {
    try {
      const updated = await api<StudioDefaults>("/document-studio/defaults", {
        method: "PATCH",
        body: JSON.stringify({ [key]: id }),
        headers: { "Content-Type": "application/json" },
      });
      setDefaults(updated);
      onNotice?.("Document Studio defaults updated.");
    } catch (e) {
      onError(e);
    }
  }

  // Upload handler
  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!uploadFile) return;

    // Phase 5 checks: File size limit (> 20MB) and supported formats
    if (uploadFile.size > 20 * 1024 * 1024) {
      onError(new Error("File size exceeds 20 MB limit. Please select a smaller document."));
      return;
    }
    const ext = (uploadFile.name.split(".").pop() || "").toLowerCase();
    const allowed = ["docx", "dotx", "pdf", "md", "markdown", "txt", "gdoc", "gsheet", "gslides"];
    if (ext && !allowed.includes(ext)) {
      onError(
        new Error(
          `Document format ".${ext}" is not supported. Please upload Word (.docx, .dotx), PDF, Markdown (.md), or text files.`
        )
      );
      return;
    }

    setUploading(true);
    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const res = String(reader.result || "");
          const base64 = res.includes(",") ? res.split(",")[1] : res;
          resolve(base64);
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(uploadFile);
      const contentBase64 = await base64Promise;

      let filename = uploadFile.name;
      if (uploadFolder.trim()) {
        const cleanF = uploadFolder.trim().replace(/^[/\\]+|[/\\]+$/g, "");
        filename = `${cleanF}/${cleanDocName(uploadFile.name)}`;
      }

      const created = await api<BoardDocument>("/documents", {
        method: "POST",
        body: JSON.stringify({
          name: filename,
          category: uploadRole,
          kind: uploadRole === "cover-letter-template" ? "cover" : "cv",
          contentBase64,
        }),
        headers: { "Content-Type": "application/json" },
      });

      setShowUpload(false);
      setUploadFile(null);
      setUploadFolder("");
      await loadData(true);
      setSelectedDocId(created.id);
      setShowMobilePreview(true);
      onNotice?.(`Uploaded "${cleanDocName(created.name)}" as ${getCategoryLabel(uploadRole)}.`);
    } catch (err) {
      onError(err);
    } finally {
      setUploading(false);
    }
  }

  // Rename handler
  async function handleRename(e: FormEvent) {
    e.preventDefault();
    if (!renameTarget || !renameValue.trim()) return;
    setRenaming(true);
    try {
      const folder = getDocFolder(renameTarget.name);
      const ext = renameTarget.name.slice(renameTarget.name.lastIndexOf("."));
      let newName = renameValue.trim();
      if (!newName.endsWith(ext)) newName += ext;
      const fullNewName = folder ? `${folder}/${newName}` : newName;

      await api<BoardDocument>(`/documents/${renameTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          revision: renameTarget.revision ?? 1,
          name: fullNewName,
        }),
        headers: { "Content-Type": "application/json" },
      });

      setRenameTarget(null);
      await loadData(true);
      onNotice?.(`Renamed to "${newName}".`);
    } catch (err) {
      onError(err);
    } finally {
      setRenaming(false);
    }
  }

  // Duplicate handler
  async function handleDuplicate(doc: BoardDocument) {
    try {
      const dup = await api<BoardDocument>(`/documents/${doc.id}/duplicate`, {
        method: "POST",
      });
      await loadData(true);
      setSelectedDocId(dup.id);
      onNotice?.(`Duplicated "${cleanDocName(doc.name)}".`);
    } catch (err) {
      onError(err);
    }
  }

  // Move handler
  async function handleMove(e: FormEvent) {
    e.preventDefault();
    if (!moveTargetDocs?.length) return;
    setMoving(true);
    try {
      await api<{ documents: BoardDocument[] }>("/documents/move", {
        method: "POST",
        body: JSON.stringify({
          folder: moveFolderValue.trim(),
          documents: moveTargetDocs.map((d) => ({
            id: d.id,
            revision: d.revision ?? 1,
          })),
        }),
        headers: { "Content-Type": "application/json" },
      });

      setMoveTargetDocs(null);
      setCheckedIds([]);
      await loadData(true);
      onNotice?.(
        `Moved ${moveTargetDocs.length} document${moveTargetDocs.length === 1 ? "" : "s"} to "${moveFolderValue || "root"}".`
      );
    } catch (err) {
      onError(err);
    } finally {
      setMoving(false);
    }
  }

  // Bulk category assign handler
  async function handleBulkCategory(e: FormEvent) {
    e.preventDefault();
    if (!bulkCategoryTarget?.length) return;
    setCategorising(true);
    try {
      await api("/documents/categories", {
        method: "POST",
        body: JSON.stringify({
          category: selectedCategoryValue,
          documents: bulkCategoryTarget.map((d) => ({
            id: d.id,
            revision: d.revision ?? 1,
          })),
        }),
        headers: { "Content-Type": "application/json" },
      });

      setBulkCategoryTarget(null);
      setCheckedIds([]);
      await loadData(true);
      onNotice?.(`Assigned category to ${bulkCategoryTarget.length} documents.`);
    } catch (err) {
      onError(err);
    } finally {
      setCategorising(false);
    }
  }

  // Delete handler
  async function handleDelete(doc: BoardDocument) {
    if (doc.status === "submitted") {
      onError(new Error("Submitted documents are preserved and cannot be deleted."));
      return;
    }
    if (!window.confirm(`Delete "${cleanDocName(doc.name)}"? This cannot be undone.`)) return;

    try {
      await api(`/documents/${doc.id}`, { method: "DELETE" });
      if (selectedDocId === doc.id) setSelectedDocId("");
      await loadData(true);
      onNotice?.(`Deleted "${cleanDocName(doc.name)}".`);
    } catch (err) {
      onError(err);
    }
  }

  // Bulk delete handler
  async function handleBulkDelete() {
    const selected = docs.filter((d) => checkedIds.includes(d.id));
    const removable = selected.filter((d) => d.status !== "submitted");
    if (!removable.length) {
      onError(new Error("Selected documents are submitted and cannot be deleted."));
      return;
    }
    if (!window.confirm(`Delete ${removable.length} selected documents?`)) return;

    try {
      await api(`/documents?scope=library&ids=${removable.map((d) => d.id).join(",")}`, {
        method: "DELETE",
      });
      setCheckedIds([]);
      if (removable.some((d) => d.id === selectedDocId)) setSelectedDocId("");
      await loadData(true);
      onNotice?.(`Deleted ${removable.length} documents.`);
    } catch (err) {
      onError(err);
    }
  }

  // Checkbox toggle helpers
  function toggleCheck(id: string) {
    setCheckedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  function toggleAll() {
    if (checkedIds.length === filteredDocs.length) {
      setCheckedIds([]);
    } else {
      setCheckedIds(filteredDocs.map((d) => d.id));
    }
  }

  const defaultMasterDoc = docs.find((d) => d.id === defaults.masterCvId);
  const defaultCvTplDoc = docs.find((d) => d.id === defaults.cvTemplateId);
  const defaultCoverTplDoc = docs.find((d) => d.id === defaults.coverLetterTemplateId);

  if (isBuildingTemplate) {
    return (
      <TemplateBuilder
        initialTemplate={editingTemplateDef}
        onClose={() => {
          setIsBuildingTemplate(false);
          setEditingTemplateDef(null);
        }}
        onSaved={(doc) => {
          setIsBuildingTemplate(false);
          setEditingTemplateDef(null);
          onChanged?.();
          void loadData(true);
          if (doc?.id) setSelectedDocId(doc.id);
        }}
        onError={onError}
        onNotice={onNotice}
      />
    );
  }

  return (
    <div className="document-studio-container" onClick={() => setOpenMenuId(null)}>
      {/* Workspace Header */}
      <div className="workspace-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <button
              type="button"
              className="button secondary small"
              onClick={() => {
                if (onBackToCareerDocs) onBackToCareerDocs();
                else window.location.hash = "#/library";
              }}
            >
              <ArrowLeft size={14} /> Back to Career Docs
            </button>
          </div>
          <h1>Doc Studio</h1>
          <p>
            Preview pages, adjust formatting, derive templates, and export the active document.
          </p>
        </div>
        <div className="studio-header-actions" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {docs.length > 0 && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span className="text-muted">Active doc:</span>
              <select
                aria-label="Active document in Doc Studio"
                value={selectedDocId}
                onChange={(e) => setSelectedDocId(e.target.value)}
                style={{ maxWidth: 280 }}
              >
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {cleanDocName(d.name)} ({getCategoryLabel(d.category)})
                  </option>
                ))}
              </select>
            </label>
          )}
          {selectedDoc && onChatAboutDocument && (
            <button
              type="button"
              className="button secondary"
              onClick={() => onChatAboutDocument(selectedDoc)}
              title="Open Career Buddy with this document in context"
            >
              <MessageSquare size={16} />
              Chat with Career Buddy
            </button>
          )}
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setEditingTemplateDef(null);
              setIsBuildingTemplate(true);
            }}
            title="Create or edit a visual template with customizable columns, fonts, and colors"
          >
            <Sliders size={15} />
            Template Builder
          </button>
          <button
            type="button"
            className="button primary studio-generate-header-btn"
            onClick={() => {
              setGenerateKind("cv");
              if (defaults.masterCvId) setGenerateSourceCvId(defaults.masterCvId);
              if (defaults.cvTemplateId) setGenerateTemplateId(defaults.cvTemplateId);
              setShowGenerate(true);
            }}
          >
            <Sparkles size={16} />
            Generate
          </button>
        </div>
      </div>

      {/* Defaults bar */}
      <div className="studio-defaults-bar">
        <div className="studio-default-chip">
          <Star size={13} className="text-amber" />
          <span className="studio-chip-label">Default Master CV:</span>
          {defaultMasterDoc ? (
            <button
              type="button"
              className="studio-chip-value"
              onClick={() => setSelectedDocId(defaultMasterDoc.id)}
              title="Click to open default master CV"
            >
              {cleanDocName(defaultMasterDoc.name)}
            </button>
          ) : (
            <span className="studio-chip-empty">None set</span>
          )}
        </div>

        <div className="studio-default-chip">
          <Star size={13} className="text-amber" />
          <span className="studio-chip-label">Default CV Template:</span>
          {defaultCvTplDoc ? (
            <button
              type="button"
              className="studio-chip-value"
              onClick={() => setSelectedDocId(defaultCvTplDoc.id)}
              title="Click to open default CV template"
            >
              {cleanDocName(defaultCvTplDoc.name)}
            </button>
          ) : (
            <span className="studio-chip-empty">None set</span>
          )}
        </div>

        <div className="studio-default-chip">
          <Star size={13} className="text-amber" />
          <span className="studio-chip-label">Default Cover Template:</span>
          {defaultCoverTplDoc ? (
            <button
              type="button"
              className="studio-chip-value"
              onClick={() => setSelectedDocId(defaultCoverTplDoc.id)}
              title="Click to open default cover letter template"
            >
              {cleanDocName(defaultCoverTplDoc.name)}
            </button>
          ) : (
            <span className="studio-chip-empty">None set</span>
          )}
        </div>
      </div>

      {/* Single-Document Studio Workspace */}
      <div className="studio-single-doc-view" style={{ display: "block" }}>
        <div className="studio-preview-pane" style={{ width: "100%", borderLeft: "none" }}>
          {selectedDoc ? (
            <div className="studio-preview-content">
              {/* Preview Header */}
              <div className="studio-preview-header">
                <div className="studio-preview-title-row">
                  <h2>{cleanDocName(selectedDoc.name)}</h2>
                </div>

                <div className="studio-preview-meta">
                  <span className={`badge ${getCategoryBadgeClass(selectedDoc.category)}`}>
                    {getCategoryLabel(selectedDoc.category)}
                  </span>
                  <span className="studio-meta-item">{formatBytes(selectedDoc.size)}</span>
                  <button
                    type="button"
                    className="studio-version-tag-btn"
                    onClick={() => void loadHistory(selectedDoc.id)}
                    title="Click to view version history and restore previous versions"
                  >
                    <History size={12} />
                    <span>v{selectedDoc.version || 1} History</span>
                  </button>
                  {selectedDoc.status && (
                    <span className="badge badge-neutral">{selectedDoc.status}</span>
                  )}
                  {selectedDoc.opportunityId && (
                    <span className="badge badge-info">Linked to Opportunity</span>
                  )}
                </div>

                {selectedDoc.generation?.aiNotes && (
                  <div className="studio-ai-notes-banner" title={selectedDoc.generation.aiNotes}>
                    <Sparkles size={14} className="text-amber" />
                    <span>{selectedDoc.generation.aiNotes}</span>
                  </div>
                )}

                {/* Primary Preview Actions */}
                <div className="studio-preview-actions-bar">
                  {(["template", "cv-template", "cover-letter-template"].includes(selectedDoc.category || "") ||
                    /\btemplate\b/i.test(selectedDoc.name)) && (
                    <>
                      <button
                        type="button"
                        className="button primary small studio-context-generate-btn"
                        onClick={() => openGenerateWithTemplate(selectedDoc)}
                      >
                        <Sparkles size={14} /> Generate with template
                      </button>
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => {
                          setEditingTemplateDef(selectedDoc.generation?.templateDef || {
                            title: cleanDocName(selectedDoc.name).replace(/\.[^.]+$/, ""),
                          });
                          setIsBuildingTemplate(true);
                        }}
                        title="Edit layout, fonts, margins, or blocks in Template Builder"
                      >
                        <Sliders size={14} /> Edit in Template Builder
                      </button>
                    </>
                  )}

                  {selectedDoc.category === "master-cv" && (
                    <button
                      type="button"
                      className="button primary small studio-context-generate-btn"
                      onClick={() => openGenerateWithSourceCv(selectedDoc)}
                    >
                      <Sparkles size={14} /> Tailor from this CV
                    </button>
                  )}

                  {/* Turn into Template Action */}
                  {!["template", "cv-template", "cover-letter-template"].includes(selectedDoc.category || "") && (
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => void handleCreateTemplate(selectedDoc)}
                      disabled={creatingTemplate}
                      title="Derive a clean reusable template with neutral placeholders"
                    >
                      {creatingTemplate ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} className="text-amber" />}
                      Turn into Template
                    </button>
                  )}

                  {/* Toggle Studio Assistant Chat */}
                  <button
                    type="button"
                    className={`button secondary small studio-assistant-toggle ${showAssistant ? "active" : ""}`}
                    onClick={() => setShowAssistant((v) => !v)}
                    title="Toggle AI Studio Assistant panel"
                  >
                    <MessageSquare size={14} className={showAssistant ? "text-amber" : ""} />
                    Studio Assistant
                  </button>

                  {/* Export to Google Docs (Direct API + Local Copy) */}
                  {/\.(docx|dotx|md|markdown|txt)$/i.test(selectedDoc.name) && (
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => {
                        setExportGoogleResult(null);
                        setExportingGoogleTarget(selectedDoc);
                      }}
                      title="Export this document to Google Docs (via Direct Google Drive API or Local Copy)"
                    >
                      <Cloud size={14} />
                      Export to Google Docs
                    </button>
                  )}

                  {(selectedDoc.originalUrl || selectedDoc.externalSource?.url) && (
                    <a
                      href={selectedDoc.originalUrl || selectedDoc.externalSource?.url}
                      target="_blank"
                      rel="noreferrer"
                      className="button secondary small"
                      title="Open in Google Docs"
                    >
                      <ExternalLink size={14} />
                      Open in Google Docs
                    </a>
                  )}

                  {/* Refresh from Google Drive (Phase 4) */}
                  {selectedDoc.externalSource &&
                    ["google-drive", "google-docs"].includes(selectedDoc.externalSource.provider || "") && (
                      <button
                        type="button"
                        className="button secondary small"
                        disabled={refreshingDrive}
                        onClick={() => void handleRefreshFromDrive(selectedDoc)}
                        title="Check Google Drive for external updates and refresh snapshot"
                      >
                        {refreshingDrive ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                        Refresh from Drive
                      </button>
                    )}

                  <a
                    href={`/api/documents/${selectedDoc.id}/content`}
                    download={cleanDocName(selectedDoc.name)}
                    className="button secondary small"
                  >
                    <Download size={14} /> Download original
                  </a>

                  {preview?.pdfUrl && (
                    <a
                      href={preview.pdfUrl}
                      download={`${cleanDocName(selectedDoc.name).replace(/\.[a-zA-Z0-9]+$/, "")}.pdf`}
                      className="button secondary small"
                    >
                      <Download size={14} /> Download PDF
                    </a>
                  )}

                  {preview?.wordUrl && (
                    <a
                      href={preview.wordUrl}
                      download={`${cleanDocName(selectedDoc.name).replace(/\.[a-zA-Z0-9]+$/, "")}.docx`}
                      className="button secondary small"
                    >
                      <Download size={14} /> Download Word
                    </a>
                  )}

                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => void handleDuplicate(selectedDoc)}
                  >
                    <Copy size={14} /> Duplicate
                  </button>

                  {/* Quick default role button */}
                  {selectedDoc.category === "master-cv" && defaults.masterCvId !== selectedDoc.id && (
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => void updateDefault("masterCvId", selectedDoc.id)}
                    >
                      <Star size={14} className="text-amber" /> Set as default Master CV
                    </button>
                  )}

                  {(selectedDoc.category === "cv-template" || selectedDoc.category === "template") &&
                    defaults.cvTemplateId !== selectedDoc.id && (
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => void updateDefault("cvTemplateId", selectedDoc.id)}
                      >
                        <Star size={14} className="text-amber" /> Set as default CV Template
                      </button>
                    )}

                  {selectedDoc.category === "cover-letter-template" &&
                    defaults.coverLetterTemplateId !== selectedDoc.id && (
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => void updateDefault("coverLetterTemplateId", selectedDoc.id)}
                      >
                        <Star size={14} className="text-amber" /> Set as default Cover Template
                      </button>
                    )}
                </div>
              </div>

              {/* Preview Pages Viewer & Assistant Split Layout */}
              <div className={`studio-preview-layout ${showAssistant ? "with-assistant" : ""}`}>
                <div className="studio-viewer-body">
                  {previewLoading ? (
                    <div className="studio-loading-state">
                      <RefreshCw size={24} className="spinning text-muted" />
                      <p>Loading document preview…</p>
                    </div>
                  ) : markdownContent !== null ? (
                    <div className="studio-markdown-wrapper">
                      <MarkdownViewer
                        content={markdownContent}
                        filename={cleanDocName(selectedDoc.name)}
                      />
                    </div>
                  ) : previewError ? (
                    <div className="studio-preview-fallback">
                      <FileText size={40} className="text-muted" />
                      <p className="studio-fallback-message">{previewError}</p>
                      <div className="studio-preview-fallback-actions">
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => setPreviewTrigger((t) => t + 1)}
                        >
                          <RefreshCw size={14} /> Retry Preview
                        </button>
                        <a
                          href={`/api/documents/${selectedDoc.id}/content`}
                          download={cleanDocName(selectedDoc.name)}
                          className="button primary small"
                        >
                          <Download size={14} /> Download File
                        </a>
                      </div>
                    </div>
                  ) : preview && preview.images.length > 0 ? (
                    <div className="studio-page-container">
                      {/* Page navigator */}
                      {preview.pages > 1 && (
                        <div className="studio-page-navigator">
                          <button
                            type="button"
                            className="icon-button"
                            disabled={currentPage <= 1}
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            aria-label="Previous page"
                          >
                            <ChevronLeft size={18} />
                          </button>
                          <span>
                            Page {currentPage} of {preview.pages}
                          </span>
                          <button
                            type="button"
                            className="icon-button"
                            disabled={currentPage >= preview.pages}
                            onClick={() => setCurrentPage((p) => Math.min(preview.pages, p + 1))}
                            aria-label="Next page"
                          >
                            <ChevronRight size={18} />
                          </button>
                        </div>
                      )}

                      {/* Active page image */}
                      <div className="studio-page-display">
                        <img
                          src={preview.images[currentPage - 1]}
                          alt={`Page ${currentPage} of ${selectedDoc.name}`}
                          className="studio-rendered-page"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="studio-preview-fallback">
                      <FileText size={40} className="text-muted" />
                      <p>Preview unavailable for this format.</p>
                      <a
                        href={`/api/documents/${selectedDoc.id}/content`}
                        download={cleanDocName(selectedDoc.name)}
                        className="button primary"
                      >
                        <Download size={16} /> Download File
                      </a>
                    </div>
                  )}
                </div>

                {/* Studio Assistant Panel */}
                {showAssistant && (
                  <div className="studio-assistant-pane">
                    <div className="studio-assistant-header">
                      <div className="studio-assistant-title">
                        <Sparkles size={16} className="text-amber" />
                        <span>Studio Assistant</span>
                      </div>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => setShowAssistant(false)}
                        aria-label="Close assistant"
                      >
                        <X size={15} />
                      </button>
                    </div>

                    <div className="studio-assistant-messages">
                      {chatMessages.length === 0 ? (
                        <div className="studio-assistant-empty">
                          <Sparkles size={24} className="text-amber" />
                          <div className="studio-assistant-empty-title">Studio Assistant</div>
                          <p>
                            Ask the assistant to tweak spacing, derive a reusable template, or draft tailored content for this document.
                          </p>
                          <div className="studio-assistant-empty-chips">
                            <button
                              type="button"
                              className="studio-chip-prompt"
                              onClick={() => void handleSendChat("Tweak spacing and margins")}
                              disabled={chatLoading}
                            >
                              Tweak spacing
                            </button>
                            <button
                              type="button"
                              className="studio-chip-prompt"
                              onClick={() => void handleSendChat("Derive a template from this document")}
                              disabled={chatLoading}
                            >
                              Create template
                            </button>
                            <button
                              type="button"
                              className="studio-chip-prompt"
                              onClick={() => void handleSendChat("Draft a cover letter")}
                              disabled={chatLoading}
                            >
                              Draft cover letter
                            </button>
                          </div>
                        </div>
                      ) : (
                        chatMessages.map((msg) => (
                        <div key={msg.id} className={`studio-chat-msg ${msg.role} ${msg.error ? "error" : ""}`}>
                          <div className="studio-chat-bubble">
                            <p>{msg.content}</p>

                            {msg.createdDocument && (
                              <div className="studio-chat-doc-card">
                                <div className="studio-chat-doc-title">
                                  <FileText size={14} className="text-accent" />
                                  <span>{cleanDocName(msg.createdDocument.name)}</span>
                                </div>
                                <button
                                  type="button"
                                  className="button secondary small"
                                  onClick={() => {
                                    setSelectedDocId(msg.createdDocument!.id);
                                    setShowMobilePreview(true);
                                  }}
                                >
                                  View in Studio
                                </button>
                              </div>
                            )}

                            {msg.revisedDocument && (
                              <div className="studio-chat-doc-card">
                                <div className="studio-chat-doc-title">
                                  <FileText size={14} className="text-accent" />
                                  <span>{cleanDocName(msg.revisedDocument.name)}</span>
                                </div>
                                <button
                                  type="button"
                                  className="button secondary small"
                                  onClick={() => {
                                    setSelectedDocId(msg.revisedDocument!.id);
                                    setShowMobilePreview(true);
                                  }}
                                >
                                  View Revised Draft
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )))}
                      {chatLoading && (
                        <div className="studio-chat-msg assistant">
                          <div className="studio-chat-bubble studio-chat-loading">
                            <Loader2 size={15} className="spin text-accent" />
                            <span>Studio Assistant is working…</span>
                            <button
                              type="button"
                              className="button danger small studio-cancel-btn"
                              onClick={() => void handleCancelChat()}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="studio-assistant-chips">
                      <button
                        type="button"
                        className="studio-chip-prompt"
                        onClick={() => void handleSendChat("Turn this into a reusable template")}
                        disabled={chatLoading}
                      >
                        Turn into template
                      </button>
                      <button
                        type="button"
                        className="studio-chip-prompt"
                        onClick={() => void handleSendChat("Switch to compact layout with tighter spacing")}
                        disabled={chatLoading}
                      >
                        Tighter spacing
                      </button>
                      <button
                        type="button"
                        className="studio-chip-prompt"
                        onClick={() => void handleSendChat("Switch to executive layout")}
                        disabled={chatLoading}
                      >
                        Executive layout
                      </button>
                      <button
                        type="button"
                        className="studio-chip-prompt"
                        onClick={() => void handleSendChat("Shorten summary")}
                        disabled={chatLoading}
                      >
                        Shorten summary
                      </button>
                      <button
                        type="button"
                        className="studio-chip-prompt"
                        onClick={() => void handleSendChat("Draft a cover letter")}
                        disabled={chatLoading}
                      >
                        Draft cover letter
                      </button>
                    </div>

                    <form
                      className="studio-assistant-input-bar"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleSendChat();
                      }}
                    >
                      <input
                        type="text"
                        placeholder="Ask assistant to revise, tweak spacing, or create a template…"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        disabled={chatLoading}
                      />
                      <button
                        type="submit"
                        className="button primary studio-send-btn"
                        disabled={!chatInput.trim() || chatLoading}
                        aria-label="Send message"
                      >
                        <Send size={15} />
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="studio-no-selection">
              <FileText size={48} className="text-muted" />
              <h3>No document selected</h3>
              <p>Select a document in Career Docs to open and edit it in Doc Studio.</p>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  if (onBackToCareerDocs) onBackToCareerDocs();
                  else window.location.hash = "#/library";
                }}
              >
                <ArrowLeft size={16} /> Go to Career Docs
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Generate Document Modal (Phase 2) */}
      {showGenerate && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !generating) setShowGenerate(false);
          }}
        >
          <div
            className="modal studio-generate-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Generate Document"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2>Generate Document</h2>
                <p className="modal-subtitle">
                  Create a tailored CV or cover letter using your templates and verified career evidence.
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                disabled={generating}
                onClick={() => setShowGenerate(false)}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            {generationError && (
              <div className="alert error" role="alert">
                {generationError}
              </div>
            )}

            <form onSubmit={handleGenerate} className="form-grid">
              {/* Type Switcher */}
              <div className="field studio-type-switcher">
                <span className="field-label">Document Type</span>
                <div className="studio-type-pills">
                  <button
                    type="button"
                    className={`studio-type-pill ${generateKind === "cv" ? "active" : ""}`}
                    onClick={() => {
                      setGenerateKind("cv");
                      if (defaults.cvTemplateId) setGenerateTemplateId(defaults.cvTemplateId);
                      setGenerateLayout("classic");
                    }}
                  >
                    <FileText size={16} />
                    <span>Tailored CV</span>
                  </button>
                  <button
                    type="button"
                    className={`studio-type-pill ${generateKind === "cover" ? "active" : ""}`}
                    onClick={() => {
                      setGenerateKind("cover");
                      if (defaults.coverLetterTemplateId) setGenerateTemplateId(defaults.coverLetterTemplateId);
                      setGenerateLayout("letter");
                    }}
                  >
                    <Mail size={16} />
                    <span>Cover Letter</span>
                  </button>
                </div>
              </div>

              {/* Source CV (for CV) */}
              {generateKind === "cv" && (
                <label className="field">
                  <span>Source / Master CV (Facts & History)</span>
                  <select
                    value={generateSourceCvId}
                    onChange={(e) => setGenerateSourceCvId(e.target.value)}
                    required
                  >
                    <option value="">Choose a source CV…</option>
                    {docs
                      .filter((d) => d.category === "master-cv" || d.kind === "cv")
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {cleanDocName(d.name)}
                          {d.id === defaults.masterCvId ? " ★ (Default Master CV)" : ""}
                        </option>
                      ))}
                  </select>
                </label>
              )}

              {/* Template / Presentation */}
              <label className="field">
                <span>Presentation / Template</span>
                <select
                  value={generateTemplateId ? `template:${generateTemplateId}` : `layout:${generateLayout}`}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.startsWith("template:")) {
                      setGenerateTemplateId(val.replace("template:", ""));
                      setGenerateLayout("");
                    } else if (val.startsWith("layout:")) {
                      setGenerateTemplateId("");
                      setGenerateLayout(val.replace("layout:", ""));
                    }
                  }}
                >
                  <optgroup label="Built-in Presets">
                    {generateKind === "cv" ? (
                      <>
                        <option value="layout:classic">Classic layout (Spacious, single column)</option>
                        <option value="layout:compact">Compact layout (Concise, two-page target)</option>
                        <option value="layout:executive">Executive layout (Restrained Montserrat)</option>
                      </>
                    ) : (
                      <option value="layout:letter">Standard Letter layout (A4 formatted)</option>
                    )}
                  </optgroup>
                  {docs.some((d) =>
                    generateKind === "cv"
                      ? ["template", "cv-template"].includes(d.category || "") || /\b(template|dotx)\b/i.test(d.name) || /\.dotx$/i.test(d.name)
                      : ["template", "cover-letter-template"].includes(d.category || "") || /\b(cover|letter|template|dotx)\b/i.test(d.name) || /\.dotx$/i.test(d.name)
                  ) && (
                    <optgroup label="Library Templates">
                      {docs
                        .filter((d) =>
                          generateKind === "cv"
                            ? ["template", "cv-template"].includes(d.category || "") || /\b(template|dotx)\b/i.test(d.name) || /\.dotx$/i.test(d.name)
                            : ["template", "cover-letter-template"].includes(d.category || "") || /\b(cover|letter|template|dotx)\b/i.test(d.name) || /\.dotx$/i.test(d.name)
                        )
                        .map((d) => (
                          <option key={d.id} value={`template:${d.id}`}>
                            {cleanDocName(d.name)}
                            {(generateKind === "cv" && d.id === defaults.cvTemplateId) ||
                            (generateKind === "cover" && d.id === defaults.coverLetterTemplateId)
                              ? " ★ (Default Template)"
                              : ""}
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
              </label>

              {/* Target Opportunity */}
              <label className="field">
                <span>Target Opportunity (Optional)</span>
                <select
                  value={generateOpportunityId}
                  onChange={(e) => setGenerateOpportunityId(e.target.value)}
                >
                  <option value="">None (General / Standalone document)</option>
                  {opportunities.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.company} — {op.role}
                    </option>
                  ))}
                </select>
              </label>

              {/* If no opportunity, role & company fields */}
              {!generateOpportunityId && (
                <div className="studio-field-row">
                  <label className="field">
                    <span>Target Role</span>
                    <input
                      type="text"
                      placeholder="e.g. Lead Architect"
                      value={generateRole}
                      onChange={(e) => setGenerateRole(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Target Company</span>
                    <input
                      type="text"
                      placeholder="e.g. Acme Corp"
                      value={generateCompany}
                      onChange={(e) => setGenerateCompany(e.target.value)}
                    />
                  </label>
                </div>
              )}

              {/* Role Brief / Description */}
              {!generateOpportunityId && (
                <label className="field">
                  <span>Job Description / Role Brief (Optional)</span>
                  <textarea
                    rows={3}
                    placeholder="Paste role overview or requirements to tailor against…"
                    value={generateBrief}
                    onChange={(e) => setGenerateBrief(e.target.value)}
                  />
                </label>
              )}

              {/* Custom Candidate Focus */}
              <label className="field">
                <span>Focus / Candidate Instructions (Optional)</span>
                <input
                  type="text"
                  placeholder="e.g. Emphasize cloud architecture and team mentoring"
                  value={generateInstructions}
                  onChange={(e) => setGenerateInstructions(e.target.value)}
                />
              </label>

              {/* Output Name */}
              <label className="field">
                <span>Document Name</span>
                <input
                  type="text"
                  placeholder={generateKind === "cv" ? "CV - Role.docx" : "Cover letter - Role.docx"}
                  value={generateName}
                  onChange={(e) => setGenerateName(e.target.value)}
                />
              </label>

              <div className="form-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={generating}
                  onClick={() => setShowGenerate(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={generating || (generateKind === "cv" && !generateSourceCvId)}
                >
                  {generating ? (
                    <>
                      <Loader2 size={16} className="spinning" />
                      Generating &amp; rendering…
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      Generate {generateKind === "cv" ? "CV" : "Cover Letter"}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowUpload(false);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Upload Document"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2>Upload Document</h2>
                <p>Upload a master CV, template, or reference document.</p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowUpload(false)}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleUpload} className="form-grid">
              <label className="field">
                <span>Document Role</span>
                <select
                  value={uploadRole}
                  onChange={(e) => setUploadRole(e.target.value)}
                >
                  <option value="master-cv">Master CV (Factual source)</option>
                  <option value="cv-template">CV Template (Presentation / Layout)</option>
                  <option value="cover-letter-template">Cover Letter Template</option>
                  <option value="reference">Career Reference / Other</option>
                </select>
              </label>

              <label className="field">
                <span>Destination Folder (Optional)</span>
                <input
                  type="text"
                  placeholder="e.g. Templates or CVs"
                  value={uploadFolder}
                  onChange={(e) => setUploadFolder(e.target.value)}
                  list="studio-folder-list"
                />
                <datalist id="studio-folder-list">
                  {existingFolders.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </label>

              <label className="field full">
                <span>Choose File (Word, PDF, Google Doc shortcut, text)</span>
                <input
                  type="file"
                  required
                  accept=".docx,.dotx,.pdf,.gdoc,.gsheet,.gslides,.txt,.md"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                />
              </label>

              <div className="form-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setShowUpload(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={uploading || !uploadFile}
                >
                  {uploading ? "Uploading…" : "Upload Document"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRenameTarget(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Rename Document"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2>Rename Document</h2>
                <p>Update document name while preserving original extensions.</p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setRenameTarget(null)}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleRename} className="form-grid">
              <label className="field full">
                <span>New Name</span>
                <input
                  type="text"
                  required
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  autoFocus
                />
              </label>

              <div className="form-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setRenameTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={renaming || !renameValue.trim()}
                >
                  {renaming ? "Renaming…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Move Modal */}
      {moveTargetDocs && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMoveTargetDocs(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Move Document"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2>Move Document{moveTargetDocs.length > 1 ? "s" : ""}</h2>
                <p>
                  Moving {moveTargetDocs.length} item{moveTargetDocs.length === 1 ? "" : "s"}.
                  Links to applications and snapshots remain unchanged.
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setMoveTargetDocs(null)}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleMove} className="form-grid">
              <label className="field full">
                <span>Destination Folder (leave blank for root)</span>
                <input
                  type="text"
                  placeholder="e.g. CVs or Templates"
                  value={moveFolderValue}
                  onChange={(e) => setMoveFolderValue(e.target.value)}
                  list="studio-move-folders"
                  autoFocus
                />
                <datalist id="studio-move-folders">
                  {existingFolders.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </label>

              <div className="form-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setMoveTargetDocs(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={moving}
                >
                  {moving ? "Moving…" : "Move"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Category Assignment Modal */}
      {bulkCategoryTarget && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setBulkCategoryTarget(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Assign Category"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2>Assign Category</h2>
                <p>
                  Set document role for {bulkCategoryTarget.length} document{bulkCategoryTarget.length === 1 ? "" : "s"}.
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setBulkCategoryTarget(null)}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleBulkCategory} className="form-grid">
              <label className="field full">
                <span>Category</span>
                <select
                  value={selectedCategoryValue}
                  onChange={(e) => setSelectedCategoryValue(e.target.value)}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="form-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setBulkCategoryTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={categorising}
                >
                  {categorising ? "Saving…" : "Save Category"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Version History Modal (Phase 3) */}
      {showHistory && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowHistory(false);
          }}
        >
          <div
            className="modal studio-history-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Version History"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div className="modal-title-group">
                <History size={18} className="text-accent" />
                <h2>Version History</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowHistory(false)}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <div className="studio-history-content">
              {historyLoading ? (
                <div className="studio-loading-state">
                  <RefreshCw size={20} className="spinning text-muted" />
                  <p>Loading version history…</p>
                </div>
              ) : historyDocs.length === 0 ? (
                <p className="text-muted">No historical revisions found for this document.</p>
              ) : (
                <div className="studio-history-list">
                  {historyDocs.map((item) => (
                    <div
                      key={item.id}
                      className={`studio-history-item ${item.isCurrent ? "current" : ""}`}
                    >
                      <div className="studio-history-info">
                        <div className="studio-history-title-row">
                          <span className="badge badge-accent">v{item.version}</span>
                          <span className="studio-history-name">{cleanDocName(item.name)}</span>
                          {item.isCurrent && (
                            <span className="badge badge-green">Current Active</span>
                          )}
                        </div>
                        <div className="studio-history-date">
                          {new Date(item.createdAt).toLocaleString([], {
                            timeZone: timezone,
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </div>
                        {item.notes && <div className="studio-history-notes">{item.notes}</div>}
                        {item.aiNotes && <div className="studio-history-ai-notes">{item.aiNotes}</div>}
                      </div>

                      <div className="studio-history-actions">
                        {!item.isCurrent && (
                          <button
                            type="button"
                            className="button secondary small"
                            disabled={restoring}
                            onClick={() => void handleRestoreVersion(item.id)}
                          >
                            <RotateCcw size={13} /> Restore this version
                          </button>
                        )}
                        {item.isCurrent && (
                          <span className="text-muted text-sm">Active</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowHistory(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Google Drive Browse & Import Modal (Phase 4) */}
      {showDriveSearch && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowDriveSearch(false);
          }}
        >
          <div
            className="modal studio-drive-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Google Drive"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2>Google Drive Documents</h2>
                <p>Import Google Docs, Word (.docx), or PDF files as local snapshots.</p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close dialog"
                onClick={() => setShowDriveSearch(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSearchDriveSubmit} className="studio-drive-search-bar">
              <input
                type="text"
                placeholder="Search Google Drive by file name…"
                value={driveQuery}
                onChange={(e) => setDriveQuery(e.target.value)}
                autoFocus
              />
              <button type="submit" className="button secondary small" disabled={driveLoading}>
                <Search size={14} /> Search
              </button>
            </form>

            <div className="studio-drive-role-picker">
              <span>Assign Document Role on Import:</span>
              <select value={driveImportRole} onChange={(e) => setDriveImportRole(e.target.value)}>
                <option value="master-cv">Master CV</option>
                <option value="cv-template">CV Template</option>
                <option value="cover-letter-template">Cover Letter Template</option>
                <option value="reference">Career Reference</option>
              </select>
            </div>

            <div className="studio-drive-list">
              {driveLoading ? (
                <div className="studio-loading-state">
                  <RefreshCw size={22} className="spinning text-muted" />
                  <p>Searching Google Drive…</p>
                </div>
              ) : driveFiles.length === 0 ? (
                <div className="studio-empty-list">
                  <FileQuestion size={28} className="text-muted" />
                  <p>
                    {driveQuery.trim()
                      ? `No documents matching "${driveQuery}". Try a different search term.`
                      : "No supported documents found in Google Drive (looking for Google Docs, Word DOCX, and PDF)."}
                  </p>
                </div>
              ) : (
                driveFiles.map((file) => (
                  <div key={file.id} className="studio-drive-item">
                    <div className="studio-drive-item-info">
                      <div className="studio-drive-item-title">
                        {file.mimeType.includes("word") ? (
                          <FileText size={15} className="text-accent" />
                        ) : file.mimeType.includes("pdf") ? (
                          <FileText size={15} className="text-danger" />
                        ) : (
                          <Cloud size={15} className="text-blue" />
                        )}
                        <span>{file.name}</span>
                      </div>
                      <div className="studio-drive-item-meta">
                        <span>
                          Modified: {new Date(file.modifiedTime).toLocaleDateString([], { dateStyle: "medium" })}
                        </span>
                        <span>
                          {file.mimeType.includes("document")
                            ? "Google Doc"
                            : file.mimeType.includes("pdf")
                            ? "PDF"
                            : "Word DOCX"}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="button primary small"
                      disabled={driveImportingId === file.id}
                      onClick={() => void handleImportDriveFile(file)}
                    >
                      {driveImportingId === file.id ? "Importing…" : "Import"}
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowDriveSearch(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Google Drive Conflict Resolution Modal (Phase 4) */}
      {driveConflict && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDriveConflict(null);
          }}
        >
          <div
            className="modal studio-conflict-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Resolve Google Drive Conflict"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2>Google Drive Version Conflict</h2>
                <p>This document has been revised locally and also updated in Google Drive.</p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close dialog"
                onClick={() => setDriveConflict(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="studio-conflict-banner">
              <AlertTriangle size={20} className="flex-shrink-0" />
              <span>
                To protect your work, Opportunity Knox will never silently overwrite either version.
                Choose how you want to handle this change:
              </span>
            </div>

            <div className="studio-conflict-versions">
              <div className="studio-conflict-card">
                <h4>Local Version (v{driveConflict.localVersion})</h4>
                <p>Retain current local changes in Opportunity Knox.</p>
              </div>
              <div className="studio-conflict-card">
                <h4>Drive Version ({driveConflict.externalVersion})</h4>
                <p>Modified: {new Date(driveConflict.modifiedTime).toLocaleString()}</p>
              </div>
            </div>

            <div className="studio-conflict-actions">
              <button
                type="button"
                className="button primary"
                disabled={refreshingDrive}
                onClick={() => void handleRefreshFromDrive(driveConflict.document, "new-version")}
              >
                Import as New Version (v{driveConflict.localVersion + 1})
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={refreshingDrive}
                onClick={() => void handleRefreshFromDrive(driveConflict.document, "separate-copy")}
              >
                Save External Update as Separate Copy
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={refreshingDrive}
                onClick={() => void handleRefreshFromDrive(driveConflict.document, "keep-local")}
              >
                Keep Local Version (Ignore External Update)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export to Google Docs Modal (Direct API & Local Copy) */}
      {exportingGoogleTarget && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !exportingGoogleMode) {
              setExportingGoogleTarget(null);
            }
          }}
        >
          <div
            className="modal studio-export-google-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Export to Google Docs"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2>Export to Google Docs</h2>
                <p>
                  Export <strong>{cleanDocName(exportingGoogleTarget.name)}</strong> via Direct Google Drive API or Local Copy.
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close dialog"
                disabled={Boolean(exportingGoogleMode)}
                onClick={() => setExportingGoogleTarget(null)}
              >
                <X size={18} />
              </button>
            </div>

            {exportGoogleResult && (
              <div
                className="alert"
                style={{
                  background: "var(--panel-soft)",
                  border: "1px solid var(--green, #10b981)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "var(--green, #10b981)" }}>
                  <Check size={16} />
                  <span>{exportGoogleResult.message}</span>
                </div>
                {exportGoogleResult.url && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <a
                      href={exportGoogleResult.url}
                      target="_blank"
                      rel="noreferrer"
                      className="button primary small"
                    >
                      <ExternalLink size={14} /> Open in Google Docs
                    </a>
                  </div>
                )}
                {exportGoogleResult.filePath && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
                    <div>
                      Saved to: <code>{exportGoogleResult.filePath}</code>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => {
                          void navigator.clipboard?.writeText(exportGoogleResult.filePath || "");
                          onNotice?.("Copied local file path to clipboard.");
                        }}
                      >
                        <Copy size={13} /> Copy file path
                      </button>
                      <a
                        href="https://drive.google.com/drive/my-drive"
                        target="_blank"
                        rel="noreferrer"
                        className="button secondary small"
                      >
                        <ExternalLink size={13} /> Open Google Drive
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="studio-export-options-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
              {/* Option 1: Direct Google Drive API */}
              <div
                className="studio-export-option-card"
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  padding: 16,
                  background: "var(--panel-soft)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                      <Cloud size={17} className="text-accent" />
                      <span>Direct Google Drive API</span>
                    </div>
                    <span className={`badge ${connections?.google.connected ? "badge-green" : "badge-neutral"}`}>
                      {connections?.google.connected ? "Connected" : "Not connected"}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
                    Uploads the formatted Word document directly to your Google Drive and automatically converts it into a native, editable Google Doc.
                  </p>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(exportingGoogleTarget.originalUrl || exportingGoogleTarget.externalSource?.url) && (
                    <a
                      href={exportingGoogleTarget.originalUrl || exportingGoogleTarget.externalSource?.url}
                      target="_blank"
                      rel="noreferrer"
                      className="button secondary small"
                      style={{ justifyContent: "center" }}
                    >
                      <ExternalLink size={14} /> Open Existing Google Doc
                    </a>
                  )}
                  {connections?.google.connected ? (
                    <button
                      type="button"
                      className="button primary"
                      disabled={Boolean(exportingGoogleMode)}
                      onClick={() => void handleExportToGoogleDocs(exportingGoogleTarget, "api")}
                      style={{ justifyContent: "center" }}
                    >
                      {exportingGoogleMode === "api" ? (
                        <>
                          <Loader2 size={15} className="spin" /> Uploading to Google Docs…
                        </>
                      ) : (
                        <>
                          <Cloud size={15} /> Upload &amp; Open in Google Docs
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        setExportingGoogleTarget(null);
                        window.location.hash = "/settings?section=connections";
                      }}
                      style={{ justifyContent: "center" }}
                    >
                      <Cloud size={15} /> Connect Google in Settings
                    </button>
                  )}
                </div>
              </div>

              {/* Option 2: Local Copy & Sync */}
              <div
                className="studio-export-option-card"
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  padding: 16,
                  background: "var(--panel-soft)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                      <Folder size={17} className="text-amber" />
                      <span>Local Copy (Sync / Upload)</span>
                    </div>
                    <span className="badge badge-blue">No API setup required</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
                    Saves a formatted <code>.docx</code> copy to your configured applications &amp; exports folder (synced automatically if using Google Drive for Desktop) or downloads it directly.
                  </p>
                  {connections?.google.localExportPath && (
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                      Export folder: <code>{connections.google.localExportPath}</code>
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button
                    type="button"
                    className="button primary"
                    disabled={Boolean(exportingGoogleMode)}
                    onClick={() => void handleExportToGoogleDocs(exportingGoogleTarget, "local")}
                    style={{ justifyContent: "center" }}
                  >
                    {exportingGoogleMode === "local" ? (
                      <>
                        <Loader2 size={15} className="spin" /> Saving local copy…
                      </>
                    ) : (
                      <>
                        <FolderPlus size={15} /> Save to Local Export Folder
                      </>
                    )}
                  </button>
                  <div style={{ display: "flex", gap: 8 }}>
                    <a
                      href={`/api/documents/${exportingGoogleTarget.id}/content`}
                      download={
                        cleanDocName(exportingGoogleTarget.name).replace(/\.(md|markdown|txt)$/i, "") +
                        (/\.(docx|dotx)$/i.test(exportingGoogleTarget.name) ? "" : ".docx")
                      }
                      className="button secondary small"
                      style={{ flex: 1, justifyContent: "center" }}
                    >
                      <Download size={14} /> Download .docx
                    </a>
                    <a
                      href="https://docs.new"
                      target="_blank"
                      rel="noreferrer"
                      className="button secondary small"
                      style={{ flex: 1, justifyContent: "center" }}
                      title="Open a new Google Doc (File → Open → Upload)"
                    >
                      <ExternalLink size={14} /> Open docs.new
                    </a>
                  </div>
                </div>
              </div>
            </div>

            <div className="form-actions" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="button secondary"
                disabled={Boolean(exportingGoogleMode)}
                onClick={() => setExportingGoogleTarget(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useRef } from "react";
import { api, type DroppedFile } from "../api";
import {
  uploadQueue,
  uploadId,
  type UploadOptions,
  type QueuedUpload,
} from "../lib/upload-queue";
export function useUploadQueue(
  opportunityId: string | undefined,
  onRestore: (options: UploadOptions) => void,
) {
  const [files, setFiles] = useState<QueuedUpload[]>([]),
    [ready, setReady] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const scope = useRef(""),
    owner = useRef(uploadId()),
    restore = useRef(onRestore),
    pulse = useRef<number | null>(null),
    channel = useRef<BroadcastChannel | null>(null);
  restore.current = onRestore;
  async function refresh() {
    if (scope.current) {
      const data = await uploadQueue.load(scope.current);
      setFiles(data.files);
    }
  }
  const report = (e: unknown) =>
    setError(
      e instanceof Error ? e.message : "Could not save the upload queue.",
    );
  useEffect(() => {
    let active = true;
    void api<{ id: string }>("/uploads/workspace")
      .then(async (workspace) => {
        scope.current = workspace.id + ":" + (opportunityId || "library");
        const data = await uploadQueue.load(scope.current);
        if (!active) return;
        setFiles(data.files);
        if (data.options) restore.current(data.options);
        setReady(true);
        if (typeof BroadcastChannel !== "undefined") {
          channel.current = new BroadcastChannel("knox-uploads");
          channel.current.onmessage = (e) => {
            if (e.data === scope.current) void refresh().catch(report);
          };
        }
      })
      .catch(report);
    return () => {
      active = false;
      channel.current?.close();
      channel.current = null;
      if (pulse.current) window.clearInterval(pulse.current);
    };
  }, [opportunityId]);
  function notify() {
    channel.current?.postMessage(scope.current);
  }
  async function add(incoming: DroppedFile[]) {
    if (!ready) throw Error("Wait for the saved upload queue to load.");
    setSaving(true);
    setError("");
    try {
      await uploadQueue.add(scope.current, incoming);
      await refresh();
      notify();
    } catch (e) {
      report(e);
      throw e;
    } finally {
      setSaving(false);
    }
  }
  async function remove(ids: string[] | null) {
    setSaving(true);
    try {
      await uploadQueue.remove(scope.current, ids);
      await refresh();
      notify();
    } catch (e) {
      report(e);
    } finally {
      setSaving(false);
    }
  }
  return {
    files,
    ready,
    saving,
    error,
    add,
    remove,
    refresh,
    saveOptions: async (options: UploadOptions) => {
      try {
        await uploadQueue.options(scope.current, options);
      } catch (e) {
        report(e);
      }
    },
    begin: async () => {
      await uploadQueue.lease(scope.current, owner.current);
      pulse.current = window.setInterval(
        () =>
          void uploadQueue.lease(scope.current, owner.current).catch(report),
        5000,
      );
    },
    end: async () => {
      if (pulse.current) window.clearInterval(pulse.current);
      pulse.current = null;
      await uploadQueue.lease(scope.current, owner.current, true).catch(report);
      notify();
    },
    attempt: (item: QueuedUpload, options: UploadOptions) =>
      uploadQueue.attempt(scope.current, item.id, owner.current, options),
    complete: async (item: QueuedUpload) => {
      await uploadQueue.remove(scope.current, [item.id], owner.current);
      await refresh();
      notify();
    },
    failed: (item: QueuedUpload, message: string) =>
      uploadQueue.failed(scope.current, item.id, message),
  };
}

'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { UseIntentTemplatesResult } from '@/hooks/useIntentTemplates';
import type { IntentTemplate } from '@/lib/templates/schema';
import { templateCorridorLabel } from '@/lib/templates/schema';
import { templateExportFilename, MAX_IMPORT_BYTES, type ImportMode } from '@/lib/templates/transfer';
import { templateErrorMessage } from './SaveTemplateForm';

export interface TemplateManagerProps {
  open: boolean;
  onClose: () => void;
  api: UseIntentTemplatesResult;
}

export function TemplateManager({ open, onClose, api }: TemplateManagerProps): React.ReactElement | null {
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingMode, setEditingMode] = useState<'rename' | 'amount' | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      headingRef.current?.focus();
      setEditingId(null);
      setEditingMode(null);
      setEditError(null);
      setDeletingId(null);
      setImportStatus(null);
      setImportError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const handleStartRename = useCallback((t: IntentTemplate) => {
    setEditingId(t.id);
    setEditingMode('rename');
    setEditValue(t.label);
    setEditError(null);
    setDeletingId(null);
  }, []);

  const handleStartEditAmount = useCallback((t: IntentTemplate) => {
    setEditingId(t.id);
    setEditingMode('amount');
    setEditValue(t.amount);
    setEditError(null);
    setDeletingId(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingMode(null);
    setEditError(null);
  }, []);

  const handleSaveEdit = useCallback(
    (id: string) => {
      if (editingMode === 'rename') {
        const res = api.rename(id, editValue);
        if (!res.ok) {
          setEditError(templateErrorMessage(res));
          return;
        }
        setEditingId(null);
        setEditingMode(null);
        setEditError(null);
      } else if (editingMode === 'amount') {
        const res = api.updateAmount(id, editValue);
        if (!res.ok) {
          setEditError(templateErrorMessage(res));
          return;
        }
        setEditingId(null);
        setEditingMode(null);
        setEditError(null);
      }
    },
    [api, editingMode, editValue]
  );

  const handleDeleteConfirm = useCallback(
    (id: string) => {
      api.remove(id);
      setDeletingId(null);
    },
    [api]
  );

  const handleExport = useCallback(() => {
    const json = api.exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = templateExportFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [api]);

  const handleImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setImportStatus(null);
      setImportError(null);

      if (file.size > MAX_IMPORT_BYTES) {
        setImportError('File is too large.');
        e.target.value = '';
        return;
      }

      try {
        const text = await file.text();
        const res = api.importJson(text, importMode);
        if (!res.ok) {
          setImportError(res.error);
        } else {
          setImportStatus(
            `Imported: ${res.summary.added} added, ${res.summary.updated} updated, ${res.summary.skipped} skipped.`
          );
        }
      } catch {
        setImportError('This file is not valid JSON.');
      }
      e.target.value = '';
    },
    [api, importMode]
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-manager-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="border-border bg-bg-base text-primary-text max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <h2 id="template-manager-heading" tabIndex={-1} ref={headingRef} className="text-xl font-bold outline-none">
            Manage templates
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-fg-muted hover:text-primary-text rounded-lg p-1 text-sm font-medium"
          >
            Close
          </button>
        </div>

        <div className="my-6 space-y-4">
          {api.templates.length === 0 ? (
            <p className="text-fg-muted text-sm">No saved templates yet.</p>
          ) : (
            <ul className="divide-border divide-y">
              {api.templates.map((t) => {
                const isEditing = editingId === t.id;
                const isDeleting = deletingId === t.id;

                return (
                  <li key={t.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold">{t.label}</p>
                        <p className="text-fg-muted text-xs">
                          {t.amount} {templateCorridorLabel(t.corridorId)}
                        </p>
                      </div>

                      {!isEditing && !isDeleting && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            aria-label={`Rename ${t.label}`}
                            onClick={() => handleStartRename(t)}
                            className="text-primary-text hover:text-accent text-xs underline-offset-2 hover:underline"
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            aria-label={`Edit amount for ${t.label}`}
                            onClick={() => handleStartEditAmount(t)}
                            className="text-primary-text hover:text-accent text-xs underline-offset-2 hover:underline"
                          >
                            Edit amount
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${t.label}`}
                            onClick={() => setDeletingId(t.id)}
                            className="text-status-error text-xs hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>

                    {isEditing && (
                      <div className="mt-3 space-y-2 rounded-lg border border-border p-3">
                        <label
                          htmlFor={editingMode === 'rename' ? `rename-${t.id}` : `amount-${t.id}`}
                          className="text-fg-muted block text-xs font-medium"
                        >
                          {editingMode === 'rename' ? 'New name' : 'Amount'}
                        </label>
                        <input
                          id={editingMode === 'rename' ? `rename-${t.id}` : `amount-${t.id}`}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          aria-invalid={!!editError}
                          className="border-border bg-bg-base text-primary-text focus-visible:ring-accent w-full rounded-lg border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
                        />
                        {editError && (
                          <p role="alert" className="text-status-error text-xs font-medium">
                            {editError}
                          </p>
                        )}
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(t.id)}
                            className="bg-accent text-white rounded-md px-3 py-1 text-xs font-medium hover:opacity-90"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            className="text-fg-muted hover:text-primary-text px-2 py-1 text-xs font-medium"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {isDeleting && (
                      <div className="mt-3 space-y-2 rounded-lg border border-border p-3">
                        <p className="text-xs font-medium">Delete &quot;{t.label}&quot;?</p>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleDeleteConfirm(t.id)}
                            className="bg-status-error text-white rounded-md px-3 py-1 text-xs font-medium hover:opacity-90"
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingId(null)}
                            className="text-fg-muted hover:text-primary-text px-2 py-1 text-xs font-medium"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border pt-4 space-y-4">
          <div>
            <button
              type="button"
              onClick={handleExport}
              className="border-border bg-bg-sunken hover:bg-bg-base text-primary-text rounded-lg border px-3 py-1.5 text-xs font-medium"
            >
              Export templates
            </button>
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <label htmlFor="template-import" className="text-fg-muted block text-xs font-medium">
              Import templates (JSON)
            </label>
            <input
              id="template-import"
              type="file"
              accept="application/json,.json"
              onChange={handleImportFile}
              className="text-primary-text block w-full text-xs file:mr-3 file:rounded-md file:border file:border-border file:bg-bg-sunken file:px-2.5 file:py-1 file:text-xs file:font-medium hover:file:bg-bg-base"
            />

            <fieldset className="space-y-1 pt-1">
              <legend className="text-fg-muted text-xs font-medium">When importing</legend>
              <div className="flex items-center gap-4 text-xs">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="import-mode"
                    value="merge"
                    checked={importMode === 'merge'}
                    onChange={() => setImportMode('merge')}
                  />
                  Merge with my templates
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="import-mode"
                    value="replace"
                    checked={importMode === 'replace'}
                    onChange={() => setImportMode('replace')}
                  />
                  Replace my templates
                </label>
              </div>
            </fieldset>

            {importStatus && (
              <p role="status" className="text-status-success text-xs font-medium">
                {importStatus}
              </p>
            )}
            {importError && (
              <p role="alert" className="text-status-error text-xs font-medium">
                {importError}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

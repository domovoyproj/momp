export interface FileEditorDraft {
  content: string;
  baseline: string | null;
}

export function createFileEditorDraftStore() {
  const drafts = new Map<string, FileEditorDraft>();
  const pendingSaves = new Map<string, Promise<string | null>>();
  const protectedEdits = new Set<string>();

  return {
    get(key: string): FileEditorDraft | null {
      const draft = drafts.get(key);
      return draft ? { ...draft } : null;
    },
    set(key: string, draft: FileEditorDraft, userEdit = false, confirmedRead = false): void {
      if (userEdit && pendingSaves.has(key)) protectedEdits.add(key);
      if (confirmedRead && !pendingSaves.has(key)) protectedEdits.delete(key);
      if (draft.baseline !== null && draft.content === draft.baseline && !protectedEdits.has(key)) drafts.delete(key);
      else drafts.set(key, { ...draft });
    },
    retainFiles(filePaths: string[]): void {
      const retained = new Set(filePaths);
      for (const key of drafts.keys()) {
        const [filePath] = JSON.parse(key) as [string, string | null, string | null];
        if (!retained.has(filePath)) {
          drafts.delete(key);
          protectedEdits.delete(key);
        }
      }
    },
    pendingSave(key: string): Promise<string | null> | null {
      return pendingSaves.get(key) ?? null;
    },
    hasProtectedEdit(key: string): boolean {
      return protectedEdits.has(key);
    },
    beginSave(key: string): ((savedContent?: string | null) => void) | null {
      if (pendingSaves.has(key)) return null;
      let complete!: (savedContent: string | null) => void;
      const pending = new Promise<string | null>((resolve) => { complete = resolve; });
      pendingSaves.set(key, pending);
      return (savedContent = null) => {
        if (pendingSaves.get(key) !== pending) return;
        pendingSaves.delete(key);
        if (savedContent !== null) protectedEdits.delete(key);
        const draft = drafts.get(key);
        if (draft) {
          if (savedContent === null) protectedEdits.add(key);
          const baseline = savedContent ?? draft.baseline;
          if (draft.content === baseline && !protectedEdits.has(key)) drafts.delete(key);
          else drafts.set(key, { content: draft.content, baseline });
        }
        complete(savedContent);
      };
    },
  };
}

export type FileEditorDraftStore = ReturnType<typeof createFileEditorDraftStore>;

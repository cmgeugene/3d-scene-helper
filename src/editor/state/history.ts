export const HISTORY_LIMIT = 50 as const;

export interface HistoryEntry<Document, MutationKind extends string = string> {
  document: Document;
  mutationKind: MutationKind;
  selectedObjectId?: string | null;
}

export interface DocumentHistory<
  Document,
  MutationKind extends string = string,
> {
  past: Array<HistoryEntry<Document, MutationKind>>;
  future: Array<HistoryEntry<Document, MutationKind>>;
}

export function createDocumentHistory<
  Document,
  MutationKind extends string = string,
>(): DocumentHistory<Document, MutationKind> {
  return { past: [], future: [] };
}

export function recordDocumentHistory<Document, MutationKind extends string>(
  history: DocumentHistory<Document, MutationKind>,
  document: Document,
  mutationKind: MutationKind,
  allowlist: readonly MutationKind[],
  selectedObjectId?: string | null,
): DocumentHistory<Document, MutationKind> {
  if (!allowlist.includes(mutationKind)) {
    return history;
  }

  return {
    past: [
      ...history.past.slice(-(HISTORY_LIMIT - 1)),
      {
        document: structuredClone(document),
        mutationKind,
        selectedObjectId,
      },
    ],
    future: [],
  };
}

export function undoDocumentHistory<
  Document,
  MutationKind extends string = string,
>(
  history: DocumentHistory<Document, MutationKind>,
  currentDocument: Document,
  currentSelectedObjectId?: string | null,
): {
  document: Document;
  mutationKind: MutationKind;
  selectedObjectId?: string | null;
  history: DocumentHistory<Document, MutationKind>;
} | null {
  const entry = history.past.at(-1);
  if (entry === undefined) return null;

  return {
    document: structuredClone(entry.document),
    mutationKind: entry.mutationKind,
    selectedObjectId: entry.selectedObjectId,
    history: {
      past: history.past.slice(0, -1),
      future: [
        ...history.future,
        {
          document: structuredClone(currentDocument),
          mutationKind: entry.mutationKind,
          selectedObjectId: currentSelectedObjectId,
        },
      ],
    },
  };
}

export function redoDocumentHistory<
  Document,
  MutationKind extends string = string,
>(
  history: DocumentHistory<Document, MutationKind>,
  currentDocument: Document,
  currentSelectedObjectId?: string | null,
): {
  document: Document;
  mutationKind: MutationKind;
  selectedObjectId?: string | null;
  history: DocumentHistory<Document, MutationKind>;
} | null {
  const entry = history.future.at(-1);
  if (entry === undefined) return null;

  return {
    document: structuredClone(entry.document),
    mutationKind: entry.mutationKind,
    selectedObjectId: entry.selectedObjectId,
    history: {
      past: [
        ...history.past,
        {
          document: structuredClone(currentDocument),
          mutationKind: entry.mutationKind,
          selectedObjectId: currentSelectedObjectId,
        },
      ].slice(-HISTORY_LIMIT),
      future: history.future.slice(0, -1),
    },
  };
}

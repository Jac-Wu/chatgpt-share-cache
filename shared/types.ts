export type MessageRole = 'user' | 'assistant';
export type ParseMethod = 'next-data' | 'router-stream' | 'structured-json' | 'html';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
}

export interface ParsedConversation {
  title: string;
  messages: ChatMessage[];
  model: string | null;
  warnings: string[];
  parseMethod: ParseMethod;
}

export interface ArchiveSummary {
  id: string;
  title: string;
  excerpt: string;
  sourceUrl: string;
  createdAt: string;
  messageCount: number;
  byteSize: number;
  favorite: boolean;
  model: string | null;
  importMethod: 'link' | 'html';
}

export interface Archive extends ArchiveSummary {
  messages: ChatMessage[];
  warnings: string[];
  parseMethod: ParseMethod;
  isOwner: boolean;
}

export interface ArchiveList {
  archives: ArchiveSummary[];
  stats: {
    total: number;
    favorites: number;
    messages: number;
    bytes: number;
  };
}

export interface CreateArchiveResult {
  archive: Archive;
  cached: boolean;
  cachePath: string;
  cacheUrl: string;
}

export interface AdminArchiveList {
  archives: ArchiveSummary[];
  page: number;
  pageSize: number;
  total: number;
  stats: { total: number; workspaces: number; messages: number; bytes: number };
}

export interface AdminSession {
  expiresAt: number;
}

export interface ApiErrorBody {
  error: string;
  code: string;
}

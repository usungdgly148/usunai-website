export interface ContentItem {
  id: string;
  kind?: string;
  name: string;
  description?: string;
  category?: string;
  avatar?: string;
  icon?: string;
  tags?: string[];
  opening?: string;
  suggestedQuestions?: string[];
  resultKind?: string;
  uses?: number;
}

export interface CategoryItem { id: string; key?: string; name?: string; label?: string; }
export interface PublicContent {
  agents: ContentItem[];
  workflows: ContentItem[];
  categories: CategoryItem[];
  categoryGroups: CategoryItem[];
  banners: Array<Record<string, unknown>>;
  announcements: Array<Record<string, unknown>>;
  recommended: string[];
}

export interface UserProfile {
  id: string;
  name: string;
  nickname: string;
  avatar?: string;
  email?: string;
  phone?: string;
  points: number;
  balance: number;
  validTo: string | null;
  expired: boolean;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  meta: { requestId: string; timestamp: string; page?: number; pageSize?: number; total?: number; totalPages?: number };
  error?: { code: string; message: string };
}

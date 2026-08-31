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
  supportsImages?: boolean;
  assetCategory?: 'copy' | 'image' | 'video' | 'audio' | 'article';
  formFields?: FormField[];
  outputFields?: Array<Record<string, unknown>>;
}

export interface FormField {
  id?: string;
  key?: string;
  name?: string;
  label?: string;
  type?: string;
  inputType?: string;
  itemType?: string;
  required?: boolean;
  placeholder?: string;
  options?: Array<string | { label?: string; value?: string }>;
}

export interface RuntimeTask {
  id: string;
  workflowId: string;
  name?: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
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

export type MiniappLayoutBlockType = 'carousel' | 'announcements' | 'search' | 'categories' | 'featured-agents' | 'featured-workflows' | 'quick-links' | 'spacer';
export interface MiniappLayoutBlock {
  id: string;
  type: MiniappLayoutBlockType;
  visible: boolean;
  title?: string;
  image?: string;
  backgroundColor?: string;
  textColor?: string;
  spacing?: number;
  link?: string;
  dataSource?: 'recommended' | 'all' | 'current-category' | '';
  limit?: number;
}
export interface MiniappLayout { page: 'home' | 'category'; blocks: MiniappLayoutBlock[]; }

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

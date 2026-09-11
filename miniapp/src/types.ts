export interface ContentItem {
  id: string;
  kind?: string;
  name: string;
  description?: string;
  category?: string;
  avatar?: string;
  icon?: string;
  iconColor?: string;
  desc?: string;
  cardGradient?: string;
  cardBg?: string;
  gradientFrom?: string;
  gradientTo?: string;
  gradientAngle?: number;
  tags?: string[];
  opening?: string;
  suggestedQuestions?: string[];
  resultKind?: string;
  uses?: number;
  priceRate?: number;
  tutorialImage?: string;
  tutorialUrl?: string;
  tutorialTitle?: string;
  supportsImages?: boolean;
  assetCategory?: 'copy' | 'image' | 'video' | 'audio' | 'article';
  formFields?: FormField[];
  outputFields?: Array<Record<string, unknown>>;
}

export interface FormFieldOption {
  label?: string;
  value?: string;
}

export interface FormFieldAdvanced {
  component?: string;
  options?: Array<string | FormFieldOption>;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
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
  hint?: string;
  options?: Array<string | FormFieldOption>;
  default?: unknown;
  enabled?: boolean;
  style?: string;
  items?: { type?: string; data_type?: string };
  advanced?: FormFieldAdvanced;
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

export interface CategoryItem {
  id: string;
  key?: string;
  name?: string;
  label?: string;
  icon?: string;
  color?: string;
  miniappImage?: string;
  miniappLink?: string;
}
export interface ComputePackage {
  id: string;
  name: string;
  points: number;
  price: number;
  validDays: number;
  validFrom: string | null;
  sortOrder: number;
  published?: boolean;
  /** 微信虚拟支付道具 ID（后台「算力管理」填写；缺失表示该套餐未开放在线支付）。 */
  virtualProductId?: string;
}
export interface CustomerService {
  enabled: boolean;
  qr: string;
  lines: string[];
}
export interface PublicContent {
  agents: ContentItem[];
  workflows: ContentItem[];
  categories: CategoryItem[];
  categoryGroups: CategoryItem[];
  banners: Array<Record<string, unknown>>;
  announcements: Array<Record<string, unknown>>;
  recommended: string[];
  computePackages: ComputePackage[];
  rechargeInfo: string;
  customerService: CustomerService;
}

export type MiniappLayoutBlockType = 'carousel' | 'announcements' | 'search' | 'categories' | 'featured-agents' | 'featured-workflows' | 'spacer';

/**
 * 后台可视化设计器里配置的跳转目标。
 * 结构化的意义：运营在后台直接选「某个智能体」，而不是手写 /pages/chat/index?id=xxx。
 * 解析统一收口在 utils/link.ts 的 resolveLink / navigateLink，不要在业务里各写一套。
 */
export type MiniLink =
  | { kind: 'agent'; id: string }
  | { kind: 'workflow'; id: string }
  | { kind: 'page'; path: string }
  | { kind: 'category'; key: string }
  | { kind: 'external'; url: string }
  | { kind: 'none' };

/**
 * ⚠️ 兼容层：后台在链接对象化之前把链接存成裸字符串（'/pages/xxx' 或 'https://...'）。
 * 这些历史配置**不迁移**，解析时继续认；新写入的一律是对象。
 */
export type MiniLinkValue = MiniLink | string;

export interface MiniappCarouselSlide {
  image: string;
  title?: string;
  subtitle?: string;
  link?: MiniLinkValue;
}
export interface MiniappLayoutBlock {
  id: string;
  type: MiniappLayoutBlockType;
  visible: boolean;
  title?: string;
  image?: string;
  backgroundColor?: string;
  textColor?: string;
  spacing?: number;
  link?: MiniLinkValue;
  slides?: MiniappCarouselSlide[];
  categoryImages?: Record<string, string>;
  /**
   * 分类导航：**每张分类卡**单独配的跳转，键是分类标识（key || id）。
   * 缺省时回落到 `item.miniappLink`，再回落到「进该分类的列表页」。
   */
  categoryLinks?: Record<string, MiniLinkValue>;
  /**
   * 推荐区（热门智能体 / 热门工作流）：**每张卡片**单独配的跳转，键是内容 id。
   * 缺省时回落到「打开这个智能体 / 工作流自身」。
   */
  cardLinks?: Record<string, MiniLinkValue>;
  dataSource?: 'recommended' | 'all' | 'current-category' | '';
  limit?: number;
  /** 搜索块：搜索框里的提示语，空则用渲染器默认文案 */
  searchPlaceholder?: string;
  /** 「更多」的文字，空则用默认的「更多>>」 */
  moreText?: string;
  /** 是否显示「更多」入口，默认显示 */
  showMore?: boolean;
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
  provider?: string;
  status?: string;
  hasPassword?: boolean;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  meta: { requestId: string; timestamp: string; page?: number; pageSize?: number; total?: number; totalPages?: number };
  error?: { code: string; message: string };
}

/** 微信支付 JSAPI 调起参数（传给 Taro.requestPayment）。 */
/** 【JSAPI 版停用】Taro.requestPayment 调起参数，保留以备回退（当前走虚拟支付）。 */
export interface RechargePayParams {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
}

/** 虚拟支付调起参数（wx.requestVirtualPayment）。signData 为字符串，前端必须原样透传。 */
export interface VirtualPaymentParams {
  signData: string;
  paySig: string;
  signature: string;
  mode: 'short_series_goods' | 'short_series_coin';
  env: number;
}

/** 充值下单结果：订单号 + 虚拟支付参数。 */
export interface RechargeOrderResult {
  orderId: string;
  productId: string;
  virtualPay: VirtualPaymentParams;
}

/** 充值订单状态（支付后查询）。 */
export interface RechargeStatus {
  orderId: string;
  status: string;
  points: number;
  amount: number;
  name: string;
}

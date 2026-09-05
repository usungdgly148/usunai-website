import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from './store.jsx';

const ChatBubbleIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="white" className="drop-shadow-sm">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5a8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    <circle cx="9.5" cy="11.5" r="1.2" fill="#2563EB" />
    <circle cx="14.5" cy="11.5" r="1.2" fill="#2563EB" />
  </svg>
);

export default function CustomerService() {
  const { customerService } = useStore();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const isInternal = location.pathname.startsWith('/chat/') || location.pathname.startsWith('/workflow/');
  if (!customerService?.enabled || isInternal) return null;

  const [line1, line2, line3] = customerService.lines || [];
  const hasQr = Boolean(customerService.qr);

  return (
    <div
      className="fixed right-5 bottom-5 z-40 flex flex-col items-end pointer-events-none md:right-8 md:bottom-8"
    >
      <style>{`
        @keyframes cs-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes cs-ping {
          0% { transform: scale(1); opacity: 0.55; }
          100% { transform: scale(1.7); opacity: 0; }
        }
        @keyframes cs-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
      `}</style>

      {/* 悬停白底容器：二维码 + 三行文字（仅作视觉展示，pointer-events-none 避免遮挡下层列表点击） */}
      {open && <div
        className={`
          mb-3 mr-0 bg-white rounded-2xl shadow-2xl p-4 min-w-[200px] max-w-[260px]
          transition-all duration-300 origin-bottom-right pointer-events-none
          opacity-100 translate-y-0 visible
        `}
      >
        <div className="flex flex-col items-center">
          {hasQr ? (
            <img
              src={customerService.qr}
              loading="lazy"
              decoding="async"
              alt="客服二维码"
              className="w-36 h-36 object-contain rounded-xl border border-slate-100"
            />
          ) : (
            <div className="w-36 h-36 rounded-xl bg-slate-50 border border-dashed border-slate-200 flex items-center justify-center text-xs text-slate-400 text-center px-3">
              请在后台上传客服二维码
            </div>
          )}
          <div className="mt-3 space-y-1 text-center w-full">
            {line1 && <p className="text-sm font-medium text-slate-800">{line1}</p>}
            {line2 && <p className="text-xs text-slate-500">{line2}</p>}
            {line3 && <p className="text-xs text-slate-500">{line3}</p>}
          </div>
        </div>
      </div>}

      {/* 浮动图标：外层 pointer-events-none（见父 div），仅圆按钮接收交互，避免遮挡下层点击 */}
      <div
        className="customer-service-float relative flex flex-col items-center cursor-pointer"
        style={{ animation: 'cs-float 3s ease-in-out infinite' }}
        role="button"
        aria-label="联系我们"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpen(v => !v); }}
      >
        {/* 呼吸脉冲环 */}
        <span
          className="customer-service-ping absolute inset-0 -m-1 rounded-full border-2 border-blue-400/60"
          style={{ animation: 'cs-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite' }}
        />
        <span
          className="customer-service-ping absolute inset-0 -m-1 rounded-full border-2 border-blue-400/40"
          style={{ animation: 'cs-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite 0.6s' }}
        />

        <button
          className="customer-service-pulse relative w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/30 flex items-center justify-center outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 pointer-events-auto"
          style={{ animation: 'cs-pulse 2s ease-in-out infinite' }}
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        >
          <ChatBubbleIcon />
          {/* 未读红点 */}
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center shadow-sm">
            1
          </span>
        </button>

        <span className="mt-2 text-xs font-medium text-slate-600 bg-white/80 backdrop-blur px-2 py-0.5 rounded-full shadow-sm">
          联系我们
        </span>
      </div>
    </div>
  );
}

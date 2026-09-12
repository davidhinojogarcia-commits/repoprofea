import React from 'react';

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ eyebrow, title, description, icon, actions, className = '' }) => (
  <div className={`ui-surface px-4 py-4 sm:px-5 sm:py-5 ${className}`.trim()}>
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex items-start gap-3.5">
        {icon && (
          <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--ui-gradient-brand)] text-white shadow-sm">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[var(--ui-brand-700)]">{eyebrow}</div>}
          <h1 className="mt-0.5 text-xl font-black tracking-[-0.02em] text-[var(--ui-text)] sm:text-2xl">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm leading-5 text-[var(--ui-text-muted)]">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </div>
  </div>
);

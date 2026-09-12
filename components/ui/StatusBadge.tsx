import React from 'react';

type StatusBadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: 'ok' | 'warn' | 'error' | 'info';
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ tone = 'info', className = '', ...props }) => (
  <span className={`ui-status ui-status--${tone} ${className}`.trim()} {...props} />
);

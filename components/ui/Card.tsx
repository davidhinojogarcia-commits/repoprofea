import React from 'react';

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: 'default' | 'soft' | 'glass';
};

export const Card: React.FC<CardProps> = ({ variant = 'default', className = '', ...props }) => {
  const variantClass = variant === 'glass' ? 'ui-glass' : variant === 'soft' ? 'ui-surface-soft' : 'ui-surface';
  return <div className={`${variantClass} ${className}`.trim()} {...props} />;
};

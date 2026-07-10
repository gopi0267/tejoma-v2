/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface TejomaLogoProps {
  className?: string;
  showText?: boolean;
  textColorClass?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export default function TejomaLogo({ 
  className = '', 
  showText = true, 
  textColorClass = 'text-slate-900',
  size = 'md' 
}: TejomaLogoProps) {
  // Determine dimensions based on size prop
  const dimensions = {
    sm: { logo: 'w-6 h-6', text: 'text-sm' },
    md: { logo: 'w-8 h-8', text: 'text-lg' },
    lg: { logo: 'w-12 h-12', text: 'text-2xl' },
    xl: { logo: 'w-16 h-16', text: 'text-3xl' },
  }[size];

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {/* Dynamic SVG Logo Mark */}
      <svg 
        viewBox="0 0 100 100" 
        className={`${dimensions.logo} flex-shrink-0`}
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Orange/Red Top-Left Stylized Element ("7") */}
        <path 
          d="M 8 92 V 8 H 92 V 24 H 54 A 26 26 0 0 0 28 50 V 92 H 8 Z" 
          fill="#E04B26" 
        />
        {/* Blue Nested Stylized Element ("C") */}
        <path 
          d="M 40 92 V 62 A 26 26 0 0 1 66 36 H 92 V 52 H 66 A 14 14 0 0 0 52 66 V 76 H 92 V 92 H 40 Z" 
          fill="#2962FF" 
        />
      </svg>

      {/* Brand Text */}
      {showText && (
        <span className={`font-extrabold tracking-tight ${textColorClass} ${dimensions.text}`}>
          Tejoma
        </span>
      )}
    </div>
  );
}

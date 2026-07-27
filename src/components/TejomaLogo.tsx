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
  size = 'md'
}: TejomaLogoProps) {
  // Determine dimensions based on size prop. The wordmark is baked into the logo image itself,
  // so sizing is height-driven with width auto to preserve the source aspect ratio. Heights
  // bumped up again across every tier per explicit request for a larger, more prominent mark -
  // width still auto-scales from the unchanged source image, so aspect ratio holds. The source
  // asset was also re-cropped to trim the large blank margin baked into the original export
  // (was ~1:1, now ~2.7:1) - at a given height the visible wordmark now renders noticeably
  // bigger and the "AI" badge sits right next to it instead of trailing off across empty space.
  const dimensions = {
    sm: { logo: 'h-12', badge: 'text-[10px] px-2 py-0.5' },
    md: { logo: 'h-16', badge: 'text-xs px-2.5 py-1' },
    lg: { logo: 'h-24', badge: 'text-sm px-3 py-1' },
    xl: { logo: 'h-40', badge: 'text-base px-3.5 py-1.5' },
  }[size];

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <img src="/tejoma-logo.png" alt="Tejoma" className={`${dimensions.logo} w-auto flex-shrink-0`} />

      {/* "AI" badge alongside the logo */}
      {showText && (
        <span className={`font-extrabold tracking-wide rounded-full bg-[#2962FF] text-white ${dimensions.badge}`}>
          AI
        </span>
      )}
    </div>
  );
}

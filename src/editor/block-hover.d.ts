type HoverRect = Pick<DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom'>;
export function isInBlockHoverRegion(block: HoverRect, handle: HoverRect, viewport: HoverRect, x: number, y: number): boolean;

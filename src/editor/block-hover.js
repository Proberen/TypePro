/** Keep the component, its handle and the intervening gutter one continuous region. */
export function isInBlockHoverRegion(block, handle, viewport, x, y) {
  return x >= Math.max(viewport.left, Math.min(block.left, handle.left))
    && x <= Math.min(viewport.right, Math.max(block.right, handle.right))
    && y >= Math.max(viewport.top, Math.min(block.top, handle.top))
    && y <= Math.min(viewport.bottom, Math.max(block.bottom, handle.bottom));
}

// 输入卡片浮层的锚定与可用高度解算。
//
// 宿主把 conversation.input.overlay 槽位渲染进输入卡片顶边的一条零高锚点里
// （宿主自身的光标菜单 MenuView 用的是同一个锚点，其定位为
//  position:absolute; bottom:calc(100% + 4px); left:0; max-width:min(537px,100%)）。
// 槽位包装元素是 display:contents，不参与布局，所以浮层用绝对定位即可贴合卡片上沿；
// 写死视口坐标（left/bottom 的像素值）会让浮层脱离触发按钮，并在输入框行数变化时错位。
//
// 高度上限来自会话滚动区的裁剪：滚动区 overflow-y 为 auto，超出上沿的部分不可达，
// 故可用高度取「锚点顶边 → 滚动区顶边」，再扣掉与卡片的间隙和顶部留白。

export const POPOVER_GAP = 8           // 浮层底边与输入卡片顶边的间隙
export const POPOVER_TOP_CLEARANCE = 8 // 浮层顶边与滚动区顶边的最小留白
export const POPOVER_MAX_HEIGHT = 620  // 上限，避免大屏下浮层过长

/**
 * 由锚点与裁剪边界的位置解算浮层最大高度。
 * 两个入参都是视口坐标（`getBoundingClientRect().top`），与具体 DOM 结构无关，便于单测。
 *
 * 裁剪边界是硬约束：越过它，宿主滚动区会把浮层顶部（标题与关闭按钮）直接裁掉。
 * 所以边界优先于 620px 上限偏好——空间不足时浮层就变矮（内部列表仍可滚动），
 * 而不是顶着上限被裁掉标题。
 */
export function overlayMaxHeight(anchorTop, boundaryTop) {
  const available = Math.round(Number(anchorTop) - Number(boundaryTop) - POPOVER_GAP - POPOVER_TOP_CLEARANCE)
  if (!Number.isFinite(available)) return POPOVER_MAX_HEIGHT
  return Math.max(0, Math.min(POPOVER_MAX_HEIGHT, available))
}

/** 自锚点向上找到最近的滚动裁剪祖先（即宿主的会话滚动区），作为浮层高度边界。 */
export function findScrollport(node) {
  let element = node?.parentElement ?? null
  while (element && element !== document.documentElement) {
    const overflowY = getComputedStyle(element).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') return element
    element = element.parentElement
  }
  return null
}

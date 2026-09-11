import { h, C } from './theme.js'
import { Select } from './ui.js'

const CATEGORY_TYPE_LABELS = { workflow: '工作流程', skill: '技能', database: '数据库' }
const WORKBENCH_CATEGORY_SHORTCUTS = {
  workflow: ['论文与手稿', '文献研究', '生物信息学', '作物遗传育种'],
  skill: ['论文与手稿', '文献研究', '生物信息学', '农业研究'],
  database: ['文献与引文', '基因组与遗传变异', '组学与表达数据', '临床与公共卫生'],
}
export const WORKBENCH_CATEGORY_COLORS = {
  '论文与手稿': C.blue,
  '文献研究': C.statusPreference,
  '数据分析': C.statusVerified,
  '研究设计': C.amber,
  '基因组学': C.teal,
  '临床研究': C.red,
}
export const workbenchFallbackCategoryColor = C.teal

export function CatalogCategoryFilter({ type, categories, value, onChange }) {
  const quickCategories = (WORKBENCH_CATEGORY_SHORTCUTS[type] || []).filter(category => categories.includes(category))
  const additionalCategories = categories.filter(category => !quickCategories.includes(category))
  const selectIsActive = value === 'all' || additionalCategories.includes(value)
  return h('div', {
    role: 'group',
    'aria-label': `${CATEGORY_TYPE_LABELS[type]}分类筛选`,
    style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', width: '100%' },
  }, [
    h(Select, {
      key: 'all-categories',
      value,
      onChange,
      ariaLabel: `全部${CATEGORY_TYPE_LABELS[type]}分类`,
      className: 'rk-workflow-category-select',
      style: {
        padding: '5px 25px 5px 10px', borderRadius: 999,
        borderColor: selectIsActive ? C.teal : `${C.teal}40`,
        background: selectIsActive ? C.teal : 'transparent',
        color: selectIsActive ? C.onInk : C.teal,
        fontSize: 12, fontWeight: 700,
      },
      options: [
        { value: 'all', label: '全部' },
        ...quickCategories.map(category => ({ value: category, label: category })),
        ...additionalCategories.map(category => ({ value: category, label: category })),
      ],
    }),
    ...quickCategories.map(category => {
      const color = WORKBENCH_CATEGORY_COLORS[category] || workbenchFallbackCategoryColor
      const active = value === category
      return h('button', {
        key: category,
        type: 'button',
        onClick: () => onChange(category),
        'aria-pressed': active,
        className: 'rk-btn',
        style: {
          padding: '5px 10px', border: `1px solid ${active ? color : `${color}40`}`, borderRadius: 999,
          whiteSpace: 'nowrap', cursor: 'pointer', background: active ? color : 'transparent',
          color: active ? C.onInk : color, fontSize: 12, fontWeight: 700,
        },
      }, category)
    }),
  ])
}

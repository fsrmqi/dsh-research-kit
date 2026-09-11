// 技能目录的唯一聚合入口：按稳定用途分片（core 通用科研 / crop-breeding 育种 / bioinformatics 生信）。
// 新增分片必须在此登记：构建器与校验器以「分片总数 == 聚合总数」断言拦截遗漏。
import core from './core.json' with { type: 'json' }
import cropBreeding from './crop-breeding.json' with { type: 'json' }
import bioinformatics from './bioinformatics.json' with { type: 'json' }

const skills = [...core, ...cropBreeding, ...bioinformatics]

export default skills

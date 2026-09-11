// 工作流目录的唯一聚合入口：按固定顺序导出全部分片。
// 顺序即目录展示顺序 —— 分片按「分类在旧单文件中的首次出现序」排列，
// 保证拆分前后各分组在界面中的先后与组内相对顺序完全不变。
// 新增分片必须在此登记：构建器与校验器以「分片总数 == 聚合总数」断言拦截遗漏。
import paperManuscript from './paper-manuscript.json' with { type: 'json' }
import literature from './literature.json' with { type: 'json' }
import dataAnalysis from './data-analysis.json' with { type: 'json' }
import researchDesign from './research-design.json' with { type: 'json' }
import bioinformatics from './bioinformatics.json' with { type: 'json' }
import genomics from './genomics.json' with { type: 'json' }
import clinical from './clinical.json' with { type: 'json' }
import cropBreeding from './crop-breeding.json' with { type: 'json' }
import visual from './visual.json' with { type: 'json' }
import scienceCommunication from './science-communication.json' with { type: 'json' }
import grants from './grants.json' with { type: 'json' }
import proteomics from './proteomics.json' with { type: 'json' }
import cellBiology from './cell-biology.json' with { type: 'json' }
import chemistry from './chemistry.json' with { type: 'json' }
import drugDiscovery from './drug-discovery.json' with { type: 'json' }
import materials from './materials.json' with { type: 'json' }
// 预留流程族：当前为空分片，迁入条目后自然并入聚合。
import ecology from './ecology.json' with { type: 'json' }
import neuroscience from './neuroscience.json' with { type: 'json' }
import physics from './physics.json' with { type: 'json' }
import astronomy from './astronomy.json' with { type: 'json' }
import socialScience from './social-science.json' with { type: 'json' }
import mathematics from './mathematics.json' with { type: 'json' }
import machineLearning from './machine-learning.json' with { type: 'json' }
import engineering from './engineering.json' with { type: 'json' }

const workflows = [
  ...paperManuscript,
  ...literature,
  ...dataAnalysis,
  ...researchDesign,
  ...bioinformatics,
  ...genomics,
  ...clinical,
  ...cropBreeding,
  ...visual,
  ...scienceCommunication,
  ...grants,
  ...proteomics,
  ...cellBiology,
  ...chemistry,
  ...drugDiscovery,
  ...materials,
  ...ecology,
  ...neuroscience,
  ...physics,
  ...astronomy,
  ...socialScience,
  ...mathematics,
  ...machineLearning,
  ...engineering,
]

export default workflows

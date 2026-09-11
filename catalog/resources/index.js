// 数据源目录的唯一聚合入口：按稳定用途分片。
// crop-breeding 置首使聚合数组首条与拆分前的 databases.json 一致（usda-nass），
// 组内条目保持旧文件相对顺序；database-metadata.json（分组与展示元数据）随本入口导出，
// 供 src/catalog.js 与构建器消费，不再作为第四个独立数据读取点。
// 新增分片必须在此登记：构建器与校验器以「分片总数 == 聚合总数」断言拦截遗漏。
import cropBreeding from './crop-breeding.json' with { type: 'json' }
import literature from './literature.json' with { type: 'json' }
import genomics from './genomics.json' with { type: 'json' }
import omics from './omics.json' with { type: 'json' }
import generalScience from './general-science.json' with { type: 'json' }
import databaseMetadataConfig from './database-metadata.json' with { type: 'json' }

const resources = [...cropBreeding, ...literature, ...genomics, ...omics, ...generalScience]

export default resources
export { resources, databaseMetadataConfig }

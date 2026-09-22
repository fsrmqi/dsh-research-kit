import { catalogTools } from './catalog.js'
import { DISCOVERY_ROUTES, discoveryTools } from './discovery.js'
import { evidenceLinkTools, evidenceTools } from './evidence.js'
import { figureTools } from './figures.js'
import { literatureTools } from './literature.js'
import { literatureDiscoveryTools, literatureLinkTools, literatureMetadataTools } from './literature-search.js'
import { observabilityTools } from './observability.js'
import { reviewCoreTools, reviewFocusedTools } from './review.js'
import { runCheckpointTools, runLifecycleTools } from './runs.js'

const tools = [
  ...discoveryTools,
  ...catalogTools,
  ...literatureTools,
  ...literatureDiscoveryTools,
  ...evidenceTools,
  ...observabilityTools,
  ...runLifecycleTools,
  ...evidenceLinkTools,
  ...figureTools,
  ...runCheckpointTools,
  ...reviewCoreTools,
  ...literatureLinkTools,
  ...reviewFocusedTools,
  ...literatureMetadataTools,
]

export { tools, DISCOVERY_ROUTES }

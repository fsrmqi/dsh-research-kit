
import {
  clearAllProjectEntries,
  clearProjectEntries,
  deleteProjectEntry,
  evidenceProjectOrganizationState,
  finalizeEvidenceProjectOrganization,
  listAllProjectEntries,
  mergeProjectEntries,
  organizeEvidenceProjects,
  replaceProjectEntry,
  undoEvidenceProjectOrganization,
  readProjectEntries,
  safeProjectName,
} from '../mcp/execution/evidence-store.js'

export const EVIDENCE_SYNC_PATH = '/dsh-research-kit/evidence-sync'

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => {
      data += chunk
      if (data.length > 1_048_576) {
        reject(new Error('body_too_large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try { resolve(JSON.parse(data)) } catch { reject(new Error('invalid_json')) }
    })
    req.on('error', reject)
  })
}

function requestProject(value) {
  return safeProjectName(value || 'default')
}

export function evidenceSyncRoute({ logger } = {}) {
  return {
    kind: 'exact', path: EVIDENCE_SYNC_PATH,
    async handler(req, res) {
      try {
        if (req.method === 'GET') {
          const url = new URL(req.url, `http://${req.headers?.host || 'localhost'}`)
          if (url.searchParams.get('organizer') === 'last') {
            return reply(res, 200, { ok: true, journal: await evidenceProjectOrganizationState() })
          }
          const projectParam = url.searchParams.get('project')
          if (!projectParam) {
            const entries = await listAllProjectEntries()
            return reply(res, 200, { ok: true, project: 'all', entries, count: entries.length })
          }
          const project = requestProject(projectParam)
          const entries = await readProjectEntries(project)
          return reply(res, 200, { ok: true, project, entries, count: entries.length })
        }

        if (req.method === 'POST') {
          const body = await readBody(req)
          const project = requestProject(body.project)
          const incoming = Array.isArray(body.entries) ? body.entries : []
          if (!incoming.length) return reply(res, 400, { ok: false, error: 'no_entries' })
          const result = await mergeProjectEntries(project, incoming)
          return reply(res, 200, { ok: true, project, added: result.added, skipped: result.skipped.length })
        }

        if (req.method === 'PUT') {
          const body = await readBody(req)
          const project = requestProject(body.project)
          const result = await replaceProjectEntry(project, body.entry)
          if (!result.updated) return reply(res, 404, { ok: false, error: 'not_found' })
          return reply(res, 200, { ok: true, project, entry: result.entry })
        }

        if (req.method === 'PATCH') {
          const body = await readBody(req)
          if (body?.action === 'organize') return reply(res, 200, { ok: true, ...await organizeEvidenceProjects(body.moves) })
          if (body?.action === 'undo') return reply(res, 200, { ok: true, ...await undoEvidenceProjectOrganization(body.id) })
          if (body?.action === 'finalize') return reply(res, 200, { ok: true, ...await finalizeEvidenceProjectOrganization(body.id) })
          return reply(res, 400, { ok: false, error: 'invalid_action' })
        }

        if (req.method === 'DELETE') {
          const url = new URL(req.url, `http://${req.headers?.host || 'localhost'}`)
          const all = url.searchParams.get('all') === '1'
          if (all) {
            const project = url.searchParams.get('project')
            if (project) await clearProjectEntries(project)
            else await clearAllProjectEntries()
            return reply(res, 200, { ok: true, project: project || 'all', cleared: true })
          }
          const project = requestProject(url.searchParams.get('project'))
          const entryId = url.searchParams.get('id')
          if (!entryId) return reply(res, 400, { ok: false, error: 'missing_id' })
          const result = await deleteProjectEntry(project, entryId)
          if (!result.deleted) return reply(res, 404, { ok: false, error: 'not_found' })
          return reply(res, 200, { ok: true, project, deleted: entryId })
        }

        return reply(res, 405, { ok: false, error: 'method_not_allowed' })
      } catch (error) {
        try { logger?.warn?.(`evidence-sync error: ${error?.message || error}`) } catch {}
        const status = error?.code === 'INVALID_PROJECT' ? 400
          : error?.message === 'invalid_json' ? 400
            : error?.message === 'body_too_large' ? 413 : 500
        return reply(res, status, { ok: false, error: error?.code === 'INVALID_PROJECT' ? 'invalid_project' : error?.message || 'internal_error' })
      }
    },
  }
}

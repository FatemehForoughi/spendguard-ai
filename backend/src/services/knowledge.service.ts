import { readFileSync, readdirSync } from 'fs'
import { join, basename } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const KNOWLEDGE_DIR = join(__dirname, 'ai-knowledge')

class KnowledgeService {
  private cache: Map<string, string>

  constructor() {
    this.cache = new Map()
    this.loadAll()
  }

  private loadAll(): void {
    try {
      const files = readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'))
      for (const file of files) {
        const name = basename(file, '.md')
        const content = readFileSync(join(KNOWLEDGE_DIR, file), 'utf-8')
        this.cache.set(name, content.trim())
      }
      console.log(`[Knowledge] Loaded ${this.cache.size} knowledge files`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Knowledge] Failed to load knowledge files:', message)
    }
  }

  get(name: string): string {
    return this.cache.get(name) || ''
  }

  getAll(): Record<string, string> {
    return Object.fromEntries(this.cache)
  }

  /**
   * Returns all knowledge as a single text block
   * Intended to be placed inside the system prompt
   */
  getCombinedPrompt(): string {
    const order: string[] = [
      'security_rules',
      'threat_patterns',
      'detection_rules',
      'risk_levels',
      'attack_scenarios',
      'response_guidelines',
      'project_knowledge',
    ]

    return order
      .map((name) => {
        const content = this.get(name)
        return content ? `### ${name.toUpperCase()}\n${content}` : ''
      })
      .filter(Boolean)
      .join('\n\n')
  }
}

export const knowledgeService = new KnowledgeService()
export interface Diagnostic { file: string; line?: number; column?: number; endLine?: number; endColumn?: number; hint?: string; docsUrl?: string; code: string; message: string; severity: 'error' | 'warning' }
export interface Change { file: string; before: string; after: string }
export interface MigrationReport { diagnostics: Diagnostic[]; changes: Change[]; applied: boolean; modules: number }
export interface MigrationOptions { root: string; apply?: boolean; local?: string }

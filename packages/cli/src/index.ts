export { migrate } from './project.js';
export { migrateSource } from './source.js';
export { createProject } from './create.js';
export type { MigrationOptions, MigrationReport, Diagnostic, Change } from './types.js';

export { checkSeo } from './seo/check.js';
export { inspectSeoHtml } from './seo/html.js';
export type { SeoCheckOptions, SeoCheckReport } from './seo/check.js';
export type { SeoDiagnostic } from './seo/html.js';

export { doctor, type DoctorReport } from './doctor.js';
export type { CreateProjectOptions } from './create.js';

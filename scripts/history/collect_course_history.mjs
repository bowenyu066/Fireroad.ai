import 'dotenv/config';
import { createRequire } from 'node:module';
import { importOfferingManifest } from './import_offering_manifest.mjs';
import { fetchDocumentsForManifest } from './fetch_documents.mjs';
import { extractPoliciesForManifest } from './extract_policies.mjs';

const require = createRequire(import.meta.url);
const { hasAiApiKey } = require('../../server/chat/provider.js');

export async function collectCourseHistory(courseOrPath) {
  if (!courseOrPath) throw new Error('Usage: node scripts/history/collect_course_history.mjs <courseId|manifestPath>');

  const imported = await importOfferingManifest(courseOrPath);
  const fetched = await fetchDocumentsForManifest(courseOrPath);
  const extracted = hasAiApiKey()
    ? await extractPoliciesForManifest(courseOrPath)
    : {
        courseId: imported.courseId,
        extracted: [],
        skipped: [{ reason: 'AI provider API key not set; policy extraction skipped.' }],
        failed: [],
      };

  return { imported, fetched, extracted };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  collectCourseHistory(process.argv[2])
    .then((result) => {
      console.log(`Collected history for ${result.imported.courseId}`);
      console.log(JSON.stringify({
        aliases: result.imported.aliases.length,
        offerings: result.imported.offerings.length,
        documentsInserted: result.fetched.inserted.length,
        documentsSkipped: result.fetched.skipped.length,
        documentFailures: result.fetched.failed,
        policiesExtracted: result.extracted.extracted.length,
        extractionSkipped: result.extracted.skipped,
        extractionFailures: result.extracted.failed,
      }, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

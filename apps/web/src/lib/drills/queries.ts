import { createClient } from '@/lib/supabase/server';
import { getCharts } from '@/lib/charts/registry';

import { toDrillTemplates, type DrillTemplateRow, type StoredTemplate } from './map';

/**
 * Loads the published drill templates.
 *
 * RLS does the filtering — `"templates: read"` gates on `published`, so an
 * unpublished template is invisible here without this query mentioning it.
 * `generateSession` filters on `published` again, which is not redundant: the
 * engine has no idea where its templates came from and is used by tests and
 * (in v2) a native client that will not have gone through this policy.
 *
 * As with charts, a failure is an error state rather than a fallback to the
 * bundled `@poker/content` templates. Drilling content the database does not
 * hold would make the sync script's whole purpose a lie.
 */
export async function fetchDrillTemplates(): Promise<readonly StoredTemplate[]> {
  const supabase = await createClient();
  const { registry } = await getCharts();

  const { data, error } = await supabase
    .from('drill_templates')
    .select('id, slug, title, config, skill_tags, published')
    .order('slug');

  if (error) {
    throw new Error(`could not load drill templates: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error(
      'no published drill templates are visible. Run `pnpm content:sync` against this database.',
    );
  }

  return toDrillTemplates(data as DrillTemplateRow[], registry);
}

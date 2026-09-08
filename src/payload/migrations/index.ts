import * as migration_20260827_022341_initial from './20260827_022341_initial';
import * as migration_20260827_044610_remove_schema_probes from './20260827_044610_remove_schema_probes';
import * as migration_20260827_051943_phase_6_data_model from './20260827_051943_phase_6_data_model';
import * as migration_20260827_063239_phase_6_audit_fixes from './20260827_063239_phase_6_audit_fixes';
import * as migration_20260827_082119_phase_7_access_control from './20260827_082119_phase_7_access_control';
import * as migration_20260828_020136_phase_8_media_cloudinary from './20260828_020136_phase_8_media_cloudinary';
import * as migration_20260828_060719_phase_9_defer_campaign_links from './20260828_060719_phase_9_defer_campaign_links';
import * as migration_20260828_085710_phase_10_homepage from './20260828_085710_phase_10_homepage';
import * as migration_20260907_073432_phase_12_search from './20260907_073432_phase_12_search';
import * as migration_20260908_054841_phase_17_checkout from './20260908_054841_phase_17_checkout';

export const migrations = [
  {
    up: migration_20260827_022341_initial.up,
    down: migration_20260827_022341_initial.down,
    name: '20260827_022341_initial',
  },
  {
    up: migration_20260827_044610_remove_schema_probes.up,
    down: migration_20260827_044610_remove_schema_probes.down,
    name: '20260827_044610_remove_schema_probes',
  },
  {
    up: migration_20260827_051943_phase_6_data_model.up,
    down: migration_20260827_051943_phase_6_data_model.down,
    name: '20260827_051943_phase_6_data_model',
  },
  {
    up: migration_20260827_063239_phase_6_audit_fixes.up,
    down: migration_20260827_063239_phase_6_audit_fixes.down,
    name: '20260827_063239_phase_6_audit_fixes',
  },
  {
    up: migration_20260827_082119_phase_7_access_control.up,
    down: migration_20260827_082119_phase_7_access_control.down,
    name: '20260827_082119_phase_7_access_control',
  },
  {
    up: migration_20260828_020136_phase_8_media_cloudinary.up,
    down: migration_20260828_020136_phase_8_media_cloudinary.down,
    name: '20260828_020136_phase_8_media_cloudinary',
  },
  {
    up: migration_20260828_060719_phase_9_defer_campaign_links.up,
    down: migration_20260828_060719_phase_9_defer_campaign_links.down,
    name: '20260828_060719_phase_9_defer_campaign_links',
  },
  {
    up: migration_20260828_085710_phase_10_homepage.up,
    down: migration_20260828_085710_phase_10_homepage.down,
    name: '20260828_085710_phase_10_homepage',
  },
  {
    up: migration_20260907_073432_phase_12_search.up,
    down: migration_20260907_073432_phase_12_search.down,
    name: '20260907_073432_phase_12_search',
  },
  {
    up: migration_20260908_054841_phase_17_checkout.up,
    down: migration_20260908_054841_phase_17_checkout.down,
    name: '20260908_054841_phase_17_checkout'
  },
];

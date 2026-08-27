import * as migration_20260827_022341_initial from './20260827_022341_initial';
import * as migration_20260827_044610_remove_schema_probes from './20260827_044610_remove_schema_probes';
import * as migration_20260827_051943_phase_6_data_model from './20260827_051943_phase_6_data_model';

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
    name: '20260827_051943_phase_6_data_model'
  },
];

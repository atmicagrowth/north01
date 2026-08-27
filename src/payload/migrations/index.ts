import * as migration_20260827_022341_initial from './20260827_022341_initial';

export const migrations = [
  {
    up: migration_20260827_022341_initial.up,
    down: migration_20260827_022341_initial.down,
    name: '20260827_022341_initial'
  },
];
